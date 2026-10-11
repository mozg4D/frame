import {deferredEnv,session,THREE2,assert,tick} from './support.mjs';
import {device,created,commands,floats,flush,GpuAffineCornerPreview,GpuBufferPool} from './queue-interpreter.mjs';
const rows=[];
for(const mode of ['supersede-before-first-readback','cancel-first-before-second-start']){
 const{c,t}=deferredEnv(),pool=new GpuBufferPool(t.device);Object.assign(t.device,device);t.pool=t.owner.pool=pool;t.mesh.material={};c.frameNative.GpuAffineCornerPreview=GpuAffineCornerPreview;c.frameNative.registerAffineDisplayOverride=()=>({dispose(){}});
 t.status='preparing';t.promise=new Promise(()=>{});t.gpu=t.numeric=t.adapter=null;
 await c.frameAffinePrepareEarly(t);const r=t.affine,gpu=r.gpu,original=r.numeric.positions.slice();
 const s1=session(c,t,{ready:false,released:false});s1.affine=true;s1.kind='affine';c.frameRigidInput=s1;assert(c.frameAffineStartPreview(s1));c.frameRigidApplyDelta(new THREE2.Matrix4().makeTranslation(2,0,0));const first=gpu.last;
 assert.deepEqual(floats(gpu.position),original,'first GPU submission is queued, not executed');
 if(mode.startsWith('cancel'))c.frameAffineCancelSession(s1);
 const s2=session(c,t,{ready:false,released:false});s2.affine=true;s2.kind='affine';c.frameRigidInput=s2;assert(c.frameAffineStartPreview(s2));c.frameRigidApplyDelta(new THREE2.Matrix4().makeTranslation(3,0,0));const second=gpu.last;
 const delta=mode.startsWith('cancel')?3:5,baseDelta=mode.startsWith('cancel')?0:2;
 const published=c.frameAffinePosePublish(s1,{revision:s1.affineRevision});assert.equal(published,false,'old exact result cannot reach GPU writes after S2 owns binding');
 await tick();flush();const firstResult=await first,secondResult=await second;
 assert.equal(firstResult.status,'superseded');assert.equal(secondResult.status,'ready');
 assert.deepEqual(floats(gpu.position),Float32Array.from(original,(v,i)=>v+(i%3===0?delta:0)));
 const cancel=c.frameAffineCancelSession(s2);flush();await tick();assert.deepEqual(floats(gpu.position),Float32Array.from(original,(v,i)=>v+(i%3===0?baseDelta:0)));
 rows.push({mode,firstResult:firstResult.status,secondResult:secondResult.status,combinedTranslation:delta,secondCancelRestoresTranslation:baseDelta,oldExactPublicationRejected:!published});
 c.frameAffinePruneBindings({clear:true});flush();await tick();assert.equal(pool.bytes,0);
}
assert(created.every(b=>b.destroyed));console.log(JSON.stringify({pass:true,scope:'Exact editor early-preview and native command construction, deferred FIFO queue and CPU command interpreter; not WGSL/hardware acceptance',rows,allBuffersDestroyed:true,commandCount:commands.length},null,2));
