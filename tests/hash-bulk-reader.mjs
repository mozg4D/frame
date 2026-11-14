import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const html=await readFile(process.argv[2]||new URL('../index.html',import.meta.url),'utf8'),start=html.indexOf('function createFrameHashCodec(){'),end=html.indexOf('const FrameHash=createFrameHashCodec();',start),H=Function(html.slice(start,end)+'return createFrameHashCodec();')();
const id=i=>i.toString(16).padStart(32,'0'),rows=[];
for(let i=1;i<=12000;i++)rows.push({id:id(i),type:H.T.uint32,value:new Uint32Array([i,0xffffffff-i])});
rows.push({id:id(12001),type:H.T.float64,value:new Float64Array([0,-0,Math.PI,Number.MIN_VALUE])},{id:id(12002),type:H.T.text,value:'UTF-8: Ω русский 😀 '.repeat(100)},{id:id(12003),type:H.T.float32,value:new Float32Array([0,-0,1/3,-1e20])});
const file=new Blob((await Promise.all(rows.map(r=>H.pack(r)))).map(r=>r.blob));let slices=0,reads=0;
const observed={size:file.size,arrayBuffer:()=>{reads++;return file.arrayBuffer();},slice:(...a)=>{slices++;return file.slice(...a);}},input=H.reader(observed),map=await input.index();assert.equal(map.size,rows.length);
for(const row of rows){const value=await input.read(map.get(row.id));assert.deepEqual(value,row.value);if(ArrayBuffer.isView(value))assert.equal(value.buffer.byteLength,value.byteLength,'Metadata must not retain the whole packed file');}
assert.equal(reads,1);assert.equal(slices,0);
// Large inputs retain one bounded block; concurrent misses must return their own bytes.
function raw(id,type,payload){const h=new Uint8Array(26),v=new DataView(h.buffer);v.setUint16(0,type,true);h.set(Buffer.from(id,'hex'),2);v.setBigUint64(18,BigInt(payload.length),true);return [h,payload];}
const huge=new Uint8Array(18*1024*1024+13);huge.fill(173);const tail=new Uint8Array([2,7,19,251]),large=new Blob([...raw(id(1),H.T.bytes,huge),...raw(id(2),H.T.bytes,tail)]);let largest=0;
const big=H.reader({size:large.size,slice:(a,b)=>{largest=Math.max(largest,b-a);return large.slice(a,b);}}),bigMap=await big.index();assert.equal(bigMap.size,2);assert.ok(largest<=1024*1024,'Indexing may not read the huge payload');
const [last,first]=await Promise.all([big.read(bigMap.get(id(2))),big.range(100,32)]);assert.deepEqual(last,tail);assert.deepEqual(first,new Uint8Array(32).fill(173));assert.equal(last.buffer.byteLength,tail.length);
await assert.rejects(()=>H.index(new Blob([new Uint8Array(25)])),/Truncated/);
const good=raw(id(2),H.T.bytes,tail);await assert.rejects(()=>H.index(new Blob([...good,...good])),/Duplicate/);
const h=new Uint8Array(26),view=new DataView(h.buffer);view.setUint16(0,H.T.bytes,true);view.setBigUint64(18,1000n,true);await assert.rejects(()=>H.index(new Blob([h])),/size/);
console.log(JSON.stringify({pass:true,metadataRecords:rows.length,inputBytes:file.size,wholeFileReads:reads,sliceReads:slices,maxLargeIndexRead:largest,checks:['native typed/compressed/predicted records preserve bits','one input read for small scenes','metadata owns only its decoded bytes','bounded large-file indexing','concurrent block reads','truncation/duplicate/length rejection']}));
