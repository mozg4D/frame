import {installCurrentEdgeContext} from '../fixtures/current-edge-context.mjs';
import {reviewURL} from '../source-paths.mjs';
// Review-only exact-source harness. No product file is changed.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as T from '../fixtures/three-core.mjs';
const {stockCreaseReference}=await import(reviewURL('../candidate/native-source/affine-corner-worker.mjs',import.meta.url));

export const sourcePath=process.env.FRAME_PIVOT_EDITOR || reviewURL('../candidate/editor-affine-ui-v2c.mjs',import.meta.url);
export const source=fs.readFileSync(sourcePath,'utf8');
export const sourceHash=createHash('sha256').update(source).digest('hex');
export const exactV4jHash='91f70101b10b0a714bd673d982dfa236e04d23635cec641bedaa1e2ea0218ae7';
const expectedCurrentHash='4a5ef2cdfe5c6b0bfe062d1a7cc5970a269e855f0a1cef9df2ab2ddad5ede74b';
if(!process.env.FRAME_PIVOT_EDITOR)assert.equal(sourceHash,expectedCurrentHash);

export function extract(name){
  const start=source.indexOf(`function ${name}(`);assert(start>=0,`missing source function ${name}`);
  // Compiling prefixes finds the closing function brace without rewriting its body.
  for(let end=source.indexOf('}',start);end>=0;end=source.indexOf('}',end+1)){
    const body=source.slice(start,end+1);
    try{new vm.Script(body);return body;}catch{}
  }
  throw new Error(`cannot extract ${name}`);
}
export function apiSource(){
  const start=source.indexOf('}, setCoordinates = (values) => {');assert(start>=0);
  const end=source.indexOf('}, viewRect = ',start);assert(end>start);
  return 'var setCoordinates = '+source.slice(start+'}, setCoordinates = '.length,end+1)+';';
}

const loadNames=['numericValuesMatch','numericDisplayText','compactNumberText','rotMatOfLin','rotQuatOfLin','mat4Close','rigidFrame','polyOwnerHash','pureWorldFrame','polySelectedVertexIds','polyExtentInFrame','basisFromNormal','faceSelectionBasis','edgeSelectionBasis','polyAutoBasis','polyFrameMatrix','polyCoordReference','readPolyTransform','setPureGizmoFrame','applyPolyCoordinateInput','polySelectionBounds','preparePolygonDragTopology','framePolygonHash','framePolygonWeldBits','framePolygonNormalWorkspace','frameFastPolygonDragNormals','updatePolygonDragNormals','capturePolySelection','capturePolySelectionState','restorePolySelectionState','capturePolyLogicalSelection','restorePolyLogicalSelection','framePolygonAttributeArray','capturePolyGeometries','coordinateSnapshot','polyCoordStateChanged','restorePolyCoordState','clearSplineCoordinateBridge','commitCoordinateSnapshot','revertCoordinateSnapshot','restorePolyGeometries','applyPolyDelta','applyInput'];

export function makeFixture({space='world',editPivot=true,shared=false,pivot=null,world=null}={}){
  const log={prepare:0,replace:0,delta:0,crease:0,ensureAuthoring:0,normal:0,render:0,hud:0};
  const positions=Float32Array.of(0,0,0,2,0,0,0,3,1,0,-2,2);
  let g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(positions,3));g.setIndex(new T.BufferAttribute(Uint32Array.of(0,1,2,1,0,3),1));g.computeVertexNormals();
  if(!shared){g=g.toNonIndexed();g.setIndex(new T.BufferAttribute(Uint32Array.of(0,1,2,3,4,5),1));g.userData._polygonDragCorners=true;}
  const mesh=new T.Mesh(g);mesh.matrixAutoUpdate=false;mesh.matrix.copy(world||new T.Matrix4());mesh.updateMatrixWorld(true);
  const node={hash:'h',tags:[],world:mesh.matrixWorld.clone(),pivot:new T.Matrix4()};
  const c={THREE2:T,Float32Array,Float64Array,Uint32Array,Uint16Array,Int32Array,Uint8Array,Map,Set,WeakMap,Number,Math,JSON,console,
    polyCoordinatePivotEdit:null,UMM:[1],dispIdx:0,MIN_COL:1e-8,D2R:Math.PI/180,CREASE_COS:Math.cos(46*Math.PI/180),_RM:new T.Matrix4(),_RMw:new T.Matrix4(),_rotX:new T.Vector3(),_rotY:new T.Vector3(),_rotZ:new T.Vector3(),
    OBJ:new Map([['h',node]]),pickMeshes:new Map([['h',mesh]]),meshToHash:new Map([[mesh,'h']]),selNodes:new Set(['h']),
    polySelection:{items:new Map([['h',{faces:new Set([0]),vertices:new Set(),edges:new Set()}]])},
    polyMode:true,splineMode:false,componentFocus:'poly',polyElementMode:'face',coordMode:space,editPivot,uvMode:false,uvEdit:null,polyPivotMatrix:pivot?.elements.slice()??null,
    polyExactEdgeVertices:null,gizDrag:null,vertexTools:{soft:{active:false,weights:new Map()}},vertexGroupCache:new WeakMap(),vertexGroupOfCache:new WeakMap(),polyPointOverlays:new Map(),
    polygonCreaseData:stockCreaseReference,packedGeometryAttribute:a=>a.array,polygonShadingAllowed:()=>true,polygonCreaseGeometryCurrent:()=>false,markPolygonCreaseGeometry(){},
    worldMatrix:n=>n.world.clone(),polyFocusActive:()=>c.polyMode&&c.polySelection.items.size>0,splineFocusActive:()=>false,
    frameRigidSelectedIDs:()=>null,framePolygonDragSelectedIDs:()=>null,frameRigidBounds:()=>null,frameRigidExtent:()=>null,frameRigidApplyDelta:()=>false,
    frameMorphInterceptPoly:()=>false,frameMorphModelChanged(){},refreshWireOverlay(){},remapSoftAfterTopology(){},rebuildPolySelection(){},updateSoftPreview(){},
    frameAffineEnsureAuthoring(){log.ensureAuthoring++;},frameContourOrigins:{get(){return null;}},cloneTag:x=>({...x}),assignMeshMat(){},
    rebuildCreaseRender(){log.crease++;},scheduleRender(){log.render++;},scheduleGeneratorEvaluation(){},boundNode:null,hudNode:null,gizmoVisible:true,
    gizmo:{pos:new T.Vector3(),lin:new T.Matrix4()},gizmoHandleOrient:new T.Quaternion(),coordinateBridgeOperation:null,
    undoStack:[],redoStack:[],pushCmd(cmd){c.undoStack.push(cmd);c.redoStack.length=0;},
    replaceEditedGeometry(m,next){log.replace++;m.geometry=next;},polyEdgeKey:(a,b)=>a<b?`${a}:${b}`:`${b}:${a}`,
    logicalVertexGroups(geometry){
      const groups=new Map(),map=[];const p=geometry.attributes.position;
      for(let i=0;i<p.count;i++){const key=[p.getX(i),p.getY(i),p.getZ(i)].join(',');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(i);}
      for(const group of groups.values())for(const i of group)map[i]=group;
      c.vertexGroupCache.set(geometry,[...groups.values()]);c.vertexGroupOfCache.set(geometry,map);return [...groups.values()];
    },logicalEdges:()=>[],
    getGizmoWorldArray(){const out=c.gizmo.lin.clone().setPosition(c.gizmo.pos);return out.elements.slice();},
    setGizmoFromMatrix(a){const m=new T.Matrix4().fromArray(a);c.gizmo.pos.setFromMatrixPosition(m);c.gizmo.lin.copy(m).setPosition(0,0,0);},
    syncCube(){},emitTransform(){},
  };
  c.placeGizmoForSelection=()=>c.setGizmoFromMatrix(c.polyFrameMatrix().elements);
  c.readTransform=()=>c.readPolyTransform(c.coordMode);
  c.coordinates=()=>{const q=c.readTransform();return{position:q.p.toArray(),rotation:[q.e.x,q.e.y,q.e.z].map(v=>v*180/Math.PI),size:q.s.toArray()};};
  c.updateHUD=()=>{log.hud++;c.lastHUD=c.coordinates();};
  vm.createContext(c);installCurrentEdgeContext(c);for(const name of loadNames)vm.runInContext(extract(name),c);vm.runInContext(apiSource(),c);
  for(const [name,key]of [['preparePolygonDragTopology','prepare'],['applyPolyDelta','delta'],['updatePolygonDragNormals','normal']]){const original=c[name];c[name]=(...args)=>{log[key]++;return original(...args);};}
  c.placeGizmoForSelection();
  return {c,mesh,node,log};
}

export function geometrySnapshot(mesh){const g=mesh.geometry;return{g,p:g.attributes.position,n:g.attributes.normal,index:g.index,pArray:g.attributes.position.array,nArray:g.attributes.normal.array,iArray:g.index.array,positions:g.attributes.position.array.slice(),normals:g.attributes.normal.array.slice(),indices:g.index.array.slice(),versions:[g.attributes.position.version,g.attributes.normal.version,g.index.version],world:mesh.matrixWorld.elements.slice()};}
export function unchanged(mesh,before){const g=mesh.geometry;assert.equal(g,before.g,'geometry identity');assert.equal(g.attributes.position,before.p,'position attribute identity');assert.equal(g.attributes.normal,before.n,'normal attribute identity');assert.equal(g.index,before.index,'index attribute identity');assert.equal(g.attributes.position.array,before.pArray,'position array identity');assert.equal(g.attributes.normal.array,before.nArray,'normal array identity');assert.equal(g.index.array,before.iArray,'index array identity');assert.deepEqual(g.attributes.position.array,before.positions,'positions');assert.deepEqual(g.attributes.normal.array,before.normals,'normals');assert.deepEqual(g.index.array,before.indices,'index');assert.deepEqual([g.attributes.position.version,g.attributes.normal.version,g.index.version],before.versions,'attribute versions');assert.deepEqual(mesh.matrixWorld.elements,before.world,'object world');}
export function near(a,b,label='',epsilon=1e-9){a=Array.from(a);b=Array.from(b);assert.equal(a.length,b.length,label);a.forEach((v,i)=>assert(Math.abs(v-b[i])<=epsilon,`${label}[${i}] ${v} != ${b[i]}`));}
export function desiredFrame(c,ch,i,value){
  const old=c.polyFrameMatrix(),ref=c.polyCoordReference(c.coordMode),local=ref.clone().invert().multiply(old),desired=old.clone();
  if(ch==='pos'){const p=new T.Vector3().setFromMatrixPosition(local);p.setComponent(i,value);desired.setPosition(p.applyMatrix4(ref));}
  else if(ch==='rot'){const e=new T.Euler().setFromRotationMatrix(c.rotMatOfLin(local,new T.Matrix4()));e[['x','y','z'][i]]=value*Math.PI/180;desired.copy(c.rotMatOfLin(ref,new T.Matrix4()).multiply(new T.Matrix4().makeRotationFromEuler(e)));desired.setPosition(new T.Vector3().setFromMatrixPosition(old));}
  else {const f=Math.max(c.MIN_COL,Math.abs(value))/Math.max(c.polyExtentInFrame(old).getComponent(i),c.MIN_COL);for(let j=0;j<3;j++)desired.elements[i*4+j]*=f;}
  return{old,desired,delta:desired.clone().multiply(old.clone().invert()),final:ch==='size'?old.clone():desired.clone()};
}
export function orderedPositions(positions,ids,world,delta,weights=null){const out=positions.slice(),inv=world.clone().invert();for(let k=0;k<ids.length;k++){const i=ids[k],base=new T.Vector3().fromArray(positions,i*3),moved=base.clone().applyMatrix4(world).applyMatrix4(delta).applyMatrix4(inv);out.set(base.lerp(moved,weights?weights[k]:1).toArray(),i*3);}return out;}
export {T,vm,assert};
