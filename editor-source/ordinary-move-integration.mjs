// Inserted into the frozen editor module by ordinary-move-build.mjs. All
// topology/Stock/wire/BVH/overlay array production belongs to workers.
var frameOrdinaryOwners=new Map(),frameOrdinaryPrepared=null,frameOrdinaryInput=null,frameOrdinaryInstalling=false,frameOrdinaryCM=null,frameOrdinaryHistory=Promise.resolve(),frameOrdinarySavingBoundary=null;
var frameOrdinaryNotes={starts:0,moves:0,ends:0,published:0,errors:[]};
var frameOrdinaryEpochs=new WeakMap();
var frameOrdinarySceneEpoch=0,frameOrdinaryRetiring=new WeakMap();
var frameOrdinaryCancelledPointer=null;
var frameOrdinaryHoverState={active:null,latest:null};
function frameOrdinaryRetirePrepared(){const q=frameOrdinaryPrepared;frameOrdinaryPrepared=null;if(q){q.cancel?.();Promise.resolve(q.readPromise||q.promise).then(packet=>q.r.actor.releaseRead(packet)).catch(()=>{});}}
function frameOrdinaryAbortable(promise,signal){
 if(signal.aborted){Promise.resolve(promise).catch(()=>{});return Promise.reject(new DOMException('Connected selection cancelled','AbortError'));}
 return new Promise((resolve,reject)=>{const cleanup=()=>signal.removeEventListener('abort',cancel),cancel=()=>{cleanup();reject(new DOMException('Connected selection cancelled','AbortError'));};signal.addEventListener('abort',cancel,{once:true});Promise.resolve(promise).then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});});
}
function frameCommitPreparedPolySelectionState(result){
  frameConnectedSelectionComplete=null;
  if(edgeBevelResult){edgeBevelResult=null;lastAttrKey=null;refreshAttributesPanel();}
  polyPivotMatrix=null;
  if(result.connected){polyExactEdgeVertices=null;polyExtrudedFaces=null;}
  polySelection.items.clear();for(const [h,s] of result.items)polySelection.items.set(h,s);
  framePolySelectionRevision++;if(!frameNativeClickCommit)frameNativeExternalSelection++;
}
function frameOrdinaryCaptureSource(g){
 const attribute=a=>a&&[a,a.array,a.version,a.count,a.itemSize,a.normalized,a.isInterleavedBufferAttribute,a.data,a.offset,a.data?.stride];
 return {geometry:g,position:attribute(g.attributes.position),normal:attribute(g.attributes.normal),index:attribute(g.index),epoch:frameOrdinaryEpochs.get(g)||0,rigidEpoch:frameRigidEpoch.get(g)||0};
}
function frameOrdinarySourceCurrent(s){
 const g=s.geometry;if((frameOrdinaryEpochs.get(g)||0)!==s.epoch||(frameRigidEpoch.get(g)||0)!==s.rigidEpoch)return false;
 const attribute=a=>a&&[a,a.array,a.version,a.count,a.itemSize,a.normalized,a.isInterleavedBufferAttribute,a.data,a.offset,a.data?.stride];
 return [[g.attributes.position,s.position],[g.attributes.normal,s.normal],[g.index,s.index]].every(([a,stamp])=>!!a&&attribute(a).every((v,i)=>Object.is(v,stamp[i])));
}
function frameOrdinaryMutation(g){if(!g)return;frameOrdinaryEpochs.set(g,(frameOrdinaryEpochs.get(g)||0)+1);}
function frameOrdinaryRetireOwner(h){const r=frameOrdinaryOwners.get(h);if(!r)return null;frameOrdinaryOwners.delete(h);if(frameOrdinaryPrepared?.r===r)frameOrdinaryRetirePrepared();const retirement=Promise.resolve(r.actor.dispose());frameOrdinaryRetiring.set(r.mesh,retirement);retirement.finally(()=>{if(frameOrdinaryRetiring.get(r.mesh)===retirement)frameOrdinaryRetiring.delete(r.mesh);}).catch(()=>{});return retirement;}
function frameOrdinaryDeleteMap(map,h){const r=frameOrdinaryOwners.get(h);if(r&&(map===pickMeshes&&map.get(h)===r.mesh||map===OBJ&&map.get(h)===r.node))frameOrdinaryRetireOwner(h);return map.delete(h);}
function frameOrdinarySetMap(map,h,value){const r=frameOrdinaryOwners.get(h);if(r&&(map===pickMeshes&&(value!==r.mesh||!r.current())||map===OBJ&&(value!==r.node||!r.current())))frameOrdinaryRetireOwner(h);return map.set(h,value);}
function frameOrdinaryClearMap(map){if(map===pickMeshes||map===OBJ)for(const h of [...frameOrdinaryOwners.keys()])frameOrdinaryRetireOwner(h);return map.clear();}
function frameOrdinaryClearOwners(){frameOrdinarySceneEpoch++;for(const h of [...frameOrdinaryOwners.keys()])frameOrdinaryRetireOwner(h);for(const stack of [undoStack||[],redoStack||[]])for(let i=stack.length-1;i>=0;i--)if(stack[i].ordinaryMove)stack.splice(i,1)[0].dispose();frameOrdinaryRetirePrepared();frameOrdinaryInput=frameOrdinaryCM=frameOrdinarySavingBoundary=null;}
function frameOrdinaryRestoreHistoryOwners(hashes,epoch){if(epoch!==frameOrdinarySceneEpoch)return;const wanted=new Set(hashes);for(const c of [...undoStack,...redoStack]){const q=c.ordinaryMove;if(q&&q.sceneEpoch===epoch&&wanted.has(q.h)&&pickMeshes.get(q.h)===q.mesh)q.node=OBJ.get(q.h);}}
function frameOrdinaryHistoryEntry(owner,job){return{renderOnly:true,ordinaryMove:{...owner,job},undo(){},redo(){},dispose(){job.checkpoints=null;}};}
function frameOrdinaryBeforeExternalEdit(hashes=null){
 const wanted=hashes?new Set(hashes):null,targets=[...frameOrdinaryOwners.values()].filter(r=>(!wanted||wanted.has(r.h))&&r.current());
 for(const r of targets){
  if(r.actor.input||r.actor.operations||r.actor.packet||r.actor.root?.rows.length)throw new DOMException('Wait for the released Move to become exact before editing its geometry','InvalidStateError');
 }
 for(const r of targets){frameOrdinaryMutation(r.geometry);frameOrdinaryRetireOwner(r.h);}
}
function frameOrdinaryExactPending(hashes=null){const wanted=hashes?new Set(hashes):null;return [...frameOrdinaryOwners.values()].some(r=>(!wanted||wanted.has(r.h))&&r.current()&&(r.actor.input||r.actor.operations||r.actor.packet||r.actor.historyBusy||r.actor.root?.rows.length||r.actor.root?.transition));}
function frameOrdinaryAssertExact(hashes=null){if(frameOrdinaryExactPending(hashes))throw new DOMException('This action requires the released Move exact revision','InvalidStateError');}
async function frameOrdinaryContinueExact(continuation,hashes=null){
 const wanted=hashes?new Set(hashes):null,owners=[...frameOrdinaryOwners.values()].filter(r=>(!wanted||wanted.has(r.h))&&r.current());
 if(owners.some(r=>r.actor.input))throw new DOMException('Release the ordinary Move before this action','InvalidStateError');
 await Promise.all(owners.map(r=>r.actor.exact));await frameOrdinaryHistory;
 for(const r of owners){if(!r.current())throw new DOMException('Move exact owner changed','AbortError');await r.actor.displayTail;await r.actor.publicationDone?.promise;if(r.actor.packet&&!await r.actor.tryPublish({force:true}))throw new DOMException('Move exact publication was superseded','AbortError');}
 frameOrdinaryAssertExact(hashes);return continuation();
}
function frameOrdinaryCommandTargets(cmd){return cmd?.geometryTargets??null;}
function frameOrdinaryHistoryGuard(){if([...frameOrdinaryOwners.values()].some(r=>r.actor.historyBusy))throw new DOMException('Wait for Move history publication before another history command','InvalidStateError');}
function frameOrdinaryAfterExternalCommand(cmd){frameOrdinaryHistoryGuard();if(!cmd||cmd.renderOnly)return;const targets=frameOrdinaryCommandTargets(cmd);if(targets)for(const h of targets){const r=frameOrdinaryOwners.get(h);if(r){if(r.current())frameOrdinaryMutation(r.geometry);frameOrdinaryRetireOwner(h);}}}
function frameOrdinaryAssertGeometryExact(g){for(const r of frameOrdinaryOwners.values())if(r.geometry===g&&r.current())frameOrdinaryAssertExact([r.h]);}
function frameOrdinaryCanonicalSaveSnapshot(g){for(const r of frameOrdinaryOwners.values())if(r.geometry===g&&r.current()&&g.index.array instanceof Uint32Array&&Object.keys(g.attributes).every(k=>k==='position'||k==='normal')){frameOrdinaryAssertExact([r.h]);const q={positions:g.attributes.position.array,normals:g.attributes.normal.array,indices:g.index.array},origin=frameContourOrigins.get(g);if(origin)q.contourOrigin=origin;return q;}return null;}
async function frameOrdinaryWaitForSave(signal){
 for(;;){
  if(signal?.aborted)throw signal.reason||new DOMException('Save cancelled','AbortError');
  const owners=[...frameOrdinaryOwners.values()].filter(r=>r.current()||r.actor.closed&&pickMeshes.get(r.h)===r.mesh&&r.mesh.geometry===r.geometry&&frameOrdinarySourceCurrent(r.source));
  if(owners.some(r=>r.actor.closed))throw new DOMException('Move worker failed before Save exact boundary','AbortError');
  if(owners.some(r=>r.actor.input))throw new DOMException('Release Move before Save','InvalidStateError');
  await nativeSaveWait(Promise.all(owners.map(r=>r.actor.exact)),signal);await nativeSaveWait(frameOrdinaryHistory,signal);
  for(const r of owners){if(!r.current())throw new DOMException('Move Save owner changed','AbortError');await nativeSaveWait(r.actor.displayTail,signal);await nativeSaveWait(r.actor.publicationDone?.promise,signal);}
  if(owners.some(r=>r.actor.operations||r.actor.input))continue;
  for(const r of owners){if(!r.current())throw new DOMException('Move Save owner changed','AbortError');if(r.actor.packet&&!await nativeSaveWait(r.actor.tryPublish({force:true}),signal))throw new DOMException('Move Save publication failed','AbortError');}
  if(frameOrdinaryExactPending())continue;
  frameOrdinarySavingBoundary=owners.map(r=>({r,source:r.source,version:r.actor.version,renderVersion:r.actor.renderVersion}));return;
 }
}
function frameOrdinarySaveCheck(){frameOrdinaryAssertExact();if(nativeSceneSave?.capturing&&frameOrdinarySavingBoundary?.some(q=>!q.r.current()||q.r.source!==q.source||q.r.actor.version!==q.version||q.r.actor.renderVersion!==q.renderVersion))throw new DOMException('Move Save revision changed','AbortError');}
function frameOrdinarySupported(){
 if(!polyFocusActive()||splineFocusActive()||uvMode||uvEdit||editPivot||vertexTools.soft.active||polyExactEdgeVertices||polySelection.items.size!==1||!['vertex','edge','face'].includes(polyElementMode))return false;
 const [h,s]=polySelection.items.entries().next().value,m=pickMeshes.get(h),g=m?.geometry;
 return !!m&&selNodes.has(h)&&!!(s.vertices.size+s.edges.size+s.faces.size)&&!frameMorphTag(h)&&polygonShadingAllowed(m)&&Object.keys(g.attributes).every(k=>k==='position'||k==='normal')&&g.attributes.position.array instanceof Float32Array&&g.attributes.normal?.array instanceof Float32Array&&(g.index?.array instanceof Uint16Array||g.index?.array instanceof Uint32Array)&&!!frameRigidOwnerSnapshot().pool;
}
// Read-only vertex queries do not require an existing Move selection.
function frameOrdinaryPickerTarget(){
 if(!polyMode||splineFocusActive()||uvMode||uvEdit||editPivot||vertexTools.soft.active||polyExactEdgeVertices||selNodes.size!==1||!['vertex','edge','face'].includes(polyElementMode))return null;
 const h=selNodes.values().next().value,m=pickMeshes.get(h),g=m?.geometry;
 return m&&isVertexEditableMesh(h)&&effectiveVisible(h)&&!frameMorphTag(h)&&polygonShadingAllowed(m)&&Object.keys(g.attributes).every(k=>k==='position'||k==='normal')&&g.attributes.position.array instanceof Float32Array&&g.attributes.normal?.array instanceof Float32Array&&(g.index?.array instanceof Uint16Array||g.index?.array instanceof Uint32Array)&&frameRigidOwnerSnapshot().pool?h:null;
}
var frameOrdinaryModifierKeys=new Set(),frameOrdinaryModifierRevision=0,frameOrdinaryPointerRevision=0;
var frameOrdinarySnapState={active:null,latest:null};
function frameOrdinaryModifierHeld(){return [...frameOrdinaryModifierKeys].some(k=>k.startsWith('Control')||k.startsWith('Meta'));}
function frameOrdinaryModifierKey(e,down){
 if(e.key!=='Control'&&e.key!=='Meta')return;
 const before=frameOrdinaryModifierHeld(),key=e.code||e.key;
 if(down)frameOrdinaryModifierKeys.add(key);else{frameOrdinaryModifierKeys.delete(key);frameOrdinaryModifierKeys.delete(e.key+'Pointer');}
 if(before!==frameOrdinaryModifierHeld())frameOrdinaryModifierRevision++;
}
function frameOrdinaryModifierPointer(e){
 frameOrdinaryPointerRevision++;
 const before=frameOrdinaryModifierHeld();
 for(const [name,held]of [['Control',!!e.ctrlKey],['Meta',!!e.metaKey]]){
  const keys=[...frameOrdinaryModifierKeys].filter(k=>k.startsWith(name));
  if(!held)for(const key of keys)frameOrdinaryModifierKeys.delete(key);else if(!keys.length)frameOrdinaryModifierKeys.add(name+'Pointer');
 }
 if(before!==frameOrdinaryModifierHeld())frameOrdinaryModifierRevision++;
}
function frameOrdinaryClearModifierPreview(){if(frameOrdinaryModifierKeys.size){frameOrdinaryModifierKeys.clear();frameOrdinaryModifierRevision++;}}
if(typeof addEventListener==='function')addEventListener('blur',frameOrdinaryClearModifierPreview);
function frameOrdinarySnapGuard(vi,kind){
 const guard=frameNativePickerGuard(vi,kind),mode=vertexTools.mode,domain=polyElementMode,selectionRevision=framePolySelectionRevision,pointerRevision=frameOrdinaryPointerRevision,revision=frameOrdinaryModifierRevision,temporary=kind==='hover'&&!mode&&frameOrdinaryModifierHeld();
 return()=>guard()&&vertexTools.mode===mode&&polyElementMode===domain&&framePolySelectionRevision===selectionRevision&&(kind!=='hover'||frameOrdinaryPointerRevision===pointerRevision)&&(!temporary||frameOrdinaryModifierHeld()&&revision===frameOrdinaryModifierRevision);
}
function frameOrdinaryCancelSnapLatest(){const s=frameOrdinarySnapState;if(s.latest){s.latest.reject(new DOMException('Superseded snap pointer','AbortError'));s.latest=null;}if(s.active)s.active.superseded=true;}
async function frameOrdinaryCancelHoverReads(){
 frameNativeHoverIntent++;frameOrdinaryHoverState.latest=null;frameOrdinaryCancelSnapLatest();
 await Promise.allSettled([frameOrdinaryHoverState.active?.promise,frameOrdinarySnapState.active?.running].filter(Boolean));
}
async function frameOrdinaryRunSnap(row){
 if(!row.current())throw new DOMException('Snap context changed','AbortError');
 const r=rectFor(row.vi),cam=vpState.views[row.vi].cam;
 const vertex=await frameOrdinaryVertexPick(row.cx,row.cy,row.vi,r,cam,row.current,{hover:true,radius:10});
 try{if(!row.current()||!vertex.handled||!vertex.isCurrent())throw new DOMException('Snap vertex context changed','AbortError');return await resolveVertexToolSnap(row.cx,row.cy,row.vi,row.allowFace,{snapVertexPrepared:true,snapVertexHit:vertex.hit,snapCurrent:row.current},row.kind);}finally{vertex.release();}
}
function frameOrdinaryDrainSnap(){
 const s=frameOrdinarySnapState;if(s.active||!s.latest)return;const row=s.latest;s.latest=null;s.active=row;
 row.running=frameOrdinaryRunSnap(row);row.running.then(row.resolve,row.reject).finally(()=>{if(s.active===row)s.active=null;frameOrdinaryDrainSnap();});
}
function frameOrdinaryToolSnap(cx,cy,vi,allowFace,kind){
 if(!vpState.renderer?.isFrameNativeViewportRenderer||!frameOrdinaryPickerTarget())return null;
 if(kind==='hover'){frameNativeHoverIntent++;frameOrdinaryHoverState.latest=null;}
 const guard=frameOrdinarySnapGuard(vi,kind),row={cx,cy,vi,allowFace,kind,superseded:false};row.current=()=>!row.superseded&&guard();
 if(kind==='click')return frameOrdinaryCancelHoverReads().then(()=>frameOrdinaryRunSnap(row));
 const promise=new Promise((resolve,reject)=>Object.assign(row,{resolve,reject}));frameOrdinaryCancelSnapLatest();frameOrdinarySnapState.latest=row;frameOrdinaryDrainSnap();return promise;
}

function frameOrdinaryGizmoAdmission(g,e){return !e?.ctrlKey&&!e?.metaKey&&!e?.shiftKey&&['P','X','Y','Z','XY','XZ','YZ'].includes(g?.object?.name)&&frameOrdinarySupported();}
function frameOrdinaryNewPointer(e){if(frameOrdinaryCancelledPointer?.pointerId===e.pointerId)frameOrdinaryCancelledPointer=null;}
function frameOrdinaryDrainPointer(e,end=false){if(!frameOrdinaryCancelledPointer||frameOrdinaryCancelledPointer.pointerId!==e.pointerId)return false;if(end)frameOrdinaryCancelledPointer=null;e.preventDefault();return true;}
function frameOrdinaryEscape(e){
 if(e.key!=='Escape'||!gizDrag||!frameOrdinaryInput&&!frameOrdinaryGizmoAdmission({object:{name:'P'}},gizDrag._frameDeferredStart||{}))return false;
 const pointerId=frameOrdinaryInput?.pointerId??gizDrag._frameDeferredStart?.pointerId??gizDrag._frameAuthoringPointerId;
 e.preventDefault();endGizDrag({type:'pointercancel',pointerId});activeView=-1;
 if(pointerId!==undefined)frameOrdinaryCancelledPointer={pointerId};return true;
}
function frameOrdinaryStamp(){return {entry:polySelection.items.values().next().value,revision:framePolySelectionRevision,domain:polyElementMode,space:coordMode,pivot:polyPivotMatrix,render:frameOrdinaryOwners.get(polySelection.items.keys().next().value)?.actor.renderVersion};}
function frameOrdinaryStampCurrent(t){return frameOrdinarySupported()&&t.entry===polySelection.items.values().next().value&&t.revision===framePolySelectionRevision&&t.domain===polyElementMode&&t.space===coordMode&&t.pivot===polyPivotMatrix;}
function frameOrdinaryActorStamp(r){return {h:r.h,entry:polySelection.items.get(r.h),revision:framePolySelectionRevision,domain:polyElementMode,space:coordMode,pivot:polyPivotMatrix};}
function frameOrdinaryActorPresentationCurrent(r,s){return r.sceneEpoch===frameOrdinarySceneEpoch&&pickMeshes.get(r.h)===r.mesh&&r.mesh.geometry===r.geometry&&s.h===r.h&&frameOrdinarySupported()&&polySelection.items.size===1&&polySelection.items.has(r.h)&&s.entry===polySelection.items.get(r.h)&&s.revision===framePolySelectionRevision&&s.domain===polyElementMode&&s.space===coordMode&&s.pivot===polyPivotMatrix;}
async function frameOrdinaryStageEntry(r,packet,current){const entry={vertices:new Set(),edges:new Set(),faces:new Set()};let count=0;for(const key of Object.keys(entry)){const values=packet.selection[key]||[],packed=key==='edges'&&values instanceof Uint32Array;for(let at=0;at<values.length;at+=packed?2:1){entry[key].add(packed?`${values[at]}:${values[at+1]}`:values[at]);if((++count&2047)===0){await r.actor.tasks.yield();if(!current())throw new DOMException('Owned selection changed','AbortError');}}}packet.entry=entry;}
function frameOrdinaryContext(h){const m=pickMeshes.get(h);m.updateMatrixWorld(true);return {domain:polyElementMode,space:coordMode,pivot:polyPivotMatrix?.slice()??null,world:m.matrixWorld.toArray(),inverse:m.matrixWorld.clone().invert().toArray(),ownerFrame:pureWorldFrame(h).toArray(),identity:new THREE2.Matrix4().toArray()};}
async function frameOrdinaryCopySelection(s){const out={vertices:[],edges:[],faces:[]};let count=0;for(const name of Object.keys(out))for(const id of s?.[name]||[]){out[name].push(id);if((++count&2047)===0)await frameAffineYield();}return out;}
function frameOrdinaryMeasurements(raw){return raw?{bounds:{min:new THREE2.Vector3().fromArray(raw.bounds.min),max:new THREE2.Vector3().fromArray(raw.bounds.max)},frame:new THREE2.Matrix4().fromArray(raw.frame),extent:new THREE2.Vector3().fromArray(raw.extent)}:null;}
function frameOrdinaryCurrentMeasurements(){const q=frameOrdinaryCM;return q&&frameOrdinaryStampCurrent(q.stamp)?q.measurements:null;}
function frameOrdinaryAwaitMeasurements(value){if(value||frameOrdinaryCurrentMeasurements()||frameOrdinaryInstalling||!frameOrdinarySupported())return false;const q=frameOrdinaryPrepare();return !!q&&!q.presented;}
async function frameOrdinaryVertexPick(cx,cy,vi,rect,cam,current,{hover=false,radius=EDIT_HIT_PX}={}){
 const h=frameOrdinaryPickerTarget();if(!h)return{handled:false,release(){}};
 if(!hover){await frameOrdinaryCancelHoverReads();if(!current())throw new DOMException('Vertex click context changed','AbortError');}
 const r=frameOrdinaryOwner(h),a=r.actor;await a.ready;if(!hover)a.sequence++;const sequence=a.sequence;await a.publicationDone?.promise;
 const selectionRevision=framePolySelectionRevision,valid=()=>r.current()&&current()&&a.sequence===sequence&&framePolySelectionRevision===selectionRevision,check=()=>{if(!valid())throw new DOMException('Vertex click context changed','AbortError');};
 check();if(!hover)a.selectionOperations=(a.selectionOperations||0)+1;let released=false,pickToken;
 const release=()=>{if(released)return;released=true;if(!hover){a.selectionOperations--;a.tryPublish();}};
 try{
  cam.updateMatrixWorld(true);cam.updateProjectionMatrix();const context={world:r.mesh.matrixWorld.toArray(),view:cam.matrixWorldInverse.toArray(),projection:cam.projectionMatrix.toArray(),rect:{x:rect.x,y:rect.y,w:rect.w,h:rect.h},cx,cy,radius};
  let page=await a.request('vertex-pick-start',{renderVersion:a.renderVersion,context});pickToken=page.pickToken;check();let hit=null,probes=0;const through=selectionThroughShading(vi),world=new THREE2.Vector3(),ndc=new THREE2.Vector3();
  for(let start=0;start<page.total&&!hit;){
   const values=page.candidates;for(let at=0;at<values.length;at+=8){check();world.set(values[at+3],values[at+4],values[at+5]);ndc.set(values[at+6],values[at+7],values[at+2]);
    if(through||exactVertexVisible(world,ndc,cam)){hit={mesh:r.mesh,h,vi:values[at],vertices:[],d:values[at+1],depth:values[at+2],world:world.clone(),screen:[cx,cy]};break;}
    if((++probes&7)===0){await a.tasks.yield();check();}
   }
   start+=values.length/8;if(start<page.total&&!hit)page=await a.request('vertex-pick-next',{pickToken,renderVersion:a.renderVersion,start});
  }
  if(hit&&!hover){let start=0,total=Infinity;while(start<total){const chunk=await a.request('vertex-pick-group',{pickToken,renderVersion:a.renderVersion,representative:hit.vi,start});check();total=chunk.total;for(let at=0;at<chunk.vertices.length;at++){hit.vertices.push(chunk.vertices[at]);if((at&2047)===2047){await a.tasks.yield();check();}}start+=chunk.vertices.length;} }
  const counter=hover?'vertexHoverPicks':'vertexPicks';frameOrdinaryNotes[counter]=(frameOrdinaryNotes[counter]||0)+1;return{handled:true,hit,isCurrent:valid,release};
 }catch(e){release();throw e;}finally{if(pickToken!==undefined&&a.current())await a.request('vertex-pick-cancel',{pickToken}).catch(()=>{});}
}
function frameOrdinaryDrainHover(){
 const state=frameOrdinaryHoverState;if(state.active||!state.latest)return;const row=state.latest;state.latest=null;
 if(row.intent!==frameNativeHoverIntent||!row.current())return;state.active=row;
 row.promise=frameOrdinaryVertexPick(row.cx,row.cy,row.vi,row.rect,row.cam,()=>row.intent===frameNativeHoverIntent&&row.current(),{hover:true}).then(result=>{try{if(result.handled&&result.isCurrent()){updatePolyHover(row.cx,row.cy,{intent:row.intent,vertexPrepared:true,vertexHit:result.hit});scheduleRender();}}finally{result.release();}}).catch(e=>{if(e.name!=='AbortError')frameNativePickerError(e);}).finally(()=>{if(state.active===row)state.active=null;frameOrdinaryDrainHover();});
}
function frameOrdinaryHover(cx,cy,preparedNative){
 if(preparedNative||!frameOrdinaryPickerTarget()||polyElementMode!=='vertex'||vertexTools.mode||!vpState.renderer?.isFrameNativeViewportRenderer)return false;
 const vi=viewAt(cx,cy),rect=rectFor(vi);if(vi<0||!rect)return false;
 const cam=vpState.views[vi].cam,intent=++frameNativeHoverIntent,current=frameNativePickerGuard(vi,'hover');
 clearPolyHover(true);frameOrdinaryHoverState.latest={cx,cy,vi,rect,cam,intent,current};frameOrdinaryDrainHover();return true;
}
function frameOrdinaryRollbackJobs(r,jobs){
 let restored=false;for(const job of jobs.toReversed()){const s=job.uiSession;if(!s||!frameOrdinaryActorPresentationCurrent(r,{...s.presentationStamp,pivot:job.context.afterPivot??s.presentationStamp.pivot}))continue;polyPivotMatrix=s.presentationStamp.pivot;frameRigidRestoreOverlays({overlays:s.overlays});frameOrdinaryCM={stamp:frameOrdinaryStamp(),measurements:s.measurements};restored=true;}
 if(frameOrdinaryInput?.r===r&&frameOrdinaryInput.job.cancelled)frameOrdinaryInput.blocked=true;
 if(restored){frameOrdinaryRetirePrepared();if(!r.actor.closed)frameOrdinaryPrepare();placeGizmoForSelection(frameOrdinaryCurrentMeasurements());updateHUD(readPolyTransform(coordMode,frameOrdinaryCurrentMeasurements()));}
 if(r.actor.initialDerived&&pickMeshes.get(r.h)===r.mesh&&r.mesh.geometry===r.geometry)frameOrdinarySeed(r.geometry,r.actor.initialDerived);
}
function frameOrdinarySeed(g,derived){
 frameBindSTLWireIndices(g,derived.wire);frameBindSTLPickTree(g,derived.bvh);
 g.boundingBox=new THREE2.Box3(new THREE2.Vector3().fromArray(derived.bounds.min),new THREE2.Vector3().fromArray(derived.bounds.max));
 g.boundingSphere=new THREE2.Sphere(new THREE2.Vector3().fromArray(derived.sphere.center),derived.sphere.radius);
}
function frameOrdinaryGeometry(raw,derived){const g=new THREE2.BufferGeometry();g.userData={...raw.userData};g.groups=raw.groups.map(q=>({...q}));g.setDrawRange(raw.drawRange.start,raw.drawRange.count);g.setAttribute('position',new THREE2.BufferAttribute(raw.positions,3));g.setAttribute('normal',new THREE2.BufferAttribute(raw.normals,3));g.setIndex(new THREE2.BufferAttribute(raw.indices,1));frameOrdinarySeed(g,derived);markPolygonCreaseGeometry(g);return g;}
async function frameOrdinaryStageSelection(r,packet,current){
 const resources=[];try{for(const [key,data] of Object.entries(packet.overlayNumeric)){for(const field of ['positions','extras','indices'])resources.push(await r.actor.pool.borrowAsync(data[field],136,'Move selection display',{minBytes:field==='indices'?8:4,isCurrent:current,yieldTask:()=>r.actor.tasks.yield()}));if(key==='fp')resources.push(await r.actor.pool.borrowAsync(data.indices,16,'Move selection triangle indices',{isCurrent:current,yieldTask:()=>r.actor.tasks.yield()}));}
 await frameOrdinaryStageEntry(r,packet,current);
 if(!current())throw new DOMException('Selection display changed','AbortError');packet.uploads=resources;return packet;}catch(e){for(const row of resources)r.actor.pool.release(row);throw e;}
}
function frameOrdinaryInstallSelection(r,packet,sync=true,retirePrevious=true){
 const previous=r.overlayUploads;r.overlayUploads=packet.uploads||[];
 for(const [key,o]of [['fp',polySelection.face],['ep',polySelection.edge],['vp',polySelection.vertex]]){
  const numeric=packet.overlayNumeric[key],g=o.geometry;
  g.setAttribute('position',new THREE2.BufferAttribute(numeric.positions,3));g.setIndex(new THREE2.BufferAttribute(numeric.indices,1));
  const attrs=[g.attributes.position,g.attributes.normal,g.attributes.uv,g.attributes.color,g.index];
  const row={...numeric,source:g,stamps:attrs.map(frameNative.stampAttribute),lineIndices:new Map(key==='fp'?[]:[[`${key==='ep'?'segments':'points'}:0:${numeric.vertexCount}`,numeric.indices]])};row.isCurrent=()=>[g.attributes.position,g.attributes.normal,g.attributes.uv,g.attributes.color,g.index].every((a,i)=>frameNative.attributeCurrent(a,row.stamps[i]));r.engine.geometryCache.rows.set(g,row);
  o.matrix.identity();o.matrixAutoUpdate=false;o.matrixWorldNeedsUpdate=true;o.visible=polyMode&&numeric.vertexCount>0;
 }
 polySelection.faceBack.visible=polySelection.face.visible;polySelection.faceBack.matrix.identity();polySelection.faceBack.matrixAutoUpdate=false;polySelection.faceBack.matrixWorldNeedsUpdate=true;
 if(retirePrevious)for(const row of previous||[])r.actor.pool.release(row);
 const measurements=frameOrdinaryMeasurements(packet.measurements);frameOrdinaryCM={stamp:frameOrdinaryStamp(),measurements};
 if(sync){setGizmoVisible(polySelection.items.size>0);placeGizmoForSelection(measurements);updateHUD(measurements?readPolyTransform(coordMode,measurements):null);}scheduleRender();
}
function frameOrdinaryOwner(h){
 let r=frameOrdinaryOwners.get(h),retirement;if(r&&!r.current()){retirement=frameOrdinaryRetireOwner(h);r=null;}
 if(r)return r;
 const m=pickMeshes.get(h),node=OBJ.get(h),owner=frameRigidOwnerSnapshot();m.updateMatrixWorld(true);
 retirement??=frameOrdinaryRetiring.get(m);r={h,mesh:m,node,sceneEpoch:frameOrdinarySceneEpoch,geometry:m.geometry,source:frameOrdinaryCaptureSource(m.geometry),world:m.matrixWorld.toArray(),engine:owner.engine,owner};
 r.current=()=>r.sceneEpoch===frameOrdinarySceneEpoch&&!r.actor?.closed&&pickMeshes.get(h)===m&&OBJ.get(h)===node&&m.geometry===r.geometry&&frameOrdinarySourceCurrent(r.source)&&frameRigidOwnerCurrent(owner)&&(m.updateMatrixWorld(true),m.matrixWorld.elements.every((v,i)=>v===r.world[i]));
 frameRigidDispose(frameRigidPrepared);frameRigidPrepared=null;frameNumericDisplayRetire(frameNumericDisplayRoots.get(h));
 r.actor=new OrdinaryMoveActor({native:frameNative,mesh:m,device:owner.device,pool:owner.pool,hooks:{
  current:r.current,error:e=>{frameOrdinaryNotes.errors.push(String(e));console.error('Ordinary Move',e);},render:scheduleRender,
  beforeInitialize:()=>retirement,metadata:g=>({...g.userData}),seed:frameOrdinarySeed,
  aliases:(g,numeric,derived)=>{const rows=[],o=wireOverlays.get(h);if(o?.geometry?.attributes.position===g.attributes.position&&Object.keys(o.geometry.attributes).length===1&&o.geometry.index)rows.push({geometry:o.geometry,extras:numeric.extras,elements:derived.wireElements});return rows;},
  copySelection:frameOrdinaryCopySelection,selection:()=>polySelection.items.get(h),context:history=>{const q=frameOrdinaryContext(h);if(history&&polySelection.items.size===1&&polySelection.items.has(h)&&polyPivotMatrix===(history.direction==='undo'?history.job.context.afterPivot:history.job.context.beforePivot))q.pivot=history.direction==='undo'?history.job.context.beforePivot:history.job.context.afterPivot;return q;},selectionStamp:()=>frameOrdinaryActorStamp(r),selectionCurrent:s=>frameOrdinaryActorPresentationCurrent(r,s),
  stageEntry:(packet,current)=>frameOrdinaryStageEntry(r,packet,current),releaseSelection:packet=>{for(const row of packet?.uploads||[])r.actor.pool.release(row);if(packet)packet.uploads=[];},
  stageSelection:(packet,current)=>frameOrdinaryStageSelection(r,packet,current),geometry:frameOrdinaryGeometry,
  pose:job=>{const envelope=frameOrdinaryBvhEnvelope(r.geometry);if(envelope){const base=r.actor.initialDerived.bounds;r.geometry.boundingBox=new THREE2.Box3(new THREE2.Vector3().fromArray(base.min).add(new THREE2.Vector3().fromArray(envelope.min)),new THREE2.Vector3().fromArray(base.max).add(new THREE2.Vector3().fromArray(envelope.max)));const box=r.geometry.boundingBox;r.geometry.boundingSphere=new THREE2.Sphere(box.getCenter(new THREE2.Vector3()),box.getSize(new THREE2.Vector3()).length()/2);}
   const s=frameOrdinaryInput?.job===job?frameOrdinaryInput:job.uiSession;if(!s||job.cancelled||!frameOrdinaryActorPresentationCurrent(r,{...s.presentationStamp,pivot:job.context.afterPivot??s.presentationStamp.pivot}))return;const delta=new THREE2.Matrix4().fromArray(job.delta);for(const {o,matrix}of s.overlays){o.matrix.copy(delta).multiply(matrix);o.matrixWorldNeedsUpdate=true;}const base=s.measurements;if(base){const shift=new THREE2.Vector3(job.delta[12],job.delta[13],job.delta[14]);const measurements={bounds:{min:base.bounds.min.clone().add(shift),max:base.bounds.max.clone().add(shift)},frame:base.frame.clone(),extent:base.extent.clone()};measurements.frame.elements[12]+=shift.x;measurements.frame.elements[13]+=shift.y;measurements.frame.elements[14]+=shift.z;frameOrdinaryCM={stamp:frameOrdinaryStamp(),measurements};updateHUD(readPolyTransform(coordMode,measurements));}scheduleRender();},
  command:job=>{job.command=frameOrdinaryHistoryEntry({h,mesh:m,node,sceneEpoch:r.sceneEpoch},job);pushCmd(job.command);},
  cancelled:(job,chain)=>frameOrdinaryRollbackJobs(r,chain),
  rollbackClosed:jobs=>frameOrdinaryRollbackJobs(r,jobs),
  retired:job=>{const s=frameOrdinaryInput;if(s?.job===job&&job.cancelled){s.blocked=true;s.overlays=s.measurements=s.presentationStamp=null;}},
  failed:jobs=>{frameOrdinaryRollbackJobs(r,jobs);for(const job of jobs){for(const stack of [undoStack,redoStack]){const i=stack.indexOf(job.command);if(i>=0)stack.splice(i,1);}job.checkpoints=null;}if(frameOrdinaryPrepared?.r===r)frameOrdinaryRetirePrepared();if(frameOrdinaryInput?.r===r)frameOrdinaryInput.blocked=true;},
  disposed:()=>{for(const row of r.overlayUploads||[])r.actor.pool.release(row);r.overlayUploads=[];},
  links:(g,numeric,derived)=>{const wire=wireOverlays.get(h),geometry=wire?liveWireGeometry(g):null;return {wire,geometry,aliases:geometry?[{geometry,extras:numeric.extras,elements:derived.wireElements}]:[]};},
  prepareInstall:(g,packet,options)=>{
   const old={geometry:m.geometry,source:r.source,entry:polySelection.items.get(h),revision:framePolySelectionRevision,pivot:polyPivotMatrix,cm:frameOrdinaryCM,edgeCM:frameNativeEdgeCM,connected:frameConnectedSelectionComplete,exactEdge:polyExactEdgeVertices,prepared:frameOrdinaryPrepared,uploads:r.overlayUploads,wire:options.links?.wire?.geometry,point:polyPointOverlays.get(h)?.geometry,overlays:frameRigidCaptureOverlays(),indices:[polySelection.face,polySelection.edge,polySelection.vertex].map(o=>[o.geometry,o.geometry.index,r.engine.geometryCache.rows.get(o.geometry)])};let committed=false,finished=false,present=false,committedRevision=null;
   return {commit(){
    const current=polySelection.items.get(h);if(current&&(current!==options.stamp.entry||framePolySelectionRevision!==options.stamp.revision))throw new DOMException('Owned selection changed during publication','AbortError');
    present=options.present();committed=true;m.geometry=g;r.geometry=g;r.source=frameOrdinaryCaptureSource(g);
    if(current){polySelection.items.set(h,packet.entry);framePolySelectionRevision++;}committedRevision=framePolySelectionRevision;
    if(present){if(options.history&&polyPivotMatrix===(options.history.direction==='undo'?options.history.job.context.afterPivot:options.history.job.context.beforePivot))polyPivotMatrix=options.history.direction==='undo'?options.history.job.context.beforePivot:options.history.job.context.afterPivot;frameNativeEdgeCM=null;frameConnectedSelectionComplete=null;polyExactEdgeVertices=null;frameOrdinaryInstallSelection(r,packet,true,false);}
    if(options.links?.wire)options.links.wire.geometry=options.links.geometry;
    const points=polyPointOverlays.get(h);if(points)points.geometry=g;frameOrdinaryPrepared=null;
   },rollback(){if(!committed||finished)return;m.geometry=old.geometry;r.geometry=old.geometry;r.source=old.source;if(polySelection.items.get(h)===packet.entry){if(old.entry)polySelection.items.set(h,old.entry);else polySelection.items.delete(h);}if(framePolySelectionRevision===committedRevision){framePolySelectionRevision=old.revision;polyPivotMatrix=old.pivot;frameOrdinaryCM=old.cm;frameNativeEdgeCM=old.edgeCM;frameConnectedSelectionComplete=old.connected;polyExactEdgeVertices=old.exactEdge;frameOrdinaryPrepared=old.prepared;r.overlayUploads=old.uploads;frameRigidRestoreOverlays({overlays:old.overlays});for(const [geometry,index,row]of old.indices){geometry.setIndex(index);if(row)r.engine.geometryCache.rows.set(geometry,row);else r.engine.geometryCache.rows.delete(geometry);}}if(options.links?.wire)options.links.wire.geometry=old.wire;const points=polyPointOverlays.get(h);if(points)points.geometry=old.point;scheduleRender();},
   finish(){finished=true;if(present)for(const row of old.uploads||[])r.actor.pool.release(row);else for(const row of packet.uploads||[])r.actor.pool.release(row);old.geometry.dispose();old.wire?.dispose();frameOrdinaryNotes.published++;}
   };
  },
  published:()=>frameOrdinaryPrepare(),refresh:()=>{frameOrdinaryPrepared=null;return frameOrdinaryPrepare();}
 }});frameOrdinaryOwners.set(h,r);return r;
}
function frameOrdinaryPrepare(sync=true,connected=false,clicked=null,control=null){
 if(!frameOrdinarySupported()||frameOrdinaryInstalling)return null;
 const stamp=frameOrdinaryStamp(),h=polySelection.items.keys().next().value,r=frameOrdinaryOwner(h);
 if(!connected&&frameOrdinaryPrepared?.r===r&&frameOrdinaryStampCurrent(frameOrdinaryPrepared.stamp))return frameOrdinaryPrepared;
 frameOrdinaryRetirePrepared();const controller=new AbortController(),prepared={r,stamp,sequence:r.actor.sequence,promise:null,readPromise:null,cancel(){controller.abort();if(frameOrdinaryPrepared===prepared)frameOrdinaryRetirePrepared();}};frameOrdinaryPrepared=prepared;
 const externalCancel=()=>prepared.cancel();control?.signal?.addEventListener('abort',externalCancel,{once:true});if(control?.signal?.aborted)prepared.cancel();
 const current=()=>!controller.signal.aborted&&(control?.isCurrent?.()??true)&&frameOrdinaryPrepared===prepared&&r.current()&&frameOrdinaryStampCurrent(stamp)&&(!connected||r.actor.sequence===prepared.sequence);
 prepared.readPromise=(async()=>{const seed=clicked?{vertices:clicked.domain==='vertex'?clicked.ids:[],edges:clicked.domain==='edge'?clicked.ids:[],faces:clicked.domain==='face'?clicked.ids:[]}:stamp.entry;const selection=await frameOrdinaryCopySelection(seed);if(!frameOrdinaryStampCurrent(stamp)||connected&&controller.signal.aborted)throw new DOMException('Move selection changed','AbortError');const context=frameOrdinaryContext(h);if(connected)context.pivot=null;return r.actor.read(selection,context,{connected,selectionRevision:stamp.revision});})();
 let packet;
 const work=(async()=>{packet=await prepared.readPromise;
  if(!current())throw new DOMException('Move selection changed','AbortError');
  await frameOrdinaryStageSelection(r,packet,current);
  if(!current())throw new DOMException('Connected selection changed','AbortError');
  prepared.packet=packet;
  if(!connected&&r.actor.sequence!==prepared.sequence){r.actor.hooks.releaseSelection(packet);return packet;}
  const commit=()=>{if(connected){frameCommitPreparedPolySelectionState({items:new Map([[h,packet.entry]]),connected:true});prepared.stamp=frameOrdinaryStamp();}frameOrdinaryInstallSelection(r,packet,sync);prepared.presented=true;if(connected)frameRememberConnectedSelection();};
  if(connected&&control?.nativeOwned)frameNativeCommitClick(commit);else commit();r.actor.tryPublish();return packet;
 })().finally(()=>{control?.signal?.removeEventListener('abort',externalCancel);if(!prepared.presented){r.actor.hooks.releaseSelection(packet);Promise.resolve(prepared.readPromise).then(q=>r.actor.releaseRead(q)).catch(()=>{});}});
 prepared.promise=frameOrdinaryAbortable(work,controller.signal).catch(e=>{if(e.name!=='AbortError'){frameOrdinaryNotes.errors.push(String(e));frameNativeSelectionError(e);}throw e;});prepared.promise.catch(()=>{});return prepared;
}
function frameOrdinaryPresentation(result,sync){if(frameOrdinaryInstalling||!frameOrdinarySupported())return false;frameOrdinaryCM=null;frameOrdinaryRetirePrepared();frameOrdinaryPrepare(sync);return true;}
function frameOrdinaryConnected(options,control){if(!frameOrdinarySupported())return null;const clicked=options.clicked;if(clicked&&(options.mode&&options.mode!=='replace'||clicked.h!==polySelection.items.keys().next().value||clicked.domain!==polyElementMode||clicked.geometry!==pickMeshes.get(clicked.h)?.geometry||clicked.revision!==framePolySelectionRevision))return null;return frameOrdinaryPrepare(true,true,clicked,{...control,nativeOwned:options.nativeOwned===true});}
function frameOrdinaryStart(e){
 if(!frameOrdinarySupported()||gizDrag?.mode!=='move'||e?.ctrlKey||e?.metaKey||e?.shiftKey)return false;
 if(framePolySelectionJob?.ordinary)frameCancelPolySelectionWork();
 const prepared=frameOrdinaryPrepare(false),r=prepared.r,context=frameOrdinaryContext(r.h),before=getGizmoWorldArray().slice();if(r.actor.historyBusy){frameOrdinaryInput={blocked:true,before,pointerId:e?.pointerId};gizBeforeGizmo=before;gizBeforePoly=new Map();return true;}
 const job=r.actor.start(prepared.readPromise,{...context,selection:prepared.stamp.entry});
 frameOrdinaryInput={r,job,before,pointerId:e?.pointerId,presentationStamp:frameOrdinaryActorStamp(r),measurements:frameOrdinaryCurrentMeasurements(),overlays:frameRigidCaptureOverlays()};job.uiSession=frameOrdinaryInput;gizBeforeGizmo=before;gizBeforePoly=new Map();gizBeforePolyGeom=null;gizBeforePolySel=null;frameOrdinaryNotes.starts++;return true;
}
function frameOrdinaryApply(delta){const s=frameOrdinaryInput;if(!s)return false;if(s.blocked)return true;const local=new THREE2.Matrix4().fromArray(s.job.context.inverse).multiply(delta).multiply(new THREE2.Matrix4().fromArray(s.job.context.world));s.r.actor.pose(s.job,delta.elements,local.elements);frameOrdinaryNotes.moves++;return true;}
function frameOrdinaryFinish(e){
 const s=frameOrdinaryInput;if(!s)return false;
 if(s.blocked||s.job?.cancelled){frameOrdinaryInput=null;gizBeforePoly=gizBeforeGizmo=null;placeGizmoForSelection(frameOrdinaryCurrentMeasurements());return true;}
 const cancel=e?.type==='pointercancel'||getGizmoWorldArray().every((v,i)=>v===s.before[i]);
 s.job.context.beforePivot=s.job.context.pivot;
 if(!cancel&&s.job.context.pivot){polyPivotMatrix=getGizmoWorldArray().slice();s.job.context.afterPivot=polyPivotMatrix;}else s.job.context.afterPivot=s.job.context.pivot;
 s.r.actor.finish(s.job,{cancel});if(!cancel)s.r.actor.hooks.pose(s.job);frameOrdinaryInput=null;gizBeforePoly=gizBeforeGizmo=null;frameOrdinaryNotes.ends++;
 (s.job.presentationReady||s.job.completion).then(()=>{frameOrdinaryRetirePrepared();frameOrdinaryPrepare();}).catch(()=>{});return true;
}
async function frameOrdinaryResolveHistory(c){const q=c.ordinaryMove;if(q.sceneEpoch!==frameOrdinarySceneEpoch||pickMeshes.get(q.h)!==q.mesh||OBJ.get(q.h)!==q.node||!q.job.checkpoints)throw new DOMException('Move history mesh/checkpoint changed','AbortError');const r=frameOrdinaryOwner(q.h);await r.actor.ready;return r.actor;}
function frameOrdinaryHistoryCommand(direction){const epoch=frameOrdinarySceneEpoch,from=direction==='undo'?undoStack:redoStack,to=direction==='undo'?redoStack:undoStack;if(!from.at(-1)?.ordinaryMove&&![...frameOrdinaryOwners.values()].some(r=>r.actor.operations))return false;frameOrdinaryHistory=frameOrdinaryHistory.then(async()=>{await Promise.all([...frameOrdinaryOwners.values()].map(r=>r.actor.exact));if(epoch!==frameOrdinarySceneEpoch)return;const c=from.at(-1);if(!c?.ordinaryMove){if(c)direction==='undo'?undo():redo();return;}const actor=await frameOrdinaryResolveHistory(c);await actor.history(c.ordinaryMove.job,direction,{isCurrent:()=>epoch===frameOrdinarySceneEpoch&&from.at(-1)===c});if(from.at(-1)!==c)throw new DOMException('Move history changed','AbortError');from.pop();to.push(c);trimCommandStack(to);restoreSceneCommandState(c,direction==='undo'?'before':'after');afterCmd(c);}).catch(e=>{if(epoch!==frameOrdinarySceneEpoch)return;frameOrdinaryNotes.errors.push(String(e));frameNativeSelectionError(e);});return true;}
function frameOrdinaryBvhEnvelope(g){for(const r of frameOrdinaryOwners.values())if(r.geometry===g&&r.current()&&r.actor.root?.rows.length){const min=[0,0,0],max=[0,0,0];for(const row of r.actor.root.rows)if(row.live&&!row.retiring){const local=new THREE2.Matrix4().fromArray(row.inverse).multiply(new THREE2.Matrix4().fromArray(row.delta)).multiply(new THREE2.Matrix4().fromArray(row.world));for(let k=0;k<3;k++){min[k]+=Math.min(0,local.elements[12+k]);max[k]+=Math.max(0,local.elements[12+k]);}}for(let k=0;k<3;k++){const pad=Math.max(1,Math.abs(g.boundingBox.min.getComponent(k)),Math.abs(g.boundingBox.max.getComponent(k)))*1e-5;min[k]-=pad;max[k]+=pad;}return {min,max};}return null;}
