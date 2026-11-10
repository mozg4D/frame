// Actual native preflight with explicit inert adapters; no GPU or alternate scene model.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash,webcrypto} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
function section(start,end='\n'){const a=html.indexOf(start),b=html.indexOf(end,a+start.length);assert(a>=0&&b>a,start);return html.slice(a,b);}
const H=new Function('crypto',section('function createFrameHashCodec(){','const FrameHash=createFrameHashCodec();')+';return createFrameHashCodec();')(webcrypto);
const source=section('    async function nativeDecodePlan(file){','    async function nativeDecodeMesh(file,o){');
const id=n=>n.toString(16).padStart(32,'0'),row=(id,type,value)=>({id,type,value});
const hash=async(ids,parents=new Map(),reverse=false)=>{const rows=[row(H.K.version,H.T.uint32,new Uint32Array([1])),row(H.K.all,H.T.ids,ids)];for(const uid of new Set(ids)){rows.push(row(H.address(uid,'type'),H.T.bytes,new Uint8Array([0])));if(parents.has(uid))rows.push(row(H.address(uid,'parent'),H.T.ids,parents.get(uid)));}if(reverse)rows.reverse();return new Blob((await Promise.all(rows.map(r=>H.pack(r)))).map(r=>r.blob));};
function preflight(codec=H){return new Function('FrameHash','frameValidateAuthoring','nativeRecord','FrameSpline','FM','decodeAppearancePlan','FramePlugins','tagDefinitions','FrameAuthorData','validNativeCamera',source+';return nativeDecodePlan;')(codec,v=>{assert.equal(v,undefined);return null;},(id,type,value)=>({id,type,value}),{decodeShape:()=>{throw Error('Unexpected spline fixture');}},{},async()=>({ids:new Set(),faces:[],uvs:[]}),{owner:()=>null},{},{preflightDocument(){}},()=>true);}
const ownersBlock=source.slice(source.indexOf('      const ids=await read(K.all,T.ids);'),source.indexOf('      const objects=[]'));
const parentGuard=source.split('\n').find(line=>line.includes("throw Error('Invalid HASH object metadata')"));assert(parentGuard);
const AsyncFunction=Object.getPrototypeOf(async()=>{}).constructor;
function membership(sourceIDs,{negative=false,maxReads=Infinity}={}){
 const counters={indexReads:0,setConstructions:0,hasCalls:0};
 const ids=new Proxy(sourceIDs,{get(target,key,receiver){if(typeof key==='string'&&/^\d+$/.test(key)){counters.indexReads++;if(counters.indexReads>maxReads)throw Error('Owner-array linear access budget exceeded');}return Reflect.get(target,key,receiver);}});
 class CountedSet extends Set{constructor(values){super(values);counters.setConstructions++;}has(value){counters.hasCalls++;return super.has(value);}}
 const guard=negative?parentGuard.replace('ownerIDs.has(parent[0])','ids.includes(parent[0])'):parentGuard;
 const run=new AsyncFunction('read','K','T','Set',ownersBlock+';return parent=>{const type=new Uint8Array([0]),flags=undefined,name=undefined;'+guard+';return true;};');
 return {counters,create:()=>run(async()=>ids,H.K,H.T,CountedSet)};
}

export async function hashParentMembershipChecks(){
 const checks=[],timings=[];async function check(name,fn){await fn();checks.push({name,pass:true});}
 const A=id(1),B=id(2),C=id(3),unknown=id(99),decode=preflight();
 await check('Parents may follow their children and wire-record order does not change object order',async()=>{
  const ids=[C,A,B],parents=new Map([[C,[B]],[A,[B]]]);for(const reverse of [false,true]){const p=await decode(await hash(ids,parents,reverse));assert.deepEqual(p.objects.map(o=>o.hash),ids);assert.deepEqual(p.objects.map(o=>o.parent),[B,B,null]);assert.deepEqual(p.records.get(H.K.all).value,ids);}
 });
 await check('Empty roots and independent root objects remain valid',async()=>{assert.equal((await decode(await hash([]))).objects.length,0);assert((await decode(await hash([A,B,C]))).objects.every(o=>o.parent===null));});
 await check('Duplicate owner identities still reject before object reconstruction',async()=>{await assert.rejects(()=>hash([A,A]).then(decode),/Invalid HASH objects/);});
 await check('Missing parents and zero/multiple parent references still reject',async()=>{for(const parent of [[unknown],[],[B,C]])await assert.rejects(()=>hash([A,B,C],new Map([[A,parent]])).then(decode),/Invalid HASH object metadata/);});
 await check('A matching addressed record does not make a non-owner ID a valid parent',async()=>{const file=await hash([A],new Map([[A,[unknown]]])),extra=(await H.pack(row(unknown,H.T.bytes,new Uint8Array([1])))).blob;await assert.rejects(()=>decode(new Blob([file,extra])),/Invalid HASH object metadata/);});
 await check('Self-reference and cycles still reject with the native hierarchy guard',async()=>{for(const parents of [new Map([[A,[A]]]),new Map([[A,[B]],[B,[A]]]),new Map([[A,[B]],[B,[C]],[C,[A]]])])await assert.rejects(()=>hash([A,B,C],parents).then(decode),/Invalid HASH hierarchy/);});
 await check('Owner-count limit rejects before constructing the membership Set',async()=>{const fixture=membership(new Array(100001));await assert.rejects(fixture.create,/Invalid HASH objects/);assert.equal(fixture.counters.setConstructions,0);});
 await check('Membership validation does not mutate or reorder the owner list',async()=>{const ids=Object.freeze([C,A,B]),fixture=membership(ids),validate=await fixture.create();assert(validate([B]));assert.deepEqual(ids,[C,A,B]);assert.equal(fixture.counters.indexReads,ids.length);assert.equal(fixture.counters.setConstructions,1);});
 await check('100000-owner completed membership operation has a linear access bound and latency budget',async()=>{
  const count=100000,ids=Array.from({length:count},(_,i)=>id(i+1)),fixture=membership(ids,{maxReads:count*2}),start=performance.now(),validate=await fixture.create();assert(validate(null));for(let i=0;i<count-1;i++)assert(validate([ids.at(-1)]));const ms=performance.now()-start,budgetMs=1000;
  assert.equal(fixture.counters.indexReads,count);assert.equal(fixture.counters.setConstructions,1);assert.equal(fixture.counters.hasCalls,count-1);assert(ms<budgetMs);timings.push({operation:'100000-owner membership build and 99999 parent validations',ms,budgetMs,...fixture.counters});
 });
 await check('The original array-scan negative control violates the deterministic access bound',async()=>{
  const count=1000,ids=Array.from({length:count},(_,i)=>id(i+1)),fixture=membership(ids,{negative:true,maxReads:count*4}),validate=await fixture.create();assert.throws(()=>{for(let i=0;i<count-1;i++)validate([ids.at(-1)]);},/Owner-array linear access budget exceeded/);
 });
 await check('Full native HASH preflight of 2000 owners keeps owner-list access linear',async()=>{
  const count=2000,ids=Array.from({length:count},(_,i)=>id(i+1)),parents=new Map(ids.slice(0,-1).map(uid=>[uid,[ids.at(-1)]])),file=await hash(ids,parents,true);let indexReads=0;
  const codec={...H,read:async(file,r)=>{const value=await H.read(file,r);if(r.id!==H.K.all)return value;return new Proxy(value,{get(target,key,receiver){if(typeof key==='string'&&/^\d+$/.test(key))indexReads++;return Reflect.get(target,key,receiver);}});}};
  const start=performance.now(),p=await preflight(codec)(file),ms=performance.now()-start,budgetMs=2000;assert.equal(p.objects.length,count);assert.equal(p.objects[0].parent,ids.at(-1));assert.equal(p.objects.at(-1).parent,null);assert(indexReads<=count*6,'Owner list must not be scanned once per child');assert(ms<budgetMs);timings.push({operation:'2000-owner full binary HASH preflight',ms,budgetMs,ownerArrayIndexReads:indexReads,maxOwnerArrayIndexReads:count*6,hashBytes:file.size});
 });
 return {pass:true,checks,timings,indexSHA256:createHash('sha256').update(html).digest('hex'),scope:'CPU native metadata/parent validation only. No GPU, complete standard/stress, opaque-record or canonical-store qualification.'};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){let report;try{report=await hashParentMembershipChecks();}catch(error){report={pass:false,error:error.stack,indexSHA256:createHash('sha256').update(html).digest('hex')};}await mkdir(new URL('./results/',import.meta.url),{recursive:true});await writeFile(new URL('./results/hash-parent-membership.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(!report.pass)process.exitCode=1;}
