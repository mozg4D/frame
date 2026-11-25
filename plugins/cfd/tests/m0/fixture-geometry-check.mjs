import {gpuScope} from './gpu.mjs';
import {flowFixture,geometryKernel} from './fixtures.mjs';
import {bladeStation,rotorParts,rotorTable,rotorDistanceWGSL} from './rotor.mjs';

// Intersect the actual polygon blade with a line parallel to the shaft.
// The signed-distance shader and this barycentric calculation share no
// inside/outside or profile interpolation implementation.
function axialHits(mesh,y,z){
  const p=mesh.vertices,t=mesh.indices,hits=[];
  for(let k=0;k<t.length;k+=3){
    const a=3*t[k],b=3*t[k+1],c=3*t[k+2];
    const by=p[b+1]-p[a+1],bz=p[b+2]-p[a+2],cy=p[c+1]-p[a+1],cz=p[c+2]-p[a+2];
    const det=by*cz-bz*cy;if(Math.abs(det)<1e-17)continue;
    const dy=y-p[a+1],dz=z-p[a+2],u=(dy*cz-dz*cy)/det,v=(by*dz-bz*dy)/det;
    if(u>=0&&v>=0&&u+v<=1)hits.push(p[a]+u*(p[b]-p[a])+v*(p[c]-p[a]));
  }
  hits.sort((a,b)=>a-b);return hits.filter((x,i)=>!i||x-hits[i-1]>1e-8);
}

export async function verifyFixtureGeometry(device){
  const gpu=gpuScope(device);
  try{
    const mesh=rotorParts(true)[1],probes=[];
    for(const r of [.154,.317,.548,.751,.953,.984,.997])for(const chord of [.27,.61]){
      const s=bladeStation(r,true),z=s.sweep-s.chord*chord*Math.cos(s.twist);
      const cap=Math.sqrt(.127**2-z**2),y=r>.95?.95*.127+(r-.95)/.05*(cap-.95*.127):r*.127;
      const cuts=axialHits(mesh,y,z);if(cuts.length!==2)throw Error('Expected two axial intersections with the measured blade');
      const [a,b]=cuts,w=b-a;
      for(const u of [-.2,.25,.75,1.2])probes.push([a+u*w,y,z,u>0&&u<1?-1:1]);
    }
    const pipe=await gpu.kernel('CFD measured blade sign comparison',rotorDistanceWGSL(true)+`
      @group(0) @binding(0) var<storage,read> probes:array<vec4f>;@group(0) @binding(1) var<storage,read_write> d:array<f32>;
      @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) gid:vec3u){if(gid.x<arrayLength(&d)){
        d[gid.x]=distanceToBody(probes[gid.x].xyz,vec2f(1,0));}}`);
    const p=gpu.buffer('CFD measured blade probes',Float32Array.from(probes.flat())),d=gpu.buffer('CFD measured blade signs',4*probes.length);
    const table=gpu.buffer('CFD measured blade section samples',rotorTable(true));
    const bindings=device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[[0,p],[1,d],[3,table]].map(([binding,buffer])=>({binding,resource:{buffer}}))});
    const encoder=device.createCommandEncoder();gpu.dispatch(encoder,pipe,bindings,[Math.ceil(probes.length/64)]);device.queue.submit([encoder.finish()]);
    const values=await gpu.read(d,gpu.staging('CFD measured blade signs readback',d.size),probes.length);
    const signErrors=probes.filter((v,i)=>Math.sign(values[i])!==v[3]).length;
    let maxMountDistanceErrorM=0,bodyOnlySolidSamples=0;
    for(const name of ['ahmed','ahmed-wake'])for(const x of [.202,.672])for(const z of [-.1635,.1635]){
      const h=.004,n=8**3,origin=[x-.016,.025-.016,z-.016],f={...flowFixture(name,1),h,origin,dims:[8,8,8]};
      const geom=await geometryKernel(gpu,f,0,false);geom.update(0);
      const wall=await gpu.read(geom.wall,gpu.staging('CFD support distances',16*n),4*n);
      for(let i=0;i<n;i++){
        const a=((i%8)+.5)*h-.016,b=((i>>3)%8+.5)*h-.016,c=((i>>6)+.5)*h-.016;
        const body=.025-b,radial=Math.hypot(a,c)-.015,cap=Math.abs(b)-.025;
        const expected=Math.min(body,Math.max(radial,cap));
        if(name==='ahmed'){if(wall[4*i]<=0)bodyOnlySolidSamples++;}
        else maxMountDistanceErrorM=Math.max(maxMountDistanceErrorM,Math.abs(h*wall[4*i]-expected));
      }
    }
    return {bladeProbes:probes.length,signErrors,bodyOnlySolidSamples,maxMountDistanceErrorM,
      pass:signErrors===0&&bodyOnlySolidSamples===0&&maxMountDistanceErrorM<2e-7};
  }finally{gpu.close();}
}
