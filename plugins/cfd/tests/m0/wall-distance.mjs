import {extendWallDistance,cellCenter,gradedAxis} from '../../plugin.js';
export {extendWallDistance} from '../../plugin.js';

import {gpuScope} from './gpu.mjs';


export async function verifyWallDistance(device){
  const gpu=gpuScope(device);
  try{
    const axes=[0,1,2].map(()=>gradedAxis(-1,1,-.35,.35,.044));
    const f={dims:axes.map(a=>a.length-1),origin:[-1,-1,-1],axes,h:.044};
    const n=f.dims.reduce((a,b)=>a*b),data=new Float32Array(4*n),exact=new Float64Array(n),band=.15/f.h;
    const [nx,ny]=f.dims,center=[.017,-.023,.033],radius=.29;
    for(let i=0;i<n;i++){
      const id=[i%nx,Math.floor(i/nx)%ny,Math.floor(i/(nx*ny))];
      exact[i]=(Math.hypot(...id.map((j,a)=>cellCenter(f,a,j)-center[a]))-radius)/f.h;
      data[4*i]=Math.max(-band,Math.min(band,exact[i]));data[4*i+1]=.3;data[4*i+2]=-.4;data[4*i+3]=.81;
    }
    const wall=gpu.buffer('CFD clipped exact sphere distances',data);
    const result=await extendWallDistance(gpu,f,wall,band);
    const values=await gpu.read(wall,gpu.staging('CFD analytic wake distances',data.byteLength),data.length);
    let maxErrorM=0,rms=0,count=0,pins=true,components=true;
    for(let i=0;i<n;i++){
      if(data[4*i]<=.65*band)pins&&=values[4*i]===data[4*i];
      if(exact[i]>band){const error=Math.abs(values[4*i]-exact[i])*f.h;
        maxErrorM=Math.max(maxErrorM,error);rms+=error**2;count++;}
      for(let k=1;k<4;k++)components&&=values[4*i+k]===data[4*i+k];
    }
    return {...result,samples:count,maxErrorM,rmsErrorM:Math.sqrt(rms/count),pinnedSamplesExact:pins,wallDataPreserved:components,
      pass:count>1000&&pins&&components&&maxErrorM<.15*f.h};
  }finally{gpu.close();}
}
