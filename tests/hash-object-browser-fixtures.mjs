// Deterministic schema-1 fixtures for native HASH open and Objects Browser; no heavy geometry.
import fs from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createHash} from 'node:crypto';
const src=await fs.readFile(new URL('../index.html',import.meta.url),'utf8'),begin=src.indexOf('function createFrameHashCodec(){'),end=src.indexOf('\nconst FrameHash',begin);
if(begin<0||end<begin)throw Error('Missing exact codec');
const H=Function('CompressionStream',src.slice(begin,end)+'\nreturn createFrameHashCodec();')(undefined),id=i=>i.toString(16).padStart(32,'0');
await fs.mkdir('tests/hash-owner-fixtures',{recursive:true});
for(const [file,count,folded] of [['legacy-32.hash',32,false],['folded-100001.hash',100001,true],['flat-100001.hash',100001,false]]){
 const T=H.T,K=H.K,owners=Array.from({length:count},(_,i)=>id(0x40000000+i)),checksum=createHash('sha256');let bytes=0;
 async function* records(){yield {id:K.version,type:T.uint32,value:new Uint32Array([1])};yield {id:K.all,type:T.ids,value:owners};
 for(let i=0;i<count;i++){const owner=owners[i];yield {id:H.address(owner,'type'),type:T.bytes,value:new Uint8Array([0])};
 if(i===0||i===Math.floor(count/2)||i===count-1)yield {id:H.address(owner,'name'),type:T.text,value:'Null #'+i};
 if(folded&&i===0)yield {id:H.address(owner,'flags'),type:T.bytes,value:new Uint8Array([7])};
 if(folded&&i)yield {id:H.address(owner,'parent'),type:T.ids,value:[owners[0]]};}}
 async function* packed(){for await(const row of records()){const {blob}=await H.pack(row);for await(const chunk of blob.stream()){checksum.update(chunk);bytes+=chunk.length;yield chunk;}}}
 await pipeline(Readable.from(packed()),createWriteStream('tests/hash-owner-fixtures/'+file));console.log(JSON.stringify({file,count,folded,bytes,sha256:checksum.digest('hex'),first:owners[0],last:owners.at(-1)}));
}
