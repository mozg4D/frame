import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../../../modules/frame-three-core.9edde002b066a9a05676.js';
import * as Native from '../../../modules/native.4ec912c8a6f2b4d498f1.js';
const source=fs.readFileSync(new URL('../../ordinary-move-integration.mjs',import.meta.url),'utf8');
export function geom(){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(new Float32Array([0,0,0,1,0,0,0,1,0]),3));g.setAttribute('normal',new THREE.BufferAttribute(new Float32Array([0,0,1,0,0,1,0,0,1]),3));g.setIndex(new THREE.BufferAttribute(new Uint16Array([0,1,2]),1));return g;}
export function fixture({ActorType=null,device={},pool:providedPool=null}={}){
 const mesh=new THREE.Mesh(geom()),entry={vertices:new Set([0]),edges:new Set(),faces:new Set()},pool=providedPool||{release:r=>{r.released=(r.released||0)+1;}},cache=new Native.DisplayGeometryCache();
 const overlays=Array.from({length:3},()=>({geometry:geom(),matrix:new THREE.Matrix4(),visible:true}));const back={geometry:overlays[0].geometry,matrix:new THREE.Matrix4(),visible:true};
 class Actor{constructor(o){Object.assign(this,o);this.root={rows:[]};this.version=1;this.renderVersion=0;this.closed=false;this.operations=0;this.tasks={yield:async()=>{}};}dispose(){this.closed=true;return Promise.resolve();}}
 const ctx=vm.createContext({THREE2:THREE,frameNative:Native,DOMException,AbortController,frameNativeHoverIntent:0,framePolySelectionJob:null,edgeBevelResult:null,lastAttrKey:null,polyExtrudedFaces:null,frameNativeClickCommit:false,frameNativeExternalSelection:0,frameRememberConnectedSelection(){},Float32Array,Uint16Array,Uint32Array,OrdinaryMoveActor:ActorType||Actor,undoStack:[],redoStack:[],frameRigidEpoch:new WeakMap(),pickMeshes:new Map([['A',mesh]]),OBJ:new Map([['A',{}]]),selNodes:new Set(['A']),polySelection:{items:new Map([['A',entry]]),face:overlays[0],edge:overlays[1],vertex:overlays[2],faceBack:back},
  polyFocusActive:()=>true,splineFocusActive:()=>false,uvMode:false,uvEdit:false,editPivot:false,vertexTools:{soft:{active:false}},polyExactEdgeVertices:null,polyElementMode:'vertex',coordMode:'world',polyPivotMatrix:null,polyMode:true,framePolySelectionRevision:0,
  frameMorphTag:()=>null,effectiveVisible:()=>true,polygonShadingAllowed:()=>true,frameRigidOwnerSnapshot:()=>({device,pool,engine:{geometryCache:cache}}),frameRigidOwnerCurrent:()=>true,frameRigidDispose:()=>{},frameRigidPrepared:null,frameNumericDisplayRetire:()=>{},frameNumericDisplayRoots:new Map(),
  wireOverlays:new Map(),polyPointOverlays:new Map(),frameBindSTLWireIndices:()=>{},frameBindSTLPickTree:()=>{},markPolygonCreaseGeometry:()=>{},pureWorldFrame:()=>new THREE.Matrix4(),frameNativeEdgeCM:null,frameConnectedSelectionComplete:null,
  frameRigidCaptureOverlays:()=>[...overlays,back].map(o=>({o,matrix:o.matrix.clone(),position:o.geometry.attributes.position,visible:o.visible,auto:false})),frameRigidRestoreOverlays:s=>{for(const r of s.overlays){r.o.geometry.setAttribute('position',r.position);r.o.matrix.copy(r.matrix);r.o.visible=r.visible;}},setGizmoVisible:()=>{},placeGizmoForSelection:()=>{},updateHUD:()=>{},readPolyTransform:()=>null,scheduleRender:()=>{},frameAffineYield:async()=>{},console});
 vm.runInContext(source,ctx);return{ctx,mesh,entry,pool,cache,overlays};
}
