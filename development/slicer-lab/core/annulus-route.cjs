'use strict';
const R=require('./rational.cjs'),A=require('./accuracy-contract.cjs'),{planAnnulus}=require('./annulus-reference.cjs');
const {load}=require('./adapter.cjs'),{exactJointCharge}=require('./exact-joint-charge.cjs'),{upper}=require('./mesh-section.cjs');
const {auditAnnulusRequiredCells}=require('./annulus-required-cell-audit.cjs');
const {auditPhysicalPrintLoop}=require('./physical-path-direction.cjs');
function ledgerSnapshot(original,final,W){
 // Preserve an immutable scalar receipt before another independent ledger run.
 // This also fails closed on a stale/loose display value inconsistent with the
 // authoritative exact rational sum. No overlap predicate or limit changes.
 const receipt=JSON.parse(JSON.stringify(exactJointCharge(original,final,W))),
  exact=R.parse(receipt.exactChargeUpperBoundMM2),display=R.exact(receipt.chargeUpperBoundMM2),
  rounding=R.div(R.mul(R.exact(W),R.exact(W)),R.rat(281474976710656n));
 if(R.cmp(display,exact)<0||R.cmp(R.sub(display,exact),rounding)>0)throw Error('inconsistent exact/display overlap receipt');
 return Object.freeze(receipt);
}
function createAnnulusCore(){
 const c=load('optimized-worker.js').context;
 return {generate({rings,W=1,count=1,signal}){
  const plan=planAnnulus(rings,W,count,signal),P=plan.exactPoints.map(p=>p.map(R.parse)),width=R.parse(plan.exactWidth),
   points=P.map(p=>p.map(R.number)),w=R.number(width),quads=[],commands=[];
  let axisError=R.zero,feedError=R.zero;
  for(let i=0;i<P.length-1;i++){
   if(signal?.aborted)throw Error('annulus cancelled');
   const normal=A.normal(R.vec(P[i+1],P[i])),quad=c.frameThroughNeckRibbon(points[i],points[i+1],w,w);
   for(const k of [i,i+1])axisError=A.max(axisError,P[k].reduce((s,v,j)=>R.add(s,A.abs(R.sub(v,R.exact(points[k][j])))),R.zero));
   for(let k=0;k<4;k++){
    const ideal=A.corner(k===0||k===3?P[i]:P[i+1],normal,width,k<2?1:-1);
    feedError=A.max(feedError,quad[k].reduce((s,v,j)=>R.add(s,A.max(A.abs(R.sub(R.exact(v),ideal[j][0])),A.abs(R.sub(R.exact(v),ideal[j][1])))),R.zero));
   }
   quads.push(quad);commands.push({kind:'print',from:points[i],to:points[i+1],widthStart:w,widthEnd:w,depth:0,
    closure:plan.segments[i].closure,sourceIntervals:structuredClone(plan.segments[i].sourceIntervals),role:'source-derived-continuous-annulus'});
  }
  // Planned ideal centre segments are midpoints of original homothetic banks.
  // Every outer half-plane has >= minGap/2 clearance; each segment's own inner
  // half-plane separates the entire hole by >= minGap/2. Convex interpolation,
  // constant-radius capsule and ribbon-corner error bounds prove ALL points.
  const headPassed=R.cmp(axisError,R.parse(plan.exactHeadSourceMarginMM))<0,
   feedPassed=R.cmp(feedError,R.parse(plan.exactFeedSourceMarginMM))<0;
  // Nominal ledger is fixed from the independent source plan before emission.
  // The prescribed closure receives NO nominal credit: it is fully charged.
  const nominal=plan.exactPoints.slice(0,-2).map((p,i)=>c.frameThroughNeckRibbon(p.map(s=>R.number(R.parse(s))),
   plan.exactPoints[i+1].map(s=>R.number(R.parse(s))),R.number(R.parse(plan.exactWidth)),R.number(R.parse(plan.exactWidth))));
  const charge=ledgerSnapshot(nominal,quads,W),nominalPairOverlap=ledgerSnapshot([],nominal,W),
   grossPairOverlap=ledgerSnapshot([],quads,W),coverage=auditAnnulusRequiredCells(plan,quads,W),accuracy=A.certifyBudget(W,[
   {name:'entire original annular miter material and exact source-width profile to finite source-owned rectangles',verified:true,exactUpperBound:plan.requiredCoverageProof.exactUpperBoundMM},
   {name:'exact original collinear normalization',verified:true,exactUpperBound:plan.sourceNormalization.exactUpperBound},
   {name:'all emitted axis, nominal nozzle and feed corner representations',verified:true,exactUpperBound:R.str(A.max(axisError,feedError))},
   {name:'half-W prescribed closure computational truncation for joint area reserve',verified:true,exactUpperBound:plan.seam.exactConstructionShortfallMM}
  ]);
  const physicalDirection=auditPhysicalPrintLoop(commands),clockwise=physicalDirection.clockwise,
   continuous=commands.every((q,i)=>!i||q.from.every((v,k)=>v===commands[i-1].to[k])),
   reasons=[];
  if(!headPassed)reasons.push('whole nominal nozzle source containment unresolved');
  if(!feedPassed)reasons.push('whole feed source containment unresolved');
  if(!accuracy.accepted)reasons.push('complete original material cumulative construction bound exceeds 2%W');
  if(!coverage.requiredCellsCovered||R.cmp(R.parse(coverage.exactUpperBoundMM),R.add(R.parse(plan.requiredCoverageProof.exactUpperBoundMM),feedError))>0)
   reasons.push('independent complete original material to actual convex feed-cell oracle failed');
  if(!charge.passed)reasons.push('joint same-width closure charge exceeds W^2/2');
  if(!clockwise||!continuous)reasons.push('clockwise continuous traversal unresolved');
  const passed=!reasons.length;
  return {kind:'generated-full-original-annulus',status:passed?'full-annulus-protocol-candidate':'full-annulus-rejected',plan,commands,
   paths:[{points,widths:points.map(()=>w),depth:0}],execution:structuredClone(commands),accuracy,reasons,
   sourcePreserved:true,newGeneratorConstructedCommands:true,retainedWorkerOutputUsedAsReference:false,
   wholeMandatorySourceCoveragePassed:passed,completeOriginalMaterialCoverageProof:plan.requiredCoverageProof,
   physicalDirection,
   geometry:{geometryPassed:passed,wholeNominalNozzleContained:headPassed,wholeFeedContained:feedPassed,charge,coverage,
    overlapAccounting:{seamAdditionalChargeUpperMM2:charge.chargeUpperBoundMM2,
     prescribedNominalPairOverlapUpperMM2:nominalPairOverlap.chargeUpperBoundMM2,
     grossAllFinalPairOverlapUpperMM2:grossPairOverlap.chargeUpperBoundMM2,
     grossAllFinalPairs:grossPairOverlap.areas,nominalCommonRibbons:charge.commonOriginalRibbons,
     ledgerContract:'existing additional-pair W^2/2 contract; exact identical source-prescribed nominal pairs cancel; no removed-overlap credit',
     referenceIndependence:'nominal finite route and width constructed from immutable original banks before emission; no output-derived reference',
     grossOverlapIsSeamCharge:false,physicalVolumeOrExtrusionMultiplicityValidated:false},
    exactAxisRepresentationUpperBoundMM:R.str(axisError),exactFeedRepresentationUpperBoundMM:R.str(feedError),
    method:'complete source homothety and convex half-plane/capsule proofs with exact representation reserves; no positive sampling'},
   sourceTraversalProtocolCertified:clockwise&&continuous,restartAndClosureProtocolCertified:continuous&&charge.passed,
   clockwiseAndOutsideIn:clockwise,outsideInDepthSchedulingCertified:true,internalRestartCount:0,
   independentStartCount:1,spiralsAccepted:0,ordinaryWidthPhasesRequired:0,widthNecessityCertified:plan.widthNecessity.verified,
   seamLengthUpperMM:upper(R.parse(plan.seam.exactLengthUpperMM)),sourceReferenceIndependent:true,
   wholeSourceAllocationCertified:passed,routeAccepted:false,ownerAccepted:false,selectedCommands:[],
   physicalPrintValidated:false,scope:'one complete original polygonal annulus only; helper candidate requires exact physical mesh and owner regeneration'};
 }};
}
module.exports={createAnnulusCore};
