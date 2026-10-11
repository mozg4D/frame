import fs from 'node:fs';import assert from 'node:assert/strict';import{T,baseline,makeHarness,diff}from'./connected-support.mjs';
const rows=[];for(const degrees of[44,46.0005]){const a=degrees*Math.PI/180,z=4e-8,edge=.001,base=baseline({positions:Float32Array.from([100,0,0,101,0,0,100,1,0,0,0,0,edge,0,0,0,edge,0,edge,0,z,0,0,z,0,-edge*Math.cos(a),edge*Math.sin(a)]),indices:Uint32Array.from({length:9},(_,i)=>i)});
const first=makeHarness(base),previous=await first.pose(new T.Matrix4().makeRotationX(.3));assert.equal(previous.actual.cornerPositionsUnchanged,true);assert.equal(previous.actual.outsideCanonical,false);
// Match immediate next-gesture sparse authoring baseline: selected positions advance,
// exact global normals have not yet replaced the immutable original raw normal array.
const pendingBase={positions:base.positions.slice(),normals:base.normals.slice(),indices:base.indices.slice()};for(let k=0;k<first.s.t.ids.length;k++)pendingBase.positions.set(previous.q.positions.subarray(k*3,k*3+3),first.s.t.ids[k]*3);
for(let at=0;at<pendingBase.indices.length;at++)for(let c=0;c<3;c++)assert.equal(pendingBase.positions[pendingBase.indices[at]*3+c],previous.actual.attrs.position.array[previous.actual.index[at]*3+c]);assert.notEqual(diff(pendingBase.normals,previous.actual.attrs.normal.array),0);
const clean=makeHarness(pendingBase,[0],{initialGuard:first.s.r.stockGuard,priorExact:previous.actual}),cleanResult=await clean.pose(new T.Matrix4().makeRotationX(.25));assert.equal(cleanResult.q.needsWhole,true);assert.deepEqual(cleanResult.differences,{positions:0,normals:0,indices:0});clean.close();
const h=makeHarness(pendingBase,[0],{initialGuard:first.s.r.stockGuard,priorExact:previous.actual});await h.s.workerReady;assert.notEqual(h.s.rebaseNeeded,true);
const D=new T.Matrix4().makeRotationX(.2);h.s.delta=D;const saved=await h.captureSave(previous.actual,D);assert.equal(saved.outsideCanonical,true);
const afterSave=await h.pose(new T.Matrix4().makeRotationX(.25));
assert.equal(afterSave.q.needsWhole,true);assert.deepEqual(afterSave.differences,{positions:0,normals:0,indices:0});
const result={degrees,passed:true,actualEditorHelperVerified:true,actualBundledWorker:true,actualCreateWorkerAndSaveCapture:true,onlyGpuAndLifecycleBoundaryChecksStubbed:true,previousCornerPositionsUnchanged:previous.actual.cornerPositionsUnchanged,previousOutsideCanonical:previous.actual.outsideCanonical,saveOutsideCanonical:saved.outsideCanonical,withoutSaveNeedsWhole:cleanResult.q.needsWhole,withoutSaveDifferences:cleanResult.differences,nextPoseNeedsWhole:afterSave.q.needsWhole,nextPoseDifferences:afterSave.differences,trace:h.trace};rows.push(result);first.close();h.close();}
const report={passed:true,rows};console.log(JSON.stringify(report,null,2));
