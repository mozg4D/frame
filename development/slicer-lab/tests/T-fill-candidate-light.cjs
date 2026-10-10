'use strict';
const assert=require('assert/strict'),fs=require('fs'),R=require('../core/rational.cjs');
const {createTBodyCandidateCore}=require('../core/T-fill-candidate.cjs'),{createMeshAllocationCore}=require('../core/mesh-allocation-contract.cjs');
const {prism}=require('./mesh-fixtures.cjs'),{hash}=require('../core/mesh-section.cjs');
const {createRouteGenerator}=require('../core/route-generator.cjs'),{originalMaterialDifference}=require('../core/deposition-multiplicity.cjs'),{load}=require('../core/adapter.cjs');
const start=performance.now(),g=createTBodyCandidateCore(),owner=createMeshAllocationCore(),base=[[0,0],[30,0],[30,7],[19,7],[19,24],[12,24],[12,7],[0,7]],rows=[];let checks=0;
function source({W=1,reverse=false,turn=0,tess=1}={}){const ring=base.flatMap((a,i)=>Array.from({length:tess},(_,j)=>a.map((v,k)=>v+(base[(i+1)%base.length][k]-v)*j/tess)))
 .map(p=>{let[x,y]=p;for(let k=0;k<turn;k++)[x,y]=[-y,x];return[x*W+8*W,y*W-4*W];});if(reverse)ring.reverse();return ring;}
for(const W of [.5,1,2])for(const variant of [{},{reverse:true,turn:1,tess:2}])for(const caps of [false,true]){
 const s=source({W,...variant}),before=hash(s),q=g.generate({source:s,W,count:7,caps});
 assert.equal(hash(s),before);assert(q.wholeNozzleAndFeedContained&&q.nominalWidthOnly);
 assert(q.candidatePlanAccuracy.candidatePlanConstructionAccepted&&!q.candidatePlanAccuracy.accepted);
 assert(!q.rulePrescribedTargetResolved&&!q.wholeSourceAllocationCertified&&!q.ownerAccepted&&!q.routeAccepted);
 assert.equal(q.selectedCommands.length,0);assert(!q.originalCoverage.completeOriginalMaterialCovered);
 assert.equal(R.number(R.parse(q.originalCoverage.originalAreaExactMM2))/(W*W),329);
 assert.equal(R.number(R.parse(q.originalCoverage.missingOriginalAreaExactMM2))/(W*W),caps?1.5:10.5);
 assert.equal(R.number(R.parse(q.multiplicity.commandedDuplicateAreaExactMM2))/(W*W),caps?9:0);
 assert.equal(q.multiplicity.pairMinusDuplicateExactMM2,'0/1');assert(!q.multiplicity.physicalFlowOrVolumeCertified);
 assert.equal(q.addedCharge.passed,!caps);assert(!q.internalRestartOverlapAuthorized);checks+=13;
 assert(q.wholeCandidatePUnionEqualsActualU);assert.equal(q.candidateTargetToActual.missingOriginalAreaExactMM2,'0/1');
 assert.equal(q.actualToCandidateTarget.missingOriginalAreaExactMM2,'0/1');checks+=3;
 for(const command of q.commands){assert.equal(command.widthStart,W);assert.equal(command.widthEnd,W);checks+=2;
  let previous;
  for(const cell of command.sourceIntervals){const edge=s[cell.edge],next=s[(cell.edge+1)%s.length],point=t=>edge.map((v,k)=>R.add(R.exact(v),R.mul(R.parse(t),R.sub(R.exact(next[k]),R.exact(v))))),a=point(cell.exactU0),b=point(cell.exactU1);
   assert.deepEqual(cell.sourceStart,edge);assert.deepEqual(cell.sourceEnd,next);
   assert(R.cmp(R.dot(R.vec(b,a),R.vec(command.to.map(R.exact),command.from.map(R.exact))),R.zero)>=0);
   if(previous)assert(previous.every((v,k)=>R.cmp(v,a[k])===0));previous=b;checks+=3;
  }
 }
 rows.push({W,variant,caps,commands:q.commands.length,candidateConstructionErrorMM:q.candidatePlanAccuracy.totalUpperBoundMM,
  missingOriginalW2:caps?1.5:10.5,commandedDuplicateW2:caps?9:0,ownerAccepted:false});
}
let packet;
for(const caps of [false,true]){
 const mesh=prism(source({reverse:caps,tess:2})),before=hash(mesh),job={z:.5,W:1,count:7,mode:caps?'T-caps-diagnostic':'T-body-diagnostic'},
  proposal=owner.prepare(mesh,job),q=JSON.parse(JSON.stringify(owner.verify(mesh,JSON.parse(JSON.stringify(proposal)),job)));
 assert.equal(hash(mesh),before);assert(q.sourceVerified&&q.sourceFaceAngleBindingCertified);
 assert(!q.ownerAccepted&&!q.routeAccepted&&!q.wholeSourceAllocationCertified&&!q.accuracy.accepted);
 assert.equal(q.selectedCommands.length,0);assert.equal(q.selectedExecution.length,0);
 assert.equal(q.sourceAngleEvidence.length,caps?17:14);assert(q.sourceAngleEvidence.every(row=>row.originalIntervals.every(v=>v.actualTriangleIntervals.length>0)));checks+=7;
 if(!caps)packet={mesh,job,proposal};
}
for(const mutate of [p=>p.allocation.wholeMandatorySourceCoveragePassed=true,p=>p.allocation.plan.rulePrescribedTargetResolved=true,
 p=>p.allocation.multiplicity.commandedDuplicateAreaExactMM2='1/1',p=>p.allocation.commands[0].widthStart=.59]){
 const p=structuredClone(packet.proposal);mutate(p);
 assert.notEqual(hash(p),hash(packet.proposal));assert.throws(()=>owner.verify(packet.mesh,p,packet.job));checks+=2;
}
assert.throws(()=>g.generate({source:base,W:1,count:1}));assert.throws(()=>g.generate({source:base,W:1,count:7,signal:{aborted:true}}));checks+=2;
const old=createRouteGenerator(),context=load('optimized-worker.js').context,finite=old.generate({rings:[base],W:1,count:3}),
 centerCell=[[15,3],[16,3],[16,4],[15,4]],oldQuads=finite.commands.map(q=>context.frameThroughNeckRibbon(q.from,q.to,1,1)),
 central=originalMaterialDifference([centerCell],oldQuads),filled=g.generate({source:base,W:1,count:7}),
 newQuads=filled.commands.map(q=>context.frameThroughNeckRibbon(q.from,q.to,1,1));
assert(finite.completeFinitePerimeterPlanCertified);assert(!central.completeOriginalMaterialCovered);
assert.equal(central.missingOriginalAreaExactMM2,'1/1');assert(originalMaterialDifference([centerCell],newQuads).completeOriginalMaterialCovered);
assert.equal(old.generate({rings:[base],W:1,count:4}).status,'unsupported-route-class');checks+=5;
const result={status:'PASS',checks,kernelRevision:owner.kernelRevision,rows,meshJSONOwnerCases:2,forgedControls:4,
 centralCellNegative:{assignedIndependentlyToCandidateP:true,oldThreePerimetersMissingExactAreaW2:'1/1',newBodyCovers:true,nextPerimeterUnsupported:true},
 newCompleteLayersAccepted:0,roundedFullMaterialPlanAttachedToThisBodyCandidate:false,internalRestartOverlapAuthorized:false,totalMS:performance.now()-start};
fs.writeFileSync('evidence/T-fill-candidate-light.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
