'use strict';
// Independent MATERIAL boundary prescribed by the confirmed nominal-W nozzle
// rounding at exterior 90-degree corners. This is not a print trajectory.
const R=require('./rational.cjs'),A=require('./accuracy-contract.cjs'),{canonicalRing}=require('./contour-core.cjs');
const {planTBody}=require('./T-fill-candidate.cjs'),{mapInterval}=require('./provenance.cjs');
const {originalMaterialDifference,commandedMultiplicity}=require('./deposition-multiplicity.cjs');
const {intersectConvexCells,hull}=require('./trajectory-union-accuracy.cjs');
const {hash}=require('./mesh-section.cjs');
const eq=(a,b)=>R.cmp(a,b)===0,point=p=>p.map(R.parse),scale=(p,s)=>p.map(v=>R.mul(v,s)),add=(a,b)=>a.map((v,k)=>R.add(v,b[k]));
function piBounds(){
 // Machin identity pi=16 atan(1/5)-4 atan(1/239). Alternating decreasing
 // rational series enclose each atan between two consecutive partial sums.
 const atan=(q,N)=>{let s=R.zero,p=q;const q2=R.mul(q,q);for(let k=0;k<N;k++){
  s=R.add(s,R.mul(R.div(p,R.rat(BigInt(2*k+1))),R.rat(k%2?-1n:1n)));p=R.mul(p,q2);
 }const next=R.add(s,R.mul(R.div(p,R.rat(BigInt(2*N+1))),R.rat(N%2?-1n:1n)));return[A.min(s,next),A.max(s,next)];};
 const a=atan(R.rat(1n,5n),30),b=atan(R.rat(1n,239n),10);
 return[R.sub(R.mul(R.rat(16n),a[0]),R.mul(R.rat(4n),b[1])),R.sub(R.mul(R.rat(16n),a[1]),R.mul(R.rat(4n),b[0]))];
}
function planTRoundedMaterial(source,W=1,count=7){
 const body=planTBody(source,W,count),normalized=canonicalRing(source),P=normalized.ring.map(p=>p.map(R.exact)),w=R.exact(W),r=R.div(w,R.rat(2n)),
  area=P.reduce((s,p,i)=>R.add(s,R.cross(p,P[(i+1)%P.length])),R.zero),sign=area.n>0n?1n:-1n,corners=[];
 const unit=d=>d.map(v=>R.rat(v.n===0n?0n:v.n>0n?1n:-1n)),normal=d=>[R.mul(R.rat(-sign),d[1]),R.mul(R.rat(sign),d[0])];
 for(let i=0;i<P.length;i++){
  const prev=(i+P.length-1)%P.length,next=(i+1)%P.length,v=P[i],din=unit(R.vec(v,P[prev])),dout=unit(R.vec(P[next],v));
  if(R.cross(din,dout).n*sign<=0n)continue;
  const centre=add(v,scale(add(normal(din),normal(dout)),r)),start=add(v,scale(din,R.sub(R.zero,r))),end=add(v,scale(dout,r)),
   u=scale(normal(din),R.rat(-1n)),z=scale(normal(dout),R.rat(-1n)),square=hull([v,start,centre,end]);
  const owner=[];for(const[edge,incoming]of[[prev,true],[i,false]]){
   const d=R.vec(P[(edge+1)%P.length],P[edge]),length=A.abs(d[d[0].n?0:1]),dt=R.div(r,length);
   owner.push(...mapInterval([normalized],[source],{ring:0,edge,exactU0:R.str(incoming?R.sub(R.one,dt):R.zero),exactU1:R.str(incoming?R.one:dt)})
    .map(q=>({...q,role:'unchanged-original-exterior-90-degree-corner',bankGroup:'rounded-corner-'+i})));
  }
  corners.push({canonicalVertex:i,originalVertex:normalized.sourceVertices[i],exactVertex:v.map(R.str),exactCentre:centre.map(R.str),
   exactRadius:R.str(r),exactStart:start.map(R.str),exactEnd:end.map(R.str),exactBasis:[u,z].map(p=>p.map(R.str)),
   exactSquare:square.map(p=>p.map(R.str)),sourceIntervals:owner,
   exclusion:'points in this original inward r-by-r square with squared distance from centre greater than r^2; zero exception elsewhere',
   prescribedMaterial:'retain the quarter disk; do not remove the entire corner square'});
 }
 if(corners.length!==6)throw Error('six independent convex T exterior corners required');
 const squares=corners.map(c=>c.exactSquare),m=commandedMultiplicity(squares);
 if(m.commandedDuplicateAreaExactMM2!=='0/1'||!originalMaterialDifference(squares,body.originalMaterialCells).completeOriginalMaterialCovered)
  throw Error('rounded corner exception squares must be disjoint original material subsets');
 const original=R.parse(originalMaterialDifference(body.originalMaterialCells,[]).originalAreaExactMM2),totalSquare=R.mul(R.rat(BigInt(corners.length)),R.mul(r,r)),
  coefficient=R.div(totalSquare,R.rat(4n)),pi=piBounds(),excluded=[R.sub(totalSquare,R.mul(coefficient,pi[1])),R.sub(totalSquare,R.mul(coefficient,pi[0]))],
  prescribed=[R.sub(original,excluded[1]),R.sub(original,excluded[0])];
 return{kind:'independent-source-derived-rounded-T-material-plan',source:structuredClone(source),W,count,originalMaterialCells:body.originalMaterialCells,corners,
  rulePrescribedExterior90TargetResolved:true,rule:'confirmed usual fixed nominal nozzle W outer-90 rounding; radius W/2, inward centre fixed by both original source banks',
  materialDefinition:'unchanged original CAD C minus only the six independently source-derived square-minus-quarter-disk corner regions',
  originalAreaExactMM2:R.str(original),excludedAreaSymbolic:{constant:R.str(totalSquare),minusPiCoefficient:R.str(coefficient)},
  excludedAreaExactBoundsMM2:excluded.map(R.str),prescribedAreaExactBoundsMM2:prescribed.map(R.str),piExactBounds:pi.map(R.str),
  cornerSquaresPairwiseDisjoint:true,ordinaryWidth:W,cornerWideningRequired:false,internalRestartOverlapAuthorized:false,
  wholeRoutePrescribedProtocolsResolved:false,physicalPrintValidated:false};
}
function buildRoundedBoundaryReference(plan){
 if(hash(plan)!==hash(planTRoundedMaterial(plan.source,plan.W,plan.count)))throw Error('changed independently source-derived rounded material plan');
 let worstSag=R.zero,worstRepresentation=R.zero;const arcs=plan.corners.map(c=>{
  const centre=point(c.exactCentre),[u,v]=c.exactBasis.map(point),r=R.parse(c.exactRadius),exactPoints=[];
  for(let j=0;j<=8;j++){const t=R.rat(BigInt(j),8n),t2=R.mul(t,t),den=R.add(R.one,t2),
   cos=R.div(R.sub(R.one,t2),den),sin=R.div(R.mul(R.rat(2n),t),den);
   exactPoints.push(add(centre,scale(add(scale(u,cos),scale(v,sin)),r)));
  }
  const output=exactPoints.map(p=>p.map(R.number));let sag=R.zero,representation=R.zero;
  for(let j=0;j<8;j++){
   const chord2=R.dot(R.vec(exactPoints[j+1],exactPoints[j]),R.vec(exactPoints[j+1],exactPoints[j])),
    midpointRadius2=R.sub(R.mul(r,r),R.div(chord2,R.rat(4n))),lowerRadius=A.sqrtBounds(midpointRadius2)[0];
   sag=A.max(sag,R.sub(r,lowerRadius));
  }
  exactPoints.forEach((p,i)=>{representation=A.max(representation,p.reduce((s,q,k)=>R.add(s,A.abs(R.sub(q,R.exact(output[i][k])))),R.zero));});
  worstSag=A.max(worstSag,sag);worstRepresentation=A.max(worstRepresentation,representation);
  return{canonicalVertex:c.canonicalVertex,exactPoints:exactPoints.map(p=>p.map(R.str)),points:output,
   exactSagUpperBoundMM:R.str(sag),exactRepresentationUpperBoundMM:R.str(representation),
   reference:'analytic source-owned quarter circle fixed before discretization; every arc point is bounded by the chord sag, not samples'};
 });
 const accuracy={...A.certifyBudget(plan.W,[{name:'analytic prescribed quarter arcs to full rational chord cells',verified:true,exactUpperBound:R.str(worstSag)},
  {name:'rational chord endpoints to emitted finite boundary points, affine full-cell bound',verified:true,exactUpperBound:R.str(worstRepresentation)}]),
  kind:'prescribed-rounded-material-boundary-construction-certificate',scope:'all six outer 90-degree material boundary arcs only; not feed, centreline or complete route',
  computationalTrajectoryDeviationCertified:false,wholeTrajectoryDeviationCertified:false,roundedMaterialBoundaryDeviationCertified:true,
  wholeSourceAllocationCertified:false,ownerAccepted:false};
 accuracy.roundedMaterialBoundaryDeviationCertified=accuracy.accepted;
 return{arcs,accuracy,actualPrintCommands:[],scope:'reference material boundary approximation; no additional extrusion, start, restart or overlap exception'};
}
function accountRoundedMaterial(plan,ribbons){
 if(hash(plan)!==hash(planTRoundedMaterial(plan.source,plan.W,plan.count)))throw Error('changed independently source-derived rounded material plan');
 const validated=commandedMultiplicity(ribbons),output=ribbons.map(p=>p.map(v=>v.map(x=>typeof x==='number'?R.exact(x):typeof x==='string'?R.parse(x):R.rat(x.n,x.d)))),
  outside=originalMaterialDifference(ribbons,plan.originalMaterialCells),violations=[];
 for(let i=0;i<output.length;i++)for(const c of plan.corners){const section=intersectConvexCells(hull(output[i]),c.exactSquare.map(point),{work:0,maxWork:1000000}),centre=point(c.exactCentre),r=R.parse(c.exactRadius);
  if(section.some(p=>R.cmp(R.dot(R.vec(p,centre),R.vec(p,centre)),R.mul(r,r))>0))violations.push({command:i,canonicalVertex:c.canonicalVertex});
 }
 const contained=outside.completeOriginalMaterialCovered&&!violations.length,CminusU=originalMaterialDifference(plan.originalMaterialCells,ribbons),missing=R.parse(CminusU.missingOriginalAreaExactMM2),E=plan.excludedAreaExactBoundsMM2.map(R.parse),
  bounds=contained?[R.sub(missing,E[1]),R.sub(missing,E[0])]:null;
 return{commandedMultiplicity:validated,actualCommandedPolygonsContainedInPrescribedMaterial:contained,outsideOriginalCAD:outside,cornerExclusionViolations:violations,
  originalCADMinusU:CminusU,prescribedMaterialMinusUExactAreaBoundsMM2:bounds?.map(R.str),
  wholePrescribedMaterialCovered:!!bounds&&bounds.every(q=>q.n===0n),positivePrescribedMaterialMissingProved:!!bounds&&bounds[0].n>0n,
  computationalError:false,approvedExceptionAppliedOnlyToOriginalExterior90Corners:true,
  reason:contained?'all excluded square-minus-disk cells remain outside U; exact CAD-minus-U inventory minus analytic authorized corner area':'U not proven a subset of P; no missing-area credit applied',
  physicalFlowValidated:false,ownerAccepted:false};
}
module.exports={planTRoundedMaterial,buildRoundedBoundaryReference,accountRoundedMaterial};
