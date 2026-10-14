import assert from 'node:assert/strict';
import {OrdinaryMoveActor} from '../../../native-source/ordinary-move-actor.mjs';
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const gate=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const tick=()=>new Promise(r=>setTimeout(r,0));
const rows=[];
async function test(name,run){await run();rows.push({name,pass:true});}
const descriptor=token=>({token,renderVersion:0,rawIDs:new Uint32Array([0]),rawMask:new Uint8Array([1]),selection:{vertices:[0],edges:[],faces:[]}});
const geometry=n=>({positions:new Float32Array([n,0,0]),normals:new Float32Array([0,0,1]),indices:new Uint32Array([0,0,0]),groups:[],drawRange:{start:0,count:Infinity},userData:{}});
const packet=(version,n=version)=>({token:'move:'+version,gesture:version,revision:1,baseVersion:version-1,version,ownerVersion:7,geometry:geometry(n),numeric:{positions:new Float32Array([n,0,0]),extras:new Float32Array(9),indices:new Uint32Array([0,0,0]),vertexCount:1},derived:{pointElements:new Uint32Array([0,0,0])}});
class Root {
 constructor(options={}){this.mesh=options.mesh;this.numeric=options.numeric;this.rows=[];this.transition=false;this.disposed=false;this.serial=0;}
 async initialize(){return this;}
 async begin(){if(this.transition)throw new DOMException('Cancellation owns buffers','AbortError');const row={id:++this.serial,live:true,scheduler:{whenIdle:async()=>{}}};this.rows.push(row);return row;}
 pose(){return true;}
 release(row){row.released=true;}
 async cancelFrom(row){this.transition=true;this.cancelStarted=true;if(this.cancelGate)await this.cancelGate.promise;const at=this.rows.indexOf(row);if(at>=0)for(const child of this.rows.splice(at))child.live=false;this.transition=false;}
 async dispose(){this.disposed=true;}
}
function fixture(){
 const owner={geometry:geometry(0),live:true},gui={selected:'A',revision:0,cm:'A'},backend={version:0,history:null},calls=[],errors=[],commands=[];
 const a=Object.create(OrdinaryMoveActor.prototype);
 Object.assign(a,{native:{},mesh:owner,ownerVersion:7,version:0,renderVersion:0,sequence:0,closed:false,input:null,pending:new Map(),jobs:[],requestSerial:0,operations:0,exact:Promise.resolve(),displayTail:Promise.resolve(),tasks:{yield:async()=>{},dispose(){}},DisplayRootType:Root,root:new Root({mesh:owner}),initialDerived:{},worker:{terminate(){this.terminated=true;}}});
 a.ready=Promise.resolve(a);
 a.hooks={current:()=>owner.live,error:e=>errors.push(e),render(){},pose(){},metadata(){return{};},aliases:()=>[],geometry:raw=>raw,selection:()=>({vertices:[0],edges:[],faces:[]}),copySelection:async s=>s,context:()=>({world:identity,inverse:identity,domain:'vertex',space:'world'}),
  selectionStamp:()=>({selected:gui.selected,revision:gui.revision}),selectionCurrent:s=>gui.selected==='A'&&gui.revision===s.revision&&s.selected==='A',stageEntry:async r=>{r.entry=r.selection;},stageSelection:async r=>{r.uploads=[];},releaseSelection:r=>{if(r)r.released=true;},command:j=>commands.push(j),failed:jobs=>{for(const j of jobs){const i=commands.indexOf(j);if(i>=0)commands.splice(i,1);}},published(){},refresh:async()=>{},
  prepareInstall(g,r,options){const old=owner.geometry,cm=gui.cm;let changed=false;return{commit(){changed=true;owner.geometry=g;if(options.present())gui.cm='A:new';if(a.throwCommit)throw Error('partial install failure');},rollback(){if(changed){owner.geometry=old;if(gui.selected==='A')gui.cm=cm;}},finish(){if(a.throwFinish)throw Error('post-ack cleanup failure');}};}
 };
 a.request=async(kind,data={})=>{a.check();calls.push({kind,data});
  if(a.requestOverride){const q=await a.requestOverride(kind,data);if(q!==undefined)return q;}
  if(kind==='preview-begin')return{preview:calls.length};
  if(['descriptor-claim','descriptor-release','preview-pose','preview-cancel','cancel','selection-start','selection-chunk','selection-finish','selection-cancel'].includes(kind))return{};
  if(kind==='begin-descriptor')return{gesture:backend.version+1,baseVersion:backend.version,ownerVersion:7};
  if(kind==='compute')return packet(backend.version+1);
  if(kind==='accept'){assert.deepEqual(Object.keys(data).sort(),['baseVersion','gesture','ownerVersion','revision','token']);backend.version++;return{version:backend.version};}
  if(kind==='publish-read')return{selection:{vertices:[0],edges:[],faces:[]},overlayNumeric:{},measurements:null};
  if(kind==='ack-render')return{version:backend.version};
  if(kind==='history-prepare'){backend.history={token:'history:owned',baseVersion:backend.version};return{...packet(backend.version+1,0),...backend.history};}
  if(kind==='history-accept'){assert.equal(data.token,backend.history.token);backend.version++;backend.history=null;return{version:backend.version};}
  if(kind==='history-cancel'){backend.history=null;return{cancelled:true};}
  throw Error('Unexpected request '+kind);
 };
 return{a,owner,gui,backend,calls,errors,commands};
}
function start(a,token=1){return a.start(Promise.resolve(descriptor(token)),{world:identity,inverse:identity,identity,selection:{vertices:[0]}});}

await test('cancel A finishes rollback before immediate B begin',async()=>{
 const{a}=fixture(),cancel=gate();a.root.cancelGate=cancel;
 const first=start(a);await first.display;a.finish(first,{cancel:true});
 const second=start(a,2);let settled=false;second.display.then(()=>settled=true,()=>settled=true);
 await tick();assert(a.root.cancelStarted);assert(!settled);assert.equal(a.root.serial,1);
 cancel.resolve();await first.completion;await second.display;assert.equal(a.root.serial,2);a.root.cancelGate=null;a.finish(second,{cancel:true});await second.completion;
});
await test('compute failure creates no phantom command and retires its preview',async()=>{
 const{a,commands,calls}=fixture();a.requestOverride=async kind=>{if(kind==='compute')throw Error('controlled Stock error');};
 const j=start(a);await j.display;a.finish(j);await j.completion;
 assert.equal(commands.length,0);assert.equal(a.root.rows.length,0);assert.equal(a.version,0);assert(calls.some(c=>c.kind==='cancel'&&c.data.gesture===j.begin.gesture));
});
await test('accept is metadata-only and success registers one history command',async()=>{
 const{a,commands,calls}=fixture();const publish=a.tryPublish;a.tryPublish=async()=>false;
 const j=start(a);await j.display;a.finish(j);await j.completion;
 assert.equal(commands.length,1);const ack=calls.find(c=>c.kind==='accept');assert(ack);assert(!ack.data.geometry&&!ack.data.numeric&&!ack.data.derived);assert.equal(a.version,1);a.tryPublish=publish;
});
for(const selected of ['B',null,'unsupported-mode'])await test('geometry commits while presentation belongs to '+selected,async()=>{
 const{a,owner,gui,backend}=fixture();backend.version=a.version=1;a.packet=packet(1);gui.selected=selected;gui.cm='unchanged';
 assert(await a.tryPublish());assert.equal(owner.geometry.positions[0],1);assert.equal(gui.selected,selected);assert.equal(gui.cm,'unchanged');assert.equal(a.renderVersion,1);
});
await test('partial UI bind failure rolls geometry back and sends no acknowledgement',async()=>{
 const{a,owner,backend,calls}=fixture();backend.version=a.version=1;a.packet=packet(1);const old=owner.geometry;a.throwCommit=true;
 assert.equal(await a.tryPublish(),false);assert.equal(owner.geometry,old);assert(!calls.some(c=>c.kind==='ack-render'));assert(a.packet);
});
await test('failed history acknowledgement leaves worker, actor and UI revision unchanged',async()=>{
 const{a,owner,backend}=fixture();backend.version=a.version=a.renderVersion=1;owner.geometry=geometry(1);
 a.requestOverride=async kind=>{if(kind==='history-accept')throw Error('ack rejected before mutation');};
 const old=owner.geometry;await assert.rejects(a.history({accepted:true,token:'move:1'},'undo'));
 assert.equal(a.version,1);assert.equal(backend.version,1);assert.equal(owner.geometry,old);assert.equal(backend.history,null);assert(!a.historyBusy);
});
await test('history staging failure never advances the worker ledger',async()=>{
 const{a,owner,backend}=fixture();backend.version=a.version=a.renderVersion=1;owner.geometry=geometry(1);
 a.hooks.stageSelection=async()=>{throw Error('controlled upload error');};const old=owner.geometry;
 await assert.rejects(a.history({accepted:true,token:'move:1'},'undo'));assert.equal(backend.version,1);assert.equal(a.version,1);assert.equal(owner.geometry,old);
});
await test('post-ack cleanup failure keeps the committed history consistent',async()=>{
 const{a,owner,backend}=fixture();backend.version=a.version=a.renderVersion=1;owner.geometry=geometry(1);a.throwFinish=true;
 await a.history({accepted:true,token:'move:1'},'undo');assert.equal(backend.version,2);assert.equal(a.version,2);assert.equal(a.renderVersion,2);assert.equal(owner.geometry.positions[0],0);
});
await test('owner mutation during compute prevents stale metadata acknowledgement',async()=>{
 const{a,owner,calls,commands}=fixture();const compute=gate();a.requestOverride=async kind=>{if(kind==='compute')return compute.promise;};
 const j=start(a);await j.display;a.finish(j);while(!calls.some(c=>c.kind==='compute'))await tick();owner.live=false;compute.resolve(packet(1));await j.completion;
 assert(!calls.some(c=>c.kind==='accept'));assert.equal(commands.length,0);
});
await test('worker failure retires actor and rejects every subsequent request',async()=>{
 const{a}=fixture();let rejected=false;a.pending.set(1,{reject(){rejected=true;}});a.fail(Error('controlled worker failure'));
 assert(rejected);assert(a.closed);assert(a.worker.terminated);await assert.rejects(a.request('read'),{name:'AbortError'});
});
console.log(JSON.stringify({pass:true,cases:rows.length,rows,scope:'Actual OrdinaryMoveActor methods with controlled transport/root/UI transactions; no browser or hardware claim'}));
