// CPU-only DOM/render adapters; codec, transactions, material records and Undo are extracted from the tested main-based runtime.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const id=i=>i.toString(16).padStart(32,'0');
const line=(html,start)=>{const at=html.indexOf(start);assert.ok(at>=0,start);return html.slice(at,html.indexOf('\n',at));};
const range=(html,a,b)=>{const at=html.indexOf(a),end=html.indexOf(b,at+a.length);assert.ok(at>=0&&end>at,a);return html.slice(at,end);};
export function textureHistoryFixture(html){
 const no=()=>{},c={crypto:webcrypto,structuredClone,console,performance,TextEncoder,TextDecoder,Blob,Response,CompressionStream,DecompressionStream,Uint8Array,Uint32Array,Float32Array,Float64Array,Map,Set,
  materials:[{uid:id(1),name:'Default',h:0,s:0,l:50,emm:0,rough:50,metal:0,opac:100,bump:0}],frameDefaultMaterials:[{uid:id(1),name:'Default',h:0,s:0,l:50,emm:0,rough:50,metal:0,opac:100,bump:0}],nodes:[],selected:new Set(),selectedTags:new Set(),selectedTag:null,focusId:null,activeMaterial:0,materialAnchor:0,selectedMaterials:new Set([0]),materialSerial:0,materialThumbnails:new Map(),textureImages:new Map(),timelineFrame:0,timelineTotal:120,frameChannels:new Map(),frameChannelSelection:[],frameCurves:{context:[],selection:[],editing:false},undoStack:[],redoStack:[],frameUIUndoSequence:[],frameUIRedoSequence:[],frameUITransaction:0,frameBatchDepth:0,root:null,
  FrameAuthorData:{root:()=>c.root,changed:no,reset:no,history:x=>x,restoreNodes:x=>x,reserveNodes:()=>no,setRoot:x=>{c.root=x;},preflightHistory:no},FrameMorph:{historyState:()=>null,restoreEditor:no,request:no},FramePluginRecords:{replacer:undefined,reviver:undefined},FramePlugins:{dispatch:no},
  framePackTrack:x=>x,frameUnpackTrack:x=>x,frameTrimUIUndo:no,frameSyncMaterials:no,render:no,renderTree:no,renderMaterials:no,syncMaterial:no,frameIsPLAPath:()=>false,frameTarget:()=>true,frameEvaluateAnimation:no,frameRefreshAnimationUI:no,frameSelectEngineObjects:no,frameGetTrack:()=>null,$:()=>({dataset:{elementMode:'object'}}),window:{frameEngine:{requestLibrary:no,draw:no}},tagKey:(a,b)=>a+':'+b,
  metaUndo:[],metaRedo:[],scene:{records:new Map(),meshes:[]},nativeIOBusy:false,appearanceSignature:'',appearanceRevision:0,polygonResources:new Map(),uvResources:new Map(),frameMapFields:[],frameMaterialDefaults:{},materialKeys:['h','s','l','emm','rough','metal','opac','bump'],materialNumber:(m,k)=>m[k]||0,refreshMaterialOwners:no,renderer:{},draw:no,shadingMode:'solid',
 };
 c.node=n=>c.nodes.find(q=>q.id===n);c.children=n=>c.nodes.filter(q=>q.parent===n);c.own=h=>c.nodes.find(n=>n.nativeHash===h);
 c.rememberAppearance=(hash,type,value)=>{c.scene.records.set(hash,{id:hash,type,value});(c.scene.appearanceIds??=new Set()).add(hash);};c.putAppearance=(h,f,t,v)=>{const k=c.FrameHash.address(h,f);c.rememberAppearance(k,t,v);return k;};c.appearanceId=(h,f)=>c.FrameHash.address(h,f);c.appearanceValue=(h,f)=>c.scene.records.get(c.appearanceId(h,f))?.value;c.nativeValue=c.appearanceValue;
 c.window.frameMaterialState=()=>({library:c.materials,owners:c.nodes.map(n=>({hash:n.nativeHash,parent:null,tags:n.tags.filter(t=>t.kind==='material').map(t=>({uid:t.uid,kind:t.kind,materialUID:c.materials[t.material||0].uid}))})),assets:[],dirty:true});
 vm.createContext(c);vm.runInContext(range(html,'function createFrameHashCodec(){','const FrameHash=createFrameHashCodec();')+'\nthis.FrameHash=createFrameHashCodec();\n'+range(html,'function replaceMaterials(','function deleteSelectedMaterials()')+range(html,'    function appearanceLibrary(){','    function refreshMaterialOwners(){')+range(html,'    async function decodeAppearancePlan(','    function validatePolygonSets(')+[
 'function snapshot(){','function checkpoint(before)','function commit(action, refresh=true)','function restore(value){','function frameSnapshotContent(','async function frameUndoUI(','function descendants(','function roots(','function remove(){','function frameSerializeChannels(','function frameRestoreChannels('
 ].map(x=>line(html,x)).join('\n'),c);
 c.run=s=>vm.runInContext(s,c);c.add=uid=>{const m={...c.frameDefaultMaterials[0],uid:id(uid),name:'Material '+uid};c.materials.push(m);return m;};
 c.object=(n,material,type='mesh',parent=null)=>{const m=c.materials[material],o={id:'n'+n,nativeHash:id(1000+n),parent,type,params:{},tags:m?[{uid:id(2000+n),kind:'material',material,materialUID:m.uid,params:{}}]:[]};c.nodes.push(o);return o;};c.del=ids=>{c.selected=new Set(ids);c.remove();};
 return c;
}
