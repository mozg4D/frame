'use strict';
// Model-free, read-only checks. Each child must report its completion sentinel.
const assert=require('node:assert/strict'),cp=require('node:child_process'),path=require('node:path');
const {requireCompletion}=require('./run-checked-child.cjs');
const suites=[
 ['test-r235-light.cjs','FRAME_LIGHT_CHECKS_COMPLETED',25],
 ['test-first-stage.cjs','FRAME_FIRST_STAGE_COMPLETED',12],
 ['test-transport-errors.cjs','FRAME_TRANSPORT_ERRORS_COMPLETED',25],
 ['test-transport-only.cjs','FRAME_TRANSPORT_ONLY_COMPLETED',8],
 ['test-worker-global-errors.cjs','FRAME_WORKER_GLOBAL_ERRORS_COMPLETED',10],
 ['test-worker-control-listeners.cjs','FRAME_WORKER_CONTROL_LISTENERS_COMPLETED',6],
 ['test-eventtarget-budget.cjs','FRAME_EVENTTARGET_BUDGET_COMPLETED',4]
];
let checks=0;const rows=[];
for(const [name,sentinel,expected] of suites){
 const result=cp.spawnSync(process.execPath,[path.join(__dirname,name)],{cwd:__dirname,encoding:'utf8',timeout:15000,maxBuffer:2097152});
 requireCompletion(result,name,sentinel);
 const row=JSON.parse(result.stdout.trim());assert.equal(row.checks,expected,name+' check count');checks+=row.checks;
 rows.push({name,checks:row.checks,passed:true});
}
assert.equal(checks,90);
console.log(JSON.stringify({passed:true,completionSentinel:'FRAME_PORTABLE_SLICER_SUITE_COMPLETED',checks,retainedReviewChecks:86,additionalBudgetEventTargetRoutes:4,rows,realSceneRun:false,browserRerun:false,filesWritten:false}));
