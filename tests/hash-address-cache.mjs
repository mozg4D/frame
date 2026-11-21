import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {webcrypto,createHash} from 'node:crypto';

const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),start=html.indexOf('function createFrameHashCodec(){'),end=html.indexOf('const FrameHash=createFrameHashCodec();',start);assert(start>=0&&end>start);
const maps=[];let watching=false,lookups=0,longKeys=0;
class ObservedMap extends Map{constructor(...args){super(...args);maps.push(this);}get(key){if(watching){lookups++;if(typeof key==='string'&&key.length>32)longKeys++;}return super.get(key);}}
const H=Function('crypto','Map',html.slice(start,end)+';return createFrameHashCodec();')(webcrypto,ObservedMap),checks=[];
const check=(name,fn)=>{fn();checks.push({name,pass:true});},id=n=>n.toString(16).padStart(32,'0');
const oracle=(a,b)=>Array.from({length:32},(_,i)=>(parseInt(a[i],16)^parseInt(b[i],16)).toString(16)).join('');
check('Address results preserve exact native XOR identity for field names and explicit field IDs',()=>{for(let i=0;i<1000;i++)for(const field of ['matrix','pivot','name','parent','type','spline']){const owner=id(i+1),expected=oracle(owner,H.K[field]);assert.equal(H.address(owner,field),expected);assert.equal(H.address(owner,H.K[field]),expected);}});
check('Warm field lookups reuse owner and field keys without constructing compound address keys',()=>{const owner=id(1);H.address(owner,'matrix');watching=true;for(let i=0;i<10000;i++)assert.equal(H.address(owner,'matrix'),oracle(owner,H.K.matrix));watching=false;assert.equal(longKeys,0);assert.equal(lookups,20000);});
check('Invalid owner and field identities reject without entering the cache',()=>{for(const owner of ['',null,'ABC',id(0).toUpperCase()+'0',{}])assert.throws(()=>H.address(owner,'matrix'),/Invalid HASH identifier/);for(const field of ['unknown','',null,{}])assert.throws(()=>H.address(id(99999),field),/Invalid HASH identifier/);});
check('FIFO eviction bounds 140000 distinct owners and recreates retired owner rows exactly',()=>{
 for(let i=1;i<=140000;i++)H.address(id(i),'matrix');const fifo=maps.find(map=>map.size===131072&&map.keys().next().value?.field),owners=maps.find(map=>map.size===131072&&typeof map.keys().next().value==='string'&&map.values().next().value instanceof Map);assert(fifo);assert(owners);assert.equal(fifo.size,131072);assert.equal(owners.size,131072);assert(!owners.has(id(1)));assert.equal(H.address(id(1),'matrix'),oracle(id(1),H.K.matrix));assert.equal(fifo.size,131072);assert.equal(owners.size,131072);assert(owners.has(id(1)));for(const entry of fifo.keys())assert.equal(owners.get(entry.id).get(entry.field),entry);
});
check('Owner eviction during a new field lookup publishes the new row and keeps remaining fields reachable',()=>{
 const owner=id(999999);H.address(owner,'matrix');for(let i=140001;i<271073;i++)H.address(id(i),'matrix');assert.equal(H.address(owner,'pivot'),oracle(owner,H.K.pivot));assert.equal(H.address(owner,'matrix'),oracle(owner,H.K.matrix));assert.equal(H.address(owner,'pivot'),oracle(owner,H.K.pivot));
});
check('Scoped address calculation reuses exact known masks and validates arbitrary declared field IDs',()=>{
 const fields=['type','name','parent','flags','matrix','pivot','parameters','spline','tags','positions','indices','projection','light',id(281732)];
 for(let i=0;i<1000;i++){
  const owner=id(i*104729+1),address=H.addressOwner(owner);
  for(const field of fields){const key=H.K[field]||field;assert.equal(address(field),oracle(owner,key));assert.equal(address(key),oracle(owner,key));}
 }
 for(const bad of ['',null,'u'.repeat(32),'A'.repeat(32),id(0)+'0']){assert.throws(()=>H.addressOwner(bad),/Invalid HASH identifier/);assert.throws(()=>H.addressOwner(id(10))(bad),/Invalid HASH identifier/);}
});
const report={pass:true,checks,indexSHA256:createHash('sha256').update(html).digest('hex')};await mkdir(new URL('./results/',import.meta.url),{recursive:true});await writeFile(new URL('./results/hash-address-cache.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
