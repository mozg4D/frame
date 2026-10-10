'use strict';
// One owned test worker; production receives the existing Frame dispatcher.
const {parentPort}=require('worker_threads');
const core=require('../core/mesh-allocation-contract.cjs').createMeshAllocationCore();
parentPort.on('message',({id,input})=>{
 try{parentPort.postMessage({id,result:input.proposal?core.verify(input.mesh,input.proposal,input.job):core.prepare(input.mesh,input.job)});}
 catch(e){parentPort.postMessage({id,error:e.message});}
});
