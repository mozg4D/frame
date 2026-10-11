import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {declarations} from '../source-tools.mjs';
import * as nextTopo from '../math/topologyNext.mjs';
import {THREE} from '../support/three.mjs';
import {read,sources} from '../support/source-paths.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const source=read('editor-baseline-r239.mjs'),candidate=read('editor-candidate.mjs');
const coreSHA='9edde002b066a9a05676a6127f67735b62baf399bdea529f2f7e31657da769e6';
const core=read('three-core-baseline.mjs');assert.equal(sha(core),coreSHA);
const three=read('three-baseline.mjs');assert.equal(sha(three),'ed200c36396533a895a276bdf539ca86bd7ec8909d483de4f6eb5bda32cb24ec');const nodeThree=three.replaceAll("'frame-three-core'",JSON.stringify(sources.core.href));
const old=declarations(source),next=declarations(candidate);
function finish(g){for(;;){const r=g.next();if(r.done)return r.value;}}
let seed=39174;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const stats={topologyFixtures:0,legacyTopologyFieldsCompared:0,rawCornersChecked:0,representativeComparisons:0,selectedIDsComparisons:0,basisComparisons:0,measurementsComparisons:0,readTransformComparisons:0,invalidationCases:0,lifecycleCases:0,doPickCases:0};
const empty=()=>({vertices:new Set(),edges:new Set(),faces:new Set()});
function geometry(p,i=null){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(p,3));if(i)g.setIndex(new THREE.BufferAttribute(i,1));return g;}
function context(which=old){const meshMap=new Map(),ctx={THREE2:THREE,Uint32Array,Float32Array,Float64Array,Map,Set,DOMException,AbortController,queueMicrotask,performance,polyElementMode:'edge',polyMode:true,componentFocus:'poly',componentModeArmed:true,coordMode:'object',polyPivotMatrix:null,polyExactEdgeVertices:null,uvEdit:false,splineMode:false,vertexTools:{mode:null,soft:{active:false}},polySelection:{items:new Map()},selNodes:new Set(),pickMeshes:meshMap,OBJ:new Map(),logicalEdgeCache:new WeakMap(),vertexGroupCache:new WeakMap(),vertexGroupOfCache:new WeakMap(),framePolySelectionRevision:0,frameNativeClickCommit:false,frameNativeExternalSelection:0,sceneStateToken:0,sceneMutationSequence:0,frameAnimationRevision:0,frameEvaluatedTime:0,framePolySelectionJob:null,_rotX:new THREE.Vector3(),_rotY:new THREE.Vector3(),_rotZ:new THREE.Vector3(),_RM:new THREE.Matrix4(),frameRigidSelectedIDs:()=>null,framePolygonDragSelectedIDs:()=>null,frameRigidBounds:()=>null,frameRigidExtent:()=>null,worldMatrix:n=>n.matrixWorld,frameNative:nextTopo};
vm.createContext(ctx);const names=['polyFocusActive','splineFocusActive','polyEdgeKey','logicalEdges','logicalVertexGroups','frameLogicalEdgesWork','frameLogicalVertexGroupsWork','framePolySelectedVertexIdsWork','frameEdgeSelectionBasisWork','frameFaceSelectionBasisWork','framePolySelectionMeasurements','polySelectedVertexIds','polySelectionBounds','polyFrameMatrix','polyExtentInFrame','polyOwnerHash','pureWorldFrame','rotMatOfLin','polyAutoBasis','edgeSelectionBasis','faceSelectionBasis','polyCoordReference','readPolyTransform','frameCopyPolySelection','framePolySelectionBuffers','frameNativeCommitClick'];
vm.runInContext(names.map(n=>which.get(n)??old.get(n)).join('\n'),ctx);
if(which===next)vm.runInContext(read('edge-cm-helpers.inc.js')+'\n'+read('cm-generated-math.inc.js'),ctx);
return ctx;}
function setScene(c,g,selection,transforms=[{rx:.21,ry:-.7,rz:1.2,sx:2,sy:.5,sz:-1.1}]){c.pickMeshes.clear();c.OBJ.clear();c.selNodes.clear();c.polySelection.items=new Map();transforms.forEach((t,k)=>{const h='synthetic-'+k,m=new THREE.Mesh(g);m.position.set(3+k,-2,1);m.rotation.set(t.rx,t.ry,t.rz);m.scale.set(t.sx,t.sy,t.sz);m.updateMatrixWorld(true);c.pickMeshes.set(h,m);c.OBJ.set(h,m);c.selNodes.add(h);c.polySelection.items.set(h,{vertices:new Set(selection.vertices),edges:new Set(selection.edges),faces:new Set(selection.faces)});});}
const equalValue=(a,b)=>assert.deepEqual(Array.from(a),Array.from(b));
function compareMatrix(a,b){assert.equal(!!a,!!b);if(a)equalValue(a.elements,b.elements);}
function compareMeasurements(a,b){assert.equal(!!a,!!b);if(a){equalValue(a.bounds.min.toArray(),b.bounds.min.toArray());equalValue(a.bounds.max.toArray(),b.bounds.max.toArray());compareMatrix(a.frame,b.frame);equalValue(a.extent.toArray(),b.extent.toArray());}}

export {context,old,next,THREE,nextTopo,finish,geometry,setScene,empty,read,sha};
