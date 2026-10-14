import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import * as THREE from '../../../modules/frame-three-core.9edde002b066a9a05676.js';
import * as Native from '../../../modules/native.4ec912c8a6f2b4d498f1.js';
const require=createRequire(import.meta.url),ts=require(process.env.FRAME_TYPESCRIPT||'typescript');
const source=fs.readFileSync(new URL('../../ordinary-move-integration.mjs',import.meta.url),'utf8');
const rows=[];const test=(name,run)=>{run();rows.push({name,pass:true});};
import {fixture,geom} from './integration-fixture.mjs';

test('attribute/index identity, array, versions and mutation epochs reject stale source',()=>{
 for(const mutate of [g=>g.attributes.position.needsUpdate=true,g=>g.attributes.normal.needsUpdate=true,g=>g.index.needsUpdate=true,g=>g.attributes.position.array=g.attributes.position.array.slice(),g=>g.setIndex(new THREE.BufferAttribute(g.index.array.slice(),1))]){
  const{ctx}=fixture(),g=geom(),stamp=ctx.frameOrdinaryCaptureSource(g);assert(ctx.frameOrdinarySourceCurrent(stamp));mutate(g);assert(!ctx.frameOrdinarySourceCurrent(stamp));
 }
 const{ctx}=fixture(),g=geom(),stamp=ctx.frameOrdinaryCaptureSource(g);ctx.frameOrdinaryMutation(g);g.attributes.position.array[0]=12;assert(!ctx.frameOrdinarySourceCurrent(stamp));
});
test('an existing edit is blocked while exact Move is pending; epoch invalidates a later in-place edit',()=>{
 const{ctx,mesh}=fixture(),r=ctx.frameOrdinaryOwner('A');r.actor.operations=1;
 assert.throws(()=>ctx.frameOrdinaryBeforeExternalEdit(['A']),{name:'InvalidStateError'});assert(r.current());
 r.actor.operations=0;ctx.frameOrdinaryBeforeExternalEdit(['A']);mesh.geometry.attributes.position.array[0]=5;assert(!r.current());
});
test('presentation stamp belongs to actor A and cannot match selected B or deselect',()=>{
 const{ctx}=fixture(),r=ctx.frameOrdinaryOwner('A'),stamp=r.actor.hooks.selectionStamp();assert(r.actor.hooks.selectionCurrent(stamp));
 ctx.polySelection.items=new Map([['B',{vertices:new Set([0]),edges:new Set(),faces:new Set()}]]);assert(!r.actor.hooks.selectionCurrent(stamp));assert(r.current());
 ctx.polySelection.items.clear();assert(!r.actor.hooks.selectionCurrent(stamp));assert(r.current());ctx.polyFocusActive=()=>false;assert(r.current());
});
test('custom pivot follows ordinary finish and Cancel preserves its previous pivot',()=>{
 for(const cancel of [false,true]){const{ctx}=fixture(),pivot=new THREE.Matrix4().makeTranslation(2,0,0).toArray(),after=new THREE.Matrix4().makeTranslation(3,0,0).toArray(),job={context:{pivot},completion:Promise.resolve()};ctx.polyPivotMatrix=pivot;ctx.getGizmoWorldArray=()=>after;ctx.frameOrdinaryPrepare=()=>null;ctx.frameOrdinaryInput={before:new THREE.Matrix4().toArray(),job,r:{actor:{finish(){},hooks:{pose(){}}}}};
  ctx.frameOrdinaryFinish({type:cancel?'pointercancel':'pointerup'});assert.equal(job.context.beforePivot,pivot);assert.deepEqual(Array.from(ctx.polyPivotMatrix),cancel?pivot:after);assert.equal(job.context.afterPivot,ctx.polyPivotMatrix);
 }
});
test('released display may update its own CM, but cannot move newly selected B presentation',()=>{
 const{ctx}=fixture(),r=ctx.frameOrdinaryOwner('A'),measurements={bounds:{min:new THREE.Vector3(),max:new THREE.Vector3(1,1,1)},frame:new THREE.Matrix4(),extent:new THREE.Vector3(1,1,1)};
 const job={released:true,cancelled:false,context:{},delta:new THREE.Matrix4().makeTranslation(1,0,0).toArray(),uiSession:{presentationStamp:r.actor.hooks.selectionStamp(),measurements,overlays:ctx.frameRigidCaptureOverlays()}};
 ctx.frameOrdinaryInput=null;r.actor.hooks.pose(job);assert.equal(ctx.frameOrdinaryCM.measurements.frame.elements[12],1);
 ctx.polySelection.items=new Map([['B',{vertices:new Set([0]),edges:new Set(),faces:new Set()}]]);const cm={owner:'B'};ctx.frameOrdinaryCM=cm;job.delta=new THREE.Matrix4().makeTranslation(8,0,0).toArray();r.actor.hooks.pose(job);assert.equal(ctx.frameOrdinaryCM,cm);
});
test('composed custom pivot Move, Undo, Redo restores x2 then x3 and worker measurement context',()=>{
 const{ctx}=fixture(),r=ctx.frameOrdinaryOwner('A'),before=new THREE.Matrix4().makeTranslation(2,0,0).toArray(),after=new THREE.Matrix4().makeTranslation(3,0,0).toArray(),job={context:{beforePivot:before,afterPivot:after}};
 ctx.polyPivotMatrix=after;
 const numeric={};for(const[key,n]of [['fp',3],['ep',2],['vp',1]])numeric[key]={positions:new Float32Array(n*3),extras:new Float32Array(n*9),indices:Uint32Array.from({length:n},(_,i)=>i),vertexCount:n,hasNormals:false,hasUV:false,hasColors:false};
 for(const[direction,target]of [['undo',before],['redo',after]]){
  const history={job,direction};assert.deepEqual(Array.from(r.actor.hooks.context(history).pivot),target);
  const packet={entry:{vertices:new Set([0]),edges:new Set(),faces:new Set()},uploads:[],overlayNumeric:numeric,measurements:null};
  const tx=r.actor.hooks.prepareInstall(geom(),packet,{stamp:r.actor.hooks.selectionStamp(),history,present:()=>true});tx.commit();tx.finish();assert.deepEqual(Array.from(ctx.polyPivotMatrix),target);
 }
});
test('composed installSelection exception rolls back selection revision, indices, cache and GPU ownership',()=>{
 const{ctx,mesh,entry,overlays,cache}=fixture(),r=ctx.frameOrdinaryOwner('A'),old=mesh.geometry,indices=overlays.map(o=>o.geometry.index),positions=overlays.map(o=>o.geometry.attributes.position),oldUpload={};r.overlayUploads=[oldUpload];
 const numeric={};for(const[key,n]of [['fp',3],['ep',2],['vp',1]])numeric[key]={positions:new Float32Array(n*3),extras:new Float32Array(n*9),indices:Uint32Array.from({length:n},(_,i)=>i),vertexCount:n,hasNormals:false,hasUV:false,hasColors:false};
 const packet={entry:{vertices:new Set([1]),edges:new Set(),faces:new Set()},uploads:[{}],overlayNumeric:numeric,measurements:null};ctx.placeGizmoForSelection=()=>{throw Error('witness: placeGizmo failure');};
 const tx=r.actor.hooks.prepareInstall(geom(),packet,{stamp:r.actor.hooks.selectionStamp(),present:()=>true});assert.throws(()=>tx.commit(),/placeGizmo failure/);tx.rollback();
 assert.equal(mesh.geometry,old);assert.equal(ctx.framePolySelectionRevision,0);assert.equal(ctx.polySelection.items.get('A'),entry);assert.equal(r.overlayUploads[0],oldUpload);assert(!oldUpload.released);
 for(let i=0;i<3;i++){assert.equal(overlays[i].geometry.index,indices[i]);assert.equal(overlays[i].geometry.attributes.position,positions[i]);assert.equal(cache.rows.get(overlays[i].geometry),undefined);}
});
test('composed unrelated non-renderOnly pushCmd on B preserves unchanged A prior history owner',()=>{
 const{ctx,mesh}=fixture(),r=ctx.frameOrdinaryOwner('A');
 ctx.polySelection.items=new Map([['B',{vertices:new Set([0]),edges:new Set(),faces:new Set()}]]);
 ctx.frameOrdinaryAfterExternalCommand({renderOnly:false,geometryTargets:['B']});assert(r.current());assert(ctx.frameOrdinarySourceCurrent(r.source));assert.equal(mesh.geometry,r.geometry);
});
test('actual editor bind rollback restores geometry, selection, overlay indices and retained GPU rows',()=>{
 const{ctx,mesh,entry,overlays}=fixture(),r=ctx.frameOrdinaryOwner('A'),old=mesh.geometry,indices=overlays.map(o=>o.geometry.index),oldUpload={};r.overlayUploads=[oldUpload];
 const numeric={};for(const[key,n]of [['fp',3],['ep',2],['vp',1]])numeric[key]={positions:new Float32Array(n*3),extras:new Float32Array(n*9),indices:Uint32Array.from({length:n},(_,i)=>i),vertexCount:n,hasNormals:false,hasUV:false,hasColors:false};
 const packet={entry:{vertices:new Set([1]),edges:new Set(),faces:new Set()},uploads:[{}],overlayNumeric:numeric,measurements:null};const tx=r.actor.hooks.prepareInstall(geom(),packet,{stamp:r.actor.hooks.selectionStamp(),present:()=>true});tx.commit();assert.notEqual(mesh.geometry,old);assert(!oldUpload.released);tx.rollback();assert.equal(mesh.geometry,old);assert.equal(ctx.polySelection.items.get('A'),entry);assert.equal(r.overlayUploads[0],oldUpload);for(let i=0;i<3;i++)assert.equal(overlays[i].geometry.index,indices[i]);assert(r.current());
});
test('actual editor geometry-only bind after selection switches to B leaves B overlays/CM untouched',()=>{
 const{ctx,mesh}=fixture(),r=ctx.frameOrdinaryOwner('A');const b={vertices:new Set([0]),edges:new Set(),faces:new Set()};ctx.polySelection.items=new Map([['B',b]]);ctx.frameOrdinaryCM={owner:'B'};const cm=ctx.frameOrdinaryCM;
 const g=geom(),tx=r.actor.hooks.prepareInstall(g,{entry:{vertices:new Set(),edges:new Set(),faces:new Set()},uploads:[]},{stamp:r.actor.hooks.selectionStamp(),present:()=>false});tx.commit();tx.finish();assert.equal(mesh.geometry,g);assert.equal(ctx.polySelection.items.get('B'),b);assert(!ctx.polySelection.items.has('A'));assert.equal(ctx.frameOrdinaryCM,cm);
});
test('generated injection uses the real legacy parameter names',()=>{
 const candidate=fs.readFileSync(new URL('../../../modules/editor.ordinary-move.qa.js',import.meta.url),'utf8'),ast=ts.createSourceFile('candidate',candidate,99,true,1);
 const fn=name=>ast.statements.findLast(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(ast);
 const ctx=vm.createContext({frameOrdinarySupported:()=>true,gizDrag:{mode:'move'},frameOrdinaryInput:null,frameOrdinaryBeforeExternalEdit:keys=>assert.deepEqual(Array.from(keys),['A']),frameRigidApplyDelta:()=>true});
 vm.runInContext(fn('frameRigidCaptureDragContext'),ctx);ctx.frameRigidCaptureDragContext({});vm.runInContext(fn('applyPolyDelta'),ctx);ctx.applyPolyDelta({},new Map([['A',{}]]));
});
async function atest(name,run){await run();rows.push({name,pass:true});}
await atest('exact-revision barrier completes geometry despite deselect before running Save/edit consumer',async()=>{
 const{ctx}=fixture(),r=ctx.frameOrdinaryOwner('A');r.actor.exact=Promise.resolve();r.actor.displayTail=Promise.resolve();r.actor.packet={};r.actor.root.rows=[{}];
 assert.throws(()=>ctx.frameOrdinaryAssertExact(['A']),{name:'InvalidStateError'});ctx.polySelection.items.clear();r.actor.tryPublish=async()=>{r.actor.packet=null;r.actor.root.rows=[];return true;};let calls=0;
 const result=await ctx.frameOrdinaryContinueExact(()=>{calls++;return 123;},['A']);assert.equal(result,123);assert.equal(calls,1);assert(!ctx.frameOrdinaryExactPending(['A']));
});
await atest('exact-revision barrier rejects active input and an owner changed during await',async()=>{
 const{ctx,mesh}=fixture(),r=ctx.frameOrdinaryOwner('A');r.actor.input={};await assert.rejects(ctx.frameOrdinaryContinueExact(()=>assert.fail('active input consumer'),['A']),{name:'InvalidStateError'});
 r.actor.input=null;r.actor.exact=Promise.resolve().then(()=>{mesh.geometry.attributes.position.needsUpdate=true;});await assert.rejects(ctx.frameOrdinaryContinueExact(()=>assert.fail('stale owner consumer'),['A']),{name:'AbortError'});
});
console.log(JSON.stringify({pass:true,cases:rows.length,rows,scope:'Actual editor ownership/presentation/pivot/transaction helpers and generated entry injections with controlled scene dependencies; no browser claim'}));
