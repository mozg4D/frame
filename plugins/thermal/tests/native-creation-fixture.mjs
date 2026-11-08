import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {fragment} from '../../../tests/scene-data-runtime.mjs';

// CPU source-contract fixture, not browser/Undo-stack/render verification. Execute the core's
// actual create -> visibility sync -> native sync -> native record installation,
// bridge, selection/API serial queues and affine/frame readers/edits/restores.
// UI/GPU/animation endpoints, helper bounds, checkpoint storage, API validation
// and settling are adapters. Native HASH addressing and author-data persistence/CAS
// use the shipped codec and data core. The checkpoint adapter models changed()
// for fixture commits; authoring-preview executes the actual checkpoint with no-op,
// batch and mutation controls to bind that effect. No full Undo-stack claim;
// never translate n.transform into matrices.
export const core=await readFile(new URL('../../../index.html',import.meta.url),'utf8');
export const manifest=JSON.parse(await readFile(new URL('../plugin.json',import.meta.url),'utf8'));
const section=(start,end)=>{const a=core.indexOf(start),b=core.indexOf(end,a);assert.ok(a>=0&&b>a,`Missing native contract: ${start}`);return core.slice(a,b);};
const line=start=>{const a=core.indexOf(start),b=core.indexOf('\n',a);assert.ok(a>=0&&b>a,`Missing native contract: ${start}`);return core.slice(a,b);};
const affine=section('const FM=(()=>{','\n\n    const POSE_WGSL');
export const math=new Function(affine+';return FM;')();
const sources=[
 fragment('const FrameAuthorData=','const FrameDocumentation='),
 fragment('function createFrameHashCodec(){','const FrameHash=createFrameHashCodec();'),
 line('function frameAuthoring(n){'),
 line('function frameValidateAuthoring(text){'),
 section('function frameSelectEngineObjects(flash=true){','\nfunction frameSyncEngineVisibility(){'),
 section('    function applyObjectSelection(indices,options={}){','\n    function setVisibility('),
 line('    function editError(error){'),
 line('    function selectedRoots(){'),
 line('    function objectDescendants(h,objects=poseObjects()){'),
 line('    function objectPivot(h){'),
 line('    function freezePivots(hashes){'),
 section('    function applyObjectDelta(delta,before,roots=selectedRoots(),editPivot=pivotEditing){','\n    function poseRay('),
 line('    function transformedBox(box,m){'),
 line('    function unionSelectionBounds(boxes){'),
 line('    function snapshotFrames(){'),
 section('    function restoreFrames(snapshot,notify=true,opposite=null){','\n    function frameSnapshotsEqual('),
 line('function commit(action, refresh=true){'),
 section('      function enqueueCommand(run,{documentation=null,bridge=false}={}){','      frameNativeFileTask='),
 line('      async function call(name,args={},bridgeGuard=null,sessionGuard=null){'),
 affine,
 line('const defaults = fields =>'),
 line('  function owner(n){return types.get(n?.type);}'),
 section('function hardwareName(n){','\nfunction demo()'),
 section('  function bridge(entry){','\nlet creating='),
 section('function frameSyncEngineVisibility(){','\n\n// SLP1:'),
 section('    function nativeRecord(id,type,value){','\n    function deformationRevision('),
 section('    function syncNativeObjects(objects){','\n    function nativeCamera()'),
 ...['nativeValue(h,field)','poseObjects()','objectLocal(h)','transformParent(h,parent=nativeValue(h,\'parent\')?.[0])'].map(name=>line('    function '+name+'{')),
 section('    function objectWorld(h,seen=new Set()){','\n    function '),
 line('    function putFrame(h,field,m){')
].join('\n');

export function nativeCreationFixture(){
 return new Function('manifest','crypto','CustomEvent',`
  const nodes=[],definitions=Object.fromEntries(manifest.objects.map(o=>[o.type,[o.name,'plugin:'+manifest.id,o.fields]]));
  const entry={manifest},types=new Map(manifest.objects.map(o=>[o.type,entry]));
  let serial=0,transactions=0,selected=new Set(),focusId,anchorId,selectedTag,selectedTags=new Set(),selectionArea;
  const node=id=>nodes.find(n=>n.id===id),FramePlugins={owner:n=>types.get(n?.type),dispatch:(method,...args)=>entry.editor?.[method]?.(...args)||null};
  const FrameHash=createFrameHashCodec();
  const scene={records:new Map(),meshes:[]},frameCurves={},FrameMorph={sceneChannels:()=>new Map(),serializedTags:(n,tags)=>tags},timelineFrame=0,timelineTotal=120;
  let poseRecordCache=null;const poseWorlds=new Map(),poseConstraints=new Map();
  const pluginViewport=()=>entry.viewport;
  const FrameSpline={supported:new Set(),generators:new Set(),shape:()=>null,K:()=>({primitivePivot:()=>null})};
  const appearanceTags=()=>[],frameSoloContains=()=>true,viewportLightingSignature=()=>'',syncReplicas=()=>{},setVisibility=()=>{},drawGizmo=()=>{};
  let nextDrawGate=null;const draw=force=>{if(force===undefined&&nextDrawGate){const pending=nextDrawGate;nextDrawGate=null;return pending;}return Promise.resolve();};
  const splineDisplays=new Map(),cameraNavigationRevisions=new Map();let displayUnitIndex=0,rescaleUnitIndex=0,pivotEditing=false;
  const units=['mm'],document={getElementById:()=>({})},notifyTransformUI=()=>{};
  const nodeBounds=hash=>transformedBox({min:[-50,-50,-50],max:[50,50,50]},objectWorld(hash));
  const descendants=id=>nodes.filter(n=>n.parent===id).flatMap(n=>[n.id,...descendants(n.id)]);
  let selectionGeneration=0,selectionQueue=Promise.resolve(),selectionBusy=false,preserveSelectionTags=false,selectionSignature='',coreNumeric=null,measurementCache=null,boundsFlashUntil=0,uvEditing=false;
  const editDrag=false,editFinishing=false,undoBusy=false,button={disabled:false},gizmoViews=new Map(),touchActivity=()=>{};let elementMode='object',selectionRequests=0;
  const renderer={device:{createCommandEncoder:()=>({clearBuffer(){},finish(){return {};}}),queue:{submit(){},writeBuffer(){}}}},canvas={dataset:{}};
  const clearBoxSelection=()=>{},flashObjectBounds=()=>{},posedPipelines=async()=>{},ensureTransformBackground=()=>{};
  const tools=new Map(),events=[],documentationAdmissions=[];let tail=Promise.resolve(),sequence=0;
  const fail=(code,message)=>{throw Object.assign(Error(message),{code});},validate=()=>{},json=value=>JSON.parse(JSON.stringify(value));
  const resolve=hash=>nodes.find(n=>n.nativeHash===hash),settle=async()=>{await selectionQueue;};
  const checkpoints=[];let sceneFrameDirty=false;

  const syncPoseWorld=()=>{poseWorlds.clear();poseRecordCache=null;};
  let objectSelection=[],selectionScope='objects',selectedMeshes=[],selectedMesh=null,selectionBox=null,componentPivot=null,coordinateCache=null,nativeIOBusy=false,frameUITransaction=false;
  const showMenu=()=>{},current=()=>node(focusId),playing=false;
  const handles={hidden:true},activateTab=()=>{},refreshSelection=()=>{},render=()=>frameSyncEngineVisibility(),snapshot=()=>({nodes:structuredClone(nodes),frames:snapshotFrames()}),checkpoint=before=>{transactions++;checkpoints.push(before);FrameAuthorData.changed();},restore=()=>{},stop=()=>{},commitFrames=()=>{};
  const window={dispatchEvent:event=>events.push(event.detail),FrameSpline,frameEngine:{scene,pluginMath:null,pluginWorld:hash=>Array.from(objectWorld(hash)),pluginLocal:hash=>Array.from(objectLocal(hash)),syncObjects:objects=>syncNativeObjects(objects)}};
  ${sources}
  ${line('      FrameAuthorData.attach(()=>{')}
  FrameAuthorData.installed();
  window.frameEngine.pluginMath=FM;const engineSelect=(...args)=>{selectionRequests++;return selectObjects(...args);};window.frameEngine.selectObjects=engineSelect;
  const context=bridge(entry);
  return {context,nodes,math:FM,create,entry,authorData:FrameAuthorData,fields:FrameFields,records:()=>scene.records,codec:FrameHash,sync:frameSyncEngineVisibility,
   get engineSelection(){return [...objectSelection];},get selectionRequests(){return selectionRequests;},get selectionScope(){return selectionScope;},get elementMode(){return elementMode;},
   // Seed the native display-mode state; this does not emulate toolbar events.
   setElementMode:mode=>{if(!['object','vertex','edge','polygon'].includes(mode))throw Error('Invalid fixture mode');elementMode=mode;},get selectionQueue(){return selectionQueue;},get selectionBusy(){return selectionBusy;},get checkpoints(){return checkpoints;},events,
   delayNextSelection:()=>{let release;nextDrawGate=new Promise(resolve=>release=resolve);return release;},
   rejectNextSelection:error=>{window.frameEngine.selectObjects=()=>{selectionRequests++;window.frameEngine.selectObjects=engineSelect;return Promise.reject(error);};},
   registerTool:(name,run)=>tools.set(name,{run,inputSchema:{},annotations:{readOnlyHint:false}}),call,
   applyDelta:delta=>{const before=snapshotFrames();applyObjectDelta(delta,before,undefined,false);return before;},
   snapshotFrames,restoreFrames:state=>restoreFrames(state,false),bounds:nodeBounds,

   setLocal:(hash,m)=>{putFrame(hash,'matrix',Float64Array.from(m));syncPoseWorld();},
   packed:hash=>nativeValue(hash,'matrix'),local:objectLocal,world:objectWorld,
   get transactions(){return transactions;},get selected(){return {hash:node([...selected][0])?.nativeHash,area:selectionArea};}};
 `)(manifest,webcrypto,class CustomEvent{constructor(type,options){this.type=type;this.detail=options.detail;}});
}
