import fs from 'node:fs';import assert from 'node:assert/strict';
import {T,I,cos,baseline,makeHarness,diff,stockCompactOracle} from './connected-support-blob.mjs';
import {orderedPositionOracle} from './stock-oracle.mjs';
const worlds=[['identity',I],['nonuniform',new T.Matrix4().compose(new T.Vector3(31,-27,14),new T.Quaternion().setFromEuler(new T.Euler(.7,.4,-.8)),new T.Vector3(2,.5,3))],['reflection',new T.Matrix4().compose(new T.Vector3(31,-27,14),new T.Quaternion().setFromEuler(new T.Euler(.7,.4,-.8)),new T.Vector3(-2,.5,3))],['large-translated',new T.Matrix4().compose(new T.Vector3(1e10,-1e10,3e10),new T.Quaternion().setFromEuler(new T.Euler(.7,.4,-.8)),new T.Vector3(2,.5,3))]];
const transforms=[new T.Matrix4().makeRotationX(.2),new T.Matrix4().makeScale(-1.2,.7,1.1),new T.Matrix4().makeScale(1,0,1),new T.Matrix4().makeScale(0,0,0),new T.Matrix4().makeTranslation(.1,-.2,.3)];
const rows=[];
for(const degrees of [44,46.0005])for(const [worldName,W]of worlds){
 const a=degrees*Math.PI/180,z=4e-8,edge=.001,base=baseline({positions:Float32Array.from([100,0,0,101,0,0,100,1,0,0,0,0,edge,0,0,0,edge,0,edge,0,z,0,0,z,0,-edge*Math.cos(a),edge*Math.sin(a)]),indices:Uint32Array.from({length:9},(_,i)=>i)}),first=makeHarness(base),previous=await first.pose(new T.Matrix4().makeRotationX(.3));
 const pendingBase={positions:base.positions.slice(),normals:base.normals.slice(),indices:base.indices.slice()};for(let k=0;k<first.s.t.ids.length;k++)pendingBase.positions.set(previous.q.positions.subarray(k*3,k*3+3),first.s.t.ids[k]*3);
 const h=makeHarness(pendingBase,[0],{initialGuard:first.s.r.stockGuard,priorExact:previous.actual});await h.s.workerReady;h.s.world=W;h.s.inverse=W.clone().invert();const initialGuard=h.s.r.stockGuard;
 const exact=previous.actual,exactCopy={positions:exact.attrs.position.array.slice(),normals:exact.attrs.normal.array.slice(),indices:exact.index.slice()},rawCopy={positions:h.s.beforeRaw.attrs.position.array.slice(),normals:h.s.beforeRaw.attrs.normal.array.slice(),indices:h.s.beforeRaw.index.slice()};
 const selected=Array.from(new Set(Array.from(h.s.faceIDs).flatMap(f=>Array.from(exact.index.subarray(f*3,f*3+3)))));
 for(const D of transforms){const saved=await h.captureSave(exact,D),expected=stockCompactOracle(orderedPositionOracle(exact.attrs.position.array,selected,W,D),exact.index,cos);assert.equal(diff(saved.attrs.position.array,expected.positions),0);assert.equal(diff(saved.attrs.normal.array,expected.normals),0);assert.equal(diff(saved.index,expected.indices),0);assert.equal(h.s.r.stockGuard,initialGuard);}
 for(const [src,copy]of [[exact,exactCopy],[h.s.beforeRaw,rawCopy]]){assert.equal(diff(src.attrs.position.array,copy.positions),0);assert.equal(diff(src.attrs.normal.array,copy.normals),0);assert.equal(diff(src.index,copy.indices),0);}
 const next=await h.pose(new T.Matrix4().makeRotationX(.25),W);assert.equal(next.q.needsWhole,true);assert.deepEqual(next.differences,{positions:0,normals:0,indices:0});
 rows.push({degrees,world:worldName,saves:transforms.length,activeSavePositionNormalIndexBitDifferences:0,rawAndExactSourcesUnchanged:true,hostGuardUnchanged:true,nextPoseNeedsWhole:true,nextPoseDifferences:next.differences});first.close();h.close();
}
const report={passed:true,activeSaveCases:rows.reduce((n,r)=>n+r.saves,0),actualEditorHelper:true,actualCreateAffineCornerWorkerBlob:true,actualSeparateNodeWorkerThread:true,stubbed:'GPU publication and lifecycle boundary/source checks only',rows};console.log(JSON.stringify(report,null,2));
