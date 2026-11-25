import {createNativeRotorFixture} from './native-case.mjs';

// Follow the public CFD Box path. Record the first physical window before
// starting Shape so a stationary, under-resolved zero thrust cannot pass.
async function measure(device,fidelity,windows){
  const {boxHash,motion}=await createNativeRotorFixture(device,true);
  const op=(operation,args={})=>frameAI.call('plugins.command',{id:boxHash,operation,args});
  await op('solve-frame',{fidelityBudget:fidelity,warmStart:false});
  const samples=[],start=performance.now();let last=-1;
  try{for(;;){
    await new Promise(ok=>setTimeout(ok,140));const job=await op('results'),r=job.result;
    if(r?.rotorMetrics&&r.steps>last){
      last=r.steps;const sample={steps:r.steps,windows:r.completeWindows,physicalTimeS:r.physicalTimeS,dtS:r.dtS,cells:r.cells,
        dims:r.dims,minCellWidthM:r.minCellWidthM,CT:r.rotorMetrics.CT,CP:r.rotorMetrics.CP,thrustN:r.forceLocal.drag,
        stationarity:r.validity.stationary,maxDivergencePerS:r.validity.maxDivergencePerS};
      samples.push(sample);console.log('CFD live public blade resolution '+JSON.stringify(sample));
      if(r.completeWindows>=windows){
        return {pass:samples.every(v=>v.maxDivergencePerS<1e-6)&&
          sample.minCellWidthM.every(p=>p<motion.diameterM/12)&&sample.CT>.01&&sample.CP>.002,
          fidelity,rpm:motion.rpm,diameterM:motion.diameterM,samples};
      }
    }
    if(!['queued','solving'].includes(job.state)||performance.now()-start>4*3600000)throw Error('Native shaft solve '+JSON.stringify(job.job));
  }}finally{await op('stop');}
}
export const verifyShaftPreviewResolution=device=>measure(device,'preview',1);
export const verifyShaftStandardResolution=device=>measure(device,'standard',2);
export const verifyShaftPreviewThrust=device=>measure(device,'preview',8);
