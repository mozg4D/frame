import {rotatingLoads} from '../../plugin.js';
export {rotatingLoads} from '../../plugin.js';

import {gpuScope} from './gpu.mjs';

export async function verifyRotatingLoads(device){
  const gpu=gpuScope(device);
  try{return await check(gpu);}finally{gpu.close();}
}

async function check(gpu){
  const load=gpu.buffer('CFD manufactured transverse forces',16),acc=await rotatingLoads(gpu,load);
  const expected=[4,1,2,-3],N=37;
  for(let i=0;i<N;i++){
    const theta=-2*Math.PI*(i+.5)/N,c=Math.cos(theta),s=Math.sin(theta);
    // Constant [2,-3] in the box and [4,1] in the rotating basis.
    const y=2*c-3*s+4,z=-2*s-3*c+1;
    gpu.device.queue.writeBuffer(load,0,new Float32Array([7,-9,y,z]));acc.angle(theta);
    const e=gpu.device.createCommandEncoder();acc.encode(e);gpu.device.queue.submit([e.finish()]);
  }
  const stage=gpu.staging('CFD manufactured frame impulse',16);
  const mean=Array.from(await gpu.read(acc.sums,stage,4),x=>x/N),unconsumed=await gpu.read(load,stage,4);
  const maxError=Math.max(...mean.map((x,i)=>Math.abs(x-expected[i])));
  return {mean,maxError,pass:maxError<2e-6&&unconsumed[0]===7&&unconsumed[1]===-9&&unconsumed[2]===0&&unconsumed[3]===0};
}
