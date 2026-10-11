import assert from 'node:assert/strict';
import vm from 'node:vm';
import {context,old,next,THREE,nextTopo,finish,geometry,setScene,empty,read,sha} from '../lifecycle/support.mjs';
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

const eventOf=(mode='replace')=>({clientX:1,clientY:2,shiftKey:mode==='add',ctrlKey:mode==='invert',metaKey:false});
for(const mode of ['replace','add','invert'])for(const keepReceipt of [true,false])await test(`valid doPick ${mode}, receipt=${keepReceipt}`,async()=>{
 const q=setup({hold:false});if(!keepReceipt)q.c.frameRememberNativeEdgeCM=()=>{q.c.frameNativeEdgeCM=null};q.c.frameNativeEdgeRequest=()=>Promise.resolve(q.hit());await q.c.doPick(eventOf(mode));q.clean();assert.equal(q.counts.installed,1);assert.equal(q.counts.gizmo.length,1);assert.equal(q.counts.pick.length,1);
});
for(const mode of ['replace','add','invert'])await test(`valid empty hit aliases ${mode}`,async()=>{
 const q=setup({hold:false});q.c.frameNativeEdgeRequest=()=>Promise.resolve(q.hit([]));await q.c.doPick(eventOf(mode));q.clean();assert.equal(q.counts.installed,1);assert.equal(q.counts.gizmo.length,1);assert.equal(q.counts.pick.length,1);if(mode==='replace'){assert.equal(q.c.polySelection.items.size,0);assert.equal(q.counts.gizmo[0],null)}
});
await test('valid invert removes last edges',async()=>{
 const q=setup({hold:false});q.c.polySelection.items.get(q.h).edges=new Set(['0:1','3:4']);q.c.frameNativeEdgeRequest=()=>Promise.resolve(q.hit());await q.c.doPick(eventOf('invert'));q.clean();assert.equal(q.c.polySelection.items.size,0);assert.equal(q.counts.installed,1);assert.equal(q.counts.gizmo.length,1);assert.equal(q.counts.gizmo[0],null);assert.equal(q.counts.pick.length,1);
});
for(const mode of ['replace','add','invert'])await test(`valid null hit ${mode}`,async()=>{
 const q=setup({hold:false});q.c.frameNativeEdgeRequest=()=>Promise.resolve(null);await q.c.doPick(eventOf(mode));q.clean();assert.equal(q.counts.installed,0);assert.equal(q.counts.gizmo.length,0);assert.equal(q.counts.pick.length,mode==='replace'?1:0);
});
for(const reason of ['other owner','not editable'])await test(`valid ${reason}`,async()=>{
 const q=setup({hold:false});if(reason==='other owner')q.c.selNodes.delete(q.h);else q.c.isVertexEditableMesh=()=>false;q.c.frameNativeEdgeRequest=()=>Promise.resolve(q.hit());await q.c.doPick(eventOf());q.clean();assert.equal(q.counts.installed,0);assert.equal(q.counts.pick.length,1);assert.equal(q.counts.gizmo.length,1);
});
for(const reason of ['object focus','soft','UV','unarmed'])await test(`valid doPick legacy ${reason}`,async()=>{
 const q=setup({hold:false});if(reason==='object focus')q.c.componentFocus='object';if(reason==='soft')q.c.vertexTools.soft.active=true;if(reason==='UV')q.c.uvEdit={};if(reason==='unarmed')q.c.componentModeArmed=false;vm.runInContext(['polySelEntry','applyLogicalEdgeSelection','frameDrainSelectionWork','rebuildPolySelection'].map(n=>next.get(n)).join('\n'),q.c);q.c.recalculateSoftSelection=()=>{};q.c.frameNativeEdgeRequest=()=>Promise.resolve(q.hit());await q.c.doPick(eventOf());q.clean();assert.equal(q.counts.installed,1);assert.equal(q.counts.pick.length,1);assert.equal(q.counts.gizmo.length,1);
});
const mutations={
 'camera pose':q=>q.cam.position.x++, 'camera projection':q=>q.cam.projectionMatrix.elements[0]++, 'viewport':q=>q.rect.w++, 'coordinate':q=>q.c.coordMode='world', 'pivot replacement':q=>q.c.polyPivotMatrix=new THREE.Matrix4().elements,
 'element mode':q=>q.c.polyElementMode='face', 'tool':q=>q.c.vertexTools.mode='loop', 'owner selection':q=>q.c.selNodes.clear(), 'owner geometry':q=>q.mesh.geometry=q.g.clone(), 'position version':q=>q.g.attributes.position.needsUpdate=true, 'index version':q=>q.g.index.needsUpdate=true,
 'normal attribute added':q=>q.g.setAttribute('normal',new THREE.BufferAttribute(new Float32Array(18),3)), 'draw range':q=>q.g.setDrawRange(0,3), 'material groups':q=>q.g.addGroup(0,3,0), 'owner visibility':q=>q.mesh.visible=false,
 'owner matrix':q=>{q.mesh.position.x++;q.mesh.updateMatrixWorld(true)}, 'new selection revision':q=>q.c.framePolySelectionRevision++, 'external selection':q=>q.c.frameNativeExternalSelection++, 'items map':q=>q.c.polySelection.items=new Map(q.c.polySelection.items), 'source owner replacement':q=>q.c.pickMeshes.set(q.h,q.mesh.clone()),
 'scene token':q=>q.c.sceneStateToken++, 'scene mutation':q=>q.c.sceneMutationSequence++, 'animation revision':q=>q.c.frameAnimationRevision++, 'timeline':q=>q.c.frameEvaluatedTime++, 'UV':q=>q.c.uvEdit={}, 'soft':q=>q.c.vertexTools.soft.active=true, 'object focus':q=>q.c.componentFocus='object', 'disarm':q=>q.c.componentModeArmed=false,
 'renderer lease':q=>q.c.vpState.renderer.bridge.lease.isCurrent=()=>false, 'renderer replacement':q=>q.c.vpState.renderer={...q.c.vpState.renderer}, 'topology stale':q=>q.ready.isCurrent=()=>false
};

const e={clientX:1,clientY:2,shiftKey:false,ctrlKey:false,metaKey:false};
for(const [name,mutate] of Object.entries(mutations).filter(([name])=>name!=='topology stale'))await test(`no receipt rejects post-publication ${name}`,async()=>{
 const q=setup();q.c.frameRememberNativeEdgeCM=()=>{q.c.frameNativeEdgeCM=null};q.c.frameNativeEdgeRequest=()=>Promise.resolve(q.hit());const job=q.c.doPick(e),rejected=assert.rejects(job,e=>e.name==='AbortError');await tick();const observer=q.c.framePolySelectionJob.promise.then(()=>mutate(q));q.pending.resolve(q.ready);await Promise.all([observer,rejected]);q.clean();assert.equal(q.counts.gizmo.length,0);assert.equal(q.counts.pick.length,0);
});
for(const stale of [false,true])await test(`actual count-bound exclusion, changed revision=${stale}`,async()=>{
 const q=setup(),triangleCount=83334,p=new Float32Array(triangleCount*9),keys=[];for(let i=0;i<triangleCount;i++){p.set([0,0,0,2,0,0,0,3,0],i*9);keys.push(`${i*3}:${i*3+1}`)}
 const g=geometry(p);q.mesh.geometry=g;const topology=finish(nextTopo.buildTopologyWork({positions:p},{packedTables:true})),stamp=nextTopo.topologyStamp(g),ready={topology,isCurrent:stamp.isCurrent};q.c.frameNativeEdgeRequest=()=>Promise.resolve(q.hit(keys));const job=q.c.doPick(e),done=stale?assert.rejects(job,e=>e.name==='AbortError'):job;await tick();const observer=q.c.framePolySelectionJob.promise.then(()=>{assert.equal(q.c.frameNativeEdgeCM,null);assert.equal(q.counts.last.measurements.selectedIDs.get(q.h).size,166668);if(stale)q.c.framePolySelectionRevision++});q.pending.resolve(ready);await Promise.all([observer,done]);q.clean();assert.equal(q.counts.gizmo.length,stale?0:1);assert.equal(q.counts.pick.length,stale?0:1);
});
await test('aborted resume releases queue and permits fresh click',async()=>{
 const q=setup();q.c.frameNativeEdgeRequest=x=>Promise.resolve(q.hit(x===1?['0:1','3:4']:['1:2','4:5']));const one=q.c.doPick(e),r1=assert.rejects(one,e=>e.name==='AbortError');await tick();let two;const observer=q.c.framePolySelectionJob.promise.then(()=>{q.c.coordMode='world';q.c.frameNativeExternalSelection++;two=q.c.doPick({...e,clientX:2})});q.pending.resolve(q.ready);await Promise.all([observer,r1]);await two;q.clean();assert.equal(q.counts.installed,2);assert.deepEqual(q.counts.pick,[q.h]);assert.equal(q.counts.gizmo.length,1);assert.deepEqual([...q.c.polySelection.items.get(q.h).edges],['1:2','4:5']);
});
const cases={
 'membership without revision':q=>{const s=q.c.polySelection.items.get(q.h).edges;s.delete('0:1');s.add('1:2')},
 'ordered edges without revision':q=>{const s=q.c.polySelection.items.get(q.h).edges;s.delete('0:1');s.add('0:1')},
 'entry replacement without revision':q=>q.c.polySelection.items.set(q.h,{...q.c.polySelection.items.get(q.h)}),
 'position layout without version':q=>q.g.attributes.position.itemSize=2,
 'position pose without matrix update':q=>q.mesh.position.x++,
};
const boundaries=[];
for(const [name,mutate] of Object.entries(cases))for(const keepReceipt of [true,false]){
 const q=setup();if(!keepReceipt)q.c.frameRememberNativeEdgeCM=()=>{q.c.frameNativeEdgeCM=null};q.c.frameNativeEdgeRequest=()=>Promise.resolve(q.hit());const job=q.c.doPick(eventOf()),outcome=job.then(()=>({state:'fulfilled'}),e=>({state:'rejected',errorName:e.name}));await tick();const observer=q.c.framePolySelectionJob.promise.then(()=>mutate(q));q.pending.resolve(q.ready);await observer;const result=await outcome;q.clean();boundaries.push({name,keepReceipt,...result,gizmo:q.counts.gizmo.length,pick:q.counts.pick.length,staleFrameUsed:q.counts.gizmo[0]===q.counts.last.measurements});
}

assert.equal(reports.length,52);
for(const result of boundaries){assert.equal(result.state,result.keepReceipt?'rejected':'fulfilled');assert.equal(result.gizmo,result.keepReceipt?0:1);assert.equal(result.pick,result.keepReceipt?0:1);if(result.keepReceipt)assert.equal(result.errorName,'AbortError');}
console.log(JSON.stringify({pass:true,sourceSHA256:sha(read('editor-candidate.mjs')),supportedStateCases:reports.length,reports,rawUnversionedBoundaries:boundaries,scope:'Actual frozen candidate preparation/doPick and guards; Node synthetic geometry, mocked UI/GPU callbacks. Raw mutations intentionally omit revision/version/matrix updates and are guard limits, not supported-state regressions. No browser or publication acceptance.'},null,2));
