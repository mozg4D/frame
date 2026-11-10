// CPU ordering regression using the actual shipped coalescer and API settle.
// GPU/Morph arithmetic is not emulated or qualified here; native jobs are gates.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const oldAnchor='await editSerial;await appearanceQueue;await FrameMorph.flush();if(api.transforming||heldPointers.size||boxDrag||drag)';
const newAnchor='await editSerial;await appearanceQueue;if(allowGesture){if(gizmoRAF){FrameViewWindows.cancelFrame(gizmoRAF);gizmoRAF=0;if(gizmoSession&&!gizmoSession.ending)applyGizmoEvent(gizmoSession,gizmoSession.event);}await editSerial;flushTransform();}await FrameMorph.flush();if(api.transforming||heldPointers.size||boxDrag||drag)';
function harness(html,{active=true,ready=true,dirty=false,weight=40,target=50,session=true,ending=false}={}){
 const start=html.indexOf('      async function settle(allowGesture=false){'),end=html.indexOf('\n      function describe(',start);
 assert.ok(start>=0&&end>start,'Actual API settlement source is present');
 const settle=html.slice(start,end),moveStart=html.indexOf('    function gizmoPointerMove(event){'),moveEnd=html.indexOf('\n    async function finishGizmo(',moveStart);
 assert.ok(moveStart>=0&&moveEnd>moveStart,'Actual native coalescer source is present');
 const move=html.slice(moveStart,moveEnd);
 return Function('state',`
  const trace=state.trace=[],frames=new Map();let ticket=0,gizmoRAF=0;
  const FrameViewWindows={frame:callback=>{const id=++ticket;frames.set(id,callback);return id;},cancelFrame:id=>{trace.push('cancel-frame');frames.delete(id);}};
  let gizmoSession=state.session?{event:{weight:state.target},ending:state.ending}:null;
  const api={ready:Promise.resolve(),get transforming(){return state.active;}};
  const canvas={dataset:{ready:'true'}},scene={},nodes=[];
  const objectActionQueue=Promise.resolve(),clipboardSerial=Promise.resolve(),appearanceQueue=Promise.resolve();
  let selectionPending=Promise.resolve(),selectionQueue=Promise.resolve(),editSerial=Promise.resolve();
  const heldPointers=new Set(state.active?[1]:[]),boxDrag=null,drag=null,polygonClick=Promise.resolve();
  const loopSerial=Promise.resolve(),replicaQueue=Promise.resolve(),animationSerial=Promise.resolve(),measureQueue=Promise.resolve();
  const wheelBusy=false,pendingWheel=null,loadLibraryObjects=async()=>{};
  const FramePlugins={loadUsed:async()=>{},flush:async()=>{}},FrameGeometry={flush:async()=>{}},FrameSpline={flush:async()=>{}};
  const FrameMorph={flush:async()=>{trace.push('morph-flush');if(state.pendingWeight!==undefined){state.weight=state.pendingWeight;delete state.pendingWeight;trace.push('solve:'+state.weight);}},apply:async()=>{throw Error('No fixture owner should be applied outside the active gesture');}};
  const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
  const applyGizmoEvent=(g,event)=>{if(gizmoSession!==g)return;trace.push('apply:'+event.weight);state.applied++;state.target=event.weight;state.dirty=true;if(!state.ready)editSerial=Promise.resolve().then(()=>{trace.push('prepare-ready');state.ready=true;});};
  const flushTransform=()=>{if(!state.dirty)return;if(!state.ready)throw Error('Preparation was not awaited');trace.push('flush-transform');state.dirty=false;state.pendingWeight=state.target;state.transforms++;};
  ${move}
  ${settle}
  return {settle,move:weight=>gizmoPointerMove({weight}),state,runFrame:async()=>{const callbacks=[...frames.values()];frames.clear();for(const f of callbacks)f();await editSerial;flushTransform();await FrameMorph.flush();},pending:()=>frames.size,gizmoRAF:()=>gizmoRAF,clearSession:()=>{gizmoSession=null;},drainFrameOnly:()=>{const callbacks=[...frames.values()];frames.clear();for(const f of callbacks)f();}};
 `)({active,ready,dirty,weight,target,session,ending,applied:0,transforms:0});
}
export async function morphInputSettlementChecks(html=null){
 html??=await readFile(process.env.FRAME_MORPH_SOURCE?pathToFileURL(process.env.FRAME_MORPH_SOURCE):new URL('../index.html',import.meta.url),'utf8');
 const checks=[],timings=[],check=async(name,fn)=>{await fn();checks.push({name,pass:true});};
 await check('Latest coalesced move is solved before gesture-permitted observation, without releasing the gesture',async()=>{
  const p=harness(html);p.move(50);assert.equal(p.pending(),1);await p.settle(true);assert.equal(p.state.weight,50);assert.equal(p.state.active,true);assert.equal(p.pending(),0);assert.equal(p.state.applied,1);assert.equal(p.state.transforms,1);p.drainFrameOnly();assert.equal(p.state.applied,1);
 });
 await check('Four rendered steps plus a pending fifth reproduce the original40 to expected50 transition',async()=>{
  const p=harness(html,{weight:0});for(const value of [10,20,30,40]){p.move(value);await p.runFrame();}assert.equal(p.state.weight,40);p.move(50);await p.settle(true);assert.equal(p.state.weight,50);assert.equal(p.state.applied,5);assert.equal(p.state.transforms,5);
 });
 await check('Multiple pending pointer moves coalesce once to the latest accepted input',async()=>{
  const p=harness(html);for(const value of [42,44,46,48,50])p.move(value);await p.settle(true);assert.equal(p.state.weight,50);assert.equal(p.state.applied,1);assert.equal(p.pending(),0);
 });
 await check('A drained move waits newly scheduled native preparation before flushing Morph',async()=>{
  const p=harness(html,{ready:false});p.move(50);await p.settle(true);assert.equal(p.state.weight,50);assert(p.state.trace.indexOf('prepare-ready')<p.state.trace.indexOf('flush-transform'));
 });
 await check('A dirty accepted transform is flushed even when the gizmo rAF has already run',async()=>{
  const p=harness(html);p.move(50);p.drainFrameOnly();assert.equal(p.pending(),0);assert.equal(p.state.weight,40);await p.settle(true);assert.equal(p.state.weight,50);assert.equal(p.state.applied,1);
 });
 await check('Mutating commands still reject an active gesture rather than draining its pending event',async()=>{
  const p=harness(html);p.move(50);await assert.rejects(()=>p.settle(false),e=>e.code==='BUSY');assert.equal(p.state.applied,0);assert.equal(p.state.weight,40);assert.equal(p.pending(),1);
 });
 await check('A stale scheduled callback cannot resurrect a closed gesture',async()=>{
  const p=harness(html,{active:false});p.move(50);p.clearSession();await p.settle(true);assert.equal(p.state.weight,40);assert.equal(p.state.applied,0);assert.equal(p.pending(),0);
 });
 await check('No pending or dirty input causes no duplicate native evaluation',async()=>{
  const p=harness(html);await p.settle(true);await p.settle(true);assert.equal(p.state.applied,0);assert.equal(p.state.transforms,0);assert.equal(p.state.weight,40);
 });
 await check('Old source negative control returns the stale fourth-step weight40',async()=>{
  assert.equal(html.split(newAnchor).length,2,'Exactly one reviewed settlement insertion');const old=html.replace(newAnchor,oldAnchor),p=harness(old);p.move(50);await p.settle(true);assert.equal(p.state.weight,40);assert.equal(p.pending(),1);assert.equal(p.state.applied,0);
 });
 await check('Missing native-preparation await negative control is rejected',async()=>{
  const altered=html.replace('applyGizmoEvent(gizmoSession,gizmoSession.event);}await editSerial;flushTransform();','applyGizmoEvent(gizmoSession,gizmoSession.event);}flushTransform();');assert.notEqual(altered,html);const p=harness(altered,{ready:false});p.move(50);await assert.rejects(()=>p.settle(true),/Preparation was not awaited/);
 });
 await check('Ending gesture cancels a pending late move without applying hover as final input',async()=>{
  const p=harness(html,{ending:true});p.move(60);await p.settle(true);assert.equal(p.state.weight,40);assert.equal(p.state.applied,0);assert.equal(p.state.transforms,0);assert.equal(p.pending(),0);p.drainFrameOnly();assert.equal(p.state.applied,0);
 });
 await check('Ending gesture still flushes already accepted dirty final state, without applying a late move',async()=>{
  const p=harness(html,{ending:true,dirty:true,target:50});p.move(60);await p.settle(true);assert.equal(p.state.weight,50);assert.equal(p.state.applied,0);assert.equal(p.state.transforms,1);assert.equal(p.pending(),0);assert.equal(p.state.active,true);
 });
 const started=performance.now();for(let i=0;i<100;i++){const p=harness(html);p.move(50);await p.settle(true);assert.equal(p.state.weight,50);}const ms=performance.now()-started;timings.push({name:'100 completed native-input settlement interleavings',ms,budgetMs:1000});await check('Completed native-input settlement CPU budget',()=>assert.ok(ms<1000));
 return {pass:true,checks,timings,indexSHA256:createHash('sha256').update(html).digest('hex'),scope:'CPU ordering only with actual native coalescer/settle source; inert preparation/transform/Morph adapters. No GPU arithmetic or browser gesture qualification.'};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){let report;try{report=await morphInputSettlementChecks();}catch(e){report={pass:false,error:e.stack};}if(process.env.FRAME_MORPH_REPORT)await writeFile(process.env.FRAME_MORPH_REPORT,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(!report.pass)process.exitCode=1;}
