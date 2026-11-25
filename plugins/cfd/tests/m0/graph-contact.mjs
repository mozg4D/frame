import {gpuScope} from './gpu.mjs';
import {meshReader,meshResources} from './pressure-barrier.mjs';

// Nodes already follow Morton order. Pack their undirected segments in
// small consecutive leaves, with an escape index for a stackless GPU walk.
export function graphEdgeTree(g){
  const edges=[];
  for(let i=0;i+1<g.offset.length;i++)for(let e=g.offset[i];e<g.offset[i+1];e++){
    if(g.kind[e]===0&&g.linkFace[e]>=0)edges.push(g.linkFace[e],i,g.nbr[e],0);
  }
  return segmentBoundsTree(g.pos,Uint32Array.from(edges));
}
export function segmentBoundsTree(pos,edge){
  const leaves=Math.ceil(edge.length/32),count=Math.max(0,2*leaves-1);
  const nodes=new Float32Array(count*8),address=new Uint32Array(nodes.buffer);let next=0;
  function build(first,end){
    const k=next++,lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
    if(end-first===1){
      address[8*k+7]=8*first+1;
      for(let j=8*first;j<Math.min(8*end,edge.length/4);j++)for(const i of [edge[4*j+1],edge[4*j+2]]){
        for(let a=0;a<3;a++){const v=pos[4*i+a];lo[a]=Math.min(lo[a],v);hi[a]=Math.max(hi[a],v);}
      }
    }else{
      const mid=(first+end)>>1,l=build(first,mid),r=build(mid,end);
      for(let a=0;a<3;a++){lo[a]=Math.min(nodes[8*l+a],nodes[8*r+a]);hi[a]=Math.max(nodes[8*l+4+a],nodes[8*r+4+a]);}
    }
    nodes.set(lo,8*k);nodes.set(hi,8*k+4);address[8*k+3]=next;return k;
  }
  if(count)build(0,leaves);
  return {nodes,edge};
}

export async function graphIntersections(device,g,tree,capture,faces){
  const gpu=gpuScope(device),start=performance.now();
  try{
    const initial=new Float32Array(2*faces);
    for(let i=0;i<faces;i++)initial[2*i]=Infinity;
    if(!tree.edge.length)return {values:initial,ms:0,peakGpuBytes:0};
    const boxes=gpu.buffer('CFD graph segment bounds',tree.nodes),edges=gpu.buffer('CFD graph segments',tree.edge);
    const pos=gpu.buffer('CFD physical graph sites',g.pos),hits=gpu.buffer('CFD first and last sheet intersections',initial);
    const pipes=new Map();
    for(const mesh of capture.meshes){
      if(!pipes.has(mesh.storage))pipes.set(mesh.storage,await gpu.kernel('CFD intersect native surface with pressure links',meshReader(mesh.storage)+`
        struct Box{lo:vec3f,escape:u32,hi:vec3f,first:u32} struct Pose{m:mat4x4f,count:u32}
        @group(0) @binding(2) var<storage,read> boxes:array<Box>;
        @group(0) @binding(3) var<storage,read> edge:array<vec4u>;
        @group(0) @binding(4) var<storage,read> pos:array<vec4f>;
        @group(0) @binding(5) var<storage,read_write> hits:array<atomic<u32>>;
        @group(0) @binding(6) var<uniform> pose:Pose;
        @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) gid:vec3u,@builtin(num_workgroups) width:vec3u){
          let t=gid.x+gid.y*width.x*64u;if(t>=pose.count){return;}
          let a=(pose.m*vec4f(sourcePoint(3u*t),1.)).xyz;let b=(pose.m*vec4f(sourcePoint(3u*t+1u),1.)).xyz;
          let c=(pose.m*vec4f(sourcePoint(3u*t+2u),1.)).xyz;let ab=b-a;let ac=c-a;let n=cross(ab,ac);
          let nn=dot(n,n);if(nn==0.){return;}let scale=max(length(ab),length(ac));
          let eps=2e-6*scale;let lo=min(a,min(b,c))-eps;let hi=max(a,max(b,c))+eps;
          var k=0u;while(k<arrayLength(&boxes)){
            let box=boxes[k];if(any(box.lo>hi)||any(box.hi<lo)){k=box.escape;continue;}
            if(box.first>0u){let first=box.first-1u;
              for(var e=first;e<min(first+8u,arrayLength(&edge));e++){
                let ids=edge[e];let l=pos[ids.y].xyz;let r=pos[ids.z].xyz;
                if(any(min(l,r)>hi)||any(max(l,r)<lo)){continue;}let s=r-l;let det=dot(n,s);
                if(abs(det)<=1e-8*sqrt(nn*dot(s,s))){continue;}let u=dot(n,a-l)/det;
                if(u<-.000002||u>1.000002){continue;}
                let v=l+u*s-a;let m=dot(n,cross(v,ac))/nn;let w=dot(n,cross(ab,v))/nn;
                if(m>=-.000002&&w>=-.000002&&m+w<=1.000002){
                  let bits=bitcast<u32>(clamp(u,0.,1.)+0.);
                  atomicMin(&hits[2u*ids.x],bits);atomicMax(&hits[2u*ids.x+1u],bits);
                }
              }
            }k++;
          }
        }`));
      const data=new ArrayBuffer(80);new Float32Array(data,0,16).set(mesh.matrix);new Uint32Array(data,64,1)[0]=mesh.triangleCount;
      const transform=gpu.buffer('CFD native graph surface pose',new Uint8Array(data),GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
      const pipe=pipes.get(mesh.storage),resources=[...meshResources(mesh),...[boxes,edges,pos,hits,transform].map(buffer=>({buffer}))];
      const bind=device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:resources.map((resource,binding)=>({binding,resource}))});
      if(mesh.triangleCount){const n=Math.ceil(mesh.triangleCount/64),width=Math.min(n,device.limits.maxComputeWorkgroupsPerDimension);
        capture.assertCurrent();const e=device.createCommandEncoder();gpu.dispatch(e,pipe,bind,[width,Math.ceil(n/width)]);device.queue.submit([e.finish()]);}
    }
    const values=await gpu.read(hits,gpu.staging('CFD graph crossing certificate',hits.size),2*faces);capture.assertCurrent();
    return {values,ms:performance.now()-start,peakGpuBytes:gpu.allocatedBytes};
  }finally{gpu.close();}
}

export async function sealNativeGraph(device,g,capture){
  const count=g.faces.planes.length/4,tree=g.nativeEdges;
  const {values,ms,peakGpuBytes}=await graphIntersections(device,g,tree,capture,count);
  let closed=0,doubleCrossings=0,maxWallLocationErrorM=0;
  for(let e=0;e<tree.edge.length;e+=4){
    const id=tree.edge[e],first=values[2*id];if(!Number.isFinite(first))continue;
    const last=values[2*id+1],distance=g.faces.planes[4*id+3];g.faces.planes[4*id+3]=.5*distance;
    closed++;if(last-first>1e-5)doubleCrossings++;
    maxWallLocationErrorM=Math.max(maxWallLocationErrorM,distance*Math.max(Math.abs(first-.5),Math.abs(last-.5)));
  }
  for(let i=0;i+1<g.offset.length;i++)for(let e=g.offset[i];e<g.offset[i+1];e++){
    const oriented=g.linkFace[e],id=oriented<0?~oriented:oriented;
    if(g.kind[e]||!Number.isFinite(values[2*id]))continue;
    g.kind[e]=7;g.nbr[e]=i;g.wallDist[i]=Math.min(g.wallDist[i],g.faces.planes[4*id+3]);
  }
  g.nativeEdges=null;
  return {checked:tree.edge.length/4,closed,doubleCrossings,maxWallLocationErrorM,ms,peakGpuBytes};
}
