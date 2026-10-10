'use strict';
// One bounded source-defined alternate seam; original material is unchanged.
const R=require('./rational.cjs'),A=require('./accuracy-contract.cjs');
const {planRectangleReturn}=require('./rectangle-return-plan.cjs');
function planTurnSeam(source,W=1,count=7){
 const base=planRectangleReturn(source,W,count),w=R.exact(W),half=R.div(w,R.rat(2n)),
  P=base.exactPoints.slice(0,-2).map(p=>p.map(R.parse)),B=base.exactWidths.slice(0,-2).map(R.parse),
  S=base.segments.filter(s=>!s.closure),start=B.findIndex((width,i)=>R.cmp(width,w)===0&&R.cmp(B[(i+1)%B.length],width)<0);
 if(start<0||P.length!==S.length)throw Error('source turn seam is not bound to the nominal W phase');
 const points=P.slice(start).concat(P.slice(0,start)),widths=B.slice(start).concat(B.slice(0,start)),
  segments=structuredClone(S.slice(start).concat(S.slice(0,start)));
 points.push(points[0]);widths.push(widths[0]);const coursePoints=points.slice(),courseSegments=segments.length;
 let usedLower=R.zero,usedUpper=R.zero,remaining=half;
 const clamp=(q,a,b)=>A.max(a,A.min(b,q));
 function partialIntervals(s,a,b){return s.sourceIntervals.flatMap(c=>{
  const p=source[c.edge].map(R.exact),d=R.vec(source[(c.edge+1)%source.length].map(R.exact),p),L2=R.dot(d,d),
   at=x=>R.div(R.dot(R.vec(x,p),d),L2),u0=R.parse(c.exactU0),u1=R.parse(c.exactU1),lo=A.min(u0,u1),hi=A.max(u0,u1),
   x=clamp(at(a),lo,hi),y=clamp(at(b),lo,hi);
  if(R.cmp(x,y)===0)return[];
  return[{...c,exactU0:R.str(x),exactU1:R.str(y),u0:R.number(x),u1:R.number(y)}];
 });}
 for(let i=0;i<courseSegments&&remaining.n>0n;i++){
  const a=coursePoints[i],b=coursePoints[i+1],d=R.vec(b,a),length=A.sqrtBounds(R.dot(d,d)),
   full=R.cmp(length[1],remaining)<=0,t=full?R.one:R.div(remaining,length[1]),q=a.map((v,k)=>R.add(v,R.mul(d[k],t))),
   bounds=length.map(l=>R.mul(l,t));
  points.push(q);widths.push(w);segments.push({...structuredClone(segments[i]),closure:true,
   role:'constant-W-source-turn-half-W-closure',sourceIntervals:partialIntervals(segments[i],a,q)});
  usedLower=R.add(usedLower,bounds[0]);usedUpper=R.add(usedUpper,bounds[1]);remaining=R.sub(half,usedUpper);
  if(!full)break;
 }
 if(R.cmp(usedUpper,half)>0||R.cmp(usedLower,R.zero)<=0)throw Error('bounded turn closure failed');
 return{...base,kind:'independent-1.7W-turn-seam-reference',exactPoints:points.map(p=>p.map(R.str)),
  exactWidths:widths.map(R.str),segments,courseSegments,
  closure:{nominalLengthMM:.5*W,exactLengthLowerMM:R.str(usedLower),exactLengthUpperMM:R.str(usedUpper),
   exactConstructionShortfallUpperMM:R.str(R.sub(half,usedLower)),constantNominalWidth:true,
   originalMaterialReferenceUnchanged:true,creditForRemovedOverlap:false}};
}
function generateTurnSeam(source,W=1,count=7,signal){
 if(signal?.aborted)throw Error('return seam cancelled');const plan=planTurnSeam(source,W,count),
  points=plan.exactPoints.map(p=>p.map(s=>R.number(R.parse(s)))),widths=plan.exactWidths.map(s=>R.number(R.parse(s))),
  proof=A.provePolylineTransform(plan.exactPoints,points,plan.segments.map((_,i)=>[i]),{
   referenceWidths:plan.exactWidths,outputWidths:widths,nozzleWidth:W}),
  accuracy={...A.certifyBudget(W,[{name:'complete source-defined turn seam plan to axis nozzle feed',verified:true,exactUpperBound:proof.exactUpperBound},
   {name:'exact half-W seam length construction',verified:true,exactUpperBound:plan.closure.exactConstructionShortfallUpperMM}]),wholeTrajectoryDeviationCertified:false},
  commands=plan.segments.map((s,i)=>({kind:'print',from:points[i],to:points[i+1],widthStart:widths[i],widthEnd:widths[i+1],
   depth:0,role:s.role,closure:s.closure===true,sourceIntervals:structuredClone(s.sourceIntervals)}));
 return{kind:'generated-continuous-1.7W-turn-seam-candidate',plan,commands,execution:commands,
  paths:[{points,widths,depth:0,sourceIntervals:commands.flatMap(c=>c.sourceIntervals),independentStartAllowed:true,attachedResidual:true}],accuracy,
  independentStarts:1,internalRestartCount:0,sourcePreserved:true,ordinaryWidthPhasesCertified:true,
  routeAccepted:false,wholeSourceAllocationCertified:false,wholeLayerAccuracyCertified:false,
  fullOriginalCapsRequired:true,attachedResidualRestartUnqualified:false,continuousCircleFeedCertified:false};
}
module.exports={planTurnSeam,generateTurnSeam};
