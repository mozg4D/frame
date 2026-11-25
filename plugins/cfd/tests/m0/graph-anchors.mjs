import {gpuScope} from './gpu.mjs';
import {meshReader,meshResources} from './pressure-barrier.mjs';
import {graphIntersections,segmentBoundsTree} from './graph-contact.mjs';

// The signed metric supplies sample density and outward orientation. Measure
// the actual closest physical point on the evaluated triangles for each seed.
// Start at the metric sign crossing, independently of supplied mesh normals.
const projection=`
  struct Site{p:vec4f,n:vec4f} struct Pose{m:mat4x4f,count:u32}
  @group(0) @binding(2) var<storage,read> seed:array<Site>;
  @group(0) @binding(3) var<storage,read_write> fitted:array<Site>;
  @group(0) @binding(4) var<uniform> pose:Pose;
  var<workgroup> best:array<Site,64>;
  fn segment(p:vec3f,a:vec3f,b:vec3f)->vec3f{
    let s=b-a;return a+clamp(dot(p-a,s)/max(dot(s,s),1e-30),0.,1.)*s;
  }
  fn closest(p:vec3f,a:vec3f,b:vec3f,c:vec3f,n:vec3f)->vec3f{
    let projected=p-dot(p-a,n)*n;
    if(dot(cross(b-a,projected-a),n)>=0. && dot(cross(c-b,projected-b),n)>=0. &&
       dot(cross(a-c,projected-c),n)>=0.){return projected;}
    let x=segment(p,a,b);let y=segment(p,b,c);let z=segment(p,c,a);
    let xy=select(y,x,dot(p-x,p-x)<=dot(p-y,p-y));return select(z,xy,dot(p-xy,p-xy)<=dot(p-z,p-z));
  }
  fn better(a:Site,b:Site)->bool{return a.p.w<b.p.w||(a.p.w==b.p.w&&a.n.w<b.n.w);}
  @compute @workgroup_size(64) fn main(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) width:vec3u,@builtin(local_invocation_index) lane:u32){
    let i=group.x+group.y*width.x;if(i>=arrayLength(&seed)){return;}
    let p=seed[i].p.xyz;var site:Site;site.p.w=3.4e38;site.n.w=3.4e38;
    for(var k=lane;k<pose.count;k+=64u){
      let a=(pose.m*vec4f(sourcePoint(3u*k),1)).xyz;let b=(pose.m*vec4f(sourcePoint(3u*k+1u),1)).xyz;
      let c=(pose.m*vec4f(sourcePoint(3u*k+2u),1)).xyz;let tri=cross(b-a,c-a);let nn=dot(tri,tri);if(nn<=1e-32){continue;}
      let n=tri*inverseSqrt(nn);let q=closest(p,a,b,c,n);
      let s=Site(vec4f(q,dot(q-p,q-p)),vec4f(select(-n,n,dot(n,seed[i].n.xyz)>=0.),f32(k)));
      if(better(s,site)){site=s;}
    }
    best[lane]=site;
    for(var stride=32u;stride>0u;stride/=2u){workgroupBarrier();if(lane<stride){
      let other=best[lane+stride];if(better(other,best[lane])){best[lane]=other;}}}
    if(lane==0u&&best[0].p.w<fitted[i].p.w){fitted[i]=best[0];}
  }`;

export async function fitNativeGraphAnchors(device,seeds,layers,capture){
  const started=performance.now(),gpu=gpuScope(device),n=seeds.length;
  if(!n)throw Error('The native signed metric has no surface crossings');
  try{
    const input=new Float32Array(n*8),initial=new Float32Array(n*8);
    for(let i=0;i<n;i++){input.set(seeds[i].p,8*i);input.set(seeds[i].n,8*i+4);initial[8*i+3]=Infinity;}
    const seed=gpu.buffer('CFD signed metric surface samples',input),fitted=gpu.buffer('CFD projected native surface samples',initial);
    const pipes=new Map(),w=Math.min(n,device.limits.maxComputeWorkgroupsPerDimension);
    for(const mesh of capture.meshes){
      if(!mesh.triangleCount)continue;
      if(!pipes.has(mesh.storage))pipes.set(mesh.storage,await gpu.kernel('CFD project metric samples onto Frame triangles',meshReader(mesh.storage)+projection));
      const uniform=new ArrayBuffer(80);new Float32Array(uniform,0,16).set(mesh.matrix);new Uint32Array(uniform,64,1)[0]=mesh.triangleCount;
      const pose=gpu.buffer('CFD graph anchor occurrence',new Uint8Array(uniform),GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
      const pipe=pipes.get(mesh.storage),resources=[...meshResources(mesh),...[seed,fitted,pose].map(buffer=>({buffer}))];
      const bind=device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:resources.map((resource,binding)=>({binding,resource}))});
      capture.assertCurrent();const e=device.createCommandEncoder();gpu.dispatch(e,pipe,bind,[w,Math.ceil(n/w)]);device.queue.submit([e.finish()]);
    }
    const measured=await gpu.read(fitted,gpu.staging('CFD native surface points',fitted.size),8*n);capture.assertCurrent();
    const offsets=[-layers[0],...layers],lengths=[layers[0],layers.at(-1)],eps=Math.min(1e-6,.002*layers[0]);
    const pos=new Float32Array(n*16),edges=new Uint32Array(n*8),anchors=[];let maxShiftM=0,squaredShift=0;
    for(let i=0;i<n;i++){
      const j=i*8,p=Array.from(measured.subarray(j,j+3)),normal=Array.from(measured.subarray(j+4,j+7)),d2=measured[j+3];
      if(!Number.isFinite(d2)||Math.abs(Math.hypot(...normal)-1)>1e-4)throw Error('Native graph anchor has no closest triangle');
      maxShiftM=Math.max(maxShiftM,Math.sqrt(d2));squaredShift+=d2;anchors.push({p,n:normal,clear:[]});
      for(let side=0;side<2;side++){
        const ray=2*i+side,sign=2*side-1;
        for(let k=0;k<3;k++){pos[8*ray+k]=p[k]+sign*eps*normal[k];pos[8*ray+4+k]=p[k]+sign*lengths[side]*normal[k];}
        edges.set([ray,2*ray,2*ray+1,0],4*ray);
      }
    }
    const tree=segmentBoundsTree(pos,edges),hit=await graphIntersections(device,{pos},tree,capture,2*n);
    let occludedFluidSites=0,occludedGhostSites=0;
    for(let i=0;i<n;i++)for(const d of offsets){
      const side=Number(d>0),fraction=hit.values[2*(2*i+side)];
      const visible=!Number.isFinite(fraction)||Math.abs(d)<eps+fraction*(lengths[side]-eps);
      anchors[i].clear.push(visible);if(!visible){if(side)occludedFluidSites++;else occludedGhostSites++;}
    }
    return {anchors,stats:{seeds:n,rmsShiftM:Math.sqrt(squaredShift/n),maxShiftM,occludedFluidSites,occludedGhostSites,
      ms:performance.now()-started,peakGpuBytes:gpu.allocatedBytes+hit.peakGpuBytes}};
  }finally{gpu.close();}
}
