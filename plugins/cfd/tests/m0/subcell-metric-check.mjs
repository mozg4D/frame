import {gpuScope} from './gpu.mjs';
import {gridWGSL} from './fixtures.mjs';
import {metricWGSL} from './rectilinear.mjs';
import {cutGridWGSL,cutMetricWGSL,halfspace,squareMoment} from './cut-metric.mjs';
import {subcellMetricWGSL} from './subcell-metric.mjs';

export async function verifySubcellSurface(device){
  const gpu=gpuScope(device),f={dims:[1,1,1],h:1};
  try{
    const out=gpu.buffer('CFD subcell clipping certificate',3*12*4);
    const pipe=await gpu.kernel('CFD subcell slab and oblique plane integration',gridWGSL(f)+metricWGSL(f)+cutMetricWGSL+`
      var<private> mode:u32;
      fn surfaceDistance(p:vec3f)->f32{
        if(mode==0u){return abs(p.y-.5)-.08;}if(mode==1u){return abs(p.y-.25)-.055;}
        return dot(vec3f(.31,.93,-.67),p)-.32;
      }`+cutGridWGSL+subcellMetricWGSL+`
      @group(0) @binding(0) var<storage,read_write> out:array<f32>;
      @compute @workgroup_size(1) fn main(@builtin(global_invocation_id) g:vec3u){
        mode=g.x;let i=12u*mode;let q=subcellCut(vec3i(0));
        for(var a=0u;a<3u;a++){out[i+a]=q.metric[a];out[i+4u+2u*a]=q.centers.t[a].x;out[i+5u+2u*a]=q.centers.t[a].y;}
        out[i+3u]=q.metric.w;out[i+10u]=surfaceDistance(q.representative.xyz);out[i+11u]=q.representative.w;
      }`);
    gpu.run(pipe,[out],[3]);const data=await gpu.read(out,gpu.staging('CFD subcell certificate samples',out.size),36);
    let maxMeasureError=0,maxMomentError=0;
    const normal=[.31,.93,-.67],thickness=[.16,.11],offset=[.5,.25];
    for(let i=0;i<3;i++){
      const volume=i<2?1-thickness[i]:halfspace(normal,.32);maxMeasureError=Math.max(maxMeasureError,Math.abs(data[12*i+3]-volume));
      for(let a=0;a<3;a++){
        const b=(a+1)%3,c=(a+2)%3,area=i<2?(a===1?1:volume):halfspace([normal[b],normal[c]],.32-normal[a]);
        const target=i<2?[b,c].map(k=>k===1?thickness[i]*(.5-offset[i]):0):squareMoment(normal[b],normal[c],.32-normal[a]);
        maxMeasureError=Math.max(maxMeasureError,Math.abs(data[12*i+a]-area));
        for(let k=0;k<2;k++)maxMomentError=Math.max(maxMomentError,Math.abs(data[12*i+a]*data[12*i+4+2*a+k]-target[k]));
      }
    }
    const fluidRepresentatives=[0,1,2].every(i=>data[12*i+10]>0&&data[12*i+11]===1);
    return {maxMeasureError,maxMomentError,fluidRepresentatives,pass:fluidRepresentatives&&Math.max(maxMeasureError,maxMomentError)<2e-6};
  }finally{gpu.close();}
}
