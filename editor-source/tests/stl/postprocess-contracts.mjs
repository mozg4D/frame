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
  if(name==='stl-BVH'&&['null','primitive','array'].includes(mode)){this.onmessage?.({data:mode==='null'?null:mode==='primitive'?17:[]});return;}
  if(name==='stl-BVH'&&mode==='validation-throw'){Object.defineProperty(data,'id',{get(){throw Error('injected validation access failure');}});}
  if(name==='stl-BVH'&&mode==='stale'){this.onmessage?.({data:{...data,id:99}});return;}
  if(name==='stl-BVH'&&mode==='error'){this.onerror?.({message:'injected postprocess failure'});return;}
  if(name==='stl-BVH'&&mode==='unreadable'){this.onmessageerror?.({});return;}
  if(name==='stl-BVH'&&mode==='corrupt'&&data.result?.tree)data.result.tree.bvhBounds=new Float64Array(1);
  if(name==='stl-BVH'&&mode==='cancel-helper'){activeController.abort(Object.assign(Error('cancel helper'),{name:'AbortError'}));setTimeout(()=>this.onmessage?.({data}),0);return;}
  if(name==='stl-import'&&mode==='cancel-coordinator'){activeController.abort(Object.assign(Error('cancel coordinator'),{name:'AbortError'}));setTimeout(()=>this.onmessage?.({data}),0);return;}
  this.onmessage?.({data});if(mode==='late-malformed'&&name==='stl-BVH')this.onmessage?.({data:null});if(mode==='duplicate')this.onmessage?.({data});
 });for(const q of this.queue)this.worker.postMessage(q.data,q.transfer);this.queue=[];});}
 postMessage(data,transfer){const moved=structuredClone(data,{transfer}),out=[];for(const k of ['buffer','positions','indices'])if(moved[k] instanceof ArrayBuffer)out.push(moved[k]);else if(ArrayBuffer.isView(moved[k]))out.push(moved[k].buffer);log.push({type:'post',name:this.name,keys:Object.keys(moved),transferBytes:out.reduce((n,b)=>n+b.byteLength,0)});if(this.worker)this.worker.postMessage(moved,out);else this.queue.push({data:moved,transfer:out});}
 terminate(){if(this.dead)return;this.dead=true;log.push({type:'terminate',name:this.name});closing.push(this.pending.then(()=>this.worker?.terminate()));}
}
const binary=n=>{const b=new ArrayBuffer(84+n*50),v=new DataView(b);v.setUint32(80,n,true);for(let f=0;f<n;f++){const p=[f*3,0,0,f*3+1,0,0,f*3,1,0];for(let k=0;k<9;k++)v.setFloat32(96+f*50+k*4,p[k],true);}return b;};
const ascii=n=>new TextEncoder().encode('solid generic\n'+Array.from({length:n},(_,f)=>`facet normal 0 0 1\nouter loop\nvertex ${f*3} 0 0\nvertex ${f*3+1} 0 0\nvertex ${f*3} 1 0\nendloop\nendfacet\n`).join('')+'endsolid generic').buffer;
const fingerprint=v=>{if(ArrayBuffer.isView(v))return{type:v.constructor.name,length:v.length,sha256:hashArray(v)};if(Array.isArray(v))return v.map(fingerprint);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,fingerprint(x)]));return v;};
let cases=0,assertions=0;const records=[];
async function run(candidate,input,{count=3,injection='normal',copyLimit=64*1024*1024}={}){const budget=createBudget(count),controller=new AbortController();mode=injection;activeController=controller;log=[];const activity={signal:controller.signal,update(){},check(){if(controller.signal.aborted)throw controller.signal.reason;}};let result,error;const prepare=factory(candidate,BrowserWorker,budget,copyLimit);
 let timer;try{result=await Promise.race([prepare(input.slice(0),activity),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort(Object.assign(Error('test timed out'),{name:'AbortError'}));reject(Error('postprocess failed to settle within 5000ms'));},5000);})]);}catch(e){error={name:e.name,message:e.message};assert(!e.message.includes('failed to settle'),'Malformed worker replies must reject without awaiting manual cancel');}finally{clearTimeout(timer);}
 await Promise.all(closing.splice(0));assert.equal(prepare.inspectCopies(),0);assertions++;assert.equal(budget.inspect().active,0);assert.equal(budget.inspect().running.native,0);assertions+=2;assert(budget.inspect().peak<=count);assertions++;return{out:result?fingerprint(result):null,error,log:log.slice(),budget:budget.inspect()};}
for(const [name,input,count,copyLimit=64*1024*1024] of [['binary-small',binary(4),3],['binary-BVH-wire',binary(10000),3],['ASCII-BVH-wire',ascii(10000),3],['one-permit-serial',binary(10000),1],['binary-empty',binary(0),3],['oversized-copy-serial-helper',binary(10000),3,119999]]){
 const a=await run(false,input,{count}),b=await run(true,input,{count,copyLimit});assert.deepStrictEqual(b.out,a.out);assert.deepStrictEqual(b.error,a.error);assertions+=2;
 if(count===1||name.includes('small')||name.includes('empty')){assert(!b.log.some(x=>x.name==='stl-BVH'));assertions++;}
 else if(copyLimit<b.out.indices.length*4){assert(b.log.some(x=>x.name==='stl-combined'));assert(!b.log.some(x=>x.name==='stl-wire'));assertions+=2;}
 else{const ends=b.log.findIndex(x=>x.type==='terminate'&&x.name==='stl-import'),first=b.log.findIndex(x=>x.type==='create'&&x.name==='stl-BVH');assert(ends>=0&&first>ends);assertions++;const wire=b.log.find(x=>x.type==='post'&&x.name==='stl-wire');assert.deepStrictEqual(wire.keys.sort(),['id','kind','indices','pointCount'].sort());assert.equal(wire.transferBytes,b.out.indices.length*4);assertions+=2;}
 cases++;records.push({name,pass:true,outputSHA256:b.out?sha(JSON.stringify(b.out)):null});
}
{
 mode='normal';log=[];const budget=createBudget(3),prepare=factory(true,BrowserWorker,budget,120000),input=binary(10000),r=await Promise.all([prepare(input.slice(0)),prepare(input.slice(0))]);await Promise.all(closing.splice(0));assert.deepStrictEqual(fingerprint(r[0]),fingerprint(r[1]));assert.equal(prepare.inspectCopies(),0);assert.equal(budget.inspect().active,0);assert(budget.inspect().peak<=3);assert(log.some(x=>x.type==='create'&&x.name==='stl-combined'));assertions+=5;cases++;records.push({name:'concurrent-copy-memory-pressure-serial-helper',pass:true});
}
for(const injection of ['stale','error','unreadable','corrupt','cancel-helper','cancel-coordinator','duplicate','null','primitive','array','validation-throw','late-malformed']){
 const q=await run(true,binary(10000),{injection});if(injection==='duplicate'||injection==='late-malformed'){assert(q.out&&!q.error);assertions++;}else{assert(!q.out&&q.error);assertions++;if(injection.startsWith('cancel')){assert.equal(q.error.name,'AbortError');assertions++;}}
 assert(q.log.filter(x=>x.type==='create').every(c=>q.log.filter(x=>x.type==='terminate'&&x.name===c.name).length===1));assertions++;cases++;records.push({name:injection,pass:true,errorName:q.error?.name??null});
}
// Two imports sharing the exact existing budget: release coordinator before
// helper acquires prevents the hold-and-wait deadlock even with only2 permits.
{
 mode='normal';log=[];const budget=createBudget(2),prepare=factory(true,BrowserWorker,budget),input=binary(10000),r=await Promise.all([prepare(input.slice(0)),prepare(input.slice(0))]);await Promise.all(closing.splice(0));assert.deepStrictEqual(fingerprint(r[0]),fingerprint(r[1]));assert.equal(budget.inspect().active,0);assert.equal(budget.inspect().peak,2);assertions+=3;cases++;records.push({name:'two-imports-shared-two-permit-budget',pass:true});
}
{
 const budget=createBudget(1),release=await budget.acquire('native'),controller=new AbortController(),promise=factory(true,BrowserWorker,budget)(binary(4),{signal:controller.signal,check(){},update(){}});controller.abort(Object.assign(Error('queued cancel'),{name:'AbortError'}));await assert.rejects(promise,{name:'AbortError'});release();await Promise.resolve();assert.equal(budget.inspect().active,0);assert.equal(budget.inspect().queued.native,0);assertions+=3;cases++;records.push({name:'queued-budget-cancellation',pass:true});
}
const report={pass:true,cases,assertions,baselineEditorSHA256:spec.baselineEditorSHA256,candidateEditorSHA256:spec.candidateEditorSHA256,records,scope:'Small generic binary/ASCII fixtures with genuine worker_threads and the exact existing CPU-budget factory. Browser Blob URL/Worker bridge controlled. Both crease passes, all positions/normals/indices/origin/bounds/wire/BVH arrays byte-exact; serialcapacity, simultaneous imports, detached transfer, abort/error/stale/duplicate/ownership cleanup. No customer fixture, browser/GPU or speed claim.'};export default report;
