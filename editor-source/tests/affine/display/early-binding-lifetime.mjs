import {deferredEnv,session,THREE2,assert,tick,vm} from './support.mjs';
import {device,created,flush,GpuAffineCornerPreview,GpuBufferPool} from './queue-interpreter.mjs';
const rows=[];
function setup(){const{c,t}=deferredEnv();Object.assign(t.device,device);const pool=new GpuBufferPool(t.device);t.pool=t.owner.pool=pool;t.mesh.material={};c.frameNative.GpuAffineCornerPreview=GpuAffineCornerPreview;c.frameNative.registerAffineDisplayOverride=()=>({dispose(){}});c.frameAffineYield=()=>Promise.resolve();t.status='preparing';t.promise=new Promise(()=>{});t.gpu=t.numeric=t.adapter=null;return{c,t,pool};}
{
 const{c,t,pool}=setup();let resume;const gate=new Promise(r=>resume=r);c.frameAffineYield=()=>gate;
 const promise=c.frameAffinePrepareEarly(t),r=t.affine;assert.equal(vm.runInContext('frameAffineBindingRecords.size',c),1);t.faces.add(1);resume();await assert.rejects(promise,e=>e.name==='AbortError');assert.equal(r.live,false);assert.equal(r.numeric,null);assert.equal(r.gpu,null);assert.equal(vm.runInContext('frameAffineBindingRecords.size',c),0);assert.equal(pool.bytes,0);rows.push({case:'Selection changes at first cooperative early-preparation yield',bindingRetired:true,noGpuAllocation:true});
}
{
 const{c,t,pool}=setup();let resume;const compile=new Promise(r=>resume=r);t.device.createShaderModule=d=>({...d,getCompilationInfo:()=>compile});
 const promise=c.frameAffinePrepareEarly(t),r=t.affine;await tick();assert(pool.bytes>0);t.faces.add(1);resume({messages:[]});await assert.rejects(promise,e=>e.name==='AbortError');flush();await tick();assert.equal(r.live,false);assert.equal(r.numeric,null);assert.equal(r.gpu,null);assert.equal(vm.runInContext('frameAffineBindingRecords.size',c),0);assert.equal(pool.bytes,0);rows.push({case:'Selection changes while native GPU initialization is awaiting shader validation',bindingRetired:true,allPoolBytesRetired:true});
}
{
 const{c,t,pool}=setup();let hud=0;c.updateHUD=()=>hud++;await c.frameAffinePrepareEarly(t);const r=t.affine,gpu=r.gpu;
 const s=session(c,t,{ready:false,released:false});s.affine=true;c.frameRigidInput=s;assert(c.frameAffineStartPreview(s));c.frameRigidApplyDelta(new THREE2.Matrix4().makeTranslation(2,0,0));await tick();assert(pool.bytes>0);const bytes=pool.bytes;c.frameAffinePruneBindings({clear:true});assert.equal(gpu.disposed,true);assert.equal(pool.bytes,bytes,'retained through queued work fence');flush();await tick();assert.equal(pool.bytes,0);assert.equal(hud,0);assert.equal(gpu.pending.size,0);assert.equal(r.numeric,null);rows.push({case:'Binding retires with early preview command and readback still pending',noLateBoundsPublication:true,heldUntilFence:true,allPoolBytesRetired:true});
}
{
 const{c,t,pool}=setup();c.frameNative.registerAffineDisplayOverride=()=>{throw Error('controlled display adapter registration');};await assert.rejects(c.frameAffinePrepareEarly(t),/controlled display/);flush();await tick();assert.equal(t.affine.live,false);assert.equal(pool.bytes,0);assert.equal(vm.runInContext('frameAffineBindingRecords.size',c),0);rows.push({case:'Display registration fails after corner GPU allocation',bindingRetired:true,allPoolBytesRetired:true});
}
assert(created.every(b=>b.destroyed));console.log(JSON.stringify({pass:true,scope:'Exact early-binding code and native GPU lifetime through mock WebGPU/deferred queue; no browser/hardware/GC acceptance',rows,allBuffersDestroyed:true},null,2));
