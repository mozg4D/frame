'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),{Worker}=require('worker_threads');
const {annulus,annulusPrism}=require('./annulus-fixtures.cjs'),{hash}=require('../core/mesh-section.cjs'),
 {runMeshAllocationWithFrameBudget}=require('../core/frame-budget-adapter.cjs'),
 {createMeshAllocationCore}=require('../core/mesh-allocation-contract.cjs');
const start=performance.now(),core=createMeshAllocationCore(),worker=new Worker(path.resolve(__dirname,'mesh-allocation-worker.cjs')),
 pending=new Map(),rows=[];let checks=0,leases=0,peak=0,id=0,dispatches=0;
worker.on('message',({id,result,error})=>{const p=pending.get(id);if(!p)return;pending.delete(id);p.cleanup();error?p.reject(Error(error)):p.resolve(result);});
worker.on('error',e=>{for(const p of pending.values()){p.cleanup();p.reject(e);}pending.clear();});
const host={frameComputeBudget:{async acquire(kind,signal){assert.equal(kind,'slicer');checks++;if(signal?.aborted)throw Error('cancelled');leases++;peak=Math.max(peak,leases);return()=>leases--;}},
 runSlicerContourJob(job,signal){assert.equal(job.kind,'frame-independent-mesh-allocation');checks++;dispatches++;
  return new Promise((resolve,reject)=>{const key=++id,abort=()=>{pending.delete(key);signal?.removeEventListener('abort',abort);worker.terminate().then(()=>reject(Error('owned worker cancelled')));};
   pending.set(key,{resolve,reject,cleanup:()=>signal?.removeEventListener('abort',abort)});signal?.addEventListener('abort',abort,{once:true});worker.postMessage({id:key,input:job.input});});
 }};
(async()=>{try{
 let base;
 for(const W of [.5,1,2]){
  const mesh=annulusPrism(annulus({W,reversed:W===2}),{shift:[.5*W,0],alternateDiagonal:W===2}),
   before=hash(mesh),job={z:.5,W,count:1,mode:'continuous-annulus'},t=performance.now(),
   proposal=await runMeshAllocationWithFrameBudget({mesh,job},host),prepared=performance.now(),wire=JSON.stringify(proposal),encoded=performance.now(),
   q=await runMeshAllocationWithFrameBudget({mesh,job,proposal:JSON.parse(wire)},host),verified=performance.now(),final=JSON.stringify(q),end=performance.now(),decoded=JSON.parse(final);
  assert.equal(hash(mesh),before);assert.equal(leases,0);assert(q.sourceVerified&&q.sourceFaceAngleBindingCertified&&q.accuracy.accepted);
  assert(q.ownerAccepted&&q.routeAccepted&&q.wholeSourceAllocationCertified&&q.wholeLayerAccuracyCertified&&q.completeOriginalMaterialCoveragePassed);
  assert(q.newGeneratorCommandsSelected&&!q.retainedWorkerFallbackSelected);assert.equal(q.selectedCommands.length,130);
  assert.deepEqual(q.selectedExecution,q.selectedCommands);assert(!q.internalRestartOverlapAuthorized&&!q.physicalPrintValidated);
  // Independent physical Newell-Z sign on FINAL encoded coordinates, not a
  // shared Frame flag or the canonical source/proof bank winding.
  const physicalArea=decoded.selectedExecution.filter(p=>!p.closure).reduce((s,p)=>s+(p.from[0]-p.to[0])*(p.from[1]+p.to[1]),0);
  assert(physicalArea<0);assert(q.physicalDirection.clockwise&&q.physicalDirection.signedTwiceAreaMM2.startsWith('-'));
  assert.deepEqual(decoded.selectedCommands,q.selectedCommands);assert.equal(decoded.selectedCoordinateSpace,'physical-mm-right-handed-XY-Z-up; no axis reflection');
  const boundaries=decoded.availableCandidateAllocation.plan.physicalMaterialBoundaries,
   area=points=>points.map(p=>p.map(s=>{const [n,d]=s.split('/').map(Number);return n/d;})).reduce((s,p,i,all)=>s+(p[0]-all[(i+1)%all.length][0])*(p[1]+all[(i+1)%all.length][1]),0);
  assert(area(boundaries.outerCCW)>0&&area(boundaries.holeCW)<0);checks+=5;
  assert(q.availableCandidateAllocation.internalRestartCount===0&&q.availableCandidateAllocation.independentStartCount===1);
  assert(q.sourceAngleEvidence.length===q.selectedCommands.length);assert(Math.max(...q.sourceAngleEvidence.map(e=>e.sourceAngle))>0);
  const banks=new Set();
  for(const row of q.sourceAngleEvidence){assert(row.ownerVerifiedAgainstTriangles&&row.meshSignature&&row.sourceGeneration===mesh.generation);checks++;
   for(const cell of row.originalIntervals){banks.add(cell.ring);assert(cell.actualTriangleIntervals.length);checks++;
    for(const face of cell.actualTriangleIntervals){assert(Number.isInteger(face.faceId)&&face.exactSectionStart.length===2&&face.exactSectionEnd.length===2);checks++;}
   }
  }
  assert.equal(banks.size,2);checks+=13;
  rows.push({W,reversed:W===2,subdivisions:1,alternateDiagonal:W===2,commands:q.selectedCommands.length,faces:mesh.faces.length,
   actualHelperTransportMS:prepared-t,proposalEncodingMS:encoded-prepared,actualOwnerTransportMS:verified-encoded,finalEncodingMS:end-verified,
   completeMeshHelperJSONOwnerEncodingMS:end-t,constructionBoundW:q.accuracy.totalUpperBoundMM/W,
   originalMaterialBoundW:q.availableCandidateAllocation.geometry.coverage.upperBoundMM/W,
   seamChargeW2:q.availableCandidateAllocation.geometry.charge.chargeUpperBoundMM2/(W*W),fullLayerAccepted:true});
  rows.at(-1).finalEncodedPhysicalNewellZ=physicalArea;
  rows.at(-1).grossGeometricPairOverlapW2=q.availableCandidateAllocation.geometry.overlapAccounting.grossAllFinalPairOverlapUpperMM2/(W*W);
  rows.at(-1).prescribedNominalPairOverlapW2=q.availableCandidateAllocation.geometry.overlapAccounting.prescribedNominalPairOverlapUpperMM2/(W*W);
  if(W===1)base={mesh,job,proposal};
 }
 const clone=()=>JSON.parse(JSON.stringify(base.proposal)),mutations=[
  p=>p.allocation.plan.requiredCells.shift(),p=>p.allocation.plan.exactInner[0][0]='0/1',
  p=>p.allocation.geometry.coverage.rows=[],p=>p.allocation.plan.widthNecessity.verified=false,
  p=>p.allocation.commands[0].widthStart+=.01,p=>p.allocation.commands.reverse(),
  p=>{const cell=p.allocation.commands[0].sourceIntervals[0];cell.exactU0=cell.exactU0==='0/1'?'1/1':'0/1';},p=>p.allocation.commands.pop(),
  p=>p.allocation.internalRestartCount=1,p=>p.allocation.geometry.charge.passed=false,
  p=>p.section.edgeFaces[0][0][0].sourceAngle+=1,p=>p.kernelRevision='stale',
  p=>p.sourceGeneration+=1,p=>p.job.count=2
 ];
 mutations.push(p=>p.allocation.physicalDirection.signedTwiceAreaMM2=p.allocation.physicalDirection.signedTwiceAreaMM2.replace('-',''));
 for(const mutate of mutations){const forged=clone();mutate(forged);assert.notEqual(hash(forged),hash(base.proposal),'forgery control must change actual packet');assert.throws(()=>core.verify(base.mesh,forged,base.job));checks+=2;}
 assert.throws(()=>core.verify(base.mesh,base.proposal,{...base.job,W:2}));checks++;
 const retessellated=annulusPrism(annulus(),{shift:[.5,0],alternateDiagonal:true});
 assert.throws(()=>core.verify(retessellated,base.proposal,base.job));checks++;
 const coarse=core.slice(annulusPrism(annulus({facets:16})),base.job);
 assert(!coarse.ownerAccepted&&!coarse.routeAccepted);assert.equal(coarse.selectedCommands.length,0);checks+=2;
 const unpaired=annulus();unpaired[1][7][0]+=1e-5;
 const bad=core.slice(annulusPrism(unpaired),base.job);assert(!bad.ownerAccepted);assert.equal(bad.selectedCommands.length,0);checks+=2;
 const overBudget=core.slice(annulusPrism(annulus({subdivisions:2})),base.job);
 assert(!overBudget.ownerAccepted);assert.equal(overBudget.selectedCommands.length,0);
 assert(overBudget.availableCandidateAllocation.reasons.some(s=>s.includes('qualified exact')));checks+=3;
 const forged=clone();forged.allocation.commands.pop();await assert.rejects(runMeshAllocationWithFrameBudget({...base,proposal:forged},host));assert.equal(leases,0);checks+=2;
 await assert.rejects(runMeshAllocationWithFrameBudget({mesh:base.mesh,job:base.job},host,{aborted:true}),/cancelled/);assert.equal(leases,0);checks+=2;
 const abort=new AbortController(),cancelled=runMeshAllocationWithFrameBudget({mesh:base.mesh,job:base.job},host,abort.signal);
 await new Promise(r=>setImmediate(r));abort.abort();await assert.rejects(cancelled,/owned worker cancelled/);
 assert.equal(leases,0);assert.equal(pending.size,0);checks+=3;
 const receipt={status:'PASS',checks,kernelRevision:core.kernelRevision,rows,totalMS:performance.now()-start,forgedControls:mutations.length+2,
  fullLayersAccepted:rows.length,spiralsAccepted:0,privateGeometryIncluded:false,testWorkersCreated:1,productionCreatesPool:false,
  dispatches,peakSharedLeases:peak,finalSharedLeases:leases,ownedWorkerCancelled:true,nativeUIIncluded:false,heavyBaselineRun:false};
 fs.writeFileSync('evidence/annulus-mesh-light.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
}finally{await worker.terminate();}})().catch(e=>{console.error(e);process.exitCode=1;});
