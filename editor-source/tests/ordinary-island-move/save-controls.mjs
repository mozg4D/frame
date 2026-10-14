import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {scene,prepared,gesture,tick,identity,context} from './composed-fixture.mjs';
const require=createRequire(import.meta.url),ts=require(process.env.FRAME_TYPESCRIPT||'typescript');
const source=fs.readFileSync(new URL('../../../modules/editor.ordinary-move.qa.js',import.meta.url),'utf8'),ast=ts.createSourceFile('candidate',source,99,true,1);
function saveEntries(ctx){
 const captures=[],elements=[];const element=()=>{const e={style:{},setAttribute(){},append(){},remove(){this.removed=true;}};elements.push(e);return e;};
 Object.assign(ctx,{AbortController,Blob,performance,setTimeout,clearTimeout,document:{createElement:element,body:{append(){}}},nativeSceneSave:null,prepareNativeTextures:async()=>{},generatorTimer:null,generatorActivePasses:0,replicaStates:new Map(),nativeSaveMutation:0,sceneStateToken:1,nativeBlobState:new WeakMap(),frameAffineSaving:null,frameAffineSavingBoundary:null,
  blurActive(){},frameAffineAuthoringDrain:async()=>{},frameAffinePruneStages(){},frameAffineBoundary:()=>({released:[],stages:[],active:null}),frameAffineBoundaryCurrent:()=>true,frameContourOrigins:new WeakMap(),rootOrder:['A'],captureShareViewport:()=>({}),assertFrameLibraryReady(){},objParams:new Map(),TYPE_MESH:1,HASH_IDENTITY:identity,packTR:()=>identity,packPivot:()=>identity,frameAuthoredNode:n=>n,hashEqual:(a,b)=>JSON.stringify(a)===JSON.stringify(b),SCHEMA:{},splineData:new Map(),PARAMETRIC_MESH_TYPES:new Set(),PARAMETRIC_SPLINE_TYPES:new Set(),LIBRARY_MESH_TYPES:new Set(),shareRebuildsGeometry:()=>false,sceneObjects:new Map(),MATS:new Map(),defaultMatHash:'',frameChannels:new Map(),getAllMatHashes:()=>[],animationPayload:()=>({extras:{channels:[],activeCamera:null},current:0,total:120}),
  nativeSaveEncode:async snapshot=>{captures.push(snapshot.scene);return new Blob([new Uint8Array([1])]);}});
 Object.assign(ctx.OBJ.get('A'),{children:[],name:'object',type:1,tags:[],visible:true,enabled:true});
 for(const name of ['nativeSaveCheck','nativeSaveWait','frameAffineWaitForSave','frameAffineSaveSnapshot','nativeGeometrySnapshot','packedGeometryAttribute','buildHashSceneSnapshot','nativeSaveCopy','fullBlob'])vm.runInContext(ast.statements.findLast(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(ast),ctx);
 return{captures,elements};
}
function delayed(a,{invalid=false}={}){const transport=a.request.bind(a);let release,posted=false,first=true;const gate=new Promise(r=>release=r);a.request=async(kind,data,transfer)=>{if(kind==='compute'&&first){first=false;posted=true;await gate;if(invalid){const delta=data.delta.slice();delta[12]=NaN;data={...data,delta};}}return transport(kind,data,transfer);};return{release,get posted(){return posted;}};}
async function tilted(a){const q=await prepared(a),j=a.start(Promise.resolve(q),context),delta=identity.slice();delta[14]=1;a.pose(j,delta,delta);await j.display;await j.row.scheduler.whenIdle();a.finish(j);return{q,j};}
function snapshotGeometry(captures){assert.equal(captures.length,1);return captures[0].nodes[0][1].geometry;}
const rows=[];
async function test(name,run){await run();rows.push({name,pass:true});}
await test('real fullBlob Save waits for ordinary compute and snapshots exact Stock normals/topology',async()=>{
 const q=await scene(),save=saveEntries(q.ctx),delay=delayed(q.a);
 try{const{j}=await tilted(q.a);while(!delay.posted)await tick();assert.equal(q.mesh.geometry.attributes.normal.getZ(0),1);const saving=q.ctx.fullBlob();await tick();assert.equal(save.captures.length,0);delay.release();await saving;await j.completion;
  const actual=snapshotGeometry(save.captures);assert.equal(actual.normals[2],Math.fround(1/Math.sqrt(3)));assert.deepEqual(actual.normals,q.mesh.geometry.attributes.normal.array);assert.deepEqual(actual.positions,q.mesh.geometry.attributes.position.array);assert.deepEqual(actual.indices,q.mesh.geometry.index.array);assert.equal(q.a.root.rows.length,0);assert(save.elements[0].removed);
 }finally{delay.release();await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('real Save captures the latest released queued chain A then B, including exact normals',async()=>{
 const q=await scene(),save=saveEntries(q.ctx),delay=delayed(q.a);
 try{const{j}=await tilted(q.a);while(!delay.posted)await tick();const second=await gesture(q.a,await prepared(q.a),.25);q.a.finish(second);const saving=q.ctx.fullBlob();await tick();assert.equal(save.captures.length,0);delay.release();await saving;await j.completion;await second.completion;
  assert(j.accepted&&second.accepted);assert.equal(q.a.version,2);const actual=snapshotGeometry(save.captures);assert.deepEqual(actual.positions,q.mesh.geometry.attributes.position.array);assert.deepEqual(actual.normals,q.mesh.geometry.attributes.normal.array);assert(actual.normals[2]!==1);assert.equal(q.ctx.undoStack.length,2);
 }finally{delay.release();await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('real Save after rejected A and released dependent B records canonical base, with no ghost history',async()=>{
 const q=await scene(),save=saveEntries(q.ctx),delay=delayed(q.a,{invalid:true});
 try{const before=q.mesh.geometry.attributes.position.array.slice(),{j}=await tilted(q.a);while(!delay.posted)await tick();const second=await gesture(q.a,await prepared(q.a),.25);q.a.finish(second);const saving=q.ctx.fullBlob();await tick();assert.equal(save.captures.length,0);delay.release();await saving;await j.completion;await second.completion;
  assert(j.cancelled&&second.cancelled);assert(!second.accepted);const actual=snapshotGeometry(save.captures);assert.deepEqual(actual.positions,before);assert.equal(actual.normals[2],1);assert.equal(q.ctx.undoStack.length,0);assert.equal(q.mesh.geometry.attributes.position.getZ(0),0);
 }finally{delay.release();await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('real Save Cancel during pending ordinary compute returns no snapshot and leaves Move able to finish',async()=>{
 const q=await scene(),save=saveEntries(q.ctx),delay=delayed(q.a),controller=new AbortController();
 try{const{j}=await tilted(q.a);while(!delay.posted)await tick();const saving=q.ctx.fullBlob({signal:controller.signal});await tick();controller.abort(new DOMException('witness: Save Cancel','AbortError'));await assert.rejects(saving,{name:'AbortError'});assert.equal(save.captures.length,0);assert.equal(q.ctx.nativeSceneSave,null);assert(save.elements[0].removed);delay.release();await j.completion;while(q.a.publishing||q.a.packet)await tick();assert(j.accepted);assert.equal(q.a.version,1);
 }finally{delay.release();await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('real Save fails closed on fatal Move worker without capturing provisional normals',async()=>{
 const q=await scene(),save=saveEntries(q.ctx),delay=delayed(q.a);
 try{const{j}=await tilted(q.a);while(!delay.posted)await tick();const saving=q.ctx.fullBlob();await tick();q.a.worker.emit('error',Error('witness: fatal Save worker'));delay.release();await assert.rejects(saving,{name:'AbortError'});await j.completion;assert.equal(save.captures.length,0);assert.equal(q.ctx.nativeSceneSave,null);assert.equal(q.mesh.geometry.attributes.position.getZ(0),0);
 }finally{delay.release();await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
console.log(JSON.stringify({pass:true,cases:rows.length,rows,scope:'Actual generated fullBlob native Save entry, affine wait, scene builder, geometry snapshot and cooperative copy + real ordinary worker/display; only DOM, old empty affine stages and final file encoding mocked; no disk write or browser claim'}));
