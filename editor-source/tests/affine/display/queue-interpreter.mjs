import {reviewURL} from '../source-paths.mjs';
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
let pending=[],fences=[];const flush=()=>{while(pending.length)pending.shift()();for(const resolve of fences.splice(0))resolve();};
const device={limits:{maxBufferSize:1<<26,maxStorageBufferBindingSize:1<<26,maxComputeWorkgroupsPerDimension:65535},queue:{submit(buffers){for(const list of buffers)for(const command of list)pending.push(command);},writeBuffer(b,offset,data){const bytes=new Uint8Array(data.buffer,data.byteOffset,data.byteLength).slice();pending.push(()=>new Uint8Array(b.data,offset,bytes.length).set(bytes));},onSubmittedWorkDone:()=>pending.length?new Promise(resolve=>fences.push(resolve)):Promise.resolve()},createBuffer(d){const b={size:d.size,usage:d.usage,data:new ArrayBuffer(d.size),destroyed:false,getMappedRange(){return this.data;},unmap(){},mapAsync(){return device.queue.onSubmittedWorkDone();},destroy(){this.destroyed=true;}};created.push(b);return b;},createShaderModule(d){return{...d,getCompilationInfo:async()=>({messages:[]})};},createBindGroupLayout(){return{};},createPipelineLayout(){return{};},createComputePipelineAsync:async d=>({entry:d.compute.entryPoint}),createBindGroup(d){return d;},createCommandEncoder(){const list=[];return{beginComputePass(){let bind,pipeline;return{setBindGroup(i,b){bind=b;},setPipeline(p){pipeline=p;},dispatchWorkgroups(){const b=bind,p=pipeline;list.push(()=>{commands.push(p.entry);execute(p.entry,b);});},end(){}};},copyBufferToBuffer(a,ao,b,bo,n){list.push(()=>new Uint8Array(b.data,bo,n).set(new Uint8Array(a.data,ao,n)));},finish(){return list;}};}};

export {device,created,commands,floats,ints,flush,GpuAffineCornerPreview,GpuBufferPool};
