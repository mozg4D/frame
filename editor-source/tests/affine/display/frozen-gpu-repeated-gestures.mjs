import {reviewURL} from '../source-paths.mjs';
import {verifyCandidate} from './verify-candidate.mjs';verifyCandidate();
import assert from 'node:assert/strict';
const {GpuAffineCornerPreview}=await import(reviewURL('../candidate/native-source/gpu-affine-preview.mjs',import.meta.url));
const {GpuBufferPool}=await import(reviewURL('../candidate/native-source/gpu-resources.mjs',import.meta.url));
globalThis.GPUBufferUsage={STORAGE:128};const created=[],commands=[];
const floats=b=>new Float32Array(b.data),ints=b=>new Uint32Array(b.data);
function execute(entry,bind){const b=bind.entries.map(e=>e.resource.buffer);if(['reduce','finish'].includes(entry))return;const ids=ints(b[0]),p=floats(b[1]),base=floats(b[2]),n=floats(b[3]),u=floats(b[4]),count=ints(b[4])[64];
 for(let k=0;k<count;k++){const pi=ids[k]*3,ni=ids[k]*9,bi=k*6;
  if(entry==='gather'){base.set(p.subarray(pi,pi+3),bi);base.set(n.subarray(ni,ni+3),bi+3);}
  else if(entry==='restore'){p.set(base.subarray(bi,bi+3),pi);n.set(base.subarray(bi+3,bi+6),ni);}
  else if(entry==='pose'){const a=base[bi],b=base[bi+1],c=base[bi+2],w=u[3]*a+u[7]*b+u[11]*c+u[15];p[pi]=(u[0]*a+u[4]*b+u[8]*c+u[12])/w;p[pi+1]=(u[1]*a+u[5]*b+u[9]*c+u[13])/w;p[pi+2]=(u[2]*a+u[6]*b+u[10]*c+u[14])/w;}
  else if(entry==='normals'){const a=base[bi+3],b=base[bi+4],c=base[bi+5],m=u.subarray(48,64),x=m[0]*a+m[4]*b+m[8]*c,y=m[1]*a+m[5]*b+m[9]*c,z=m[2]*a+m[6]*b+m[10]*c,l=Math.hypot(x,y,z)||1;n[ni]=x/l;n[ni+1]=y/l;n[ni+2]=z/l;}
 }
}
let current=true;
const device={limits:{maxBufferSize:1<<26,maxStorageBufferBindingSize:1<<26,maxComputeWorkgroupsPerDimension:65535},queue:{submit(buffers){for(const list of buffers)for(const command of list)command();},writeBuffer(b,offset,data){new Uint8Array(b.data,offset,data.byteLength).set(new Uint8Array(data.buffer,data.byteOffset,data.byteLength));},onSubmittedWorkDone:()=>Promise.resolve()},createBuffer(d){const b={size:d.size,usage:d.usage,data:new ArrayBuffer(d.size),destroyed:false,getMappedRange(){return this.data;},unmap(){},mapAsync(){return Promise.resolve();},destroy(){this.destroyed=true;}};created.push(b);return b;},createShaderModule(d){return{...d,getCompilationInfo:async()=>({messages:[]})};},createBindGroupLayout(){return{};},createPipelineLayout(){return{};},createComputePipelineAsync:async d=>({entry:d.compute.entryPoint}),createBindGroup(d){return d;},createCommandEncoder(){const list=[];return{beginComputePass(){let bind,pipeline;return{setBindGroup(i,b){bind=b;},setPipeline(p){pipeline=p;},dispatchWorkgroups(){const b=bind,p=pipeline;list.push(()=>{commands.push(p.entry);execute(p.entry,b);});},end(){}};},copyBufferToBuffer(a,ao,b,bo,n){list.push(()=>new Uint8Array(b.data,bo,n).set(new Uint8Array(a.data,ao,n)));},finish(){return list;}};}};
const pool=new GpuBufferPool(device),original=Float32Array.of(1,0,0,2,0,0,1,1,0),extras=new Float32Array(27);for(let i=0;i<3;i++)extras[i*9+2]=1;
const pose=await GpuAffineCornerPreview.create({device,pool,positions:original.slice(),extras,ids:Uint32Array.of(0,1,2),isCurrent:()=>current});
const I=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],delta=x=>{const m=I.slice();m[12]=x;return m;},expected=(p,x)=>Float32Array.from(p,(v,i)=>i%3===0?v+x:v),check=(p,label)=>assert.deepEqual(floats(pose.position),p,label);
const rows=[];
await pose.submit({matrix:delta(2),world:I,basis:I});check(expected(original,2),'first preview');
const exact=expected(original,20);pose.cpuPositions.set(exact);device.queue.writeBuffer(pose.position,0,exact);const gatherCount=commands.filter(x=>x==='gather').length;
await pose.submit({matrix:delta(3),world:I,basis:I});check(expected(original,3),'same gesture still transforms frozen original, not exact publication');assert.equal(commands.filter(x=>x==='gather').length,gatherCount);
await pose.restoreFrozenSource();check(original,'cancel restores frozen G0 after exact publication');rows.push({case:'One gesture interleaves previews/exact publication then Cancel',frozenBasePreserved:true,restored:true});
for(let gesture=2;gesture<=4;gesture++){const base=expected(original,gesture*20);device.queue.writeBuffer(pose.position,0,base);pose.cpuPositions.set(base);pose.gathered=false;
 await pose.submit({matrix:delta(gesture),world:I,basis:I});check(expected(base,gesture),'next gesture gathers its own G0');
 await pose.submit({matrix:delta(gesture+1),world:I,basis:I});check(expected(base,gesture+1),'next gesture repeated preview');
 await pose.restoreFrozenSource();check(base,'next gesture cancel');rows.push({case:'Repeated gesture '+gesture,newFrozenBase:true,restored:true});}
const before=created.length,refs=pool.bytes;current=false;assert.throws(()=>pose.restoreFrozenSource(),e=>e.name==='AbortError');assert.equal(created.length,before);assert.equal(pool.bytes,refs);rows.push({case:'Stale owner blocks restore before allocation',pass:true});current=true;
let reject;device.queue.onSubmittedWorkDone=()=>new Promise((_,r)=>reject=r);const restore=pose.restoreFrozenSource();await Promise.resolve();const liveBytes=pool.bytes;assert(liveBytes>refs);reject(Error('injected queue completion failure'));await assert.rejects(restore,/injected/);assert.equal(pool.bytes,refs);rows.push({case:'Rejected restore fence retires uniform',pass:true});
device.queue.onSubmittedWorkDone=()=>Promise.resolve();pose.dispose();await Promise.resolve();assert.equal(pool.bytes,0);assert(created.every(x=>x.destroyed));
console.log(JSON.stringify({pass:true,scope:'Exact native GPU command construction and resource lifecycle with CPU command interpreter; no WGSL execution or hardware/raster/performance acceptance',rows,allBuffersDestroyed:true},null,2));
