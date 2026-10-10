'use strict';
// Matches r226 host.frameComputeBudget.acquire('slicer',signal).
// Dispatch belongs to the host's existing worker service; this module owns no pool.
async function runContoursWithFrameBudget(input,host,signal){if(!host?.frameComputeBudget||typeof host.frameComputeBudget.acquire!=='function'||typeof host.runSlicerContourJob!=='function')throw Error('existing Frame budget and worker dispatcher required');if(signal?.aborted)throw Object.assign(Error('slice cancelled'),{code:'FRAME_SLICE_CANCELLED'});const release=await host.frameComputeBudget.acquire('slicer',signal);try{if(signal?.aborted)throw Object.assign(Error('slice cancelled'),{code:'FRAME_SLICE_CANCELLED'});return await host.runSlicerContourJob({kind:'frame-independent-contours',input:structuredClone(input)},signal);}finally{release();}}
async function runMeshRouteWithFrameBudget(input,host,signal){
 if(!host?.frameComputeBudget||typeof host.frameComputeBudget.acquire!=='function'||typeof host.runSlicerContourJob!=='function')throw Error('existing Frame budget and worker dispatcher required');
 if(signal?.aborted)throw Object.assign(Error('mesh route cancelled'),{code:'FRAME_SLICE_CANCELLED'});
 const release=await host.frameComputeBudget.acquire('slicer',signal);
 try{
  if(signal?.aborted)throw Object.assign(Error('mesh route cancelled'),{code:'FRAME_SLICE_CANCELLED'});
  return await host.runSlicerContourJob({kind:'frame-independent-mesh-route',input:structuredClone(input)},signal);
 }finally{release();}
}
async function runMeshAllocationWithFrameBudget(input,host,signal){
 if(!host?.frameComputeBudget||typeof host.frameComputeBudget.acquire!=='function'||typeof host.runSlicerContourJob!=='function')throw Error('existing Frame budget and worker dispatcher required');
 if(signal?.aborted)throw Object.assign(Error('mesh allocation cancelled'),{code:'FRAME_SLICE_CANCELLED'});
 const release=await host.frameComputeBudget.acquire('slicer',signal);
 try{
  if(signal?.aborted)throw Object.assign(Error('mesh allocation cancelled'),{code:'FRAME_SLICE_CANCELLED'});
  return await host.runSlicerContourJob({kind:'frame-independent-mesh-allocation',input:structuredClone(input)},signal);
 }finally{release();}
}
module.exports={runContoursWithFrameBudget,runMeshRouteWithFrameBudget,runMeshAllocationWithFrameBudget};
