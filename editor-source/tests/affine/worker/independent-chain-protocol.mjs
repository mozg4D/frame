import {reviewURL} from '../source-paths.mjs';
import './independent-source-pins.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { Worker as NodeWorker } from 'node:worker_threads';
import { resolveObjectURL } from 'node:buffer';
import { createHash } from 'node:crypto';
import * as T from '../fixtures/three-core.mjs';
const native=await import(reviewURL('../candidate/native-affine-ui-v2b.mjs',import.meta.url));
import { stockCompactOracle } from './stock-oracle.mjs';
import { selectedFaceOracle } from './selected-face-oracle.mjs';
const cos=Math.cos(46*Math.PI/180),I=new T.Matrix4(),rows=[],sources=new Set();
const sha=b=>createHash('sha256').update(b).digest('hex');
assert.equal(sha(fs.readFileSync(reviewURL('../candidate/native-affine-ui-v2b.mjs',import.meta.url))),'2e5af192ec3642b662cb54e98483b224dc6f124a68709ad0d0cfdc76b0fb0c85');
class ActualBlobWorker {
 constructor(url){this.closed=false;this.ready=resolveObjectURL(url).text().then(source=>{sources.add(sha(source));this.node=new NodeWorker("const{parentPort}=require('node:worker_threads');globalThis.self=globalThis;self.postMessage=(m,t)=>parentPort.postMessage(m,t);parentPort.on('message',data=>self.onmessage({data}));\n"+source,{eval:true});this.node.on('message',data=>this.onmessage?.({data}));this.node.on('error',error=>this.onerror?.(error));});}
 postMessage(m,t=[]){this.ready.then(()=>this.node.postMessage(m,t));}
 terminate(){this.closed=true;this.node?.terminate();}
}
globalThis.Worker=ActualBlobWorker;
function pipe(){const worker=native.createAffineCornerWorker(),pending=new Map();let serial=0;worker.onmessage=({data:q})=>{const p=pending.get(q.id);if(!p)return;pending.delete(q.id);q.kind==='error'?p.reject(Error(q.error)):p.resolve(q);};worker.onerror=e=>{for(const p of pending.values())p.reject(e);pending.clear();};return{worker,call:m=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});worker.postMessage({...m,id});})};}
function same(a,b,label){assert.equal(a.constructor,b.constructor,label+'/type');assert.equal(a.length,b.length,label+'/length');const x=new Uint32Array(a.buffer,a.byteOffset,a.byteLength/4),y=new Uint32Array(b.buffer,b.byteOffset,b.byteLength/4);for(let i=0;i<x.length;i++)assert.equal(x[i],y[i],label+'/word '+i);}
function exact(q,o,label){same(q.rawPositions,o.positions,label+'/positions');same(q.rawNormals,o.normals,label+'/normals');same(q.rawIndices,o.indices,label+'/indices');}
function mutate(q){for(const x of Object.values(q))if(ArrayBuffer.isView(x))x.fill(x instanceof BigUint64Array?0n:987);}
const worldChoices=[I,new T.Matrix4().compose(new T.Vector3(31,-27,14),new T.Quaternion().setFromEuler(new T.Euler(.7,.4,-.8)),new T.Vector3(2,.5,3)),new T.Matrix4().compose(new T.Vector3(-10,5,-9),new T.Quaternion().setFromEuler(new T.Euler(-.4,1.1,.3)),new T.Vector3(-2,.5,3)),new T.Matrix4().compose(new T.Vector3(1e10,-1e10,3e10),new T.Quaternion().setFromEuler(new T.Euler(.7,.4,-.8)),new T.Vector3(2,.5,3))];
let seed=137531;function rand(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/2**32;}
function geometry(k){const p=new Float32Array(36);for(let i=0;i<p.length;i++)p[i]=(rand()-.5)*(k%3===0?.001:4);p.set(p.subarray(0,3),27);p.set(p.subarray(3,6),30);p.set(p.subarray(0,3),33);p[35]+=4e-8;return stockCompactOracle(p,Uint32Array.from([0,1,2,1,0,3,0,1,4,9,10,5,0,0,6,7,8,11,4,3,2,2,3,4]),cos);}
function delta(i){switch(i%8){case 0:return new T.Matrix4().makeRotationX(.17);case 1:return new T.Matrix4().makeScale(1.3,.8,1.1);case 2:return new T.Matrix4().makeTranslation(-.003,.01,.02);case 3:return new T.Matrix4().makeScale(-1,1,1);case 4:return new T.Matrix4().makeScale(.00000499,1,1);case 5:return new T.Matrix4().makeRotationY(-.22);case 6:return new T.Matrix4().makeScale(0,1,1);case 7:return new T.Matrix4().makeScale(0,0,0);}}
let checks=0,readOnly=0,stale=0,errors=0,whole=0,fast=0;
for(let fixture=0;fixture<12;fixture++)for(const faces of [[0],[1,3],[0,1,2,3],[0,1,2,3,4,5,6,7]]){
 const p=pipe(),owner=fixture*10+faces.length+1;let canonical=geometry(fixture),version=0;
 try {
  await p.call({kind:'canonical-prepare',...canonical,faceIDs:Uint32Array.from(faces),version,ownerVersion:owner,creaseCos:cos});
  for(let op=0;op<12;op++){
   const gesture=op+1,W=worldChoices[(fixture+op)%4],D=delta(op),args={gesture,baseVersion:version,ownerVersion:owner,world:W.elements,delta:D.elements,inverse:W.clone().invert().elements};
   await p.call({kind:'canonical-begin',...args});
   const expected=selectedFaceOracle(canonical.positions,canonical.indices,faces,W,D,cos);
   const q=await p.call({kind:'canonical-pose',...args,revision:1});exact(q,expected,`${fixture}/${faces}/${op}/preview`);assert.equal(q.committed,false);assert.equal(q.version,version);checks++;q.needsWhole?whole++:fast++;
   for(const change of [{ownerVersion:owner+999},{baseVersion:version+999},{gesture:gesture+999}]){await assert.rejects(p.call({kind:'canonical-pose',...args,...change,final:true}),/changed/);stale++;}
   const invalid=Array.from(D.elements);invalid[0]=NaN;await assert.rejects(p.call({kind:'canonical-pose',...args,delta:invalid,final:true}),/matrix required/);errors++;
   const saveD=new T.Matrix4().makeTranslation(.031,-.003,.017),save=await p.call({kind:'canonical-pose',...args,delta:saveD.elements,revision:2,readOnly:true,final:true});
   exact(save,selectedFaceOracle(canonical.positions,canonical.indices,faces,W,saveD,cos),`${fixture}/${faces}/${op}/readOnly`);assert.equal(save.version,version);assert.equal(save.committed,false);readOnly++;mutate(save);mutate(q);
   const final=await p.call({kind:'canonical-pose',...args,revision:3,final:true});exact(final,expected,`${fixture}/${faces}/${op}/final`);assert.equal(final.committed,true);assert.equal(final.version,version+1);checks++;final.needsWhole?whole++:fast++;
   const expectedIDs=Uint32Array.from(new Set(faces.flatMap(f=>Array.from(canonical.indices.subarray(f*3,f*3+3))))).sort();same(final.selectedIDs,expectedIDs,'selected source IDs');
   const cp=new Float32Array(faces.length*9),cn=new Float32Array(cp.length);for(let k=0;k<faces.length;k++)for(let c=0;c<3;c++){const id=expected.indices[faces[k]*3+c]*3;cp.set(expected.positions.subarray(id,id+3),(k*3+c)*3);cn.set(expected.normals.subarray(id,id+3),(k*3+c)*3);}same(final.cornerPositions,cp,'selected corners');same(final.cornerNormals,cn,'selected corner normals');
   await assert.rejects(p.call({kind:'canonical-pose',...args,final:true}),/changed/);stale++;
   canonical=expected;version++;mutate(final);
  }
  rows.push({fixture,selectedFaces:faces,commits:version,positionNormalIndexBitDifference:0});
 }finally{p.worker.terminate();}
}
console.log(JSON.stringify({passed:true,scope:'Independent actual generated Blob worker canonical chain; production UI and GPU publication not simulated here',sourceBlobSHA256:[...sources],chains:rows.length,exactPreviewAndFinalChecks:checks,readOnlyFinalTrueChecks:readOnly,staleOwnerBaseGestureAndDuplicateFinalRejections:stale,nonfiniteMatrixErrorRecoveryChecks:errors,wholeReplies:whole,fastReplies:fast,returnedBufferOwnershipMutations:true,rows},null,2));
