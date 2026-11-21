import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash,webcrypto} from 'node:crypto';

const [before,after]=process.argv.slice(2);
assert(before&&after,'Usage: node hash-save-coalescer-cpu.mjs BASELINE_HTML CANDIDATE_HTML');
const [oldSource,nextSource]=await Promise.all([before,after].map(p=>fs.readFile(p,'utf8')));
const Limit=4*1024*1024, sha=b=>createHash('sha256').update(b).digest('hex');
const cut=(s,a,b)=>{const i=s.indexOf(a),j=s.indexOf(b,i+a.length);assert(i>=0&&j>i,a);return s.slice(i,j);};
function setup(source){
  const counts={blobs:0,typedBytes:0,maxTyped:0};
  class CountingBlob extends Blob {
    constructor(parts=[],opts){super(parts,opts);const bytes=parts.reduce((n,p)=>n+(ArrayBuffer.isView(p)?p.byteLength:0),0);counts.blobs++;counts.typedBytes+=bytes;counts.maxTyped=Math.max(counts.maxTyped,bytes);}
  }
  const factory=Function('Blob','crypto',
    cut(source,'function createFrameHashCodec(){','\nconst FrameHash')+
    cut(source,'const FrameHash=createFrameHashCodec();','\nconst FrameValue')+
    cut(source,'function createFrameFileIndex() {','\nfunction frameCompareFileIndexes(')+
    cut(source,'    async function saveHash(writable=null)','    async function nativeDecodePlan(file)')+
    String.raw`
    const state={progress:0,ended:0,gpu:0},renderer={},nodes=[],FramePlugins={flush(){}},FrameMorph={flush(){}},window={};
    const frameSyncEngineVisibility=()=>{},frameSyncMaterials=()=>{},checkSession=()=>{},ensureImportedUV=()=>{};
    const selectionQueue=null,editSerial=null,animationSerial=null,appearanceQueue=null,lazyTask=null,displayUnitIndex=2,rescaleUnitIndex=2,morphStates=new Map();
    const canvas={dataset:{}},nativeIOStart=()=>()=>{state.progress++;},nativeIOEnd=()=>{state.ended++;};
    const nativeCamera=()=>new Float64Array(12).fill(1),nativePut=(map,id,_,type,value)=>map.set(id,nativeRecord(id,type,value)),nativeRecord=(id,type,value)=>({id,type,value});
    const nativeReadGPU=async()=>{state.gpu++;return new Uint8Array(new Float32Array([1,2,3,4,5,6]).buffer);};
    let scene;
    return {FrameHash,createFrameFileIndex,state,canvas,save(rows,sink){scene={meshes:[],records:new Map(rows.map(r=>[r.id,r]))};return saveHash(sink);}};
  `);
  return {...factory(CountingBlob,webcrypto),counts};
}
const id=n=>(0x87000000+n).toString(16).padStart(32,'0'), stored=b=>new Uint8Array(b), H=setup(oldSource).FrameHash;
const {T,K}=H;
const fixed=[
  {id:K.version,type:T.uint32,value:new Uint32Array([1])},
  {id:K.all,type:T.ids,value:[id(1),id(2),id(3)]},
  {id:H.address(id(1),'name'),type:T.text,value:'Сцена 🧪'},
  {id:H.address(id(1),'matrix'),type:T.float64,value:Float64Array.from({length:12},(_,i)=>i+.2)},
  {id:id(10),type:T.bytes,value:new Uint8Array(0)},
  {id:id(11),type:T.bytes,value:new Uint8Array(127).fill(23)},
  {id:id(12),type:T.bytes,value:new Uint8Array(128).fill(25)},
  {id:id(13),type:T.value,value:{test:[0,-1,48],other:'Frame'}},
  {id:id(14),type:T.float32,value:{gpu:true,count:6}},
  {id:id(15),type:T.uint32,value:Uint32Array.from({length:65536},(_,i)=>i)},
  {id:id(16),type:T.float32,value:Float32Array.from({length:65536},(_,i)=>i/16)},
];
let prng=0xb7e319a0;
const entropy=Uint8Array.from({length:Limit+23},()=>{prng^=prng<<13;prng^=prng>>>17;prng^=prng<<5;return prng>>>24;});
const large={id:id(99),type:T.bytes,value:entropy},tiny=new Uint8Array(127).fill(113);
const tail=Array.from({length:65000},(_,i)=>({id:id(1000+i),type:T.bytes,value:tiny}));
const mixed=[...fixed,...tail.slice(0,35000),large,...tail.slice(35000)];
async function bound(src,rows,{failWrite,failIndex,asyncSink=false}={}){
  const rt=setup(src),ix=rt.createFrameFileIndex(),written=[],events={write:0,index:0,close:0,abort:0};
  let committed=sha(Buffer.from('previous edition')),result=null,error=null;
  const hash=createHash('sha256'),sizes=[];
  const sink={
    indexRecord(record,packed,value){
      if(++events.index===failIndex)throw Error('injected index failure');
      if(asyncSink){
        // A custom async sink can still inspect an immutable packed Blob without
        // changing the optimized built-in index route.
        assert.equal(packed.blob.size,26+packed.storedBytes);
        return Promise.resolve().then(()=>ix.record(record,packed,value));
      }
      return ix.record(record,packed,value);
    },
    async write(blob){
      if(++events.write===failWrite)throw Error('injected write failure');
      // Keep Blob immutable even when the writer does not consume it before the next slab is used.
      written.push(blob);sizes.push(blob.size);
    },
    async close(){
      ++events.close;result=await ix.written();
      for(const b of written)for await(const chunk of b.stream())hash.update(chunk);
      committed=hash.digest('hex');
    },
    async abort(){++events.abort;written.length=0;},
  };
  const start=performance.now();
  try{assert.equal(await rt.save(rows,sink),null);}catch(e){error=e;}
  return {rt,written,events,result,committed,error,sizes,ms:performance.now()-start};
}
const [a,b]=await Promise.all([bound(oldSource,mixed),bound(nextSource,mixed)]);
assert.ifError(a.error);assert.ifError(b.error);
assert.equal(a.committed,b.committed,'exact full file SHA-256');
assert.deepEqual(a.result,b.result,'per-record signatures and project index digest');
assert.deepEqual(a.events,b.events,'same output write/close/order accounting');
assert.deepEqual(a.sizes,b.sizes,'same 4 MiB flush boundaries around oversized direct record');
assert(a.sizes.some(n=>n>Limit));assert(a.sizes.filter(n=>n<=Limit&&n>Limit-160).length>=2);
assert(b.rt.counts.blobs<32,'tiny writable records must not build Blobs');
assert(a.rt.counts.blobs>110000,'test must exercise the legacy many-Blob path');
assert.equal(b.rt.state.gpu,1);
const file=new Blob(b.written),check=await b.rt.createFrameFileIndex().read(file);
assert.deepEqual(check,b.result,'bytestream reindex from legacy parser');
const reader=b.rt.FrameHash.reader(file),index=await reader.index();
assert.equal(index.size,mixed.length+1);assert.deepEqual([...index.keys()],[...mixed.map(r=>r.id),K.camera]);
assert.equal(index.get(id(10)).length,0);assert.equal(index.get(id(11)).encoding,T.bytes);
assert.equal(index.get(id(12)).encoding,T.bytes|H.ZIP);
assert(index.get(id(15)).encoding&H.PREDICT||index.get(id(16)).encoding&H.PREDICT,'test must hit predictor');
for(const row of fixed.filter(r=>[id(11),id(12),id(15),id(16)].includes(r.id))) assert.deepEqual(await reader.read(index.get(row.id)),row.value);
assert.deepEqual(await reader.read(index.get(id(14))),new Float32Array([1,2,3,4,5,6]));
assert.deepEqual(await reader.read(index.get(large.id)),large.value);
const [oldDefault,newDefault]=[setup(oldSource),setup(nextSource)], [blobA,blobB]=await Promise.all([oldDefault.save(fixed),newDefault.save(fixed)]);
assert.equal(blobA.type,'application/x-frame-hash');assert.equal(blobA.type,blobB.type);
assert.deepEqual(stored(await blobA.arrayBuffer()),stored(await blobB.arrayBuffer()));
assert.deepEqual(oldDefault.counts,newDefault.counts,'default Blob path unchanged, no slab');
const bSmall=await bound(nextSource,fixed,{asyncSink:true});assert.ifError(bSmall.error);assert.equal(bSmall.committed,sha(stored(await blobA.arrayBuffer())));
for(const issue of [{failWrite:2},{failIndex:20}]){
  const failed=await bound(nextSource,mixed,issue);
  assert.match(failed.error?.message||'',/injected (write|index) failure/);
  assert.equal(failed.events.abort,1);assert.equal(failed.events.close,0);assert.equal(failed.written.length,0);
  assert.equal(failed.committed,sha(Buffer.from('previous edition')));assert.equal(failed.rt.state.ended,1);
}
const mutable=Uint8Array.of(7),packed=b.rt.FrameHash.packForWrite({id:id(50),type:T.bytes,value:mutable});mutable[0]=99;
assert.equal(new Uint8Array(await packed.blob.arrayBuffer())[26],7,'tiny packing snapshots caller-owned ArrayBuffer');
console.log(JSON.stringify({pass:true,records:index.size,bytes:file.size,exactWrites:b.sizes,sha256:b.committed,indexDigest:b.result.version,defaultBytes:blobB.size,legacyBlobs:a.rt.counts.blobs,coalescedBlobs:b.rt.counts.blobs,candidateBlobTypedBytesMax:b.rt.counts.maxTyped,legacyMs:a.ms,coalescedMs:b.ms,flags:[id(11),id(12),id(15),id(16)].map(k=>index.get(k).encoding)}));
