// Prepare authored edge selection and exact gizmo/CM measurements privately.
// Reuse the existing topology aliases; avoid materializing every logical edge.
var frameNativeEdgeCM=null;
function frameCurrentNativeEdgeCM(){
 const q=frameNativeEdgeCM;if(!q)return null;if(!q.current()){frameNativeEdgeCM=null;return null;}return q;
}
function frameRememberNativeEdgeCM(result){
 frameNativeEdgeCM=null;const m=result.nativeEdgeCM?result.measurements:null;if(!m?.selectedIDs)return;
 const revision=framePolySelectionRevision,items=polySelection.items,coordinate=coordMode,pivot=polyPivotMatrix,exact=polyExactEdgeVertices,mode=polyElementMode,poly=polyMode,focus=componentFocus,tool=vertexTools.mode,armed=componentModeArmed,soft=vertexTools.soft.active,uv=uvEdit,owners=[...selNodes];
 const token=sceneStateToken,mutation=sceneMutationSequence,animation=frameAnimationRevision,time=frameEvaluatedTime,rows=[],ids=new Map();let values=0;
 const ordered=(set,array)=>{if(!set)return false;const size=set.size??set.length;if(size!==undefined&&size!==array.length)return false;let i=0;for(const v of set)if(i>=array.length||!Object.is(v,array[i++]))return false;return i===array.length;};
 const equal=(a,b)=>a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const layout=a=>a&&[a.itemSize,a.normalized,a.data,a.offset,a.data?.stride];
 for(const [h,s]of items){
  const mesh=pickMeshes.get(h),g=mesh?.geometry,p=g?.attributes.position,index=g?.index;if(!p)continue;mesh.updateMatrixWorld(true);
  const exactSet=exact?.get(h),selectedSet=m.selectedIDs.get(h)??new Set();values+=s.vertices.size+s.edges.size+s.faces.size+(selectedSet.size??selectedSet.length)+(exactSet?.size??exactSet?.length??0);
  // This is a count bound on one selection receipt, not an allocator/heap cap.
  if(values>250000)return;
  const snapshots={};for(const key of ['vertices','edges','faces'])snapshots[key]=[...s[key]];
  const exactValues=exactSet?[...exactSet]:null,selected=[...selectedSet];ids.set(h,selected);rows.push({h,s,snapshots,exactSet,exactValues,mesh,g,p,index,pa:p.array??p.data?.array,ia:index?.array??index?.data?.array,pv:p.version??p.data?.version,iv:index?.version??index?.data?.version,pc:p.count,ic:index?.count,pl:layout(p),il:layout(index),matrix:mesh.matrixWorld.elements.slice()});
 }
 const keys=[...items.keys()];
 const current=()=>revision===framePolySelectionRevision&&items===polySelection.items&&coordinate===coordMode&&pivot===polyPivotMatrix&&exact===polyExactEdgeVertices&&mode===polyElementMode&&poly===polyMode&&focus===componentFocus&&tool===vertexTools.mode&&armed===componentModeArmed&&soft===vertexTools.soft.active&&uv===uvEdit&&polyFocusActive()&&!splineFocusActive()&&token===sceneStateToken&&mutation===sceneMutationSequence&&animation===frameAnimationRevision&&Object.is(time,frameEvaluatedTime)&&ordered(selNodes,owners)&&ordered(items.keys(),keys)&&rows.every(r=>{
  r.mesh.updateMatrixWorld(true);return pickMeshes.get(r.h)===r.mesh&&r.mesh.geometry===r.g&&r.g.attributes.position===r.p&&r.g.index===r.index&&(r.p.array??r.p.data?.array)===r.pa&&(r.index?.array??r.index?.data?.array)===r.ia&&(r.p.version??r.p.data?.version)===r.pv&&(r.index?.version??r.index?.data?.version)===r.iv&&r.p.count===r.pc&&r.index?.count===r.ic&&equal(layout(r.p),r.pl)&&(!r.il||equal(layout(r.index),r.il))&&equal(r.matrix,r.mesh.matrixWorld.elements)&&items.get(r.h)===r.s&&['vertices','edges','faces'].every(k=>ordered(r.s[k],r.snapshots[k]))&&exact?.get(r.h)===r.exactSet&&(!r.exactValues||ordered(r.exactSet,r.exactValues));
 });
 // Keep numerical values private; callers receive clones, never this receipt.
 frameNativeEdgeCM={current,bounds:{min:m.bounds.min.clone(),max:m.bounds.max.clone()},frame:m.frame.clone(),extent:m.extent.clone(),selectedIDs:ids};
}
function* frameSelectedLogicalEdgeRepresentativesWork(geometry,topology,selected){
 const pos=geometry.attributes.position,index=geometry.index,n=pos.count,group=topology.group,corners=topology.edgeFirstCorners,count=index?index.count:pos.count;
 if(topology.vertexCount!==n||!(group instanceof Uint32Array)||group.length!==n||!(corners instanceof Uint32Array)||corners.length!==topology.edges.length/2)throw Error('Exact native authored edge-corner metadata required');
 const byCorner=new Map();let work=0;
 for(const key of selected){
  const [x,y]=key.split(':').map(Number);
  // Legacy logicalEdges().filter matches only the canonical authored raw key.
  if(Number.isSafeInteger(x)&&x>=0&&x<n&&Number.isSafeInteger(y)&&y>=0&&y<n&&polyEdgeKey(x,y)===key){
   const edge=frameNative.edgeIdFromRaw(topology,x,y);
   if(edge>=0){
    const corner=corners[edge],j=corner%3,f=corner-j;if(f+2>=count)throw Error('Authored edge corner outside source');
    const a=index?index.getX(corner):corner,b=index?index.getX(f+(j+1)%3):f+(j+1)%3;
    if(!Number.isInteger(a)||a<0||a>=n||!Number.isInteger(b)||b<0||b>=n||Math.min(group[a],group[b])!==Math.min(group[x],group[y])||Math.max(group[a],group[b])!==Math.max(group[x],group[y]))throw Error('Authored edge corner logical source mismatch');
    if(!byCorner.has(corner))byCorner.set(corner,{a,b,corner});
   }
  }
  if((++work&1023)===0)yield;
 }
 let ordered=[];for(const edge of byCorner.values()){ordered.push(edge);if((++work&1023)===0)yield;}
 // Cooperative stable merge order: preserve authored discovery order without
 // an unbounded synchronous Array.sort on a large selected edge set.
 let scratch=new Array(ordered.length);
 for(let width=1;width<ordered.length;width*=2){
  for(let start=0;start<ordered.length;start+=width*2){
   const mid=Math.min(start+width,ordered.length),end=Math.min(start+width*2,ordered.length);let a=start,b=mid,out=start;
   while(a<mid||b<end){scratch[out++]=b>=end||a<mid&&ordered[a].corner<=ordered[b].corner?ordered[a++]:ordered[b++];if((++work&1023)===0)yield;}
  }
  const swap=ordered;ordered=scratch;scratch=swap;
 }
 return ordered;
}
function* frameNativeEdgeSelectedVertexIdsWork(h,items,ready,exact=polyExactEdgeVertices){
 const s=items.get(h),mesh=pickMeshes.get(h),g=mesh?.geometry,out=new Set();let work=0;
 if(!s||!g)return out;
 if(exact?.has(h)){for(const i of exact.get(h)){out.add(i);if((++work&1023)===0)yield;}return out;}
 for(const i of s.vertices){out.add(i);if((++work&1023)===0)yield;}
 if(!s.edges.size&&!s.faces.size)return out;
 const topology=ready.get(h)?.topology,selection=topology?.selection,labels=selection?.vertexGroups,aliases=selection?.vertexAliases,idx=g.index,expanded=new Set();
 if(!selection||topology.vertexCount!==g.attributes.position.count||!(labels instanceof Uint32Array)||!aliases)throw Error('Exact native CM aliases required');
 function* addGroup(i){
  const logical=labels[i];if(logical===undefined){out.add(i);return;}if(expanded.has(logical))return;expanded.add(logical);
  for(let k=aliases.offsets[logical];k<aliases.offsets[logical+1];k++){out.add(aliases.members[k]);if((++work&1023)===0)yield;}
 }
 for(const key of s.edges){const [a,b]=key.split(':').map(Number);yield* addGroup(a);yield* addGroup(b);if((++work&1023)===0)yield;}
 for(const fi of s.faces){for(let j=0;j<3;j++)yield* addGroup(idx?idx.getX(fi*3+j):fi*3+j);if((++work&1023)===0)yield;}
 return out;
}
function frameAwaitEdgeClickTopology(geometry,signal){
 if(signal.aborted)return Promise.reject(new DOMException('Edge CM preparation cancelled','AbortError'));
 const pending=frameGetNativeTopologyCache().get(geometry);
 return new Promise((resolve,reject)=>{
  let settled=false;const finish=(fn,value)=>{if(settled)return;settled=true;signal.removeEventListener('abort',cancel);fn(value);},cancel=()=>finish(reject,new DOMException('Edge CM preparation cancelled','AbortError'));
  signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
  Promise.resolve(pending).then(value=>finish(resolve,value),error=>finish(reject,error));
 });
}
async function framePrepareNativeEdgeClick(hit,cx,cy,mode,vi,preparedState=null){
 if(!hit)return null;const h=hit.h;
 if(!h||!selNodes.has(h)||!isVertexEditableMesh(h))return h;
 // Soft/UV/spline paths retain their established editing behavior.
 if(!componentModeArmed||!polyFocusActive()||splineFocusActive()||uvEdit||vertexTools.soft.active)return frameNativeCommitClick(()=>polyClickPick(cx,cy,mode,{hit,legacyCommit:true}));
 if(!['replace','add','invert'].includes(mode))throw Error('Unknown native edge selection mode');
 frameCancelPolySelectionWork();const controller=new AbortController(),tasks=frameNative.createYieldQueue(),sourceCurrent=frameSelectionSourceGuard(vi),coordinate=coordMode,exact=polyExactEdgeVertices,pivot=polyPivotMatrix,ready=new Map();let closed=false;
 const valid=()=>!closed&&!controller.signal.aborted&&coordinate===coordMode&&exact===polyExactEdgeVertices&&pivot===polyPivotMatrix&&sourceCurrent()&&(!hit.isCurrent||hit.isCurrent())&&[...ready.values()].every(r=>r.isCurrent());
 const cancel=()=>controller.abort(),key=e=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();cancel();}else checkAfterInput();};
 const checkAfterInput=()=>queueMicrotask(()=>{if(!closed&&!valid())cancel();});
 const events=['pointerdown','pointermove','pointerup','pointercancel','wheel'];
 const cleanup=()=>{for(const type of events)removeEventListener(type,checkAfterInput,true);removeEventListener('keydown',key,true);removeEventListener('blur',cancel);removeEventListener('resize',cancel);tasks.dispose();if(framePolySelectionJob===job)framePolySelectionJob=null;};
 const job={kind:'native-edge-click',cancel,promise:null};framePolySelectionJob=job;
 for(const type of events)addEventListener(type,checkAfterInput,{capture:true,passive:true});addEventListener('keydown',key,true);addEventListener('blur',cancel);addEventListener('resize',cancel);
 const drain=work=>frameNative.drainCooperatively(work,{signal:controller.signal,isCurrent:valid,yieldTask:()=>tasks.yield()});
 job.promise=(async()=>{
  try{
   if(!valid())throw new DOMException('Native edge selection source changed','AbortError');
   const items=mode==='replace'?new Map():await drain(frameCopyPolySelection(polySelection.items));
   let item=items.get(h);if(!item)items.set(h,item={vertices:new Set(),edges:new Set(),faces:new Set()});
   await drain((function*(){let on=false,work=0;for(const k of hit.keys){if(item.edges.has(k))on=true;if((++work&1023)===0)yield;}for(const k of hit.keys){mode==='invert'&&on?item.edges.delete(k):item.edges.add(k);if((++work&1023)===0)yield;}})());
   // Preserve the existing edge-click removal rule, including mixed selections.
   if(!item.edges.size)items.delete(h);
   for(const [owner]of items){const geometry=pickMeshes.get(owner)?.geometry;if(!geometry?.attributes.position)continue;const r=await frameAwaitEdgeClickTopology(geometry,controller.signal);ready.set(owner,r);if(!valid())throw new DOMException('Native CM topology source changed','AbortError');}
   const buffers=await drain(framePolySelectionBuffers(items)),measurements=await drain(frameNativeEdgeClickMeasurementsWork(items,ready,exact));
   if(!valid())throw new DOMException('Native edge selection changed before publication','AbortError');
   frameNativeCommitClick(()=>{frameApplyPreparedPolySelection({items,buffers,measurements,nativeEdgeCM:true});frameRecordNativeComponentClick(h,hit.keys.slice(),cx,cy);});if(preparedState){const post=frameSelectionSourceGuard(vi),picker=frameNativePickerGuard(vi,'click'),receipt=frameNativeEdgeCM,postPivot=polyPivotMatrix;preparedState.measurements=measurements;preparedState.resumeCurrent=()=>postPivot===polyPivotMatrix&&post()&&picker()&&(!receipt||receipt.current());}return h;
  }finally{closed=true;cleanup();}
 })();return await job.promise;
}
