import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';

const source=readFileSync(process.argv[2]||'index.html','utf8');
const first=source.indexOf('      const frameExportSha256K='),last=source.indexOf("      tools.get('scene.file').dataOnly",first);
assert.ok(first>=0&&last>first,'Exact API export block not found');
const setup=new Function('env',`
 const {active,exportTransfers,tools,runtime}=env,crypto=env.crypto,URL=env.URL,document=env.document,
  performance=env.clock,setTimeout=env.yieldTimer,sceneFileName='source.hash',
  encodeBase64=bytes=>Buffer.from(bytes).toString('base64'),register=(name,desc,schema,readOnly,run)=>tools.set(name,run),
  obj=v=>v,required=v=>v,choice=()=>null,str=null,bool=null,integer={},exportIds={},refs=ids=>ids,
  fail=(code,message)=>{throw Object.assign(new Error(message),{code});},
  saveHash=()=>active('hash'),saveSTL=()=>active('stl'),savePLY=()=>active('ply'),saveVTK=()=>active('vtk'),
  save3MF=()=>active('3mf'),saveGLB=()=>active('glb'),exportPartHash=ids=>active('part:'+ids.join(',')),
  frameSaveBoundFile=(...a)=>{runtime.bound.push(a);return {bound:true};};
 ${source.slice(first,last)}
 return {frameExportSha256,frameExportBlobDigest};
`);
let ticks=0;
const env={runtime:{bound:[],clicks:[],yields:0,created:0,released:[],serializer:[],clickError:null},exportTransfers:new Map(),tools:new Map(),
 active:name=>{env.runtime.serializer.push(name);return env.blob;},
 clock:{now:()=>ticks+=20},yieldTimer:cb=>{env.runtime.yields++;queueMicrotask(cb);},
 crypto:{subtle:webcrypto.subtle,randomUUID:()=>String(env.runtime.created)},
 URL:{createObjectURL:()=> 'blob:mock-'+(++env.runtime.created),revokeObjectURL:url=>env.runtime.released.push(url)},
 document:{createElement:type=>{assert.equal(type,'a');return {click(){if(env.runtime.clickError)throw env.runtime.clickError;env.runtime.clicks.push([this.href,this.download]);}};}}
};
const {frameExportSha256,frameExportBlobDigest}=setup(env),run=(name,args,context)=>env.tools.get(name)(args,null,context);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),bytes=v=>Buffer.from(v);
const vectors=[
 ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
 ['abc','ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
 ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq','248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
 ['a'.repeat(1000000),'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0']
];
for(const [msg,digest] of vectors){
 const h=frameExportSha256(),data=bytes(msg);
 for(let at=0;at<data.length;){const end=Math.min(data.length,at+(at%123)+1);h.update(data.subarray(at,end));at=end;}
 assert.equal(h.hex(),digest);assert.equal(h.hex(),digest);assert.throws(()=>h.update(bytes('x')),/finalized/);
}
const MiB=1024*1024;
let seed=402823;
const rnd=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
for(const length of [0,1,55,56,57,63,64,65,119,120,127,128,129,511,512,513,65535,65536,65537]){
 const allocation=Buffer.from(Array.from({length:length+9},()=>rnd()>>>24)),input=allocation.subarray(3,3+length),expected=sha(input);
 for(const step of [1,7,55,56,63,64,65,777,0]){
  const h=frameExportSha256();
  for(let at=0;at<input.length;){
   const n=step||(rnd()%150)+1;h.update(input.subarray(at,at+n));h.update(new Uint8Array());at+=n;
  }
  assert.equal(h.hex(),expected,`SHA parity on length ${length}, step ${step}`);
 }
}

const table=Buffer.from(Array.from({length:4096},()=>rnd()>>>24));
function pattern(start,end){
 const result=Buffer.allocUnsafe(end-start);
 let x=0,phase=start%table.length;
 while(x<result.length){const n=Math.min(table.length-phase,result.length-x);table.copy(result,x,phase,phase+n);x+=n;phase=0;}
 return result;
}
class GuardedBlob{
 constructor(size,{inline=false,onSlice=()=>{},shorten=false}={}){
  this.size=size;this.inline=inline;this.onSlice=onSlice;this.shorten=shorten;this.reads=[];this.whole=0;this.inflight=0;this.peak=0;
 }
 async arrayBuffer(){
  this.whole++;
  assert.ok(this.inline,'Non-inline export must never call Blob.arrayBuffer on the source');
  return Uint8Array.from(pattern(0,this.size)).buffer;
 }
 slice(at,end){
  assert.ok(end-at<=MiB,`Requested oversized chunk ${end-at}`);
  assert.ok(at>=0&&end>=at&&end<=this.size);
  return {arrayBuffer:async()=>{
   this.reads.push([at,end]);this.inflight++;this.peak=Math.max(this.peak,this.inflight);
   try{await Promise.resolve();this.onSlice(this.reads.length);return Uint8Array.from(pattern(at,this.shorten?Math.max(at,end-1):end)).buffer;}
   finally{this.inflight--;}
  }};
 }
}
function incrementalExpected(size){const h=createHash('sha256');for(let a=0;a<size;a+=MiB)h.update(pattern(a,Math.min(size,a+MiB)));return h.digest('hex');}
for(const format of ['hash','stl','ply','vtk','3mf','glb']){
 const blob=env.blob=new GuardedBlob(format==='hash'?0:191);
 const a=await run('scene.export',{format});
 assert.deepEqual(a,{name:'source.'+format,format,bytes:blob.size,sha256:incrementalExpected(blob.size)});
 assert.equal(blob.whole,0);assert.equal(env.runtime.serializer.at(-1),format);
}
const large=env.blob=new GuardedBlob(17*MiB+57);
const receipt=await run('scene.saveAs',{ids:['owner'],name:'single.hash'});
assert.equal(env.runtime.serializer.at(-1),'part:owner');
assert.deepEqual(receipt,{name:'single.hash',format:'hash',bytes:large.size,sha256:incrementalExpected(large.size),
 transfer:{id:'0',url:'blob:mock-1',chunkBytes:MiB}});
assert.equal(large.whole,0);assert.equal(large.peak,1);assert.equal(large.reads.length,18);assert.ok(env.runtime.yields>0);
for(const [[at,end],i]of large.reads.map((v,i)=>[v,i]))assert.deepEqual([at,end],[i*MiB,Math.min((i+1)*MiB,large.size)]);
const readHash=createHash('sha256');let at=0,count=0;
do{
 const r=await run('scene.export.read',{id:receipt.transfer.id,offset:at}),data=Buffer.from(r.base64,'base64');
 assert.equal(r.offset,at);assert.equal(r.bytes,data.length);assert.equal(r.nextOffset,at+data.length);assert.equal(r.totalBytes,large.size);
 readHash.update(data);count+=r.bytes;at=r.nextOffset;if(r.eof)break;
}while(true);
assert.equal(count,receipt.bytes);assert.equal(readHash.digest('hex'),receipt.sha256);
assert.deepEqual(await run('scene.export.read',{id:receipt.transfer.id,offset:at}),{id:'0',offset:at,nextOffset:at,bytes:0,totalBytes:at,eof:true,base64:''});
assert.deepEqual(await run('scene.export.release',{id:receipt.transfer.id}),{released:true});
assert.deepEqual(await run('scene.export.release',{id:receipt.transfer.id}),{released:false});
await assert.rejects(run('scene.export.read',{id:receipt.transfer.id}),{code:'NOT_FOUND'});
assert.deepEqual(env.runtime.released,['blob:mock-1']);

const legacy=env.blob=new GuardedBlob(16*MiB+65,{inline:true});
const inline=await run('scene.export',{includeData:true});
assert.equal(legacy.whole,1);assert.deepEqual(legacy.reads,[]);
assert.equal(Buffer.from(inline.base64,'base64').length,legacy.size);assert.equal(inline.sha256,incrementalExpected(legacy.size));
assert.equal(sha(Buffer.from(inline.base64,'base64')),inline.sha256);
env.blob=new GuardedBlob(513);
const download=await run('scene.export',{download:true});
assert.equal(download.downloadRequested,true);assert.equal(download.transfer.chunkBytes,MiB);
assert.deepEqual(env.runtime.clicks,[[download.transfer.url,'source.hash']]);
await run('scene.export.release',{id:download.transfer.id});
env.runtime.clickError=new Error('Browser refused download');
await assert.rejects(run('scene.export',{download:true}),/refused download/);
assert.equal(env.exportTransfers.size,0);assert.equal(env.runtime.released.length,3);env.runtime.clickError=null;

const created=env.runtime.created,abort=new AbortController();
const interrupted=env.blob=new GuardedBlob(4*MiB,{onSlice:n=>{if(n===2)abort.abort();}});
await assert.rejects(run('scene.saveAs',{name:'cancel.hash'},{signal:abort.signal}),{name:'AbortError'});
assert.equal(interrupted.reads.length,2);assert.equal(env.runtime.created,created);assert.equal(env.exportTransfers.size,0);
env.blob=new GuardedBlob(3*MiB,{shorten:true});
await assert.rejects(run('scene.export',{transfer:true}),/unexpected byte length/);
assert.equal(env.runtime.created,created);
env.blob=new GuardedBlob(513);
await assert.rejects(run('scene.export',{transfer:true},{sessionGuard:()=>{throw Error('Workspace changed');}}),/Workspace changed/);
assert.equal(env.runtime.created,created);
assert.deepEqual(await run('scene.saveAs',{path:'authorized.hash',createOnly:true},{signal:abort.signal}),{bound:true});
assert.deepEqual(env.runtime.bound,[['authorized.hash',undefined,{createOnly:true}]],'Do not change the bound-file stream path');
const real=new Blob([bytes('a'),bytes('bc')]);assert.equal(await frameExportBlobDigest(real,()=>{}),vectors[1][1]);

if(process.argv.includes('--wide')){
 // Cross the SHA-256 low 32-bit length word without storing a 512 MiB Blob.
 const wide=new GuardedBlob(512*MiB+1);
 assert.equal(await frameExportBlobDigest(wide,()=>{}),incrementalExpected(wide.size));
 assert.equal(wide.whole,0);assert.equal(wide.peak,1);assert.equal(wide.reads.length,513);
}
console.log('SHA-256 vectors, chunk boundaries, unchanged export receipts, >16 MiB without a whole read, cancellation and transfer cleanup pass.');
