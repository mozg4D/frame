import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import * as THREE from '../../../modules/frame-three-core.9edde002b066a9a05676.js';
import {scene,tick} from './composed-fixture.mjs';
const require=createRequire(import.meta.url),ts=require(process.env.FRAME_TYPESCRIPT||'typescript');
const candidate=fs.readFileSync(new URL('../../../modules/editor.ordinary-move.qa.js',import.meta.url),'utf8'),ast=ts.createSourceFile('event-candidate',candidate,99,true,1);
const frozen=fs.readFileSync(new URL('../../../modules/editor.b46b7edb7b8fab6c0f1e.js',import.meta.url),'utf8'),oldAST=ts.createSourceFile('frozen',frozen,99,true,1);
const fn=(name,tree=ast)=>tree.statements.findLast(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(tree);
function calls(tree,name){const out=[];function visit(n){if(ts.isCallExpression(n)&&ts.isIdentifier(n.expression)&&n.expression.text===name)out.push(n);ts.forEachChild(n,visit);}visit(tree);return out;}
const keys=calls(ast,'addEventListener').filter(n=>n.arguments[0]?.text==='keydown'&&n.arguments[1]?.getText(ast).includes('if(uvEdit&&gizDrag&&e.key==='));assert.equal(keys.length,1);
const gate=()=>{let resolve;return{promise:new Promise(r=>resolve=r),release:()=>resolve()};};
async function settle(a){await a.exact;for(let n=0;a.packet||a.publishing||a.operations;n++){assert(n<2500);await tick();}}
async function fixture(){
 const q=await scene(),c=q.ctx,cam=new THREE.OrthographicCamera(-2,2,2,-2,.1,100);cam.position.z=10;cam.updateMatrixWorld(true);cam.updateProjectionMatrix();
 const cube=new THREE.Object3D(),rect={x:0,y:0,w:400,h:400},listeners=new Map(),capture=[],raf=new Map();let rafSerial=0,legacyActions=0;
 const no=()=>{};Object.assign(c,{performance,Math,frameAffineAuthoringPointer:null,frameAffineAuthoringPointerReplay:null,frameAffineNumericSessions:new Set(),frameAffineStages:new Map(),frameRigidQueue:[],frameRigidInput:null,frameRigidFallthrough:false,frameRigidGestureGeneration:0,frameRigidCancelDerived:no,frameRigidBasic:()=>false,frameAffineRunExactAction(){legacyActions++;return Promise.resolve();},frameAffineAuthoringNotice:no,framePolygonCopyDragAllowed:()=>true,
  gizmo:{pos:new THREE.Vector3(),lin:new THREE.Matrix4()},gizmoLocal:false,cubeRef:{mesh:cube},hudNode:null,gizDrag:null,_t1:new THREE.Vector3(),_t2:new THREE.Vector3(),_P:new THREE.Vector3(),_o:new THREE.Vector3(),_d:new THREE.Vector3(),_vp:new THREE.Vector3(),_cr:new THREE.Vector3(),snapOn:false,quantOn:false,ignoreBridge:false,coordinateBridgeOperation:null,boundNode:null,pivotKeyDown:false,pivotKeyRestorePending:false,
  vpState:{views:[{cam,type:'ortho',ctrl:{down:no,up:no,move:no}}],renderer:{domElement:{setPointerCapture:id=>capture.push(['set',id]),releasePointerCapture:id=>capture.push(['release',id])}}},viewAt:()=>0,rectFor:()=>rect,freezeSignsAll:no,clearHover:no,hideHudLine:no,hideSnapVis:no,emitInfo:no,finishMomentaryPivot:no,frozenSignsPerView:null,TAP_PX:2,LMB:1,RMB:2,MMB:4,VIEW_SWITCH_PX:4,
  mobileTouchDown:()=>false,mobileTouchMove:()=>false,mobileTouchUp:()=>false,frameTouchContacts:new Map(),frameNativePinch:null,splineBevelResult:null,splineBevelTool:null,splineOutlineResult:null,splineOutlineTool:null,splinePointerGesture:null,splineMode:false,splineDrawing:false,edgeBevelTool:null,vertexTools:{soft:{active:false},mode:null,snap:false},noteViewportAction:no,blurActive:no,stopVertexModeTool:no,activeView:-1,lastX:0,lastY:0,downX:0,downY:0,frameViewportMarqueeDragged:false,
  generatorTransformTargets:()=>[],scheduleGeneratorEvaluation:no,refreshProjectionFramesForObjects:no,framePolygonGizmoMoveRAF:0,framePolygonGizmoMoveEvent:null,gizBeforeSpline:null,
  requestAnimationFrame:cb=>{const id=++rafSerial;raf.set(id,cb);return id;},cancelAnimationFrame:id=>raf.delete(id),
  addEventListener:(name,cb)=>listeners.set(name,cb),onGizmoDragStart:cb=>c._gizStart=cb,onGizmoDragEnd:cb=>c._gizEnd=cb,
  setRay(view,r){c._o.set(r._cx/100,0,10);c._d.set(0,0,-1);},planeHit(o,d,point,normal,target){return new THREE.Ray(o,d).intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(normal,point),target);},
  syncCube(){cube.position.copy(c.gizmo.pos);cube.updateMatrixWorld(true);},
  placeGizmoForSelection(m){if(m){c.gizmo.pos.setFromMatrixPosition(m.frame);c.syncCube();}}
 });
 vm.runInContext(fn('frameOrdinaryPrepare'),c);c.frameOrdinaryPrepare();await c.frameOrdinaryPrepared.promise;
 const names=['frameAffineGizmoVersionedAdmission','frameAffineAuthoringPending','frameAffineDeferGizmoStart','frameAffinePointerView','frameAffinePointerViewCurrent','frameAffinePointerEvent','frameAffineCancelPublication','frameAffinePendingPointerMove','frameAffinePendingPointerEnd','startGizDrag','onDown','onMove','onUp','doGizDrag','endGizDrag','frameClearPolygonGizmoMove','frameFlushPolygonGizmoMove','frameQueuePolygonGizmoMove','frameRigidCaptureDragContext','frameRigidStart','frameRigidApplyDelta','frameRigidFinish','applyPolyDelta','bridgeTransform','getGizmoWorldArray','emitTransform','onTransform'];
 for(const name of names)vm.runInContext(fn(name),c);
 for(const name of ['onGizmoDragStart','onGizmoDragEnd','onTransform']){const matches=calls(ast,name).filter(n=>n.arguments[0]&&(ts.isArrowFunction(n.arguments[0])||ts.isFunctionExpression(n.arguments[0])));assert.equal(matches.length,1);vm.runInContext(matches[0].getText(ast),c);}
 vm.runInContext(keys[0].getText(ast),c);
 c.hitGizmo=()=>({object:{name:'P'},view:0,fr:{},r:rect});
 let x=100;const event=(type,at,buttons=1)=>({type,pointerId:41,pointerType:'mouse',button:0,buttons,clientX:at,clientY:100,ctrlKey:false,metaKey:false,shiftKey:false,altKey:false,preventDefault(){this.prevented=true;},stopPropagation(){}});
 return{...q,c,cam,capture,listeners,legacyActions:()=>legacyActions,
  down(){const e=event('pointerdown',x);c.onDown(e);return e;},
  async drag(waitDisplay=true){this.down();x+=12.5;c.onMove(event('pointermove',x));c.frameFlushPolygonGizmoMove();assert(c.frameOrdinaryInput?.job,'real pointer movement enters Ordinary Move');const job=c.frameOrdinaryInput.job;if(waitDisplay){await job.display;await job.row.scheduler.whenIdle();}return job;},
  up(){c.onUp(event('pointerup',x,0));x+=100;},
  escape(){const e={type:'keydown',key:'Escape',pointerId:undefined,ctrlKey:false,metaKey:false,shiftKey:false,target:{tagName:'DIV'},preventDefault(){this.prevented=true;}};listeners.get('keydown')(e);assert(e.prevented);return e;}
 };
}
const rows=[];async function test(name,run){console.log(JSON.stringify({starting:name}));await run();rows.push({name,pass:true});console.log(JSON.stringify({completed:name}));}
for(const mode of ['world','object'])await test('actual onDown/startGizDrag/onMove/onUp admits repeat before exact commit in '+mode,async()=>{
 const q=await fixture(),hold=gate(),send=q.a.request.bind(q.a);let computing=false,once=true;
 q.c.coordMode=mode;q.a.request=async(kind,data,transfers)=>{if(kind==='compute'&&once){once=false;computing=true;await hold.promise;}return send(kind,data,transfers);};
 try{const a=await q.drag();q.up();while(!computing)await tick();assert.equal(q.a.operations,1);assert.equal(q.c.frameOrdinaryNotes.starts,1);q.cam.position.x+=.5;q.cam.updateMatrixWorld(true);
  const b=await q.drag();assert.equal(q.c.frameOrdinaryNotes.starts,2);assert.equal(q.a.input,b);assert.equal(q.a.version,0);assert.equal(q.a.root.position(0)[0],.25,JSON.stringify({aDelta:[...a.delta],bDelta:[...b.delta],gizmo:q.c.getGizmoWorldArray(),notes:q.c.frameOrdinaryNotes}));assert.equal(q.legacyActions(),0);q.up();hold.release();await settle(q.a);assert(a.published&&b.published);assert.equal(q.mesh.geometry.attributes.position.getX(0),.25);assert.equal(q.c.undoStack.length,2);assert.equal(q.c.errors.length,0);
 }finally{hold.release();await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('actual repeat entry admits immediately and supersedes cooperative staged publication before bind',async()=>{
 const q=await fixture(),hold=gate(),stage=q.a.hooks.stageEntry;let staging=false,once=true;q.a.hooks.stageEntry=async(...args)=>{if(once){once=false;staging=true;await hold.promise;}return stage(...args);};
 try{const first=await q.drag();q.up();for(let n=0;!staging;n++){assert(n<2000,JSON.stringify({job:{cancelled:first.cancelled,accepted:first.accepted,published:first.published},notes:q.c.frameOrdinaryNotes,errors:q.c.errors.map(String),operations:q.a.operations,packet:!!q.a.packet,publishing:q.a.publishing}));await tick();}assert(q.a.publishing);const b=await q.drag(false);assert.equal(q.c.frameOrdinaryNotes.starts,2);assert.equal(q.a.input,b);assert.equal(q.legacyActions(),0);hold.release();await b.display;await b.row.scheduler.whenIdle();q.up();await settle(q.a);assert.equal(q.mesh.geometry.attributes.position.getX(0),.25);assert.equal(q.c.undoStack.length,2);assert.equal(q.c.errors.length,0);}finally{hold.release();await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('real global Escape entry calls endGizDrag pointercancel and drains physical release',async()=>{
 const q=await fixture();try{await q.drag();q.up();await settle(q.a);const version=q.a.version,commands=q.c.undoStack.length,job=await q.drag();assert.equal(q.a.root.position(0)[0],.25);q.escape();assert.equal(q.c.gizDrag,null);assert.equal(q.a.input,null);q.up();await q.a.displayTail;await job.completion;await settle(q.a);assert(job.cancelled);assert(!job.accepted);assert.equal(q.a.version,version);assert.equal(q.c.undoStack.length,commands);assert.equal(q.mesh.geometry.attributes.position.getX(0),.125);assert.equal(q.a.root.rows.length,0);assert(q.capture.some(([op,id])=>op==='release'&&id===41));assert.equal(q.c.frameOrdinaryCancelledPointer,null);}finally{await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('Escape of second active Move preserves released first Move through actual entries',async()=>{
 const q=await fixture(),hold=gate(),send=q.a.request.bind(q.a);let computing=false,once=true;q.a.request=async(kind,data,t)=>{if(kind==='compute'&&once){once=false;computing=true;await hold.promise;}return send(kind,data,t);};
 try{const a=await q.drag();q.up();while(!computing)await tick();const b=await q.drag();q.escape();q.up();hold.release();await settle(q.a);assert(a.published);assert(b.cancelled&&!b.accepted);assert.equal(q.mesh.geometry.attributes.position.getX(0),.125);assert.equal(q.c.undoStack.length,1);assert.equal(q.a.root.rows.length,0);assert.equal(q.c.errors.length,0);}finally{hold.release();await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('Escape before drag threshold cleans deferred gizmo and physical release starts no command',async()=>{
 const q=await fixture();try{q.down();assert(q.c.gizDrag?._frameDeferredStart);assert.equal(q.a.input,null);q.escape();q.up();await tick();assert.equal(q.c.gizDrag,null);assert.equal(q.c.frameOrdinaryNotes.starts,0);assert.equal(q.c.undoStack.length,0);assert.equal(q.a.version,0);}finally{await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('frozen V5 entry witness defers ordinary overlap through legacy exact action',async()=>{
 const q=await fixture(),hold=gate(),send=q.a.request.bind(q.a);let computing=false,once=true;q.a.request=async(kind,data,t)=>{if(kind==='compute'&&once){once=false;computing=true;await hold.promise;}return send(kind,data,t);};
 try{await q.drag();q.up();while(!computing)await tick();vm.runInContext(fn('frameAffineGizmoVersionedAdmission',oldAST),q.c);q.down();assert.equal(q.legacyActions(),1);assert.equal(q.c.frameOrdinaryNotes.starts,1);assert.equal(q.a.input,null);q.c.frameAffineAuthoringPointer=null;hold.release();await settle(q.a);}finally{hold.release();await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('ordinary pre-admission preserves non-Move and modifier legacy routes',async()=>{
 const q=await fixture();try{for(const name of ['RX','SX','S','SR'])assert.equal(q.c.frameOrdinaryGizmoAdmission({object:{name}},{}),false);for(const key of ['ctrlKey','metaKey','shiftKey'])assert.equal(q.c.frameOrdinaryGizmoAdmission({object:{name:'P'}},{[key]:true}),false);}finally{await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
console.log(JSON.stringify({pass:true,cases:rows.length,rows,scope:'Actual generated pointer/key entries, defer/admission, gizmo callbacks, bridge/apply/finish; real actor/Node Stock workers/native display. Camera ray/hit and scene peripherals controlled; GPU emulated, no hardware claim.'}));
