'use strict';
const fs=require('fs'),assert=require('assert/strict');
const {createRouteGenerator}=require('../core/route-generator.cjs');
const {load}=require('../core/adapter.cjs'),{exactJointCharge}=require('../core/exact-joint-charge.cjs');
const {PHYSICAL_CLOCKWISE_SIGN}=require('../core/physical-path-direction.cjs');
const {planTransitions}=require('../core/route-transition-plan.cjs');
const g=createRouteGenerator(),c=load('optimized-worker.js').context,rows=[],liveRows=[];
let checks=0;const start=performance.now();
const physicalArea=points=>points.reduce((s,a,i)=>{const b=points[(i+1)%points.length];return s+(a[0]-b[0])*(a[1]+b[1]);},0);
const retainedPlanner=c.framePlanWidthContinuousSpiralRoutes;
c.framePlanWidthContinuousSpiralRoutes=input=>{
 assert.equal(input.clockwiseSign,-1);assert(input.loops.every(l=>physicalArea(l.points)<0));checks+=2;
 return retainedPlanner(input);
};
function bottomSeam(points,depth,W){
 // The old positive loop fixture advanced right along the bottom bank. A
 // physical clockwise bottom bank advances LEFT. Prescribe the equivalent
 // source-owned 45-degree seam pair, without changing the expected budget.
 const start=[(15-depth)*W,(.5+depth)*W],edge=points.findIndex((a,i)=>{
  const b=points[(i+1)%points.length];return a[1]===start[1]&&b[1]===start[1]&&a[0]>start[0]&&b[0]<start[0];
 });
 assert(edge>=0,'source-owned clockwise bottom seam');checks++;
 return[start,...points.slice(edge+1),...points.slice(0,edge+1)];
}
for(const W of [.5,1,2])for(const [kind,base]of [
 ['wideT',[[0,0],[30,0],[30,7],[19,7],[19,24],[12,24],[12,7],[0,7]]],
 ['rectangle',[[0,0],[30,0],[30,24],[0,24]]]
]){
 const source=base.map(p=>p.map(v=>v*W)),q=g.generate({rings:[source],W,count:3});
 assert.equal(q.status,'supported-finite-perimeter-route');assert.equal(q.transitionPlan.connections,0);
 assert.equal(q.transitionPlan.ordinaryWidthPhaseLengthMM,W);checks+=3;
 const checked=planTransitions(source,q.paths,W,c,q.innerAccuracy);
 assert.equal(checked.connections,0);assert.equal(JSON.stringify(checked.events),JSON.stringify(q.transitionPlan.events));
 assert((checked.events??[]).every(e=>e.reason!=='loop-not-clockwise-in-printer-frame'));checks+=3;
 assert((checked.events??[]).some(e=>e.reason==='shared-two-ended-overlap-budget'));checks++;
 liveRows.push({W,kind,actualGeneratedSeams:q.paths.map(p=>p.points[0]),connections:checked.connections,
  events:(checked.events??[]).map(e=>({kind:e.kind,reason:e.reason,along:e.witness?.along,across:e.witness?.across,totalEquivalentW:e.witness?.totalEquivalentW}))});
 const loops=q.paths.map((p,depth)=>({id:'level-'+depth,depth,points:bottomSeam(p.points.slice(0,-2),depth,W),feedWidth:W,
  lineage:{resolved:true,familyId:'analytic-source',componentId:0,sourceRingId:0,sourceBoundaryRole:'outer',
   parentPathId:depth?'level-'+(depth-1):null}}));
 const original=loops.flatMap(l=>l.points.map((p,i)=>c.frameThroughNeckRibbon(p,l.points[(i+1)%l.points.length],W,W)));
 for(let depth=0;depth<2;depth++){
  const a=loops[depth],b=loops[depth+1],from=a.points[0],to=b.points[0];
  assert(physicalArea(a.points)<0&&physicalArea(b.points)<0);checks++;
  assert.equal(to[0]-from[0],-W);assert.equal(to[1]-from[1],W);checks+=2;
  const production=c.frameCertifySpiralConnector({fromLoop:a,toLoop:b,loops,sourceRings:[source],
   W,clockwiseSign:PHYSICAL_CLOCKWISE_SIGN,fromEdge:0,fromT:0,toEdge:0,toT:0,connectorWidthStart:W,connectorWidthEnd:W});
  assert.equal(production.reason,'shared-two-ended-overlap-budget');checks++;
  const connector=c.frameThroughNeckRibbon(from,to,W,W),exact=exactJointCharge(original,[...original,connector],W);
  // Adjacent W-wide banks cover this entire W-wide sqrt(2)W connector.
  // The two endpoint charges therefore sum to sqrt(2)W^2, not half of it.
  assert(!exact.passed);assert(exact.chargeUpperBoundMM2>1.414*W*W&&exact.chargeUpperBoundMM2<1.415*W*W);checks+=2;
  const length=Math.hypot(to[0]-from[0],to[1]-from[1]);
  assert(length<2*W);checks++;
  rows.push({W,kind,depth,constantWConnectorChargeW2:exact.chargeUpperBoundMM2/(W*W),
   sharedLimitW2:.5,actualConnectorLengthW:length/W,requiredTwoOrdinaryWidthPhasesW:2,
   widthReductionSolelyForContinuityAuthorized:false,accepted:false,
   reason:'constant W connector exceeds exact shared charge; W-long contraction and expansion do not fit this adjacent-level connector'});
 }
}
const result={status:'PASS',checks,scenes:6,candidates:rows.length,acceptedSpirals:0,rows,liveRows,
 wallMS:performance.now()-start,generalSpiralMaximalityProved:false,internalRestartOverlapAuthorized:false,
 scope:'bounded adjacent topology-preserving levels with source-owned seam phases; exact ledger and ordinary W phase lengths together; not a general continuity impossibility proof'};
fs.writeFileSync('evidence/route-transition-ordinary.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));

