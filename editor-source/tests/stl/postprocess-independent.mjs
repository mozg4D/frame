import fs from 'node:fs';import assert from 'node:assert/strict';import {Worker as NodeWorker} from 'node:worker_threads';import {resolveObjectURL} from 'node:buffer';
import {source,fn,sha,hashArray,postSpec as spec,verifyBlob} from './postprocess-source.mjs';
const modified=new Map(spec.edits.map(q=>[q.name,q.after]));
const begin=source.indexOf('const frameComputeBudget=(()=>{'),end=source.indexOf('\nconst splineSurfaceWorkers=',begin),budgetSource=source.slice(begin,end).trim();assert(begin>0&&end>begin);
const createBudget=count=>Function('navigator',budgetSource+';return frameComputeBudget;')({hardwareConcurrency:count+1});
const dependencies=['frameParseSTLPositions','frameSTLGeometryBounds','frameSTLCoordinateHash','frameSTLScalarKey','frameSTLCoordinateClasses','frameSTLEdgeHash','frameSTLEdgeTable','frameSTLEdgeCapacity','frameSTLCreaseData','prepareSplineBVH','frameWireIndices'];
const factory=(candidate,Worker,budget,copyLimit=64*1024*1024)=>Function('Worker','frameComputeBudget',`const CREASE_COS=Math.cos(46*Math.PI/180),frameImportAbortError=()=>Object.assign(Error('aborted'),{name:'AbortError'});${dependencies.map(fn).join('\n')};${candidate?modified.get('frameSTLWorkerMain'):fn('frameSTLWorkerMain')};${candidate?modified.get('framePrepareSTLWorker').replace('const FRAME_STL_POSTPROCESS_COPY_LIMIT=64*1024*1024;', 'const FRAME_STL_POSTPROCESS_COPY_LIMIT='+copyLimit+';'):fn('framePrepareSTLWorker')};const prepare=framePrepareSTLWorker;prepare.inspectCopies=()=>${candidate?'frameSTLPostprocessCopyBytes':'0'};return prepare;`)(Worker,budget);
const prefix="const {parentPort}=require('node:worker_threads');globalThis.self={postMessage(data,transfer=[]){parentPort.postMessage(data,transfer);}};parentPort.on('message',data=>self.onmessage({data}));\n",closing=[];let mode='normal',activeController=null,log=[];
class BrowserWorker{
 constructor(url,{name}={}){this.name=name;this.queue=[];this.dead=false;log.push({type:'create',name});this.pending=resolveObjectURL(url).text().then(code=>{if(this.dead)return;verifyBlob(code);this.worker=new NodeWorker(prefix+code,{eval:true});this.worker.on('error',e=>this.onerror?.({message:e.message}));this.worker.on('message',data=>{if(this.dead)return;
  if(name==='stl-BVH'&&mode==='stale'){this.onmessage?.({data:{...data,id:99}});return;}
  if(name==='stl-BVH'&&mode==='error'){this.onerror?.({message:'injected postprocess failure'});return;}
  if(name==='stl-BVH'&&mode==='unreadable'){this.onmessageerror?.({});return;}
  if(name==='stl-BVH'&&mode==='corrupt'&&data.result?.tree)data.result.tree.bvhBounds=new Float64Array(1);
  if(name==='stl-BVH'&&mode==='cancel-helper'){activeController.abort(Object.assign(Error('cancel helper'),{name:'AbortError'}));setTimeout(()=>this.onmessage?.({data}),0);return;}
  if(name==='stl-import'&&mode==='cancel-coordinator'){activeController.abort(Object.assign(Error('cancel coordinator'),{name:'AbortError'}));setTimeout(()=>this.onmessage?.({data}),0);return;}
  this.onmessage?.({data});if(mode==='duplicate')this.onmessage?.({data});
 });for(const q of this.queue)this.worker.postMessage(q.data,q.transfer);this.queue=[];});}
 postMessage(data,transfer){const moved=structuredClone(data,{transfer}),out=[];for(const k of ['buffer','positions','indices'])if(moved[k] instanceof ArrayBuffer)out.push(moved[k]);else if(ArrayBuffer.isView(moved[k]))out.push(moved[k].buffer);log.push({type:'post',name:this.name,keys:Object.keys(moved),transferBytes:out.reduce((n,b)=>n+b.byteLength,0)});if(this.worker)this.worker.postMessage(moved,out);else this.queue.push({data:moved,transfer:out});}
 terminate(){if(this.dead)return;this.dead=true;log.push({type:'terminate',name:this.name});closing.push(this.pending.then(()=>this.worker?.terminate()));}
}
const binary=n=>{const b=new ArrayBuffer(84+n*50),v=new DataView(b);v.setUint32(80,n,true);for(let f=0;f<n;f++){const p=[f*3,0,0,f*3+1,0,0,f*3,1,0];for(let k=0;k<9;k++)v.setFloat32(96+f*50+k*4,p[k],true);}return b;};
const ascii=n=>new TextEncoder().encode('solid generic\n'+Array.from({length:n},(_,f)=>`facet normal 0 0 1\nouter loop\nvertex ${f*3} 0 0\nvertex ${f*3+1} 0 0\nvertex ${f*3} 1 0\nendloop\nendfacet\n`).join('')+'endsolid generic').buffer;
const fingerprint=v=>{if(ArrayBuffer.isView(v))return{type:v.constructor.name,length:v.length,sha256:hashArray(v)};if(Array.isArray(v))return v.map(fingerprint);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,fingerprint(x)]));return v;};
let cases=0,assertions=0;const records=[];
async function run(candidate,input,{count=3,injection='normal',copyLimit=64*1024*1024}={}){const budget=createBudget(count),controller=new AbortController();mode=injection;activeController=controller;log=[];const activity={signal:controller.signal,update(){},check(){if(controller.signal.aborted)throw controller.signal.reason;}};let result,error;const prepare=factory(candidate,BrowserWorker,budget,copyLimit);
 try{result=await prepare(input.slice(0),activity);}catch(e){error={name:e.name,message:e.message};}
 await Promise.all(closing.splice(0));assert.equal(prepare.inspectCopies(),0);assertions++;assert.equal(budget.inspect().active,0);assert.equal(budget.inspect().running.native,0);assertions+=2;assert(budget.inspect().peak<=count);assertions++;return{out:result?fingerprint(result):null,error,log:log.slice(),budget:budget.inspect()};}

for(const [name,input] of [['uint32-wire-below-sort-cutoff',binary(33333)],['uint32-wire-sorted-binary',binary(33334)],['uint32-wire-sorted-ASCII',ascii(33334)]]){
 const a=await run(false,input,{count:2}),b=await run(true,input,{count:2});assert.deepStrictEqual(b.out,a.out);assert.deepStrictEqual(b.error,a.error);assert.equal(b.out.wireIndices.type,'Uint32Array');assertions+=3;cases++;records.push({name,pass:true,wireType:b.out.wireIndices.type,indexWords:b.out.indices.length});
}
{
 mode='normal';log=[];const budget=createBudget(2),prepare=factory(true,BrowserWorker,budget),controller=new AbortController();let heldResolve,holders=null,heldStarted=false;
 const heldReady=new Promise(resolve=>heldResolve=resolve),activity={signal:controller.signal,check(){if(controller.signal.aborted)throw controller.signal.reason;},update(stage){if(stage==='Preparing object picking'&&!heldStarted){heldStarted=true;Promise.all([budget.acquire('native'),budget.acquire('native')]).then(releases=>{holders=releases;heldResolve();});}}};
 const outcome=prepare(binary(10000),activity).then(value=>({value}),error=>({error}));await heldReady;await new Promise(setImmediate);
 assert.equal(budget.inspect().active,2);assert.equal(budget.inspect().queued.native,2);assert.equal(prepare.inspectCopies(),120000);assert(!log.some(x=>x.type==='create'&&['stl-BVH','stl-wire'].includes(x.name)));assertions+=4;
 controller.abort(Object.assign(Error('queued helper cancellation'),{name:'AbortError'}));const result=await outcome;assert.equal(result.error?.name,'AbortError');assert.equal(prepare.inspectCopies(),0);assert.equal(budget.inspect().queued.native,0);assert.equal(budget.inspect().active,2);assertions+=4;
 for(const release of holders)release();await Promise.all(closing.splice(0));await Promise.resolve();assert.equal(budget.inspect().active,0);assertions++;cases++;records.push({name:'both-helper-leases-queued-cancel',pass:true,copyReservationReturned:true,noHelperWorkerCreated:true});
}
for(const fault of ['constructor','postMessage']){
 mode='normal';log=[];const budget=createBudget(2);
 class FaultWorker extends BrowserWorker{constructor(url,options){if(fault==='constructor'&&options?.name==='stl-BVH')throw Error('injected constructor failure');super(url,options);}postMessage(data,transfer){if(fault==='postMessage'&&this.name==='stl-wire')throw Error('injected postMessage failure');super.postMessage(data,transfer);}}
 const prepare=factory(true,FaultWorker,budget);await assert.rejects(prepare(binary(10000)),new RegExp('injected '+fault));await Promise.all(closing.splice(0));assert.equal(prepare.inspectCopies(),0);assert.equal(budget.inspect().active,0);assert.equal(budget.inspect().queued.native,0);assertions+=4;cases++;records.push({name:'helper-'+fault+'-failure',pass:true});
}
const report={pass:true,cases,assertions,records,scope:'Independent extension: actual final manifest-selected runtime, real workers and stock budget; sorted Uint32 wire cutoffs, queued helper cancellation and construction/post failures.'};
export default report;
