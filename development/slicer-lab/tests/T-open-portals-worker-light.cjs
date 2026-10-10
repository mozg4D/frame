'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),{Worker}=require('worker_threads');
const {prism}=require('./mesh-fixtures.cjs'),{hash}=require('../core/mesh-section.cjs'),{runMeshAllocationWithFrameBudget}=require('../core/frame-budget-adapter.cjs');
const worker=new Worker(path.resolve(__dirname,'mesh-allocation-worker.cjs')),pending=new Map(),start=performance.now(),rows=[];
let checks=0,leases=0,peak=0,id=0,dispatches=0,kernel;
worker.on('message',({id,result,error})=>{const p=pending.get(id);if(!p)return;pending.delete(id);p.cleanup();error?p.reject(Error(error)):p.resolve(result);});
worker.on('error',e=>{for(const p of pending.values()){p.cleanup();p.reject(e);}pending.clear();});
const host={frameComputeBudget:{async acquire(kind,signal){assert.equal(kind,'slicer');checks++;if(signal?.aborted)throw Error('cancelled');leases++;peak=Math.max(peak,leases);return()=>leases--;}},
 runSlicerContourJob(job,signal){assert.equal(job.kind,'frame-independent-mesh-allocation');checks++;dispatches++;
  return new Promise((resolve,reject)=>{const key=++id,abort=()=>{pending.delete(key);signal?.removeEventListener('abort',abort);worker.terminate().then(()=>reject(Error('owned worker cancelled')));};
   pending.set(key,{resolve,reject,cleanup:()=>signal?.removeEventListener('abort',abort)});signal?.addEventListener('abort',abort,{once:true});worker.postMessage({id:key,input:job.input});});
 }};
(async()=>{try{
 const source=[[0,0],[30,0],[30,7],[19,7],[19,24],[12,24],[12,7],[0,7]],mesh=prism(source),before=hash(mesh);
 for(const [mode,count,D]of [['T-terminal-portals-diagnostic',15,'1/2'],['T-branch-portals-diagnostic',16,'1/2'],['T-combined-portals-diagnostic',17,'1/1']]){
  const job={z:.5,W:1,count:7,mode},t=performance.now(),proposal=await runMeshAllocationWithFrameBudget({mesh,job},host),prepared=performance.now(),
   wire=JSON.stringify(proposal),encoded=performance.now(),q=await runMeshAllocationWithFrameBudget({mesh,job,proposal:JSON.parse(wire)},host),
   verified=performance.now(),final=JSON.parse(JSON.stringify(q)),end=performance.now(),a=final.availableCandidateAllocation;
  kernel=final.kernelRevision;assert.equal(hash(mesh),before);assert.equal(leases,0);assert(q.sourceVerified&&q.sourceFaceAngleBindingCertified);
  assert(!final.ownerAccepted&&!final.routeAccepted&&!final.wholeSourceAllocationCertified&&!final.accuracy.accepted);
  assert.equal(final.selectedCommands.length,0);assert.equal(final.selectedExecution.length,0);assert.equal(a.commands.length,count);
  assert(a.originalBodyTargetPreserved&&a.candidateTargetEqualsActual&&a.wholeNozzleAndFeedContained&&a.outsideInDepthOrderCertified);
  assert(a.rulePrescribedCornerTargetResolved&&a.roundedMaterial.positivePrescribedMaterialMissingProved);
  assert(!a.internalRestartOverlapAuthorized&&!a.closedPhysicalClockwiseRouteCertified);assert.equal(a.multiplicity.commandedDuplicateAreaExactMM2,D);
  assert.equal(a.plan.fixedPlacementNecessaryChargeExactMM2,D);checks+=12;
  for(const row of final.sourceAngleEvidence){assert.equal(row.sourceGeneration,mesh.generation);assert(row.originalIntervals.every(v=>v.actualTriangleIntervals.length>0));checks+=2;}
  rows.push({mode,commands:count,actualHelperTransportMS:prepared-t,proposalEncodingMS:encoded-prepared,actualOwnerTransportMS:verified-encoded,finalEncodingMS:end-verified,
   completeMeshHelperJSONOwnerEncodingMS:end-t,commandedDuplicateAreaExactMM2:D,sourceTriangleBoundCommands:final.sourceAngleEvidence.length,
   couponPassed:a.couponGeometryAndJointPassed,ownerAccepted:false});
 }
 const controller=new AbortController(),p=runMeshAllocationWithFrameBudget({mesh,job:{z:.5,W:1,count:7,mode:'T-terminal-portals-diagnostic'}},host,controller.signal);
 queueMicrotask(()=>controller.abort());await assert.rejects(p,/owned worker cancelled/);checks++;
 assert.equal(leases,0);assert.equal(pending.size,0);checks+=2;
 const result={status:'PASS',checks,kernelRevision:kernel,rows,dispatches,testWorkersCreated:1,productionCreatesPool:false,peakSharedLeases:peak,
  finalSharedLeases:leases,ownedWorkerCancelled:true,wholeTLayersSelected:0,nativeUIIncluded:false,totalMS:performance.now()-start};
 fs.writeFileSync('evidence/T-open-portals-worker-light.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await worker.terminate();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
