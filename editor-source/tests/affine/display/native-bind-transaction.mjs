import {reviewURL} from '../source-paths.mjs';
import {verifySource} from '../verify-source.mjs';
import {verifyCandidate} from './verify-candidate.mjs';
import assert from 'node:assert/strict';
const {GpuAffineCornerPreview}=await import(reviewURL('../candidate/native-source/gpu-affine-preview.mjs',import.meta.url));
const {GpuBufferPool}=await import(reviewURL('../candidate/native-source/gpu-resources.mjs',import.meta.url));
verifySource();verifyCandidate();

// Portable version of the submitted V4c authoring-transaction control. The
// native pool and transaction are real; queue byte copies are CPU-interpreted.
globalThis.GPUBufferUsage={STORAGE:128};
const created=[],identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
let fault=null,done=()=>Promise.resolve(),submits=0;
const device={
 limits:{maxBufferSize:1<<26,maxStorageBufferBindingSize:1<<26,maxComputeWorkgroupsPerDimension:65535},
 queue:{
  submit(commands){
   if(fault==='submit')throw Error('injected submit');
   for(const cmd of commands)for(const [a,ao,b,bo,n]of cmd)new Uint8Array(b.data,bo,n).set(new Uint8Array(a.data,ao,n));
   submits++;
  },
  writeBuffer(target,offset,data){
   if(fault==='normal'&&target===gpu.normal)throw Error('injected normal upload');
   new Uint8Array(target.data,offset,data.byteLength).set(new Uint8Array(data.buffer,data.byteOffset,data.byteLength));
  },
  onSubmittedWorkDone:()=>done()
 },
 createBuffer(d){
  if(fault==='allocation')throw Error('injected allocation');
  const b={size:d.size,usage:d.usage,data:new ArrayBuffer(d.size),destroyed:false,
   getMappedRange(){return this.data;},unmap(){},destroy(){this.destroyed=true;}};
  created.push(b);return b;
 },
 createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),
 createBindGroupLayout:()=>({}),createPipelineLayout:()=>({}),createComputePipelineAsync:async()=>({}),
 createCommandEncoder(){
  if(fault==='encoder')throw Error('injected encoder');
  const commands=[];return{copyBufferToBuffer(...args){commands.push(args);},finish(){return commands;}};
 }
};
const positions=Float32Array.of(0,0,0,1,0,0,0,1,0),extras=Float32Array.from({length:27},(_,i)=>i+.5);
const pool=new GpuBufferPool(device),gpu=await GpuAffineCornerPreview.create({device,pool,positions,extras,ids:Uint32Array.of(0,1,2)});
const shared=pool.borrow(positions,128),sharedNormals=pool.borrow(extras,128);
assert.equal(shared.buffer,gpu.position);assert.equal(sharedNormals.buffer,gpu.normal);
const refs=()=>[...pool.entries.values()].flatMap(v=>[...v.values()]).map(r=>r.refs);
const beforeRefs=refs(),beforePoolBytes=pool.bytes,oldCPU=positions.slice(),oldExtras=extras.slice();
new Float32Array(gpu.position.data)[0]=19.25;
new Float32Array(gpu.normal.data)[0]=-37.5;
const oldP=new Uint8Array(gpu.position.data).slice(),oldN=new Uint8Array(gpu.normal.data).slice();
gpu.gathered=true;
const tx=gpu.beginAuthoringTransaction();
assert.throws(()=>gpu.submit({matrix:identity,world:identity,basis:identity}),/transaction owns/);
assert.throws(()=>gpu.restoreFrozenSource(),/transaction owns/);
assert.throws(()=>gpu.beginAuthoringTransaction(),/already open/);
positions.fill(7);extras.fill(11);fault='normal';
assert.throws(()=>gpu.writeAuthoringRanges([[0,3]]),/normal upload/);fault=null;
assert.notDeepEqual(new Uint8Array(gpu.position.data),oldP,'partial upload must change GPU positions');
positions.set(oldCPU);extras.set(oldExtras);
let release;done=()=>new Promise(resolve=>release=resolve);
tx.rollback();
assert.deepEqual(new Uint8Array(shared.buffer.data),oldP);
assert.deepEqual(new Uint8Array(sharedNormals.buffer.data),oldN);
assert.equal(gpu.gathered,true);assert.equal(gpu.authoringTransaction,null);
assert.deepEqual(refs(),beforeRefs);assert.equal(pool.bytes,beforePoolBytes);
const same=pool.borrow(positions,128);assert.equal(same.buffer,shared.buffer);pool.release(same);
const backups=created.filter(b=>b!==gpu.base&&!gpu.borrowed.some(r=>r.buffer===b));
assert.equal(backups.length,2);assert(backups.every(b=>b.usage===(4|8)&&!b.destroyed));
await Promise.resolve();release();await new Promise(setImmediate);
assert(backups.every(b=>b.destroyed));
const afterRollbackSubmits=submits;tx.rollback();tx.commit();assert.equal(submits,afterRollbackSubmits);
done=()=>Promise.resolve();

// These are the same three transaction-start fault controls supplied with V4c.
const rows=[];
for(const kind of ['allocation','encoder','submit']){
 const start=created.length;fault=kind;
 assert.throws(()=>gpu.beginAuthoringTransaction(),/injected/);fault=null;
 assert(created.slice(start).every(b=>b.destroyed));
 assert.equal(gpu.authoringTransaction,null);assert.deepEqual(refs(),beforeRefs);
 assert.equal(pool.bytes,beforePoolBytes);
 assert.deepEqual(new Uint8Array(gpu.position.data),oldP);assert.deepEqual(new Uint8Array(gpu.normal.data),oldN);
 rows.push(kind);
}
const commit=gpu.beginAuthoringTransaction();commit.commit();commit.commit();
await new Promise(setImmediate);
gpu.dispose();pool.release(shared);pool.release(sharedNormals);await new Promise(setImmediate);
assert.equal(pool.bytes,0);assert(created.every(b=>b.destroyed));
console.log(JSON.stringify({
 pass:true,scope:'Exact native source and actual shared pool with byte-copy queue mock; no hardware assertion',
 partialUploadRollbackPositionNormalBits:0,sharedPoolBufferIdentity:true,poolRefsUnchanged:true,
 exclusiveTransactionGuards:true,idempotentFinish:true,backupsRetiredAfterCompletion:true,
 allocationEncoderSubmitFaults:rows,allBuffersRetired:true,submits
},null,2));
