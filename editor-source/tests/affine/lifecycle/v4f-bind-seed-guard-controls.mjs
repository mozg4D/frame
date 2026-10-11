import {reviewURL} from '../source-paths.mjs';
import {verifySource} from '../verify-source.mjs';
import {deferredEnv,session,installCornerMock,assert,vm,THREE2} from '../display/support.mjs';
const {stampAttribute,attributeCurrent}=await import(reviewURL('../candidate/native-source/display-packets.mjs',import.meta.url));
verifySource();
const report={scope:'Pinned V4f actual SeedBindDisplay and Bind guard/rollback controls; native attribute stamps, mocked GPU; no browser/hardware acceptance',passed:[],errors:[],observed:[]};
async function test(name,fn){try{await fn();report.passed.push(name);}catch(e){report.errors.push({name,error:String(e),stack:e.stack});}}
async function fixture(){const {c,t}=deferredEnv();installCornerMock(c,t);Object.assign(c.frameNative,{stampAttribute,attributeCurrent});c.frameNative.drainCooperatively=async w=>{let q;do{q=w.next();}while(!q.done);return q.value;};await c.frameAffinePrepareEarly(t);const r=await c.frameAffinePrepare(t);c.frameAffineYield=()=>Promise.resolve();c.frameAffineCreateWorker=s=>{s.baseVersion=0;s.closeWorker=()=>{};};c.frameAffinePump=()=>{};c.frameAffineAdopt=()=>{};c.frameRigidSchedulePrepare=()=>null;const s=session(c,t);s.affine=true;s.kind='affine';c.frameAffineActivate(s);await c.frameAffineCommit(s);const stage=s.stage,snapshot=c.frameAffineCanonicalNow(stage);snapshot.wire=Uint32Array.of(0,1,1,2);assert(await c.frameAffineGlobalPublish(s,{revision:s.affineRevision,committed:true,timings:{}},snapshot));r.canonicalVersion=stage.logicalVersion;r.canonicalSnapshot=snapshot;r.workerPipe={closed:false,confirmedVersion:stage.logicalVersion,close(){this.closed=true;}};c.gizDrag=null;return{c,t,r,s,stage,snapshot};}
const negative={
 'missing packed row':x=>x.r.bindDisplay=null,
 'different snapshot identity':x=>x.r.bindDisplay.snapshot={...x.snapshot},
 'not last published snapshot':x=>x.r.lastPublishedSnapshot=null,
 'retired binding':x=>x.r.live=false,
 'replaced registered binding':x=>{x.c.testMesh=x.t.mesh;vm.runInContext('frameAffineBindings.set(testMesh,{})',x.c);},
 'missing owner snapshot':x=>x.r.owner=null,
 'retired owner generation':x=>x.t.owner.generation++,
 'missing native stamp API':x=>delete x.c.frameNative.stampAttribute,
 'missing native current API':x=>delete x.c.frameNative.attributeCurrent,
 'extra UV attribute':x=>x.g.setAttribute('uv',new THREE2.BufferAttribute(new Float32Array(x.g.attributes.position.count*2),2)),
 'non-xyz position':x=>x.g.attributes.position.itemSize=2,
 'non-xyz normal':x=>x.g.attributes.normal.itemSize=2,
 'normalized position':x=>x.g.attributes.position.normalized=true,
 'normalized normal':x=>x.g.attributes.normal.normalized=true,
 'wrong packed position length':x=>x.r.bindDisplay.positions=new Float32Array(1),
 'wrong packed extra length':x=>x.r.bindDisplay.extras=new Float32Array(1)
};
for(const[name,change]of Object.entries(negative))await test(`Seed rejects ${name} without creating cache rows`,async()=>{
 const x=await fixture(),{c,t,r,snapshot}=x;x.g=c.frameAffineGeometry(snapshot);t.mesh.geometry=x.g;const wire=new THREE2.BufferGeometry().setAttribute('position',x.g.attributes.position).setIndex(new THREE2.BufferAttribute(snapshot.wire,1));change(x);assert.equal(c.frameAffineSeedBindDisplay(r,t.mesh,snapshot,x.g,wire),false);assert.equal(t.engine.geometryCache.rows.has(x.g),false);assert.equal(t.engine.geometryCache.rows.has(wire),false);c.frameAffinePruneStages({clear:true});
});
const wireNegative={
 'different position attribute':x=>x.wire.setAttribute('position',x.g.attributes.position.clone()),
 'extra normal attribute':x=>x.wire.setAttribute('normal',x.g.attributes.normal),
 'copied index array':x=>x.wire.setIndex(new THREE2.BufferAttribute(x.snapshot.wire.slice(),1)),
 'missing wire index':x=>x.wire.setIndex(null),
 'wrong wire packed extra length':x=>x.r.bindDisplay.wireExtras=new Float32Array(1)
};
for(const[name,change]of Object.entries(wireNegative))await test(`Seed skips wire with ${name} and still seeds valid raw row`,async()=>{
 const x=await fixture(),{c,t,r,snapshot}=x;x.g=c.frameAffineGeometry(snapshot);t.mesh.geometry=x.g;x.wire=new THREE2.BufferGeometry().setAttribute('position',x.g.attributes.position).setIndex(new THREE2.BufferAttribute(snapshot.wire,1));change(x);assert.equal(c.frameAffineSeedBindDisplay(r,t.mesh,snapshot,x.g,x.wire),true);assert.equal(t.engine.geometryCache.rows.has(x.g),true);assert.equal(t.engine.geometryCache.rows.has(x.wire),false);c.frameAffinePruneStages({clear:true});
});
await test('Post-seed Bind failure restores packed lease and original state; same Bind can retry',async()=>{
 const {c,t,r,stage,snapshot}=await fixture(),old=t.mesh.geometry,packed=r.bindDisplay,worker=r.workerPipe,full=r.fullNumeric,oldStage={stamp:stage.stamp,bound:stage.bound,snapshot:stage.snapshot},oldWire=new THREE2.BufferGeometry().setAttribute('position',old.attributes.position).setIndex(new THREE2.BufferAttribute(snapshot.wire,1)),overlay={geometry:oldWire};c.wireOverlays.set(t.h,overlay);let g,wire,row,wireRow;
 c.refreshWireOverlay=mesh=>{g=mesh.geometry;wire=new THREE2.BufferGeometry().setAttribute('position',g.attributes.position).setIndex(new THREE2.BufferAttribute(snapshot.wire,1));overlay.geometry=wire;};
 const oldPose=c.frameRigidHistoryPose;c.frameRigidHistoryPose=()=>{row=t.engine.geometryCache.rows.get(g);wireRow=t.engine.geometryCache.rows.get(wire);assert(row?.isCurrent());assert(wireRow?.isCurrent());throw Error('controlled post-seed history-pose failure');};
 assert.throws(()=>c.frameAffineBind(stage,snapshot,true),/controlled post-seed history-pose failure/);assert.equal(t.mesh.geometry,old);assert.equal(overlay.geometry,oldWire);assert.equal(r.bindDisplay,packed);assert.equal(r.fullNumeric,full);assert.equal(r.workerPipe,worker);assert.equal(worker.closed,false);assert.equal(c.frameAffineBindingCurrent(r),true);assert.equal(c.frameRigidSource(t),true);assert.equal(c.frameRigidPrepared,t);assert.equal(t.engine.geometryCache.rows.has(g),false);assert.equal(row.isCurrent(),false);assert.equal(wireRow.isCurrent(),false);for(const[k,v]of Object.entries(oldStage))assert.equal(stage[k],v);
 report.observed.push({failedMeshRowRemoved:true,transientFailedWireRowPresent:t.engine.geometryCache.rows.has(wire),transientFailedWireRowCurrent:wireRow.isCurrent(),packedLeaseRestored:true});
 c.frameRigidHistoryPose=oldPose;c.frameAffineBind(stage,snapshot,true);assert.notEqual(t.mesh.geometry,old);assert.equal(r.bindDisplay,null);assert.equal(r.workerPipe,worker);assert.equal(worker.closed,false);assert(t.engine.geometryCache.rows.get(t.mesh.geometry).isCurrent());assert(t.engine.geometryCache.rows.get(overlay.geometry).isCurrent());c.frameAffinePruneBindings({clear:true});c.frameAffinePruneStages({clear:true});
});
console.log(JSON.stringify(report,null,2));if(report.errors.length)process.exitCode=1;
