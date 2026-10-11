import assert from 'node:assert/strict';
import vm from 'node:vm';
import {context,old,next,THREE,nextTopo,finish,geometry,setScene,empty,read,sha} from './support.mjs';
const reports=[];
const tick=()=>new Promise(r=>setImmediate(r));
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
function setup({hold=true}={}){
 const c=context(next),g=geometry(new Float64Array([0,0,0,2,0,0,0,3,0,0,0,0,2,0,0,0,3,0]),new Uint16Array([0,1,2,3,4,5]));
 setScene(c,g,{...empty(),edges:new Set(['0:2','3:5'])},[{rx:.1,ry:.2,rz:.4,sx:2,sy:.7,sz:-1}]);
 const h='synthetic-0',mesh=c.pickMeshes.get(h),cam=new THREE.PerspectiveCamera(45,1,.01,100);cam.position.z=10;cam.updateMatrixWorld();cam.updateProjectionMatrix();
 const rect={x:0,y:0,w:100,h:100};c.rectFor=()=>rect;c.viewAt=()=>0;c.viewShading=[0];c.effectiveVisible=h=>c.pickMeshes.get(h)?.visible??false;c.vpState={mode:'single',singleView:0,views:[{cam}],renderer:{ready:true,isFrameNativeViewportRenderer:true,bridge:{lease:{isCurrent:()=>true}}}};
 const listeners=new Map(),pending=defer(),counts={disposed:0,installed:0,recorded:0,legacy:0,gizmo:[],pick:[]},topology=finish(nextTopo.buildTopologyWork({positions:g.attributes.position.array,indices:g.index.array},{packedTables:true})),stamp=nextTopo.topologyStamp(g),ready={topology,isCurrent:stamp.isCurrent};
 c.frameNative={...nextTopo,createYieldQueue:()=>({yield:tick,dispose:()=>counts.disposed++})};c.frameGetNativeTopologyCache=()=>({get:()=>pending.promise});c.isVertexEditableMesh=x=>c.pickMeshes.has(x);c.addEventListener=(k,f)=>{if(!listeners.has(k))listeners.set(k,new Set());listeners.get(k).add(f)};c.removeEventListener=(k,f)=>listeners.get(k)?.delete(f);
 c.EDIT_HIT_PX=12;c.edgeBevelResult=null;c.frameConnectedSelectionComplete=null;c.polyExtrudedFaces=null;c.frameInstallPolySelectionBuffers=(buffers,sync,measurements)=>{counts.installed++;counts.last={buffers,measurements};};c.frameRecordNativeComponentClick=()=>counts.recorded++;
 c.frameCameraScreenHit=()=>null;c.vertexEditActive=false;c.isParametricSpline=()=>false;c.splineScreenHit=()=>null;c.componentObjectFallbackPick=()=>false;c.placeGizmoForSelection=m=>counts.gizmo.push(m);c._vpPick=h=>counts.pick.push(h);c.setGizmoVisible=()=>{};c.updateHUD=()=>{};c.scheduleRender=()=>{};c.frameNativePickerError=e=>{if(e.name!=='AbortError')throw e};c.frameNativeClickQueue=Promise.resolve();
 vm.runInContext(['frameSelectionSourceGuard','frameNativePickerDrawables','frameNativePickerSourceGuard','frameNativePickerGuard','frameApplyPreparedPolySelection','frameCancelPolySelectionWork','polyClickPick','doPick','frameNativeQueueClick'].map(n=>next.get(n)).join('\n'),c);
 const hit=(keys=['0:1','3:4'])=>({h,keys,isCurrent:c.frameNativePickerGuard(0,'click')});
 const start=(mode='replace',keys)=>c.framePrepareNativeEdgeClick(hit(keys),1,2,mode,0,{});
 const event=(type,e={})=>{for(const f of [...(listeners.get(type)??[])])f(e)};
 const clean=()=>{assert.equal(c.framePolySelectionJob,null);assert([...listeners.values()].every(x=>x.size===0))};
 if(!hold)pending.resolve(ready);
 return{c,g,h,mesh,cam,rect,listeners,pending,counts,ready,hit,start,event,clean};
}
async function test(name,fn){await fn();reports.push({name,pass:true})}
const mutations={
 'camera pose':q=>q.cam.position.x++, 'camera projection':q=>q.cam.projectionMatrix.elements[0]++, 'viewport':q=>q.rect.w++, 'coordinate':q=>q.c.coordMode='world', 'pivot replacement':q=>q.c.polyPivotMatrix=new THREE.Matrix4().elements,
 'element mode':q=>q.c.polyElementMode='face', 'tool':q=>q.c.vertexTools.mode='loop', 'owner selection':q=>q.c.selNodes.clear(), 'owner geometry':q=>q.mesh.geometry=q.g.clone(), 'position version':q=>q.g.attributes.position.needsUpdate=true, 'index version':q=>q.g.index.needsUpdate=true,
 'normal attribute added':q=>q.g.setAttribute('normal',new THREE.BufferAttribute(new Float32Array(18),3)), 'draw range':q=>q.g.setDrawRange(0,3), 'material groups':q=>q.g.addGroup(0,3,0), 'owner visibility':q=>q.mesh.visible=false,
 'owner matrix':q=>{q.mesh.position.x++;q.mesh.updateMatrixWorld(true)}, 'new selection revision':q=>q.c.framePolySelectionRevision++, 'external selection':q=>q.c.frameNativeExternalSelection++, 'items map':q=>q.c.polySelection.items=new Map(q.c.polySelection.items), 'source owner replacement':q=>q.c.pickMeshes.set(q.h,q.mesh.clone()),
 'scene token':q=>q.c.sceneStateToken++, 'scene mutation':q=>q.c.sceneMutationSequence++, 'animation revision':q=>q.c.frameAnimationRevision++, 'timeline':q=>q.c.frameEvaluatedTime++, 'UV':q=>q.c.uvEdit={}, 'soft':q=>q.c.vertexTools.soft.active=true, 'object focus':q=>q.c.componentFocus='object', 'disarm':q=>q.c.componentModeArmed=false,
 'renderer lease':q=>q.c.vpState.renderer.bridge.lease.isCurrent=()=>false, 'renderer replacement':q=>q.c.vpState.renderer={...q.c.vpState.renderer}, 'topology stale':q=>q.ready.isCurrent=()=>false
};

const cases=Object.entries(mutations).filter(([name])=>name!=='topology stale');
cases.push(['same-size edge mutation without revision',q=>{const s=q.c.polySelection.items.get(q.h).edges;s.delete('0:1');s.add('1:2')}]);
cases.push(['ordered edge mutation without revision',q=>{const s=q.c.polySelection.items.get(q.h).edges;s.delete('0:1');s.add('0:1')}]);
cases.push(['selection-entry replacement without revision',q=>q.c.polySelection.items.set(q.h,{...q.c.polySelection.items.get(q.h)})]);
for(const [name,mutate] of cases){const q=setup();q.c.frameNativeEdgeRequest=()=>Promise.resolve(q.hit());const job=q.c.doPick({clientX:1,clientY:2,shiftKey:false,ctrlKey:false,metaKey:false}),rejected=assert.rejects(job,e=>e.name==='AbortError');await tick();const observer=q.c.framePolySelectionJob.promise.then(()=>mutate(q));q.pending.resolve(q.ready);await Promise.all([observer,rejected]);q.clean();assert.equal(q.counts.installed,1);assert.equal(q.counts.gizmo.length,0);assert.equal(q.counts.pick.length,0);reports.push({name,pass:true});}
for(const mutate of [false,true]){const q=setup();q.c.frameRememberNativeEdgeCM=()=>{q.c.frameNativeEdgeCM=null};q.c.frameNativeEdgeRequest=()=>Promise.resolve(q.hit());const job=q.c.doPick({clientX:1,clientY:2,shiftKey:false,ctrlKey:false,metaKey:false});const done=mutate?assert.rejects(job,e=>e.name==='AbortError'):job;await tick();const observer=q.c.framePolySelectionJob.promise.then(()=>{if(mutate)q.c.coordMode='world'});q.pending.resolve(q.ready);await Promise.all([observer,done]);q.clean();assert.equal(q.counts.gizmo.length,mutate?0:1);assert.equal(q.counts.pick.length,mutate?0:1);reports.push({name:mutate?'missing bounded receipt still rejects changed context':'missing bounded receipt permits valid prepared scalar resume',pass:true});}
console.log(JSON.stringify({pass:true,sourceSHA256:sha(read('editor-candidate.mjs')),cases:reports.length,reports,scope:'Actual private selection publication followed by actual job Promise observers, actual source/picker guards; synthetic source changes and mocked UI callbacks only'},null,2));
