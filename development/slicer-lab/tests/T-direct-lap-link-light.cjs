'use strict';
const fs=require('fs'),assert=require('assert/strict'),{buildTDirectLapLinks}=require('../experiments/T-direct-lap-link-candidate.cjs'),{replayTExecution}=require('../experiments/T-runtime-commands.cjs');
const a=require('../experiments/T-redistributed-central-courses.cjs').createTRedistributedCentralCourses().generate({source:[[0,0],[30,0],[30,7],[19,7],[19,24],[12,24],[12,7],[0,7]],runtimeOnly:true}),t=performance.now(),q=buildTDirectLapLinks(a),r=replayTExecution(q.runtime,{generation:1});
assert(q.fullOriginalLapsRetained&&q.onlyDuplicateClosureTailsRemoved&&q.sourceOriginalCAndPUnchanged);assert(q.courses.length===3&&r.travels===2&&r.finished);
assert(!q.eventBudgetsPassed&&q.events.every(e=>e.allFinalBanksIncluded&&!e.charge.passed));assert(!q.routeAccepted&&q.selectedCommands.length===0);
const out={passed:true,checks:4,constructed:true,commands:q.commands.length,courses:3,travels:r.travels,allFinalCoupledLinkChargesW2:q.events.map(e=>e.charge.chargeUpperBoundMM2),
 eventLimitW2:.5,directConstructionRejected:true,fullCoverageProofNotRerun:true,globalImpossibilityNotClaimed:true,selectedLayers:0,freshGeneratedAllocation:true,historicalReportLoaded:false,ms:performance.now()-t};
fs.writeFileSync('evidence/T-direct-lap-link-light.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out));
