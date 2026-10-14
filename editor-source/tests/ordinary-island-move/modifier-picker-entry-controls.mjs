import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fixture as hoverFixture,gate,settle,THREE,tick} from './selection-lifecycle-fixture.mjs';
import {prepared,gesture} from './composed-fixture.mjs';
const require=createRequire(import.meta.url),ts=require(process.env.FRAME_TYPESCRIPT);
const load=url=>ts.createSourceFile('entry',fs.readFileSync(url,'utf8'),99,true,1);
const ast=load(new URL('../../../modules/editor.ordinary-move.qa.js',import.meta.url));
const frozen=load(new URL('./frozen-v8-control-witness.mjs',import.meta.url));
const fn=(name,tree=ast)=>{const n=tree.statements.findLast(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert(n,name);return n.getText(tree);};
const keyCall=(type,tree=ast)=>tree.statements.map(n=>ts.isExpressionStatement(n)?n.expression:null).find(n=>n&&ts.isCallExpression(n)&&n.expression.getText(tree)==='addEventListener'&&n.arguments[0]?.text===type&&n.arguments[1]?.getText(tree).includes(type==='keydown'?'if(uvEdit&&gizDrag&&e.key===':'pivotKeyDown'));
const rows=[],witnesses=[];
async function test(name,run){console.log(JSON.stringify({starting:name}));await run();rows.push({name,pass:true});}
async function dispose(q){for(const r of q.c.frameOrdinaryOwners.values())await r.actor.dispose();await q.a.dispose();assert.equal(q.pool.bytes,0);}
function readCounter(q){let n=0;const p=q.mesh.geometry.attributes.position;for(const key of ['getX','getY','getZ']){const get=p[key].bind(p);p[key]=i=>{n++;return get(i);};}return()=>n;}
async function fixture(){
 const q=await hoverFixture(),c=q.c,preview=[],pending=[],adds=[],no=()=>{};
 for(const o of [...q.overlays,c.polySelection.faceBack])o.updateMatrixWorld=no;
 Object.assign(c,{Math,_vp:new THREE.Vector3(),viewShading:[1],vpLastX:200,vpLastY:200,isEditing:()=>false,activeTabId:()=>'',selTags:new Set(),treeActive:false,pivotKeyDown:false,vertexEditActive:false,componentFocus:'poly',meshToHash:new Map([[q.mesh,'A']]),
  frameCommitPolySelectionPresentation:no,frameRigidQueue:[],frameRigidInput:null,frameRigidExecuting:null,frameNativeClickQueue:Promise.resolve(),frameNativeClickCommit:false,frameNativeExternalSelection:0,frameNativeLastClick:null,frameNativeTopologyTimer:null,frameNativeTopologyCache:null,frameNativePickerAdapter:null,frameRecordNativeComponentClick:no,frameCameraScreenHit:()=>null,_vpPick:no,componentObjectFallbackPick:()=>false,
  polySelEntry(h){let s=c.polySelection.items.get(h);if(!s)c.polySelection.items.set(h,s={vertices:new Set(),edges:new Set(),faces:new Set()});return s;},
  frameNativePickerError:e=>{if(e.name!=='AbortError')c.errors.push(e);},frameNativeSelectionError:e=>c.errors.push(e),selectionThroughShading:()=>true,
  showVertexToolSnap:s=>preview.push(s?.type??null),hideVertexToolGuides:no,reliableFaceHit:()=>null,frameNativeEdgeRequest:async()=>null,pointSegDistSq(x,y,ax,ay,bx,by){const dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy||1)));return (x-ax-t*dx)**2+(y-ay-t*dy)**2;},addPointAt(_x,_y,_vi,prepared){assert(prepared,'Ctrl miss must reuse snap');adds.push(prepared.snap?.type??null);},
 });
 for(const name of ['polyFocusActive','splineFocusActive','projectPx','frameAfterPicker','resolveVertexToolSnap','updateAddPointPreview','frameNativeQueueClick','frameNativeCommitClick','polyClickPick','doPick','rebuildPolySelection'])vm.runInContext(fn(name),c);
 c.framePreviewResult=op=>{if(op?.then){pending.push(op);op.catch(c.frameNativePickerError);}return op;};
 vm.runInContext(keyCall('keydown').getText(ast),c);vm.runInContext(keyCall('keyup').getText(ast),c);
 const key=(type,extra={})=>{const e={type,key:'Control',code:'ControlLeft',ctrlKey:type==='keydown',metaKey:false,shiftKey:false,altKey:false,target:{tagName:'DIV'},preventDefault(){},...extra};for(const cb of q.listeners.get(type)||[])cb(e);return e;};
 const move=(x=200,y=200,ctrlKey=true)=>{const e=q.hoverEvent(x);Object.assign(e,{clientY:y,ctrlKey});c.onMove(e);};
 const click=(x=200,y=200,ctrlKey=true,extra={})=>c.doPick({button:0,buttons:0,pointerId:1,clientX:x,clientY:y,ctrlKey,metaKey:false,shiftKey:false,altKey:false,defaultPrevented:false,...extra});
 const idle=async()=>{await settle(q,()=>!c.frameOrdinarySnapState.active&&!c.frameOrdinarySnapState.latest&&!c.frameOrdinaryHoverState.active&&!c.frameOrdinaryHoverState.latest,'query idle');const results=await Promise.allSettled(pending);q.lastRejections=results.filter(x=>x.status==='rejected').map(x=>String(x.reason));};
 return{...q,preview,pending,adds,key,move,click,idle};
}
function edge(q){return{mesh:q.mesh,h:'A',edge:[0,1,'0,1'],isCurrent:()=>true};}
function delayed(q){const hold=gate(),send=q.a.request.bind(q.a);let waiting=false,once=true;q.a.request=async(kind,data,t)=>{const result=await send(kind,data,t);if(kind==='vertex-pick-start'&&once){once=false;waiting=true;await hold.promise;}return result;};return{hold,waiting:()=>waiting};}
await test('frozen V8 actual Control keydown repeats linear vertex scan after native edge reply',async()=>{
 for(const count of [48,96]){const q=await fixture();try{
  const g=new THREE.BufferGeometry(),p=new Float32Array(count*3),n=new Float32Array(count*3);for(let i=0;i<count;i++){p[i*3]=100+i;n[i*3+2]=1;}g.setAttribute('position',new THREE.BufferAttribute(p,3));g.setAttribute('normal',new THREE.BufferAttribute(n,3));g.setIndex(new THREE.BufferAttribute(new Uint16Array([0,1,2]),1));q.mesh.geometry=g;
  Object.assign(q.c,{vertexGroupCache:new WeakMap(),vertexGroupOfCache:new WeakMap()});for(const name of ['logicalVertexGroups','reliableHoverVertex','resolveVertexToolSnap'])vm.runInContext(fn(name,frozen),q.c);
  const reads=readCounter(q),hold=gate();q.c.frameNativeEdgeRequest=()=>hold.promise;
  let callback; q.c.addEventListener=(_name,cb)=>callback=cb;vm.runInContext(keyCall('keydown',frozen).getText(frozen),q.c);
  callback({key:'Control',code:'ControlLeft',ctrlKey:true,target:{tagName:'DIV'}});assert.equal(reads(),count*6,'cold grouping plus projection synchronously in keydown');hold.release();await q.pending.at(-1);assert.equal(reads(),count*9,'another projection after edge readback');witnesses.push({vertices:count,synchronousPositionReads:count*6,totalPositionReads:reads()});
 }finally{await dispose(q);}}
});
await test('actual Control/Meta keydown and held pointermove retain vertex preview without CPU scan',async()=>{
 for(const meta of [false,true]){const q=await fixture();try{const reads=readCounter(q);q.key('keydown',meta?{key:'Meta',code:'MetaLeft',ctrlKey:false,metaKey:true}:{});assert.equal(reads(),0);await q.idle();assert.equal(q.preview.at(-1),'vertex',JSON.stringify({errors:q.c.errors.map(String),reject:q.lastRejections,keys:[...q.c.frameOrdinaryModifierKeys]}));assert.equal(reads(),0);q.move();await q.idle();assert.equal(q.preview.at(-1),'vertex');assert.equal(reads(),0);assert.equal(q.c.errors.length,0);}finally{await dispose(q);}}
});
await test('frozen V8 actual empty component hover falls through to synchronous grouping/projection',async()=>{
 const q=await fixture();try{q.c.polySelection.items.clear();Object.assign(q.c,{vertexGroupCache:new WeakMap(),vertexGroupOfCache:new WeakMap()});for(const name of ['frameOrdinarySupported','frameOrdinaryHover','logicalVertexGroups','reliableHoverVertex','onMove','updateHover','updatePolyHover'])vm.runInContext(fn(name,frozen),q.c);const reads=readCounter(q);q.move(200,200,false);assert.equal(reads(),3*6+3,'cold grouping/project plus selected hover position');assert.equal(q.messages.filter(m=>m.kind==='vertex-pick-start').length,0);assert.equal(q.c.polyHover.kind,'vertex');witnesses.push({entry:'empty-component-hover',vertices:3,synchronousPositionReads:reads()});}finally{await dispose(q);}
});
await test('actual Control preview preserves asynchronous edge then face fallback with one vertex query',async()=>{
 for(const type of ['edge','face',null]){const q=await fixture();try{const reads=readCounter(q);q.c.vpLastX=type==='edge'?250:225;q.c.vpLastY=type==='edge'?200:175;let edges=0;q.c.frameNativeEdgeRequest=async()=>{edges++;return type==='edge'?edge(q):null;};q.c.reliableFaceHit=()=>type==='face'?{object:q.mesh,faceIndex:0,point:new THREE.Vector3(.25,.25,0)}:null;q.key('keydown');assert.equal(reads(),0);await q.idle();assert.equal(q.preview.at(-1),type);assert.equal(edges,1);assert.equal(q.messages.filter(m=>m.kind==='vertex-pick-start').length,1);assert(reads()<=9,'only selected edge or face vertices read');assert.equal(q.c.errors.length,0);}finally{await dispose(q);}}
});
await test('modifier moves coalesce one active plus latest and only latest preview applies',async()=>{
 const q=await fixture(),d=delayed(q);try{q.key('keydown');await settle(q,d.waiting);for(let i=0;i<100;i++)q.move(201+i);assert.equal(q.messages.filter(m=>m.kind==='vertex-pick-start').length,1);d.hold.release();await q.idle();assert.equal(q.messages.filter(m=>m.kind==='vertex-pick-start').length,2);assert.deepEqual(q.preview,['vertex']);assert.equal(q.c.errors.length,0);}finally{d.hold.release();await dispose(q);}
});
await test('actual keyup invalidates held preview and starts ordinary hover without stale flash',async()=>{
 const q=await fixture(),d=delayed(q);try{q.key('keydown');await settle(q,d.waiting);q.key('keyup');d.hold.release();await q.idle();assert.equal(q.preview.length,0);assert.equal(q.c.polyHover.kind,'vertex');assert.equal(q.c.errors.length,0);}finally{d.hold.release();await dispose(q);}
});
await test('camera, selection and modifier release invalidate both worker and native edge replies',async()=>{
 for(const stage of ['vertex','edge'])for(const change of ['camera','selection','keyup']){const q=await fixture(),hold=gate();try{q.c.vpLastX=250;let waiting=false;
  if(stage==='vertex'){const send=q.a.request.bind(q.a);q.a.request=async(kind,data,t)=>{const out=await send(kind,data,t);if(kind==='vertex-pick-start'){waiting=true;await hold.promise;}return out;};}else q.c.frameNativeEdgeRequest=()=>{waiting=true;return hold.promise.then(()=>edge(q));};
  q.key('keydown');await settle(q,()=>waiting);if(change==='camera'){q.cam.position.x+=.25;q.cam.updateMatrixWorld(true);}else if(change==='selection'){q.c.framePolySelectionRevision++;q.c.polySelection.items.clear();}else q.c.frameOrdinaryModifierKey({key:'Control',code:'ControlLeft'},false);
  hold.release();await q.idle();assert.equal(q.preview.length,0,stage+' '+change);assert.equal(q.c.errors.length,0);assert.equal((await q.a.request('read',{baseVersion:q.a.version,ids:[]})).vertexPickCount,0);
 }finally{hold.release();await dispose(q);}}
});
await test('empty component map and empty entry use actual ordinary hover/click while Move stays ineligible',async()=>{
 for(const absent of [true,false]){const q=await fixture();try{await q.a.dispose();q.c.frameOrdinaryOwners.clear();q.c.componentFocus='object';if(absent)q.c.polySelection.items.clear();else q.c.polySelection.items.get('A').vertices.clear();assert.equal(q.c.frameOrdinarySupported(),false);assert.equal(q.c.frameOrdinaryPickerTarget(),'A');const reads=readCounter(q);q.key('keydown');await q.idle();assert.equal(q.preview.at(-1),'vertex');assert.equal(reads(),0);q.c.frameOrdinaryModifierKey({key:'Control',code:'ControlLeft'},false);q.move(200,200,false);await q.idle();assert.equal(q.c.polyHover.kind,'vertex');assert(reads()<=3);assert.equal(q.c.frameOrdinarySupported(),false);await q.click(200,200,false);assert.deepEqual([...q.c.polySelection.items.get('A').vertices],[0]);assert.equal(q.c.errors.length,0);}finally{await dispose(q);}}
});
await test('Ctrl hit preserves invert and aliases; misses reuse edge/face/air snap with no second scan',async()=>{
 for(const type of ['vertex','edge','face',null]){const q=await fixture();try{const reads=readCounter(q),x=type==='vertex'?200:type==='edge'?250:225,y=type==='edge'||type==='vertex'?200:175;let edges=0;q.c.frameNativeEdgeRequest=async()=>{edges++;return type==='edge'?edge(q):null;};q.c.reliableFaceHit=()=>type==='face'?{object:q.mesh,faceIndex:0,point:new THREE.Vector3(.25,.25,0)}:null;await q.click(x,y);assert.equal(q.messages.filter(m=>m.kind==='vertex-pick-start').length,1);if(type==='vertex'){assert.equal(q.adds.length,0);assert.equal(q.c.polySelection.items.get('A')?.vertices.size??0,0);assert.equal(edges,0);assert.equal(reads(),0);}else{assert.deepEqual(q.adds,[type]);assert.equal(edges,1);assert(reads()<=9);}assert.equal(q.c.errors.length,0);}finally{await dispose(q);}}
 const q=await fixture();try{const g=q.mesh.geometry.clone();g.setAttribute('position',new THREE.BufferAttribute(new Float32Array([0,0,0,1,0,0,0,1,0,0,0,0]),3));g.setAttribute('normal',new THREE.BufferAttribute(new Float32Array([0,0,1,0,0,1,0,0,1,0,0,1]),3));q.mesh.geometry=g;q.c.polySelection.items.clear();await q.click();assert.deepEqual([...q.c.polySelection.items.get('A').vertices],[0,3]);}finally{await dispose(q);}
});
await test('separate 10px snap and ordinary radius retain boundary semantics',async()=>{
 for(const radius of [7,12]){const q=await fixture();try{q.c.EDIT_HIT_PX=radius;await q.click(209,200);if(radius===7)assert.deepEqual(q.adds,['vertex']);else assert.equal(q.adds.length,0);assert.equal(q.messages.filter(m=>m.kind==='vertex-pick-start').length,1);q.c.vpLastX=211;q.key('keydown');await q.idle();assert.equal(q.preview.at(-1),null,'preview snap radius remains 10');}finally{await dispose(q);}}
});
await test('cold postcommit and warm Control preview use current worker positions',async()=>{
 const q=await fixture();try{const read=await prepared(q.a),job=await gesture(q.a,read,.125);q.a.finish(job);await q.a.exact;await settle(q,()=>!q.a.packet&&!q.a.publishing);q.cam.position.x=.125;q.cam.updateMatrixWorld(true);const reads=readCounter(q);q.key('keydown');await q.idle();q.move();await q.idle();assert.deepEqual(q.preview,['vertex','vertex']);assert.equal(reads(),0);assert.equal(q.c.errors.length,0);}finally{await dispose(q);}
});
await test('ordinary hover cannot overwrite newer modifier preview; click cancels preview before query',async()=>{
 const q=await fixture(),d=delayed(q);try{q.move(200,200,false);await settle(q,d.waiting);q.key('keydown');d.hold.release();await q.idle();assert.equal(q.c.polyHover.kind,null);assert.deepEqual(q.preview,['vertex']);await q.click();assert.equal(q.c.errors.length,0);}finally{d.hold.release();await dispose(q);}
});
await test('pointer leaving viewport and expired native edge lease reject preview',async()=>{
 for(const change of ['outside','edge-lease']){const q=await fixture(),hold=gate();try{q.c.vpLastX=250;let waiting=false;q.c.frameNativeEdgeRequest=()=>{waiting=true;return hold.promise.then(()=>({...edge(q),isCurrent:()=>change!=='edge-lease'}));};q.key('keydown');await settle(q,()=>waiting);if(change==='outside'){q.c.viewAt=()=>-1;q.move(500,500);}hold.release();await q.idle();assert.equal(q.preview.length,0);assert.equal(q.c.errors.length,0);}finally{hold.release();await dispose(q);}}
});
await test('actual Ctrl click survives key release while shift/add and Meta/invert preserve selection',async()=>{
 const q=await fixture(),hold=gate();try{let waiting=false;q.c.frameNativeEdgeRequest=()=>{waiting=true;return hold.promise.then(()=>edge(q));};const operation=q.click(250,200);await settle(q,()=>waiting);q.key('keyup');hold.release();await operation;await q.idle();assert.deepEqual(q.adds,['edge']);await q.click(300,200,false,{shiftKey:true});assert.deepEqual([...q.c.polySelection.items.get('A').vertices],[0,1]);await q.click(300,200,false,{metaKey:true});assert.deepEqual([...q.c.polySelection.items.get('A').vertices],[0]);assert.equal(q.c.errors.length,0);}finally{hold.release();await dispose(q);}
});
console.log(JSON.stringify({pass:true,cases:rows.length,rows,witnesses,scope:'Real generated Control/Meta keydown, keyup, held onMove, doPick/polyClickPick and resolveVertexToolSnap; real owning Node worker. Public tiny fixtures, controlled native edge/face, add-point authoring and selection presentation peripherals, emulated GPU. Counts demonstrate synchronous V8 source work, not attribution of laboratory 3s or GPU/FPS proof; exact visibility and face-ray costs are outside these counts.'}));
