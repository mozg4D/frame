import assert from 'node:assert/strict';
import * as THREE from '../../../modules/frame-three-core.9edde002b066a9a05676.js';
import {scene,prepared,gesture,tick,context} from './composed-fixture.mjs';
function geometry(faces){const p=new Float32Array(faces*9),n=new Float32Array(p.length),ix=new Uint32Array(faces*3);for(let f=0;f<faces;f++){const at=f*9,x=f*2;p.set([x,0,0,x+1,0,0,x,1,0],at);n[at+2]=n[at+5]=n[at+8]=1;}for(let i=0;i<ix.length;i++)ix[i]=i;const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(p,3));g.setAttribute('normal',new THREE.BufferAttribute(n,3));g.setIndex(new THREE.BufferAttribute(ix,1));return g;}
function transport(a){const send=a.worker.postMessage.bind(a.worker),messages=[];a.worker.postMessage=(message,transfers=[])=>{const{chunk,...header}=message;messages.push({kind:message.kind,headerBytes:JSON.stringify(header).length,selection:message.selection!==undefined,chunkWords:chunk?.length??0,chunkBytes:chunk?.buffer.byteLength??0,transferCount:transfers.length});return send(message,transfers);};return messages;}
async function published(a){await a.exact;for(let n=0;a.packet||a.publishing;n++){assert(n<2000);await tick();}}
const rows=[];async function test(name,run){await run();rows.push({name,pass:true});}
for(const count of [1,15000])await test('real release envelope is scalar for '+count+' selected vertices; read/publish stream typed chunks',async()=>{
 const q=await scene({geometry:geometry(count===1?1:5000)}),messages=transport(q.a);try{const vertices=Array.from({length:count},(_,i)=>i);q.ctx.polySelection.items.get('A').vertices=new Set(vertices);q.ctx.framePolySelectionRevision++;
  const read=await q.a.read({vertices,edges:[],faces:[]},context,{selectionRevision:7});assert(read.selection.vertices instanceof Uint32Array);assert(read.selection.faces instanceof Uint32Array);assert(read.selection.edges instanceof Uint32Array);
  Object.defineProperty(read,'selection',{get(){throw Error('release must not read host selection arrays');}});
  const job=await gesture(q.a,read,.125);q.a.finish(job);await published(q.a);assert(job.accepted);assert.equal(q.mesh.geometry.attributes.position.array[0],.125);
  const begin=messages.filter(m=>m.kind==='begin-descriptor');assert.equal(begin.length,1);assert(begin[0].headerBytes<=256);assert(!begin[0].selection);assert.equal(begin[0].transferCount,0);
  for(const kind of ['prepare-read','publish-read'])for(const m of messages.filter(m=>m.kind===kind)){assert(!m.selection);assert(m.headerBytes<2048);}
  const chunks=messages.filter(m=>m.kind==='selection-chunk');assert(chunks.length>0);for(const m of chunks){assert(m.chunkWords<=8192);assert(m.chunkBytes<=32768);assert.equal(m.transferCount,1);}
  rows.push({name:'measured message byte bounds for '+count+' IDs',pass:true,selectedIDs:count,beginHeaderBytes:begin[0].headerBytes,maxSelectionTransferBytes:Math.max(...chunks.map(m=>m.chunkBytes)),selectionChunks:chunks.length});
 }finally{await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
for(const domain of ['vertex','edge','face'])await test('worker-pinned '+domain+' selection survives host DTO mutation and queued reuse',async()=>{
 const q=await scene();q.a.tryPublish=async()=>false;try{const entry=q.ctx.polySelection.items.get('A');entry.vertices.clear();entry.edges.clear();entry.faces.clear();entry[domain==='vertex'?'vertices':domain==='edge'?'edges':'faces'].add(domain==='edge'?'0:1':0);q.ctx.polyElementMode=domain;
  const selection={vertices:[...entry.vertices],edges:[...entry.edges],faces:[...entry.faces]},read=await q.a.read(selection,{...context,domain},{selectionRevision:3});
  for(const field of Object.values(read.selection))field.fill(0xffffffff);
  const a=await gesture(q.a,read,.125);q.a.finish(a);const b=await gesture(q.a,read,.125);q.a.finish(b);await a.completion;await b.completion;assert(a.accepted&&b.accepted);assert.equal(q.a.version,2);assert.equal(q.a.packet.geometry.positions[0],.25);
  assert.equal(q.a.packet.geometry.positions[3],domain==='vertex'?1:1.25);assert.equal(q.a.packet.geometry.positions[6],domain==='face'?.25:0);assert.equal(q.ctx.undoStack.length,2);
 }finally{await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('stale descriptor selection revision rejects begin atomically, cancels display and permits a fresh gesture',async()=>{
 const q=await scene();q.a.tryPublish=async()=>false;try{const read=await q.a.read({vertices:[0]},context,{selectionRevision:5}),a=await gesture(q.a,read,.125);read.selectionRevision=6;q.a.finish(a);await a.completion;
  assert(a.cancelled);assert(!a.accepted);assert.equal(q.a.version,0);assert.equal(q.a.root.rows.length,0);assert.equal(q.mesh.geometry.attributes.position.getX(0),0);assert.equal(q.ctx.undoStack.length,0);
  const fresh=await q.a.read({vertices:[0]},context,{selectionRevision:7}),b=await gesture(q.a,fresh,.125);q.a.finish(b);await b.completion;assert(b.accepted);assert.equal(q.a.version,1);await q.a.releaseRead(read);await q.a.releaseRead(fresh);
 }finally{await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('failed prepared read releases its completed typed selection upload instead of retaining it until publication',async()=>{
 const q=await scene();try{await assert.rejects(q.a.read({vertices:[3]},context));const state=await q.a.request('read',{baseVersion:0,ids:[]});assert.equal(state.selectionUploadCount,0);const read=await prepared(q.a),job=await gesture(q.a,read,.125);q.a.finish(job,{cancel:true});await job.completion;assert.equal(q.a.jobs.length,0);}
 finally{await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
console.log(JSON.stringify({pass:true,cases:rows.length,rows,scope:'Actual postMessage envelopes, worker-pinned selection proof/rebase and bounded typed transfers in real actor/worker/native display; GPU emulated, no browser stall or FPS claim'}));
