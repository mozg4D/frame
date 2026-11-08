import test from 'node:test';
import assert from 'node:assert/strict';
import {activate} from '../plugin.js';
import {nativeCreationFixture,math} from './native-creation-fixture.mjs';

// CPU source contracts only: actual bridge, native selection/API queues, native
// matrix edits/restores. GPU/DOM endpoints and API validation/settling are adapters.
// Full native Undo/Redo stacks and browser rendering remain hardware gates.
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(){
 const native=nativeCreationFixture();let operations;
 await activate({version:1,device:null,document:native.context.document,math,
  editor:native.context.editor,operations:{register:value=>operations=value},
  attributes:{register(){}},viewport:{register:async value=>{native.entry.viewport=value;}},requestAttributes(){},requestDraw(){}});
 const owner=native.create('thermal');native.sync();await native.context.editor.selectOwner(owner.nativeHash);
 const run=id=>operations.find(o=>o.id===id).run(owner.nativeHash,{});
 // Source-extracted frameAI.call supplies the serial task tail and completion
 // events. The registered callback is the already activated plugin operation.
 for(const id of ['create-probe','create-fan'])native.registerTool(id,()=>run(id));
 return {native,owner,run};
}
const values=m=>Array.from(m);
for(const id of ['create-probe','create-fan']){
 test(`${id} completes with matching UI/native child selection and one native commit checkpoint`,async()=>{
  const {native,owner,run}=await fixture(),before=values(native.local(owner.nativeHash));
  const result=await run(id),child=native.nodes.find(n=>n.nativeHash===result.hash);
  assert.ok(child);assert.equal(child.parent,owner.id);assert.equal(child.params.Thermal,owner.nativeHash);
  assert.deepEqual(native.selected,{hash:child.nativeHash,area:'objects'});assert.deepEqual(native.engineSelection,[child.nativeHash]);
  assert.equal(native.transactions,1);assert.equal(native.checkpoints.length,1);assert.equal(native.checkpoints[0].nodes.length,1);
  assert.deepEqual(values(native.local(owner.nativeHash)),before);
 });
 test(`${id} waits for the actual native selection queue before resolving`,async()=>{
  const {native,run}=await fixture(),release=native.delayNextSelection();let done=false;
  const operation=run(id).then(result=>{done=true;return result;});
  try{
   await tick();assert.equal(native.transactions,1);assert.equal(native.selectionBusy,true);assert.equal(done,false);
   assert.deepEqual(native.engineSelection,[native.selected.hash]);
  }finally{release();}
  const result=await operation;assert.equal(done,true);assert.equal(native.selectionBusy,false);assert.deepEqual(native.engineSelection,[result.hash]);
 });
 test(`${id} leaves a newer editor selection authoritative when its delayed selection finishes`,{timeout:1500},async()=>{
  const {native,owner,run}=await fixture(),release=native.delayNextSelection();let done=false,newer;
  const creation=run(id).then(value=>{done=true;return value;});
  try{
   await tick();assert.equal(done,false);assert.equal(native.selectionBusy,true);
   const child=native.selected.hash;assert.notEqual(child,owner.nativeHash);
   newer=native.context.editor.selectOwner(owner.nativeHash);
   assert.deepEqual(native.selected,{hash:owner.nativeHash,area:'objects'});
   assert.deepEqual(native.engineSelection,[child]);assert.equal(native.selectionRequests,3);
  }finally{release();}
  const result=await creation;await newer;await native.selectionQueue;await tick();
  assert.notEqual(result.hash,owner.nativeHash);assert.equal(native.selectionRequests,3,'No child reselect after awaited completion');
  assert.deepEqual(native.selected,{hash:owner.nativeHash,area:'objects'});assert.deepEqual(native.engineSelection,[owner.nativeHash]);
  assert.equal(native.transactions,1);assert.equal(native.selectionBusy,false);
 });
 for(const mode of ['vertex','edge','polygon'])test(`${id} uses native object selection while ${mode} display mode remains unchanged`,async()=>{
  const {native,owner,run}=await fixture();native.setElementMode(mode);
  const {hash}=await run(id);
  assert.equal(native.elementMode,mode);assert.equal(native.selectionScope,'objects');assert.deepEqual(native.engineSelection,[hash]);
  assert.deepEqual(native.selected,{hash,area:'objects'});assert.equal(native.transactions,1);
  const before=values(native.local(hash));native.applyDelta(math.translation([1,2,3]));
  assert.deepEqual(values(native.local(owner.nativeHash)),values(math.I()));
  assert.deepEqual(values(native.local(hash)).slice(0,12),before.slice(0,12));
  assert.deepEqual(values(native.local(hash)).slice(12,15),before.slice(12,15).map((v,i)=>v+i+1));
 });
 test(`${id} completes inside the actual API serial tail without waiting on its own queued successor`,{timeout:1500},async()=>{
  const {native}=await fixture(),started=performance.now();let successorRan=false;
  native.registerTool('successor',()=>{successorRan=true;return native.engineSelection;});
  const creation=native.call(id),successor=native.call('successor');
  const child=await creation,selection=await successor,wallMs=performance.now()-started;
  assert.equal(successorRan,true);assert.deepEqual(selection,[child.hash]);assert.equal(native.selectionRequests,2);
  assert.deepEqual(native.events.map(e=>[e.name,e.state]),[[id,'start'],[id,'complete'],['successor','start'],['successor','complete']]);
  assert.ok(wallMs<1000,`${wallMs} ms exceeds 1000 ms completed API operation budget`);
  console.log(JSON.stringify({operation:id+' completes on actual API tail before queued successor',wallMs,budgetMs:1000,hardwareVerified:false}));
 });
 test(`${id} surfaces selection endpoint rejection without reporting success or making a second creation`,async()=>{
  const {native,owner,run}=await fixture(),error=Error('selection endpoint rejected');native.rejectNextSelection(error);
  await assert.rejects(run(id),value=>value===error);
  assert.equal(native.transactions,1);assert.equal(native.nodes.length,2);assert.equal(native.checkpoints.length,1);
  assert.deepEqual(native.engineSelection,[owner.nativeHash]);assert.notEqual(native.selected.hash,owner.nativeHash);
  // Creation is committed before selection. Rejection is not an atomic rollback,
  // automatic retry or promise of a render-error policy change in the core.
 });
 test(`${id} immediately transforms the child only and native frame restoration reproduces before/after`,async()=>{
  const {native,owner,run}=await fixture();
  const parent=math.mul(math.rotation([0,0,1],.37),math.stretch([1,0,0],2));parent.set([11,22,33],12);native.setLocal(owner.nativeHash,parent);
  const {hash}=await run(id),ownerBefore=values(native.local(owner.nativeHash)),localBefore=values(native.local(hash)),worldBefore=values(native.world(hash));
  const before=native.applyDelta(math.translation([3,-2,1])),after=native.snapshotFrames(),localAfter=values(native.local(hash));
  assert.deepEqual(values(native.local(owner.nativeHash)),ownerBefore);assert.notDeepEqual(localAfter,localBefore);
  const expected=math.mul(math.translation([3,-2,1]),worldBefore);
  values(native.world(hash)).forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<1e-10));
  for(let i=0;i<3;i++){
   native.restoreFrames(before);assert.deepEqual(values(native.local(hash)),localBefore);assert.deepEqual(values(native.local(owner.nativeHash)),ownerBefore);
   native.restoreFrames(after);assert.deepEqual(values(native.local(hash)),localAfter);assert.deepEqual(values(native.local(owner.nativeHash)),ownerBefore);
  }
 });
}
test('actual UI-only document.select reproduces stale owner selection before the synchronization fix',async()=>{
 const {native,owner}=await fixture();let child;
 native.context.document.transaction(()=>{child=native.context.document.create('thermal_probe',owner.nativeHash);native.context.document.select(child.nativeHash,'objects');});
 assert.deepEqual(native.selected,{hash:child.nativeHash,area:'objects'});assert.deepEqual(native.engineSelection,[owner.nativeHash]);
 const childBefore=values(native.local(child.nativeHash));native.applyDelta(math.translation([3,0,0]));
 assert.equal(native.world(owner.nativeHash)[12],3);assert.equal(native.world(child.nativeHash)[12],3);
 assert.deepEqual(values(native.local(child.nativeHash)),childBefore);
});
test('source-extracted API task queue keeps creation, immediate transform and next creation ordered',async()=>{
 const {native,owner}=await fixture(),release=native.delayNextSelection();let transformed=false,secondDone=false;
 native.registerTool('transform-child',()=>{transformed=true;const selection=native.engineSelection;native.applyDelta(math.translation([3,0,0]));return selection;});
 const first=native.call('create-probe'),transform=native.call('transform-child'),second=native.call('create-fan').then(value=>{secondDone=true;return value;});
 try{await tick();assert.equal(transformed,false);assert.equal(secondDone,false);assert.equal(native.nodes.length,2);assert.equal(native.events.filter(e=>e.state==='complete').length,0);}finally{release();}
 const a=await first,selected=await transform,b=await second;
 assert.deepEqual(selected,[a.hash]);assert.deepEqual(native.engineSelection,[b.hash]);assert.equal(native.transactions,2);
 assert.deepEqual(values(native.local(owner.nativeHash)),values(math.I()));assert.equal(native.world(a.hash)[12],3);
 assert.deepEqual(native.events.map(e=>[e.name,e.state]),[['create-probe','start'],['create-probe','complete'],['transform-child','start'],['transform-child','complete'],['create-fan','start'],['create-fan','complete']]);
});
test('API queue reports a rejected selection and still accepts the next creation',async()=>{
 const {native}=await fixture();native.rejectNextSelection(Error('rejected selection'));
 await assert.rejects(native.call('create-probe'),error=>error.code==='COMMAND_FAILED'&&error.message==='rejected selection');
 const child=await native.call('create-fan');assert.deepEqual(native.engineSelection,[child.hash]);assert.equal(native.transactions,2);
 assert.deepEqual(native.events.map(e=>e.state),['start','error','start','complete']);
});
test('32 awaited Probe/Fan operations plus immediate native child transforms stay below 1500 ms',async()=>{
 const {native,owner}=await fixture(),started=performance.now(),children=[],savedChildren=new Map();
 for(let i=0;i<32;i++){
  const {hash}=await native.call(i%2?'create-fan':'create-probe');assert.deepEqual(native.engineSelection,[hash]);
  for(const [previous,frame]of savedChildren)assert.deepEqual(values(native.local(previous)),frame);
  const before=values(native.world(hash));native.applyDelta(math.translation([i+1,0,0]));
  assert.equal(native.world(hash)[12],before[12]+i+1);assert.deepEqual(values(native.local(owner.nativeHash)),values(math.I()));children.push(hash);savedChildren.set(hash,values(native.local(hash)));
 }
 const wallMs=performance.now()-started;assert.ok(wallMs<1500,`${wallMs} ms exceeds 1500 ms`);
 assert.equal(new Set(children).size,32);assert.equal(native.transactions,32);assert.equal(native.checkpoints.length,32);
 console.log(JSON.stringify({operation:'32 completed source-extracted Probe/Fan creations, native selection/API queues and immediate transforms',wallMs,budgetMs:1500,hardwareVerified:false}));
});
