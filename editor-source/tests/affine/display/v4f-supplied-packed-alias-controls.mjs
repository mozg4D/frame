import {reviewURL} from '../source-paths.mjs';
import {verifySource} from '../verify-source.mjs';
import {verifyCandidate} from './verify-candidate.mjs'; verifySource();verifyCandidate();
import assert from'node:assert/strict';import * as T from'../fixtures/three-core.mjs';
import {device,flush,GpuBufferPool} from './queue-interpreter.mjs';
const {DisplayGeometryCache}=await import(reviewURL('../candidate/native-source/display-packets.mjs',import.meta.url));
const {GpuRigidIslandPreview,registerRigidGpuGeometry,installRigidGpuAttributeViews,captureRigidGpuGeometry,unregisterRigidGpuGeometry}=await import(reviewURL('../candidate/native-source/gpu-island-preview.mjs',import.meta.url));
const g=new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(Float32Array.of(0,0,0,1,0,0,0,1,0),3)).setAttribute('normal',new T.BufferAttribute(Float32Array.of(0,0,1,0,0,1,0,0,1),3)).setIndex(new T.BufferAttribute(Uint32Array.of(0,1,2),1)),cache=new DisplayGeometryCache(),numeric=cache.capture(g),wire=new T.BufferGeometry().setAttribute('position',g.attributes.position).setIndex(new T.BufferAttribute(Uint32Array.of(0,1,1,2,2,0),1)),seed=cache.capture(wire);
// This row has actually been packed/validated by DisplayGeometryCache; only the
// same position storage and identical already-validated unsigned IDs are reused.
seed.positions=numeric.positions;seed.indices=wire.index.array;cache.rows.set(wire,seed);let ownerCurrent=true;const e=registerRigidGpuGeometry(g,numeric,{isCurrent:()=>ownerCurrent});installRigidGpuAttributeViews(e);
const first=cache.capture(wire);assert.equal(first.positions,numeric.positions);assert.equal(first.extras,seed.extras);assert.equal(e.aliases.get(wire).extras,seed.extras);assert.deepEqual([...first.extras],[...seed.extras]);assert(first.isCurrent());assert(!first.hasNormals&&!first.hasUV&&!first.hasColors);
const pool=new GpuBufferPool(device),gpu=await GpuRigidIslandPreview.create({device,pool,positions:numeric.positions,extras:numeric.extras,ids:Uint32Array.of(0,1,2),isCurrent:()=>ownerCurrent}),borrow=pool.borrow(first.positions,128);assert.equal(borrow.buffer,gpu.position);
wire.index.needsUpdate=true;const refreshed=cache.capture(wire);assert.notEqual(refreshed.extras,seed.extras);assert.deepEqual([...refreshed.extras],[...seed.extras]);assert.equal(first.isCurrent(),false);
wire.index.array[0]=99;wire.index.needsUpdate=true;assert.throws(()=>cache.capture(wire),/out of range/);wire.index.array[0]=0;wire.index.needsUpdate=true;
ownerCurrent=false;assert.equal(captureRigidGpuGeometry(wire,seed),null);assert.equal(refreshed.isCurrent(),false);ownerCurrent=true;
const wrong={...seed,extras:new Float32Array(1),isCurrent:()=>true};e.aliases.delete(wire);const fallback=captureRigidGpuGeometry(wire,wrong);assert.notEqual(fallback.extras,wrong.extras);assert.equal(fallback.extras.length,27);
gpu.dispose();pool.release(borrow);unregisterRigidGpuGeometry(g);flush();await new Promise(setImmediate);assert.equal(pool.bytes,0);
console.log(JSON.stringify({pass:true,scope:'Actual native cache, adapters, buffer pool, interpreted byte queue; synthetic geometry, not hardware',checks:['validated packed wire extras reused','wire and raw share live mutable GPU position storage','changed index version invalidates packet and cached alias','invalid changed wire index rejected','retired owner cannot return rigid alias','wrong cached extras layout uses validated fallback','owned GPU pool retired completely']},null,2));
