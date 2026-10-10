'use strict';
const assert=require('assert/strict'),fs=require('fs'),R=require('../core/rational.cjs'),{hash}=require('../core/mesh-section.cjs');
const {createTOpenPortalCore}=require('../core/T-open-portals.cjs'),{createMeshAllocationCore}=require('../core/mesh-allocation-contract.cjs'),{prism}=require('./mesh-fixtures.cjs');
const base=[[0,0],[30,0],[30,7],[19,7],[19,24],[12,24],[12,7],[0,7]],start=performance.now(),g=createTOpenPortalCore(),owner=createMeshAllocationCore(),rows=[];let checks=0;
const variants=[{terminal:true,branch:false,commands:15,components:13,D:.5,coupon:.5,missing:7.5},
 {terminal:false,branch:true,commands:16,components:14,D:.5,coupon:.25,missing:10.5},{terminal:true,branch:true,commands:17,components:13,D:1,coupon:.75,missing:7.5}];
for(const W of [.5,1,2])for(let turn=0;turn<4;turn++)for(const reverse of [false,true]){
 const tess=reverse?2:1,s=base.flatMap((a,i)=>Array.from({length:tess},(_,j)=>a.map((v,k)=>v+(base[(i+1)%8][k]-v)*j/tess))).map(p=>{
  let[x,y]=p;for(let k=0;k<turn;k++)[x,y]=[-y,x];return[(x+8)*W,(y-4)*W];});if(reverse)s.reverse();
 for(const v of variants){const before=hash(s),q=g.generate({source:s,W,terminal:v.terminal,branch:v.branch});
  assert.equal(hash(s),before);assert(q.wholeNozzleAndFeedContained&&q.originalBodyTargetPreserved&&q.candidateTargetEqualsActual);
  assert.equal(q.commands.length,v.commands);assert.equal(q.wholeTComponents,v.components);assert(q.connectedCouponContinuous);
  assert.equal(q.connectedCouponInternalRestarts,0);assert(!q.internalRestartOverlapAuthorized&&!q.ownerAccepted&&!q.routeAccepted);
  assert.equal(q.selectedCommands.length,0);assert(!q.closedPhysicalClockwiseRouteCertified&&!q.wholeSourceAllocationCertified);checks+=9;
  assert.equal(R.number(R.parse(q.multiplicity.commandedDuplicateAreaExactMM2))/(W*W),v.D);
  assert.equal(q.multiplicity.pairMinusDuplicateExactMM2,'0/1');assert.equal(q.addedCharge.chargeUpperBoundMM2/(W*W),v.D);
  assert.equal(q.couponCharge.chargeUpperBoundMM2/(W*W),v.coupon);assert.equal(q.addedCharge.passed,v.D<=.5);
  assert.equal(q.couponGeometryAndJointPassed,v.coupon<=.5);assert.equal(R.number(R.parse(q.originalCoverage.missingOriginalAreaExactMM2))/(W*W),v.missing);checks+=7;
  assert(q.outsideInDepthOrderCertified&&!q.maximalContinuityCertified);assert(q.candidatePlanAccuracy.candidatePlanConstructionAccepted&&!q.candidatePlanAccuracy.accepted);
  assert.equal(R.number(R.parse(q.plan.fixedPlacementNecessaryChargeExactMM2))/(W*W),v.D);checks+=3;
  assert(q.rulePrescribedCornerTargetResolved&&q.roundedMaterial.actualCommandedPolygonsContainedInPrescribedMaterial);
  assert(q.roundedMaterial.positivePrescribedMaterialMissingProved&&!q.roundedMaterial.wholePrescribedMaterialCovered);
  assert.deepEqual(q.plan.removedTargetCells,[]);assert(!q.plan.removedOverlapCredit);assert.equal(q.strandedBranchRestartUnqualified,v.branch);checks+=5;
  for(const command of q.commands){assert.equal(command.widthStart,W);assert.equal(command.widthEnd,W);checks+=2;
   let previous;for(const cell of command.sourceIntervals){
    assert.deepEqual(cell.sourceStart,s[cell.edge]);assert.deepEqual(cell.sourceEnd,s[(cell.edge+1)%s.length]);
    const point=t=>cell.sourceStart.map((v,k)=>R.add(R.exact(v),R.mul(R.parse(t),R.sub(R.exact(cell.sourceEnd[k]),R.exact(v))))),a=point(cell.exactU0),b=point(cell.exactU1);
    if(previous)assert(a.every((v,k)=>R.cmp(v,previous[k])===0));previous=b;checks+=3;
   }
  }
  rows.push({W,turn,reverse,terminal:v.terminal,branch:v.branch,commands:v.commands,components:v.components,DW2:v.D,couponChargeW2:v.coupon,couponPassed:q.couponGeometryAndJointPassed,
   prescribedMissingW2:R.number(R.parse(q.roundedMaterial.prescribedMaterialMinusUExactAreaBoundsMM2[0]))/(W*W)});
 }
}
let packet;for(const v of variants){const mesh=prism(base),job={z:.5,W:1,count:7,mode:v.terminal?(v.branch?'T-combined-portals-diagnostic':'T-terminal-portals-diagnostic'):'T-branch-portals-diagnostic'},
 proposal=owner.prepare(mesh,job),q=owner.verify(mesh,JSON.parse(JSON.stringify(proposal)),job);
 assert(q.sourceVerified&&q.sourceFaceAngleBindingCertified);assert(!q.ownerAccepted&&!q.accuracy.accepted);
 assert.equal(q.selectedCommands.length,0);assert.equal(q.sourceAngleEvidence.length,v.commands);checks+=4;
 for(const row of q.sourceAngleEvidence){assert(row.originalIntervals.every(i=>i.actualTriangleIntervals.length>0));checks++;}
 packet={mesh,job,proposal};
}
for(const mutate of [p=>p.allocation.ownerAccepted=true,p=>p.allocation.commands[0].widthStart=.59,p=>p.allocation.plan.portals[1].sourceIntervals.pop(),
 p=>p.allocation.plan.roundedMaterialPlan.excludedAreaExactBoundsMM2=['1/1','1/1'],p=>p.allocation.roundedMaterial.wholePrescribedMaterialCovered=true]){
 const p=structuredClone(packet.proposal);mutate(p);assert.notEqual(hash(p),hash(packet.proposal));assert.throws(()=>owner.verify(packet.mesh,p,packet.job));checks+=2;
}
assert.throws(()=>g.generate({source:base,signal:{aborted:true}}),/cancelled/);checks++;
// Conditional channel-graph obstruction, not a theorem about arbitrary 2D
// geometry. The chosen Y has three leaves and a degree-three junction.
const edges=[['a','j',12],['j','b',17],['j','c',17]],degree={};for(const[a,b]of edges){degree[a]=(degree[a]??0)+1;degree[b]=(degree[b]??0)+1;}
assert.equal(Object.values(degree).filter(n=>n%2).length,4);assert.equal(Math.min(...edges.map(e=>e[2])),12);checks+=2;
const result={status:'PASS',checks,scenes:rows.length,kernelRevision:owner.kernelRevision,rows,meshOwnerCases:3,forgedControls:5,
 sourceOwnedTerminalCouponPassed:true,sourceOwnedBranchCouponPassed:true,combinedAddedChargeFails:true,
 fixedYOnly:{oddNodes:4,edgeOnceTrailsMinimum:2,minWholeLegRetraceChargeW2:12,general2DImpossibilityProved:false},
 wholeTLayersSelected:0,internalRestartOverlapAuthorized:false,physicalFlowValidated:false,elapsedMS:performance.now()-start};
fs.writeFileSync('evidence/T-open-portals-light.json',JSON.stringify(result,null,2));console.log(JSON.stringify({...result,rows:undefined}));
