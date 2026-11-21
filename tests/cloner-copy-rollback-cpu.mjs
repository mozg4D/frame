import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(process.argv[2]||'index.html','utf8');
const take=(a,b)=>{const x=html.indexOf(a),y=html.indexOf(b,x+a.length);assert.ok(x>=0&&y>x,a);return html.slice(x,y);};
const scope=take('    const frameReplicaArrayMax=', '    function surfacePlacements(')+take('    function syncReplicas(', '    function syncNativeObjects');
const harness=new Function('env',`
 const {scene,nodes,track,FM}=env, noop=()=>{},renderer={device:{queue:{writeBuffer:noop}}},gpuLeases=new WeakMap(),
  splineDisplays=new Map(),replicaPlacements=new Map(),surfaceSamplers=new Map(),splineLoadBatch=false,selectionScope='objects',objectSelection=[],
  GPUBufferUsage={UNIFORM:1,COPY_DST:2,STORAGE:4,COPY_SRC:8},
  FrameSpline={generators:new Set(),states:new Map(),generatorSources:()=>[],consumesInput:()=>true},
  window={FrameSpline},FramePlugins={owner:()=>null},polygonGenerator=()=>false,
  frameSoloContains=()=>true,acknowledgeReplicaPublication=noop,
  byId=new Map(nodes.map(n=>[n.id,n])),node=id=>byId.get(id),
  objectWorld=FM.I,objectRelativeFrame=FM.I,objectPivot=FM.I,meshRenderGroups=noop,
  classifiedSurfaceWire=()=>false,replicaResources=()=>[],syncPoseWorld=()=>false,deferHoverMaps=noop,draw=noop,
  meshAllocator=(r,m)=>(label)=>{
   if(label==='instance face range'&&m.hashId===env.failOwner){
    if(++track.attempts===env.failAt)throw new RangeError('Injected out of memory allocating native occurrence');
   }
   const resource={label};m.buffers.push(resource);return resource;
  },
  releaseGPU=r=>track.released.push(r),disposeMesh=m=>{track.disposed.push(m);for(const r of m.buffers)releaseGPU(r);},
  publishTopology=()=>{let base=0;for(const m of scene.meshes){m.faceBase=base;base+=m.triangleCount;}scene.triangleCount=base;},
  clearFeatureDraws=noop,clearPickGroups=noop,refreshMaterialOwners=noop,
  replicaAuthoringIndexes=()=>{const owners=nodes.filter(n=>n.type==='cloner'||n.type==='instance'||n.type==='symmetry'),ownerSet=new Set(owners),sourceChildren=new Map(),nodeByHash=new Map(nodes.map(n=>[n.nativeHash,n]));
   for(const n of nodes)if(n.parent){const group=sourceChildren.get(n.parent)||[];group.push(n);sourceChildren.set(n.parent,group);}return {owners,ownerSet,sourceChildren,nodeByHash};};
 let replicaBuilding=false,selectedMeshes=[],selectedMesh=null,appearanceSignature='';
 ${scope}
 return {syncReplicas};
`);
const I=()=>Array.from({length:16},(_,i)=>i%5===0?1:0);
const FM={I,inv:()=>I(),mul:(a,b)=>{const r=I();for(let k=12;k<15;k++)r[k]=a[k]+b[k];return r;},equal:(a,b)=>a.every((v,i)=>v===b[i])};
const root=(name,type,parent=null,params={})=>({id:name,nativeHash:name,type,parent,visible:true,enabled:true,params});
const matrix=(count,spacing=12)=>({type:'matrix','count x':count,'count y':1,'count z':1,'spacing x':spacing,'spacing y':0,'spacing z':0});
const A=root('A','cloner',null,matrix(2)),B=root('B','cloner',null,matrix(2)),a=root('a','mesh','A'),b=root('b','mesh','B');
const source=hash=>({hashId:hash,triangleCount:4,count:12,vertexCount:4,normalCount:4,buffers:[],connected:{},boundsMin:[0,0,0],boundsMax:[1,1,1],version:0,indices:{},positions:{},normals:{},renderIndices:{},edgeCounts:[6]});
const scene={meshes:[source('a'),source('b')]},track={attempts:0,disposed:[],released:[]},
 env={scene,nodes:[A,B,a,b],track,FM,failOwner:null,failAt:Infinity},api=harness(env);
const outputs=name=>scene.meshes.filter(m=>m.hashId===name);
api.syncReplicas();
const oldA=outputs('A'),oldB=outputs('B'),oldPose=oldA.map(m=>m.replicaMatrix.slice()),oldFace=oldA.map(m=>m.faceBase);
assert.equal(oldA.length,2);assert.equal(oldB.length,2);
A.params=matrix(4,24);env.failOwner='A';env.failAt=2;api.syncReplicas(new Set(['A']));
assert.match(A.splineError,/Injected out of memory/);assert.equal(track.attempts,2);
assert.deepEqual(outputs('A'),oldA);assert.equal(outputs('A')[0],oldA[0]);
assert.deepEqual(outputs('A').map(m=>m.replicaMatrix),oldPose);
assert.deepEqual(outputs('A').map(m=>m.faceBase),oldFace);
assert.deepEqual(outputs('B'),oldB);assert.equal(outputs('B')[0],oldB[0]);
assert.equal(track.disposed.length,2,'One successful staging allocation and the partial next row are dropped');
assert.ok(track.disposed.every(m=>!oldA.includes(m)&&!oldB.includes(m)));
assert.equal(track.released.length,1,'Only the successful new staging resource is released');

A.params=matrix(1073741824);env.failOwner=null;api.syncReplicas(new Set(['A']));
assert.match(A.splineError,/32-bit viewport IDs/);
assert.deepEqual(outputs('A').map(m=>m.replicaMatrix),oldPose);assert.equal(outputs('B')[0],oldB[0]);
A.params=matrix(3,24);api.syncReplicas(new Set(['A']));
assert.equal(A.splineError,undefined);assert.equal(outputs('A').length,3);assert.equal(outputs('B')[0],oldB[0]);
assert.deepEqual(outputs('A').map(m=>m.replicaMatrix[12]),[-24,0,24]);
console.log('Late recoverable allocation loss and exact face overflow retain both last-good Cloner owners and permit retry.');
