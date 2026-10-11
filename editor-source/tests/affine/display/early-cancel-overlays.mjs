import {deferredEnv,installCornerMock,session,THREE2,assert,tick} from './support.mjs';
const rows=[];
for(const control of ['pointercancel-before-raw-ready','pointercancel-after-raw-ready','abortall-before-raw-ready']){
 const{c,t}=deferredEnv(),stats=installCornerMock(c,t);c.gizDrag={mode:'scale'};
 const early=control!=='pointercancel-after-raw-ready';
 if(early){t.status='preparing';t.promise=new Promise(()=>{});t.gpu=t.numeric=t.adapter=null;}
 await c.frameAffinePrepareEarly(t);if(!early)await c.frameAffinePrepare(t);
 const overlays=['face','faceBack','edge','vertex'].map(k=>c.polySelection[k]),before=overlays.map(o=>({matrix:o.matrix.elements.slice(),auto:o.matrixAutoUpdate}));
 const s=session(c,t,{ready:!early,released:false});s.affine=true;s.kind='affine';c.frameRigidInput=c.frameRigidExecuting=s;c.frameRigidQueue=[s];
 c.frameAffineCreateWorker=s=>{s.baseVersion=0;s.closeWorker=()=>{};s.workerReady=new Promise(()=>{});};c.frameAffinePump=()=>{};
 assert(c.frameAffineStartPreview(s));if(!early)c.frameAffineActivate(s);c.frameRigidApplyDelta(new THREE2.Matrix4().makeScale(2,2,2));
 assert.equal(stats.submits,1);assert(overlays.every(o=>o.matrix.elements[0]===2));
 if(control.startsWith('pointercancel')){c.frameRigidFinish({type:'pointercancel',pointerId:1});await tick();await tick();}else c.frameRigidAbortAll('scene-clear');
 const changed=overlays.reduce((sum,o,k)=>sum+o.matrix.elements.filter((v,i)=>v!==before[k].matrix[i]).length+Number(o.matrixAutoUpdate!==before[k].auto),0);
 rows.push({control,early,changedOverlayComponents:changed,restores:stats.restores,cancel:s.cancel,remainingQueue:c.frameRigidQueue.length,authoringChanged:t.pa.some((v,i)=>v!==t.originalPositions[i]),displayEnabled:t.affine?.displayEnabled??false});
 assert.equal(changed,0);assert.equal(c.frameRigidQueue.length,0);assert.equal(t.pa.some((v,i)=>v!==t.originalPositions[i]),false);assert(stats.restores>0);
}
console.log(JSON.stringify({passed:true,scope:'Exact editor transaction/cancel functions with real Three matrices; mock corner GPU; not browser or hardware acceptance',rows},null,2));
