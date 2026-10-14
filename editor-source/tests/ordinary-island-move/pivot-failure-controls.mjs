import assert from 'node:assert/strict';
import * as THREE from '../../../modules/frame-three-core.9edde002b066a9a05676.js';
import {scene,prepared,tick} from './composed-fixture.mjs';
function initial(q,space){const ctx=q.ctx;ctx.coordMode=space;ctx.gizDrag={mode:'move'};ctx.polyPivotMatrix=new THREE.Matrix4().makeTranslation(2,0,0).toArray();ctx.frameOrdinaryCM={stamp:ctx.frameOrdinaryStamp(),measurements:{bounds:{min:new THREE.Vector3(),max:new THREE.Vector3(1,1,0)},frame:new THREE.Matrix4().makeTranslation(2,0,0),extent:new THREE.Vector3(1,1,0)}};}
async function uiMove(q,x){const ctx=q.ctx,read=await prepared(q.a),before=ctx.polyPivotMatrix.slice();let gizmo=before;
 ctx.frameOrdinaryPrepare=()=>({r:q.r,readPromise:Promise.resolve(read),stamp:{entry:ctx.polySelection.items.get('A')}});ctx.getGizmoWorldArray=()=>gizmo;
 assert(ctx.frameOrdinaryStart({type:'pointerdown'}));const job=ctx.frameOrdinaryInput.job;ctx.frameOrdinaryApply(new THREE.Matrix4().makeTranslation(x,0,0));await job.display;await job.row.scheduler.whenIdle();gizmo=before.slice();gizmo[12]+=x;assert(ctx.frameOrdinaryFinish({type:'pointerup'}));return job;
}
function delayedFailure(a){const request=a.request.bind(a);let release,computing=false,first=true;const gate=new Promise(r=>release=r);a.request=async(kind,data,transfer)=>{if(kind==='compute'&&first){first=false;computing=true;await gate;const delta=data.delta.slice();delta[12]=NaN;data={...data,delta};}return request(kind,data,transfer);};return{release,get computing(){return computing;}};}
async function settle(a){await a.exact;for(let n=0;a.packet||a.publishing;n++){assert(n<2000);await tick();}}
const rows=[];async function test(name,run){await run();rows.push({name,pass:true});}
for(const space of ['local','world'])await test('real inline released A/B failure rolls pivot, CM and overlays backward to x2 in '+space,async()=>{
 const q=await scene();initial(q,space);const pivot=q.ctx.polyPivotMatrix,delay=delayedFailure(q.a);
 try{const a=await uiMove(q,.25);while(!delay.computing)await tick();const b=await uiMove(q,.25);assert.equal(q.ctx.polyPivotMatrix[12],2.5);delay.release();await a.completion;await b.completion;await q.a.displayTail;
  assert(a.cancelled&&b.cancelled);assert.equal(q.ctx.polyPivotMatrix,pivot);assert.equal(q.ctx.polyPivotMatrix[12],2);assert.equal(q.ctx.frameOrdinaryCurrentMeasurements().frame.elements[12],2);for(const o of q.overlays)assert.equal(o.matrix.elements[12],0);assert.equal(q.mesh.geometry.attributes.position.getX(0),0);assert.equal(q.ctx.undoStack.length,0);assert.equal(q.a.jobs.length,0);
 }finally{delay.release();await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('failed dependent A/B rollback preserves a newer independent B selection, custom pivot, CM and overlay matrices',async()=>{
 const q=await scene();initial(q,'world');const delay=delayedFailure(q.a);
 try{const a=await uiMove(q,.25);while(!delay.computing)await tick();const b=await uiMove(q,.25),selection={vertices:new Set([0]),edges:new Set(),faces:new Set()},pivot=new THREE.Matrix4().makeTranslation(9,0,0).toArray(),cm={owner:'independent B'};
  q.ctx.polySelection.items=new Map([['B',selection]]);q.ctx.framePolySelectionRevision++;q.ctx.polyPivotMatrix=pivot;q.ctx.frameOrdinaryCM=cm;for(const o of q.overlays)o.matrix.makeTranslation(9,0,0);delay.release();await a.completion;await b.completion;
  assert.equal(q.ctx.polyPivotMatrix,pivot);assert.equal(q.ctx.frameOrdinaryCM,cm);assert.equal(q.ctx.polySelection.items.get('B'),selection);for(const o of q.overlays)assert.equal(o.matrix.elements[12],9);assert.equal(q.mesh.geometry.attributes.position.array[0],0);assert.equal(q.a.jobs.length,0);
 }finally{delay.release();await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('failure rollback stops at the previously published Move checkpoint and pivot instead of undoing it',async()=>{
 const q=await scene();initial(q,'world');let delay;
 try{const published=await uiMove(q,.125);await settle(q.a);assert(published.published);const pivot=q.ctx.polyPivotMatrix,delay2=delayedFailure(q.a);delay=delay2;const a=await uiMove(q,.25);while(!delay.computing)await tick();const b=await uiMove(q,.25);delay.release();await a.completion;await b.completion;
  assert.equal(q.ctx.polyPivotMatrix,pivot);assert.equal(pivot[12],2.125);assert.equal(q.ctx.frameOrdinaryCurrentMeasurements().frame.elements[12],2.125);assert.equal(q.mesh.geometry.attributes.position.array[0],.125);assert.equal(q.ctx.undoStack.length,1);assert.equal(q.ctx.undoStack[0].ordinaryMove.job,published);assert.equal(q.a.jobs.length,0);
 }finally{delay?.release();await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
console.log(JSON.stringify({pass:true,cases:rows.length,rows,scope:'Actual inline mouse start/apply/finish, ordered cancellation adapter, real worker rejection and production display; gizmo input and GPU execution controlled, no mouse hardware claim'}));
