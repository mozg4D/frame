import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import * as THREE from '../../../modules/frame-three-core.9edde002b066a9a05676.js';
import {scene,prepared,gesture,tick} from './composed-fixture.mjs';
const require=createRequire(import.meta.url),ts=require(process.env.FRAME_TYPESCRIPT||'typescript');
const source=fs.readFileSync(new URL('../../../modules/editor.ordinary-move.qa.js',import.meta.url),'utf8'),ast=ts.createSourceFile('candidate',source,99,true,1);
function entries(q){const c=q.ctx;Object.assign(c.OBJ.get('A'),{hash:'A',name:'object',type:1,parent:null,children:[],tags:[],visible:true,enabled:true});
 Object.assign(c,{edgeBevelTool:null,edgeBevelResult:null,lastAttrKey:null,threeOf:new Map([['A',q.mesh]]),meshToHash:new Map([[q.mesh,'A']]),rootOrder:['A'],creaseOverlays:new Map(),frameMotionPaths:new Map(),frameChannels:new Map(),objParams:new Map(),frameActiveCamera:()=>null,frameSerializeChannels:()=>[],frameIndexMotionPaths(){},frameRestoreChannels(){},frameAffineAuthoringHashes:h=>h,frameAffineEnsureAuthoring:h=>c.frameOrdinaryAssertExact(h),frameAffineCommandPreflight(){},frameAutoKeyCommand(){},frameValidateTopologyCommand(){},registerSceneCommandState(){},restoreSceneCommandState(){},afterCmd(){},frameRigidBeforeHistory(){},
  collectSubtree(h,out){if(!c.OBJ.has(h))return;out.add(h);for(const child of c.OBJ.get(h).children)c.collectSubtree(child,out);},snapNode(h){return{h,parent:c.OBJ.get(h).parent,node:{...c.OBJ.get(h)}};},restoreNode(s){Object.assign(c.OBJ.get(s.h),s.node);},trimCommandStack(stack){while(stack.length>64)stack.shift().dispose?.();},clearCommandStack(stack){for(const command of stack)command.dispose?.();stack.length=0;},clearHistory(){c.clearCommandStack(c.undoStack);c.clearCommandStack(c.redoStack);},
  framePrinters:new Map(),clearReplicaOutputs(){},contentThrees:[q.mesh],disposeObjThrees(o){o.geometry?.dispose();},sceneObjects:new Map(),splineVisuals:new Map(),splineData:new Map(),splineSelection:{vertices:new Set(),handles:new Set(),segments:new Set()},clearSplineHover(){},clearPolyHover(){},evaluatedSplineCache:new Map(),brackets:{},frameRigidAbortAll(){},frameAffinePruneStages(){},frameCancelSTLImports(){},disposeSurfaceBatches(){},disposeLibraryBatches(){},nativeLoadRevision:0,clearSplinePointDebug(){},stopVertexModeTool(){},disableSoftSelection(){},disposeThreeMats(){},MATS:new Map(),defaultMatHash:null});
 for(const name of ['runCmd','pushCmd','undo','redo','cmdDelete','clearContent','clearScene'])vm.runInContext(ast.statements.findLast(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(ast),c);
}
async function move(q,x){const j=await gesture(q.a,await prepared(q.a),x);q.a.finish(j);await j.completion;for(let n=0;q.a.packet||q.a.publishing;n++){assert(n<2000);await tick();}return j;}
async function history(ctx,direction){const errors=ctx.errors.length;ctx[direction]();await ctx.frameOrdinaryHistory;assert.equal(ctx.errors.length,errors);}
const rows=[];async function test(name,run){await run();rows.push({name,pass:true});}
await test('actual cmdDelete tears down worker/GPU/map immediately; actual delete Undo rebinds the new node for old Move history',async()=>{
 const q=await scene();entries(q);let restored;try{const job=await move(q,.25),node=q.r.node,command=q.ctx.cmdDelete(['A']);q.ctx.runCmd(command);
  assert.equal(q.ctx.frameOrdinaryOwners.size,0);assert(q.a.closed);assert(!q.ctx.pickMeshes.has('A'));await q.a.disposal;assert.equal(q.pool.bytes,0);assert.equal(q.a.worker.threadId,-1);assert(job.checkpoints);
  q.ctx.undo();assert(q.ctx.pickMeshes.get('A')===q.mesh);assert(q.ctx.OBJ.get('A')!==node);assert.equal(job.command.ordinaryMove.node,q.ctx.OBJ.get('A'));await history(q.ctx,'undo');restored=q.ctx.frameOrdinaryOwners.get('A').actor;assert.equal(q.mesh.geometry.attributes.position.array[0],0);await history(q.ctx,'redo');assert.equal(q.mesh.geometry.attributes.position.array[0],.25);q.ctx.redo();assert.equal(q.ctx.frameOrdinaryOwners.size,0);await restored.disposal;assert.equal(q.pool.bytes,0);
 }finally{await restored?.dispose();await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('actual clearContent retires all ordinary owners, invalidates old history epoch and drops checkpoint references',async()=>{
 const q=await scene();entries(q);try{const job=await move(q,.25),epoch=q.ctx.frameOrdinarySceneEpoch;q.ctx.clearContent();assert.equal(q.ctx.frameOrdinaryOwners.size,0);assert.equal(q.ctx.frameOrdinarySceneEpoch,epoch+1);assert.equal(job.checkpoints,null);assert.equal(q.ctx.undoStack.length,0);await q.a.disposal;assert.equal(q.pool.bytes,0);assert.equal(q.a.root,null);assert.equal(q.a.worker.threadId,-1);await assert.rejects(q.ctx.frameOrdinaryResolveHistory(job.command),{name:'AbortError'});
 }finally{await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('actual clearScene during a pending gesture rejects stale results and releases transient and scene ownership',async()=>{
 const q=await scene();entries(q);try{const job=await gesture(q.a,await prepared(q.a),.25);q.ctx.frameOrdinaryInput={r:q.r,job,before:[]};q.ctx.clearScene();await q.a.disposal;
  assert.equal(q.ctx.frameOrdinaryOwners.size,0);assert.equal(q.ctx.frameOrdinaryInput,null);assert.equal(q.ctx.OBJ.size,0);assert.equal(q.ctx.pickMeshes.size,0);assert.equal(q.a.jobs.length,0);assert.equal(job.claim,null);assert.equal(job.uiSession,null);assert.equal(q.a.worker.threadId,-1);assert.equal(q.pool.bytes,0);
 }finally{await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('replacement map boundary retires A and cannot authorize old history for a different mesh reusing h',async()=>{
 const q=await scene();entries(q);let replacement;try{const job=await move(q,.25),mesh=new THREE.Mesh(q.mesh.geometry.clone());q.ctx.frameOrdinarySetMap(q.ctx.pickMeshes,'A',mesh);assert.equal(q.ctx.frameOrdinaryOwners.size,0);await q.a.disposal;assert.equal(q.pool.bytes,0);await assert.rejects(q.ctx.frameOrdinaryResolveHistory(job.command),{name:'AbortError'});
  replacement=q.ctx.frameOrdinaryOwner('A');await replacement.actor.ready;assert(replacement.current());assert.equal(q.ctx.frameOrdinaryOwners.size,1);mesh.geometry=mesh.geometry.clone();q.ctx.frameOrdinarySetMap(q.ctx.pickMeshes,'A',mesh);assert.equal(q.ctx.frameOrdinaryOwners.size,0);await replacement.actor.disposal;assert.equal(q.pool.bytes,0);
  replacement=q.ctx.frameOrdinaryOwner('A');await replacement.actor.ready;assert(replacement.current());q.ctx.frameOrdinaryDeleteMap(q.ctx.OBJ,'A');await replacement.actor.disposal;assert.equal(q.ctx.frameOrdinaryOwners.size,0);assert.equal(q.pool.bytes,0);
 }finally{await replacement?.actor.dispose();await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('generated editor wraps every global OBJ/pickMeshes set/delete/clear mutation and pins official delete Undo rebind',async()=>{
 let unwrapped=0;const walk=n=>{if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&['OBJ','pickMeshes'].includes(n.expression.expression.getText(ast))&&['set','delete','clear'].includes(n.expression.name.text))unwrapped++;ts.forEachChild(n,walk);};walk(ast);assert.equal(unwrapped,0);
 const deletion=ast.statements.findLast(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='cmdDelete').getText(ast);assert(deletion.includes('frameOrdinaryRestoreHistoryOwners(list,frameOrdinaryDeleteEpoch)'));
});
console.log(JSON.stringify({pass:true,cases:rows.length,rows,scope:'Actual generated cmdDelete/Undo/Redo/clearContent/clearScene entry functions and map boundaries with real worker and native GPU pool; unrelated scene services mocked, no browser claim'}));
