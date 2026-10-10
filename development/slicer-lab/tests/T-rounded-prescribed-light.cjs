'use strict';
const assert=require('assert/strict'),fs=require('fs'),R=require('../core/rational.cjs'),{hash}=require('../core/mesh-section.cjs');
const {planTRoundedMaterial,buildRoundedBoundaryReference,accountRoundedMaterial}=require('../core/T-rounded-prescribed-plan.cjs');
const {createTBodyCandidateCore}=require('../core/T-fill-candidate.cjs'),{load}=require('../core/adapter.cjs');
const base=[[0,0],[30,0],[30,7],[19,7],[19,24],[12,24],[12,7],[0,7]],start=performance.now(),rows=[],c=load('optimized-worker.js').context,g=createTBodyCandidateCore();let checks=0;
for(const W of [.5,1,2])for(let turn=0;turn<4;turn++)for(const reverse of [false,true])for(const tess of [1,2]){
 const s=base.flatMap((a,i)=>Array.from({length:tess},(_,j)=>a.map((v,k)=>v+(base[(i+1)%8][k]-v)*j/tess))).map(p=>{
  let[x,y]=p;for(let k=0;k<turn;k++)[x,y]=[-y,x];return[(x+8)*W,(y-4)*W];});if(reverse)s.reverse();
 const before=hash(s),p=planTRoundedMaterial(s,W),b=buildRoundedBoundaryReference(p);
 assert.equal(hash(s),before);assert.equal(p.corners.length,6);assert(p.rulePrescribedExterior90TargetResolved&&p.cornerSquaresPairwiseDisjoint);
 assert(!p.cornerWideningRequired&&!p.internalRestartOverlapAuthorized&&!p.wholeRoutePrescribedProtocolsResolved);
 assert.equal(R.number(R.parse(p.originalAreaExactMM2))/(W*W),329);checks+=5;
 const E=p.excludedAreaExactBoundsMM2.map(R.parse),expected=(1-Math.PI/4)*1.5*W*W;
 assert(Math.abs(R.number(E[0])-expected)<1e-13*W*W);assert(R.cmp(E[0],E[1])<0);checks+=2;
 assert(b.accuracy.accepted&&b.accuracy.roundedMaterialBoundaryDeviationCertified);
 assert(b.accuracy.totalUpperBoundMM/W<.003862);assert(!b.accuracy.wholeTrajectoryDeviationCertified&&!b.accuracy.ownerAccepted);
 assert.equal(b.actualPrintCommands.length,0);checks+=4;
 for(let i=0;i<6;i++){
  const corner=p.corners[i],arc=b.arcs[i],centre=corner.exactCentre.map(R.parse),r=R.parse(corner.exactRadius);
  assert.deepEqual(arc.exactPoints[0],corner.exactStart);assert.deepEqual(arc.exactPoints.at(-1),corner.exactEnd);checks+=2;
  for(const q of arc.exactPoints){const d=R.vec(q.map(R.parse),centre);assert.equal(R.cmp(R.dot(d,d),R.mul(r,r)),0);checks++;}
  let previous;for(const interval of corner.sourceIntervals){
   assert.deepEqual(interval.sourceStart,s[interval.edge]);assert.deepEqual(interval.sourceEnd,s[(interval.edge+1)%s.length]);
   const point=t=>interval.sourceStart.map((v,k)=>R.add(R.exact(v),R.mul(R.parse(t),R.sub(R.exact(interval.sourceEnd[k]),R.exact(v))))),a=point(interval.exactU0),z=point(interval.exactU1);
   if(previous)assert(a.every((v,k)=>R.cmp(v,previous[k])===0));previous=z;checks+=3;
  }
 }
 const caps=g.generate({source:s,W,caps:true}),quads=caps.commands.map(q=>c.frameThroughNeckRibbon(q.from,q.to,W,W)),account=accountRoundedMaterial(p,quads);
 assert(account.actualCommandedPolygonsContainedInPrescribedMaterial);assert(account.positivePrescribedMaterialMissingProved&&!account.wholePrescribedMaterialCovered);
 assert.equal(account.originalCADMinusU.missingOriginalAreaExactMM2,R.str(R.mul(R.rat(3n,2n),R.mul(R.exact(W),R.exact(W)))));
 assert(Math.abs(R.number(R.parse(account.prescribedMaterialMinusUExactAreaBoundsMM2[0]))/(W*W)-3*Math.PI/8)<1e-13);
 assert(!account.computationalError&&!account.ownerAccepted&&!account.physicalFlowValidated);checks+=5;
 rows.push({W,turn,reverse,tess,localBoundaryErrorW:b.accuracy.totalUpperBoundMM/W,excludedAreaW2:R.number(E[0])/(W*W),
  capsPrescribedMissingAreaW2:R.number(R.parse(account.prescribedMaterialMinusUExactAreaBoundsMM2[0]))/(W*W)});
}
const p=planTRoundedMaterial(base),tip=[[0,0],[.25,0],[.25,.25],[0,.25]],bad=accountRoundedMaterial(p,[tip]);
assert(!bad.actualCommandedPolygonsContainedInPrescribedMaterial);assert(bad.cornerExclusionViolations.length>0);assert.equal(bad.prescribedMaterialMinusUExactAreaBoundsMM2,undefined);checks+=3;
for(const mutate of [q=>q.corners[0].exactRadius='0/1',q=>q.excludedAreaExactBoundsMM2=['1/1','1/1'],q=>q.corners.pop(),q=>q.source[0][0]=.1]){
 const forged=structuredClone(p);mutate(forged);assert.throws(()=>buildRoundedBoundaryReference(forged));assert.throws(()=>accountRoundedMaterial(forged,[tip]));checks+=2;
}
const result={status:'PASS',checks,scenes:rows.length,rows,independentAnalyticCircleReference:true,
 completeCommandedFeedCoverageCertified:false,wholeTSelected:false,internalRestartOverlapAuthorized:false,elapsedMS:performance.now()-start};
fs.writeFileSync('evidence/T-rounded-prescribed-light.json',JSON.stringify(result,null,2));console.log(JSON.stringify({...result,rows:undefined}));
