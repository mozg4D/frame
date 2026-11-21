import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';

const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('function createFrameHashCodec(){'),end=html.indexOf('\nconst FrameHash=',start);
assert(start>=0&&end>start);
const source=html.slice(start,end);
class MillionRows extends Map {
  // Exercise an actual index-guard boundary without a million-entry heap.
  get size(){return 999999+super.size;}
}
const codec=Function('Map',source+'\nreturn createFrameHashCodec();')(MillionRows);
const header=(id,n=0n)=>{
  const a=new Uint8Array(26),v=new DataView(a.buffer);
  v.setUint16(0,codec.T.bytes,true);v.setBigUint64(2,BigInt(id),true);v.setBigUint64(18,n,true);
  return a;
};
const started=performance.now(),past=new Blob([header(1),header(2),header(3)]);
const rows=await codec.index(past);
assert.equal(rows.size,1000002);
assert.deepEqual([...rows.values()].map(row=>row.offset),[26,52,78]);
await assert.rejects(codec.index(new Blob([header(1),header(1)])),/Duplicate HASH property/);
await assert.rejects(codec.index(new Blob([header(1),new Uint8Array(25)])),/Truncated HASH header/);
await assert.rejects(codec.index(new Blob([header(1,1n)])),/Invalid HASH record size/);
assert(performance.now()-started<1500,'Small header validation exceeded 1.5 seconds');
console.log('HASH physical count and native header integrity: PASS');
