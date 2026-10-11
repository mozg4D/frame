import{installAffineWorker,stockCreaseReference}from'./affine-corner-worker.mjs';
import{stockWeldIntersects,proveAffineOutside}from'./affine-stock-proof.mjs';
import{VersionedAffineCanonicalBase}from'./affine-versioned-base.mjs';
/** Add whole-object exact Stock work without changing the verified corner arithmetic. */
export function installAffineStockWorker(scope){
 let proof=null,canonical=null,canonicalGesture=null;const facade={postMessage:(q,transfers)=>{if(q.kind==='posed')q.needsWhole=!proof?.outsideCanonical||stockWeldIntersects(q.positions,proof.outsideHashes);scope.postMessage(q,transfers);}};installAffineWorker(facade);
 scope.onmessage=event=>{const m=event.data;
  if(m.kind.startsWith('canonical-')){try{
   if(m.kind==='canonical-prepare'){canonical?.retire();canonical=new VersionedAffineCanonicalBase(m);canonicalGesture=null;scope.postMessage({id:m.id,kind:'canonical-prepared',version:canonical.version,ownerVersion:canonical.ownerVersion});return;}
   if(!canonical)throw Error('Owned canonical affine basis required');canonical._check(m.baseVersion,m.ownerVersion);
   if(m.kind==='canonical-begin'){canonicalGesture=m.gesture;scope.postMessage({id:m.id,kind:'canonical-began',gesture:m.gesture,baseVersion:canonical.version,ownerVersion:canonical.ownerVersion});return;}
   if(m.kind!=='canonical-pose'||canonicalGesture!==m.gesture)throw Error('Canonical affine gesture changed');
   const start=performance.now(),q=canonical.compute({...m,updateProof:!m.readOnly}),committed=m.final===true&&!m.readOnly;
   if(committed){canonical.commit(q);canonicalGesture=null;}
   const hashes=q.proof.outsideHashes?.slice(),reply={id:m.id,kind:'canonical-posed',gesture:m.gesture,revision:m.revision,baseVersion:q.baseVersion,version:committed?q.version:q.baseVersion,ownerVersion:q.ownerVersion,committed,positions:q.selectedRawPositions,selectedIDs:q.selectedIDs,cornerPositions:q.cornerPositions,cornerNormals:q.cornerNormals,rawPositions:q.positions,rawNormals:q.normals,rawIndices:q.indices,outsideCanonical:q.proof.outsideCanonical,selectedExclusive:q.proof.selectedExclusive,cornerPositionsUnchanged:q.proof.cornerPositionsUnchanged!==false,outsideHashes:hashes,needsWhole:q.wholeStock,timings:{totalMs:performance.now()-start}};
   scope.postMessage(reply,[reply.positions.buffer,reply.selectedIDs.buffer,reply.cornerPositions.buffer,reply.cornerNormals.buffer,reply.rawPositions.buffer,reply.rawNormals.buffer,reply.rawIndices.buffer,...(hashes?[hashes.buffer]:[])]);return;
  }catch(error){scope.postMessage({id:m.id,kind:'error',error:String(error)});return;}}
  if(m.kind!=='whole'){if(m.kind==='prepare')proof=m.outsideCanonical?{outsideCanonical:true,outsideHashes:m.outsideHashes}:null;facade.onmessage(event);return;}
  try{const started=performance.now(),q=stockCreaseReference(m.positions,m.indices,m.creaseCos),ms=performance.now()-started,checked=proveAffineOutside(m.positions,m.normals,m.indices,m.faceSlots,q);if(!m.preserveProof)proof={outsideCanonical:checked.outsideCanonical,outsideHashes:checked.outsideHashes.slice()};scope.postMessage({id:m.id,kind:'whole-stock',revision:m.revision,gesture:m.gesture,positions:q.positions,normals:q.normals,indices:q.indices,stockMs:ms,...checked},[q.positions.buffer,q.normals.buffer,q.indices.buffer,checked.outsideHashes.buffer]);}
  catch(error){scope.postMessage({id:m.id,kind:'error',error:String(error)});}
 };
}
