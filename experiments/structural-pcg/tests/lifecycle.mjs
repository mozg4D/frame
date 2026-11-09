import test from 'node:test';
import assert from 'node:assert/strict';
import {createGrid,faceLoad} from '../hex8-reference.js';
const {createGPUPCG}=await import(process.env.STRUCTURAL_PCG_MODULE || '../gpu-pcg.js');
globalThis.GPUBufferUsage={UNIFORM:1,STORAGE:2,COPY_SRC:4,COPY_DST:8,MAP_READ:16};
globalThis.GPUMapMode={READ:1};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
// Command emulator only: deterministic successful scalar checkpoints, no FEM
// arithmetic or real hardware. Delays/errors exercise ownership across awaits.
function device(){
 const d={allocated:[],scopeStack:[],scopePushes:0,submits:0,diagnosticMaps:0,
  queueWait:null,mapWait:null,diagnosticError:null,throwCopy:false,
  lost:new Promise(()=>{}),limits:{maxStorageBufferBindingSize:1e9,maxBufferSize:1e9,maxComputeWorkgroupsPerDimension:65535}};
 let reads=0;
 d.pushErrorScope=filter=>{d.scopePushes++;d.scopeStack.push({filter,error:null});};
 d.popErrorScope=async()=>{assert.ok(d.scopeStack.length,'scope underflow');return d.scopeStack.pop().error;};
 d.createShaderModule=()=>({async getCompilationInfo(){return {messages:[]};}});
 d.createComputePipelineAsync=async()=>({getBindGroupLayout:()=>({})});
 d.createBindGroup=()=>({});
 d.createBuffer=({size,label})=>{
  const b={size,label,mapState:'unmapped',destroyed:false,
   async mapAsync(){if(label!=='Structural scalar checkpoint'){d.diagnosticMaps++;if(d.mapWait)await d.mapWait.promise;}if(this.destroyed)throw Error('mapping destroyed buffer');this.mapState='mapped';},
   getMappedRange(){assert.equal(this.mapState,'mapped');const bytes=new ArrayBuffer(size);if(label==='Structural scalar checkpoint'){const f=new Float32Array(bytes),u=new Uint32Array(bytes);f[0]=f[1]=f[2]=1;u[8]=reads++===0?2:1;f[3]=u[8]===1?0:1;}return bytes;},
   unmap(){this.mapState='unmapped';},destroy(){this.destroyed=true;}};
  d.allocated.push(b);return b;
 };
 d.createCommandEncoder=()=>({beginComputePass:()=>({setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}}),
  copyBufferToBuffer(source,offset,target){
   if(target.label==='Structural scalar checkpoint')return;
   if(d.diagnosticError){const scope=d.scopeStack.findLast(s=>s.filter==='validation');if(scope)scope.error={message:d.diagnosticError};}
   if(d.throwCopy)throw Error('injected synchronous copy failure');
  },finish:()=>({})});
 d.queue={writeBuffer(){},submit(){d.submits++;},async onSubmittedWorkDone(){if(d.queueWait)await d.queueWait.promise;}};
 return d;
}
async function fixture(d=device(),extra={}){
 const g=createGrid({cells:[2,1,1],spacing:[.01,.01,.01],materials:[{young:210e9,poisson:.3,yieldStrength:250e6}]});
 const constraints=Array.from({length:g.nodeCount},(_,n)=>n).filter(n=>g.position(n)[0]===0).flatMap(n=>[0,1,2].map(k=>({dof:3*n+k})));
 const solver=await createGPUPCG(d,g,{loads:faceLoad(g,0,1,[1000,0,0]),constraints,...extra});
 return {d,solver};
}
async function converged(d,extra){const f=await fixture(d,extra);assert.equal((await f.solver.run()).converged,true);return f;}
const temporary=d=>d.allocated.filter(b=>b.label==='Structural bounded displacement inspection'||!b.label);

test('every dispose caller awaits the same completed retirement',async()=>{
 const {d,solver}=await converged();d.queueWait=deferred();
 const first=solver.dispose(),second=solver.dispose();let secondDone=false;second.then(()=>secondDone=true);
 await tick();assert.equal(secondDone,false,'second dispose returned while owned buffers were live');
 assert.equal(d.allocated.some(b=>b.destroyed),false);
 d.queueWait.resolve();await Promise.all([first,second]);assert.ok(d.allocated.every(b=>b.destroyed));assert.equal(solver.summary(),null);
});

test('bounded diagnostic reads exclude concurrent temporary allocations',async()=>{
 const {d,solver}=await converged();d.mapWait=deferred();
 const first=solver.inspectDisplacement({count:4});await tick();const allocated=d.allocated.length;
 const second=solver.inspectDisplacement({count:4});const rejection=assert.rejects(second,/idle|current|Converged/);
 d.mapWait.resolve();await rejection;assert.equal(d.allocated.length,allocated);await first;
 assert.equal(solver.summary().vectorReadbackBytes,64);await solver.dispose();assert.ok(d.allocated.every(b=>b.destroyed));
});

test('copy validation error rejects instead of exposing a zero diagnostic and releases its buffer',async()=>{
 const {d,solver}=await converged();const before=d.scopePushes;d.diagnosticError='injected diagnostic validation failure';
 await assert.rejects(solver.inspectDisplacement({count:1}),/injected diagnostic validation failure/);
 assert.equal(d.scopePushes-before,2);assert.equal(d.scopeStack.length,0);assert.equal(d.diagnosticMaps,0);
 assert.ok(temporary(d).every(b=>b.destroyed));assert.equal(solver.summary().vectorReadbackBytes,0);
 d.diagnosticError=null;assert.equal((await solver.inspectDisplacement({count:1})).length,1);await solver.dispose();
});

test('dispose waits for pending diagnostics and stale readback never escapes',async()=>{
 const {d,solver}=await converged();d.mapWait=deferred();
 const read=solver.inspectDisplacement({count:3});const rejected=assert.rejects(read,/Stale/);await tick();
 let retired=false;const first=solver.dispose(),second=solver.dispose();second.then(()=>retired=true);
 await tick();assert.equal(retired,false);assert.equal(solver.summary(),null);
 d.mapWait.resolve();await rejected;await Promise.all([first,second]);assert.ok(d.allocated.every(b=>b.destroyed));
});

test('map rejection cleans the temporary allocation and permits a later inspection',async()=>{
 const {d,solver}=await converged();d.mapWait=deferred();const read=solver.inspectDisplacement({count:2});
 const rejected=assert.rejects(read,/injected map failure/);await tick();d.mapWait.reject(Error('injected map failure'));await rejected;
 assert.ok(temporary(d).every(b=>b.destroyed));d.mapWait=null;
 assert.equal((await solver.inspectDisplacement({count:2})).length,2);await solver.dispose();
});

test('synchronous copy failure drains scopes and retires temporary allocation',async()=>{
 const {d,solver}=await converged();d.throwCopy=true;
 await assert.rejects(solver.inspectDisplacement({count:2}),/injected synchronous copy failure/);
 assert.equal(d.scopeStack.length,0);assert.ok(temporary(d).every(b=>b.destroyed));d.throwCopy=false;
 await solver.inspectDisplacement({count:1});await solver.dispose();
});

test('owner change while mapping discards diagnostic data and cleans mapping',async()=>{
 let current=true;const {d,solver}=await converged(device(),{isCurrent:()=>current});d.mapWait=deferred();
 const read=solver.inspectDisplacement({count:2});const rejected=assert.rejects(read,/Stale/);await tick();current=false;d.mapWait.resolve();await rejected;
 assert.ok(temporary(d).every(b=>b.destroyed&&b.mapState==='unmapped'));assert.equal(solver.summary(),null);await solver.dispose();
});

test('disposal before queued run starts prevents work submission',async()=>{
 const {d,solver}=await fixture();const run=solver.run();const rejected=assert.rejects(run,/Stale/);const disposal=solver.dispose();
 await rejected;await disposal;assert.equal(d.submits,0);assert.ok(d.allocated.every(b=>b.destroyed));
});

test('100 completed bounded reads and retirement stay within 1 second',async()=>{
 const {d,solver}=await converged();const start=performance.now();
 for(let i=0;i<100;i++)await solver.inspectDisplacement({count:4});await solver.dispose();
 const ms=performance.now()-start;assert.ok(ms<1000,`${ms} ms`);assert.ok(d.allocated.every(b=>b.destroyed));
 console.log(JSON.stringify({operation:'100 emulated bounded diagnostic reads and retirement',ms,budgetMs:1000,hardwareValidated:false}));
});
