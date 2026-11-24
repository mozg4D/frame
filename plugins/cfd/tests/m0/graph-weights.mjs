import {gpuScope} from './gpu.mjs';
import {pressureHierarchy} from './graph-build.mjs';

// Topology remains distinct from the metric. Each incident cell references
// the same physical face with opposite sign. A cut edge may have two wall
// incidences; its normal permeability is zero on both sides.
export function faceOwners(graph,count){
  const owners=new Uint32Array(2*count),assigned=new Uint8Array(count);
  for(let i=0;i+1<graph.offset.length;i++)for(let e=graph.offset[i];e<graph.offset[i+1];e++){
    const id=graph.linkFace[e];
    if(id<0)continue;
    if(assigned[id])throw Error('Face has multiple positive incidences');
    assigned[id]=1;owners[2*id]=i;owners[2*id+1]=graph.nbr[e]|(graph.kind[e]<<28);
  }
  if(assigned.includes(0))throw Error('Face lacks a positive incidence');
  return owners;
}

// The worker supplies the clipped Voronoi polygons. Integrate each polygon
// once on the GPU and scatter the identical coefficient to both directed slots.
export async function graphWeights(device,f,g){
  const gpu=gpuScope(device),start=performance.now();
  try{
    const faces=g.faces,faceCount=faces.planes.length/4,links=g.nbr.length,n=g.offset.length-1;
    const raw=gpu.buffer('CFD Voronoi vertices',faces.corners),startAt=gpu.buffer('CFD polygon starts',faces.starts);
    const plane=gpu.buffer('CFD bisector planes',faces.planes),canonical=gpu.buffer('CFD unique face integrals',16*faceCount);
    const remap=gpu.buffer('CFD oriented face IDs',g.linkFace),out=gpu.buffer('CFD directed weights',16*links);
    const area=await gpu.kernel('CFD Voronoi polygon integration',`
      @group(0) @binding(0) var<storage,read> v:array<vec4f>;@group(0) @binding(1) var<storage,read> start:array<u32>;
      @group(0) @binding(2) var<storage,read> planes:array<vec4f>;@group(0) @binding(3) var<storage,read_write> face:array<vec4f>;
      @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){let i=g.x;if(i>=arrayLength(&face)){return;}
        let base=v[start[i]].xyz;let p=planes[i];var s=0.;
        for(var j=start[i]+1u;j+1u<start[i+1u];j++){s+=abs(dot(cross(v[j].xyz-base,v[j+1u].xyz-base),p.xyz));}
        let a=0.5*s;face[i]=vec4f(a*p.xyz,a/p.w);}`);
    const scatter=await gpu.kernel('CFD reciprocal face weights',`
      @group(0) @binding(0) var<storage,read> ids:array<i32>;@group(0) @binding(1) var<storage,read> face:array<vec4f>;
      @group(0) @binding(2) var<storage,read_write> out:array<vec4f>;
      @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){let i=g.x;if(i>=arrayLength(&out)){return;}
        let id=ids[i];let f=face[u32(select(id,~id,id<0))];out[i]=vec4f(select(f.xyz,-f.xyz,id<0),f.w);}`);
    gpu.run(area,[raw,startAt,plane,canonical],[Math.ceil(faceCount/128)]);
    gpu.run(scatter,[remap,canonical,out],[Math.ceil(links/128)]);
    const stage=gpu.staging('CFD M0 topology transfer',out.size);
    const coeff=await gpu.read(out,stage,links*4);
    g.faceCoeff=await gpu.read(canonical,stage,faceCount*4);
    g.owners=faceOwners(g,faceCount);
    const offset=new Uint32Array(n+1),nbr=[],conductances=[],diag=new Float32Array(n),boundary=new Float64Array(n);
    let maxClosure=0,maxVolumeDifference=0,minC=Infinity;
    for(let i=0;i<n;i++){
      const sum=[0,0,0];let surface=0,volume=0,d=0;
      for(let e=g.offset[i];e<g.offset[i+1];e++){
        const k=g.kind[e],c=coeff[4*e+3],a=Math.hypot(coeff[4*e],coeff[4*e+1],coeff[4*e+2]);
        // Float32 can collapse a tiny clipped polygon. Its contribution to
        // closure is checked below; a zero area carries zero flux.
        if(!(c>=0)||!Number.isFinite(c))throw Error('Invalid GPU face conductance');
        minC=Math.min(minC,c);if(c===0)continue;
        for(let j=0;j<3;j++)sum[j]+=coeff[4*e+j];
        volume+=a*a/c*(k===0?1/6:1/3);surface+=a;
        if(k===0){nbr.push(g.nbr[e]);conductances.push(c);d+=c;}
        else if(k<=6&&k!==1&&!(k===3&&f.name==='ahmed')){boundary[i]+=c;d+=c;}
      }
      maxClosure=Math.max(maxClosure,Math.hypot(...sum)/surface);
      maxVolumeDifference=Math.max(maxVolumeDifference,Math.abs(volume/g.pos[4*i+3]-1));
      offset[i+1]=nbr.length;diag[i]=d;g.pos[4*i+3]=volume;
    }
    if(g.gauges!==0)throw Error('This exterior pressure benchmark requires an open reference in each component');
    if(!(maxClosure<3e-6&&maxVolumeDifference<2e-5))throw Error('GPU face integration failed closure/volume certification');
    g.levels=pressureHierarchy({offset,nbr:Uint32Array.from(nbr),c:Float32Array.from(conductances),diag,boundary});
    g.coeff=coeff;g.faces=null;
    return {uniqueFaces:faceCount,minC,maxClosure,maxVolumeDifference,ms:performance.now()-start,peakGpuBytes:gpu.allocatedBytes};
  }finally{gpu.close();}
}
