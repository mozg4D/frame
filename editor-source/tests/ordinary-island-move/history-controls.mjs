import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import * as THREE from '../../../modules/frame-three-core.9edde002b066a9a05676.js';
import {scene,prepared,gesture,tick} from './composed-fixture.mjs';
import {checkpointBytes} from '../../../native-source/ordinary-move-history.mjs';
const require=createRequire(import.meta.url),ts=require(process.env.FRAME_TYPESCRIPT||'typescript');
const source=fs.readFileSync(new URL('../../../modules/editor.ordinary-move.qa.js',import.meta.url),'utf8'),ast=ts.createSourceFile('candidate',source,99,true,1);
function installCommands(ctx){
 Object.assign(ctx,{edgeBevelTool:null,edgeBevelResult:null,lastAttrKey:null,splineData:new Map(),objParams:new Map(),frameRigidBeforeHistory(){},frameAffineCommandPreflight(){},frameAutoKeyCommand(){},frameValidateTopologyCommand(){},registerSceneCommandState(){},restoreSceneCommandState(){},afterCmd(){},trimCommandStack(stack){while(stack.length>64)stack.shift().dispose?.();},clearCommandStack(stack){for(const c of stack)c.dispose?.();stack.length=0;}});
 for(const name of ['runCmd','pushCmd','undo','redo'])vm.runInContext(ast.statements.findLast(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(ast),ctx);
}
async function settle(a){await a.exact;for(let n=0;a.packet||a.publishing||a.operations;n++){assert(n<2000,'publication settled');await tick();}}
async function move(a,x){const q=await prepared(a),j=await gesture(a,q,x);a.finish(j);await settle(a);assert(j.published);return j;}
async function history(ctx,direction){const errors=ctx.errors.length;ctx[direction]();await ctx.frameOrdinaryHistory;assert.equal(ctx.errors.length,errors);}
function bits(mesh){const g=mesh.geometry;return JSON.stringify({p:Array.from(new Uint32Array(g.attributes.position.array.buffer)),n:Array.from(new Uint32Array(g.attributes.normal.array.buffer)),ix:Array.from(g.index.array),type:g.index.array.constructor.name,groups:g.groups,range:[g.drawRange.start,String(g.drawRange.count)]});}
const rows=[];
async function test(name,run){await run();rows.push({name,pass:true});}
await test('actual command Undo/Redo after fatal worker resolve a new actor and restore exact old checkpoints',async()=>{
 const q=await scene();installCommands(q.ctx);let live;
 try{const before=bits(q.mesh),job=await move(q.a,.25),after=bits(q.mesh);q.a.worker.emit('error',Error('fatal after published Move'));await q.a.disposal;live=q.ctx.frameOrdinaryOwner('A');await live.actor.ready;
  assert.notEqual(live.actor,q.a);assert.equal(q.ctx.undoStack[0].ordinaryMove.actor,undefined);
  await history(q.ctx,'undo');assert.equal(bits(q.mesh),before);assert.equal(q.ctx.redoStack[0].ordinaryMove.job,job);
  await history(q.ctx,'redo');assert.equal(bits(q.mesh),after);assert.equal(q.ctx.undoStack[0].ordinaryMove.job,job);
 }finally{await live?.actor.dispose();await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('three revisions, fatal restart, another Move and unrelated external B command preserve chronological exact history',async()=>{
 const q=await scene();installCommands(q.ctx);let live;
 try{const revisions=[bits(q.mesh)],jobs=[];for(const x of [.125,.25,.375]){jobs.push(await move(q.a,x));revisions.push(bits(q.mesh));}
  assert.equal(jobs[1].checkpoints.before,jobs[0].checkpoints.after);assert.equal(jobs[2].checkpoints.before,jobs[1].checkpoints.after);assert.equal(q.a.jobs.length,0);
  q.a.worker.emit('error',Error('fatal across revisions'));await q.a.disposal;live=q.ctx.frameOrdinaryOwner('A');await live.actor.ready;jobs.push(await move(live.actor,.125));revisions.push(bits(q.mesh));
  let value=0;const command={geometryTargets:['B'],redo(){value=1;},undo(){value=0;}};q.ctx.runCmd(command);assert.equal(value,1);q.ctx.undo();assert.equal(value,0);assert.equal(bits(q.mesh),revisions.at(-1));
  for(let at=3;at>=0;at--){await history(q.ctx,'undo');assert.equal(bits(q.mesh),revisions[at]);}
  for(let at=1;at<=4;at++){await history(q.ctx,'redo');assert.equal(bits(q.mesh),revisions[at]);}
  q.ctx.redo();assert.equal(value,1);assert.equal(q.ctx.undoStack.at(-1),command);
  const unique=new Set(jobs.flatMap(j=>[j.checkpoints.before,j.checkpoints.after]));assert.equal(unique.size,6);rows.push({name:'host history shares adjacent revisions and no actor job retains published display packets',pass:true,uniqueCheckpoints:unique.size,checkpointBytes:[...unique].reduce((n,c)=>n+checkpointBytes(c),0)});
 }finally{await live?.actor.dispose();await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('external edit of A rejects stale checkpoint; actual Undo of that command permits old Move Undo/Redo',async()=>{
 const q=await scene();installCommands(q.ctx);const owners=[];
 try{const before=bits(q.mesh),job=await move(q.a,.25),after=bits(q.mesh),canonical=q.mesh.geometry,edited=canonical.clone();edited.attributes.position.array[0]=9;
  const command={geometryTargets:['A'],redo(){q.ctx.frameOrdinaryBeforeExternalEdit(['A']);q.mesh.geometry=edited;},undo(){q.mesh.geometry=canonical.clone();}};q.ctx.runCmd(command);
  const actor=await q.ctx.frameOrdinaryResolveHistory(job.command);owners.push(actor);await assert.rejects(actor.history(job,'undo'),{name:'AbortError'});assert.equal(q.mesh.geometry.attributes.position.array[0],9);
  q.ctx.undo();assert.equal(bits(q.mesh),after);await history(q.ctx,'undo');owners.push(q.ctx.frameOrdinaryOwners.get('A').actor);assert.equal(bits(q.mesh),before);await history(q.ctx,'redo');assert.equal(bits(q.mesh),after);
 }finally{for(const a of owners)await a.dispose();await q.ctx.frameOrdinaryOwners.get('A')?.actor.dispose();await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('checkpoint upload uses bounded slices, retains independent immutable arrays and releases command lifetime',async()=>{
 const q=await scene();installCommands(q.ctx);
 try{const job=await move(q.a,.25),before=job.checkpoints.before,after=job.checkpoints.after;
  assert.notEqual(after.positions,q.mesh.geometry.attributes.position.array);const original=after.positions[0];q.mesh.geometry.attributes.position.array[0]=8;assert.equal(after.positions[0],original);q.mesh.geometry.attributes.position.array[0]=original;
  let chunks=0;for(const checkpoint of [before,after])for(const value of Object.values(checkpoint)){const slice=value.slice.bind(value);value.slice=(start,end)=>{assert(end-start<=65536);chunks++;return slice(start,end);};}
  await history(q.ctx,'undo');await history(q.ctx,'redo');assert(chunks>=20);assert.equal(before.positions.byteLength,36);assert.equal(after.positions.byteLength,36);
  q.ctx.clearCommandStack(q.ctx.undoStack);assert.equal(job.checkpoints,null);assert.equal(q.a.jobs.length,0);
 }finally{await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('actual Undo queued during A/B compute first publishes canonical selection before restoring B checkpoint',async()=>{
 const q=await scene();installCommands(q.ctx);const transport=q.a.request.bind(q.a);let release,computing=false,first=true;const gate=new Promise(r=>release=r);
 q.a.request=async(kind,data,transfer)=>{if(kind==='compute'&&first){first=false;computing=true;await gate;}return transport(kind,data,transfer);};
 try{const read=await prepared(q.a),a=await gesture(q.a,read,.125);q.a.finish(a);while(!computing)await tick();const b=await gesture(q.a,read,.25);q.a.finish(b);q.ctx.undo();release();await q.ctx.frameOrdinaryHistory;
  assert.equal(q.ctx.errors.length,0);assert(a.published&&b.published);assert.equal(q.ctx.undoStack.length,1);assert.equal(q.ctx.redoStack[0].ordinaryMove.job,b);assert.equal(q.mesh.geometry.attributes.position.array[0],.125);assert.equal(q.a.root.rows.length,0);
  await history(q.ctx,'redo');assert.equal(q.mesh.geometry.attributes.position.array[0],.375);
 }finally{release();await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
for(const space of ['local','world'])await test('inline Move finish and recovered Undo/Redo retain custom pivot/current CM in '+space+' space',async()=>{
 const q=await scene();installCommands(q.ctx);let live;
 try{q.ctx.coordMode=space;const beforePivot=new THREE.Matrix4().makeTranslation(2,0,0).toArray(),afterPivot=new THREE.Matrix4().makeTranslation(2.25,0,0).toArray();q.ctx.polyPivotMatrix=beforePivot;
  const read=await q.a.read({vertices:[0],edges:[],faces:[]},q.ctx.frameOrdinaryContext('A')),context=q.ctx.frameOrdinaryContext('A'),job=q.a.start(Promise.resolve(read),context),delta=new THREE.Matrix4().makeTranslation(.25,0,0).toArray();
  q.a.pose(job,delta,delta);await job.display;q.ctx.frameOrdinaryInput={r:q.r,job,before:beforePivot,presentationStamp:q.a.hooks.selectionStamp(),measurements:null,overlays:q.ctx.frameRigidCaptureOverlays()};job.uiSession=q.ctx.frameOrdinaryInput;q.ctx.getGizmoWorldArray=()=>afterPivot;
  assert(q.ctx.frameOrdinaryFinish({type:'pointerup'}));await settle(q.a);const after=bits(q.mesh);assert.equal(q.ctx.polyPivotMatrix[12],2.25);
  q.a.worker.emit('error',Error('fatal custom pivot'));await q.a.disposal;live=q.ctx.frameOrdinaryOwner('A');await live.actor.ready;await history(q.ctx,'undo');assert.equal(q.ctx.polyPivotMatrix[12],2);assert.equal(q.ctx.frameOrdinaryCM.measurements.frame.elements[12],2);
  await history(q.ctx,'redo');assert.equal(q.ctx.polyPivotMatrix[12],2.25);assert.equal(q.ctx.frameOrdinaryCM.measurements.frame.elements[12],2.25);assert.equal(bits(q.mesh),after);
 }finally{await live?.actor.dispose();await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
console.log(JSON.stringify({pass:true,cases:rows.length,rows,scope:'Actual generated runCmd/pushCmd/Undo/Redo entry functions, editor resolver, actor, real worker checkpoint proof and native display; mocked scene peripherals and emulated GPU'}));
