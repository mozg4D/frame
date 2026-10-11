const frameAffineBindings=new WeakMap(),frameAffineBindingRecords=new Set();

// Affine component prototype: one authoring mesh, exact worker corner normals.
const frameAffineStages=new Map(),frameAffineKnownGeometry=new WeakMap();
const frameAffineNotes={prepared:0,starts:0,poses:0,exactPoses:0,commits:0,installed:0,history:0,errors:[],phases:[]};
let frameAffineSerial=0,frameAffineSaving=null;
function frameAffineEligible(t){if(!t||!t.faceIDs?.length||t.faceIDs.length>524288||Object.keys(t.g.attributes).some(k=>k!=='position'&&k!=='normal')||polyExactEdgeVertices?.has(t.h)||!frameAffineMaterialsAllowed(t.mesh))return false;let runs=1;for(let k=1;k<t.faceIDs.length;k++)if(t.faceIDs[k]!==t.faceIDs[k-1]+1&&++runs>128)return false;return true;}
function frameAffineRawSnapshot(t){
 const g=t.mesh.geometry,attrs={};for(const[k,a]of Object.entries(g.attributes))attrs[k]={array:a.array.slice(),itemSize:a.itemSize,normalized:a.normalized};
 const wire=wireOverlays.get(t.h)?.geometry;return{attrs,index:t.indexSeed,groups:g.groups.map(q=>({...q})),drawRange:{...g.drawRange},userData:{...g.userData},wire:wire?.index?.array??null,box:g.boundingBox?.clone()??null,sphere:g.boundingSphere?.clone()??null,selectedIDs:t.ids.slice(),aliasGuard:t.aliasGuard,aliasStable:t.stableFaceComponent===true};
}
function frameAffineGeometry(snapshot){
 const g=new THREE2.BufferGeometry();g.userData={...snapshot.userData};delete g.userData._polygonDragCorners;
 for(const[k,a]of Object.entries(snapshot.attrs))g.setAttribute(k,new THREE2.BufferAttribute(a.array.slice(),a.itemSize,a.normalized));
 g.setIndex(new THREE2.BufferAttribute(snapshot.index.slice(),1));for(const q of snapshot.groups)g.addGroup(q.start,q.count,q.materialIndex);g.setDrawRange(snapshot.drawRange.start,snapshot.drawRange.count);
 g.boundingBox=snapshot.box?.clone()??null;g.boundingSphere=snapshot.sphere?.clone()??null;
 if(snapshot.wire)wireTopologyCache.set(g,{index:g.index,array:g.index.array,version:g.index.version,vertices:g.attributes.position.count,indices:snapshot.wire});
 markPolygonCreaseGeometry(g);return g;
}
function frameAffineSourceStamp(mesh){const g=mesh.geometry,p=g.attributes.position,n=g.attributes.normal,i=g.index;return{mesh,g,p,n,i,pa:p.array,na:n.array,ia:i.array,pv:p.version,nv:n.version,iv:i.version,pcount:p.count,ncount:n.count,icount:i.count,pitem:p.itemSize,nitem:n.itemSize,iitem:i.itemSize,pnorm:p.normalized,nnorm:n.normalized,inorm:i.normalized,pinter:!!p.isInterleavedBufferAttribute,ninter:!!n.isInterleavedBufferAttribute,iinter:!!i.isInterleavedBufferAttribute,keys:Object.keys(g.attributes).join(','),groups:JSON.stringify(g.groups),range:JSON.stringify(g.drawRange),epoch:frameRigidEpoch.get(g)??0};}
function frameAffineStampCurrent(s){const g=s?.mesh?.geometry;return !!s&&!!g&&g===s.g&&g.attributes.position===s.p&&g.attributes.normal===s.n&&g.index===s.i&&s.p.array===s.pa&&s.n.array===s.na&&s.i.array===s.ia&&s.p.version===s.pv&&s.n.version===s.nv&&s.i.version===s.iv&&s.p.count===s.pcount&&s.n.count===s.ncount&&s.i.count===s.icount&&s.p.itemSize===s.pitem&&s.n.itemSize===s.nitem&&s.i.itemSize===s.iitem&&s.p.normalized===s.pnorm&&s.n.normalized===s.nnorm&&s.i.normalized===s.inorm&&!!s.p.isInterleavedBufferAttribute===s.pinter&&!!s.n.isInterleavedBufferAttribute===s.ninter&&!!s.i.isInterleavedBufferAttribute===s.iinter&&Object.keys(g.attributes).join(',')===s.keys&&JSON.stringify(g.groups)===s.groups&&JSON.stringify(g.drawRange)===s.range&&(frameRigidEpoch.get(g)??0)===s.epoch;}
function frameAffineStageCurrent(stage){return frameAffineStages.get(stage.h)===stage&&OBJ.get(stage.h)===stage.node&&pickMeshes.get(stage.h)===stage.mesh&&frameAffineStampCurrent(stage.stamp);}
function frameAffineKnownIDs(h){
 const mesh=pickMeshes.get(h),k=mesh&&frameAffineKnownGeometry.get(mesh.geometry),e=polySelection.items.get(h);
 return k&&frameAffineStampCurrent(k.stamp)&&e===k.entry&&e.faces===k.faces&&e.vertices===k.vertices&&e.edges===k.edges&&frameRigidSetSnapshotsCurrent(k.sets)&&framePolySelectionRevision===k.selection&&!e.vertices.size&&!e.edges.size&&!polyExactEdgeVertices?.has(h)&&polyElementMode==='face'&&polyFocusActive()?k.ids:null;
}
function frameAffineRememberGeometry(stage,snapshot,g){
 const entry=polySelection.items.get(stage.h);if(!entry||entry!==stage.context.entry||entry.faces!==stage.context.faces||entry.vertices!==stage.context.vertices||entry.edges!==stage.context.edges||!frameRigidSetSnapshotsCurrent(stage.context.selectionSets))return;
 frameAffineKnownGeometry.set(g,{stamp:frameAffineSourceStamp(stage.mesh),entry,faces:entry.faces,vertices:entry.vertices,edges:entry.edges,sets:frameRigidSetSnapshots([entry.faces,entry.vertices,entry.edges]),selection:framePolySelectionRevision,ids:new Set(snapshot.selectedIDs),aliasGuard:snapshot.aliasGuard,aliasStable:snapshot.aliasStable,outsideCanonical:snapshot.outsideCanonical===true,outsideHashes:snapshot.outsideHashes});
}
function frameAffineBind(stage,snapshot,syncPose=true){
 const mesh=stage.mesh;if(!mesh||OBJ.get(stage.h)!==stage.node||pickMeshes.get(stage.h)!==mesh)throw new DOMException('Affine history owner changed','AbortError');
 const old=mesh.geometry,entry=polySelection.items.get(stage.h),selection=entry?{vertices:[...entry.vertices],edges:[...entry.edges],revision:framePolySelectionRevision}:null,remap=frameAffineSelectionRemap(old,snapshot.index,entry),g=frameAffineGeometry(snapshot),t=frameRigidPrepared,points=polyPointOverlays.get(stage.h),oldPoints=points?.geometry,wire=wireOverlays.get(stage.h),oldWire=wire?.geometry,oldPivot=polyPivotMatrix?.slice()??null,oldGizmo=typeof getGizmoWorldArray==='function'?getGizmoWorldArray():null,overlays=typeof frameRigidCaptureOverlays==='function'?frameRigidCaptureOverlays():null,prior={stamp:stage.stamp,bound:stage.bound,snapshot:stage.snapshot};let changed=false;const binding=frameAffineBindings.get(mesh),preserve=binding&&frameAffineBindingCurrent(binding)&&snapshot.index.length===old.index.array.length?binding:null,keepWorker=!!preserve&&frameAffineStages.get(stage.h)===stage&&preserve.logicalVersion===stage.logicalVersion&&preserve.canonicalVersion===stage.logicalVersion&&preserve.canonicalSnapshot===snapshot&&!!preserve.workerPipe&&!preserve.workerPipe.closed&&preserve.workerPipe.confirmedVersion===stage.logicalVersion,bindingPrior=preserve?{stamp:preserve.stamp,physicalRaw:preserve.physicalRaw,initialRaw:preserve.initialRaw,canonicalSnapshot:preserve.canonicalSnapshot,logicalVersion:preserve.logicalVersion,canonicalVersion:preserve.canonicalVersion,rawDisplayBaseline:preserve.rawDisplayBaseline,fullNumeric:preserve.fullNumeric,bindDisplay:preserve.bindDisplay,active:preserve.active,revision:preserve.revision,lastPublishedSnapshot:preserve.lastPublishedSnapshot,positions:!keepWorker||preserve.lastPublishedSnapshot!==snapshot?preserve.numeric.positions.slice():null,extras:!keepWorker||preserve.lastPublishedSnapshot!==snapshot?preserve.numeric.extras.slice():null}:null;
 let gpuCheckpoint=null;try{
  if(bindingPrior?.positions)gpuCheckpoint=preserve.gpu.beginAuthoringTransaction();
  if(t?.mesh===mesh)frameRigidPrepared=null;frameRigidCancelDerived();mesh.geometry=g;changed=true;frameAffineApplyRemap(entry,remap);if(points)points.geometry=g;
  refreshWireOverlay(mesh);if(preserve)frameAffineSeedBindDisplay(preserve,mesh,snapshot,g,wire?.geometry);stage.stamp=frameAffineSourceStamp(mesh);stage.bound=snapshot;stage.snapshot=snapshot;frameAffineRememberGeometry(stage,snapshot,g);
  const canonicalValues=new Float32Array(snapshot.selectedIDs.length*3);for(let k=0;k<snapshot.selectedIDs.length;k++)canonicalValues.set(snapshot.attrs.position.array.subarray(snapshot.selectedIDs[k]*3,snapshot.selectedIDs[k]*3+3),k*3);if(syncPose)frameRigidHistoryPose({...stage.context,ids:snapshot.selectedIDs},canonicalValues,stage.pivot,stage.pose,frameAffineLiveOverlays(stage),stage.space,stage.world);
  if(remap&&typeof rebuildPolySelection==='function')rebuildPolySelection(false);scheduleRender();if(preserve)frameAffineBindingTransfer(preserve,mesh,snapshot,keepWorker);frameRigidSchedulePrepare();
 }catch(error){
  const own=changed&&mesh.geometry===g;if(own){mesh.geometry=old;if(points)points.geometry=oldPoints;if(wire)wire.geometry=oldWire;if(selection){entry.vertices.clear();entry.edges.clear();for(const id of selection.vertices)entry.vertices.add(id);for(const id of selection.edges)entry.edges.add(id);framePolySelectionRevision=selection.revision;}polyPivotMatrix=oldPivot;}
  if(preserve&&preserve.live){const current=frameRigidPrepared;if(current&&current!==t&&current.mesh===mesh){current.affinePreserve=preserve;frameRigidDispose(current);frameRigidPrepared=null;}const closed=preserve.workerPipe?.closed,{positions,extras,...state}=bindingPrior;Object.assign(preserve,state);if(closed){preserve.workerPipe=null;preserve.initialRaw=preserve.physicalRaw;preserve.logicalVersion=preserve.canonicalVersion=0;}if(positions){preserve.numeric.positions.set(positions);preserve.numeric.extras.set(extras);}}
  Object.assign(stage,prior);frameAffineKnownGeometry.delete(g);frameAffineCleanup(()=>t?.engine?.geometryCache.rows.delete(g));objectPickBVHs.delete(g);frameSTLPickTrees.delete(g);wireTopologyCache.delete(g);
  if(t&&!t.disposed&&mesh.geometry===old&&frameRigidSource(t)){frameRigidPrepared=t;t.affine=preserve??t.affine;}else if(t&&t.mesh===mesh){if(preserve)t.affinePreserve=preserve;frameRigidDispose(t);}
  if(gpuCheckpoint)try{gpuCheckpoint.rollback();}catch(rollbackError){frameAffineRetireBinding(preserve);if(t?.affine===preserve)t.affine=null;if(frameRigidPrepared===t){frameRigidDispose(t);frameRigidPrepared=null;}frameAffineNotes.errors.push('Affine Bind GPU rollback: '+String(rollbackError));}
  if(own)try{if(overlays)frameRigidRestoreOverlays({overlays});if(oldGizmo)setGizmoFromMatrix(oldGizmo);updateHUD();scheduleRender();}catch{}
  frameAffineCleanup(()=>g.dispose());throw error;
 }
 gpuCheckpoint?.commit();if(t?.mesh===mesh){if(preserve)t.affinePreserve=preserve;frameRigidDispose(t);}
 frameAffineCleanup(()=>frameGetNativeTopologyCache().invalidate(old));objectPickBVHs.delete(old);frameSTLPickTrees.delete(old);frameAffineCleanup(()=>old.dispose());return g;
}
function frameAffineAdopt(stage){
 const version=stage.generation;stage.installPromise=stage.promise.then(async result=>{
  stage.canonicalSnapshot??=result;stage.pendingData=stage.historyData=stage.historyRecipe=null;stage.error=null;stage.resolveSnapshot=stage.rejectSnapshot=null;stage.workerSession=null;
  await frameAffineYield();if(stage.generation!==version||!frameAffineStageCurrent(stage))return false;
  if(frameAffinePublicationBusy()){setTimeout(()=>{if(stage.generation===version&&frameAffineStageCurrent(stage))frameAffineAdopt(stage);},32);return false;}
  frameAffineAssertHistory(stage);const snapshot=stage.canonicalSnapshot;if(stage.snapshot!==snapshot){frameAffineBind(stage,snapshot,true);frameAffineNotes.installed++;}frameAffineForgetStage(stage);return true;
 }).catch(error=>{
  if(frameAffineStages.get(stage.h)===stage&&frameAffineStageCurrent(stage)){
   stage.error=error;stage.workerSession?.deref()?.closeWorker?.(error);stage.workerSession=null;
   if(error.name!=='AbortError'){frameAffineNotes.errors.push(String(error));console.error('Affine exact result failed; canonical repair is required before Save',error);}
  }else if(frameAffineStages.get(stage.h)===stage)frameAffineForgetStage(stage,{cancel:true});return false;
 });return stage.installPromise;
}
function frameAffineCancelPublication(){for(const stage of frameAffineStages.values())if(!stage.snapshot){stage.generation++;frameAffineAdopt(stage);}}
function* frameAffineSnapshotWork(s,compact){
 if(s.stockFast)return yield* frameAffineMergedSnapshotWork(s,compact);
 let stock=s.wholeCompact;
 if(!stock){const raw=s.beforeRaw,positions=raw.attrs.position.array.slice(),faceSlots=s.faceSlots??s.r.faceSlots;
  if(s.latestExact?.positions){for(let k=0;k<s.t.ids.length;k++)positions.set(s.latestExact.positions.subarray(k*3,k*3+3),s.t.ids[k]*3);}
  else{for(let f=0;f<faceSlots.length;f++){const local=faceSlots[f]-1;if(local<0)continue;for(let c=0;c<3;c++){const from=compact.indices[local*3+c]*3;positions.set(compact.positions.subarray(from,from+3),raw.index[f*3+c]*3);}}}
  stock=polygonCreaseData(positions,raw.index,CREASE_COS);
 }
 return yield* frameAffineWholeSnapshotWork(s.beforeRaw,stock,s.faceSlots??s.r.faceSlots,s.t.aliasGuard,stock.outsideCanonical===true);
}
function frameAffineYield(){return typeof globalThis.scheduler?.yield==='function'?globalThis.scheduler.yield():new Promise(resolve=>setTimeout(resolve,4));}
async function frameAffinePrepare(t){
 const ready=t.affine?.promise??frameAffinePrepareEarly(t);if(!ready)throw new DOMException('Affine display ineligible','AbortError');const r=await ready;
 if(!frameRigidSelection(t)||!frameAffineBindingCurrent(r))throw new DOMException('Affine authoring owner changed','AbortError');
 const localIndex=new Uint32Array(r.faceIDs.length*3);for(let k=0;k<r.faceIDs.length;k++)for(let c=0;c<3;c++){const id=t.indexSeed[r.faceIDs[k]*3+c],slot=t.slot[id]-1;if(slot<0)throw new DOMException('Affine selected authoring slot missing','AbortError');localIndex[k*3+c]=slot;}
 r.localIndex=localIndex;if(!r.initialRaw)r.initialRaw=r.physicalRaw=frameAffineRawSnapshot(t);return r;
}

function frameAffineCancelSession(s){
 if(!s)return;s.cancel=true;s.affineDirty=false;const error=new DOMException('Affine gesture cancelled','AbortError');
 try{s.closeWorker?.(error);}finally{try{s.rejectSnapshot?.(error);}finally{
  const r=s.r;if(!r?.live||r.active!==s)return;
  try{
   if(frameRigidSource(s.t)){
    if(s.previewReady&&!s.ready&&frameRigidTransactionCurrent(s))frameAffineCleanup(()=>{frameRigidRestoreOverlays(s);s.t.bounds=s.beforeBounds?{min:s.beforeBounds.min,max:s.beforeBounds.max}:null;s.t.boundsWorld=s.beforeBounds?.world??null;});
    frameAffineRestoreRawDisplay(s);const p=r.numeric?.positions,x=r.numeric?.extras,local=s.localIndex??r.localIndex;
    if(p&&x&&local&&s.beforeValues&&s.beforeNormals){for(let k=0;k<local.length;k++){const from=local[k]*3;p.set(s.beforeValues.subarray(from,from+3),k*3);x.set(s.beforeNormals.subarray(from,from+3),k*9);}if(!r.gpu?.restoreFrozenSource)r.gpu?.writeAuthoringRanges?.([[0,local.length]]);}if(r.gpu?.restoreFrozenSource)r.gpu.restoreFrozenSource().catch(error=>frameAffineNotes.errors.push('Affine frozen display restore: '+String(error)));
   }
  }catch(error){frameAffineNotes.errors.push('Affine cancel display restoration: '+String(error));}
  finally{r.bindDisplay=null;r.fullNumeric=frameRigidSource(s.t)?s.beforeFullNumeric??null:null;r.rawDisplayBaseline=s.beforeRawDisplayBaseline??null;r.displayEnabled=s.beforeDisplayEnabled??true;r.revision++;if(r.fullNumeric){const revision=r.revision;r.fullNumeric.isCurrent=()=>r.live&&r.revision===revision&&frameRigidSource(s.t);}r.active=null;frameAffineCleanup(()=>scheduleRender());}
 }}
}

function frameAffineDispose(t){
 const r=t?.affine;if(!r||!r.live)return;if(t.affinePreserve===r){t.affine=null;t.affinePreserve=null;return;}
 if(r.managed){frameAffineRetireBinding(r);return;}r.live=false;const s=r.active,error=new DOMException('Affine binding retired','AbortError');frameAffineCleanup(()=>s?.closeWorker?.(error));frameAffineCleanup(()=>s?.rejectSnapshot?.(error));frameAffineCleanup(()=>r.workerPipe?.close(error));for(const resource of[r.display,r.gpu])frameAffineCleanup(()=>resource?.dispose());r.display=r.gpu=r.numeric=r.fullNumeric=r.active=r.t=null;r.faceSlots=r.localIndex=r.faceIDs=null;r.initialRaw=r.physicalRaw=r.canonicalSnapshot=r.rawDisplayBaseline=r.workerPipe=r.bindDisplay=null;
}
function frameAffineCreateWorker(s){
 const r=s.r,pipe=r.workerPipe&&!r.workerPipe.closed?r.workerPipe:frameAffineCreateWorkerPipe(r,r.managed?s.beforeExact:r.initialRaw??s.beforeRaw,s.faceIDs??r.faceIDs,s.priorStage?.logicalVersion??r.logicalVersion??0);
 s.worker=pipe.worker;s.workerClosed=false;s.ownerVersion=pipe.ownerVersion;s.baseVersion=s.priorStage?.logicalVersion??r.logicalVersion??0;
 s.closeWorker=(reason=new DOMException('Affine gesture lease retired','AbortError'))=>{if(s.workerClosed)return;s.workerClosed=true;pipe.cancel(s,reason);};s.call=(message,transfer=[])=>pipe.call(s,message,transfer);
 s.workerReady=pipe.ready.then(async()=>{s.exactRaw=await s.beforeExact;if(s.workerClosed)throw new DOMException('Affine gesture lease retired','AbortError');return s.call({kind:'canonical-begin',gesture:s.affineID,baseVersion:s.baseVersion,ownerVersion:s.ownerVersion});});s.workerReady.catch(()=>{});s.workerGate=s.workerReady;
 s.run=work=>{const promise=s.workerGate.then(()=>{if(s.workerClosed)throw new DOMException('Affine gesture lease retired','AbortError');return work();});s.workerGate=promise.catch(()=>{});return promise;};
}
function frameAffineActivate(s){
 s.r=s.t.affine;if(!s.previewReady)frameAffineStartPreview(s);s.faceSlots=s.r.faceSlots;s.localIndex=s.r.localIndex;s.faceIDs=s.r.faceIDs;s.previewPositionView=s.t.adapter.positionView;s.beforeRaw=s.r.physicalRaw??frameAffineRawSnapshot(s.t);
 const prior=frameAffineStages.get(s.t.h);s.priorStage=prior&&frameAffineStageCurrent(prior)?prior:null;s.beforeExact=s.priorStage?s.priorStage.promise:Promise.resolve(s.beforeRaw);s.beforeDisplayRaw=s.beforeRawDisplayBaseline?.positions??s.beforeRaw.attrs.position.array;
 frameAffineCreateWorker(s);
}
function frameAffinePosePublish(s,q){
 const r=s.r;if(s.cancel||s.discarded||!r.live||r.active!==s||q.revision!==s.affineRevision||!frameRigidSource(s.t))return false;
 r.lastPublishedSnapshot=q.globalSnapshot??null;r.numeric.positions.set(q.cornerPositions);for(let k=0;k<q.cornerNormals.length/3;k++)r.numeric.extras.set(q.cornerNormals.subarray(k*3,k*3+3),k*9);
 const t=s.t;if(q.rawFullPositions){s.rawDisplayFullTouched=true;r.rawDisplayBaseline={positions:q.rawFullPositions};t.numeric.positions.set(q.rawFullPositions);}else{for(let k=0;k<q.positions.length/3;k++)t.numeric.positions.set(q.positions.subarray(k*3,k*3+3),(t.ids?.[k]??k)*3);}
 t.device.queue.writeBuffer(t.gpu.position,0,t.numeric.positions);t.device.queue.writeBuffer(r.gpu.position,0,r.numeric.positions);t.device.queue.writeBuffer(r.gpu.normal,0,r.numeric.extras);
 if(t.adapter){t.adapter.revision++;const values=t.numeric.positions;t.adapter.positionView=(id,c)=>values[id*3+c];}r.revision++;if(r.fullNumeric){const revision=r.revision;r.fullNumeric.isCurrent=()=>r.live&&r.revision===revision&&frameRigidSource(t);}
 frameAffineNotes.exactPoses++;frameAffineNotes.phases.push({name:'affine-exact-worker-pose',gesture:s.affineID,revision:q.revision,...q.timings});scheduleRender();return true;
}
function frameAffinePump(s){
 if(s.affineFailed)return;s.affineDirty=true;if(s.affineRunning||s.cancel||s.discarded)return;s.affineRunning=true;
 (async()=>{try{await s.workerReady;while(s.affineDirty&&!s.cancel&&!s.discarded){
  s.affineDirty=false;const revision=s.affineRevision,delta=s.delta.elements.slice(),final=!!s.committed&&s.released&&revision===s.finalAffineRevision;
  const result=await s.run(async()=>{const q=await s.call({kind:'canonical-pose',gesture:s.affineID,revision,baseVersion:s.baseVersion,ownerVersion:s.ownerVersion,world:s.world.elements,delta,inverse:s.inverse.elements,final}),snapshot=await frameAffineGlobalSnapshot(s,q);return{q,snapshot};});
  s.latestExact=result.q;s.latestGlobal=result.snapshot;
  if(revision===s.affineRevision)await frameAffineGlobalPublish(s,result.q,result.snapshot);
  if(result.q.committed){s.afterSnapshot=result.snapshot;s.r.canonicalSnapshot=result.snapshot;s.r.canonicalVersion=result.q.version;s.resolveSnapshot?.(result.snapshot);s.affineEnded=true;break;}
  if(s.committed&&s.released&&revision===s.finalAffineRevision)s.affineDirty=true;
 }}catch(error){s.affineFailed=true;s.affineDirty=false;frameAffineCleanup(()=>s.closeWorker?.(error));frameAffineCleanup(()=>s.r?.workerPipe?.close(error));frameAffineCleanup(()=>s.rejectSnapshot?.(error));if(error.name!=='AbortError'){frameAffineNotes.errors.push(String(error));console.error('Affine canonical worker failed',error);}}
 finally{s.affineRunning=false;if(s.affineEnded||s.cancel||s.discarded||s.affineFailed)frameAffineCleanup(()=>s.closeWorker?.());else if(s.affineDirty)frameAffinePump(s);}
 })();
}
function frameAffineSubmit(s){
 const t=s.t,r=s.r;if(!s.previewReady||s.cancel||s.discarded)return;if(!frameRigidTransactionCurrent(s)){frameRigidAbortAll('affine-source-changed-during-preview');return;}
 if(r.active!==s){if(s.ready)frameAffinePump(s);return;}
 const local=s.inverse.clone().multiply(s.delta).multiply(s.world),normal3=new THREE2.Matrix3().getNormalMatrix(local),normal=new THREE2.Matrix4(),a=normal3.elements,e=normal.elements,sign=local.determinant()<0?-1:1;for(let col=0;col<3;col++)for(let row=0;row<3;row++)e[col*4+row]=a[col*3+row]*sign;
 s.revision++;s.affineRevision++;if(t.adapter){t.adapter.positionView=s.previewPositionView??null;t.adapter.revision++;}r.fullNumeric=null;r.revision++;
 for(const{o,matrix}of s.overlays??[]){o.matrixAutoUpdate=false;o.matrix.copy(s.delta).multiply(matrix);o.matrixWorldNeedsUpdate=true;}
 const revision=s.affineRevision,current=()=>!s.cancel&&!s.discarded&&r.active===s&&s.affineRevision===revision&&frameRigidTransactionCurrent(s);
 if(s.ready&&t.gpu)t.gpu.submit({matrix:local.elements,world:s.world.elements,basis:new THREE2.Matrix4().elements,isCurrent:current}).catch(error=>{if(error.name!=='AbortError')frameAffineNotes.errors.push(String(error));});
 r.gpu.submit({matrix:local.elements,normalMatrix:normal.elements,world:s.world.elements,basis:new THREE2.Matrix4().elements,isCurrent:current}).then(result=>{if(result.status!=='ready'||!current())return;t.bounds={min:new THREE2.Vector3().fromArray(result.min),max:new THREE2.Vector3().fromArray(result.max)};t.boundsWorld=s.world.clone();updateHUD();scheduleRender();}).catch(error=>{if(error.name!=='AbortError')frameAffineNotes.errors.push(String(error));});
 frameAffineNotes.poses++;if(s.ready)frameAffinePump(s);scheduleRender();
}
function frameAffineStage(s,values,pivot,pose,overlays,fallback,promise){
 const mesh=new WeakRef(s.t.mesh),h=s.t.h,owner=frameAffineOwnerToken(h),currentNode=()=>frameAffineOwnerTokens.get(OBJ.get(h))===owner?OBJ.get(h):undefined,context={h,get mesh(){return mesh.deref();},get node(){return currentNode();},entry:s.t.entry,faces:s.t.faces,vertices:s.t.vertices,edges:s.t.edges,selectionSets:s.t.selectionSets,selectionRevision:s.t.selectionRevision,ids:s.t.ids};
 return{h,owner,get node(){return currentNode();},get mesh(){return mesh.deref();},context,world:s.world.clone(),space:s.coordinateSpace,values,pivot:pivot?.slice()??null,pose:pose.slice(),overlays:frameAffineFreezeOverlays(overlays),bound:fallback,fallback,promise,generation:0,snapshot:null,canonicalSnapshot:null,pendingData:null,stamp:frameAffineSourceStamp(s.t.mesh)};
}
function frameAffineHistory(stage,expected=stage){
 frameRigidBeforeHistory();frameAffineAssertHistory(expected);const current=frameAffineStages.get(stage.h),prior={generation:stage.generation,stamp:stage.stamp,bound:stage.bound,snapshot:stage.snapshot};
 try{const snapshot=frameAffineCanonicalNow(stage);frameAffineCancelPublication();stage.generation++;frameAffineBind(stage,snapshot,true);frameAffineNotes.history++;frameAffineForgetStage(stage);}
 catch(error){Object.assign(stage,prior);if(current)frameAffineStages.set(stage.h,current);else frameAffineStages.delete(stage.h);throw error;}
}
async function frameAffineCommit(s){
 const t=s.t,started=performance.now();if(!frameRigidTransactionCurrent(s,true)||!frameRigidSelection(t,true))throw new DOMException('Affine transaction stale before release','AbortError');
 const values=new Float32Array(t.ids.length*3),p=new THREE2.Vector3(),moved=new THREE2.Vector3();for(let k=0;k<t.ids.length;k++){p.fromArray(s.beforeValues,k*3);moved.copy(p).applyMatrix4(s.world).applyMatrix4(s.delta).applyMatrix4(s.inverse);p.lerp(moved,1);p.toArray(values,k*3);if((k&8191)===8191){await frameAffineYield();if(s.cancel||s.discarded||!frameRigidTransactionCurrent(s,true)||!frameRigidSelection(t,true))throw new DOMException('Affine release source changed','AbortError');}}
 if(!frameRigidAliasSafe(t,values)){s.affine=false;s.kind='cpu';s.closeWorker?.();return frameRigidFallback(s);}
 const prior=frameAffineStages.get(t.h),pivot=s.beforePivot?s.afterGizmo.slice():null,overlays=frameRigidCaptureOverlays(),history={undo:undoStack.slice(),redo:redoStack.slice(),token:sceneStateToken,sequence:sceneMutationSequence,started:sceneWorkStartedAt};let wrote=false,after,before;
 let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});promise.catch(()=>{});s.resolveSnapshot=resolve;s.rejectSnapshot=reject;
 try{
  t.adapter.positionView=t.adapter.normalView=null;frameRigidApplySparse(t,values,s.beforeNormals,null,()=>wrote=true);frameRigidExactBounds(t);const canonical=polyFrameMatrix(t.bounds).elements.slice(),afterFallback=frameAffineRawSnapshot(t);
  after=frameAffineStage(s,values,pivot,canonical,overlays,afterFallback,promise);before=frameAffineStage(s,s.beforeValues,s.beforePivot,s.gizmo,s.overlays,s.beforeRaw,s.beforeExact);
  after.pendingData={raw:s.beforeRaw,ids:t.ids,values,faceSlots:s.r?.faceSlots??new Int32Array(t.indexSeed.length/3),aliasGuard:t.aliasGuard};if(!s.r?.faceSlots)for(const face of t.faceIDs)after.pendingData.faceSlots[face]=1;
  after.historyData=after.pendingData;after.historyRecipe={parent:s.priorStage??null,raw:s.beforeRaw,faces:s.faceIDs.slice(),world:s.world.elements.slice(),delta:s.delta.elements.slice(),inverse:s.inverse.elements.slice(),aliasGuard:t.aliasGuard};before.historyRecipe=s.priorStage?{inherit:s.priorStage}:null;after.logicalVersion=s.baseVersion+1;before.logicalVersion=s.baseVersion;after.workerSession=new WeakRef(s);after.resolveSnapshot=resolve;after.rejectSnapshot=reject;before.pendingData=prior?.pendingData??null;before.canonicalSnapshot=prior?prior.canonicalSnapshot??null:s.beforeRaw;
  before.promise.then(snapshot=>{before.canonicalSnapshot=snapshot;before.fallback=snapshot;before.pendingData=before.historyData=before.historyRecipe=null;}).catch(()=>{});
  s.stage=after;frameAffineStages.set(t.h,after);frameRigidHistoryPose(after.context,values,pivot,canonical,frameAffineLiveOverlays(after),s.coordinateSpace,s.world);frameRigidRefreshSelection(t,pivot,values);
  const command={redo(){frameAffineHistory(after,before);},undo(){frameAffineHistory(before,after);}};pushCmd(command);s.committed=true;s.finalAffineRevision=s.affineRevision;s.r.logicalVersion=after.logicalVersion;s.r.physicalRaw=afterFallback;
  frameAffineAdopt(after);frameAffinePump(s);frameAffineNotes.commits++;frameRigidNotes.commits++;frameAffineNotes.phases.push({name:'affine-authoring-release',ms:performance.now()-started,faces:t.faceIDs.length,vertices:t.ids.length});
 }catch(error){
  reject(error);s.closeWorker?.();frameRigidCancelDerived();if(frameAffineStages.get(t.h)===after)frameAffineStages.delete(t.h);if(prior)frameAffineStages.set(t.h,prior);s.stage=null;s.committed=false;
  if(wrote&&t.mesh.geometry===t.g&&t.g.attributes.position===t.p&&t.g.attributes.normal===t.n&&t.p.array===t.pa&&t.n.array===t.na){frameRigidRestoreAuthoring(t,s.beforeValues,s.beforeNormals);polyPivotMatrix=s.beforePivot;frameRigidRestoreOverlays(s);frameRigidExactBounds(t);if(prior)prior.stamp=frameAffineSourceStamp(t.mesh);try{placeGizmoForSelection();updateHUD();scheduleRender();}catch{}}
  undoStack.splice(0,undoStack.length,...history.undo);redoStack.splice(0,redoStack.length,...history.redo);sceneStateToken=history.token;sceneMutationSequence=history.sequence;sceneWorkStartedAt=history.started;throw error;
 }
}
async function frameAffineWaitForSave(signal){
 for(;;){if(signal?.aborted)throw signal.reason||new DOMException('Save cancelled','AbortError');frameAffinePruneStages();const boundary=frameAffineBoundary();if(boundary.released.length){await nativeSaveWait(frameRigidDraining?new Promise(resolve=>setTimeout(resolve,4)):frameRigidDrain(),signal);continue;}const active=boundary.active,stages=boundary.stages.filter(({stage})=>stage.mesh!==active?.t.mesh),resolved=await nativeSaveWait(Promise.all(stages.map(({stage})=>stage.error?frameAffineRepairStage(stage):stage.promise.catch(()=>frameAffineRepairStage(stage)))),signal);
  await nativeSaveWait(Promise.all(stages.map(({stage})=>stage.installPromise??Promise.resolve())),signal);if(!frameAffineBoundaryCurrent(boundary))continue;const snapshots=new Map(stages.map(({stage},k)=>[stage.mesh.geometry,stage.canonicalSnapshot??resolved[k]]));
  if(active){if(!active.ready||!active.call||!active.run){await nativeSaveWait(frameAffineYield(),signal);continue;}
   let snapshot;try{snapshot=await nativeSaveWait(frameAffineCaptureActiveSave(active,boundary),signal);}catch(error){if(!frameAffineBoundaryCurrent(boundary))continue;throw error;}
   if(!frameAffineBoundaryCurrent(boundary))continue;snapshots.set(active.t.g,snapshot);
  }
  if(!frameAffineBoundaryCurrent(boundary))continue;frameAffineSaving=snapshots;frameAffineSavingBoundary=boundary;return;
 }
}
function frameAffineSaveSnapshot(g){if(frameAffineSavingBoundary&&!frameAffineBoundaryCurrent(frameAffineSavingBoundary))throw new DOMException('Affine Save boundary changed','AbortError');const snapshot=frameAffineSaving?.get(g);if(!snapshot)return null;return{positions:snapshot.attrs.position.array,normals:snapshot.attrs.normal.array,indices:snapshot.index};}


let frameAffineSavingBoundary=null;
function frameAffineMaterialsAllowed(mesh){const rows=Array.isArray(mesh?.material)?mesh.material:[mesh?.material];return rows.every(m=>m&&!m.transparent&&m.depthWrite!==false&&(m.opacity??1)===1);}
async function frameAffineGlobalSnapshot(s,q){
 if(q.baseVersion!==s.baseVersion||q.ownerVersion!==s.ownerVersion||!q.rawPositions||!q.rawNormals||!q.rawIndices)throw new DOMException('Affine exact canonical packet changed','AbortError');
 const stock={positions:q.rawPositions,normals:q.rawNormals,indices:q.rawIndices,outsideHashes:q.outsideHashes};
 const snapshot=await frameNative.drainCooperatively(frameAffineWholeSnapshotWork(s.exactRaw??s.beforeRaw,stock,s.faceSlots,s.t.aliasGuard,q.outsideCanonical===true),{yieldTask:frameAffineYield});
 snapshot.cornerPositionsUnchanged=q.cornerPositionsUnchanged;snapshot.logicalVersion=q.version;s.stockFast=q.needsWhole===false;return snapshot;
}
async function frameAffineGlobalPublish(s,q,snapshot){
 const r=s.r;if(s.cancel||s.discarded||!r.live||r.active!==s||q.revision!==s.affineRevision||!frameRigidSource(s.t))return false;
 const positions=snapshot.attrs.position.array,normal=snapshot.attrs.normal.array,extras=new Float32Array(positions.length*3),wireExtras=q.committed&&snapshot.wire?new Float32Array(extras.length):null;
 for(let k=0;k<positions.length/3;k++){extras.set(normal.subarray(k*3,k*3+3),k*9);extras[k*9+5]=extras[k*9+6]=extras[k*9+7]=extras[k*9+8]=1;if(wireExtras)wireExtras[k*9+2]=wireExtras[k*9+5]=wireExtras[k*9+6]=wireExtras[k*9+7]=wireExtras[k*9+8]=1;if((k&4095)===0){await frameAffineYield();if(s.cancel||s.discarded||!r.live||r.active!==s||q.revision!==s.affineRevision)return false;}}
 const corners=new Float32Array(s.faceIDs.length*9),cornerNormals=new Float32Array(corners.length),raw=s.beforeRaw.index,rawPositions=s.t.numeric.positions.slice();
 for(let f=0;f<raw.length/3;f++){for(let c=0;c<3;c++){const at=f*3+c,from=snapshot.index[at]*3,id=raw[at]*3;rawPositions.set(positions.subarray(from,from+3),id);}if((f&8191)===0){await frameAffineYield();if(s.cancel||s.discarded||!r.live||r.active!==s||q.revision!==s.affineRevision)return false;}}
 for(let k=0;k<s.faceIDs.length;k++){for(let c=0;c<3;c++){const from=snapshot.index[s.faceIDs[k]*3+c]*3,at=(k*3+c)*3;corners.set(positions.subarray(from,from+3),at);cornerNormals.set(normal.subarray(from,from+3),at);}if((k&2047)===0){await frameAffineYield();if(s.cancel||s.discarded||!r.live||r.active!==s||q.revision!==s.affineRevision||!frameRigidSource(s.t))return false;}}
 if(s.cancel||s.discarded||!r.live||r.active!==s||q.revision!==s.affineRevision||!frameRigidSource(s.t))return false;
 if(q.committed)r.bindDisplay={snapshot,positions:positions.slice(),extras:extras.slice(),wireExtras};const revision=++r.revision;r.fullNumeric={source:snapshot,positions,extras,indices:snapshot.index,vertexCount:positions.length/3,hasNormals:true,hasUV:false,hasColors:false,lineIndices:new Map(),isCurrent:()=>r.live&&r.revision===revision&&frameRigidSource(s.t)};
 const exact={...q,cornerPositions:corners,cornerNormals,rawFullPositions:rawPositions,globalSnapshot:snapshot};await frameAffineYield();if(s.cancel||s.discarded||!r.live||r.active!==s||q.revision!==s.affineRevision||!frameRigidSource(s.t))return false;return frameAffinePosePublish(s,exact);
}
async function frameAffineCaptureActiveSave(s,boundary){
 const raw=await s.beforeExact;if(!frameAffineBoundaryCurrent(boundary))throw new DOMException('Affine Save baseline changed','AbortError');
 if(!frameAffineSnapshotMatches(s.t.mesh,s.beforeRaw))throw new DOMException('Affine Save source content changed','AbortError');
 const delta=s.delta.elements.slice();const q=await s.run(()=>s.call({kind:'canonical-pose',gesture:s.affineID,revision:boundary.revision,baseVersion:s.baseVersion,ownerVersion:s.ownerVersion,world:s.world.elements,delta,inverse:s.inverse.elements,readOnly:true,final:false}));
 if(!frameAffineBoundaryCurrent(boundary))throw new DOMException('Affine Save pose changed','AbortError');
 return frameNative.drainCooperatively(frameAffineWholeSnapshotWork(raw,{positions:q.rawPositions,normals:q.rawNormals,indices:q.rawIndices,outsideHashes:q.outsideHashes},s.faceSlots,s.t.aliasGuard,q.outsideCanonical===true),{yieldTask:frameAffineYield});
}
const frameAffineOwnerTokens=new WeakMap(),frameAffineOwnerSnapshots=new WeakMap();
function frameAffineOwnerToken(h){const node=OBJ.get(h);if(!node)return null;let token=frameAffineOwnerTokens.get(node);if(!token)frameAffineOwnerTokens.set(node,token={});return token;}
function frameAffineAttachOwnerSnapshot(snapshot,h){const token=frameAffineOwnerToken(h);if(token)frameAffineOwnerSnapshots.set(snapshot,token);return snapshot;}
function frameAffineRestoreOwnerSnapshot(snapshot,node){const token=frameAffineOwnerSnapshots.get(snapshot);if(token&&node)frameAffineOwnerTokens.set(node,token);}
let frameAffineLifecycleGeneration=0;
const frameAffineOverlaySnapshots=new WeakMap();
function frameAffineWordsEqual(a,b){if(!a||!b||a.byteLength!==b.byteLength||a.constructor!==b.constructor)return false;const aligned=(a.byteOffset|b.byteOffset|a.byteLength)%4===0,View=aligned?Uint32Array:Uint8Array,x=new View(a.buffer,a.byteOffset,a.byteLength/(aligned?4:1)),y=new View(b.buffer,b.byteOffset,b.byteLength/(aligned?4:1));for(let i=0;i<x.length;i++)if(x[i]!==y[i])return false;return true;}
function frameAffineSnapshotMatches(mesh,snapshot){
 const g=mesh?.geometry;if(!g||!snapshot||Object.keys(g.attributes).join(',')!==Object.keys(snapshot.attrs).join(',')||JSON.stringify(g.groups)!==JSON.stringify(snapshot.groups??[])||JSON.stringify(g.drawRange)!==JSON.stringify(snapshot.drawRange??g.drawRange))return false;
 for(const[k,a]of Object.entries(snapshot.attrs)){const actual=g.attributes[k];if(!actual||actual.itemSize!==a.itemSize||actual.normalized!==!!a.normalized||actual.isInterleavedBufferAttribute||!frameAffineWordsEqual(actual.array,a.array))return false;}
 return !!g.index&&g.index.itemSize===1&&frameAffineWordsEqual(g.index.array,snapshot.index);
}
function frameAffineAssertHistory(expected){
 const mesh=expected?.mesh,node=expected?.node;if(!mesh||!node||OBJ.get(expected.h)!==node||pickMeshes.get(expected.h)!==mesh)throw new DOMException('Affine history owner changed','AbortError');
 const snapshots=[expected.bound,expected.canonicalSnapshot,expected.snapshot,expected.fallback].filter(Boolean);if(!snapshots.some(s=>frameAffineSnapshotMatches(mesh,s)))throw new DOMException('Affine history content changed','AbortError');return true;
}
function frameAffineFreezeOverlays(rows){return(rows??[]).map(({o,position,matrix,auto,visible})=>{let attribute=position&&frameAffineOverlaySnapshots.get(position);if(position&&!attribute){attribute=new THREE2.BufferAttribute(position.array.slice(),position.itemSize,position.normalized);frameAffineOverlaySnapshots.set(position,attribute);}return{owner:new WeakRef(o),position:attribute,matrix:matrix.clone(),auto,visible};});}
function frameAffineLiveOverlays(stage){return(stage.overlays??[]).flatMap(row=>{const o=row.owner?.deref?.()??row.o;return o?[{...row,o}]:[];});}
function frameAffineForgetStage(stage,{cancel=false}={}){
 if(frameAffineStages.get(stage.h)===stage)frameAffineStages.delete(stage.h);stage.generation++;
 if(cancel){stage.workerSession?.deref()?.closeWorker?.();stage.rejectSnapshot?.(new DOMException('Affine owner retired','AbortError'));stage.pendingData=null;}
 stage.stamp=null;stage.workerSession=null;stage.resolveSnapshot=stage.rejectSnapshot=null;
}
function frameAffinePruneStages({clear=false}={}){
 if(clear)frameAffineLifecycleGeneration++;
 for(const stage of [...frameAffineStages.values()])if(clear||OBJ.get(stage.h)!==stage.node||pickMeshes.get(stage.h)!==stage.mesh||!frameAffineStampCurrent(stage.stamp))frameAffineForgetStage(stage,{cancel:true});
 if(clear)frameAffineStages.clear();
}
function frameAffinePublicationBusy(){return !!(gizDrag||frameRigidInput||frameRigidExecuting||(typeof framePolySelectionJob!=='undefined'&&framePolySelectionJob));}
function frameAffineSelectionRemap(old,index,entry){
 if(!entry||(!entry.vertices.size&&!entry.edges.size))return null;const oldIndex=old.index?.array;if(!oldIndex||oldIndex.length!==index.length)throw new DOMException('Affine selection face order changed','AbortError');
 const vertices=new Set(),edges=new Set(),key=(a,b)=>a<b?a+':'+b:b+':'+a;
 for(let f=0;f<index.length;f+=3){for(let c=0;c<3;c++)if(entry.vertices.has(oldIndex[f+c]))vertices.add(index[f+c]);for(let c=0;c<3;c++){const n=(c+1)%3;if(entry.edges.has(key(oldIndex[f+c],oldIndex[f+n])))edges.add(key(index[f+c],index[f+n]));}}
 return{vertices,edges};
}
function frameAffineApplyRemap(entry,remap){if(!remap)return;entry.vertices.clear();entry.edges.clear();for(const id of remap.vertices)entry.vertices.add(id);for(const id of remap.edges)entry.edges.add(id);framePolySelectionRevision++;}
function frameAffineCanonicalNow(stage){
 if(stage.canonicalSnapshot)return stage.canonicalSnapshot;const recipe=stage.historyRecipe,data=stage.historyData??stage.pendingData;let raw,source,index,faceSlots,aliasGuard;
 if(recipe?.inherit){const snapshot=frameAffineCanonicalNow(recipe.inherit);stage.canonicalSnapshot=snapshot;stage.historyRecipe=stage.historyData=null;return snapshot;}
 if(recipe){
  raw=recipe.parent?frameAffineCanonicalNow(recipe.parent):recipe.raw;faceSlots=new Int32Array(raw.index.length/3);const ids=new Set();for(let k=0;k<recipe.faces.length;k++){const f=recipe.faces[k];faceSlots[f]=k+1;for(let c=0;c<3;c++)ids.add(raw.index[f*3+c]);}
  const list=Uint32Array.from(ids).sort(),slot=new Int32Array(raw.attrs.position.array.length/3),n=slot.length;source=new Float32Array(raw.attrs.position.array.length+list.length*3);source.set(raw.attrs.position.array);index=Uint32Array.from(raw.index);
  const p=new THREE2.Vector3(),moved=new THREE2.Vector3(),world=new THREE2.Matrix4().fromArray(recipe.world),delta=new THREE2.Matrix4().fromArray(recipe.delta),inverse=new THREE2.Matrix4().fromArray(recipe.inverse);
  for(let k=0;k<list.length;k++){const id=list[k];slot[id]=k+1;p.fromArray(source,id*3);moved.copy(p).applyMatrix4(world).applyMatrix4(delta).applyMatrix4(inverse);p.lerp(moved,1).toArray(source,(n+k)*3);}
  for(const f of recipe.faces)for(let c=0;c<3;c++)index[f*3+c]=n+slot[raw.index[f*3+c]]-1;aliasGuard=recipe.aliasGuard;
 }else if(data){raw=data.raw;source=raw.attrs.position.array.slice();for(let k=0;k<data.ids.length;k++)source.set(data.values.subarray(k*3,k*3+3),data.ids[k]*3);index=Uint32Array.from(raw.index);faceSlots=data.faceSlots;aliasGuard=data.aliasGuard;}
 else throw new DOMException('Affine canonical history recipe missing','AbortError');
 const stock=polygonCreaseData(source,index,CREASE_COS),work=frameAffineWholeSnapshotWork(raw,stock,faceSlots,aliasGuard,false);let step;do{step=work.next();}while(!step.done);const snapshot=step.value;
 snapshot.logicalVersion=stage.logicalVersion;stage.canonicalSnapshot=snapshot;stage.pendingData=stage.historyData=stage.historyRecipe=null;stage.resolveSnapshot?.(snapshot);stage.workerSession?.deref()?.closeWorker?.();return snapshot;
}
function frameAffineEnsureAuthoring(hashes=null){
 const wanted=hashes?new Set(hashes):null,stages=[...frameAffineStages.values()].filter(stage=>!wanted||wanted.has(stage.h));if(!stages.length)return;
 const active=frameRigidInput;if(active?.affine){frameRigidBeforeHistory();}
 for(const stage of stages){if(!frameAffineStageCurrent(stage))throw new DOMException('Affine authoring source changed','AbortError');frameAffineAssertHistory(stage);const snapshot=frameAffineCanonicalNow(stage);frameAffineBind(stage,snapshot,true);frameAffineForgetStage(stage);}
}
function frameAffineBoundary(){
 const active=frameRigidInput?.affine?frameRigidInput:null;
 const released=[...new Set([...(typeof frameRigidQueue==='undefined'?[]:frameRigidQueue),typeof frameRigidExecuting==='undefined'?null:frameRigidExecuting])].filter(s=>s?.released&&!s.cancel&&!s.discarded&&!s.committed);
 return{released,generation:frameAffineLifecycleGeneration,gesture:typeof frameRigidGestureGeneration==='undefined'?null:frameRigidGestureGeneration,input:frameRigidInput,active,revision:active?.affineRevision,source:active?frameAffineSourceStamp(active.t.mesh):null,stages:[...frameAffineStages.values()].filter(frameAffineStageCurrent).map(stage=>({stage,stamp:stage.stamp})),sequence:typeof sceneMutationSequence==='undefined'?null:sceneMutationSequence};
}
function frameAffineBoundaryCurrent(b){
 return !b.released.length&&![...(typeof frameRigidQueue==='undefined'?[]:frameRigidQueue),typeof frameRigidExecuting==='undefined'?null:frameRigidExecuting].some(s=>s?.released&&!s.cancel&&!s.discarded&&!s.committed)&&b.generation===frameAffineLifecycleGeneration&&b.input===frameRigidInput&&b.revision===b.active?.affineRevision&&(!b.active||!b.active.cancel&&!b.active.discarded&&frameAffineStampCurrent(b.source))&&(b.gesture===null||b.gesture===frameRigidGestureGeneration)&&(b.sequence===null||b.sequence===sceneMutationSequence)&&b.stages.every(({stage,stamp})=>frameAffineStages.get(stage.h)===stage&&stage.stamp===stamp&&frameAffineStampCurrent(stamp));
}
function* frameAffineWholeSnapshotWork(raw,stock,faceSlots,aliasGuard,outsideCanonical=false){
 const p=stock.positions,n=stock.normals,index=stock.indices;if(index.length!==raw.index.length)throw Error('Stock affine result changed face count');
 const map=new Int32Array(raw.attrs.position.array.length/3);map.fill(-1);const selected=new Set(),outside=new Set();
 for(let f=0;f<index.length/3;f++){const inside=!!faceSlots[f];for(let c=0;c<3;c++){const at=f*3+c;map[raw.index[at]]=index[at];(inside?selected:outside).add(index[at]);}if((f&2047)===0)yield;}
 let exclusive=true;for(const id of selected)if(outside.has(id)){exclusive=false;break;}
 let wire=null;if(raw.wire){wire=new Uint32Array(raw.wire.length);for(let k=0;k<wire.length;k++){const id=map[raw.wire[k]];if(id<0)throw Error('Affine wire vertex not represented by stock');wire[k]=id;if((k&8191)===0)yield;}}
 const min=new THREE2.Vector3(Infinity,Infinity,Infinity),max=new THREE2.Vector3(-Infinity,-Infinity,-Infinity),v=new THREE2.Vector3();for(let k=0;k<p.length;k+=3){v.fromArray(p,k);min.min(v);max.max(v);if((k&24575)===0)yield;}const center=min.clone().add(max).multiplyScalar(.5);let radius2=0;for(let k=0;k<p.length;k+=3){v.fromArray(p,k);radius2=Math.max(radius2,center.distanceToSquared(v));if((k&24575)===0)yield;}
 return{...raw,attrs:{position:{array:p,itemSize:3,normalized:false},normal:{array:n,itemSize:3,normalized:false}},index,wire,box:new THREE2.Box3(min,max),sphere:new THREE2.Sphere(center,Math.sqrt(radius2)),selectedIDs:Uint32Array.from(selected),aliasGuard,aliasStable:!!raw.aliasStable&&!!outsideCanonical&&exclusive,selectedExclusive:exclusive,outsideCanonical,rawToCanonical:map,outsideHashes:stock.outsideHashes??null,cornerPositionsUnchanged:stock.cornerPositionsUnchanged===true};
}

function* frameAffineMergedSnapshotWork(s,compact){
 const raw=s.beforeRaw,oldP=raw.attrs.position.array,oldN=raw.attrs.normal.array,oldI=raw.index,n=oldP.length/3,count=n-s.t.ids.length+compact.positions.length/3;
 const positions=new Float32Array(count*3),normals=new Float32Array(count*3),indices=new Uint32Array(oldI.length),rawMap=new Int32Array(n),localMap=new Int32Array(compact.positions.length/3),selected=[];rawMap.fill(-1);localMap.fill(-1);let used=0,work=0;
 const add=(array,normal,v,selectedVertex)=>{const id=used++,at=id*3,from=v*3;positions[at]=array[from];positions[at+1]=array[from+1];positions[at+2]=array[from+2];normals[at]=normal[from];normals[at+1]=normal[from+1];normals[at+2]=normal[from+2];if(selectedVertex)selected.push(id);return id;};
 for(let f=0;f<oldI.length/3;f++){const slot=(s.faceSlots??s.r.faceSlots)[f]-1;
  for(let j=0;j<3;j++){const at=f*3+j,old=oldI[at];let id;
   if(slot>=0){const local=compact.indices[slot*3+j];id=localMap[local];if(id<0)localMap[local]=id=add(compact.positions,compact.normals,local,true);rawMap[old]=id;}
   else{id=rawMap[old];if(id<0)rawMap[old]=id=add(oldP,oldN,old,false);}
   indices[at]=id;
  }if((++work&2047)===0)yield;
 }
 let wire=null;if(raw.wire){wire=new Uint32Array(raw.wire.length);for(let k=0;k<wire.length;k++){const id=rawMap[raw.wire[k]];if(id<0)throw Error('Affine wire mapping references an unused source vertex');wire[k]=id;if((k&8191)===0)yield;}}
 const p=used===count?positions:positions.slice(0,used*3),nrm=used===count?normals:normals.slice(0,used*3),min=new THREE2.Vector3(Infinity,Infinity,Infinity),max=new THREE2.Vector3(-Infinity,-Infinity,-Infinity),v=new THREE2.Vector3();
 for(let k=0;k<used;k++){v.fromArray(p,k*3);min.min(v);max.max(v);if((k&8191)===0)yield;}const center=min.clone().add(max).multiplyScalar(.5);let radius2=0;
 for(let k=0;k<used;k++){v.fromArray(p,k*3);radius2=Math.max(radius2,center.distanceToSquared(v));if((k&8191)===0)yield;}
 return{...raw,attrs:{position:{array:p,itemSize:3,normalized:false},normal:{array:nrm,itemSize:3,normalized:false}},index:indices,wire,box:new THREE2.Box3(min,max),sphere:new THREE2.Sphere(center,Math.sqrt(radius2)),selectedIDs:Uint32Array.from(selected),aliasGuard:s.t.aliasGuard,aliasStable:s.t.stableFaceComponent===true};
}
function frameAffineRestoreRawDisplay(s){
 const t=s.t;if(!t?.numeric)return;const positions=s.beforeDisplayRaw??s.beforeRaw?.attrs.position.array;
 if(positions&&positions.length===t.numeric.positions.length)t.numeric.positions.set(positions);else if(t.ids&&s.beforeValues)for(let k=0;k<t.ids.length;k++)t.numeric.positions.set(s.beforeValues.subarray(k*3,k*3+3),t.ids[k]*3);
 const normals=s.beforeRaw?.attrs.normal.array;if(normals&&t.numeric.extras)for(let k=0;k<normals.length/3;k++)t.numeric.extras.set(normals.subarray(k*3,k*3+3),k*9);
 if(s.rawDisplayFullTouched&&t.gpu?.position){t.device.queue.writeBuffer(t.gpu.position,0,t.numeric.positions);if(t.gpu.normal&&t.numeric.extras)t.device.queue.writeBuffer(t.gpu.normal,0,t.numeric.extras);}
 if(t.adapter){t.adapter.positionView=t.adapter.normalView=null;t.adapter.revision++;}
}
function frameAffineAbortAll(reason){
 const error=new DOMException('Affine owner retired: '+reason,'AbortError'),sessions=new Set([...frameRigidQueue,frameRigidInput,frameRigidExecuting,frameRigidPrepared?.affine?.active].filter(Boolean));
 for(const s of sessions)if(s.affine||s.worker){frameAffineCleanup(()=>frameAffineCancelSession(s));frameAffineCleanup(()=>s.closeWorker?.(error));frameAffineCleanup(()=>s.rejectSnapshot?.(error));frameAffineCleanup(()=>s.abortResolve?.(false));}
}
function frameAffineCleanup(work){try{work();}catch(error){frameAffineNotes.errors.push('Affine cleanup: '+String(error));}}
async function frameAffineRepairStage(stage){
 if(stage.canonicalSnapshot)return stage.canonicalSnapshot;if(stage.repairPromise)return stage.repairPromise;
 stage.repairPromise=Promise.resolve().then(()=>{
  if(!frameAffineStageCurrent(stage))throw new DOMException('Affine repair source changed','AbortError');frameAffineAssertHistory(stage);
  const snapshot=frameAffineCanonicalNow(stage);stage.error=null;stage.promise=Promise.resolve(snapshot);frameAffineAdopt(stage);return snapshot;
 }).catch(error=>{stage.error=error;throw error;}).finally(()=>{stage.repairPromise=null;});stage.repairPromise.catch(()=>{});return stage.repairPromise;
}
function frameAffineCreateWorkerPipe(r,raw,faceIDs,baseVersion=0){
 const worker=frameNative.createAffineCornerWorker(),pending=new Map(),pipe={worker,pending,serial:0,ownerVersion:++frameAffineSerial,closed:false};
 pipe.close=(reason=new DOMException('Affine canonical owner retired','AbortError'))=>{if(pipe.closed)return;pipe.closed=true;for(const p of pending.values())p.reject(reason);pending.clear();worker.terminate();};
 pipe.call=(lease,message,transfer=[])=>new Promise((resolve,reject)=>{if(pipe.closed||lease?.workerClosed){reject(new DOMException('Affine worker lease retired','AbortError'));return;}const id=++pipe.serial;pending.set(id,{resolve,reject,lease});try{worker.postMessage({id,...message},transfer);}catch(error){pending.delete(id);reject(error);}});
 pipe.cancel=(lease,reason)=>{for(const[id,p]of pending)if(p.lease===lease){pending.delete(id);p.reject(reason);}};
 worker.onmessage=({data:m})=>{const p=pending.get(m.id);if(!p)return;pending.delete(m.id);if(m.ownerVersion===pipe.ownerVersion){if(m.kind==='canonical-prepared'&&m.version===baseVersion)pipe.confirmedVersion=m.version;else if(m.kind==='canonical-posed'&&m.committed&&m.baseVersion===pipe.confirmedVersion&&m.version===m.baseVersion+1)pipe.confirmedVersion=m.version;}m.kind==='error'?p.reject(Error(m.error)):p.resolve(m);};
 worker.onerror=e=>{pipe.close(Error(e.message));};
 let rejectClosed;const closed=new Promise((_,reject)=>rejectClosed=reject);closed.catch(()=>{});const close=pipe.close;pipe.close=reason=>{rejectClosed(reason??new DOMException('Affine canonical owner retired','AbortError'));close(reason);};pipe.ready=Promise.race([Promise.resolve(raw),closed]).then(value=>{const positions=value.attrs.position.array.slice(),normals=value.attrs.normal.array.slice(),indices=Uint32Array.from(value.index),faces=faceIDs.slice();return pipe.call(null,{kind:'canonical-prepare',positions,normals,indices,faceIDs:faces,version:baseVersion,ownerVersion:pipe.ownerVersion,creaseCos:CREASE_COS},[positions.buffer,normals.buffer,indices.buffer,faces.buffer]);});pipe.ready.catch(()=>{});r.workerPipe=pipe;return pipe;
}
function frameAffineBindingStamp(r,mesh){const stamp=frameAffineSourceStamp(mesh);delete stamp.mesh;Object.defineProperty(stamp,'mesh',{get:()=>r.meshRef.deref()});r.stamp=stamp;return stamp;}
function frameAffineBindingCurrent(r){
 if(!r?.live)return false;if(!r.managed)return frameRigidSource(r.active?.t??r.t);
 const mesh=r.meshRef.deref(),node=OBJ.get(r.h),entry=polySelection.items.get(r.h);
 return !!mesh&&pickMeshes.get(r.h)===mesh&&frameAffineOwnerToken(r.h)===r.ownerToken&&node&&frameRigidOwnerCurrent(r.owner)&&frameAffineStampCurrent(r.stamp)&&entry===r.entry&&entry.faces===r.faces&&entry.vertices===r.vertices&&entry.edges===r.edges&&polySelection.items.size===1&&polyElementMode==='face'&&polyFocusActive()&&framePolySelectionRevision===r.selectionRevision&&!entry.vertices.size&&!entry.edges.size&&frameRigidSetSnapshotsCurrent(r.selectionSets);
}
function frameAffineTouchBinding(t){const r=t?.affine;if(r?.managed&&r.live&&r.meshRef.deref()===t.mesh&&t.mesh.geometry===t.g)frameAffineBindingStamp(r,t.mesh);}
function frameAffineRetireBinding(r){
 if(!r?.live)return;r.live=false;const mesh=r.meshRef?.deref(),s=r.active,error=new DOMException('Affine display owner retired','AbortError');
 frameAffineCleanup(()=>s?.closeWorker?.(error));frameAffineCleanup(()=>s?.rejectSnapshot?.(error));frameAffineCleanup(()=>r.workerPipe?.close(error));for(const resource of[r.display,r.gpu])frameAffineCleanup(()=>resource?.dispose());
 if(mesh&&frameAffineBindings.get(mesh)===r)frameAffineBindings.delete(mesh);frameAffineBindingRecords.delete(r);r.display=r.gpu=r.numeric=r.fullNumeric=r.active=r.t=r.stamp=null;r.initialRaw=r.physicalRaw=r.canonicalSnapshot=r.rawDisplayBaseline=r.workerPipe=r.bindDisplay=null;r.faceSlots=r.localIndex=r.faceIDs=null;
}
function frameAffinePruneBindings({clear=false}={}){for(const r of[...frameAffineBindingRecords])if(clear||!frameAffineBindingCurrent(r))frameAffineRetireBinding(r);}
function frameAffinePrepareEarly(t){
 if(!frameAffineEligible(t))return null;let r=frameAffineBindings.get(t.mesh);
 if(r&&!frameAffineBindingCurrent(r)){frameAffineRetireBinding(r);r=null;}
 if(r){t.affine=r;return r.promise;}
 const began=performance.now(),faceIDs=t.faceIDs.slice().sort(),faceSlots=new Int32Array(t.ia.length/3),positions=new Float32Array(faceIDs.length*9),extras=new Float32Array(faceIDs.length*27);
 r={managed:true,h:t.h,meshRef:new WeakRef(t.mesh),ownerToken:frameAffineOwnerToken(t.h),owner:frameRigidOwnerSnapshot(),entry:t.entry,faces:t.faces,vertices:t.vertices,edges:t.edges,selectionSets:t.selectionSets,selectionRevision:t.selectionRevision,live:true,displayEnabled:false,revision:0,logicalVersion:0,canonicalVersion:0,active:null,display:null,gpu:null,numeric:null,faceIDs,faceSlots,ready:false};frameAffineBindingStamp(r,t.mesh);frameAffineBindings.set(t.mesh,r);frameAffineBindingRecords.add(r);t.affine=r;
 r.promise=(async()=>{
  for(let k=0;k<faceIDs.length;k++){const f=faceIDs[k];faceSlots[f]=k+1;for(let c=0;c<3;c++){const at=k*3+c,id=t.ia[f*3+c];positions.set(t.pa.subarray(id*3,id*3+3),at*3);extras.set(t.na.subarray(id*3,id*3+3),at*9);extras[at*9+5]=extras[at*9+6]=extras[at*9+7]=extras[at*9+8]=1;}if((k&2047)===0){await frameAffineYield();if(!frameAffineBindingCurrent(r))throw new DOMException('Affine early selection changed','AbortError');}}
  r.numeric={source:r,positions,extras,indices:null,vertexCount:faceIDs.length*3,hasNormals:true,hasUV:false,hasColors:false,lineIndices:new Map()};
  const gpu=await frameNative.GpuAffineCornerPreview.create({device:r.owner.device,pool:r.owner.pool,positions,extras,ids:Uint32Array.from({length:faceIDs.length*3},(_,i)=>i),isCurrent:()=>frameAffineBindingCurrent(r)});
  if(!frameAffineBindingCurrent(r)){gpu.dispose();throw new DOMException('Affine early GPU owner changed','AbortError');}r.gpu=gpu;
  const mesh=r.meshRef.deref();r.display=frameNative.registerAffineDisplayOverride(mesh,{faceSlots,fullGeometry:()=>r.fullNumeric??null,selectedGeometry:()=>{const revision=r.revision;return{...r.numeric,isCurrent:()=>r.live&&r.displayEnabled&&r.revision===revision&&frameAffineBindingCurrent(r)};},isCurrent:()=>r.displayEnabled&&frameAffineBindingCurrent(r)});
  r.ready=true;frameAffineNotes.prepared++;frameAffineNotes.phases.push({name:'affine-early-display-ready',ms:performance.now()-began,faces:faceIDs.length,corners:faceIDs.length*3});scheduleRender();return r;
 })().catch(error=>{frameAffineRetireBinding(r);throw error;});r.promise.catch(()=>{});return r.promise;
}
function frameAffineStartPreview(s){
 const r=s.t.affine;if(!r?.gpu||!r.live||s.previewReady||s.cancel||s.discarded)return false;
 s.boundsCaptured=true;s.beforeBounds=s.t.bounds?{min:s.t.bounds.min.clone(),max:s.t.bounds.max.clone(),world:s.t.boundsWorld?.clone()??s.world.clone()}:null;s.r=r;s.faceIDs=r.faceIDs;s.faceSlots=r.faceSlots;s.affineID=++frameAffineSerial;s.affineRevision=0;s.affineDirty=s.affineRunning=s.affineEnded=false;s.previewReady=true;s.beforeDisplayEnabled=r.displayEnabled;s.beforeFullNumeric=r.fullNumeric;r.bindDisplay=null;s.beforeRawDisplayBaseline=r.rawDisplayBaseline;s.overlays=frameRigidCaptureOverlays();r.displayEnabled=true;r.fullNumeric=null;r.active=s;r.gpu.gathered=false;r.revision++;frameAffineNotes.starts++;return true;
}
function frameAffineAwaitPreview(s){const r=s.t.affine;if(!r)return;if(r.ready){frameAffineStartPreview(s);return;}r.promise.then(()=>{if(!s.cancel&&!s.discarded&&frameRigidTransactionCurrent(s)){frameAffineStartPreview(s);if(s.previewReady)frameAffineSubmit(s);}}).catch(error=>{if(error.name!=='AbortError')frameAffineNotes.errors.push(String(error));});}
function frameAffineBindingTransfer(r,mesh,snapshot,keepWorker){
 if(!r?.live)return;if(!keepWorker){frameAffineCleanup(()=>r.workerPipe?.close());r.workerPipe=null;r.logicalVersion=r.canonicalVersion=0;r.initialRaw=snapshot;}else{r.canonicalVersion=r.logicalVersion=snapshot.logicalVersion??r.logicalVersion;r.canonicalSnapshot=snapshot;}
 r.physicalRaw=snapshot;r.rawDisplayBaseline=null;r.fullNumeric=null;r.bindDisplay=null;r.active=null;r.revision++;frameAffineBindingStamp(r,mesh);
 if(keepWorker&&r.lastPublishedSnapshot===snapshot)return;const p=r.numeric.positions,x=r.numeric.extras;for(let k=0;k<r.faceIDs.length;k++)for(let c=0;c<3;c++){const id=snapshot.index[r.faceIDs[k]*3+c],at=k*3+c;p.set(snapshot.attrs.position.array.subarray(id*3,id*3+3),at*3);x.set(snapshot.attrs.normal.array.subarray(id*3,id*3+3),at*9);}r.gpu.writeAuthoringRanges([[0,r.faceIDs.length*3]]);
}
function frameAffineSeedBindDisplay(r,mesh,snapshot,g,wire){
 const d=r.bindDisplay;if(!d||d.snapshot!==snapshot||r.lastPublishedSnapshot!==snapshot||!r.live||frameAffineBindings.get(mesh)!==r||!r.owner||!frameRigidOwnerCurrent(r.owner)||typeof frameNative.stampAttribute!=='function'||typeof frameNative.attributeCurrent!=='function')return false;
 const p=g.attributes.position,n=g.attributes.normal,ix=g.index;if(Object.keys(g.attributes).length!==2||p?.itemSize!==3||n?.itemSize!==3||p.normalized||n.normalized||d.positions.length!==p.array.length||d.extras.length!==p.count*9)return false;
 const stamp=frameAffineSourceStamp(mesh),cache=r.owner.engine.geometryCache,attrs=[p,n,g.attributes.uv,g.attributes.color,ix],row={source:g,positions:d.positions,extras:d.extras,indices:ix.array,vertexCount:p.count,hasNormals:true,hasUV:false,hasColors:false,stamps:attrs.map(frameNative.stampAttribute),lineIndices:new Map(),isCurrent:()=>frameRigidOwnerCurrent(r.owner)&&frameAffineStampCurrent(stamp)};cache.rows.set(g,row);
 if(wire&&wire.attributes.position===p&&Object.keys(wire.attributes).length===1&&wire.index?.array===snapshot.wire&&d.wireExtras?.length===p.count*9){const wi=wire.index,wa=[p,null,null,null,wi],ws=wa.map(frameNative.stampAttribute),wr={source:wire,positions:d.positions,extras:d.wireExtras,indices:wi.array,vertexCount:p.count,hasNormals:false,hasUV:false,hasColors:false,stamps:ws,lineIndices:new Map(),isCurrent:()=>row.isCurrent()&&[wire.attributes.position,wire.attributes.normal,wire.attributes.uv,wire.attributes.color,wire.index].every((a,i)=>frameNative.attributeCurrent(a,ws[i]))};cache.rows.set(wire,wr);}
 return true;
}
