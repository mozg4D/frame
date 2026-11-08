import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {fragment} from '../../../tests/scene-data-runtime.mjs';

// Execute current-core history dispatch, frame restoration and authoring restore.
// DOM/rendering and snapshot capture are narrow
// CPU adapters. commit models checkpoint changed(); authoring-preview binds this
// effect to the extracted real checkpoint with no-op/batch and mutation controls.
// This proves the identity distinction, not native browser history,
// GPU execution, full HASH IO or successful numerical publication.
const core=await readFile(new URL('../../../index.html',import.meta.url),'utf8');
const section=(start,end)=>{assert.equal(core.split(start).length,2,`Unique history contract: ${start}`);const a=core.indexOf(start),b=core.indexOf(end,a);assert.ok(b>a,`Missing history contract end: ${end}`);return core.slice(a,b);};
const line=start=>section(start,'\n');
const sources=[
 fragment('function createFrameHashCodec(){','const FrameHash=createFrameHashCodec();'),
 fragment('function nativeRecord(id,type,value){'),
 fragment('function nativePut(map,id,field,type,value){'),
 fragment('const FrameAuthorData=','const FrameDocumentation='),
 section('    async function undoEdit(){','\n    async function redoEdit(){'),
 section('    function restoreFrames(snapshot,notify=true,opposite=null){','\n    function frameSnapshotsEqual('),
 line('function restore(value){FrameAuthorData.reset();'),
 line('async function frameUndoUI(back){')
].join('\n');
export function historyFixture(initialNodes,onRestored=()=>{}){
 return new Function('initialNodes','onRestored','crypto',`
  let nodes=initialNodes,frameUITransaction=0,selected=new Set(),focusId,selectedTag,selectedTags=new Set(),anchorTag,activeMaterial=0,selectedMaterials=new Set(),frameChannels=new Map(),frameChannelSelection=[],timelineFrame=0,timelineTotal=120;
  const materials=[{}],textureImages=new Map(),materialThumbnails=new Map(),FramePluginRecords={},FrameMorph={restoreEditor(){},request(){}};
  const noop=()=>{},frameSerializeChannels=()=>[],frameRestoreChannels=noop,frameIsPLAPath=()=>false,frameTarget=()=>true,renderMaterials=noop,render=noop,syncMaterial=noop,frameEvaluateAnimation=noop,frameRefreshAnimationUI=noop,frameSelectEngineObjects=noop,frameTrimUIUndo=noop;
  const FramePlugins={dispatch:event=>{events.push(event);if(event==='restored')onRestored();}},events=[],$=()=>({dataset:{elementMode:'object'}});
  let editDrag=null,gizmoSession=null,editFinishing=false,undoBusy=false,coreNumeric=null,undoGPU=null,appearanceRestorePin=null;
  const button={disabled:false},undoRAM=[],metaUndo=[],metaRedo=[],undoStack=[],redoStack=[],frameUIUndoSequence=[],frameUIRedoSequence=[];
  const window={frameHistorySequence:back=>(back?frameUIUndoSequence:frameUIRedoSequence).at(-1)||0,dispatchEvent:event=>events.push(event.type)},CustomEvent=function(type){this.type=type;};
  const document={getElementById:()=>({textContent:''})},scene={records:new Map()},FrameHash=createFrameHashCodec();
  let poseRecordCache=null,displayUnitIndex=0,rescaleUnitIndex=0,componentPivot=null,selectionBox=null;
  const units=['mm'],selectionScope='objects',objectSelection=[],splineDisplays=new Map();
  const syncPoseWorld=()=>false,syncReplicas=()=>false,unionSelectionBounds=()=>null,nodeBounds=()=>null,notifyTransformUI=noop,draw=noop;
  const poseObjects=()=>nodes.map(n=>({hash:n.nativeHash,parent:null}));
  const commit=fn=>{fn();FrameAuthorData.changed();},frameSyncEngineVisibility=noop,definitions={};
  let sceneFrameDirty=false;const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
  const snapshot=()=>JSON.stringify({authorData:FrameAuthorData.root(),nodes,selection:[...selected],selectedTags:[...selectedTags],selectedMaterials:[...selectedMaterials]});
  ${sources}
  ${line('      FrameAuthorData.attach(()=>{')}
  FrameAuthorData.installed();
  return {authorData:FrameAuthorData,undo:undoEdit,get nodes(){return nodes;},events,
   frame:hash=>scene.records.get(FrameHash.address(hash,'matrix'))?.value,
   setFrame:(hash,value)=>nativePut(scene.records,hash,'matrix',FrameHash.T.float64,value.slice()),
   frames:()=>({records:new Map(nodes.map(n=>[n.nativeHash,{matrix:scene.records.get(FrameHash.address(n.nativeHash,'matrix'))?.value?.slice()}])),units:[0,0],componentPivot:null}),
   pushFrame:(before,after)=>metaUndo.push({before,after,sequence:1}),
   snapshot,pushDocument:before=>{undoStack.push(before);frameUIUndoSequence.push(2);},
   get documentUndo(){return undoStack.length;},
   deleteOwner:hash=>{undoStack.push(snapshot());frameUIUndoSequence.push(2);const id=nodes.find(n=>n.nativeHash===hash)?.id;nodes=nodes.filter(n=>n.nativeHash!==hash&&n.parent!==id);},
   get frameRedo(){return metaRedo.length;},get documentRedo(){return redoStack.length;}};
 `)(initialNodes,onRestored,webcrypto);
}
