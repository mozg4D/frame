'use strict';
const fs=require('fs'),assert=require('assert/strict'),R=require('../core/rational.cjs');
const {hash}=require('../core/mesh-section.cjs'),{prism}=require('./mesh-fixtures.cjs');
const {createMeshAllocationCore}=require('../core/mesh-allocation-contract.cjs');
const {createRectangleAllocationCore}=require('../core/rectangle-allocation-contract.cjs');
const {generateTurnSeam}=require('../core/rectangle-return-seam.cjs');
const start=performance.now(),core=createRectangleAllocationCore(),rows=[];let checks=0;
const source=[[0,0],[20,0],[20,1.7],[0,1.7]],original=hash(source);
for(const vertical of [false,true]){
 const ring=source.map(p=>vertical?p.slice().reverse():p.slice()),t=performance.now(),q=core.generate({source:ring,mode:'continuous-1.7-turn-seam'});
 assert(q.accuracy.accepted);assert(!q.routeAccepted&&!q.wholeMandatorySourceCoveragePassed);assert.equal(q.internalRestartCount,0);
 assert(q.plan.phases.every(p=>p.atLeastNominalW));assert.equal(q.geometry.failures.length,0);
 assert.equal(q.plan.closure.nominalLengthMM,.5);assert(R.cmp(R.parse(q.plan.closure.exactLengthUpperMM),R.rat(1n,2n))<=0);
 assert(q.commands.filter(c=>c.closure).every(c=>c.widthStart===1&&c.widthEnd===1&&c.sourceIntervals.length));
 assert(!q.geometry.charge.passed);assert.deepEqual(q.plan.originalRequiredMaterialPlan.requiredCells,
  core.generate({source:ring}).plan.requiredCells);
 const reverse=generateTurnSeam(ring.slice().reverse()),logical=q=>q.commands.map(c=>[c.from,c.to,c.widthStart,c.widthEnd]);
 assert.deepEqual(logical(q),logical(reverse));checks+=11;
 rows.push({vertical,fullGeometryMS:performance.now()-t,commands:q.commands.length,closureCommands:q.commands.filter(c=>c.closure).length,
  chargeW2:q.geometry.charge.chargeUpperBoundMM2,seamPassed:q.geometry.charge.passed,wholeMaterialPassed:false,
  missingCells:q.geometry.coverage.failures.map(f=>f.cell),constructionBoundW:q.accuracy.totalUpperBoundMM});
}
const mesh=prism(source),job={z:.5,W:1,count:7,mode:'continuous-1.7-turn-seam'},owner=createMeshAllocationCore(),t=performance.now(),
 proposal=owner.prepare(mesh,job),q=owner.verify(mesh,JSON.parse(JSON.stringify(proposal)),job),end=performance.now();
assert(q.sourceVerified&&q.sourceFaceAngleBindingCertified&&q.accuracy.accepted);assert.equal(q.selectedCommands.length,0);
assert(!q.ownerAccepted&&!q.routeAccepted&&!q.completeOriginalMaterialCoveragePassed);assert.equal(hash(source),original);checks+=4;
for(const mutate of [p=>p.allocation.plan.originalRequiredMaterialPlan.requiredCells.shift(),p=>p.allocation.plan.closure.exactLengthUpperMM='1/1',
 p=>p.allocation.geometry.charge.passed=true,p=>p.allocation.commands.at(-1).widthEnd=.7]){
 const p=JSON.parse(JSON.stringify(proposal));mutate(p);assert.throws(()=>owner.verify(mesh,p,job));checks++;
}
const result={status:'PASS',checks,kernelRevision:owner.kernelRevision,rows,meshJSONOwnerMS:end-t,totalMS:performance.now()-start,
 fullLayersAccepted:0,spiralsAccepted:0,internalRestartOverlapAuthorized:false,originalMaterialReferenceUnchanged:true,
 testedSeamAlternatives:1,globalImpossibilityProved:false};
fs.writeFileSync('evidence/return-turn-seam-light.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
