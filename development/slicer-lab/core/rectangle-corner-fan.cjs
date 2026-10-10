'use strict';
// Local original-corner construction only. Start/width-policy/route authority
// is unresolved; a material coupon proof cannot select a whole layer.
const R=require('./rational.cjs'),A=require('./accuracy-contract.cjs');
const {rectangleSource}=require('./rectangle-allocation.cjs');
const {mapInterval}=require('./provenance.cjs');
const eq=(a,b)=>R.cmp(a,b)===0;
function planCornerFan(source,W=1,corner=0){
 if(!(W>0)||!Number.isFinite(W)||!Number.isInteger(corner)||corner<0||corner>3)throw Error('invalid corner coupon');
 const rect=rectangleSource(source),w=R.exact(W),N=112,c=R.mul(w,R.rat(51n,100n)),h=R.mul(w,R.rat(1n,200n)),
  reserve=R.mul(w,R.rat(3n,500n)),half=R.div(w,R.rat(2n)),high=[corner===1||corner===2,corner>=2],
  origin=high.map((yes,k)=>yes?rect.hi[k]:rect.lo[k]),sign=high.map(yes=>R.rat(yes?-1n:1n)),
  physical=p=>p.map((v,k)=>R.add(origin[k],R.mul(sign[k],v)));
 if([0,1].some(k=>R.cmp(R.sub(rect.hi[k],rect.lo[k]),R.mul(w,R.rat(11n,10n)))<0))throw Error('corner fan requires both source extents at least1.1W');
 const supports=rect.P.flatMap((p,edge)=>{
  const q=rect.P[(edge+1)%4],d=R.vec(q,p);
  if(![p,q].some(v=>v.every((x,k)=>eq(x,origin[k]))))return[];
  const at=x=>R.div(R.dot(R.vec(x,p),d),R.dot(d,d)),other=origin.slice(),axis=d[0].n?0:1;
  other[axis]=R.add(origin[axis],R.mul(sign[axis],half));
  return mapInterval([rect.normalized],[source],{ring:0,edge,exactU0:R.str(at(origin)),exactU1:R.str(at(other))})
   .map(v=>({...v,role:'finite-original-mandatory-corner-bank'}));
 });
 const rays=[];let feedMargin,nozzleMargin;
 for(let i=0;i<=N;i++){
  const t=R.rat(BigInt(i),BigInt(N)),tt=R.mul(t,t),den=R.add(R.one,tt),
   n=[R.div(R.sub(R.one,tt),den),R.div(R.mul(t,R.rat(2n)),den)],d=[n[1],R.rat(-n[0].n,n[0].d)],
   radius=R.sub(R.div(c,A.max(...n)),reserve),from=[c,c].map((v,k)=>R.sub(v,R.mul(h,d[k]))),to=[c,c].map((v,k)=>R.add(v,R.mul(h,d[k]))),
   quad=[from,to].flatMap(p=>[-1,1].map(s=>p.map((v,k)=>R.add(v,R.mul(R.mul(radius,R.rat(BigInt(s))),n[k]))))),
   points=[from,to].map(physical),width=R.mul(radius,R.rat(2n));
  if(R.cmp(width,R.mul(w,R.rat(3n,5n)))<0||R.cmp(width,R.mul(w,R.rat(8n,5n)))>0)throw Error('working corner width outside permitted range');
  for(const p of quad.map(physical))for(let k=0;k<2;k++){
   const margin=A.min(R.sub(p[k],rect.lo[k]),R.sub(rect.hi[k],p[k]));if(margin.n<0n)throw Error('planned corner feed outside original source');
   feedMargin=feedMargin?A.min(feedMargin,margin):margin;
  }
  for(const p of points)for(let k=0;k<2;k++){
   const margin=R.sub(A.min(R.sub(p[k],rect.lo[k]),R.sub(rect.hi[k],p[k])),half);
   if(margin.n<0n)throw Error('planned corner nozzle outside original source');nozzleMargin=nozzleMargin?A.min(nozzleMargin,margin):margin;
  }
  rays.push({exactPoints:points.map(p=>p.map(R.str)),exactWidth:R.str(width),sourceIntervals:structuredClone(supports)});
 }
 // For EVERY q in the original [0,W/2]^2 corner, relative to c:
 // rho(phi)=c/max(cos(phi),sin(phi)); |rho'|<=c*sqrt(2).
 // Consecutive rational directions have angular gap<=2/N. The nearest ray
 // has angle error<=1/N. Its tangent error<=c*sqrt(2)/N and radial shortage
 // <=c*sqrt(2)/N+reserve. Their L1 sum bounds Euclidean cell distance.
 const radialUpper=R.mul(c,A.sqrtBounds(R.rat(2n))[1]),deviation=R.add(R.div(R.mul(radialUpper,R.rat(2n)),R.rat(BigInt(N))),reserve),
  required=[[R.zero,R.zero],[half,R.zero],[half,half],[R.zero,half]].map(physical);
 return{kind:'independent-original-corner-angular-allocation',corner,W,source:source.map(p=>p.slice()),rays,
  originalRequiredCorner:required.map(p=>p.map(R.str)),analyticCoverageExactUpperMM:R.str(deviation),
  reference:'complete unchanged original source corner square; no positive point sampling and no changed required material',
  uniformDirections:N+1,maximumNearestAngleRadiansUpper:1/N,radialLipschitzExactUpperMM:R.str(radialUpper),
  plannedFeedClearanceExactMM:R.str(feedMargin),plannedNozzleClearanceExactMM:R.str(nozzleMargin),
  workingWidthRangeCertified:true,wholeRouteWidthNecessityCertified:false,restartProtocolCertified:false,
  originalFiniteCornerSourcesBound:true,actualMeshFaceBindingCertified:false};
}
function generateCornerFan(source,W=1,corner=0,signal){
 if(signal?.aborted)throw Error('corner allocation cancelled');const plan=planCornerFan(source,W,corner),paths=[];let representation=R.zero;
 for(const ray of plan.rays){
  if(signal?.aborted)throw Error('corner allocation cancelled');const points=ray.exactPoints.map(p=>p.map(s=>R.number(R.parse(s)))),width=R.number(R.parse(ray.exactWidth)),
   proof=A.provePolylineTransform(ray.exactPoints,points,[[0]],{referenceWidths:[ray.exactWidth,ray.exactWidth],outputWidths:[width,width],nozzleWidth:W});
  representation=A.max(representation,R.parse(proof.exactUpperBound));paths.push({points,widths:[width,width],sourceIntervals:ray.sourceIntervals});
 }
 const accuracy={...A.certifyBudget(W,[{name:'entire original corner to independent finite angular feed allocation',verified:true,exactUpperBound:plan.analyticCoverageExactUpperMM},
  {name:'entire planned fan to emitted axes nozzle and feed',verified:true,exactUpperBound:R.str(representation)}]),wholeTrajectoryDeviationCertified:false},
  sourceContained=R.cmp(representation,R.parse(plan.plannedFeedClearanceExactMM))<0&&R.cmp(representation,R.parse(plan.plannedNozzleClearanceExactMM))<0;
 const commands=paths.map(p=>({kind:'print',from:p.points[0],to:p.points[1],widthStart:p.widths[0],widthEnd:p.widths[1],sourceIntervals:p.sourceIntervals}));
 return{kind:'generated-local-original-corner-candidate',plan,paths,commands,accuracy,
  completeOriginalCornerApproximationCertified:accuracy.accepted,wholeSourceNozzleAndFeedContained:sourceContained,
  fullRouteWidthNecessityCertified:false,restartProtocolCertified:false,independentStartsUnqualified:paths.length,
  selectedCommands:[],routeAccepted:false,wholeSourceAllocationCertified:false,physicalPrintValidated:false,
  scope:'local source-required material construction and containment only; multiple starts and full route remain unresolved'};
}
module.exports={planCornerFan,generateCornerFan};
