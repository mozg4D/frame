import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import * as THREE from '../../../modules/frame-three-core.9edde002b066a9a05676.js';
import {vertexPickWork,vertexPickPage,vertexPickGroup} from '../../../native-source/ordinary-move-picking.mjs';
import {scene,prepared,gesture,tick} from './composed-fixture.mjs';
const require=createRequire(import.meta.url),ts=require(process.env.FRAME_TYPESCRIPT||'typescript');
const text=fs.readFileSync(new URL('../../../modules/editor.ordinary-move.qa.js',import.meta.url),'utf8'),ast=ts.createSourceFile('candidate',text,99,true,1),frozenText=fs.readFileSync(new URL('../../../modules/editor.b46b7edb7b8fab6c0f1e.js',import.meta.url),'utf8'),frozen=ts.createSourceFile('frozen',frozenText,99,true,1);
const fn=(name,tree=ast)=>tree.statements.findLast(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(tree),rows=[];async function test(name,run){await run();rows.push({name,pass:true});}
const drain=work=>{let q;do{q=work.next();}while(!q.done);return q.value;};
function camera(){const cam=new THREE.OrthographicCamera(-2,2,2,-2,.1,100);cam.position.z=10;cam.updateMatrixWorld(true);cam.updateProjectionMatrix();return cam;}
async function fixture(){
 const q=await scene(),c=q.ctx,cam=camera(),rect={x:0,y:0,w:400,h:400},listeners=new Map();let clicks=0,legacy=0;
 Object.assign(c,{performance,gizmoLocal:false,EDIT_HIT_PX:12,frameNativeClickQueue:Promise.resolve(),frameNativeClickCommit:false,frameNativeExternalSelection:0,framePolySelectionJob:null,frameNativeLastClick:null,frameNativeTopologyTimer:null,frameNativeTopologyCache:null,frameNativePickerLane:null,frameNativePickerAdapter:null,frameNativePickerError:e=>c.errors.push(e),frameNativePickerGuard:()=>()=>true,
  vpState:{views:[{cam}],renderer:{isFrameNativeViewportRenderer:true}},viewAt:()=>0,rectFor:()=>rect,selectionThroughShading:()=>false,exactVertexVisible:()=>true,meshToHash:new Map([[q.mesh,'A']]),effectiveVisible:()=>true,isVertexEditableMesh:()=>true,
  frameCameraScreenHit:()=>null,splineMode:false,splinePointerGesture:null,gizDrag:null,vertexEditActive:false,componentFocus:'poly',edgeBevelResult:null,lastAttrKey:null,frameRecordNativeComponentClick(){},
  _vpPick(){clicks++;},polySelEntry(h){let s=c.polySelection.items.get(h);if(!s){s={vertices:new Set(),edges:new Set(),faces:new Set()};c.polySelection.items.set(h,s);}return s;},
  reliableHoverVertex(){legacy++;throw Error('Synchronous whole-mesh vertex scan is forbidden on this ordinary click');},componentObjectFallbackPick:()=>false,frameCancelPolySelectionWork(){},addEventListener:(name,cb)=>listeners.set(name,cb),removeEventListener(){},
 });
 for(const name of ['frameOrdinaryPrepare','frameNativeQueueClick','frameNativeCommitClick','polyClickPick','doPick','rebuildPolySelection','frameCommitPolySelectionPresentation','frameCancelPolySelectionWork','frameNativeConnectedGuard','frameStartNativeConnected','frameBindNativeDoubleClick'])vm.runInContext(fn(name),c);
 const dom={addEventListener:(name,cb)=>listeners.set(name,cb),removeEventListener(){}};c.frameBindNativeDoubleClick(dom);
 const messages=[],post=q.a.worker.postMessage.bind(q.a.worker);q.a.worker.postMessage=(m,t)=>{messages.push({kind:m.kind,contextBytes:m.context?JSON.stringify(m.context).length:0});return post(m,t);};
 return{...q,c,cam,rect,listeners,messages,legacy:()=>legacy,clicks:()=>clicks,event:()=>({button:0,buttons:0,pointerId:1,clientX:200,clientY:200,ctrlKey:false,metaKey:false,shiftKey:false,altKey:false,defaultPrevented:false})};
}
await test('worker grouping/projection ordering exactly matches frozen vertex oracle including aliases and occlusion',()=>{
 const cam=camera(),rect={x:20,y:30,w:400,h:400},p=Float32Array.from([0,0,0,0,0,1,.02,0,0,.02,0,0,5,0,0,0,0,200]),g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(p,3));const mesh=new THREE.Mesh(g);mesh.updateMatrixWorld(true);
 for(const through of [false,true]){const visible=w=>w.z===0,ctx=vm.createContext({THREE2:THREE,selNodes:new Set(['A']),pickMeshes:new Map([['A',mesh]]),vertexGroupCache:new WeakMap(),vertexGroupOfCache:new WeakMap(),isVertexEditableMesh:()=>true,effectiveVisible:()=>true,exactVertexVisible:visible,EDIT_HIT_PX:12});for(const name of ['logicalVertexGroups','reliableHoverVertex'])vm.runInContext(fn(name,frozen),ctx);
  const oracle=ctx.reliableHoverVertex(220,230,cam,rect,through),result=drain(vertexPickWork({positions:p},{world:mesh.matrixWorld.toArray(),view:cam.matrixWorldInverse.toArray(),projection:cam.projectionMatrix.toArray(),rect,cx:220,cy:230,radius:12})),pick=result.candidates.find(q=>through||visible(new THREE.Vector3(q.x,q.y,q.z)));
  assert.equal(pick.id,oracle.vi);assert.equal(pick.d,oracle.d);assert.equal(pick.depth,oracle.depth);assert.deepEqual(result.groups.get(pick.id),Array.from(oracle.vertices));}
});
await test('candidate pages and final alias chunks stay bounded and independent',()=>{
 const p=new Float32Array(9000*3),cam=camera(),context={world:new THREE.Matrix4().toArray(),view:cam.matrixWorldInverse.toArray(),projection:cam.projectionMatrix.toArray(),rect:{x:0,y:0,w:400,h:400},cx:200,cy:200,radius:12},q=drain(vertexPickWork({positions:p},context)),page=vertexPickPage(q,0),one=vertexPickGroup(q,0,0),two=vertexPickGroup(q,0,8192);
 assert(page.candidates.byteLength<=4096);assert.equal(one.vertices.byteLength,32768);assert.equal(two.vertices.length,808);one.vertices.fill(0xffffffff);assert.equal(q.groups.get(0)[0],0);assert.throws(()=>vertexPickPage(q,-1));assert.throws(()=>vertexPickGroup(q,1,0));
});
await test('actual doPick/native queue/polyClickPick uses worker after canonical commit with cold logical caches',async()=>{
 const q=await fixture();try{const read=await prepared(q.a),job=await gesture(q.a,read,.125);q.a.finish(job);await q.a.exact;for(let n=0;q.a.packet||q.a.publishing;n++){assert(n<2000);await tick();}
  q.cam.position.x=.125;q.cam.updateMatrixWorld(true);q.mesh.geometry.attributes.position.getX=()=>{throw Error('Main thread geometry grouping/projection read');};await q.c.doPick(q.event());assert.equal(q.legacy(),0);assert.equal(q.c.frameOrdinaryNotes.vertexPicks,1);assert.equal(q.c.polySelection.items.get('A').vertices.size,1);assert(q.messages.some(m=>m.kind==='vertex-pick-start'));assert(q.messages.filter(m=>m.kind==='vertex-pick-start').every(m=>m.contextBytes<2048));
  await q.c.frameOrdinaryPrepared?.promise;const state=await q.a.request('read',{baseVersion:q.a.version,ids:[]});assert.equal(state.vertexPickCount,0);assert.equal(q.a.selectionOperations,0);assert.equal(q.c.errors.length,0);
 }finally{await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('actual vertex wrapper skips occluded nearest candidate and preserves through selection',async()=>{
 for(const through of [false,true]){const q=await fixture();try{q.c.selectionThroughShading=()=>through;let probes=0;q.c.exactVertexVisible=()=>{probes++;return false;};await q.c.doPick(q.event());if(through){assert.equal(q.c.polySelection.items.get('A').vertices.size,1);assert.equal(probes,0);}else assert(probes>0);assert.equal(q.legacy(),0);assert.equal((await q.a.request('read',{baseVersion:q.a.version,ids:[]})).vertexPickCount,0);}finally{await q.a.dispose();assert.equal(q.pool.bytes,0);}}
});
await test('real double-click binding expands clicked seed through ordinary worker and awaits its selection',async()=>{
 const q=await fixture();try{await q.c.doPick(q.event());assert.equal(q.c.polySelection.items.get('A').vertices.size,1);await q.listeners.get('dblclick')(q.event());await q.c.frameNativeClickQueue;assert.equal(q.c.polySelection.items.get('A').vertices.size,3);assert(q.messages.some(m=>m.kind==='prepare-read'));assert.equal(q.legacy(),0);assert.equal(q.c.errors.length,0);}finally{await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('real gizmo/HUD entries defer cold legacy measurements until ordinary preparation is ready',async()=>{
 const q=await fixture(),send=q.a.request.bind(q.a);let resume;const hold=new Promise(r=>resume=r);q.a.request=async(kind,data,t)=>{if(kind==='prepare-read')await hold;return send(kind,data,t);};
 try{await q.c.doPick(q.event());const oldPlace=q.c.placeGizmoForSelection,oldHUD=q.c.updateHUD;let hidden=false;q.c.readTransform=()=>assert.fail('Synchronous selection measurements');q.c.setGizmoVisible=v=>hidden=!v;
  vm.runInContext(fn('placeGizmoForSelection'),q.c);vm.runInContext(fn('updateHUD'),q.c);q.c.placeGizmoForSelection();q.c.updateHUD();assert(hidden);q.c.placeGizmoForSelection=oldPlace;q.c.updateHUD=oldHUD;resume();await q.c.frameOrdinaryPrepared.promise;assert.equal(q.c.errors.length,0);
 }finally{resume();await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('camera/context invalidation cancels worker query and releases publication hold',async()=>{
 const q=await fixture();try{await assert.rejects(q.c.frameOrdinaryVertexPick(200,200,0,q.rect,q.cam,()=>false),{name:'AbortError'});assert.equal(q.a.selectionOperations||0,0);const result=await q.c.frameOrdinaryVertexPick(200,200,0,q.rect,q.cam,()=>true);assert.equal(q.a.selectionOperations,1);result.release();result.release();assert.equal(q.a.selectionOperations,0);assert.equal((await q.a.request('read',{baseVersion:q.a.version,ids:[]})).vertexPickCount,0);}finally{await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('context changed after worker response cancels query atomically and fresh real click succeeds',async()=>{
 const q=await fixture(),send=q.a.request.bind(q.a);let current=true,once=true;q.a.request=async(kind,data,t)=>{const value=await send(kind,data,t);if(kind==='vertex-pick-start'&&once){once=false;current=false;}return value;};
 try{const before=q.c.polySelection.items.get('A');await assert.rejects(q.c.frameOrdinaryVertexPick(200,200,0,q.rect,q.cam,()=>current),{name:'AbortError'});assert.equal(q.c.polySelection.items.get('A'),before);assert.equal(q.a.selectionOperations,0);assert.equal((await q.a.request('read',{baseVersion:q.a.version,ids:[]})).vertexPickCount,0);current=true;await q.c.doPick(q.event());assert.equal(q.legacy(),0);assert.equal(q.c.frameOrdinaryNotes.vertexPicks,1);}finally{await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('real vertex entry picks released preview positions while canonical publication is pending',async()=>{
 const q=await fixture(),publish=q.a.tryPublish;q.a.tryPublish=async()=>false;
 try{const read=await prepared(q.a),job=await gesture(q.a,read,.125);q.a.finish(job);await q.a.exact;assert.equal(q.a.renderVersion,0);assert.equal(q.a.version,1);q.cam.position.x=.125;q.cam.updateMatrixWorld(true);await q.c.doPick(q.event());assert.equal(q.c.polySelection.items.get('A').vertices.has(0),true);assert.equal(q.legacy(),0);assert.equal(q.a.selectionOperations,0);q.a.tryPublish=publish;await q.c.frameOrdinaryPrepared?.promise;await q.a.tryPublish({force:true});assert.equal(q.mesh.geometry.attributes.position.getX(0),.125);}finally{q.a.tryPublish=publish;await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('fatal worker failure during vertex query releases its publication hold and owner',async()=>{
 const q=await fixture(),send=q.a.request.bind(q.a);let once=true;q.a.request=async(kind,data,t)=>{const value=await send(kind,data,t);if(kind==='vertex-pick-start'&&once){once=false;q.a.worker.emit('error',Error('controlled vertex-query transport failure'));}return value;};
 try{await assert.rejects(q.c.frameOrdinaryVertexPick(200,200,0,q.rect,q.cam,()=>true),{name:'AbortError'});await q.a.disposal;assert(q.a.closed);assert.equal(q.a.selectionOperations,0);assert.equal(q.a.root,null);}finally{await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
console.log(JSON.stringify({pass:true,cases:rows.length,rows,scope:'Frozen exact vertex oracle; real generated doPick/native queue/polyClickPick/double-click/gizmo/HUD entries and owning Node worker; small public fixtures, controlled visibility/peripherals, emulated GPU. No attribution of hardware milliseconds or FPS claim.'}));
