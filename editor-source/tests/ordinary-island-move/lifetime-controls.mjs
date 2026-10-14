import assert from 'node:assert/strict';
import {scene,prepared,gesture,tick,context} from './composed-fixture.mjs';
import * as THREE from '../../../modules/frame-three-core.9edde002b066a9a05676.js';
const rows=[];
async function test(name,run){await run();rows.push({name,pass:true});}
async function published(a){await a.exact;for(let n=0;a.packet||a.publishing;n++){assert(n<2000,'publication settled');await tick();}}
function released(job){for(const key of ['actor','prepared','claim','descriptor','row','display','uiSession','releaseSignal','releaseDisplay','cleanup','claimRelease'])assert(job[key]===null,'terminal job still retains '+key);}
await test('published command retains checkpoints and small history metadata but no resolved descriptor promises',async()=>{
 const q=await scene();try{const read=await prepared(q.a),job=await gesture(q.a,read,.25);assert(job.descriptor.rawMask.byteLength>0);q.a.finish(job);await published(q.a);
  released(job);assert(job.checkpoints.before.positions.byteLength>0);assert(job.checkpoints.after.positions.byteLength>0);assert(!job.context.selection);assert.equal(q.a.jobs.length,0);assert.equal(await job.completion,undefined);assert.equal(await job.presentationReady,undefined);
 }finally{await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('cancel-only gestures release each job and its descriptor without any successful publication',async()=>{
 const q=await scene();try{const read=await prepared(q.a),jobs=[];for(let i=0;i<12;i++){const job=await gesture(q.a,read,.25);jobs.push(job);q.a.finish(job,{cancel:true});await job.completion;released(job);assert.equal(job.context,null);assert.equal(q.a.jobs.length,0);}
  assert.equal(q.a.version,0);assert.equal(q.ctx.undoStack.length,0);assert.equal(q.a.root.rows.length,0);assert.equal(q.mesh.geometry.attributes.position.getX(0),0);await q.a.releaseRead(read);
 }finally{await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('retiring cancelled A preserves B descriptor and GPU source until B finishes',async()=>{
 const q=await scene();let unblock;try{const read=await prepared(q.a),a=await gesture(q.a,read,1);q.d.completion=new Promise(r=>unblock=r);q.a.finish(a,{cancel:true});const b=q.a.start(Promise.resolve(read),context);q.a.pose(b,[1,0,0,0,0,1,0,0,0,0,1,0,.125,0,0,1],[1,0,0,0,0,1,0,0,0,0,1,0,.125,0,0,1]);await tick();await b.claim;
  assert(q.a.jobs.includes(a)&&q.a.jobs.includes(b));assert.equal(b.descriptor,read);assert(!b.row);unblock();await a.completion;released(a);assert(q.a.jobs.includes(b));assert.equal(b.descriptor,read);await b.display;await b.row.scheduler.whenIdle();assert.equal(q.a.root.position(0)[0],.125);q.a.finish(b);await published(q.a);released(b);assert(b.accepted);assert.equal(q.mesh.geometry.attributes.position.array[0],.125);
 }finally{unblock?.();await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('Cancel before a deferred prepared read settles drops A only after its fence, leaving immediate B valid',async()=>{
 const q=await scene();let supply;try{const read=await prepared(q.a),pending=new Promise(r=>supply=r),a=q.a.start(pending,context);q.a.finish(a,{cancel:true});const b=q.a.start(Promise.resolve(read),context);await tick();assert(q.a.jobs.includes(a)&&q.a.jobs.includes(b));supply(read);await a.completion;released(a);assert.equal(b.descriptor,read);await b.display;q.a.finish(b,{cancel:true});await b.completion;released(b);assert.equal(q.a.jobs.length,0);await q.a.releaseRead(read);
 }finally{supply?.(null);await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('fatal worker disposal waits for job cleanup, releases transient references and keeps prior published checkpoints',async()=>{
 const q=await scene();try{const done=await gesture(q.a,await prepared(q.a),.25);q.a.finish(done);await published(q.a);const checkpoint=done.checkpoints.after,next=await gesture(q.a,await prepared(q.a),.25);q.a.worker.emit('error',Error('lifetime witness fatal'));await q.a.disposal;
  released(done);released(next);assert.equal(q.a.jobs.length,0);assert.equal(q.a.root,null);assert.equal(q.a.initialDerived,null);assert.equal(q.a.authorCheckpoint,null);assert.equal(done.checkpoints.after,checkpoint);assert.equal(q.ctx.undoStack.length,1);
 }finally{await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('failed A and released B/C each release their shared descriptor claim once, preserving the UI pin',async()=>{
 const q=await scene();const transport=q.a.request.bind(q.a);let release,computing=false,inject=true,claims=0,releases=0;const gate=new Promise(r=>release=r);
 q.a.request=async(kind,data,transfer)=>{if(kind==='compute'&&inject){inject=false;computing=true;await gate;const delta=data.delta.slice();delta[12]=NaN;data={...data,delta};}const result=await transport(kind,data,transfer);if(kind==='descriptor-claim')claims++;if(kind==='descriptor-release')releases++;return result;};
 try{const read=await prepared(q.a),a=await gesture(q.a,read,.25);q.a.finish(a);while(!computing)await tick();const b=await gesture(q.a,read,.25);q.a.finish(b);const c=await gesture(q.a,read,.25);q.a.finish(c);release();await a.completion;await b.completion;await c.completion;await q.a.displayTail;
  for(const job of [a,b,c])released(job);assert.equal(q.a.jobs.length,0);assert.equal(claims,3);assert.equal(releases,3);assert.equal(q.ctx.undoStack.length,0);
  const d=await gesture(q.a,read,.25);q.a.finish(d,{cancel:true});await d.completion;released(d);assert.equal(claims,4);assert.equal(releases,4);await q.a.releaseRead(read);assert.equal(releases,5);
  await assert.rejects(q.a.request('preview-begin',{token:read.token,renderVersion:0}),{name:'AbortError'});
 }finally{release();await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('fatal failure during UI publication keeps reconciliation data until transaction rollback and then retires it',async()=>{
 const q=await scene();const transport=q.a.request.bind(q.a);let rejectAck,waiting=false;const ack=new Promise((_,reject)=>rejectAck=reject);ack.catch(()=>{});
 q.a.request=async(kind,data,transfer)=>{const result=await transport(kind,data,transfer);if(kind==='ack-render'){waiting=true;await ack;}return result;};
 try{const pivot=new THREE.Matrix4().makeTranslation(2,0,0).toArray();q.ctx.polyPivotMatrix=pivot;const before=q.mesh.geometry,read=await prepared(q.a),job=q.a.start(Promise.resolve(read),q.ctx.frameOrdinaryContext('A')),delta=new THREE.Matrix4().makeTranslation(.25,0,0).toArray();
  q.a.pose(job,delta,delta);await job.display;q.ctx.frameOrdinaryInput={r:q.r,job,before:pivot,presentationStamp:q.a.hooks.selectionStamp(),measurements:null,overlays:q.ctx.frameRigidCaptureOverlays()};job.uiSession=q.ctx.frameOrdinaryInput;q.ctx.getGizmoWorldArray=()=>new THREE.Matrix4().makeTranslation(2.25,0,0).toArray();q.ctx.frameOrdinaryFinish({type:'pointerup'});await job.completion;while(!waiting)await tick();assert(q.mesh.geometry!==before);
  q.a.worker.emit('error',Error('fatal during publication'));assert(job.uiSession);assert(!job.retired);rejectAck(Error('publication host acknowledgement lost'));await q.a.disposal;
  released(job);assert.equal(q.mesh.geometry,before);assert.equal(q.ctx.polyPivotMatrix,pivot);assert.equal(q.ctx.undoStack.length,0);assert.equal(q.a.jobs.length,0);assert.equal(q.pool.bytes,0);
 }finally{rejectAck?.(Error('test cleanup'));await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
console.log(JSON.stringify({pass:true,cases:rows.length,rows,scope:'Reachable transient fields and actual descriptor RPC pin counts through real actor, Node worker and production display lifetimes; no heuristic GC or hardware claim'}));
