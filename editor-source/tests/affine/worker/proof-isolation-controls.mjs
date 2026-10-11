import assert from'node:assert/strict';import{T,I,makeHarness,baseline}from'./connected-support-blob.mjs';
const b=Math.fround(5.01e-6),base=baseline({positions:Float32Array.from([1,0,0,1,1,0,1,0,1,b,1,0,b,0,0,b-.2,0,-1]),indices:Uint32Array.from([0,1,2,3,4,5])}),h=makeHarness(base),rows=[];
try{
 const first=await h.pose(I),second=await h.pose(new T.Matrix4().makeScale(.8,1,1));assert.deepEqual([first.q.needsWhole,second.q.needsWhole],[true,false]);const source=h.s.beforeRaw.attrs.position.array.slice();
 for(const D of [new T.Matrix4().makeScale(.9,1,1),new T.Matrix4().makeRotationX(.2),new T.Matrix4().makeScale(4.99e-6,1,1)]){
  h.s.delta=D;const q=await h.s.run(()=>h.s.call({kind:'canonical-pose',gesture:h.s.affineID,revision:h.s.affineRevision,baseVersion:h.s.baseVersion,ownerVersion:h.s.ownerVersion,world:I.elements,delta:D.elements,inverse:I.elements,readOnly:true}));assert.equal(q.version,0);assert.equal(q.committed,false);
  q.outsideHashes.fill(0n);for(const a of[q.positions,q.cornerPositions,q.cornerNormals,q.rawPositions,q.rawNormals,q.rawIndices])a.fill(0);
  const clear=await h.pose(new T.Matrix4().makeScale(.9,1,1)),contact=await h.pose(new T.Matrix4().makeScale(4.99e-6,1,1));assert.deepEqual([clear.q.needsWhole,contact.q.needsWhole],[false,true]);for(const r of[clear,contact])assert.deepEqual(r.differences,{positions:0,normals:0,indices:0});rows.push({readOnlyDelta:Array.from(D.elements),returnedBuffersMutated:true,nextNeedsWhole:[false,true],positionNormalIndexBitDifference:0});
 }
 assert.deepEqual(h.s.beforeRaw.attrs.position.array,source);console.log(JSON.stringify({passed:true,actualGeneratedBlobWorkerThread:true,canonicalBaseVersionUnchanged:0,privateProofOwnership:true,rows}));
}finally{h.close();}
