import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {installSymbols} from '../viewport.js';
import {symbol,bounds} from '../symbols.js';

// Execute the shipped render/cache code with explicit CPU GPU-resource doubles.
// This proves cache invalidation and bounded buffer retirement, not hardware rendering.
export async function netCacheChecks(){
 const started=performance.now(),checks=[],uploads=[],draws=[],buffers=[];
 const check=(name,fn)=>{fn();checks.push({name,pass:true});};
 const saved=Object.fromEntries(['GPUShaderStage','GPUBufferUsage'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 globalThis.GPUShaderStage={VERTEX:1,FRAGMENT:2};globalThis.GPUBufferUsage={VERTEX:1,COPY_DST:2};
 const translation=x=>new Float64Array([1,0,0,0,0,1,0,0,0,0,1,0,x,0,0,1]);
 const M={inv:m=>translation(-m[12]),mul:(a,b)=>translation(a[12]+b[12]),point:(m,p)=>[m[12]+p[0],p[1],p[2]]};
 const owner={id:1,nativeHash:'1'.repeat(32),type:'circuit',visible:true,params:{Nets:true}},group={id:2,type:'group',visible:true,parent:null};
 const a={id:3,nativeHash:'3'.repeat(32),type:'circuit_resistor',visible:true,parent:2},b={id:4,nativeHash:'4'.repeat(32),type:'circuit_resistor',visible:true,parent:null};
 const worlds=new Map([[owner.nativeHash,translation(0)],[a.nativeHash,translation(20)],[b.nativeHash,translation(40)]]),net='5'.repeat(32);
 const data=new Map([[owner,{nets:[{id:net,name:'NET'}]}],[a,{pins:[{net,position:[0,0,0]}]}],[b,{pins:[{net,position:[0,0,0]}]}]]);
 const records=new Map([[a.nativeHash,{pins:'A'}],[b.nativeHash,{pins:'B'}]]);
 let viewport;
 const D={nodes:[owner,group,a,b],world:hash=>worlds.get(hash),records:hash=>records.get(hash)};
 const device={
  createBindGroupLayout:()=>({}),createPipelineLayout:()=>({}),createBindGroup:()=>({}),
  createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),createRenderPipelineAsync:async()=>({}),
  createBuffer:descriptor=>{const buffer={...descriptor,destroyed:false,destroy(){this.destroyed=true;}};buffers.push(buffer);return buffer;},
  queue:{writeBuffer:(buffer,_offset,value)=>{if(buffer.label==='Circuit network authoring lines')uploads.push({buffer,values:Array.from(value)});}},
  lost:new Promise(()=>{})
 };
 const pass={setPipeline(){},setBindGroup(){},setVertexBuffer(_slot,buffer){this.buffer=buffer;},draw(count){draws.push({count,buffer:this.buffer});}},camera={},frame={};
 const render=()=>{const before=draws.length;viewport.render({pass,camera,frame,orthographic:true,hash:owner.nativeHash,device,format:'bgra8unorm'});return draws.length-before;};
 try{
  await installSymbols({document:D,math:M,requestDraw(){},viewport:{register:async descriptor=>viewport=descriptor}},{find:()=>owner,members:()=>[a,b],read:n=>data.get(n),symbol,bounds});
  render();await new Promise(resolve=>setImmediate(resolve));render();
  check('network cache initially uploads expected owner-local pin endpoints',()=>assert.deepEqual(uploads.at(-1).values,[20,0,0,40,0,0]));
  const initial=uploads.at(-1).buffer,initialCount=uploads.length;render();
  check('unchanged owner, visibility and pins reuse the network buffer',()=>assert.equal(uploads.length,initialCount));
  worlds.set(owner.nativeHash,translation(10));render();
  check('independent Circuit-owner translation invalidates the cache',()=>{assert.equal(uploads.length,initialCount+1);assert.deepEqual(uploads.at(-1).values,[10,0,0,30,0,0]);assert(initial.destroyed);});
  check('borrowed owner frame keeps the rebuilt line on world-space pin endpoints',()=>{const v=uploads.at(-1).values,m=worlds.get(owner.nativeHash);assert.deepEqual([...M.point(m,v.slice(0,3)),...M.point(m,v.slice(3,6))],[20,0,0,40,0,0]);});
  const translated=uploads.at(-1).buffer;group.visible=false;const uploadCount=uploads.length;
  check('hiding a component ancestor removes the cached pin and retires the old line',()=>{assert.equal(render(),0);assert.equal(uploads.length,uploadCount);assert(translated.destroyed);assert.equal(a.visible,true);});
  group.visible=true;render();
  check('restoring inherited visibility rebuilds the valid network tree',()=>{assert.equal(uploads.length,uploadCount+1);assert.deepEqual(uploads.at(-1).values,[10,0,0,30,0,0]);});
  D.nodes=[];viewport.retire(owner.nativeHash);
  check('owner retirement releases every owned line/symbol buffer',()=>assert(buffers.every(buffer=>buffer.destroyed)));
  const ms=performance.now()-started;assert(ms<1000,'CPU net-cache regression exceeded its 1000 ms budget');
  return {pass:true,checks,timings:[{name:'Circuit net-cache CPU regression',ms,limit:1000}],scope:'Actual shipped cache code with CPU resource doubles only; no GPU was requested.'};
 }finally{for(const [key,descriptor]of Object.entries(saved)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await netCacheChecks(),null,2));
