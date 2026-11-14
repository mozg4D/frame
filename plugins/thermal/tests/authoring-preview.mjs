import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {activate} from '../plugin.js';
import {nativeCreationFixture,math,manifest,core} from './native-creation-fixture.mjs';

export async function fixture(){
 const native=nativeCreationFixture();let operations,attributes,viewport,editor,deviceReads=0;
 const context={version:1,document:native.context.document,math,
  get device(){deviceReads++;throw Error('Authoring must not acquire a numerical device.');},
  scene:{capture(){throw Error('Authoring must not capture numerical geometry.');}},
  operations:{register:v=>operations=v},attributes:{register:v=>attributes=v},
  editor:{...native.context.editor,register:v=>{editor=v;native.context.editor.register(v);}},
  viewport:{register:async v=>{viewport=v;native.entry.viewport=v;}},
  requestAttributes(){throw Error('No numerical status refresh.');},requestDraw(){throw Error('No numerical drawing.');}};
 await activate(context);const owner=native.create('thermal');native.sync();await native.context.editor.selectOwner(owner.nativeHash);
 const command=(id,args={},hash=owner.nativeHash)=>operations.find(o=>o.id===id).run(hash,args);
 return {native,owner,context,command,operations,attributes,viewport,editor,get deviceReads(){return deviceReads;}};
}
const snapshot=f=>JSON.stringify({nodes:f.native.nodes,frames:f.native.nodes.map(n=>[n.nativeHash,Array.from(f.native.local(n.nativeHash))]),transactions:f.native.transactions,selected:f.native.selected});
const shape=(f,hash)=>Array.from(f.native.local(hash));

test('manifest is a lazy authoring-only closure with genuine 32 px native icon',async()=>{
 assert.equal(manifest.assets,undefined);assert.equal(manifest.tags,undefined);
 assert.deepEqual(manifest.objects.map(o=>o.type),['thermal','thermal_probe','thermal_fan']);
 const source=await readFile(new URL('../plugin.js',import.meta.url),'utf8'),icon=await readFile(new URL('../icon.svg',import.meta.url),'utf8');
 assert.match(icon,/width="32" height="32" viewBox="0 0 32 32"/);assert.doesNotMatch(icon,/transform=/);
 assert.doesNotMatch(source,/createBuffer|createTexture|createComputePipeline|requestAdapter|solveConduction|scene-conjugate|navigator\.gpu/);
 assert.match(core,/button\.disabled=!!action\.disabled/);
 const catalogue=JSON.parse(await readFile(new URL('../../index.json',import.meta.url),'utf8'));assert.equal(catalogue.filter(x=>x==='thermal/plugin.json').length,1);
});

test('every authoring type has a disabled explicit status and no Solve or Measure action',async()=>{
 const f=await fixture(),fan=await f.command('create-fan'),probe=await f.command('create-probe');
 for(const hash of [f.owner.nativeHash,fan.hash,probe.hash]){
  const a=f.attributes(hash),s=f.command('status',{},hash);
  assert.deepEqual(a.actions[0],{id:'status',label:'Under construction',disabled:true});
  assert.ok(a.actions.every(a=>!['measure','solve-grid','solve-scene','clear','cancel'].includes(a.id)));
  assert.equal(s.authoringOnly,true);assert.equal(s.numericalAvailable,false);assert.equal(s.measurementAvailable,false);assert.equal(s.state,'under-construction');
 }
 assert.deepEqual(f.attributes(f.owner.nativeHash).actions.slice(1).map(a=>a.id),['create-fan','create-probe']);
 assert.equal(f.deviceReads,0);assert.equal(f.viewport.render,undefined);assert.equal(f.editor.flush,undefined);
});

test('every numerical endpoint rejects arbitrary input before mutation, device access or capture',async()=>{
 const f=await fixture(),probe=await f.command('create-probe');
 const before=snapshot(f),started=performance.now();
 for(const id of ['solve-grid','solve-scene','measure','inspect','inspect-velocity'])for(const hash of [f.owner.nativeHash,probe.hash])for(const args of [{},{dimensions:[1,1,1],conductivity:[1],cellSize:[.1,.1,.1]},{untrusted:'not a physical request'}]){
  const op=f.operations.find(o=>o.id===id);assert.equal(op.readOnly,true);assert.equal(op.interrupt,undefined);
  assert.throws(()=>f.command(id,args,hash),e=>e.code==='THERMAL_AUTHORING_ONLY');assert.equal(snapshot(f),before);
 }
 const wallMs=performance.now()-started;assert.ok(wallMs<100);assert.equal(f.deviceReads,0);
 console.log(JSON.stringify({operation:'30 rejection-only numerical calls',wallMs,budgetMs:100,hardwareVerified:false}));
});

test('Fan has exact 30 by 30 by 10 mm native frame and local-X direction independent of native hierarchy',async()=>{
 const f=await fixture(),{hash}=await f.command('create-fan');let fan=f.native.nodes.find(n=>n.nativeHash===hash),r=f.command('fan-inputs');
 assert.deepEqual(shape(f,hash),[.3,0,0,0,0,.3,0,0,0,0,.1,0,-25,-12.5,-12.5,1]);
 assert.deepEqual(r.fan.mapping.sizeMM,[30,30,10]);assert.deepEqual(r.fan.directionLocal,[1,0,0]);assert.equal(r.solverEligible,false);
 f.editor.parameters(fan,{Direction:'Reverse'});fan.params.Direction='Reverse';r=f.command('fan-inputs');assert.deepEqual(r.fan.directionLocal,[-1,0,0]);
 const matrix=math.rotation([0,0,1],Math.PI/2);matrix[0]*=.25;matrix[1]*=.25;matrix[4]*=.25;matrix[5]*=.25;matrix[10]=.25;
 f.native.setLocal(hash,matrix);r=f.command('fan-inputs');assert.ok(Math.abs(r.fan.normalizedWorldAxis[1]+1)<1e-12);assert.equal(r.fan.mapping.status,'unsupported-frame');
 const other=f.native.create('thermal');f.native.sync();fan.parent=other.id;assert.equal(f.command('fan-inputs',{},hash).ownerHash,f.owner.nativeHash);
 assert.equal(f.deviceReads,0);
});

test('Fan and Probe parameter validation rejects invalid references before native mutation',async()=>{
 const f=await fixture();for(const type of ['thermal_fan','thermal_probe']){
  const {hash}=await f.command(type==='thermal_fan'?'create-fan':'create-probe'),n=f.native.nodes.find(n=>n.nativeHash===hash),before=snapshot(f);
  for(const Thermal of ['missing',hash,42]){assert.throws(()=>f.editor.parameters(n,{Thermal}),e=>e.code==='INVALID_ARGUMENT');assert.equal(snapshot(f),before);}
  assert.deepEqual(f.editor.parameters(n,{Thermal:''}),{});assert.deepEqual(f.editor.parameters(n,{Thermal:f.owner.nativeHash}),{});
  if(type==='thermal_fan')for(const patch of [{'Shutoff pressure':-1},{'Free flow':0},{Direction:'Up'}])assert.throws(()=>f.editor.parameters(n,patch),e=>e.code==='INVALID_ARGUMENT');
 }
 assert.throws(()=>f.editor.parameters(f.owner,{Ambient:-274}),e=>e.code==='INVALID_ARGUMENT');
});

test('repeated completed authoring creation and metadata inspection stay bounded with zero numerical allocations',async()=>{
 const f=await fixture(),started=performance.now();
 for(let i=0;i<32;i++){const {hash}=await f.command(i%2?'create-fan':'create-probe');if(i%2){const r=f.command('fan-inputs',{},hash);assert.deepEqual(r.fan.mapping.sizeMM,[30,30,10]);}assert.equal(f.command('status',{},hash).numericalAvailable,false);}
 const wallMs=performance.now()-started;assert.ok(wallMs<1500);assert.equal(f.native.transactions,32);assert.equal(f.deviceReads,0);
 console.log(JSON.stringify({operation:'32 native preview creations plus status/Fan metadata',wallMs,budgetMs:1500,hardwareVerified:false}));
});

const sourceRecord=(id,text='inert source')=>({id,revision:0,name:'Thermal note',kind:'source',refs:[],payload:{language:'text',text}});
test('Scene author data survives Thermal child creation, selection, frames and actual native record encoding',async()=>{
 const f=await fixture(),{authorData:F,codec}=f.native,owner=f.owner.nativeHash,id='c'.repeat(32),started=performance.now();
 const replace=(hash,records)=>{const s=F.get(hash);return F.replace(hash,{epoch:s.epoch,revision:s.data.revision},records);};
 replace(owner,[sourceRecord(id)]);replace('scene',[sourceRecord(id,'root note')]);
 const ownerState=F.get(owner),rootState=F.get('scene'),before=f.native.transactions;
 const {hash}=await f.command('create-fan');assert.equal(f.native.transactions,before+1);assert.equal(f.native.selected.hash,hash);
 replace(hash,[sourceRecord(id,'same ID, different native owner')]);
 const frames=f.native.applyDelta(math.translation([3,4,5]));f.native.restoreFrames(frames);f.native.sync();
 assert.deepEqual(F.get(owner),ownerState);assert.deepEqual(F.get('scene'),rootState);assert.equal(F.get(hash).data.records[0].payload.text,'same ID, different native owner');
 for(const [address,expected,root] of [[codec.address(owner,'parameters'),ownerState.data,false],[codec.K.parameters,rootState.data,true],[codec.address(hash,'parameters'),F.get(hash).data,false]]){
  const record=f.native.records().get(address),packed=await codec.pack(record),index=await codec.index(packed.blob),decoded=JSON.parse(await codec.read(packed.blob,index.get(address)));
  assert.deepEqual(decoded.authorData,expected);if(!root)assert.equal(decoded.plugin.id,'thermal');
 }
 assert.ok(performance.now()-started<1500);assert.equal(f.deviceReads,0);
});
test('Thermal creation invalidates native field CAS while data revisions and no-op commits retain their contracts',async()=>{
 const f=await fixture(),{authorData:F,fields}=f.native,owner=f.owner.nativeHash,id='d'.repeat(32),started=performance.now();
 const field=fields.read(owner,'name');await f.command('create-probe');
 assert.throws(()=>fields.write([{owner,field:'name',value:'stale',epoch:field.epoch,revision:field.revision}]),e=>e.code==='CONFLICT');
 let s=F.get(owner);s=F.replace(owner,{epoch:s.epoch,revision:s.data.revision},[sourceRecord(id)]);
 const transactions=f.native.transactions,generation=F.generation;
 assert.deepEqual(F.replace(owner,{epoch:s.epoch,revision:s.data.revision},s.data.records),s);
 assert.equal(f.native.transactions,transactions);assert.equal(F.generation,generation);
 assert.throws(()=>F.replace(owner,{epoch:s.epoch,revision:s.data.revision},[sourceRecord(id,'changed without record revision')]),e=>e.code==='CONFLICT');
 const changed=F.replace(owner,{epoch:s.epoch,revision:s.data.revision},[{...sourceRecord(id,'changed'),revision:1}]);
 assert.equal(changed.data.revision,s.data.revision+1);assert.equal(changed.data.records[0].revision,1);
 assert.throws(()=>F.replace(owner,{epoch:s.epoch,revision:s.data.revision},[]),e=>e.code==='CONFLICT');assert.ok(performance.now()-started<1500);
});
test('Real native installation reserves preexisting Thermal owner record IDs without conflating namespaces',async()=>{
 const f=await fixture(),F=f.native.authorData,id='e'.repeat(32),owner=f.owner.nativeHash,started=performance.now();
 f.owner.authorData={version:1,revision:0,records:[sourceRecord(id)]};f.native.sync();delete f.owner.authorData;f.native.sync();
 const stale=F.get(owner);assert.throws(()=>F.replace(owner,{epoch:stale.epoch,revision:0},[sourceRecord(id,'unrelated')]),e=>e.code==='CONFLICT');
 const {hash}=await f.command('create-probe'),s=F.get(hash);
 assert.doesNotThrow(()=>F.replace(hash,{epoch:s.epoch,revision:s.data.revision},[sourceRecord(id,'other namespace')]));assert.ok(performance.now()-started<1500);
});


test('Actual checkpoint fences changed metadata once after no-op and batch guards; mutation controls detect lost or early fencing',()=>{
 // Only snapshots, history storage and UI notification endpoints are CPU adapters.
 // Execute the entire shipped checkpoint and its actual content comparator, not a
 // reimplemented checkpoint condition. This binds both fixtures' modeled changed().
 const extract=start=>{assert.equal(core.split(start).length,2);const a=core.indexOf(start);return core.slice(a,core.indexOf('\n',a));};
 const shipped=extract('function checkpoint(before){'),comparator=extract('function frameSnapshotContent(value){');
 const verify=source=>{
  for(const [label,batch,before,after,expected] of [
   ['changed metadata',0,{nodes:[{nativeHash:'a'.repeat(32),name:'before'}]},{nodes:[{nativeHash:'a'.repeat(32),name:'after'}]},1],
   ['identical snapshot',0,{nodes:[]},{nodes:[]},0],
   ['frame-only snapshot',0,{nodes:[],nativeFrames:[1],nativePivot:[0]},{nodes:[],nativeFrames:[2],nativePivot:[1]},0],
   ['batched change',1,{nodes:[]},{nodes:[{name:'new'}]},0]
  ]){
   const F=nativeCreationFixture().authorData,start=F.generation;
   const run=new Function('FrameAuthorData','frameBatchDepth','after',`
    const snapshot=()=>after,undoStack=[],frameUIUndoSequence=[];
    let redoStack=['prior redo'],frameUIRedoSequence=[1];
    const window={},frameTrimUIUndo=()=>{},frameSyncMaterials=()=>{};
    ${comparator}\n${source}
    return before=>{checkpoint(before);return {undo:undoStack.length,redo:redoStack.length};};
   `)(F,batch,JSON.stringify(after));
   const result=run(JSON.stringify(before));
   assert.equal(F.generation-start,expected,label+' generation');
   assert.equal(result.undo,expected,label+' history');
   assert.equal(result.redo,expected?0:1,label+' redo');
  }
 };
 const started=performance.now();verify(shipped);
 assert.equal(shipped.split('FrameAuthorData.changed();').length,2);
 assert.throws(()=>verify(shipped.replace('FrameAuthorData.changed();','')),/changed metadata generation/);
 const early=shipped.replace('FrameAuthorData.changed();','').replace('function checkpoint(before){','function checkpoint(before){FrameAuthorData.changed();');
 assert.throws(()=>verify(early),/identical snapshot generation/);
 assert.ok(performance.now()-started<1500,'Actual checkpoint and mutation controls exceed 1500 ms');
});
