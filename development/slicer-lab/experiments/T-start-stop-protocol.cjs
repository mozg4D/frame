'use strict';
// Full flat-feed runtime protocol for this orthogonal T family. This is not
// the acute 0.6W cap-slot restart and does not authorize its pending overlap.
const R=require('../core/rational.cjs'),{load}=require('../core/adapter.cjs');
const {exactJointCharge}=require('../core/exact-joint-charge.cjs'),{proveFeedInsideSource,sourceCells}=require('../core/exact-source-feed.cjs');
const same=(a,b)=>a.every((v,k)=>v===b[k]);
function auditTStartStop(source,runtime,courses,{signal,checkContainment=true}={}){
 if(runtime?.kind!=='compiled-independent-T-runtime'||!Array.isArray(courses))throw Error('compiled T runtime and source courses required');
 const c=checkContainment?load('optimized-worker.js').context:null,W=runtime.W,w=R.exact(W),material=checkContainment?sourceCells(source):null,starts=[],stops=[],containment=[];
 const cells=runtime.cells,commands=runtime.commands;
 for(let i=0;i<commands.length;i++){if(signal?.aborted)throw Error('T start/stop cancelled');const q=commands[i],ribbon=cells[i];
  containment.push({command:i,nozzle:checkContainment?c.frameThroughNeckExactClearance(q.from,q.to,source,W).passed:false,
   feed:checkContainment?proveFeedInsideSource(ribbon.polygon,source,material).passed:false});
 }
 for(const course of courses){
  const a=course.startCommand,b=course.endCommand,first=commands[a],last=commands[b-1];
  if(!first||!last||first.component!==course.component||last.component!==course.component||first.widthStart!==W||first.widthEnd!==W)throw Error('changed full T start/stop course');
  // The entire initial constant-W run, including all same-W turns, is
  // charged against ALL earlier actual ribbons/rounds/bevels. No first-W crop.
  let end=a;while(end<b&&commands[end].widthStart===W&&commands[end].widthEnd===W)end++;
  const length2=R.dot(R.vec(first.to.map(R.exact),first.from.map(R.exact)),R.vec(first.to.map(R.exact),first.from.map(R.exact))),
   prior=cells.filter(q=>q.command<a),initial=cells.filter(q=>q.command>=a&&q.command<end&&(q.kind==='ribbon'||q.command+1<end)),
   charge=exactJointCharge(prior.map(q=>q.polygon),prior.concat(initial).map(q=>q.polygon),W,{maxWork:1000000}),
   // Ignore intersections BETWEEN distinct parts of the same continuous
   // initial run only when identifying foreign contacts. Those cannot prove
   // an internal restart clear of previously deposited material.
   foreign=charge.areas.filter(q=>(q.first<prior.length)!==(q.second<prior.length)),
   foreignSum=foreign.reduce((s,q)=>R.add(s,R.exact(q.upperAreaMM2)),R.zero),
   owned=Array.isArray(first.sourceIntervals)&&first.sourceIntervals.length>0&&first.sourceIntervals.every(q=>[q.exactU0,q.exactU1].every(v=>{
    const t=R.parse(v);return R.cmp(t,R.zero)>=0&&R.cmp(t,R.one)<=0;}));
  starts.push({component:course.component,kind:course.component?'internal-nominal-W-flat-start':'external-nominal-W-flat-start',
   firstCommand:a,constantWRunEndCommand:end,firstSegmentLengthAtLeastW:R.cmp(length2,R.mul(w,w))>=0,
   finiteOriginalSourceIntervals:owned,wholeInitialConstantWRunChecked:true,priorCells:prior.length,initialCells:initial.length,
   exactForeignOverlapMM2:R.str(foreignSum),foreignPairs:foreign,strictPriorFeedDisjoint:foreignSum.n===0n,
   nominalNozzleStartContained:containment[a].nozzle,stationaryFeed:false,capStyle:'flat',acuteRestartRuleChanged:false});
  stops.push({component:course.component,command:b-1,capStyle:'flat',width:last.widthEnd,stationaryFeed:false,
   nominalNozzleStopContained:containment[b-1].nozzle,closed:course.closed,
   boundClosureTail:!course.closed||(last.role==='source-owned-half-W-closure'&&same(last.from,first.from))});
 }
 const events=runtime.execution,protocolOrder=events.filter(q=>q.kind==='start-course').length===courses.length&&events.filter(q=>q.kind==='stop-course').length===courses.length&&
  events.filter(q=>q.kind==='travel').length===courses.length-1&&events.at(-1)?.kind==='finish-layer',
  passed=starts.every(q=>q.firstSegmentLengthAtLeastW&&q.finiteOriginalSourceIntervals&&q.strictPriorFeedDisjoint&&q.nominalNozzleStartContained)&&
   stops.every(q=>q.nominalNozzleStopContained&&q.boundClosureTail)&&containment.every(q=>q.nozzle&&q.feed)&&protocolOrder;
 return{passed,starts,stops,containment,protocolOrder,independentStarts:courses.length,internalStarts:courses.length-1,
  strictWholeInitialRunsDisjoint:starts.every(q=>q.firstSegmentLengthAtLeastW&&q.finiteOriginalSourceIntervals&&q.strictPriorFeedDisjoint),
  wholeFixedNominalNozzleCapsulesAndFlatFeedsChecked:checkContainment,independentStationaryCapDoseAssumed:false,internalRestartOverlapAuthorized:false,
  physicalFlowOrVolumeCertified:false,scope:'whole constant-W startup and complete executable start/travel/print/stop/finish protocol; flat command cross-sections, fixed W nozzle; no acute cap-slot rule changes'};
}
module.exports={auditTStartStop};
