import assert from 'node:assert/strict';
import * as THREE from '../../modules/frame-three-core.9edde002b066a9a05676.js';
import * as rigid from '../gpu-island-preview.mjs';
import {GpuAffineCornerPreview} from '../gpu-affine-preview.mjs';
import {BoundedPoseSubmit} from '../bounded-pose-submit.mjs';
import {GpuBufferPool} from '../gpu-resources.mjs';
import {OrdinaryMoveDisplayRoot} from '../ordinary-move-display.mjs';
globalThis.GPUBufferUsage = {STORAGE: 128};
const native = {...rigid, GpuAffineCornerPreview, BoundedPoseSubmit};
const identity = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const translate = x => {const m = identity.slice(); m[12] = x; return m;};

// Runs the production ownership/queue/pool classes. Shader math is emulated;
// hardware compilation and latency are reserved for the integrated browser test.
function device() {
  const buffers = [];
  const d = {buffers, limits: {maxBufferSize: 1<<24, maxStorageBufferBindingSize: 1<<24, maxComputeWorkgroupsPerDimension: 65535},
    createBuffer({size, usage, mappedAtCreation = false}) {
      const storage = new ArrayBuffer(size), row = {size, usage, storage, destroyed: false, mapped: mappedAtCreation,
        getMappedRange(){assert(this.mapped); return storage;}, unmap(){this.mapped = false;},
        destroy(){assert(!this.destroyed); this.destroyed = true;}};
      buffers.push(row); return row;
    },
    createShaderModule(){return {getCompilationInfo: async () => ({messages: []})};},
    createBindGroupLayout: q => q, createPipelineLayout: q => q,
    createComputePipelineAsync: async q => q.compute, createBindGroup: q => q,
    createCommandEncoder() {const operations = []; return {
      beginComputePass(){let bind, pipeline; return {setBindGroup(i,b){bind=b;},setPipeline(p){pipeline=p;},
        dispatchWorkgroups(){operations.push({bind,pipeline});},end(){}};}, finish(){return operations;}};
    }
  };
  d.queue = {onSubmittedWorkDone: () => d.completion || Promise.resolve(), submit(commands) {
    for (const ops of commands) for (const {bind, pipeline} of ops) {
      const [ib,pb,bb,nb,ub] = bind.entries.map(e => e.resource.buffer);
      for (const b of [ib,pb,bb,nb,ub]) assert(!b.destroyed);
      const ids = new Uint32Array(ib.storage), p = new Float32Array(pb.storage), base = new Float32Array(bb.storage), n = new Float32Array(nb.storage), m = new Float32Array(ub.storage);
      for (let k = 0; k < ids.length; k++) {const at=ids[k]*3, normal=ids[k]*9, source=k*6;
        if(pipeline.entryPoint==='gather') for(let c=0;c<3;c++){base[source+c]=p[at+c];base[source+3+c]=n[normal+c];}
        if(pipeline.entryPoint==='pose') for(let c=0;c<3;c++) p[at+c]=m[c]*base[source]+m[c+4]*base[source+1]+m[c+8]*base[source+2]+m[c+12];
        if(pipeline.entryPoint==='restore') for(let c=0;c<3;c++){p[at+c]=base[source+c];n[normal+c]=base[source+3+c];}
      }
    }
  }};
  return d;
}
async function fixture() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(Float32Array.from([0,0,0,1,0,0,0,1,0,2,0,0,3,0,0,2,1,0]),3));
  const normals=new Float32Array(18); for(let i=2;i<18;i+=3)normals[i]=1;
  geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));geometry.setIndex(new THREE.BufferAttribute(Uint16Array.from([0,1,2,3,4,5]),1));
  const extras=new Float32Array(54);for(let i=0;i<6;i++)extras[i*9+2]=1;
  const mesh=new THREE.Mesh(geometry), numeric={positions:geometry.attributes.position.array.slice(),extras,indices:geometry.index.array.slice(),vertexCount:6,hasNormals:true,hasUV:false,hasColors:false};
  const d=device(),pool=new GpuBufferPool(d),root=new OrdinaryMoveDisplayRoot({native,mesh,numeric,device:d,pool,isCurrent:()=>true,yieldTask:async()=>{}});
  await root.initialize();return{root,mesh,numeric,d,pool};
}
function selected(ids) {const rawIDs=Uint32Array.from(ids),rawMask=new Uint8Array(6);for(const i of ids)rawMask[i]=1;return{rawIDs,rawMask,world:identity,inverse:identity};}
const rows=[];
async function test(name,run){await run();rows.push({name,pass:true});}
await test('simultaneous begins admit one owner; CPU arrays remain immutable',async()=>{
  const {root,mesh,pool}=await fixture();const running=root.begin(selected([0,1,2]));
  await assert.rejects(root.begin(selected([3,4,5])),{name:'AbortError'});
  const a=await running;root.pose(a,translate(.25),translate(.25));await a.scheduler.whenIdle();
  assert.equal(root.position(0)[0],.25);assert.equal(mesh.geometry.attributes.position.array[0],0);
  await root.dispose();assert.equal(pool.bytes,0);
});
await test('released A survives B; cancelling B restores A and blocks a competing begin',async()=>{
  const{root,pool}=await fixture();const a=await root.begin(selected([0,1,2]));root.pose(a,translate(.25),translate(.25));root.release(a);
  const b=await root.begin(selected([0,1,2,3,4,5]));root.pose(b,translate(.5),translate(.5));await b.scheduler.whenIdle();
  assert.equal(root.position(0)[0],.75);assert.equal(new Float32Array(b.gpu.position.storage)[0],.75);
  const cancelling=root.cancelFrom(b);await assert.rejects(root.begin(selected([3,4,5])),{name:'AbortError'});await cancelling;
  assert.equal(root.position(0)[0],.25);assert.equal(new Float32Array(a.gpu.position.storage)[0],.25);assert.equal(root.position(3)[0],2);
  assert.equal(await root.cancelFrom(b),false);await root.cancelFrom(a);assert.equal(root.position(0)[0],0);await root.dispose();assert.equal(pool.bytes,0);
});
await test('retirement during asynchronous begin cleans all unpublished and borrowed rows',async()=>{
  const {root,d,pool}=await fixture();let release;const gate=new Promise(r=>release=r);root.yieldTask=()=>gate;
  const pending=root.begin(selected([0,1,2]));await root.dispose();release();await assert.rejects(pending,{name:'AbortError'});
  assert.equal(pool.bytes,0);assert(d.buffers.every(b=>b.destroyed));
});
await test('another root cannot acquire or unregister the current GPU geometry owner',async()=>{
  const {root,mesh,numeric,d,pool}=await fixture();
  const second=new OrdinaryMoveDisplayRoot({native,mesh,numeric,device:d,pool,isCurrent:()=>true});
  await assert.rejects(second.initialize(),{name:'AbortError'});await second.dispose();assert(root.current());assert(rigid.captureRigidGpuGeometry(mesh.geometry));
  await root.dispose();assert.equal(pool.bytes,0);
});
console.log(JSON.stringify({pass:true,cases:rows.length,rows,scope:'Production GPU ownership, cancellation, queue and resource lifetime with emulated shader execution; no hardware claim'}));
