'use strict';
// Independent original-material reference, before any command is emitted.
// The complete annulus is partitioned by its ORIGINAL paired radial banks.
const R=require('./rational.cjs'),A=require('./accuracy-contract.cjs');
const {canonicalRing}=require('./contour-core.cjs'),{mapInterval}=require('./provenance.cjs');
const eq=(a,b)=>R.cmp(a,b)===0,half=q=>R.div(q,R.rat(2n));
const point=(a,d,t)=>a.map((v,k)=>R.add(v,R.mul(d[k],t)));
function view(source,ring){
 const normalized=canonicalRing(source),P=normalized.ring.map(p=>p.map(R.exact)),n=P.length;
 if(n<3||n>192)throw Error('bounded convex annulus requires 3..192 canonical edges');
 const area=P.reduce((s,p,i)=>R.add(s,R.cross(p,P[(i+1)%n])),R.zero);
 if(!area.n)throw Error('degenerate annulus bank');
 const indices=area.n>0n?P.map((_,i)=>i):[0,...P.slice(1).map((_,i)=>n-1-i)];
 const Q=indices.map(i=>P[i]);
 if(Q.some((p,i)=>R.cmp(R.cross(R.vec(Q[(i+1)%n],p),R.vec(Q[(i+2)%n],Q[(i+1)%n])),R.zero)<=0))
  throw Error('strict convex original annulus banks required');
 return {normalized,P:Q,indices,ring,area:A.abs(area),reversed:area.n<0n};
}
function planAnnulus(rings,W=1,count=1,signal){
 if(signal?.aborted)throw Error('annulus cancelled');
 if(!(W>0)||!Number.isFinite(W)||count!==1||!Array.isArray(rings)||rings.length!==2)
  throw Error('one perimeter of one original two-bank annulus required');
 const views=rings.map(view),outer=R.cmp(views[0].area,views[1].area)>0?views[0]:views[1],inner=views.find(v=>v!==outer),n=outer.P.length;
 if(inner.P.length!==n)throw Error('paired original convex edges required');
 let paired;
 for(let shift=0;shift<n&&!paired;shift++){
  const I=inner.P.slice(shift).concat(inner.P.slice(0,shift)),D=R.vec(outer.P[1],outer.P[0]),E=R.vec(I[1],I[0]);
  if(R.cross(D,E).n||R.cmp(R.dot(D,E),R.zero)<=0)continue;
  const k=D[0].n?0:1,alpha=R.div(E[k],D[k]);
  if(R.cmp(alpha,R.zero)<=0||R.cmp(alpha,R.one)>=0)continue;
  const b=I[0].map((v,k)=>R.sub(v,R.mul(alpha,outer.P[0][k])));
  if(I.every((p,i)=>p.every((v,k)=>eq(v,R.add(R.mul(alpha,outer.P[i][k]),b[k])))))paired={I,alpha,b,shift};
 }
 if(!paired)throw Error('exact homothetic source banks required; near equality is not welding');
 const {I,alpha,b,shift}=paired,O=outer.P,C=b.map(v=>R.div(v,R.sub(R.one,alpha))),w=R.exact(W),
  M=O.map((p,i)=>p.map((v,k)=>half(R.add(v,I[i][k])))),edges=[],cells=[];
 // Local positive turns alone also occur in multiply-wound star polygons.
 // The later exact centre-left-of-every-bank checks give positive radial
 // increments <pi. Exactly ONE winding then proves a simple radial boundary;
 // simple boundary plus all strict positive local turns proves convexity.
 const radialWinding=bank=>bank.reduce((winding,p,i)=>{
  const a=R.vec(p,C),b=R.vec(bank[(i+1)%n],C);
  if(a[1].n<=0n&&b[1].n>0n&&R.cross(a,b).n>0n)return winding+1;
  if(a[1].n>0n&&b[1].n<=0n&&R.cross(a,b).n<0n)return winding-1;
  return winding;
 },0);
 if(radialWinding(O)!==1||radialWinding(I)!==1)throw Error('single exact radial winding of each original source bank required');
 let gapLow=null,gapHigh=R.zero,joinBound=R.zero;
 for(let i=0;i<n;i++){
  if(signal?.aborted)throw Error('annulus cancelled');
  const j=(i+1)%n,d=R.vec(O[j],O[i]),L=A.sqrtBounds(R.dot(d,d)),H=R.cross(d,R.vec(I[i],O[i])),
   gap=[R.div(H,L[1]),R.div(H,L[0])];
  if(H.n<=0n||R.cross(d,R.vec(C,I[i])).n<=0n)throw Error('original hole and radial centre must be strictly nested');
  gapLow=gapLow?A.min(gapLow,gap[0]):gap[0];gapHigh=A.max(gapHigh,gap[1]);
  const tangents=[i,j].map(k=>R.div(A.abs(R.dot(R.vec(O[k],I[k]),d)),R.mul(R.rat(2n),L[0])));
  joinBound=A.max(joinBound,tangents.reduce(A.max));
  const cell=[O[i],O[j],I[j],I[i]];
  if(cell.some((p,k)=>R.cross(R.vec(cell[(k+1)%4],p),R.vec(cell[(k+2)%4],cell[(k+1)%4])).n<=0n))throw Error('nonconvex original radial material cell');
  cells.push(cell);edges.push({gap,canonicalOuterEdge:outer.reversed?outer.indices[j]:outer.indices[i],
   canonicalInnerEdge:inner.reversed?inner.indices[(j+shift)%n]:inner.indices[(i+shift)%n]});
 }
 // Only nearly uniform nominal walls. General variable-width annuli are refused;
 // their W-long phases must be generated, rather than certified by this class.
 if(R.cmp(gapLow,w)<=0||R.cmp(gapHigh,R.mul(w,R.rat(8n,5n)))>0||
  R.cmp(R.sub(gapHigh,gapLow),R.div(w,R.rat(65536n)))>0)
  throw Error('annulus nominal-nozzle clearance or near-uniform working-width domain');
 const guard=R.div(w,R.rat(1073741824n)),width=R.exact(R.number(R.sub(gapLow,guard)));
 if(R.cmp(width,w)<0||R.cmp(width,R.sub(gapLow,half(guard)))>0)throw Error('working width or inward numerical reserve unrepresentable');
 const shapeBound=R.add(joinBound,half(R.sub(gapHigh,width))),profileBound=half(R.sub(gapHigh,width));
 const normalized=rings.map(canonicalRing),ownership=(edge,u0,u1)=>{
  const row=edges[edge],bank=(v,id)=>mapInterval(normalized,rings,{ring:v.ring,edge:id,
   exactU0:R.str(v.reversed?R.sub(R.one,u0):u0),exactU1:R.str(v.reversed?R.sub(R.one,u1):u1)});
  return [...bank(outer,row.canonicalOuterEdge),...bank(inner,row.canonicalInnerEdge)]
   .map(q=>({...q,role:'original-paired-annulus-bank'}));
 };
 const D=R.vec(M[1],M[0]),length=A.sqrtBounds(R.dot(D,D)),start=point(M[0],D,R.rat(1n,2n)),
  nominalSeam=half(w),seamT=R.mul(R.div(R.mul(w,w),R.mul(R.rat(2n),R.mul(width,length[1]))),R.rat(1048575n,1048576n)),
  end=point(start,D,R.rat(-seamT.n,seamT.d)),seamLength=[R.mul(seamT,length[0]),R.mul(seamT,length[1])],
  seamShortfall=R.sub(nominalSeam,seamLength[0]);
 if(R.cmp(length[0],R.mul(w,R.rat(2n)))<0||R.cmp(R.add(R.rat(1n,2n),seamT),R.one)>=0||
  seamShortfall.n<0n||R.cmp(seamShortfall,R.div(w,R.rat(262144n)))>0)
  throw Error('long original straight seam or numerical half-W closure reserve required');
 // Keep the source/proof banks CCW for exact left half-planes. ONLY the
 // independently prescribed print lap and directed ownership run physical CW.
 const exactPoints=[start,M[0],...M.slice(1).reverse(),start,end],segments=[];
 segments.push({edge:0,u0:R.rat(1n,2n),u1:R.zero});
 for(let i=n-1;i>=1;i--)segments.push({edge:i,u0:R.one,u1:R.zero});
 segments.push({edge:0,u0:R.one,u1:R.rat(1n,2n)});
 segments.push({edge:0,u0:R.rat(1n,2n),u1:R.sub(R.rat(1n,2n),seamT),closure:true});
 const sourceNormalization=A.proveSourceNormalization(rings,normalized);
 return {kind:'independent-full-original-annulus-plan',W,count,source:structuredClone(rings),
  exactPoints:exactPoints.map(p=>p.map(R.str)),exactWidth:R.str(width),
  segments:segments.map(s=>({edge:s.edge,closure:!!s.closure,sourceIntervals:ownership(s.edge,s.u0,s.u1)})),
  requiredCells:cells.map((p,i)=>({role:'complete-original-annular-radial-cell',edge:i,exactPoints:p.map(p=>p.map(R.str))})),
  exactOuter:O.map(p=>p.map(R.str)),exactInner:I.map(p=>p.map(R.str)),exactMidline:M.map(p=>p.map(R.str)),
  exactRadialCentre:C.map(R.str),exactHomothety:R.str(alpha),outerRing:outer.ring,innerRing:inner.ring,
  physicalMaterialBoundaries:{coordinateSpace:'physical-mm-right-handed-XY-Z-up',outerCCW:O.map(p=>p.map(R.str)),
   holeCW:[I[0],...I.slice(1).reverse()].map(p=>p.map(R.str)),originalSourceUnchanged:true,
   method:'oriented material boundary keeps material on left; hole subtracted by exact nesting; printing direction independently clockwise'},
  materialPartition:{complete:true,singleOriginalRadialWindingCertified:true,method:'single-winding strictly convex nested homothetic radial cells; disjoint interiors, exact entire outer-minus-hole partition'},
  requiredCoverageProof:{method:'every original radial-cell vertex maps into its full finite midline rectangle; convex affine correspondence covers every cell point',
   exactMiterConstructionUpperBoundMM:R.str(joinBound),exactNormalProfileUpperBoundMM:R.str(profileBound),
   exactUpperBoundMM:R.str(shapeBound),sourceReferenceIndependent:true,positiveSamplesUsed:false,originalCornersRequired:true},
  sourceNormalization,exactGapLowerMM:R.str(gapLow),exactGapUpperMM:R.str(gapHigh),
  exactHeadSourceMarginMM:R.str(half(R.sub(gapLow,w))),exactFeedSourceMarginMM:R.str(half(R.sub(gapLow,width))),
  seam:{exactNominalLengthMM:R.str(nominalSeam),exactLengthLowerMM:R.str(seamLength[0]),exactLengthUpperMM:R.str(seamLength[1]),
   exactConstructionShortfallMM:R.str(seamShortfall),maximumLengthMM:.5*W,protocol:'one external straight same-width closure; joint extra charge remains W^2/2'},
  widthNecessity:{verified:true,exactPrescribedSourceWidths:edges.map(q=>q.gap.map(R.str)),
   policy:'one source-wall bead; exact parallel-bank separation prescribes its width; constant emission approximates these independently fixed widths within the cumulative construction budget',
   nominalWInsufficientForExactPrescribedWall:gapLow.n>0n&&R.cmp(gapLow,w)>0,ordinaryWidthChanges:0,
   exactUniformProfileApproximationMM:R.str(profileBound)},
  intentionalDesignGap:false,sourceReferenceDerivedFromOutput:false,
  supportedClass:'one strictly convex near-uniform homothetic annulus, 3..192 matched exact banks, count=1, full miter and cumulative construction bound <=2%W, strict nozzle/feed clearance and long straight half-W seam'};
}
module.exports={planAnnulus};
