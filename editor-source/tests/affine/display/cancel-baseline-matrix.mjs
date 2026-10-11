import {reviewURL} from '../source-paths.mjs';
import {verifyCandidate} from './verify-candidate.mjs';verifyCandidate();
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import * as THREE from '../fixtures/three-core.mjs';
const {captureDisplayObject,DisplayGeometryCache,registerAffineDisplayOverride}=await import(reviewURL('../candidate/native-source/display-packets.mjs',import.meta.url));
const {GpuRigidIslandPreview,registerRigidGpuGeometry,installRigidGpuAttributeViews,unregisterRigidGpuGeometry}=await import(reviewURL('../candidate/native-source/gpu-island-preview.mjs',import.meta.url));
const {GpuAffineCornerPreview}=await import(reviewURL('../candidate/native-source/gpu-affine-preview.mjs',import.meta.url));
const source=fs.readFileSync(reviewURL('../candidate/editor-affine-ui-v2c.mjs',import.meta.url),'utf8');
function extract(name){const at=source.indexOf('function '+name+'(');assert(at>=0,name);const lines=source.slice(at).split('\n');for(let i=1;i<1000;i++){const f=lines.slice(0,i).join('\n');try{new vm.Script('('+f+')');return f;}catch{}}throw Error(name);}
const rows=[];
for(const priorFull of [false,true])for(const publishFull of [false,true]){
 const authoring=Float32Array.of(0,0,0,1,0,0,0,1,0,20,0,0,21,0,0,20,1,0),normals=Float32Array.from({length:18},(_,i)=>i%3===2?1:0),index=Uint32Array.of(0,1,2,3,4,5);
 const g=new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(authoring.slice(),3)).setAttribute('normal',new THREE.BufferAttribute(normals.slice(),3)).setIndex(new THREE.BufferAttribute(index,1));
 const mesh=new THREE.Mesh(g,new THREE.MeshBasicMaterial());mesh.updateMatrixWorld(true);const cache=new DisplayGeometryCache(),numeric=cache.capture(g),raw=authoring.slice();if(priorFull)for(const k of [9,12,15])raw[k]+=.25;numeric.positions.set(raw);
 const writes=[],device={queue:{writeBuffer(b,offset,values){writes.push({name:b.name,offset,count:values.length});b.values.set(values,offset/4);}}};let closed=0;
 const gpu=(n,name,proto)=>({position:{name,values:n.positions.slice()},normal:{name:name+'-normal',values:n.extras.slice()},cpuPositions:n.positions,cpuExtras:n.extras,device,disposed:false,isCurrent:()=>true,_check:proto._check,writeAuthoringRanges:proto.writeAuthoringRanges,gathered:true});
 const t={h:'h',device,numeric,mesh,g,ids:Uint32Array.of(0,1,2),ranges:[[0,3]],pa:g.attributes.position.array};t.adapter=registerRigidGpuGeometry(g,numeric);installRigidGpuAttributeViews(t.adapter);t.gpu=gpu(numeric,'raw',GpuRigidIslandPreview.prototype);
 const r=t.affine={live:true,revision:0,numeric:{source:{},positions:authoring.slice(0,9),extras:new Float32Array(27),indices:null,vertexCount:3,hasNormals:true,lineIndices:new Map()},localIndex:Uint32Array.of(0,1,2),faceSlots:Int32Array.of(1,0),faceIDs:Uint32Array.of(0)};r.gpu=gpu(r.numeric,'corner',GpuAffineCornerPreview.prototype);
 const previousFull=priorFull?{source:{},positions:raw.slice(),extras:numeric.extras.slice(),indices:index.slice(),vertexCount:6,hasNormals:true,lineIndices:new Map(),isCurrent:()=>true}:null;r.fullNumeric=previousFull;r.rawDisplayBaseline={positions:raw};
 const s={r,t,affine:true,ready:true,cancel:false,discarded:false,affineRevision:0,revision:1,beforeValues:authoring.slice(0,9),beforeNormals:normals.slice(0,9),abortResolve(){},gizmo:[],beforePivot:null};
 const c=vm.createContext({frameRigidCaptureOverlays:()=>[],DOMException,frameRigidSource:()=>true,frameRigidTransactionCurrent:()=>true,frameRigidRestoreOverlays(){},frameAffineRawSnapshot:()=>({attrs:{position:{array:authoring.slice()},normal:{array:normals.slice()}}}),frameAffineStages:new Map(),frameAffineSerial:0,frameAffineCreateWorker(s){s.closeWorker=()=>{closed++;};},frameAffineNotes:{starts:0,exactPoses:0,phases:[]},frameRigidNotes:{cancels:0},frameRigidInput:null,setGizmoFromMatrix(){},scheduleRender(){},updateHUD(){}});
 for(const n of['frameAffineStartPreview','frameAffineActivate','frameAffinePosePublish','frameAffineRestoreRawDisplay','frameAffineCleanup','frameAffineCancelSession','frameRigidCancelSession'])vm.runInContext(extract(n),c);
 const display=registerAffineDisplayOverride(mesh,{faceSlots:r.faceSlots,selectedGeometry:()=>{const revision=r.revision;return{...r.numeric,isCurrent:()=>r.live&&r.revision===revision};},fullGeometry:()=>r.fullNumeric,isCurrent:()=>r.live});
 c.frameAffineActivate(s);assert.equal(s.beforeFullNumeric,previousFull);assert.deepEqual(s.beforeDisplayRaw,raw);assert.notEqual(s.beforeDisplayRaw,t.numeric.positions);
 const baseline=captureDisplayObject(mesh,{geometryCache:cache});assert(baseline.isCurrent());
 const exact=raw.slice();for(const k of [0,3,6])exact[k]+=10;if(publishFull)for(const k of [9,12,15])exact[k]+=5;
 s.affineRevision++;
 if(publishFull)r.fullNumeric={source:{},positions:exact.slice(),extras:numeric.extras.slice(),indices:index.slice(),vertexCount:6,hasNormals:true,lineIndices:new Map(),isCurrent:()=>true};else r.fullNumeric=null;
 assert(c.frameAffinePosePublish(s,{revision:s.affineRevision,positions:exact.slice(0,9),cornerPositions:exact.slice(0,9),cornerNormals:normals.slice(0,9),...(publishFull?{rawFullPositions:exact}:{}),timings:{}}));
 const moved=captureDisplayObject(mesh,{geometryCache:cache});assert(moved.isCurrent());assert(!baseline.isCurrent());
 c.frameRigidCancelSession(s);const cancelled=captureDisplayObject(mesh,{geometryCache:cache});assert(cancelled.isCurrent());assert(!moved.isCurrent());assert(!baseline.isCurrent());
 assert.deepEqual(t.numeric.positions,raw);assert.deepEqual(t.gpu.position.values,raw);assert.deepEqual(r.numeric.positions,authoring.slice(0,9));assert.deepEqual(r.gpu.position.values,authoring.slice(0,9));assert.deepEqual(g.attributes.position.array,authoring);assert.equal(r.fullNumeric,previousFull);assert.equal(r.active,null);assert.equal(t.gpu.gathered,false);assert.equal(r.gpu.gathered,false);assert.equal(closed,1);
 if(priorFull){assert(r.fullNumeric.isCurrent());assert(cancelled.packets.every(p=>p.geometry.positions===previousFull.positions));assert.deepEqual(cancelled.packets[0].geometry.positions,raw);}else for(const p of cancelled.packets)assert.deepEqual(p.geometry.positions,p.geometry.positions===r.numeric.positions?authoring.slice(0,9):raw);
 rows.push({priorFull,publishFull,pass:true,authoringUntouched:true,rawGpuRestoredIncludingOutside:true,cornerGpuRestored:true,priorFullRestored:!!previousFull,stalePacketsRejected:true,rawFrozenGatherReset:true,cornerFrozenGatherReset:true,workerCloseCalls:closed,writes:writes.length});
 display.dispose();unregisterRigidGpuGeometry(g,t.adapter);
}
console.log(JSON.stringify({pass:true,scope:'Exact Activate/Publish/Cancel, real Three/display adapter, exact raw/corner GPU range methods, mocked GPU queue',rows},null,2));
