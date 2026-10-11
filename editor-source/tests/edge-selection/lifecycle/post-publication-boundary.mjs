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
const q=setup();q.c.frameNativeEdgeRequest=()=>Promise.resolve(q.hit());
const job=q.c.doPick({clientX:1,clientY:2,shiftKey:false,ctrlKey:false,metaKey:false});const rejected=assert.rejects(job,e=>e.name==='AbortError');await tick();
const observer=q.c.framePolySelectionJob.promise.then(()=>{q.c.polySelection.items.get(q.h).edges=new Set(['1:2','4:5']);q.c.framePolySelectionRevision++;q.c.coordMode='world';q.c.frameNativeExternalSelection++;});
q.pending.resolve(q.ready);await Promise.all([observer,rejected]);
assert.equal(q.c.frameCurrentNativeEdgeCM(),null);
assert.equal(q.counts.gizmo.length,0);assert.equal(q.counts.pick.length,0);
console.log(JSON.stringify({scope:'Corrected exact original post-publication microtask interleaving, not natural browser reproduction',rejectedAbort:true,postContinuationGizmoCalls:q.counts.gizmo.length,stalePreparedFrameUsed:q.counts.gizmo[0]===q.counts.last.measurements,cacheReceiptCorrectlyInvalidated:q.c.frameCurrentNativeEdgeCM()===null,currentCoordinates:q.c.coordMode,selectedEdges:[...q.c.polySelection.items.get(q.h).edges],publishedOldEdges:['0:1','3:4']},null,2));
