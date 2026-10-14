import assert from 'node:assert/strict';
import {fixture,gate,settle,THREE,tick} from './selection-lifecycle-fixture.mjs';
import {prepared,gesture} from './composed-fixture.mjs';
const rows=[];async function test(name,run){await run();rows.push({name,pass:true});}
async function hoverIdle(q){await settle(q,()=>!q.c.frameOrdinaryHoverState.active&&!q.c.frameOrdinaryHoverState.latest,'hover idle');}
function delayedHover(q){const hold=gate(),send=q.a.request.bind(q.a);let waiting=false,once=true;q.a.request=async(kind,data,t)=>{const result=await send(kind,data,t);if(kind==='vertex-pick-start'&&once){once=false;waiting=true;await hold.promise;}return result;};return{hold,waiting:()=>waiting};}
await test('actual onMove/updateHover/updatePolyHover cold canonical hover avoids full main geometry scan',async()=>{
 const q=await fixture();try{const read=await prepared(q.a),job=await gesture(q.a,read,.125);q.a.finish(job);await q.a.exact;await settle(q,()=>!q.a.packet&&!q.a.publishing);q.cam.position.x=.125;q.cam.updateMatrixWorld(true);
  let reads=0;const p=q.mesh.geometry.attributes.position;for(const key of ['getX','getY','getZ']){const get=p[key].bind(p);p[key]=id=>{reads++;return get(id);};}
  const sequence=q.a.sequence;q.c.onMove(q.hoverEvent());assert.equal(reads,0);assert(q.c.frameOrdinaryHoverState.active);await hoverIdle(q);assert.equal(q.c.polyHover.kind,'vertex');assert.equal(q.c.polyHover.vertexPos[0],.125);assert(reads<=3);assert.equal(q.a.sequence,sequence);assert.equal(q.a.selectionOperations||0,0);assert.equal(q.c.frameOrdinaryNotes.vertexHoverPicks,1);assert(!q.messages.some(m=>m.kind==='vertex-pick-group'));assert.equal(q.c.errors.length,0);
 }finally{await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('real hover entry coalesces moves and applies only latest pointer result',async()=>{
 const q=await fixture(),delayed=delayedHover(q);
 try{q.c.onMove(q.hoverEvent());await settle(q,delayed.waiting);for(let i=0;i<100;i++)q.c.onMove(q.hoverEvent(201+i));assert.equal(q.c.frameOrdinaryHoverState.latest.cx,300);assert.equal(q.messages.filter(m=>m.kind==='vertex-pick-start').length,1);delayed.hold.release();await hoverIdle(q);assert.equal(q.messages.filter(m=>m.kind==='vertex-pick-start').length,2);assert.equal(q.c.polyHover.vertexPos[0],1);assert.equal(q.c.frameOrdinaryNotes.vertexHoverPicks,1);assert.equal((await q.a.request('read',{baseVersion:q.a.version,ids:[]})).vertexPickCount,0);}finally{delayed.hold.release();await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('actual navigation onMove remains immediate while hover waits and rejects old camera result',async()=>{
 const q=await fixture(),delayed=delayedHover(q);
 try{q.c.onMove(q.hoverEvent());await settle(q,delayed.waiting);q.c.activeView=0;const event=q.hoverEvent(215);event.buttons=2;q.c.onMove(event);assert.equal(q.navigation(),1);assert.equal(q.c.polyHover.kind,null);delayed.hold.release();await hoverIdle(q);assert.equal(q.c.polyHover.kind,null);assert.equal(q.c.frameOrdinaryNotes.vertexHoverPicks||0,0);assert.equal(q.a.selectionOperations||0,0);}finally{delayed.hold.release();await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('late hover from A cannot overwrite current B owner result',async()=>{
 const q=await fixture(),delayed=delayedHover(q);let b;
 try{q.c.onMove(q.hoverEvent());await settle(q,delayed.waiting);const mesh=new THREE.Mesh(q.mesh.geometry.clone());mesh.position.x=1;mesh.updateMatrixWorld(true);q.c.pickMeshes.set('B',mesh);q.c.OBJ.set('B',{});q.c.selNodes.clear();q.c.selNodes.add('B');q.c.polySelection.items=new Map([['B',{vertices:new Set([0]),edges:new Set(),faces:new Set()}]]);q.c.framePolySelectionRevision++;q.c.onMove(q.hoverEvent(300));b=q.c.frameOrdinaryOwner('B').actor;delayed.hold.release();await hoverIdle(q);assert.equal(q.c.polyHover.kind,'vertex');assert.equal(q.c.polyHover.vertexPos[0],1);assert.equal(q.c.frameOrdinaryNotes.vertexHoverPicks,1);assert.equal(q.c.errors.length,0);}finally{delayed.hold.release();await b?.dispose();await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
await test('hover never holds canonical publication and source replacement invalidates its result',async()=>{
 const q=await fixture(),delayed=delayedHover(q);let replacement;
 try{q.c.onMove(q.hoverEvent());await settle(q,delayed.waiting);assert.equal(q.a.selectionOperations||0,0);q.mesh.geometry=q.mesh.geometry.clone();q.mesh.geometry.attributes.position.array[0]=.25;q.c.onMove(q.hoverEvent(225));replacement=q.c.frameOrdinaryOwner('A').actor;delayed.hold.release();await hoverIdle(q);assert.equal(q.c.polyHover.vertexPos[0],.25);assert.equal(q.c.errors.length,0);}finally{delayed.hold.release();await replacement?.dispose();await q.a.dispose();assert.equal(q.pool.bytes,0);}
});
console.log(JSON.stringify({pass:true,cases:rows.length,rows,scope:'Actual generated onMove -> updateHover -> updatePolyHover, owning real worker, current source/camera/pointer guards and coalescing. Small public data, emulated GPU and controlled peripherals; no browser/FPS claim.'}));
