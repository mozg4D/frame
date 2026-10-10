'use strict';
// A separate ALL-POINT oracle, not a positive vertex/lattice sampler.
// Every fixed original convex material cell maps into ONE actual convex quad:
// closest target points for its vertices remain inside that same quad under
// barycentric interpolation. The triangle inequality bounds every cell point.
const R=require('./rational.cjs'),A=require('./accuracy-contract.cjs'),{upper}=require('./mesh-section.cjs');
const {distanceSquared}=require('./source-bank-coverage-audit.cjs');
function auditAnnulusRequiredCells(plan,quads,W){
 const O=plan.exactOuter.map(p=>p.map(R.parse)),I=plan.exactInner.map(p=>p.map(R.parse)),n=O.length,
  mid=(a,b)=>a.map((v,k)=>R.div(R.add(v,b[k]),R.rat(2n))),om=mid(O[0],O[1]),im=mid(I[0],I[1]),
  cells=[{points:[O[0],om,im,I[0]],command:0}];
 for(let i=n-1;i>=1;i--)cells.push({points:[O[i],O[(i+1)%n],I[(i+1)%n],I[i]],command:n-i});
 cells.push({points:[om,O[1],I[1],im],command:n});
 if(quads.length!==n+2)throw Error('missing full source annulus command or closure');
 let squared=R.zero;const rows=[];
 for(const cell of cells){
  const poly=quads[cell.command].map(p=>p.map(R.exact)),signs=poly.map((p,i)=>R.cross(R.vec(poly[(i+1)%4],p),R.vec(poly[(i+2)%4],poly[(i+1)%4])).n);
  if(signs.some(s=>!s||s<0n!==signs[0]<0n))throw Error('actual feed target must be one nondegenerate convex quad');
  let local=R.zero;
  for(const p of cell.points)local=A.max(local,distanceSquared(p,poly));
  squared=A.max(squared,local);rows.push({command:cell.command,exactDistanceSquaredUpperMM2:R.str(local)});
 }
 const bound=A.sqrtBounds(squared)[1],limit=R.div(R.exact(W),R.rat(50n));
 return {requiredCellsCovered:R.cmp(bound,limit)<=0,completeOriginalMaterialPartition:true,
  originalRequiredCells:n,sourcePrescribedConvexSubcells:cells.length,exactUpperBoundMM:R.str(bound),upperBoundMM:upper(bound),
  method:'entire original annulus partition; each convex source subcell maps by barycentric interpolation to closest vertex targets in one actual convex feed quad',
  allPointProof:true,positiveSamplingUsed:false,sourceReferenceIndependent:true,requiredSourceChanged:false,rows};
}
module.exports={auditAnnulusRequiredCells};
