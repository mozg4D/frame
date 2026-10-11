import {reviewURL} from '../source-paths.mjs';
import {verifyCandidate} from './verify-candidate.mjs';verifyCandidate();
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import{createHash}from'node:crypto';
const {installAffineStockWorker}=await import(reviewURL('../candidate/native-source/affine-stock-worker.mjs',import.meta.url));
const source=fs.readFileSync(reviewURL('../candidate/editor-affine-ui-v2c.mjs',import.meta.url),'utf8');
const manifest=JSON.parse(fs.readFileSync(reviewURL('./worker-source-hashes.json',import.meta.url),'utf8'));for(const[name,hash]of Object.entries(manifest))assert.equal(createHash('sha256').update(fs.readFileSync(reviewURL('../candidate/native-source/'+name,import.meta.url))).digest('hex'),hash);
function extract(name){let at=source.indexOf('function '+name+'(');assert(at>=0,name);const lines=source.slice(at).split('\n');for(let i=1;i<1000;i++){const f=lines.slice(0,i).join('\n');try{new vm.Script('('+f+')');return f;}catch{}}throw Error(name);}
const tick=()=>new Promise(setImmediate),requests=[],replies=[];let terminated=0,created=0;
const scope={postMessage(data){replies.push(structuredClone(data));transport.onmessage({data});}},transport={postMessage(data,transfer){requests.push(structuredClone(data,{transfer}));},terminate(){terminated++;}};installAffineStockWorker(scope);
function flush(){assert(requests.length);scope.onmessage({data:requests.shift()});}
const c=vm.createContext({DOMException,frameAffineSerial:0,CREASE_COS:Math.cos(46*Math.PI/180),frameAffineNotes:{errors:[]},frameNative:{createAffineCornerWorker(){created++;return transport;}}});
for(const n of ['frameAffineCreateWorkerPipe','frameAffineCreateWorker','frameAffineCleanup','frameAffineDispose'])vm.runInContext(extract(n),c);
const p=Float32Array.of(0,0,0,1,0,0,0,1,0),n=Float32Array.of(0,0,1,0,0,1,0,0,1),raw={attrs:{position:{array:p},normal:{array:n}},index:Uint32Array.of(0,1,2)},r={live:true,initialRaw:raw,logicalVersion:0,faceIDs:Uint32Array.of(0)},t={affine:r};r.t=t;
function session(id){const s={r,t,affineID:id,faceIDs:r.faceIDs,beforeRaw:raw,beforeExact:Promise.resolve(raw)};c.frameAffineCreateWorker(s);r.active=s;return s;}
const s=session(1);await tick();flush();await tick();flush();await s.workerReady;assert.equal(created,1);
const I=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],delta=I.slice();delta[12]=2;
const old=s.call({kind:'canonical-pose',gesture:1,revision:1,baseVersion:0,ownerVersion:s.ownerVersion,world:I,delta,inverse:I,final:false}).then(()=>({resolved:true}),e=>({error:e}));s.closeWorker();const oldResult=await old;assert.equal(oldResult.error.name,'AbortError');assert.equal(terminated,0);assert.equal(r.workerPipe.pending.size,0);
flush();assert.equal(replies.at(-1).committed,false);assert.equal(replies.at(-1).version,0);assert.equal(r.workerPipe.pending.size,0);
const s2=session(2);await tick();flush();await s2.workerReady;assert.equal(s2.worker,s.worker);delta[12]=4;
const next=s2.call({kind:'canonical-pose',gesture:2,revision:1,baseVersion:0,ownerVersion:s2.ownerVersion,world:I,delta,inverse:I,final:true});flush();const q=await next;assert.equal(q.committed,true);assert.equal(q.version,1);assert.deepEqual(Array.from(q.cornerPositions),[4,0,0,5,0,0,4,1,0]);
const retired1=s2.call({kind:'canonical-begin',gesture:3,baseVersion:1,ownerVersion:s2.ownerVersion}).then(()=>null,e=>e),retired2=r.workerPipe.call(null,{kind:'canonical-begin',gesture:4,baseVersion:1,ownerVersion:s2.ownerVersion}).then(()=>null,e=>e);assert.equal(r.workerPipe.pending.size,2);
let disposed=0;r.display={dispose(){disposed++;}};r.gpu={dispose(){disposed++;}};const pipe=r.workerPipe;c.frameAffineDispose(t);assert.equal((await retired1).name,'AbortError');assert.equal((await retired2).name,'AbortError');assert.equal(terminated,1);assert.equal(disposed,2);assert.equal(pipe.pending.size,0);assert.equal(pipe.closed,true);assert.equal(r.workerPipe,null);assert.equal(r.active,null);assert.equal(r.live,false);c.frameAffineDispose(t);assert.equal(terminated,1);
const count=pipe.pending.size;while(requests.length)flush();assert.equal(pipe.pending.size,count);
console.log(JSON.stringify({pass:true,scope:'Exact UI persistent worker pipe/lease functions plus real canonical worker handler with deterministic queued transport; no hardware/latency acceptance',cancelledNonfinalLease:{promiseRejected:true,workerRetained:true,lateReplyIgnored:true,canonicalVersionUnchanged:true},nextGesture:{sameWorker:true,committedVersion:1,exactCornerPositions:Array.from(q.cornerPositions)},dispose:{allPendingRejected:true,workerTerminatedOnce:true,displayAndGpuDisposed:true,lateRepliesIgnored:true}},null,2));
