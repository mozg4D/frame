'use strict';
// Bounded production transition planner for independently source-bound rectangles.
// The retained connector owner is authoritative; no relaxed charge/width rule.
const {PHYSICAL_CLOCKWISE_SIGN}=require('./physical-path-direction.cjs');
function planTransitions(source,paths,W,c,innerAccuracy){
 if(!innerAccuracy?.accepted)return{status:'explicit-travel-required',reasons:['independent complete level reference required'],routes:paths,connections:0};
 const loops=paths.map((p,depth)=>({id:'source-depth-'+depth,depth,points:p.points.slice(0,-2),feedWidth:W,lineage:{resolved:true,componentId:'original-orthogonal-source',sourceRingId:0,sourceBoundaryRole:'outer',familyId:'original-orthogonal-source/outer',parentPathId:depth?'source-depth-'+(depth-1):null,authority:'independent complete topology-preserving original source offsets'}}));
 // Ordinary width changes require W-long phases. The old .005W spiral ramps
 // are not authority for this new route; retain the current overlap limits.
 const plan=c.framePlanWidthContinuousSpiralRoutes({loops,sourceRings:[source],W,clockwiseSign:PHYSICAL_CLOCKWISE_SIGN,rampLengthMM:W});
 return{...plan,connections:plan.events?.filter(q=>q.kind==='spiral-connection').length??0,independentSourceLevelsChecked:true,ordinaryWidthPhaseLengthMM:W};
}
module.exports={planTransitions};
