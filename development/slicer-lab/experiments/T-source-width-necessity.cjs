'use strict';
// Independent, CONDITIONAL source-plan calculation. No emitted cell or a fitted
// material target is an input. Other outer allocations remain an open alternative.
const R=require('../core/rational.cjs'),A=require('../core/accuracy-contract.cjs'),{planTBody}=require('../core/T-fill-candidate.cjs');
function sourceTWidthNecessity(source,W=1){
 const body=planTBody(source,W,7),stems=body.rows.filter(q=>q.role==='stem-body'&&q.depth===2);if(stems.length!==2)throw Error('two source-defined depth2 stem banks required');
 const rows=stems.map(q=>({a:q.exactFrom.map(R.parse),b:q.exactTo.map(R.parse)})),w=R.exact(W),direction=R.vec(rows[0].b,rows[0].a),v=direction.map(q=>R.rat(!q.n?0n:q.n>0n?1n:-1n)),u=[v[1],R.sub(R.zero,v[0])],
  separation=A.abs(R.dot(R.vec(rows[1].a,rows[0].a),u)),shift=R.div(w,R.rat(8n)),radius=R.mul(w,R.rat(5n,8n)),
  free=R.sub(R.sub(separation,R.mul(shift,R.rat(2n))),R.mul(radius,R.rat(2n))),sqrt2=A.sqrtBounds(R.rat(2n)),
  // The source-required half-W quarter-cell's far diagonal from the fixed
  // +/-W/8 front-constrained head is (3W/8,3W/8). Any covering round radius
  // therefore has this lower bound, regardless of the emitted fan tessellation.
  minimumRadiusLower=R.mul(R.mul(w,R.rat(3n,8n)),sqrt2[0]),maximumFreeUpper=R.sub(R.sub(separation,R.mul(shift,R.rat(2n))),R.mul(minimumRadiusLower,R.rat(2n)));
 if(R.cmp(separation,R.mul(w,R.rat(2n)))!==0)throw Error('seven-W source stem required');
 return{kind:'independent-fixed-source-bank-width-necessity',sourcePlanBeforeEmission:true,emittedCellsUsed:false,sourceTargetChanged:false,
  exactSourceDepth2StemAxisSeparationMM:R.str(separation),exactFrontHeadShiftMM:R.str(shift),exactChosenRootRadiusMM:R.str(radius),exactCriticalUnoccupiedSpanMM:R.str(free),
  minimumRequiredQuarterCellRadiusLowerMM:R.str(minimumRadiusLower),maximumUnoccupiedSpanUpperMM:R.str(maximumFreeUpper),maximumUnoccupiedSpanUpperW:R.number(R.div(maximumFreeUpper,w)),
  nominalWDoesNotFitUnoccupiedSpan:R.cmp(maximumFreeUpper,w)<0,localContractionNeededToAvoidOrdinaryWContacts:true,
  conditionalOn:'source-first three T laps with the fixed flat bank fronts and W/8 root-head shifts; source-required half-W quarter-cells retained',
  permittedEventOverlapStillMustBeChecked:true,exactAdaptiveScheduleGloballyNecessary:false,maximumPermittedContinuityCertified:false,
  scope:'local free-span necessity for the prescribed outer bank allocation only; ordinary W may be admissible under a different outer construction, which is unresolved'};
}
module.exports={sourceTWidthNecessity};
