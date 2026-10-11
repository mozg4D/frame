'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict'),root=__dirname;
const {run,workerOriginal,printerOriginal}=require('./virtual-frame-task.cjs'),exact=require('./exact-layer-comparison.cjs');
const {worker,printer}=require('../build-progress-only.cjs').build(workerOriginal,printerOriginal);
const begin=worker.indexOf('// Constant-size telemetry.'),end=worker.indexOf('async function frameSliceFinalized(',begin);assert(begin>=0&&end>begin);
const prior=worker.slice(0,begin)+fs.readFileSync(path.join(root,'fixtures/progress-status-reporter-pre-first-stage.js'),'utf8')+'\n'+worker.slice(end);
assert.equal(require('crypto').createHash('sha256').update(prior).digest('hex'),'40dbc7fb492575df76aa02e1c04290610ea461ad8fef48ba9eb3678d7766330b','Exact pre-fix negative control');
const checks=[],rows=[],check=(name,fn)=>{fn();checks.push(name);};
(async()=>{
 const plan={...exact.DEFAULT_PLAN,lastLayer:3,selectedLayers:[1,2,3]};
 for(const prepareOffset of [0,100,499]){
  const captures=[exact.createCapture(plan),exact.createCapture(plan)],results=[];
  for(const [i,source]of [prior,worker].entries())results.push(await run(exact.instrumentForComparison(source,plan),printer,'normal',0,{virtualTime:true,prepareOffset,sectionDuration:600,finalizers:0,onUpdate:captures[i].packet}));
  const [old,current]=results;
  check('pre-fix reproduces missing first section at '+prepareOffset+'ms',()=>{assert.equal(old.sectionEntries[0].status.stage,'preparing');assert.equal(old.sectionEntries[0].status.totalOccupiedLayers,null);});
  check('first section publishes total before synchronous work at '+prepareOffset+'ms',()=>{const q=current.sectionEntries[0].status;assert.equal(q.stage,'section');assert.equal(q.layer,1);assert.equal(q.totalOccupiedLayers,3);assert.equal(q.completedOccupiedLayers,0);assert.equal(q.notification,'stage');});
  check('telemetry does not alter exact paths/provenance/typed angles at '+prepareOffset+'ms',()=>{assert.equal(exact.exactDifference(captures[0].finish(),captures[1].finish()),null);assert(current.result.stats);assert.equal(current.workers,1);assert.equal(current.active,0);assert.equal(current.liveIntervals,0);});
  rows.push({prepareOffset,syntheticSectionMS:600,priorFirst:old.sectionEntries[0],candidateFirst:current.sectionEntries[0]});
 }
 let now=0,callback,packets=[];const c={performance:{now:()=>now},setInterval:f=>(callback=f,1),clearInterval(){}};vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(root,'../progress-status-reporter.js'),'utf8'),c);const status=c.frameSliceStatusReporter(q=>packets.push(structuredClone(q)),'test');status.total(3,3332,3);
 for(let i=0;i<1000;i++)status.mark(['section','building-paths','waiting-workers'][i%3],1);
 check('first-stage exception adds constant packets under rapid stage alternation',()=>assert.equal(packets.length,4));
 status.commit(1,1);now=500;callback();now=3500;callback();
 check('heartbeat keeps completion at 1/3 with fixed commit time',()=>{const q=packets.at(-1);assert.equal(q.notification,'heartbeat');assert.equal(q.completedOccupiedLayers,1);assert.equal(q.totalOccupiedLayers,3);assert.equal(q.lastCommittedElapsedMS,0);});
 const a=printer.indexOf('function framePrinterSliceActivityText('),b=printer.indexOf('\nfunction framePrinterStatus(',a);vm.runInContext(printer.slice(a,b),c);
 check('fresh heartbeat distinguishes status age from completed-layer age',()=>{const text=c.framePrinterSliceActivityText({packet:packets.at(-1),receivedAt:3500},3500);assert.match(text,/1\/3 model layers/);assert.match(text,/last completed layer 3 s ago/);assert(!text.includes('status message'));});status.close();
 const receipt={passed:true,completionSentinel:'FRAME_FIRST_STAGE_COMPLETED',checks:checks.length,checkNames:checks,rows,virtualClockOnly:true,heavyRun:false,realSceneRun:false,policy:'first occurrence of each stage bypasses throttle; repeated transitions remain 500ms throttled'};console.log(JSON.stringify({passed:true,completionSentinel:receipt.completionSentinel,checks:checks.length}));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
