import {separablePressure} from '../../plugin.js';
export {pressureAxis,separablePressure} from '../../plugin.js';

import {gpuScope} from './gpu.mjs';

// Form b with an independent face loop. Both the reconstruction and its
// residual are checked on a graded box with mixed pressure reservoirs.
export async function verifySeparablePressure(device){
  const gpu=gpuScope(device),dims=[24,16,8],strides=[1,24,384],n=3072;
  const widths=dims.map((d,k)=>Array.from({length:d},(_,i)=>.7+(k+.5)*(i+.5)/d));
  const open=[true,false,false,false,true,true];
  const exact=Float32Array.from({length:n},(_,i)=>Math.sin(.13*(i%24))+.3*Math.cos(.21*Math.floor(i/24))+.05*((i*37)%17));
  function apply(p){
    const b=new Float64Array(n);
    for(let i=0;i<n;i++){const xyz=[i%24,Math.floor(i/24)%16,Math.floor(i/384)],w=xyz.map((v,k)=>widths[k][v]);
      for(let k=0;k<3;k++){const j=xyz[k],area=w[(k+1)%3]*w[(k+2)%3];
        if(j===0&&open[2*k])b[i]+=2*area*p[i]/w[k];
        if(j+1===dims[k]){if(open[2*k+1])b[i]+=2*area*p[i]/w[k];}
        else{const next=i+strides[k],q=2*area*(p[i]-p[next])/(w[k]+widths[k][j+1]);b[i]+=q;b[next]-=q;}
      }
    }return b;
  }
  try{
    const b=Float32Array.from(apply(exact)),rhs=gpu.buffer('CFD manufactured regular RHS',b),out=gpu.buffer('CFD manufactured regular solution',4*n);
    const inverse=await separablePressure(gpu,dims,widths,open),encode=inverse.binding(rhs,out),e=device.createCommandEncoder();
    encode(e);device.queue.submit([e.finish()]);const solution=await gpu.read(out,gpu.staging('CFD exact pressure readback',4*n),n);
    const residual=apply(solution);let error2=0,res2=0,ref2=0,b2=0;
    for(let i=0;i<n;i++){error2+=(solution[i]-exact[i])**2;ref2+=exact[i]**2;res2+=(residual[i]-b[i])**2;b2+=b[i]**2;}
    const relativeError=Math.sqrt(error2/ref2),relativeResidual=Math.sqrt(res2/b2);
    return {dims,relativeError,relativeResidual,pass:relativeError<5e-5&&relativeResidual<5e-5};
  }finally{gpu.close();}
}
