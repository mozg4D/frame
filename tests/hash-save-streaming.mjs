import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {H} from './hash-codec-fixture.mjs';

export async function hashSaveStreamingChecks(){
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),start=html.indexOf('async function saveHash(writable=null){'),end=html.indexOf('async function nativeDecodePlan(',start),source=html.slice(start,end);
 assert(start>=0&&end>start);
 const id=i=>i.toString(16).padStart(32,'0'),rows=Array.from({length:4000},(_,i)=>({id:id(i+1),type:H.T.text,value:'Object '+i})),large={id:id(4001),type:H.T.bytes,value:randomBytes(5*1024*1024+7)},position={id:id(4002),type:H.T.float32,value:{gpu:true,field:'positions',mesh:{hashId:'mesh'},resource:'current',count:3}},base=new Float32Array([1,2,3]);rows.splice(2000,0,large,position);
 const checks=[],check=(name,pass)=>{assert(pass,name);checks.push({name,pass:true});};
 function harness(){
  let clock=0,yields=0,locks=0,unlocks=0,readbacks=0;
  const scene={records:new Map(rows.map(r=>[r.id,r])),meshes:[]},context={scene,renderer:{},nodes:[],FrameHash:H,FramePlugins:{flush:async()=>{}},FrameMorph:{flush:async()=>{}},window:{FrameSpline:{flush:async()=>{}}},animationSerial:Promise.resolve(),appearanceQueue:Promise.resolve(),selectionQueue:Promise.resolve(),editSerial:Promise.resolve(),lazyTask:null,frameSyncEngineVisibility(){},frameSyncMaterials(){},checkSession(){},ensureImportedUV(){},nativeCamera:()=>new Float64Array([1,2,3]),nativePut:(map,key,unused,type,value)=>map.set(key,{id:key,type,value}),nativeRecord:(id,type,value)=>({id,type,value}),displayUnitIndex:2,rescaleUnitIndex:2,morphStates:new Map([['mesh',{base:'rest'}]]),nativeReadGPU:async(gpu,resource,count)=>{assert.equal(resource,'rest');assert.equal(count,3);readbacks++;return new Uint8Array(base.slice().buffer);},performance:{now:()=>clock+=.25},setTimeout:fn=>{yields++;queueMicrotask(fn);},nativeIOStart:()=>{locks++;return ()=>{};},nativeIOEnd:()=>unlocks++,canvas:{dataset:{}}};
  const save=Function('context','with(context){return '+source+';}')(context);
  return {context,save,stats:()=>({yields,locks,unlocks,readbacks})};
 }
 const plain=harness(),blob=await plain.save(),bytes=Buffer.from(await blob.arrayBuffer()),digest=b=>createHash('sha256').update(b).digest('hex'),input=H.reader(blob),index=await input.index();
 check('Every metadata record, camera and large payload survives native Blob save',index.size===rows.length+1&&digest(await input.read(index.get(large.id)))===digest(large.value));
 assert.deepEqual(await input.read(index.get(position.id)),base);
 check('GPU records serialize rest geometry exactly once',plain.stats().readbacks===1);
 const streamed=harness(),chunks=[];let closes=0,aborts=0;
 await streamed.save({write:async part=>chunks.push(part),close:async()=>closes++,abort:async()=>aborts++});
 check('Streaming preserves exact native record order and bytes',digest(Buffer.from(await new Blob(chunks).arrayBuffer()))===digest(bytes));
 check('Small metadata records share bounded writes around an oversized record',chunks.length===3&&chunks[0].size<=4*1024*1024&&chunks[1].size>4*1024*1024&&chunks[2].size<=4*1024*1024);
 check('Save yields by elapsed work instead of pausing for every record',streamed.stats().yields>0&&streamed.stats().yields<rows.length/10);
 check('Successful output closes once and releases native IO',closes===1&&aborts===0&&streamed.stats().locks===1&&streamed.stats().unlocks===1);
 const bounded=harness(),payload=randomBytes(60000),medium=Array.from({length:150},(_,i)=>({id:id(i+1),type:H.T.bytes,value:payload})),boundedChunks=[];
 bounded.context.scene.records=new Map(medium.map(r=>[r.id,r]));
 await bounded.save({write:async part=>boundedChunks.push(part),close:async()=>{},abort:async()=>{}});
 const boundedBlob=new Blob(boundedChunks),boundedReader=H.reader(boundedBlob),boundedIndex=await boundedReader.index();
 check('Accumulated small records flush before exceeding the 4 MiB batch cap',boundedChunks.length===3&&boundedChunks.every(b=>b.size<=4*1024*1024)&&boundedIndex.size===medium.length+1);
 assert.deepEqual(await boundedReader.read(boundedIndex.get(medium.at(-1).id)),new Uint8Array(payload));
 const failed=harness();let writes=0,failedClose=0,failedAbort=0;
 await assert.rejects(()=>failed.save({write:async()=>{if(++writes===2)throw Error('disk failure');},close:async()=>failedClose++,abort:async()=>{failedAbort++;throw Error('secondary abort failure');}}),/disk failure/);
 check('A failed write preserves its error, aborts and releases native IO',writes===2&&failedClose===0&&failedAbort===1&&failed.stats().unlocks===1);
 const changed=harness();let changedClose=0,changedAbort=0;
 await assert.rejects(()=>changed.save({write:async()=>{changed.context.scene={};},close:async()=>changedClose++,abort:async()=>changedAbort++}),/Scene changed/);
 check('Document replacement during streaming aborts before the next record',changedClose===0&&changedAbort===1&&changed.stats().unlocks===1);
 return {pass:true,checks,records:index.size,bytes:bytes.length,writes:chunks.map(b=>b.size),yields:streamed.stats().yields};
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await hashSaveStreamingChecks(),null,2));
