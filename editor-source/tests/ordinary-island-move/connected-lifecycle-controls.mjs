import assert from 'node:assert/strict';
import {fixture,gate,settle,tick} from './selection-lifecycle-fixture.mjs';
const rows=[];async function test(name,run){await run();rows.push({name,pass:true});}
function delayedRead(q){const hold=gate(),send=q.a.request.bind(q.a);let waiting=false,packet,once=true;q.a.request=async(kind,data,t)=>{if(kind==='prepare-read'&&data.connected&&once){once=false;waiting=true;await hold.promise;packet=await send(kind,data,t);return packet;}return send(kind,data,t);};return{hold,waiting:()=>waiting,packet:()=>packet};}
await test('real Connected entry Escape without gizDrag settles cancelled job before delayed worker result',async()=>{
 const q=await fixture(),delayed=delayedRead(q),entry=q.c.polySelection.items.get('A'),revision=q.c.framePolySelectionRevision;
 try{assert(q.c.frameStartNativeConnected({domain:'vertex'}));const job=q.c.framePolySelectionJob;assert(job.ordinary);await settle(q,delayed.waiting);const e=q.escape();assert(e.prevented&&e.stopped);assert.equal(await job.promise,false);assert.equal(q.c.framePolySelectionJob,null);assert.equal(q.c.frameOrdinaryPrepared,null);assert.equal(q.listeners.get('keydown').size,0);assert.equal(q.c.polySelection.items.get('A'),entry);
  delayed.hold.release();await settle(q,()=>!!delayed.packet());await tick();await tick();assert.equal(q.c.polySelection.items.get('A'),entry);assert.equal(q.c.framePolySelectionRevision,revision);assert.equal(entry.vertices.size,1);await settle(q,()=>q.a.pending.size===0);await assert.rejects(q.a.request('descriptor-claim',{token:delayed.packet().token}),{name:'AbortError'});assert.equal(q.c.errors.length,0);
 }finally{delayed.hold.release();await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('ordinary Connected cancels previous legacy selection job and registers shared Escape listener',async()=>{
 const q=await fixture(),delayed=delayedRead(q);let cancelled=0;q.c.framePolySelectionJob={kind:'marquee',cancel(){cancelled++;}};
 try{q.c.frameStartNativeConnected({domain:'vertex'});assert.equal(cancelled,1);const job=q.c.framePolySelectionJob;await settle(q,delayed.waiting);q.escape();assert.equal(await job.promise,false);delayed.hold.release();await settle(q,()=>!!delayed.packet());}finally{delayed.hold.release();await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('new Connected wins and cancelled delayed predecessor cannot overwrite or clear its job',async()=>{
 const q=await fixture(),delayed=delayedRead(q);
 try{q.c.frameStartNativeConnected({domain:'vertex'});const a=q.c.framePolySelectionJob;await settle(q,delayed.waiting);q.c.frameStartNativeConnected({domain:'vertex'});const b=q.c.framePolySelectionJob;assert.notEqual(a,b);assert.equal(await a.promise,false);assert.equal(await b.promise,true);const entry=q.c.polySelection.items.get('A'),revision=q.c.framePolySelectionRevision;assert.equal(entry.vertices.size,3);delayed.hold.release();await settle(q,()=>!!delayed.packet());await tick();await tick();assert.equal(q.c.polySelection.items.get('A'),entry);assert.equal(q.c.framePolySelectionRevision,revision);assert.equal(q.c.framePolySelectionJob,null);assert.equal(q.listeners.get('keydown').size,0);assert.equal(q.c.errors.length,0);
 }finally{delayed.hold.release();await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('Escape during GPU selection staging prevents install and releases late resources',async()=>{
 const q=await fixture(),hold=gate(),borrow=q.pool.borrowAsync.bind(q.pool),entry=q.c.polySelection.items.get('A'),bytes=q.pool.bytes;let staging=false,once=true;q.pool.borrowAsync=async(...args)=>{if(once){once=false;staging=true;await hold.promise;}return borrow(...args);};
 try{q.c.frameStartNativeConnected({domain:'vertex'});const job=q.c.framePolySelectionJob,prepared=q.c.frameOrdinaryPrepared;await settle(q,()=>staging);q.escape();assert.equal(await job.promise,false);assert.equal(q.c.polySelection.items.get('A'),entry);hold.release();await prepared.readPromise;await settle(q,()=>q.a.pending.size===0);await tick();await tick();assert.equal(q.c.polySelection.items.get('A'),entry);assert.equal(q.c.framePolySelectionRevision,0);assert.equal(q.pool.bytes,bytes);assert.equal(q.c.errors.length,0);}finally{hold.release();await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('retiring Prepared cancels shared job while preserving replacement prepared owner',async()=>{
 const q=await fixture(),delayed=delayedRead(q);
 try{q.c.frameStartNativeConnected({domain:'vertex'});const job=q.c.framePolySelectionJob;await settle(q,delayed.waiting);q.c.frameOrdinaryRetirePrepared();const replacement=q.c.frameOrdinaryPrepare();assert.equal(await job.promise,false);await replacement.promise;assert.equal(q.c.frameOrdinaryPrepared,replacement);delayed.hold.release();await settle(q,()=>!!delayed.packet());await tick();assert.equal(q.c.frameOrdinaryPrepared,replacement);assert.equal(q.c.polySelection.items.get('A').vertices.size,1);}finally{delayed.hold.release();await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('already-aborted control consumes late work rejection without publication',async()=>{
 const q=await fixture(),controller=new AbortController(),entry=q.c.polySelection.items.get('A');controller.abort();
 try{const p=q.c.frameOrdinaryConnected({domain:'vertex'},{signal:controller.signal,isCurrent:()=>true});await assert.rejects(p.promise,{name:'AbortError'});await assert.rejects(p.readPromise,{name:'AbortError'});await tick();assert.equal(q.c.polySelection.items.get('A'),entry);assert.equal(q.c.frameOrdinaryPrepared,null);assert.equal(q.a.pending.size,0);}finally{await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('actual rigid Move entry cancels pending Connected and binds current one-vertex selection',async()=>{
 const q=await fixture(),delayed=delayedRead(q);
 try{q.c.frameStartNativeConnected({domain:'vertex'});const selectionJob=q.c.framePolySelectionJob;await settle(q,delayed.waiting);q.c.gizDrag={mode:'move'};assert.equal(q.c.frameRigidStart({pointerId:1}),true);const move=q.c.frameOrdinaryInput.job;assert.equal(await selectionJob.promise,false);await move.display;assert.equal(move.descriptor.rawIDs.length,1);assert.equal(q.c.frameRigidFinish({type:'pointercancel',pointerId:1}),true);q.c.gizDrag=null;await move.completion;delayed.hold.release();await settle(q,()=>!!delayed.packet());await tick();await tick();assert.equal(q.c.polySelection.items.get('A').vertices.size,1);assert.equal(q.c.undoStack.length,0);assert.equal(q.c.errors.length,0);}finally{delayed.hold.release();await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
console.log(JSON.stringify({pass:true,cases:rows.length,rows,scope:'Actual generated Connected entry, shared selection job/capture Escape listener, delayed real Node worker and GPU staging. Public triangle only; no browser hardware claim.'}));
