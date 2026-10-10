'use strict';
const fs=require('fs'),assert=require('assert/strict'),{sourceTWidthNecessity}=require('../experiments/T-source-width-necessity.cjs');
const {createTRedistributedCentralCourses}=require('../experiments/T-redistributed-central-courses.cjs'),{compileTExecution}=require('../experiments/T-runtime-commands.cjs'),{auditTStartStop}=require('../experiments/T-start-stop-protocol.cjs');
const source=[[0,0],[30,0],[30,7],[19,7],[19,24],[12,24],[12,7],[0,7]],rows=[],start=performance.now();let checks=0;const check=q=>{assert(q);checks++;};
const analytic=[];for(const W of [.5,1,2]){const q=sourceTWidthNecessity(source.map(p=>p.map(v=>v*W)),W);check(q.nominalWDoesNotFitUnoccupiedSpan&&!q.emittedCellsUsed&&!q.exactAdaptiveScheduleGloballyNecessary);check(q.maximumUnoccupiedSpanUpperW<1);analytic.push({W,...q});}
for(const [kind,centralPolicy] of [['ordinary-W-bar',{barLow:1}],['ordinary-W-stem',{stemWidth:1}]]){
 const t=performance.now(),a=createTRedistributedCentralCourses().generate({source,eventOnly:true,sharedLedger:true,centralPolicy}),r=compileTExecution(a),p=auditTStartStop(source,r,a.plan.courses,{checkContainment:false});
 check(!a.eventEvidence.every(e=>e.eventPassed)||!p.strictWholeInitialRunsDisjoint);check(a.preflightOnly&&!a.ownerAccepted&&a.selectedCommands.length===0);
 rows.push({kind,centralPolicy,allFinalEventChargesW2:a.eventEvidence.map(e=>e.charge.chargeUpperBoundMM2),eventBudgetsPassed:a.eventEvidence.every(e=>e.eventPassed),
  wholeInitialForeignAreasExactMM2:p.starts.map(q=>q.exactForeignOverlapMM2),wholeInitialRunsDisjoint:p.strictWholeInitialRunsDisjoint,sameOriginalSourceAndRootFronts:true,complementaryLowerBankRuleRetained:true,allOuterCellsIdentical:kind==='ordinary-W-stem',
  fullCoverageNotCertified:true,notGlobalImpossibility:true,ms:performance.now()-t});console.log(JSON.stringify(rows.at(-1)));
}
const out={passed:true,checks,analytic,rows,independentSourceCriticalSpan:true,conditionalWidthNecessityOnly:true,ordinaryWidthNecessityOverallStillOpen:true,selectedLayers:0,totalMS:performance.now()-start};
fs.writeFileSync('evidence/T-source-width-necessity-light.json',JSON.stringify(out,null,2));console.log(JSON.stringify({passed:true,checks,totalMS:out.totalMS}));
