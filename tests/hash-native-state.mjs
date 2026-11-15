import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {H} from './hash-codec-fixture.mjs';

const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const value={name:'\ufeffРусский 😀\n\t',empty:'',surrogates:'\ud800x\udfff',nullable:null,missing:undefined,flags:[true,false],numbers:[0,-0,Math.PI,Number.MIN_VALUE,Number.MAX_SAFE_INTEGER,-Number.MAX_SAFE_INTEGER,Infinity,-Infinity,NaN],typed:new Float64Array([0,-0,1/3]),bytes:new Uint8Array([0,255,13]),nested:[{name:'\ufeffРусский 😀\n\t'}]};
assert.deepEqual(H.values.decode(H.values.encode(value)),value);
const snapshot=H.snapshot(value);assert.deepEqual(H.openSnapshot(snapshot),value);assert.equal(snapshot.byteLength,26+H.values.encode(value).byteLength);
const ui={nodes:[{id:'n1',type:'render'}],nativeFrames:[{hash:'a'.repeat(32),matrix:[1,0,0]}],nativePivot:[0,0,0]},uiBytes=H.snapshot(ui),navigated=H.snapshot({...ui,nativeFrames:[{hash:'a'.repeat(32),matrix:[2,0,0]}]});
assert.deepEqual(H.openSnapshot(uiBytes),ui);assert(H.sameSnapshotContent(uiBytes,navigated),'Navigation records cannot create authoring Undo entries');assert(!H.sameSnapshotContent(uiBytes,H.snapshot({...ui,nodes:[]})));
assert.equal((await H.index(new Blob([uiBytes]))).size,3,'Frames and pivots use separate native HASH records');
assert(H.references(snapshot).has(value.name));assert(!H.references(snapshot).has('Русский'));
const stored=H.values.storage(value);assert(stored.startsWith('hash:'));assert.deepEqual(H.values.fromStorage(stored),value);
const original=new Uint8Array(snapshot);value.typed[0]=99;assert.equal(H.openSnapshot(original).typed[0],0,'Snapshot must own its immutable bytes');
const unsafe=Object.defineProperty({},'__proto__',{value:{polluted:true},enumerable:true});const safe=H.values.decode(H.values.encode(unsafe));assert.equal(Object.getPrototypeOf(safe),Object.prototype);assert.equal(safe.__proto__.polluted,true);assert.equal({}.polluted,undefined);
for(const bad of [new Uint8Array(),new Uint8Array([7,10,65]),new Uint8Array([8,0]),new Uint8Array([9,255,255,255,255,127]),new Uint8Array([0,0]),new Uint8Array([4,128,0])])assert.throws(()=>H.values.decode(bad));
assert.throws(()=>H.openSnapshot(snapshot.subarray(0,-1)));const cycle={};cycle.self=cycle;assert.throws(()=>H.snapshot(cycle),/cyclic/);
const id=H.K.parameters,record=await H.pack({id,type:H.T.value,value}),file=record.blob,input=H.reader(file),index=await input.index();assert.equal(index.get(id).type,H.T.value);assert.deepEqual(await input.read(index.get(id)),value);
const repeated={nodes:Array.from({length:1000},(_,i)=>({name:'Object',visible:true,enabled:true,params:{size:i,segments:16}}))};
assert(H.snapshot(repeated).byteLength<JSON.stringify(repeated).length,'Repeated authoring keys must be interned');
for(const symbol of ['function snapshot(){','function checkpoint(before)','function restore(value,heldAnimation=null){','function frameSnapshotContent(','async function frameUndoUI(']){const at=html.indexOf(symbol),line=html.slice(at,html.indexOf('\n',at));assert(!/JSON\./.test(line),symbol+' cannot use JSON');}
console.log({pass:true,checks:14,historyBytes:snapshot.byteLength,nativeType:H.T.value});
