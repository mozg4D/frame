import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { Worker as NodeWorker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';

const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),start=html.indexOf('function createSceneProgramRuntime('),end=html.indexOf('function createSceneProgramPlans(',start);
assert.ok(start>=0&&end>start);const source=html.slice(start,end).trim();
const createSceneProgramRuntime=Function(source+'\nreturn createSceneProgramRuntime;')();
const elapsed=()=>performance.now();
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let count=0,number=0;const timings=[],workerAdapters=new Set();
function check(condition,message){assert.ok(condition,message);count++;}
function equal(actual,expected,message){assert.deepEqual(actual,expected,message);count++;}
async function rejects(fn,code,message){await assert.rejects(fn,e=>e.code===code,message);count++;}
function throws(fn,code,message){assert.throws(fn,e=>e.code===code,message);count++;}
function workerAdapter(text,name){
  const prelude=`const {parentPort}=require('node:worker_threads');
    globalThis.onmessage=null;globalThis.self=globalThis;
    globalThis.postMessage=(value,transfer=[])=>parentPort.postMessage(value,transfer);
    parentPort.on('message',data=>globalThis.onmessage?.({data}));
    let moduleSerial=0;
    globalThis.Blob=class {constructor(parts){this.parts=parts;}};
    URL.createObjectURL=blob=>'data:text/javascript;base64,'+Buffer.from(blob.parts.join('')).toString('base64')+'#module-'+(++moduleSerial);
    URL.revokeObjectURL=()=>{};\n`;
  const native=new NodeWorker(prelude+text,{eval:true,name});
  const adapter={onmessage:null,onerror:null,onmessageerror:null,postMessage:(value,transfer=[])=>native.postMessage(value,transfer),terminate(){workerAdapters.delete(adapter);return native.terminate();}};
  native.on('message',data=>adapter.onmessage?.({data}));native.on('error',error=>adapter.onerror?.({message:error.message,preventDefault(){}}));native.on('messageerror',()=>adapter.onmessageerror?.({}));workerAdapters.add(adapter);return adapter;
}
function plan(id,text,options={}){
  return {owner:'scene',id,name:'Program '+id,signature:'signature-'+id+'-0',source:{owner:'scene',id:'source-'+id,revision:0,text},imports:{},bindings:{size:{owner:'native-cube',field:'param:size x'}},params:{value:3},context:'main',start:'manual',availability:'available',...options};
}
function harness(plans=[]){
  const h={document:{token:'document-'+(++number),ready:true},plans:new Map(plans.map(p=>[JSON.stringify([p.owner,p.id]),p])),events:[],calls:[],core:{value:7},tail:Promise.resolve(),hold:null,createdWorkers:0};
  const getPlan=({owner,id})=>h.plans.get(JSON.stringify([owner,id]));let urlSerial=0;
  h.services={getDocument:()=>h.document,readPlans:()=>[...h.plans.values()],getPlan,
    listTools:()=>[{name:'fields.write'},{name:'anything.else'}],getCore:()=>h.core,onStatus:event=>h.events.push(event),
    moduleURL:text=>'data:text/javascript;base64,'+Buffer.from(text).toString('base64')+'#main-'+number+'-'+(++urlSerial),
    createWorker:(text,name)=>{h.createdWorkers++;return workerAdapter(text,name);},
    call(name,args,guard){guard();const run=h.tail.then(async()=>{if(h.hold)await h.hold;guard();h.calls.push({name,args});return {name,args};});h.tail=run.catch(()=>{});return run;}
  };
  h.runtime=createSceneProgramRuntime(h.services);
  h.set=p=>h.plans.set(JSON.stringify([p.owner,p.id]),p);
  return h;
}
async function done(runtime,receipt,limit=3000){
  const start=elapsed();let state;
  do{state=runtime.poll(receipt);if(!['queued','running'].includes(state.state))return state;await delay(2);}while(elapsed()-start<limit);
  throw new Error('Timed out waiting for '+JSON.stringify(state));
}
async function completed(runtime,receipt,limit){const job=await done(runtime,receipt,limit);assert.equal(job.state,'completed',JSON.stringify(job));count++;return job.result;}
async function test(name,fn,budget=4000){const start=elapsed();await fn();const ms=elapsed()-start;check(ms<budget,name+' operation latency budget '+budget+'ms');timings.push({name,ms,budget});}

try {
await test('inert source and empty runtime create no workers or scheduled callbacks',async()=>{
  const h=harness([plan('inert','throw new Error("Must not execute")')]);h.runtime.reconcile();await delay(15);
  equal(h.createdWorkers,0);equal(h.runtime.status().instances,[]);equal(h.runtime.status().jobs.pending,0);h.runtime.dispose();
});
await test('prompt receipts, real ESM, main access, independent activation state, same namespace',async()=>{
  globalThis.__sceneMain={activations:0,disposed:0};
  const text=`let loaded=0; const namespaceMarker=++loaded;
    export async function activate(ctx){globalThis.__sceneMain.activations++;let value=ctx.params.value;ctx.cleanup(()=>globalThis.__sceneMain.disposed++);
    return {exports:{next:()=>++value,core:()=>ctx.core.value,marker:()=>namespaceMarker,tools:()=>ctx.listTools(),call:()=>ctx.call('anything.else',{from:ctx.id})}};}`;
  const a=plan('a',text),b=plan('b',text,{source:a.source});const h=harness([a,b]);
  const t=elapsed(),ra=h.runtime.start(a),rb=h.runtime.start(b);check(elapsed()-t<20,'start receipts are synchronous');equal(ra.state,'queued');equal(globalThis.__sceneMain.activations,0,'not executed in caller FIFO turn');
  await completed(h.runtime,ra);await completed(h.runtime,rb);
  equal(await h.runtime.invokeDirect({...a,method:'next'}),4);equal(await h.runtime.invokeDirect({...b,method:'next'}),4);equal(await h.runtime.invokeDirect({...a,method:'next'}),5);
  equal(h.runtime.status().main.modules,1,'same source revision imported once');equal(await h.runtime.invokeDirect({...a,method:'marker'}),1);
  h.core={value:91};equal(await h.runtime.invokeDirect({...a,method:'core'}),91,'live core getter');equal((await h.runtime.invokeDirect({...a,method:'tools'})).length,2);
  await completed(h.runtime,h.runtime.invoke({...a,method:'call'}));equal(h.calls[0].name,'anything.else','no tool whitelist');
  await completed(h.runtime,h.runtime.stop(a));equal(globalThis.__sceneMain.disposed,1);equal(h.runtime.status(b).state,'running');h.runtime.dispose();await delay(5);equal(globalThis.__sceneMain.disposed,2);delete globalThis.__sceneMain;
});
await test('internal dependency imports and external ESM imports keep exact source text',async()=>{
  const library={owner:'scene',id:'dependency',revision:0,text:'export const value=23;'};
  const p=plan('imports',`import {strictEqual} from 'node:assert'; export async function activate(ctx){const library=await ctx.import('math');strictEqual(library.value,23);return {exports:{answer:()=>library.value+ctx.params.value}};}`,{imports:{math:library}});
  const h=harness([p]);await completed(h.runtime,h.runtime.start(p));equal(await h.runtime.invokeDirect({...p,method:'answer'}),26);equal(h.runtime.status().main.modules,2);equal(h.services.getPlan(p).source.text,p.source.text);h.runtime.dispose();
});
await test('ordinary FIFO activation API call does not deadlock start receipts',async()=>{
  const p=plan('api-init',`export async function activate(ctx){const result=await ctx.frame.call('arbitrary.test',{v:1});return {exports:{value:()=>result.args.v}};}`),h=harness([p]);
  let receipt;await (h.tail=h.tail.then(()=>{receipt=h.runtime.start(p);}));await completed(h.runtime,receipt);equal(await h.runtime.invokeDirect({...p,method:'value'}),1);h.runtime.dispose();
});
await test('managed API guards reject late queued commands after source changes',async()=>{
  const p=plan('guard',`export function activate(ctx){return {exports:{write:()=>ctx.call('fields.write',{value:8})}};}`),h=harness([p]);await completed(h.runtime,h.runtime.start(p));
  let release;h.hold=new Promise(resolve=>release=resolve);const pending=h.runtime.invokeDirect({...p,method:'write'});await delay(5);
  h.set({...p,signature:'changed-without-event'});release();await rejects(()=>pending,'STALE_INSTANCE');equal(h.calls.length,0,'queued write fenced at execution');
  await rejects(()=>h.runtime.invokeDirect({...p,method:'write'}),'STALE_INSTANCE');h.runtime.dispose();
});
await test('unrelated Undo does not restart; source change restarts; explicit stop remains stopped',async()=>{
  globalThis.__sceneRestart={starts:0};const p=plan('restart',`export function activate(ctx){globalThis.__sceneRestart.starts++;return {exports:{value:()=>ctx.params.value}};}`,{start:'ready'}),h=harness([p]);
  await completed(h.runtime,h.runtime.reconcile().jobs[0]);const generation=h.runtime.status(p).generation;
  h.document.epoch=999;h.runtime.reconcile({reason:'undo'});equal(h.runtime.status(p).generation,generation);equal(globalThis.__sceneRestart.starts,1);
  const q={...p,params:{value:9},signature:'new-param'};h.set(q);await completed(h.runtime,h.runtime.reconcile().jobs[0]);equal(await h.runtime.invokeDirect({...p,method:'value'}),9);equal(globalThis.__sceneRestart.starts,2);
  await completed(h.runtime,h.runtime.stop(p));h.set({...q,signature:'another-edit'});h.runtime.reconcile();await delay(10);equal(h.runtime.status(p).state,'stopped');equal(globalThis.__sceneRestart.starts,2);
  h.document={token:'replacement',ready:true};await completed(h.runtime,h.runtime.reconcile().jobs[0]);equal(globalThis.__sceneRestart.starts,3);h.runtime.dispose();delete globalThis.__sceneRestart;
});
await test('pending main initialization cannot delay stop, late cleanup executes immediately',async()=>{
  let resolveInit;globalThis.__sceneLate={ready:new Promise(resolve=>resolveInit=resolve),cleaned:0};
  const p=plan('late',`export async function activate(ctx){await globalThis.__sceneLate.ready;ctx.cleanup(()=>globalThis.__sceneLate.cleaned++);return {dispose(){globalThis.__sceneLate.cleaned++;}};}`),h=harness([p]);
  const start=h.runtime.start(p);await delay(10);const t=elapsed();await completed(h.runtime,h.runtime.stop(p));check(elapsed()-t<100,'stop does not await pending init');equal(h.runtime.poll(start).state,'cancelled');resolveInit();await delay(10);equal(globalThis.__sceneLate.cleaned,2);h.runtime.dispose();delete globalThis.__sceneLate;
});
await test('main DOM/listener/timer/resource cleanup lifecycle using CPU EventTarget fixture',async()=>{
  const node=new EventTarget();node.removed=false;node.remove=()=>node.removed=true;globalThis.__sceneDOM={node,clicks:0,timers:0};
  const p=plan('dom',`export function activate(ctx){const node=ctx.resources.dom(globalThis.__sceneDOM.node);ctx.resources.listen(node,'click',()=>globalThis.__sceneDOM.clicks++);ctx.resources.timeout(()=>globalThis.__sceneDOM.timers++,1000);return {exports:{click:()=>{node.dispatchEvent(new Event('click'));return globalThis.__sceneDOM.clicks;}}};}`),h=harness([p]);
  await completed(h.runtime,h.runtime.start(p));equal(await h.runtime.invokeDirect({...p,method:'click'}),1);equal(h.runtime.status().main.resources,3);await completed(h.runtime,h.runtime.stop(p));node.dispatchEvent(new Event('click'));check(node.removed);equal(globalThis.__sceneDOM.clicks,1);equal(h.runtime.status().main.resources,0);h.runtime.dispose();delete globalThis.__sceneDOM;
});
await test('named Workers share realm; independent names use independent threads; main and worker overlap',async()=>{
  const text=`import {threadId} from 'node:worker_threads';let loads=0;const loaded=++loads;export function activate(ctx){let n=0;return {exports:{identity:()=>({threadId,loaded,n:++n,dom:typeof document}),spin:ms=>{const start=performance.now();while(performance.now()-start<ms){};return {start,end:performance.now(),origin:performance.timeOrigin};}}};}`;
  const a=plan('worker-a',text,{context:'worker:shared'}),b=plan('worker-b',text,{context:'worker:shared',source:a.source}),c=plan('worker-c',text,{context:'worker:other'}),h=harness([a,b,c]);
  await Promise.all([a,b,c].map(p=>completed(h.runtime,h.runtime.start(p))));equal(h.createdWorkers,2);const ia=await h.runtime.invokeDirect({...a,method:'identity'}),ib=await h.runtime.invokeDirect({...b,method:'identity'}),ic=await h.runtime.invokeDirect({...c,method:'identity'});equal(ia.threadId,ib.threadId);check(ia.threadId!==ic.threadId);equal(ia.n,1);equal(ib.n,1);equal(ia.dom,'undefined');
  const both=await Promise.all([a,c].map(p=>h.runtime.invokeDirect({...p,method:'spin',args:[160]})));const overlap=Math.min(...both.map(r=>r.origin+r.end))-Math.max(...both.map(r=>r.origin+r.start));check(overlap>70,'independent Workers overlap execution');
  const workerSpin=h.runtime.invokeDirect({...a,method:'spin',args:[300]});await delay(30);const mainStart=performance.timeOrigin+elapsed();while(performance.timeOrigin+elapsed()-mainStart<150){}const mainEnd=performance.timeOrigin+elapsed(),workerTimes=await workerSpin;check(Math.min(mainEnd,workerTimes.origin+workerTimes.end)-Math.max(mainStart,workerTimes.origin+workerTimes.start)>50,'main and Worker execute overlapping CPU work');
  await completed(h.runtime,h.runtime.stop(a));equal(h.runtime.status(b).state,'running','cooperative stop preserves shared peer');equal((await h.runtime.invokeDirect({...b,method:'identity'})).n,2);equal(h.runtime.status().contexts.length,2);
  const terminated=await completed(h.runtime,h.runtime.terminateContext({context:'worker:shared'}));equal(terminated.affected,[{owner:b.owner,id:b.id}]);equal(h.runtime.status(b).state,'stopped');equal(h.runtime.status(c).state,'running');h.runtime.dispose();
});
await test('structured messaging transfers typed buffers both directions, JSON jobs reject typed results',async()=>{
  const text=`export function activate(ctx){return {exports:{typed:()=>new Uint8Array([5,6]),big:()=>1n},onMessage(data){data.values[0]+=10;return ctx.transfer({values:data.values},[data.values.buffer]);}};}`;
  for(const context of ['main','worker:transfer']){const p=plan('transfer-'+context,text,{context}),h=harness([p]);await completed(h.runtime,h.runtime.start(p));
    const values=new Uint8Array([1,2,3]),resultPromise=h.runtime.postMessage({...p,data:{values},transfer:[values.buffer]});equal(values.byteLength,0,'caller ArrayBuffer detached synchronously');const result=await resultPromise;check(result.values instanceof Uint8Array);equal([...result.values],[11,2,3]);
    const typed=await h.runtime.invokeDirect({...p,method:'typed'});check(typed instanceof Uint8Array);equal([...typed],[5,6]);equal((await done(h.runtime,h.runtime.invoke({...p,method:'typed'}))).error.code,'RESULT_NOT_JSON');equal((await done(h.runtime,h.runtime.invoke({...p,method:'big'}))).error.code,'RESULT_NOT_JSON');h.runtime.dispose();
  }
});
await test('program errors and missing dependencies isolate healthy programs',async()=>{
  const good=plan('good','export const answer=()=>42;', {context:'worker:isolated'}),bad=plan('bad','throw new Error("bad init");',{context:'worker:isolated'}),missing=plan('missing','',{availability:'missing-source'}),h=harness([good,bad,missing]);
  throws(()=>h.runtime.start(missing),'UNAVAILABLE_PROGRAM');const receipts=[h.runtime.start(good),h.runtime.start(bad)];await completed(h.runtime,receipts[0]);equal((await done(h.runtime,receipts[1])).state,'error');equal(await h.runtime.invokeDirect({...good,method:'answer'}),42);equal(h.runtime.status(good).state,'running');h.runtime.dispose();
});
await test('hung Worker cooperative stop stays pending, forced termination cancels it honestly',async()=>{
  const p=plan('hung','export const hang=()=>{while(true){}};',{context:'worker:hung'}),h=harness([p]);await completed(h.runtime,h.runtime.start(p));const invoke=h.runtime.invoke({...p,method:'hang'});await delay(20);const stop=h.runtime.stop(p);await delay(20);equal(h.runtime.poll(invoke).state,'cancelled');equal(h.runtime.poll(stop).state,'running');equal(h.runtime.status(p).state,'stopping');
  await completed(h.runtime,h.runtime.terminateContext({context:p.context}));await completed(h.runtime,stop);equal(h.runtime.status().contexts.length,0);h.runtime.dispose();
});
await test('document replacement promptly terminates Workers and blocks old activations',async()=>{
  const p=plan('document','export function activate(ctx){return {exports:{write:()=>ctx.call("fields.write",{})}};}',{context:'worker:document'}),h=harness([p]);await completed(h.runtime,h.runtime.start(p));let release;h.hold=new Promise(resolve=>release=resolve);const pending=h.runtime.invokeDirect({...p,method:'write'});const rejection=rejects(()=>pending,'CONTEXT_TERMINATED');await delay(10);h.document={token:'next-document',ready:false};h.runtime.reconcile();release();await rejection;await delay(5);equal(h.calls.length,0);equal(h.runtime.status().contexts.length,0);equal(h.runtime.status().instances.length,0);h.runtime.dispose();
});
await test('bounded jobs/results and correct idle status',async()=>{
  const p=plan('bounded','export const value=()=>3; export const huge=()=>"x".repeat(70000);'),h=harness([p]);await completed(h.runtime,h.runtime.start(p));equal((await done(h.runtime,h.runtime.invoke({...p,method:'huge'}))).error.code,'RESULT_LIMIT');
  let first;for(let n=0;n<145;n++){const receipt=h.runtime.invoke({...p,method:'value'});if(!n)first=receipt;await completed(h.runtime,receipt);}equal(h.runtime.status().jobs.retained,128);throws(()=>h.runtime.poll(first),'MISSING_JOB');equal(h.runtime.status().jobs.pending,0);h.runtime.dispose();
});
await test('temporary document readiness fences commands without killing unchanged activation',async()=>{
  let release;globalThis.__readyGate=new Promise(resolve=>release=resolve);
  const p=plan('ready-gate',`export async function activate(ctx){await globalThis.__readyGate;return {exports:{write:()=>ctx.call('fields.write',{})}};}`),h=harness([p]);const receipt=h.runtime.start(p);await delay(10);const generation=h.runtime.status(p).generation;
  h.document.ready=false;h.runtime.reconcile({reason:'undo-busy'});release();await completed(h.runtime,receipt);equal(h.runtime.status(p).state,'running');await rejects(()=>h.runtime.invokeDirect({...p,method:'write'}),'NOT_READY');h.document.ready=true;h.runtime.reconcile({reason:'undo-completed'});equal(h.runtime.status(p).generation,generation);await h.runtime.invokeDirect({...p,method:'write'});equal(h.calls.length,1);h.runtime.dispose();delete globalThis.__readyGate;
});
await test('disabled dependencies suspend and resume, explicit stop stays stopped',async()=>{
  for(const context of ['main','worker:availability']){const p=plan('availability','export const value=()=>1;',{context}),h=harness([p]);await completed(h.runtime,h.runtime.start(p));h.set({...p,availability:'disabled'});h.runtime.reconcile();await delay(30);equal(h.runtime.status(p).state,'stopped');h.set(p);await completed(h.runtime,h.runtime.reconcile().jobs[0]);equal(h.runtime.status(p).state,'running');await completed(h.runtime,h.runtime.stop(p));h.set({...p,availability:'disabled'});h.runtime.reconcile();h.set(p);h.runtime.reconcile();equal(h.runtime.status(p).state,'stopped');h.runtime.dispose();}
});
await test('unsettled native hooks remain bounded even after cancellation',async()=>{
  let release;globalThis.__workGate=new Promise(resolve=>release=resolve);const p=plan('work-limit','export const pending=()=>globalThis.__workGate;'),h=harness([p]);await completed(h.runtime,h.runtime.start(p));const pending=[];
  for(let n=0;n<128;n++)pending.push(h.runtime.invokeDirect({...p,method:'pending'}).catch(e=>e.code));equal(h.runtime.status().main.pendingWork,128);await rejects(()=>h.runtime.invokeDirect({...p,method:'pending'}),'WORK_LIMIT');await completed(h.runtime,h.runtime.stop(p));equal(h.runtime.status().main.pendingWork,128,'stopping cannot pretend to cancel arbitrary pending JS');release(null);await Promise.all(pending);equal(h.runtime.status().main.pendingWork,0);h.runtime.dispose();delete globalThis.__workGate;
});
await test('autostart proceeds in bounded waves and force termination is available at the job limit',async()=>{
  const shared={owner:'scene',id:'wave-source',revision:0,text:'export const answer=()=>42;'};
  const plans=Array.from({length:70},(_,i)=>plan('wave-'+i,shared.text,{source:shared,start:'ready'})),h=harness(plans);h.runtime.reconcile();const deadline=elapsed()+1500;while(h.runtime.status().instances.filter(i=>i.state==='running').length<70&&elapsed()<deadline)await delay(5);equal(h.runtime.status().instances.filter(i=>i.state==='running').length,70);equal(h.runtime.status().main.modules,1);h.runtime.dispose();
  const p=plan('capacity-hung','export const hang=()=>new Promise(()=>{});',{context:'worker:capacity'}),w=harness([p]);await completed(w.runtime,w.runtime.start(p));for(let n=0;n<64;n++)w.runtime.invoke({...p,method:'hang'});throws(()=>w.runtime.invoke({...p,method:'hang'}),'JOB_LIMIT');await completed(w.runtime,w.runtime.terminateContext({context:p.context}));equal(w.runtime.status().contexts.length,0);w.runtime.dispose();
});
await test('readiness loss between admission and scheduled launch retries without immortal queued activation',async()=>{
  const p=plan('admitted-ready','export const value=()=>9;'),h=harness([p]);const receipt=h.runtime.start(p);h.document.ready=false;
  equal((await done(h.runtime,receipt)).error.code,'NOT_READY');equal(h.runtime.status(p).state,'error');equal(h.runtime.status(p).reason,'native-not-ready');
  h.document.ready=true;const resumed=h.runtime.reconcile();equal(resumed.jobs.length,1);await completed(h.runtime,resumed.jobs[0]);equal(await h.runtime.invokeDirect({...p,method:'value'}),9);h.runtime.dispose();
});
await test('live edit preserves desired restart when job admission is saturated',async()=>{
 let release;globalThis.__restartGate=new Promise(r=>release=r);const a=plan('restart-a','export const version=()=>1;'),b=plan('restart-b','export const hold=()=>globalThis.__restartGate;'),h=harness([a,b]);
 await completed(h.runtime,h.runtime.start(a));await completed(h.runtime,h.runtime.start(b));const pending=[];for(let n=0;n<64;n++)pending.push(h.runtime.invoke({...b,method:'hold'}));
 h.set({...a,signature:'new-a',source:{...a.source,revision:1,text:'export const version=()=>2;'}});h.runtime.reconcile();equal(h.runtime.status(a).desired,true);await delay(10);equal(h.runtime.status(a).state,'stopped');
 release(null);for(const receipt of pending)await completed(h.runtime,receipt);const deadline=elapsed()+1000;while(h.runtime.status(a).state!=='running'&&elapsed()<deadline)await delay(2);equal(h.runtime.status(a).state,'running');equal(await h.runtime.invokeDirect({...a,method:'version'}),2);h.runtime.dispose();delete globalThis.__restartGate;
});
await test('cooperative Worker stop retains reserved bounded admission at SDK request capacity',async()=>{
 const p=plan('stop-capacity',`export function activate(ctx){ctx.resources.interval(()=>{},10);return {exports:{hold:()=>new Promise(r=>setTimeout(()=>r(null),100))}};}`,{context:'worker:stop-capacity'}),h=harness([p]);await completed(h.runtime,h.runtime.start(p));const requests=[];for(let n=0;n<128;n++)requests.push(h.runtime.invokeDirect({...p,method:'hold'}).catch(e=>e.code));
 equal(h.runtime.status().contexts[0].pendingRequests,128);await completed(h.runtime,h.runtime.stop(p));equal(h.runtime.status(p).state,'stopped');equal(h.runtime.status().contexts.length,0);await Promise.all(requests);h.runtime.dispose();
});
console.log(JSON.stringify({passed:true,assertions:count,timings,sourceSHA256:createHash('sha256').update(source).digest('hex'),scope:'CPU native ESM and actual Node Workers; no browser, WebGPU, Frame UI or HASH qualification'},null,2));
await writeFile(new URL('./results/scene-program-runtime.json',import.meta.url),JSON.stringify({passed:true,assertions:count,timings,sourceSHA256:createHash('sha256').update(source).digest('hex')},null,2));
} finally {for(const adapter of workerAdapters)adapter.terminate();}
