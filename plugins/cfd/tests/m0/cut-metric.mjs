import {cutMetricWGSL} from '../../plugin.js';
export {cutMetricWGSL,cutGridWGSL,cutFaceSeal} from '../../plugin.js';

import {gpuScope} from './gpu.mjs';

// Exact measure of the halfspace n.x >= t in the unit hypercube. This
// inclusion-exclusion integral is independent of the GPU tetrahedra.
export function halfspace(n,t){
  for(const a of n)if(a<0)t-=a;
  const axes=n.map(Math.abs).filter(x=>x>0);
  if(!axes.length)return Number(t<0);
  if(t<=0)return 1;if(t>=axes.reduce((a,b)=>a+b,0))return 0;
  let sum=0;
  for(let bits=0;bits<1<<axes.length;bits++){
    let x=t,sign=1;
    axes.forEach((a,k)=>{if(bits&(1<<k)){x-=a;sign=-sign;}});
    sum+=sign*Math.max(x,0)**axes.length;
  }
  return 1-sum/(axes.reduce((a,b)=>a*b,1)*[1,1,2,6][axes.length]);
}

// Independent polygon clipping and shoelace first moments on a square.
export function squareMoment(a,b,t){
  const corners=[[0,0],[1,0],[1,1],[0,1]],polygon=[];
  for(let k=0;k<4;k++){
    const p=corners[k],q=corners[(k+1)%4],l=a*p[0]+b*p[1]-t,r=a*q[0]+b*q[1]-t;
    if(l>0)polygon.push(p);
    if((l>0)!==(r>0)){const u=l/(l-r);polygon.push(p.map((v,i)=>v+u*(q[i]-v)));}
  }
  let area=0,x=0,y=0;
  for(let k=0;k<polygon.length;k++){
    const p=polygon[k],q=polygon[(k+1)%polygon.length],cross=p[0]*q[1]-p[1]*q[0];
    area+=cross/2;x+=(p[0]+q[0])*cross/6;y+=(p[1]+q[1])*cross/6;
  }return [x-area/2,y-area/2];
}

export async function verifyCutMetric(device){
  const gpu=gpuScope(device),cases=[];
  for(const normal of [[1,0,0],[0,-1,0],[.3,.7,0],[.1,-.4,.8],[-.7,.55,.3],[.6,.6,.6]]){
    for(const offset of [-.0001,0,.0001,.07,.25,.43,.5,.71,.93,.9999,1,1.0001]){
      const lo=normal.reduce((s,a)=>s+Math.min(0,a),0),span=normal.reduce((s,a)=>s+Math.abs(a),0);
      const t=lo+offset*span;
      const corners=Array.from({length:8},(_,i)=>normal.reduce((v,a,k)=>v+((i>>k)&1)*a,-t));
      const faces=normal.map((a,k)=>halfspace(normal.filter((_,j)=>k!==j),t-a));
      const moment=normal.flatMap((a,k)=>squareMoment(normal[(k+1)%3],normal[(k+2)%3],t-a));
      cases.push({corners,expected:[...faces,halfspace(normal,t)],moment});
    }
  }
  try{
    const input=gpu.buffer('CFD inclined plane samples',Float32Array.from(cases.flatMap(c=>c.corners)));
    const output=gpu.buffer('CFD clipped Cartesian reference',16*cases.length);
    const moments=gpu.buffer('CFD clipped face moments',24*cases.length);
    const pipe=await gpu.kernel('CFD inclined volume and face apertures',cutMetricWGSL+`
      @group(0) @binding(0) var<storage,read> src:array<array<f32,8>>;
      @group(0) @binding(1) var<storage,read_write> dst:array<vec4f>;
      @group(0) @binding(2) var<storage,read_write> moments:array<FaceCenters>;
      @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){
        if(id.x<arrayLength(&dst)){let q=src[id.x];let m=cutMetric(q);dst[id.x]=m;moments[id.x]=cutFaceCenters(q,m);}}`);
    gpu.run(pipe,[input,output,moments],[Math.ceil(cases.length/64)]);
    const stage=gpu.staging('CFD planar clipping check',moments.size);
    const measured=await gpu.read(output,stage,4*cases.length),positions=await gpu.read(moments,stage,6*cases.length);
    let maxVolumeError=0,maxFaceError=0,maxFirstMomentError=0;
    for(const [i,c] of cases.entries()){
      for(let k=0;k<3;k++)maxFaceError=Math.max(maxFaceError,Math.abs(c.expected[k]-measured[4*i+k]));
      maxVolumeError=Math.max(maxVolumeError,Math.abs(c.expected[3]-measured[4*i+3]));
      for(let j=0;j<6;j++)maxFirstMomentError=Math.max(maxFirstMomentError,Math.abs(c.moment[j]-positions[6*i+j]*measured[4*i+(j>>1)]));
    }
    return {planes:cases.length,maxVolumeError,maxFaceError,maxFirstMomentError,pass:Math.max(maxVolumeError,maxFaceError,maxFirstMomentError)<2e-6};
  }finally{gpu.close();}
}
