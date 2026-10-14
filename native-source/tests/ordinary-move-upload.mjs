import assert from 'node:assert/strict';
import {GpuBufferPool} from '../gpu-resources.mjs';
import {installOrdinaryMoveUpload} from '../ordinary-move-upload.mjs';
installOrdinaryMoveUpload(GpuBufferPool);
globalThis.GPUBufferUsage={STORAGE:128};
function device(){const buffers=[];return {buffers,limits:{maxBufferSize:1048576,maxStorageBufferBindingSize:1048576},createBuffer({size}){const storage=new ArrayBuffer(size),row={storage,destroyed:false,mapped:true,getMappedRange(){assert(this.mapped);return storage;},unmap(){this.mapped=false;},destroy(){assert(!this.destroyed,'GPU buffer destroyed once');this.destroyed=true;}};buffers.push(row);return row;}};}
const rows=[];
async function test(name,run){await run();rows.push({name,pass:true});}
await test('bounded upload remains unpublished while its main-thread copies are sliced',async()=>{
  const d=device(),pool=new GpuBufferPool(d),data=Uint8Array.from({length:1025},(_,i)=>i%251);let turns=0;
  const row=await pool.borrowAsync(data,128,'public packet',{sliceBytes:64,yieldTask:async()=>{turns++;assert.throws(()=>pool.borrow(data,128),{name:'InvalidStateError'});}});
  assert.equal(turns,17);assert.deepEqual(new Uint8Array(row.buffer.storage).subarray(0,data.length),data);
  assert.equal(d.buffers.length,1);assert.equal(pool.borrow(data,128),row);pool.release(row);pool.release(row);assert(row.buffer.destroyed);
});
await test('retired owner cannot publish a partially uploaded packet',async()=>{
  const d=device(),pool=new GpuBufferPool(d);let current=true;
  await assert.rejects(pool.borrowAsync(new Uint8Array(200),128,'cancelled',{sliceBytes:64,isCurrent:()=>current,yieldTask:async()=>{current=false;}}),{name:'AbortError'});
  assert.equal(pool.entries.size,0);assert.equal(pool.ordinaryUploads.size,0);assert.equal(pool.bytes,0);assert(d.buffers[0].destroyed);
});
await test('concurrent borrowers share one owned upload and receive separate references',async()=>{
  const d=device(),pool=new GpuBufferPool(d),data=new Uint8Array(400);let release;const gate=new Promise(r=>release=r);let first=true;
  const a=pool.borrowAsync(data,128,'shared',{sliceBytes:64,yieldTask:async()=>{if(first){first=false;await gate;}}});
  const b=pool.borrowAsync(data,128,'shared');release();const [ra,rb]=await Promise.all([a,b]);
  assert.equal(ra,rb);assert.equal(ra.refs,2);assert.equal(d.buffers.length,1);pool.release(ra);pool.release(rb);
});
await test('device/pool retirement during upload releases all unpublished GPU memory',async()=>{
  const d=device(),pool=new GpuBufferPool(d);
  await assert.rejects(pool.borrowAsync(new Uint8Array(300),128,'loss',{sliceBytes:64,yieldTask:async()=>pool.dispose()}),{name:'AbortError'});
  assert.equal(pool.ordinaryUploads.size,0);assert.equal(pool.bytes,0);assert(d.buffers[0].destroyed);
});
console.log(JSON.stringify({pass:true,cases:rows.length,rows,scope:'Staged GPU communication copies and ownership; mocked GPU, no hardware latency claim'}));
