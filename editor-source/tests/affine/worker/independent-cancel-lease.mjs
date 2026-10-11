import './independent-source-pins.mjs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {T,I,makeHarness,baseline,diff} from './connected-support-blob.mjs';
import {selectedFaceOracle} from './selected-face-oracle.mjs';
const cos=Math.cos(46*Math.PI/180),base=baseline({positions:Float32Array.from([0,0,0,1,0,0,0,1,0,10,0,0,11,0,0,10,1,0]),indices:Uint32Array.from([0,1,2,3,4,5])}),rows=[];
for(const when of ['before-first-response','after-nonfinal-response']){
 const h=makeHarness(base),s=h.s,p=h.s.r.workerPipe;await s.workerReady;
 try{
  const D=new T.Matrix4().makeTranslation(3,0,0),args={kind:'canonical-pose',gesture:s.affineID,revision:1,baseVersion:s.baseVersion,ownerVersion:s.ownerVersion,world:I.elements,delta:D.elements,inverse:I.elements,final:false};
  const pending=s.call(args);pending.catch(()=>{});
  if(when==='after-nonfinal-response')await pending;
  s.closeWorker();
  if(when==='before-first-response')await assert.rejects(pending,/retired/);
  const next={...s,workerClosed:false,affineID:2,priorStage:null,beforeExact:Promise.resolve(s.beforeRaw)};h.ctx.next=next;vm.runInContext('frameAffineCreateWorker(next)',h.ctx);await next.workerReady;
  const D2=new T.Matrix4().makeScale(1.2,.8,1.1),q=await next.call({kind:'canonical-pose',gesture:2,revision:1,baseVersion:0,ownerVersion:next.ownerVersion,world:I.elements,delta:D2.elements,inverse:I.elements,final:true}),o=selectedFaceOracle(base.positions,base.indices,[0],I,D2,cos);
  assert.equal(q.version,1);assert.equal(next.worker,s.worker);for(const[k,key]of[['rawPositions','positions'],['rawNormals','normals'],['rawIndices','indices']])assert.equal(diff(q[k],o[key]),0);
  rows.push({when,samePipe:true,version:1,cancelledPoseDidNotBecomeCanonical:true,positionNormalIndexBitDifferences:0});
 }finally{h.close();}
}
console.log(JSON.stringify({passed:true,actualGeneratedBlobWorker:true,actualCreateWorkerAndPipeLease:true,rows},null,2));
