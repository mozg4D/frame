import {reviewURL} from '../source-paths.mjs';
import {verifyCandidate} from './verify-candidate.mjs'; verifyCandidate();
import fs from 'node:fs'; import vm from 'node:vm'; import assert from 'node:assert/strict';
const {GpuAffineCornerPreview}=await import(reviewURL('../candidate/native-source/gpu-affine-preview.mjs',import.meta.url));
const source=fs.readFileSync(reviewURL('../candidate/editor-affine-ui-v2c.mjs',import.meta.url),'utf8');
function extract(name){const at=source.indexOf('function '+name+'(');assert(at>=0,name);const lines=source.slice(at).split('\n');for(let i=1;i<1000;i++){const f=lines.slice(0,i).join('\n');try{new vm.Script('('+f+')');return f;}catch{}}throw Error(name);}
const cases=[];
for(const mode of ['stale-source-version','stale-owner','writeBuffer-throws'])for(const sessionCount of [1,2]){
 let terminated=0,disposed=0,secondTerminated=0,settled=false,secondSettled=false,writes=0,current=true;
 const device={queue:{writeBuffer(){writes++; if(mode==='writeBuffer-throws')throw Error('injected queue.writeBuffer failure');}}};
 const t={h:'h',node:{},device,numeric:{positions:new Float32Array(9),extras:new Float32Array(27)},adapter:{revision:0},gpu:{dispose(){disposed++;}}};
 const p={array:new Float32Array(9),version:0},n={array:new Float32Array(9),version:0},index={array:Uint32Array.of(0,1,2),version:0},g={attributes:{position:p,normal:n},index};Object.assign(t,{p,n,index,g,mesh:{geometry:g},pa:p.array,na:n.array,ia:index.array,pv:0,nv:0,iv:0});
 const r=t.affine={live:true,t,revision:0,localIndex:Uint32Array.of(0,1,2),numeric:{positions:new Float32Array(9),extras:new Float32Array(27)},display:{dispose(){disposed++;}}};
 r.gpu={cpuPositions:r.numeric.positions,cpuExtras:r.numeric.extras,device,isCurrent:()=>r.live&&c.frameRigidSource(t),disposed:false,_check:GpuAffineCornerPreview.prototype._check,writeAuthoringRanges:GpuAffineCornerPreview.prototype.writeAuthoringRanges,position:{},normal:{},dispose(){disposed++;this.disposed=true;}};
 const s={t,r,beforeRaw:{attrs:{position:{array:new Float32Array(9)},normal:{array:new Float32Array(9)}}},beforeValues:new Float32Array(9),beforeNormals:new Float32Array(9),affineID:1,ready:true,affine:true,revision:1,gizmo:[],abortResolve(){}};r.active=s;
 const t2={h:'h2',node:{},gpu:{dispose(){disposed++;}}},r2=t2.affine={live:true,t:t2,revision:0,localIndex:Uint32Array.of(0,1,2),display:{dispose(){disposed++;}},gpu:{dispose(){disposed++;}}};
 const s2={t:t2,r:r2,beforeValues:new Float32Array(9),affineID:2,ready:true,affine:true,revision:1,gizmo:[],abortResolve(){}};r2.active=s2;
 let created=0;const c=vm.createContext({frameAffineNotes:{errors:[]},DOMException,DOMException,frameNative:{createAffineCornerWorker(){const n=++created;return{postMessage(){},terminate(){if(n===1)terminated++;else secondTerminated++;}};}},frameRigidInput:s,frameRigidExecuting:s,frameRigidQueue:sessionCount===1?[s]:[s,s2],frameRigidPrepared:t,frameRigidClearInput(){},frameRigidRestoreOverlays(){},OBJ:new Map([['h',t.node],['h2',t2.node]]),setGizmoFromMatrix(){},gizDrag:null,frameRigidNotes:{cancels:0},scheduleRender(){},frameRigidOwnerCurrent:()=>current,pickMeshes:new Map([['h',t.mesh]])});
 for(const n of ['frameRigidSource','frameAffineCreateWorkerPipe','frameAffineCreateWorker','frameAffineRestoreRawDisplay','frameAffineCleanup','frameAffineCancelSession','frameAffineAbortAll','frameAffineDispose','frameRigidDispose','frameRigidAbortAll'])vm.runInContext(extract(n),c);
 c.CREASE_COS=Math.cos(46*Math.PI/180);c.frameAffineSerial=0;s.faceIDs=Uint32Array.of(0);s.beforeRaw={attrs:{position:{array:new Float32Array(9)},normal:{array:new Float32Array(9)}},index:Uint32Array.of(0,1,2)};s.beforeExact=Promise.resolve(s.beforeRaw);c.frameAffineCreateWorker(s);s.workerReady.then(()=>settled=true,()=>settled=true);if(sessionCount===2){s2.faceIDs=Uint32Array.of(0);s2.beforeRaw={attrs:{position:{array:new Float32Array(9)},normal:{array:new Float32Array(9)}},index:Uint32Array.of(0,1,2)};s2.beforeExact=Promise.resolve(s2.beforeRaw);c.frameAffineCreateWorker(s2);s2.workerReady.then(()=>secondSettled=true,()=>secondSettled=true);}
 assert(c.frameRigidSource(t));if(mode==='stale-owner')current=false;if(mode==='stale-source-version')t.p.version++;
 let error,retryError;try{c.frameRigidAbortAll('source-changed-during-preview');}catch(e){error=e;}
 try{c.frameRigidAbortAll('retry-retire-stale-owner');}catch(e){retryError=e;}
 await new Promise(setImmediate);
 assert.equal(error,undefined);assert.equal(retryError,undefined);assert.equal(terminated,1);assert.equal(secondTerminated,sessionCount===2?1:0);assert.equal(settled,true);assert.equal(secondSettled,sessionCount===2);assert.equal(disposed,sessionCount*3);assert.equal(r.live,false);assert.equal(r.active,null);assert.equal(c.frameRigidQueue.length,0);assert.equal(c.frameRigidInput,null);assert.equal(c.frameRigidExecuting,null);assert.equal(c.frameRigidPrepared,null);
 cases.push({mode,sessionCount,sourceCurrent:c.frameRigidSource(t),repeatAbortAlsoThrows:!!retryError,error:error?{name:error.name,message:error.message}:null,firstWorkerTerminated:terminated,secondWorkerTerminated:sessionCount===2?secondTerminated:null,firstPromiseSettled:settled,secondPromiseSettled:sessionCount===2?secondSettled:null,previewDisposals:disposed,affineBindingStillLive:r.live,activeSessionRetained:r.active===s,queueLength:c.frameRigidQueue.length,inputRetained:c.frameRigidInput===s,preparedRetained:c.frameRigidPrepared===t,gpuWrites:writes});
 s2.closeWorker?.();await new Promise(setImmediate);
}
console.log(JSON.stringify({reproduced:false,safeguardPass:true,scope:'Exact editor functions including frameRigidSource and exact native GPU guard/range writer; mocked transport and queue',cases},null,2));
