import {verifySource} from '../verify-source.mjs';
import {deferredEnv,session,installCornerMock,assert,vm,THREE2,tick} from '../display/support.mjs';
verifySource();
const report={scope:'Pinned V4f actual source publication/adoption held-yield controls; mocked GPU calls; no browser or hardware acceptance',passed:[],errors:[],observed:[]};
async function test(name,fn){try{await fn();report.passed.push(name);}catch(e){report.errors.push({name,error:String(e),stack:e.stack});}}
const bytes=a=>Array.from(new Uint8Array(a.buffer,a.byteOffset,a.byteLength));
function holdYields(c,target){let count=0,release,hit;const reached=new Promise(r=>hit=r);c.frameAffineYield=()=>{if(++count===target){hit();return new Promise(r=>release=r);}return Promise.resolve();};return{reached,release:()=>release(),count:()=>count};}
async function pubFixture(){const x=deferredEnv(),{c,t}=x,stats=installCornerMock(c,t);c.frameNative.drainCooperatively=async work=>{let step;do{step=work.next();}while(!step.done);return step.value;};await c.frameAffinePrepareEarly(t);const r=await c.frameAffinePrepare(t);c.frameAffineCreateWorker=s=>{s.baseVersion=0;s.closeWorker=()=>{};};c.frameAffinePump=()=>{};const s=session(c,t);s.affine=true;s.kind='affine';c.frameAffineActivate(s);s.affineRevision=1;const snapshot=c.frameAffineRawSnapshot(t);snapshot.attrs.position.array[0]+=7;snapshot.wire=Uint32Array.of(0,1,1,2);let writes=0;t.device.queue.writeBuffer=()=>writes++;const q={revision:1,committed:true,timings:{}};return{...x,r,s,snapshot,q,stats,writes:()=>writes};}
for(const target of [1,2,3,4])for(const mode of ['cancel','newer-pose','next-gesture','owner-generation','source-version','binding-retirement'])await test(`Publication yield ${target}: ${mode} blocks stale corner/GPU writes`,async()=>{
 const x=await pubFixture(),{c,t,r,s,snapshot,q}=x,hold=holdYields(c,target),result=c.frameAffineGlobalPublish(s,q,snapshot);await hold.reached;
 const before=bytes(r.numeric.positions),author=bytes(t.p.array);
 if(mode==='cancel')c.frameAffineCancelSession(s);
 if(mode==='newer-pose'){s.delta.makeTranslation(3,0,0);c.frameAffineSubmit(s);}
 if(mode==='next-gesture'){const next=session(c,t);next.affine=true;next.kind='affine';c.frameAffineStartPreview(next);assert.equal(r.active,next);assert.equal(r.bindDisplay,null);}
 if(mode==='owner-generation')t.owner.generation++;
 if(mode==='source-version')t.p.needsUpdate=true;
 if(mode==='binding-retirement')c.frameAffineRetireBinding(r);
 const corner=r.numeric?bytes(r.numeric.positions):null,raw=bytes(t.numeric.positions),writes=x.writes();hold.release();assert.equal(await result,false);assert.equal(x.writes(),writes);if(r.numeric)assert.deepEqual(bytes(r.numeric.positions),corner);assert.deepEqual(bytes(t.numeric.positions),raw);assert.deepEqual(bytes(t.p.array),author);
 if(r.fullNumeric)assert.equal(r.fullNumeric.isCurrent(),false);
 c.frameAffinePruneBindings({clear:true});
});
await test('Successful final publication exposes expected whole row before final yield but commits corner/GPU data only afterward',async()=>{
 const {c,t,r,s,snapshot,q,writes}=await pubFixture(),hold=holdYields(c,4),promise=c.frameAffineGlobalPublish(s,q,snapshot);await hold.reached;assert.equal(r.fullNumeric.source,snapshot);assert.equal(r.fullNumeric.isCurrent(),true);assert.equal(r.bindDisplay.snapshot,snapshot);assert.equal(r.lastPublishedSnapshot,undefined);assert.equal(writes(),0);assert.notEqual(r.bindDisplay.positions,snapshot.attrs.position.array);const before=r.numeric.positions.slice();hold.release();assert.equal(await promise,true);assert.equal(writes(),3);assert.equal(r.lastPublishedSnapshot,snapshot);assert.notDeepEqual(r.numeric.positions,before);assert.equal(r.fullNumeric.isCurrent(),true);c.frameAffinePruneBindings({clear:true});report.observed.push({publicationYields:4,wholeRowVisibleBeforeCornerWrites:true,finalGPUWrites:3});
});
async function adoptionFixture(){const {c,t}=deferredEnv();c.frameRigidSchedulePrepare=()=>null;c.frameAffinePump=()=>{};const originalAdopt=c.frameAffineAdopt;c.frameAffineAdopt=()=>{};const s=session(c,t);s.affine=true;s.kind='affine';s.r={faceSlots:Int32Array.of(1,0)};s.faceSlots=s.r.faceSlots;s.delta.makeRotationX(Math.PI/2);s.afterGizmo=s.delta.elements.slice();s.faceIDs=t.faceIDs;s.beforeRaw=c.frameAffineRawSnapshot(t);s.beforeExact=Promise.resolve(s.beforeRaw);s.affineRevision=1;s.baseVersion=0;s.closeWorker=()=>{};c.setGizmoFromMatrix(s.afterGizmo);await c.frameAffineCommit(s);const stage=s.stage,snapshot=c.frameAffineCanonicalNow(stage);c.frameAffineAdopt=originalAdopt;c.gizDrag=null;const timers=[];c.setTimeout=(fn,ms)=>{timers.push({fn,ms});return timers.length;};return{c,t,s,stage,snapshot,timers};}
for(const mode of ['stage-generation','owner-replacement','mesh-replacement','source-version','lifecycle-clear','undo','undo-redo','silent-content-edit','busy-next-gesture'])await test(`Before-Bind yield: ${mode} cannot install stale result`,async()=>{
 const {c,t,s,stage,snapshot,timers}=await adoptionFixture(),hold=holdYields(c,1),promise=c.frameAffineAdopt(stage);await hold.reached;
 const old=t.mesh.geometry;let bindCalls=0;const bind=c.frameAffineBind;c.frameAffineBind=(...args)=>{bindCalls++;return bind(...args);};
 if(mode==='stage-generation')stage.generation++;
 if(mode==='owner-replacement')c.OBJ.set(t.h,{});
 if(mode==='mesh-replacement')c.pickMeshes.set(t.h,{...t.mesh});
 if(mode==='source-version')t.p.needsUpdate=true;
 if(mode==='lifecycle-clear')c.frameAffinePruneStages({clear:true});
 if(mode==='undo')c.undo();
 if(mode==='undo-redo'){c.undo();c.redo();}
 if(mode==='silent-content-edit')t.p.array[0]+=0.25;
 if(mode==='busy-next-gesture')c.gizDrag={mode:'scale'};
 const afterAction=t.mesh.geometry,priorBinds=bindCalls;hold.release();assert.equal(await promise,false);assert.equal(bindCalls,priorBinds);assert.equal(t.mesh.geometry,afterAction);
 if(mode==='silent-content-edit')assert.match(String(stage.error),/history content changed/);
 if(mode==='busy-next-gesture'){assert.equal(timers.length,1);assert.equal(timers[0].ms,32);c.gizDrag=null;timers.shift().fn();await stage.installPromise;assert.equal(bindCalls,1);assert.notEqual(t.mesh.geometry,old);assert.equal(stage.snapshot,snapshot);}
 c.frameAffinePruneStages({clear:true});
});
await test('Before-Bind yield valid stage installs once and forgets pending stage',async()=>{
 const {c,t,stage,snapshot}=await adoptionFixture(),hold=holdYields(c,1),old=t.mesh.geometry,promise=c.frameAffineAdopt(stage);await hold.reached;assert.equal(t.mesh.geometry,old);hold.release();assert.equal(await promise,true);assert.notEqual(t.mesh.geometry,old);assert.equal(stage.snapshot,snapshot);assert.equal(vm.runInContext('frameAffineStages.size',c),0);assert.deepEqual(bytes(t.mesh.geometry.attributes.position.array),bytes(snapshot.attrs.position.array));
});
await test('Out-of-order publication completion cannot overwrite a newer exact pose or its packed Bind row',async()=>{
 const {c,t,r,s,snapshot,q,writes}=await pubFixture(),hold=holdYields(c,4),older=c.frameAffineGlobalPublish(s,{...q,committed:false},snapshot);await hold.reached;s.delta.makeTranslation(3,0,0);c.frameAffineSubmit(s);assert.equal(s.affineRevision,2);const newerSnapshot=c.frameAffineRawSnapshot(t);newerSnapshot.attrs.position.array[0]+=14;newerSnapshot.wire=snapshot.wire;c.frameAffineYield=()=>Promise.resolve();assert.equal(await c.frameAffineGlobalPublish(s,{revision:2,committed:true,timings:{}},newerSnapshot),true);const row=r.fullNumeric,packed=r.bindDisplay,positions=bytes(r.numeric.positions),raw=bytes(t.numeric.positions),writeCount=writes();hold.release();assert.equal(await older,false);assert.equal(r.fullNumeric,row);assert.equal(r.fullNumeric.isCurrent(),true);assert.equal(r.bindDisplay,packed);assert.equal(r.lastPublishedSnapshot,newerSnapshot);assert.deepEqual(bytes(r.numeric.positions),positions);assert.deepEqual(bytes(t.numeric.positions),raw);assert.equal(writes(),writeCount);c.frameAffinePruneBindings({clear:true});
});
await test('Out-of-order before-Bind completion cannot replace a newer successfully adopted stage',async()=>{
 const {c,t,stage}=await adoptionFixture(),realAdopt=c.frameAffineAdopt,hold=holdYields(c,1),older=realAdopt(stage);await hold.reached;c.frameAffineAdopt=()=>{};c.frameAffineYield=()=>Promise.resolve();const s2=session(c,t);s2.affine=true;s2.kind='affine';s2.r={faceSlots:Int32Array.of(1,0)};s2.faceSlots=s2.r.faceSlots;s2.delta.makeScale(1.2,.9,1);s2.afterGizmo=s2.delta.elements.slice();s2.faceIDs=t.faceIDs;s2.beforeRaw=c.frameAffineRawSnapshot(t);s2.beforeExact=stage.promise;s2.priorStage=stage;s2.affineRevision=1;s2.baseVersion=stage.logicalVersion;s2.closeWorker=()=>{};c.setGizmoFromMatrix(s2.afterGizmo);await c.frameAffineCommit(s2);const second=s2.stage,snapshot=c.frameAffineCanonicalNow(second);c.frameAffineAdopt=realAdopt;assert.equal(await realAdopt(second),true);const newGeometry=t.mesh.geometry,positions=bytes(newGeometry.attributes.position.array);hold.release();assert.equal(await older,false);assert.equal(t.mesh.geometry,newGeometry);assert.deepEqual(bytes(newGeometry.attributes.position.array),positions);assert.equal(second.snapshot,snapshot);assert.equal(vm.runInContext('frameAffineStages.size',c),0);
});
console.log(JSON.stringify(report,null,2));if(report.errors.length)process.exitCode=1;
