import assert from 'node:assert/strict';
import {scene,prepared,gesture,tick} from './composed-fixture.mjs';
const rows=[];
async function test(name,run){await run();rows.push({name,pass:true});}
for(const released of [false,true])await test('actual predecessor compute rejection cancels dependent B '+(released?'after release':'while active')+' in both canonical worker and visible display',async()=>{
 const{a,pool,ctx,mesh}=await scene();let release,computing=false;const gate=new Promise(r=>release=r),transport=a.request.bind(a);let inject=true;
 a.request=async(kind,data,transfer)=>{if(kind==='compute'&&inject){inject=false;computing=true;await gate;const invalid=data.delta.slice();invalid[12]=NaN;return transport(kind,{...data,delta:invalid},transfer);}return transport(kind,data,transfer);};
 try{const q=await prepared(a),first=await gesture(a,q,1);a.finish(first);while(!computing)await tick();const second=await gesture(a,q,1);if(released)a.finish(second);else ctx.frameOrdinaryInput={r:ctx.frameOrdinaryOwners.get('A'),job:second,before:[]};
  assert.equal(a.root.position(0)[0],2);release();await first.completion;if(released)await second.completion;await a.displayTail;
  assert(second.cancelled);assert(!second.accepted);assert.equal(a.input,null);assert.equal(a.version,0);assert.equal(ctx.undoStack.length,0);assert.equal(a.root.rows.length,0);assert.equal(mesh.geometry.attributes.position.getX(0),0);assert.equal(mesh.geometry.attributes.position.array[0],0);
  if(!released){assert(ctx.frameOrdinaryInput.blocked);assert.equal(ctx.frameOrdinaryApply({}),true);assert.equal(ctx.frameOrdinaryFinish({type:'pointerup'}),true);assert.equal(ctx.frameOrdinaryInput,null);}
  const read=await prepared(a);assert.equal(read.overlayNumeric.vp.positions[0],0);await a.releaseRead(read);
 }finally{release();await a.dispose();assert.equal(pool.bytes,0);}
});
await test('same descriptor reused by released A then B preserves both worker preview rows and GPU poses',async()=>{
 const{a,pool}=await scene();a.tryPublish=async()=>false;
 try{
  const q=await prepared(a),first=await gesture(a,q,1);a.finish(first);
  const second=await gesture(a,q,1);
  assert.notEqual(first.preview,second.preview);assert.equal(a.root.rows.length,2);
  const read=await prepared(a);assert.equal(read.overlayNumeric.vp.positions[0],2);assert.equal(read.measurements.frame[12],2);
  assert.equal(a.root.position(0)[0],2);assert.equal(new Float32Array(second.row.gpu.position.storage)[0],2);
  a.finish(second,{cancel:true});await second.completion;await first.completion;
  const after=await prepared(a);assert.equal(after.overlayNumeric.vp.positions[0],1);assert.equal(a.root.position(0)[0],1);
  await a.releaseRead(q);await a.releaseRead(read);await a.releaseRead(after);
 }finally{await a.dispose();assert.equal(pool.bytes,0);}
});
await test('actual compute rejection cancels worker authoring gesture and the next Move begins and accepts',async()=>{
 const{a,pool,ctx}=await scene();a.tryPublish=async()=>false;const transport=a.request.bind(a);let inject=true;
 a.request=(kind,data,transfer)=>{if(kind==='compute'&&inject){inject=false;const invalid=data.delta.slice();invalid[12]=NaN;return transport(kind,{...data,delta:invalid},transfer);}return transport(kind,data,transfer);};
 try{
  const q=await prepared(a),bad=await gesture(a,q,.25);a.finish(bad);await bad.completion;
  assert(bad.cancelled);assert.equal(a.version,0);assert.equal(ctx.undoStack.length,0);assert.equal(a.root.rows.length,0);
  const next=await prepared(a),good=await gesture(a,next,.25);a.finish(good);await good.completion;
  assert(good.accepted);assert.equal(a.version,1);assert.equal(ctx.undoStack.length,1);assert.equal(a.packet.geometry.positions[0],.25);
  await a.releaseRead(q);await a.releaseRead(next);
 }finally{await a.dispose();assert.equal(pool.bytes,0);}
});
await test('fatal real worker event retires closed editor owner and reconstructs from last published canonical geometry',async()=>{
 const{a,pool,ctx,mesh,r}=await scene();let replacement;
 try{
  const q=await prepared(a),done=await gesture(a,q,.25);a.finish(done);await done.completion;
  for(let n=0;a.packet||a.publishing;n++){assert(n<2000,'publication settled');await tick();}
  assert(done.published);assert.equal(mesh.geometry.attributes.position.array[0],.25);
  const canonical=mesh.geometry,next=await prepared(a),unfinished=await gesture(a,next,2);
  assert.equal(canonical.attributes.position.getX(0),2.25);
  a.worker.emit('error',Error('witness: fatal transport'));await a.disposal;
  assert(a.closed);assert(unfinished.cancelled);assert(!r.current());assert.equal(canonical.attributes.position.getX(0),.25);assert.equal(ctx.undoStack.length,1);
  replacement=ctx.frameOrdinaryOwner('A');assert.notEqual(replacement,r);await replacement.actor.ready;
  assert(replacement.current());assert(!replacement.actor.closed);assert.equal(mesh.geometry,canonical);
  const read=await prepared(replacement.actor);assert.equal(read.overlayNumeric.vp.positions[0],.25);await replacement.actor.releaseRead(read);
 }finally{await replacement?.actor.dispose();await a.dispose();assert.equal(pool.bytes,0);}
});
console.log(JSON.stringify({pass:true,cases:rows.length,rows,scope:'Composed actual inline editor helpers + real Node worker transport + frozen r247 native display/pose/pool; shader execution emulated, no browser or hardware claim'}));
