'use strict';
// Source-prescribed 1.7W return-wall candidate. Its original caps and corners
// remain required. Continuity is never a substitute for full material coverage.
const R=require('./rational.cjs'),A=require('./accuracy-contract.cjs');
const {rectangleSource,planRectangleAllocation}=require('./rectangle-allocation.cjs');
const {mapInterval}=require('./provenance.cjs');
const eq=(a,b)=>R.cmp(a,b)===0;
function planRectangleReturn(source,W=1,count=7){
 const original=planRectangleAllocation(source,W,count),r=rectangleSource(source),w=R.exact(W);
 if(!eq(R.div(r.gap,w),R.exact(1.7)))throw Error('continuous return candidate requires the explicit 1.7W source class');
 if(R.cmp(r.length,R.mul(w,R.rat(6n)))<=0)throw Error('finite seam and ordinary width phases require length greater than 6W');
 const half=R.div(w,R.rat(2n)),residual=R.sub(r.gap,w),radius=R.div(residual,R.rat(2n)),
  lower=R.add(r.lo[r.transverse],half),upper=R.sub(r.hi[r.transverse],half),cy=R.div(R.add(lower,upper),R.rat(2n)),
  cx=[R.add(r.lo[r.axis],R.add(half,radius)),R.sub(r.hi[r.axis],R.add(half,radius))],
  seam=R.add(r.lo[r.axis],R.mul(w,R.rat(2n))),N=8;
 const point=(u,v)=>{const p=[];p[r.axis]=u;p[r.transverse]=v;return p;};
 const quarter=Array.from({length:N+1},(_,i)=>{
  const t=R.rat(BigInt(i),BigInt(N)),t2=R.mul(t,t),d=R.add(R.one,t2);
  return [R.div(R.mul(t,R.rat(2n)),d),R.div(R.sub(t2,R.one),d)];
 });
 const right=quarter.concat(quarter.slice(0,-1).reverse().map(p=>[p[0],R.rat(-p[1].n,p[1].d)]));
 const arcs=[right,right.map(p=>[R.rat(-p[0].n,p[0].d),R.rat(-p[1].n,p[1].d)])];
 const points=[point(seam,lower),point(cx[1],lower)],widths=[w,w],phaseIndices=[];
 const bankIntervals=(p,q,cap)=>r.P.flatMap((a,edge)=>{
  const b=r.P[(edge+1)%4],d=R.vec(b,a),longBank=eq(a[r.transverse],b[r.transverse]);
  if(!longBank&&!(cap!==null&&eq(a[r.axis],cap? r.hi[r.axis]:r.lo[r.axis])))return[];
  const at=x=>longBank?R.div(R.sub(x[r.axis],a[r.axis]),d[r.axis]):R.div(R.sub(x[r.transverse],a[r.transverse]),d[r.transverse]);
  return mapInterval([r.normalized],[source],{ring:0,edge,exactU0:R.str(at(p)),exactU1:R.str(at(q))})
   .map(c=>({...c,role:longBank?'finite-original-narrow-return-bank':'finite-original-return-cap-bank'}));
 });
 const segments=[{role:'nominal-forward-bank',sourceIntervals:bankIntervals(points[0],points[1],null)}];
 for(let turn=0;turn<2;turn++){
  const first=points.length-1,arc=arcs[turn],x=cx[1-turn],startWidth=turn?residual:w,endWidth=turn?w:residual;
  for(let i=1;i<arc.length;i++){
   const p=point(R.add(x,R.mul(radius,arc[i][0])),R.add(cy,R.mul(radius,arc[i][1]))),previous=points.at(-1);
   points.push(p);widths.push(R.add(startWidth,R.mul(R.sub(endWidth,startWidth),R.rat(BigInt(i),BigInt(arc.length-1)))));
   segments.push({role:turn?'ordinary-return-expansion':'ordinary-return-contraction',sourceIntervals:bankIntervals(previous,p,!turn)});
  }
  phaseIndices.push({from:first,to:points.length-1,kind:turn?'expansion':'contraction'});
  const p=turn?point(seam,lower):point(cx[0],upper),previous=points.at(-1);
  points.push(p);widths.push(endWidth);segments.push({role:turn?'nominal-forward-bank':'attached-residual-return-bank',sourceIntervals:bankIntervals(previous,p,null)});
 }
 // Map local long/transverse coordinates to positive printer-frame CW order.
 // Axis exchange reverses orientation; source winding never controls the route.
 if(r.axis===1){points.reverse();widths.reverse();segments.reverse();for(const s of segments)for(const c of s.sourceIntervals){[c.exactU0,c.exactU1]=[c.exactU1,c.exactU0];[c.u0,c.u1]=[c.u1,c.u0];}}
 const prior=points.at(-1),closure=prior.slice();closure[r.axis]=R.add(prior[r.axis],r.axis===0?half:R.rat(-half.n,half.d));
 points.push(closure);widths.push(w);segments.push({role:'source-owned-half-W-closure',closure:true,sourceIntervals:bankIntervals(prior,closure,null)});
 // Phase lengths are independently bounded before emitted coordinates exist.
 const phases=phaseIndices.map(phase=>{
  let lowerBound=R.zero,upperBound=R.zero;
  for(let i=phase.from;i<phase.to;i++){
   // Reversal changes only ordering; each arc owns the same complete chords.
   const a=arcs[phase.kind==='contraction'?0:1][i-phase.from],b=arcs[phase.kind==='contraction'?0:1][i-phase.from+1],
    length=A.sqrtBounds(R.mul(R.dot(R.vec(b,a),R.vec(b,a)),R.mul(radius,radius)));
   lowerBound=R.add(lowerBound,length[0]);upperBound=R.add(upperBound,length[1]);
  }
  return{kind:phase.kind,exactLengthLowerBoundMM:R.str(lowerBound),exactLengthUpperBoundMM:R.str(upperBound),
   atLeastNominalW:R.cmp(lowerBound,w)>=0,constantConnectorSubstitution:false};
 });
 if(phases.some(p=>!p.atLeastNominalW))throw Error('ordinary W-long phase does not fit the independently planned turn');
 let circleBound=R.zero;
 for(const arc of arcs)for(let i=1;i<arc.length;i++){
  const chord=R.vec(arc[i],arc[i-1]),halfSquared=R.div(R.mul(R.dot(chord,chord),R.mul(radius,radius)),R.rat(4n)),
   radial=A.sqrtBounds(R.sub(R.mul(radius,radius),halfSquared));
  circleBound=A.max(circleBound,R.sub(radius,radial[0]));
 }
 return{kind:'independent-source-1.7W-return-reference',sourcePreserved:true,originalRequiredMaterialPlan:original,
  exactPoints:points.map(p=>p.map(R.str)),exactWidths:widths.map(R.str),segments,phases,
  sourceCircleAxisNozzleBoundExactMM:R.str(circleBound),continuousCircleFeedCertified:false,
  independentStarts:1,internalRestartCount:0,clockwise:true,outsideDepth:0,W,count,
  intentionalDesignGap:original.intentionalDesignGap,fullOriginalCapsAndCornersRequired:true};
}
function generateRectangleReturn(source,W=1,count=7,signal){
 if(signal?.aborted)throw Error('return allocation cancelled');const plan=planRectangleReturn(source,W,count),
  points=plan.exactPoints.map(p=>p.map(s=>R.number(R.parse(s)))),widths=plan.exactWidths.map(s=>R.number(R.parse(s))),
  proof=A.provePolylineTransform(plan.exactPoints,points,plan.segments.map((_,i)=>[i]),{
   referenceWidths:plan.exactWidths,outputWidths:widths,nozzleWidth:W}),
  accuracy={...A.certifyBudget(W,[{name:'source-only finite return plan to complete axis nozzle and feed commands',
   verified:true,exactUpperBound:proof.exactUpperBound}]),wholeTrajectoryDeviationCertified:false};
 const commands=plan.segments.map((s,i)=>({kind:'print',from:points[i],to:points[i+1],widthStart:widths[i],
  widthEnd:widths[i+1],depth:0,role:s.role,closure:s.closure===true,sourceIntervals:structuredClone(s.sourceIntervals)}));
 const paths=[{points,widths,depth:0,sourceIntervals:commands.flatMap(c=>c.sourceIntervals),independentStartAllowed:true,
  attachedResidual:true,internalRestartCount:0}];
 return{kind:'generated-continuous-1.7W-return-candidate',plan,paths,commands,execution:commands,accuracy,
  sourcePreserved:true,ordinaryWidthPhasesCertified:true,independentStarts:1,internalRestartCount:0,
  routeAccepted:false,wholeSourceAllocationCertified:false,wholeLayerAccuracyCertified:false,
  continuousCircleFeedCertified:false,fullOriginalCapsRequired:true,attachedResidualRestartUnqualified:false};
}
module.exports={planRectangleReturn,generateRectangleReturn};
