// Execute the shipped FIFO and registry admission with controllable Doc leases.
// Native data validation/history are covered by the companion data suites.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const fragment=(a,b='\n')=>{const at=html.indexOf(a),end=html.indexOf(b,at+a.length);assert.ok(at>=0&&end>at,a);return html.slice(at,end);};
const queue=fragment('let documentationWindow=null;','      async function settleDocument'),call=fragment('async function call(name,args={},bridgeGuard=null)');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=async()=>{for(let i=0;i<100;i++)await Promise.resolve();};
function env(){
 const events=[],c={events,tail:Promise.resolve(),sequence:0,nativeIOBusy:false,scene:{},FrameAuthorData:{ready:true,json:x=>structuredClone(x),busy:false},undoBusy:false,frameUITransaction:0,numericSession:null,treeGesture:null,api:{ready:Promise.resolve(),transforming:false},heldPointers:new Set(),boxDrag:null,drag:null,docs:{get:()=>({version:'epoch:0'})},tools:new Map(),validate:()=>{},json:x=>structuredClone(x),fail:(code,message)=>{throw Object.assign(Error(message),{code});},settle:async()=>{events.push('settle');},window:{dispatchEvent:()=>{}},CustomEvent:class{},canvas:{dataset:{ready:'true'}},objectActionQueue:Promise.resolve(),clipboardSerial:Promise.resolve(),selectionQueue:Promise.resolve(),editSerial:Promise.resolve(),appearanceQueue:Promise.resolve(),replicaQueue:Promise.resolve(),animationSerial:Promise.resolve()};
 vm.createContext(c);
 vm.runInContext(queue+fragment('async function settleDocument(replace=false)')+'\n'+fragment('frameNativeFileTask=(run,')+'\n'+call+'\nfunction popup(value){documentationWindow=value;}',c);
 c.register=(name,run,{authoringData=false,dataOnly=false}={})=>c.tools.set(name,{inputSchema:{},annotations:{readOnlyHint:dataOnly},authoringData,dataOnly,run});
 c.register('authorData.get',()=>{events.push('data-read');return 'data';},{authoringData:true,dataOnly:true});
 c.register('fields.write',()=>{events.push('field-write');return 'written';},{authoringData:true});
 c.register('docs.update',()=>{events.push('doc-write');return 'saved';});
 c.register('scene.new',()=>{events.push('replace');c.FrameAuthorData.ready=true;return 'new';});
 return c;
}
const checks=[];
async function check(name,fn){const start=performance.now();try{await fn();const elapsedMs=performance.now()-start;assert.ok(elapsedMs<1000);checks.push({name,pass:true,elapsedMs,budgetMs:1000});}catch(e){checks.push({name,pass:false,error:e.stack});}}
await check('Doc replacement seal reserves FIFO ahead of data read and field write',async()=>{
 const c=env(),gate=deferred();c.popup({seal:async()=>{c.events.push('seal');await gate.promise;return {verify(){c.events.push('verify');},release(){c.events.push('release');}};}});
 const file=c.call('scene.new');await tick();const read=c.call('authorData.get'),write=c.call('fields.write');await tick();
 assert.deepEqual(c.events,['settle','seal']);gate.resolve();await Promise.all([file,read,write]);
 assert.ok(c.events.indexOf('release')<c.events.indexOf('data-read'));assert.ok(c.events.indexOf('data-read')<c.events.indexOf('field-write'));assert.equal(c.events.filter(x=>x==='field-write').length,1);
});
await check('Verified popup bridge drains inside Save barrier without waiting on itself',async()=>{
 const c=env();c.popup({seal:async({mode})=>{assert.equal(mode,'save');c.events.push('seal');await c.call('docs.update',{},()=>{});return {verify(){c.events.push('verify');},release(){}};}});
 await c.frameNativeFileTask(async()=>c.events.push('save'));
 assert.ok(c.events.indexOf('doc-write')<c.events.indexOf('save'));assert.ok(c.events.indexOf('verify')<c.events.indexOf('save'));
});
await check('Rejected seal cancels replacement then permits queued metadata without stale effects',async()=>{
 const c=env(),gate=deferred();c.popup({seal:async()=>{await gate.promise;throw Error('draft conflict');}});
 const file=assert.rejects(c.call('scene.new'),/draft conflict/);await tick();const read=c.call('authorData.get');gate.resolve();await file;assert.equal(await read,'data');assert.ok(!c.events.includes('replace'));
});
await check('Queued data operation rechecks native authoring readiness after failed replacement',async()=>{
 const c=env(),gate=deferred();c.register('scene.new',async()=>{await gate.promise;c.FrameAuthorData.ready=false;throw Error('install failed');});
 const file=assert.rejects(c.call('scene.new'),/install failed/);await tick();const read=assert.rejects(c.call('authorData.get'),e=>e.code==='NOT_READY');gate.resolve();await Promise.all([file,read]);assert.ok(!c.events.includes('data-read'));
});
await check('File prepare remains before Doc seal and native publication',async()=>{
 const c=env();c.popup({seal:async()=>{c.events.push('seal');return {verify(){},release(){}};}});
 await c.frameNativeFileTask(async()=>c.events.push('save'),{prepare:async()=>c.events.push('prepare')});assert.deepEqual(c.events,['settle','prepare','seal','save','settle']);
});
const report={pass:checks.every(x=>x.pass),checks,indexSHA256:createHash('sha256').update(html).digest('hex'),browserVerified:false,gpuVerified:false};
await mkdir(new URL('./results/',import.meta.url),{recursive:true});await writeFile(new URL('./results/scene-data-docs-barrier.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(!report.pass)process.exitCode=1;
