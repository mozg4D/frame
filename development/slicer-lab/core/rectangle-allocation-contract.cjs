'use strict';
const R=require('./rational.cjs');
const {load}=require('./adapter.cjs'),{generateRectangleAllocation}=require('./rectangle-allocation.cjs');
const {generateRectangleReturn}=require('./rectangle-return-plan.cjs');
const {generateTurnSeam}=require('./rectangle-return-seam.cjs');
const {auditRouteGeometry}=require('./route-geometry-contract.cjs');
const {proveRequiredFeedCells}=require('./trajectory-union-accuracy.cjs');
function createRectangleAllocationCore() {
 const c=load('optimized-worker.js').context;
 return {generate({source,W=1,count=7,signal,mode='flat-banks'}){
  if(!['flat-banks','continuous-1.7-return','continuous-1.7-turn-seam'].includes(mode))throw Error('unknown allocation mode');
  const candidate=mode==='flat-banks'?generateRectangleAllocation(source,W,count,signal):
   mode==='continuous-1.7-return'?generateRectangleReturn(source,W,count,signal):generateTurnSeam(source,W,count,signal);
  const materialPlan=mode==='flat-banks'?candidate.plan:candidate.plan.originalRequiredMaterialPlan;
  const nominal=mode==='flat-banks'?candidate.plan.rows.map(row=>{
   const a=row.exactFrom.map(s=>R.number(R.parse(s))),b=row.exactTo.map(s=>R.number(R.parse(s))),
    width=R.number(R.parse(row.exactWidth));
   return c.frameThroughNeckRibbon(a,b,width,width);
  }):candidate.plan.segments.filter(s=>!s.closure).map((s,i)=>c.frameThroughNeckRibbon(
   candidate.plan.exactPoints[i].map(s=>R.number(R.parse(s))),candidate.plan.exactPoints[i+1].map(s=>R.number(R.parse(s))),
   R.number(R.parse(candidate.plan.exactWidths[i])),R.number(R.parse(candidate.plan.exactWidths[i+1]))));
  const geometry=auditRouteGeometry({source,paths:candidate.paths,originalQuads:nominal,
   requiredCells:materialPlan.requiredCells.map(c=>c.points),W,signal,coverageOptions:{negativeVertexFirst:true,maxWork:20000}},c);
  const bodyCoverage=proveRequiredFeedCells(materialPlan.requiredCells
   .filter(c=>c.role==='complete-original-straight-body').map(c=>c.points),candidate.paths,W,{negativeVertexFirst:true,maxWork:20000});
  const wholeAllocationGeometryPassed=geometry.geometryPassed&&candidate.accuracy.accepted;
  return {...candidate,mode,status:wholeAllocationGeometryPassed?'whole-source-allocation-geometry-candidate':
   'whole-source-allocation-rejected-by-coverage',geometry,bodyCoverage,
   wholeMandatorySourceCoveragePassed:geometry.coverage.requiredCellsCovered,
   declaredIntentionalGapOnly:materialPlan.intentionalDesignGap,
   originalCapOmissions:geometry.coverage.failures.filter(f=>
    materialPlan.requiredCells[f.cell]?.role!=='complete-original-straight-body'),
   sourceTraversalProtocolCertified:false,restartAndClosureProtocolCertified:false,
   wholeSourceAllocationCertified:false,routeAccepted:false,
   scope:'entire original rectangle required, with only source-authorized straight-body residual gap; caps cannot be waived'};
 }};
}
module.exports={createRectangleAllocationCore};

