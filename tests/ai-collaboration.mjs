import assert from 'node:assert/strict';
import {webcrypto,createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {keySource} from './hash-codec-fixture.mjs';

const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const fragment=(a,b='\n')=>{const at=html.indexOf(a),end=html.indexOf(b,at+a.length);assert.ok(at>=0&&end>at,a);return html.slice(at,end);};
const A='a'.repeat(32),B='b'.repeat(32),C='c'.repeat(32);
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:()=>resolve()};};
async function waitForAdmission(editor,session,requestId){
 const deadline=performance.now()+1500;
 for(;;){
  try{
   const receipt=await editor.call('collab.request',{session,requestId});
   assert.equal(receipt.state,'pending');
   return receipt;
  }catch(error){
   if(error.code!=='NOT_FOUND'||performance.now()>=deadline)throw error;
  }
  await new Promise(resolve=>setImmediate(resolve));
 }
}
function environment(){
 const hooks={time:1000,wait:null,effects:0};
 const code=`
 ${keySource}
 const nodes=[{id:'a',nativeHash:input.A,parent:null},{id:'b',nativeHash:input.B,parent:'a'},{id:'c',nativeHash:input.C,parent:null}],tools=new Map(),copy=structuredClone;
 const FrameAuthorData={documentToken:'document-1',epoch:'epoch-1',generation:0,ready:true};
 let tail=Promise.resolve(),sequence=0,nativeIOBusy=false,undoBusy=false,frameUITransaction=0,numericSession=null,treeGesture=null;
 const api={ready:Promise.resolve(),transforming:false},scene={},heldPointers=new Set(),boxDrag=null,drag=null,window={dispatchEvent(){}},CustomEvent=class{},docs={get:()=>({version:'doc:0'})};
 const settle=async()=>{},settleDocument=settle,anyParams={type:'object',properties:{},additionalProperties:true};
 ${fragment('      const fail=(code,message)=>')}
 ${fragment('      function validate(s,v,path=', '      const register=')}
 ${fragment('      const register=')}
 ${fragment('      let documentationWindow=null;', '      async function settleDocument')}
 ${fragment('      const batchCommand=', "      register('tag.list'")}
 register('scene.update','fixture',required(obj({id:str,name:str}),'id','name'),false,async a=>{if(hooks.wait)await hooks.wait;const n=nodes.find(n=>n.nativeHash===a.id);if(!n)fail('NOT_FOUND','Missing fixture owner');hooks.effects++;n.name=a.name;FrameAuthorData.generation++;return {hash:n.nativeHash,name:n.name};});
 register('scene.new','fixture',obj({}),false,()=>{FrameAuthorData.documentToken='document-'+crypto.randomUUID();FrameAuthorData.epoch=crypto.randomUUID();FrameAuthorData.generation=0;return {new:true};});
 register('scene.fail','fixture',obj({}),false,()=>{throw Object.assign(Error('fixture failure'),{code:'FIXTURE'});});
 register('scene.large','fixture',obj({}),false,()=>{hooks.effects++;return 'x'.repeat(300000);});
 ${fragment('    function createFrameCollaboration(', '    function initializeFrameAI(').replace('clock=Date.now','clock=()=>hooks.time')}
 ${fragment('      async function call(name,args={},bridgeGuard=')}
 ${fragment('      const collaboration=createFrameCollaboration(', '      const listTools=')}
 return {call,nodes,data:FrameAuthorData,block:v=>nativeIOBusy=v};
 `;
 return {...new Function('input','hooks','crypto',code)({A,B,C},hooks,webcrypto),hooks};
}

export async function collaborationChecks(){
 const checks=[];
 async function check(name,fn,budgetMs=2000){const start=performance.now();try{await fn();const elapsedMs=performance.now()-start;assert.ok(elapsedMs<budgetMs,`${elapsedMs} >= ${budgetMs}`);checks.push({name,pass:true,elapsedMs,budgetMs});}catch(error){checks.push({name,pass:false,error:error.stack});}}
 const join=async(e,name='Chat',ttlSeconds=1800)=>(await e.call('collab.join',{name,ttlSeconds})).participant.id;
 const run=(e,session,id,name='scene.update',args={id:A,name:id},extra={})=>e.call('collab.run',{session,requestId:id,name,args,...extra});

 await check('Advisory scopes overlap through ancestors and live reparenting; native writes stay unrestricted',async()=>{
  const e=environment(),a=await join(e,'A'),b=await join(e,'B');const first=await e.call('collab.claim',{session:a,ids:[A],task:'Assembly'}),second=await e.call('collab.claim',{session:b,ids:[B]});assert.equal(second.advisory,true);assert.equal(second.overlapCount,1);
  await run(e,b,'free-write');assert.equal(e.nodes[0].name,'free-write');assert.equal((await e.call('collab.claims',{ids:[B]})).total,2);
  e.nodes[1].parent='c';assert.equal((await e.call('collab.claims',{ids:[B]})).total,1);assert.equal((await e.call('collab.claims',{ids:[A]})).total,1);
  await assert.rejects(e.call('collab.release',{session:b,claim:first.claim.id}),x=>x.code==='NOT_OWNER');await e.call('collab.release',{session:a});assert.equal((await e.call('collab.claims')).total,1);
 });
 await check('Invalid scopes and names reject before publishing notes; pagination has no participant cap',async()=>{
  const e=environment();await assert.rejects(e.call('collab.join',{name:' '}));const a=await join(e);await assert.rejects(e.call('collab.claim',{session:a,ids:[A,'missing']}));assert.equal((await e.call('collab.claims')).total,0);
  for(let i=0;i<130;i++)await join(e,'Chat '+i);const first=await e.call('collab.participants',{limit:100}),last=await e.call('collab.participants',{offset:first.nextOffset});assert.equal(first.total,131);assert.equal(last.items.length,31);
 });
 await check('Heartbeat, idle expiry, leave and pending work cleanup use no background timer',async()=>{
  const e=environment(),a=await join(e,'A',1);await e.call('collab.claim',{session:a,ids:[A]});e.hooks.time+=900;await e.call('collab.update',{session:a});e.hooks.time+=900;assert.equal((await e.call('collab.participants')).total,1);
  const gate=deferred();e.hooks.wait=gate.promise;const pending=run(e,a,'pending');await waitForAdmission(e,a,'pending');e.hooks.time+=3000;assert.equal((await e.call('collab.participants')).total,1);gate.resolve();await pending;e.hooks.time+=1001;assert.equal((await e.call('collab.participants')).total,0);assert.equal((await e.call('collab.claims')).total,0);await assert.rejects(run(e,a,'expired'),x=>x.code==='SESSION_EXPIRED');assert.equal((await e.call('collab.leave',{session:a})).left,false);
 });
 await check('In-flight duplicate requests share one execution; changed arguments cannot reuse an ID',async()=>{
  const e=environment(),a=await join(e),gate=deferred();e.hooks.wait=gate.promise;const one=run(e,a,'same'),two=run(e,a,'same');const status=await waitForAdmission(e,a,'same');assert.equal(status.state,'pending');gate.resolve();const [x,y]=await Promise.all([one,two]);assert.deepEqual(x,y);assert.equal(e.hooks.effects,1);await run(e,a,'same');assert.equal(e.hooks.effects,1);
  await assert.rejects(run(e,a,'same','scene.update',{id:A,name:'different'}),x=>x.code==='REQUEST_ID_REUSED');
  await run(e,a,'same','scene.update',{name:'same',id:A});assert.equal(e.hooks.effects,1);
  await assert.rejects(run(e,a,'binary','scene.update',{id:A,name:new Date()}),x=>x.code==='INVALID_ARGUMENT');
 });
 await check('Status and coordination messages bypass native IO/FIFO, with resumable addressed event cursors',async()=>{
  const e=environment(),a=await join(e,'A'),b=await join(e,'B'),c=await join(e,'C'),start=await e.call('collab.events');e.block(true);await e.call('collab.message',{session:a,to:b,text:'Please keep mounting holes'});await e.call('collab.update',{session:b,task:'Fasteners'});
  const toB=await e.call('collab.events',{session:b,stream:start.stream,after:start.cursor}),toC=await e.call('collab.events',{session:c,stream:start.stream,after:start.cursor});assert.ok(toB.events.some(e=>e.type==='message'));assert.ok(!toC.events.some(e=>e.type==='message'));assert.equal(toC.nextCursor,toB.nextCursor);e.block(false);
 });
 await check('Queued old-document work is fenced; receipts survive replacement and claims do not',async()=>{
  const e=environment(),a=await join(e),gate=deferred();await e.call('collab.claim',{session:a,ids:[A]});e.hooks.wait=gate.promise;const busy=run(e,a,'busy');await waitForAdmission(e,a,'busy');const replace=e.call('scene.new'),stale=run(e,a,'stale');await waitForAdmission(e,a,'stale');gate.resolve();await busy;await replace;assert.equal((await stale).error.code,'CONFLICT');assert.equal(e.hooks.effects,1);assert.equal((await e.call('collab.claims')).total,0);assert.equal((await run(e,a,'busy')).state,'complete');
 });
 await check('Optional scene CAS rejects stale edits while independent unguarded work remains allowed',async()=>{
  const e=environment(),a=await join(e),observed=(await e.call('collab.participants')).document;await e.call('scene.update',{id:C,name:'Other edit'});const stale=await run(e,a,'cas','scene.update',{id:A,name:'Stale'},{document:observed.id,expected:{epoch:observed.epoch,revision:observed.revision}});assert.equal(stale.error.code,'CONFLICT');assert.equal(e.nodes[0].name,undefined);assert.equal((await run(e,a,'allowed')).state,'complete');
 });
 await check('Attributed batches keep native FIFO and partial receipts; coordination nesting rejects before mutation',async()=>{
  const e=environment(),a=await join(e),commands=[{name:'scene.update',args:{id:A,name:'one'}},{name:'scene.fail'},{name:'scene.update',args:{id:A,name:'skipped'}}];const receipt=await run(e,a,'batch','api.batch',{commands});assert.equal(receipt.state,'complete');assert.equal(receipt.result.ok,false);assert.equal(receipt.result.completed,1);assert.equal(e.nodes[0].name,'one');await run(e,a,'batch','api.batch',{commands});assert.equal(e.hooks.effects,1);
  const bad=await run(e,a,'nest','api.batch',{commands:[{name:'scene.update',args:{id:A,name:'bad'}},{name:'collab.participants'}]});assert.equal(bad.state,'failed');assert.equal(e.hooks.effects,1);const log=await e.call('collab.events');assert.ok(log.events.some(x=>x.type==='command.completed'&&x.name==='scene.update'&&x.session===a&&x.requestId==='batch'));
 });
 await check('Intentional replacement within a batch advances only that request document fence',async()=>{
  const e=environment(),a=await join(e);const r=await run(e,a,'replace-batch','api.batch',{commands:[{name:'scene.new'},{name:'scene.update',args:{id:A,name:'new document'}}]});assert.equal(r.result.completed,2);assert.notEqual(r.document,r.finalDocument);assert.equal(e.nodes[0].name,'new document');
 });
 await check('Leaving fences queued commands without claiming rollback of admitted work',async()=>{
  const e=environment(),a=await join(e),b=await join(e),gate=deferred();e.hooks.wait=gate.promise;const active=run(e,b,'hold');await waitForAdmission(e,b,'hold');const queued=run(e,a,'queued');await waitForAdmission(e,a,'queued');await e.call('collab.leave',{session:a});gate.resolve();await active;assert.equal((await queued).error.code,'SESSION_EXPIRED');assert.equal(e.hooks.effects,1);
 });
 await check('Large and evicted results retain ID tombstones and never execute again',async()=>{
  const e=environment(),a=await join(e);const large=await run(e,a,'large','scene.large',{});assert.equal(large.result.length,300000);assert.equal((await run(e,a,'large','scene.large',{})).resultAvailable,false);assert.equal(e.hooks.effects,1);
  await run(e,a,'first');for(let i=0;i<130;i++)await run(e,a,'small-'+i);const old=await run(e,a,'first');assert.equal(old.state,'complete');assert.equal(old.resultAvailable,false);assert.equal(e.hooks.effects,132);assert.equal((await e.call('collab.request',{session:a,requestId:'small-129',includeResult:false})).resultAvailable,true);
 },4000);
 await check('Event history explicitly reports gaps and reload cursors; no silent loss',async()=>{
  const e=environment(),a=await join(e);for(let i=0;i<2050;i++)await e.call('collab.message',{session:a,text:'message '+i});const events=await e.call('collab.events',{after:0,limit:1000});assert.equal(events.truncated,true);assert.equal(events.events.length,1000);assert.equal(events.hasMore,true);const reset=await e.call('collab.events',{stream:'another-page',after:9000});assert.equal(reset.reset,true);assert.ok(reset.nextCursor>0);
 });
 return {pass:checks.every(c=>c.pass),checks,sourceSHA256:createHash('sha256').update(html).digest('hex'),scope:'Actual coordination factory, registry, request admission and FIFO; native scene handlers are fixtures. No browser/GPU qualification.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const report=await collaborationChecks();await mkdir(new URL('./results/',import.meta.url),{recursive:true});await writeFile(new URL('./results/ai-collaboration.json',import.meta.url),JSON.stringify(report,null,2)+'\n');for(const check of report.checks)console.log(check.pass?'PASS':'FAIL',check.name,check.error||'');if(!report.pass)process.exitCode=1;}
