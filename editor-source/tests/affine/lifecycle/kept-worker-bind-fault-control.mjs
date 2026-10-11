import {reviewURL} from '../source-paths.mjs';
import {verifyCandidate} from '../display/verify-candidate.mjs';
import {deferredEnv,session,THREE2,assert,tick} from '../display/support.mjs';
import {device,created,flush,GpuAffineCornerPreview,GpuBufferPool} from '../display/queue-interpreter.mjs';
const {GpuRigidIslandPreview,registerRigidGpuGeometry,installRigidGpuAttributeViews,unregisterRigidGpuGeometry,touchRigidGpuGeometry}=await import(reviewURL('../candidate/native-source/gpu-island-preview.mjs',import.meta.url));
const {DisplayGeometryCache,registerAffineDisplayOverride,captureDisplayObject}=await import(reviewURL('../candidate/native-source/display-packets.mjs',import.meta.url));
verifyCandidate();

// Exact retained-worker Bind, actual native pool/cache/adapters, ordered CPU
// interpretation of GPU commands. These checks make no hardware claim.
const bytes=value=>new Uint8Array(value.data??value.buffer,value.byteOffset??0,value.byteLength??value.size).slice();
const difference=(a,b)=>a.reduce((count,value,index)=>count+(value!==b[index]),0);
const {c,t}=deferredEnv();
Object.assign(t.device,device);
const pool=new GpuBufferPool(t.device);
t.pool=t.owner.pool=pool;t.engine.geometryCache=new DisplayGeometryCache();
const mesh=new THREE2.Mesh(t.g,new THREE2.MeshBasicMaterial());mesh.updateMatrixWorld(true);
c.pickMeshes.set(t.h,mesh);t.mesh=mesh;t.numeric=t.engine.geometryCache.capture(t.g);
Object.assign(c.frameNative,{GpuAffineCornerPreview,registerAffineDisplayOverride,registerRigidGpuGeometry,installRigidGpuAttributeViews,unregisterRigidGpuGeometry,touchRigidGpuGeometry});
t.adapter=registerRigidGpuGeometry(t.g,t.numeric,{isCurrent:()=>c.frameRigidSource(t)});
installRigidGpuAttributeViews(t.adapter);
t.gpu=await GpuRigidIslandPreview.create({device:t.device,pool,positions:t.numeric.positions,extras:t.numeric.extras,ids:t.ids,isCurrent:()=>c.frameRigidSource(t)});
const rawGPU=t.gpu;
const alias=new THREE2.BufferGeometry().setAttribute('position',t.p).setIndex(new THREE2.BufferAttribute(Uint32Array.of(0,1),1));
const rawBorrow=pool.borrow(t.engine.geometryCache.capture(alias).positions,128);
assert.equal(rawBorrow.buffer,rawGPU.position);
await c.frameAffinePrepareEarly(t);
const r=await c.frameAffinePrepare(t),gpu=r.gpu,display=r.display;
const selectedPositionBorrow=pool.borrow(r.numeric.positions,128),selectedNormalBorrow=pool.borrow(r.numeric.extras,128);
assert.equal(selectedPositionBorrow.buffer,gpu.position);assert.equal(selectedNormalBorrow.buffer,gpu.normal);assert.notEqual(gpu.position,rawGPU.position);
let workerCloses=0;
const worker={closed:false,close(){this.closed=true;workerCloses++;}};r.workerPipe=worker;
c.frameRigidSchedulePrepare=()=>null;
c.frameAffineCreateWorker=s=>{s.baseVersion=0;s.closeWorker=()=>{};};
c.frameAffineAdopt=()=>{};c.frameAffinePump=()=>{};
const s=session(c,t);s.affine=true;s.kind='affine';c.frameAffineActivate(s);await c.frameAffineCommit(s);
const stage=s.stage,snapshot=c.frameAffineCanonicalNow(stage);
worker.confirmedVersion=stage.logicalVersion;r.canonicalVersion=stage.logicalVersion;r.canonicalSnapshot=snapshot;
assert.equal(r.logicalVersion,stage.logicalVersion);assert.equal(r.lastPublishedSnapshot,undefined);
assert.equal(c.frameAffineBindingCurrent(r),true);assert.equal(c.frameAffineStageCurrent(stage),true);

// Deliberately distinct GPU and CPU baselines rule out a CPU reupload masquerading
// as an exact GPU rollback. Signed zero also exercises bit-exact extra preservation.
r.numeric.extras[3]=-0;gpu.writeAuthoringRanges([[0,r.faceIDs.length*3]]);
t.device.queue.writeBuffer(gpu.position,0,Float32Array.of(19.25));
t.device.queue.writeBuffer(gpu.normal,0,Float32Array.of(-37.5));gpu.gathered=true;
flush();await tick();
const before={
 geometry:mesh.geometry,position:t.p,normal:t.n,index:t.index,
 cornerPositionArray:r.numeric.positions,cornerExtraArray:r.numeric.extras,
 cornerPositions:bytes(r.numeric.positions),cornerExtras:bytes(r.numeric.extras),
 gpuPositions:bytes(gpu.position),gpuExtras:bytes(gpu.normal),gpuBase:bytes(gpu.base),
 rawPositions:bytes(t.numeric.positions),rawExtras:bytes(t.numeric.extras),
 rawGPUPositions:bytes(rawGPU.position),rawGPUExtras:bytes(rawGPU.normal),
 authorPositions:bytes(t.p.array),authorNormals:bytes(t.n.array),authorIndex:bytes(t.index.array),
 cache:t.engine.geometryCache.rows.get(t.g),rawCapture:t.engine.geometryCache.capture(t.g),
 aliasCapture:t.engine.geometryCache.capture(alias),packet:captureDisplayObject(mesh,{geometryCache:t.engine.geometryCache}),
 stage:{stamp:stage.stamp,bound:stage.bound,snapshot:stage.snapshot},
 binding:Object.fromEntries(['stamp','physicalRaw','initialRaw','canonicalSnapshot','logicalVersion','canonicalVersion','rawDisplayBaseline','fullNumeric','active','revision','lastPublishedSnapshot'].map(key=>[key,r[key]])),
 refs:[...pool.entries.values()].flatMap(variants=>[...variants.values()]).map(row=>[row,row.refs]),poolBytes:pool.bytes,
 undo:c.undoStack.slice(),redo:c.redoStack.slice(),sceneStateToken:c.sceneStateToken,gizmo:c.getGizmoWorldArray()
};
assert(before.packet.isCurrent());assert(before.aliasCapture.isCurrent());
assert.notDeepEqual(before.cornerPositions,before.gpuPositions);assert.notDeepEqual(before.cornerExtras,before.gpuExtras);
let oldDisposals=0,failedGeometry=null,failedDisposals=0;
before.geometry.addEventListener('dispose',()=>oldDisposals++);
const createGeometry=c.frameAffineGeometry;
c.frameAffineGeometry=snapshot=>{const g=createGeometry(snapshot);failedGeometry=g;g.addEventListener('dispose',()=>failedDisposals++);return g;};
const write=t.device.queue.writeBuffer;
let selectedWrites=0,normalFaults=0,cornersChangedAtFault=false;
t.device.queue.writeBuffer=(target,offset,data)=>{
 if(target===gpu.position)selectedWrites++;
 if(target===gpu.normal){normalFaults++;cornersChangedAtFault=difference(bytes(r.numeric.positions),before.cornerPositions)>0;
  // Exercise removal of a transient raw display cache for the failed geometry.
  t.engine.geometryCache.capture(mesh.geometry);throw Error('controlled kept-worker Bind normal upload fault');}
 return write(target,offset,data);
};
c.gizDrag=null;
const allocationStart=created.length;
assert.throws(()=>c.frameAffineBind(stage,snapshot,true),/controlled kept-worker Bind normal upload fault/);
t.device.queue.writeBuffer=write;c.frameAffineGeometry=createGeometry;
assert.equal(selectedWrites,1,'partial position upload must actually be enqueued');assert.equal(normalFaults,1);
assert(cornersChangedAtFault,'the corruption-triggering CPU mutation must actually occur');
const backups=created.slice(allocationStart);assert.equal(backups.length,2);
await Promise.resolve();assert(backups.every(buffer=>!buffer.destroyed),'backups survive queued rollback');
assert.equal(gpu.authoringTransaction,null);assert.equal(gpu.gathered,true);
assert.equal(mesh.geometry,before.geometry);assert.equal(mesh.geometry.attributes.position,before.position);
assert.equal(mesh.geometry.attributes.normal,before.normal);assert.equal(mesh.geometry.index,before.index);
assert.equal(t.disposed,false);assert.equal(rawGPU.disposed,false);assert.equal(c.frameRigidPrepared,t);
assert.equal(c.frameRigidSource(t),true);assert.equal(c.frameAffineBindingCurrent(r),true);
assert.equal(r.gpu,gpu);assert.equal(r.display,display);assert.equal(r.workerPipe,worker);
assert.equal(worker.closed,false);assert.equal(workerCloses,0);
assert.equal(r.numeric.positions,before.cornerPositionArray);assert.equal(r.numeric.extras,before.cornerExtraArray);
assert.deepEqual(bytes(r.numeric.positions),before.cornerPositions);assert.deepEqual(bytes(r.numeric.extras),before.cornerExtras);
for(const [key,value]of Object.entries(before.binding))assert.equal(r[key],value,'binding '+key);
for(const [key,value]of Object.entries(before.stage))assert.equal(stage[key],value,'stage '+key);
assert.equal(t.engine.geometryCache.rows.get(before.geometry),before.cache);
assert.equal(t.engine.geometryCache.rows.has(failedGeometry),false);
assert.equal(t.engine.geometryCache.capture(before.geometry),before.rawCapture);
assert(before.rawCapture.isCurrent());assert(before.aliasCapture.isCurrent());assert(before.packet.isCurrent());
assert.equal(captureDisplayObject(mesh,{geometryCache:t.engine.geometryCache}).packets[0].geometry.positions,r.numeric.positions);
assert.equal(oldDisposals,0);assert.equal(failedDisposals,1);
assert.deepEqual(c.undoStack,before.undo);assert.deepEqual(c.redoStack,before.redo);
assert.equal(c.sceneStateToken,before.sceneStateToken);assert.deepEqual(c.getGizmoWorldArray(),before.gizmo);
for(const [row,refs]of before.refs){assert.equal(row.refs,refs);assert.equal(row.freed,false);}
assert.equal(pool.bytes,before.poolBytes);
flush();await tick();
assert.deepEqual(bytes(gpu.position),before.gpuPositions);assert.deepEqual(bytes(gpu.normal),before.gpuExtras);assert.deepEqual(bytes(gpu.base),before.gpuBase);
assert.deepEqual(bytes(t.numeric.positions),before.rawPositions);assert.deepEqual(bytes(t.numeric.extras),before.rawExtras);
assert.deepEqual(bytes(rawGPU.position),before.rawGPUPositions);assert.deepEqual(bytes(rawGPU.normal),before.rawGPUExtras);
assert.deepEqual(bytes(t.p.array),before.authorPositions);assert.deepEqual(bytes(t.n.array),before.authorNormals);assert.deepEqual(bytes(t.index.array),before.authorIndex);
assert(backups.every(buffer=>buffer.destroyed));

// The exact same Bind can then succeed, retaining the selected GPU/display/worker.
const retryStart=created.length;c.frameAffineBind(stage,snapshot,true);
assert.equal(r.gpu,gpu);assert.equal(r.display,display);assert.equal(r.workerPipe,worker);
assert.equal(workerCloses,0);assert.equal(c.frameAffineBindingCurrent(r),true);
assert.equal(rawGPU.disposed,true);assert.equal(oldDisposals,1);
assert.equal(before.packet.isCurrent(),false);assert.equal(before.aliasCapture.isCurrent(),false);
assert.equal(t.engine.geometryCache.rows.has(before.geometry),false);
await Promise.resolve();assert(created.slice(retryStart).every(buffer=>!buffer.destroyed));
flush();await tick();
assert.deepEqual(bytes(gpu.position),bytes(r.numeric.positions));assert.deepEqual(bytes(gpu.normal),bytes(r.numeric.extras));
assert(created.slice(retryStart).every(buffer=>buffer.destroyed));
const afterPacket=captureDisplayObject(mesh,{geometryCache:t.engine.geometryCache});assert(afterPacket.isCurrent());
assert.equal(afterPacket.packets[0].geometry.positions,r.numeric.positions);
assert.deepEqual(t.engine.geometryCache.capture(mesh.geometry).positions,snapshot.attrs.position.array);
pool.release(rawBorrow);pool.release(selectedPositionBorrow);pool.release(selectedNormalBorrow);
c.frameAffinePruneBindings({clear:true});flush();await tick();
assert.equal(workerCloses,1);assert.equal(pool.bytes,0);assert(created.every(buffer=>buffer.destroyed));
console.log(JSON.stringify({pass:true,
 scope:'Exact editor Bind plus actual native display/cache/pool with interpreted queue; worker identity mocked; no hardware/browser acceptance',
 passed:['Retained worker confirmed-version upload path reached','Partial position upload then normal upload fault','Exact original CPU corner and GPU position/normal bytes restored','Original geometry, raw CPU/GPU cache, adapter, binding, stage and history preserved','Shared buffer identities and pool refs unchanged','Checkpoint lifetime extends through queue completion','Same Bind retries successfully with retained GPU/display/worker','All pool bytes and buffers retired'],
 errors:[],cornerByteDifferencesAfterRollback:0,gpuByteDifferencesAfterRollback:0,selectedWritesBeforeFault:selectedWrites,workerClosesAtFinalRetirement:workerCloses
},null,2));
