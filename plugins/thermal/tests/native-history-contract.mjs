import test from 'node:test';
import assert from 'node:assert/strict';
import {historyFixture} from './native-history-fixture.mjs';

const OWNER='a'.repeat(32),FAN='b'.repeat(32);
const authoring=()=>[
 {id:'owner-id',nativeHash:OWNER,type:'thermal',params:{Initial:26.85,Ambient:20},tags:[]},
 {id:'fan-id',nativeHash:FAN,parent:'owner-id',type:'thermal_fan',params:{Thermal:OWNER,Direction:'Forward'},tags:[]}
];
const frame=y=>[.25,0,0,0,.25,0,0,0,.25,-25,y,-12.5];

test('Actual core transform Undo restores Fan matrix while retaining exact owner and Fan JS objects',async()=>{
 const nodes=authoring(),f=historyFixture(nodes);f.setFrame(FAN,frame(-12.5));const before=f.frames();f.setFrame(FAN,frame(3));f.pushFrame(before,f.frames());
 assert.deepEqual(f.frame(FAN),frame(3));await f.undo();
 assert.strictEqual(f.nodes,nodes);assert.strictEqual(f.nodes[0],nodes[0]);assert.strictEqual(f.nodes[1],nodes[1]);assert.deepEqual(f.frame(FAN),frame(-12.5));
 assert.deepEqual(f.nodes[1].params,{Thermal:OWNER,Direction:'Forward'});assert.equal(f.frameRedo,1);assert.equal(f.documentRedo,0);assert.deepEqual(f.events,['frame-engine-parents']);
});
test('Actual core authoring delete Undo replaces JS nodes, preserves durable identities and dispatches restored',async()=>{
 const nodes=authoring();let notified=0;const f=historyFixture(nodes,()=>notified++);f.deleteOwner(OWNER);assert.equal(f.nodes.length,0);await f.undo();
 assert.notStrictEqual(f.nodes,nodes);assert.notStrictEqual(f.nodes[0],nodes[0]);assert.notStrictEqual(f.nodes[1],nodes[1]);assert.deepEqual(f.nodes,nodes);
 assert.equal(notified,1);assert.equal(f.documentRedo,1);assert.equal(f.frameRedo,0);assert.deepEqual(f.events,['restored']);
});
test('Actual core chronological dispatcher prefers document Undo over older transform metadata',async()=>{
 const nodes=authoring(),f=historyFixture(nodes);f.setFrame(FAN,frame(-12.5));const before=f.frames();f.setFrame(FAN,frame(3));f.pushFrame(before,f.frames());f.deleteOwner(OWNER);await f.undo();
 assert.notStrictEqual(f.nodes[0],nodes[0]);assert.equal(f.documentRedo,1);assert.equal(f.frameRedo,0);assert.deepEqual(f.events,['restored']);
});

const record=(id='c'.repeat(32),text='saved')=>({id,revision:0,name:'Source',kind:'source',refs:[],payload:{language:'text',text}});
const replace=(F,owner,records)=>{const s=F.get(owner);return F.replace(owner,{epoch:s.epoch,revision:s.data.revision},records);};
test('Thermal delete Undo restores owner-local and root data while fencing pre-Undo CAS',async()=>{
 const nodes=authoring(),f=historyFixture(nodes),F=f.authorData,started=performance.now();
 replace(F,OWNER,[record()]);replace(F,FAN,[record('c'.repeat(32),'fan namespace')]);replace(F,'scene',[record('d'.repeat(32),'root')]);
 const before=structuredClone(f.nodes),s=F.get(OWNER),root=F.root();f.deleteOwner(OWNER);await f.undo();
 assert.deepEqual(f.nodes,before);assert.deepEqual(F.root(),root);assert.notEqual(F.epoch,s.epoch);
 assert.throws(()=>F.replace(OWNER,{epoch:s.epoch,revision:s.data.revision},[]),e=>e.code==='CONFLICT');
 assert.equal(F.get(FAN).data.records[0].payload.text,'fan namespace');assert.ok(performance.now()-started<1500);
});
test('Thermal transform Undo retains real author records and object identities',async()=>{
 const nodes=authoring(),f=historyFixture(nodes),F=f.authorData,started=performance.now();replace(F,OWNER,[record()]);replace(F,FAN,[record()]);
 const state=F.get(FAN);f.setFrame(FAN,frame(-12.5));const before=f.frames();f.setFrame(FAN,frame(3));f.pushFrame(before,f.frames());await f.undo();
 assert.strictEqual(f.nodes,nodes);assert.strictEqual(f.nodes[1],nodes[1]);assert.deepEqual(F.get(FAN).data,state.data);assert.notEqual(F.epoch,state.epoch);assert.throws(()=>F.replace(FAN,{epoch:state.epoch,revision:state.data.revision},[]),e=>e.code==='CONFLICT');assert.deepEqual(f.frame(FAN),frame(-12.5));assert.ok(performance.now()-started<1500);
});
test('Thermal document Undo preserves retired owner and root IDs across branches',async()=>{
 const f=historyFixture(authoring()),F=f.authorData,id='e'.repeat(32),started=performance.now(),before=f.snapshot();
 replace(F,OWNER,[record(id)]);replace(F,'scene',[record(id)]);f.pushDocument(before);await f.undo();
 for(const owner of [OWNER,'scene']){const s=F.get(owner);assert.deepEqual(s.data.records,[]);assert.ok(s.data.retired.includes(id));assert.throws(()=>F.replace(owner,{epoch:s.epoch,revision:s.data.revision},[record(id,'new identity')]),e=>e.code==='CONFLICT');}
 assert.doesNotThrow(()=>replace(F,FAN,[record(id,'separate owner')]));assert.ok(performance.now()-started<1500);
});
test('Thermal history reservation overflow rejects before stack movement or node replacement',async()=>{
 const f=historyFixture(authoring()),F=f.authorData,started=performance.now();
 const ids=Array.from({length:4096},(_,i)=>i.toString(16).padStart(32,'0'));
 f.nodes[0].authorData={version:1,revision:0,records:[],retired:ids};F.installed();const target=f.snapshot();
 f.nodes[0].authorData={version:1,revision:1,records:[record('f'.repeat(32))],retired:ids};F.installed();f.pushDocument(target);
 const nodes=f.nodes,state=f.snapshot(),epoch=F.epoch;await assert.rejects(f.undo(),/retired/);
 assert.strictEqual(f.nodes,nodes);assert.equal(f.snapshot(),state);assert.notEqual(F.epoch,epoch);assert.equal(f.documentUndo,1);assert.equal(f.documentRedo,0);assert.ok(performance.now()-started<1500);
});
