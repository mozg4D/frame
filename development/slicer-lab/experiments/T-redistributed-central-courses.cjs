'use strict';
// Source-first construction. Ordinary nominal intersections are inventory;
// only explicit seam/connection events receive the .5W² event ceiling.
const R=require('../core/rational.cjs'),A=require('../core/accuracy-contract.cjs');
const {planTBody}=require('../core/T-fill-candidate.cjs'),{canonicalRing}=require('../core/contour-core.cjs'),{mapInterval}=require('../core/provenance.cjs');
const {load}=require('../core/adapter.cjs'),{sourceCells,proveFeedInsideSource}=require('../core/exact-source-feed.cjs');
const {originalMaterialDifference,commandedMultiplicity}=require('../core/deposition-multiplicity.cjs'),{exactJointCharge}=require('../core/exact-joint-charge.cjs');
const {planTRoundedMaterial}=require('../core/T-rounded-prescribed-plan.cjs');
const {hull,subtract}=require('../core/trajectory-union-accuracy.cjs');
const {intersectConvexCells}=require('../core/trajectory-union-accuracy.cjs'),{createExactCells}=require('./T-exact-cells.cjs');
const P=p=>p.map(R.parse),add=(a,b)=>a.map((v,k)=>R.add(v,b[k])),scale=(p,s)=>p.map(v=>R.mul(v,s)),same=(a,b)=>a.every((v,k)=>R.cmp(v,b[k])===0);
const unit=p=>p.map(q=>R.rat(q.n===0n?0n:q.n>0n?1n:-1n));
const ratioRoots=new Map();
function ratioRoot(axis,long){const dx=R.dot(axis,long),q=R.div(R.dot(axis,axis),R.mul(dx,dx)),key=R.str(q);if(ratioRoots.has(key))return ratioRoots.get(key);const lower=A.sqrtBounds(q)[0];if(ratioRoots.size<4096)ratioRoots.set(key,lower);return lower;}
function ceilNumber(q){let n=R.number(q);const d=new DataView(new ArrayBuffer(8));for(let i=0;i<8&&R.cmp(R.exact(n),q)<0;i++){d.setFloat64(0,n,false);d.setBigUint64(0,d.getBigUint64(0,false)+1n,false);n=d.getFloat64(0,false);}if(!Number.isFinite(n)||R.cmp(R.exact(n),q)<0)throw Error('working-width representation');return n;}
function planTRedistributedCentralCourses(source,W=1,count=7,policy={},buildSourceTiles=true){
 const defaults={barLow:.8,barPeak:1.06,stemWidth:.7,stemStop:4,barLead:1/256};
 if(!policy||typeof policy!=='object'||Array.isArray(policy)||Object.keys(policy).some(k=>!(k in defaults)))throw Error('unknown central source policy');
 const central={...defaults,...policy};if(Object.values(central).some(v=>!Number.isFinite(v))||central.barLow<.6||central.barLow>1||central.barPeak<1||central.barPeak>1.3||central.stemWidth<.6||central.stemWidth>1||central.stemStop<3.7||central.stemStop>4.1||central.barLead<0||central.barLead>.01)throw Error('bounded central source policy required');
 const body=planTBody(source,W,count),rounded=planTRoundedMaterial(source,W,count),normalized=canonicalRing(source),w=R.exact(W),h=R.div(w,R.rat(2n)),
  bars=body.rows.filter(q=>q.role==='bar-body'),stems=body.rows.filter(q=>q.role==='stem-body'),b=bars.filter(q=>q.depth===0),s=stems.filter(q=>q.depth===0),
  L=P(b[0].exactTo),B=P(b[0].exactFrom),U=P(b[1].exactFrom),Z=P(b[1].exactTo),SL=P(s[0].exactFrom),TL=P(s[0].exactTo),TR=P(s[1].exactFrom),SR=P(s[1].exactTo),
  u=unit(R.vec(B,L)),v=unit(R.vec(TL,SL)),barOrigin=add(add(L,scale(u,R.sub(R.zero,h))),scale(v,R.sub(R.zero,h))),
  stemOrigin=add(SL,scale(u,R.sub(R.zero,h))),barWidth=R.add(R.dot(R.vec(B,L),u),w),barHeight=R.mul(w,R.rat(BigInt(bars.length))),
  stemWidth=R.mul(w,R.rat(BigInt(stems.length))),stemHeight=R.add(R.dot(R.vec(TL,SL),v),h),root=A.sqrtBounds(R.rat(2n)),peak=R.mul(w,root[1]);
 if(bars.length%2!==1||stems.length%2!==1||R.cmp(barWidth,R.add(barHeight,R.mul(w,R.rat(2n))))<=0||
  [R.dot(R.vec(stemOrigin,barOrigin),u),R.sub(barWidth,R.add(R.dot(R.vec(stemOrigin,barOrigin),u),stemWidth))].some(q=>R.cmp(q,R.add(R.div(barHeight,R.rat(2n)),w))<=0)||
  R.cmp(stemHeight,R.add(R.div(stemWidth,R.rat(2n)),w))<=0)throw Error('bounded odd T with long bar arms and stem required');
 const at=(origin,x,y)=>add(add(origin,scale(u,x)),scale(v,y)),bank=(direction,value)=>normalized.ring.findIndex((p,i)=>{
  const a=p.map(R.exact),b=normalized.ring[(i+1)%8].map(R.exact);return R.dot(R.vec(b,a),direction).n===0n&&R.cmp(R.dot(a,direction),value)===0;}),
  bottom=bank(v,R.dot(barOrigin,v)),leftCap=bank(u,R.dot(barOrigin,u)),rightCap=bank(u,R.dot(add(barOrigin,scale(u,barWidth)),u)),
  leftStem=bank(u,R.dot(stemOrigin,u)),rightStem=bank(u,R.dot(add(stemOrigin,scale(u,stemWidth)),u)),topStem=bank(v,R.dot(add(stemOrigin,scale(v,stemHeight)),v)),
  upperLeft=normalized.ring.findIndex((p,i)=>{const a=p.map(R.exact),b=normalized.ring[(i+1)%8].map(R.exact);return R.dot(R.vec(b,a),v).n===0n&&
   R.cmp(R.dot(a,v),R.dot(add(barOrigin,scale(v,barHeight)),v))===0&&[a,b].every(q=>R.dot(R.vec(q,stemOrigin),u).n<=0n);}),upperRight=normalized.ring.findIndex((p,i)=>{
   const a=p.map(R.exact),b=normalized.ring[(i+1)%8].map(R.exact);return R.dot(R.vec(b,a),v).n===0n&&R.cmp(R.dot(a,v),R.dot(add(barOrigin,scale(v,barHeight)),v))===0&&
    R.cmp(R.dot(R.vec(a,stemOrigin),u),stemWidth)>=0;});
 const owner=(edge,a,b,role)=>{if(edge<0)throw Error('original source bank required');const p=normalized.ring[edge].map(R.exact),d=R.vec(normalized.ring[(edge+1)%8].map(R.exact),p),t=q=>R.div(R.dot(R.vec(q,p),d),R.dot(d,d));
  return mapInterval([normalized],[source],{ring:0,edge,exactU0:R.str(t(a)),exactU1:R.str(t(b))}).map(q=>({...q,role,bankGroup:'independent-source-course'}));};
 const commands=[],courses=[],phases=[],joins=[],events=[],originalNominalSkeleton=[],flatReserve=R.zero,flatPeak=R.mul(w,R.rat(5n,4n));
 let component=0;
 const push=(a,b,w0,w1,role,depth,edge,phase=null)=>{if(same(a,b))return;if(redistributeLower(a,b,w0,w1,role,depth,edge,phase))return;commands.push({exactFrom:a.map(R.str),exactTo:b.map(R.str),exactWidthStart:R.str(w0),exactWidthEnd:R.str(w1),role,component,depth,
   sourceIntervals:role.startsWith('stem-')&&role!=='stem-cap'?[]:owner(edge,a,b,'original-finite-'+role),phase});};

 function redistributeLower(a,b,w0,w1,role,depth,edge,phase){
  if(phase||depth!==2||role!=='bar-lower'||R.cmp(w0,w)!==0||R.cmp(w1,w)!==0)return false;
  const middle=R.add(R.dot(R.vec(stemOrigin,barOrigin),u),R.div(stemWidth,R.rat(2n))),xA=R.dot(R.vec(a,barOrigin),u),xB=R.dot(R.vec(b,barOrigin),u),
   xs=[2,1,0,-1,-2].map(k=>R.add(middle,R.mul(w,R.rat(BigInt(k)))));
  if(R.cmp(xA,xs[0])<=0||R.cmp(xB,xs[4])>=0)return false;
  const atWidth=(x,width)=>at(barOrigin,x,R.add(R.mul(w,R.rat(2n)),R.div(width,R.rat(2n)))),
   barWidths=[w,R.mul(w,R.exact(central.barLow)),R.mul(w,R.exact(central.barPeak)),R.mul(w,R.exact(central.barLow)),w],
   widths=barWidths.map(q=>R.sub(R.mul(w,R.rat(3n,2n)),R.div(q,R.rat(2n)))),N=20;
  push(a,atWidth(xs[0],w),w,w,role,depth,edge);
  for(let i=0;i<4;i++){const pts=[],desired=[];for(let j=0;j<=N;j++){const t=R.rat(BigInt(j),BigInt(N)),s=R.sub(R.mul(R.rat(3n),R.mul(t,t)),R.mul(R.rat(2n),R.mul(R.mul(t,t),t))),d=R.add(widths[i],R.mul(R.sub(widths[i+1],widths[i]),s));
    pts.push(atWidth(R.add(xs[i],R.mul(R.sub(xs[i+1],xs[i]),t)),d));desired.push(d);}
 const exactWidths=pts.map((p,j)=>{if(j===0||j===N)return desired[j];let f;for(const k of [j-1,j]){const axis=R.vec(pts[k+1],pts[k]),q=ratioRoot(axis,u);f=f?A.min(f,q):q;}return R.mul(desired[j],f);}),id='width-'+phases.length;
   phases.push({id,kind:'source-complementary-lower-bank-profile',exactLengthLowerMM:R.str(w),minimumLengthW:true,exactWidthStart:R.str(widths[i]),exactWidthEnd:R.str(widths[i+1]),samples:N,
    necessity:'the unchanged mandatory source slab between y=2W and the straight central bead lower front; complement fixed before emission, no source target removed'});
   const begin=commands.length;for(let j=1;j<=N;j++)push(pts[j-1],pts[j],exactWidths[j-1],exactWidths[j],role,depth,edge,id);
   for(let j=begin;j<commands.length;j++){commands[j].flatFrontBlend=true;commands[j].flatFront={exactInward:scale(v,R.rat(-1n)).map(R.str),exactOffset:R.str(R.dot(at(barOrigin,R.zero,R.mul(w,R.rat(2n))),scale(v,R.rat(-1n))))};}
  }
  push(atWidth(xs[4],w),b,w,w,role,depth,edge);return true;
 }
 const topStroke=(a,b,w0,w1,role,depth,phase)=>{if(same(a,b))return;
  const axis=R.vec(b,a),len2=R.dot(axis,axis),cuts=[R.zero,R.one];
  for(const q of [stemOrigin,add(stemOrigin,scale(u,stemWidth))]){const t=R.div(R.dot(R.vec(q,a),u),R.dot(axis,u));if(R.cmp(t,R.zero)>0&&R.cmp(t,R.one)<0)cuts.push(t);}
  cuts.sort(R.cmp);for(let i=1;i<cuts.length;i++){const from=add(a,scale(axis,cuts[i-1])),to=add(a,scale(axis,cuts[i])),mid=add(a,scale(axis,R.div(R.add(cuts[i-1],cuts[i]),R.rat(2n)))),x=R.dot(R.vec(mid,stemOrigin),u),edge=x.n<0n?upperLeft:R.cmp(x,stemWidth)>0?upperRight:bottom,
    width=t=>R.add(w0,R.mul(R.sub(w1,w0),t));push(from,to,width(cuts[i-1]),width(cuts[i]),role,depth,edge,phase);}
 };
 function stroke(a,b,start,end,role,depth,edge){
  const d=R.vec(b,a),dir=unit(d),length=R.dot(d,dir),xs=[{p:a,width:start}],begin=R.cmp(start,w)>0,finish=R.cmp(end,w)>0;
  if(R.cmp(length,R.mul(w,R.rat(BigInt(Number(begin)+Number(finish)))))<0)throw Error('ordinary W-long phases do not fit source course');
  if(begin)xs.push({p:add(a,scale(dir,w)),width:w});if(finish)xs.push({p:add(b,scale(dir,R.sub(R.zero,w))),width:w});xs.push({p:b,width:end});
  for(let i=1;i<xs.length;i++){const from=xs[i-1],to=xs[i];if(same(from.p,to.p))continue;const phase=R.cmp(from.width,to.width)!==0?'width-'+phases.length:null;
   if(phase)phases.push({id:phase,exactFrom:from.p.map(R.str),exactTo:to.p.map(R.str),exactLengthMM:R.str(R.dot(R.vec(to.p,from.p),dir)),exactWidthStart:R.str(from.width),exactWidthEnd:R.str(to.width),minimumLengthW:true,
    necessity:'complete source-defined half-W corner cell requires a radius at least sqrt(2)W/2; nominal W cannot cover its far corner'});
   if(role==='bar-upper')topStroke(from.p,to.p,from.width,to.width,role,depth,phase);else push(from.p,to.p,from.width,to.width,role,depth,edge,phase);
  }
 }
 function flatStroke(a,b,start,end,role,depth,edge,inward,front){
  const strokeBegin=commands.length;
  const axis=R.vec(b,a),long=unit(axis.map((q,k)=>inward[k].n?R.zero:q)),length=R.dot(axis,long),N=20,
   at=(anchor,t,desired)=>add(add(anchor,scale(long,R.mul(w,t))),scale(inward,R.sub(R.sub(front,R.div(desired,R.rat(2n))),R.dot(anchor,inward)))),
   variableStart=R.cmp(start,w)>0,variableEnd=R.cmp(end,w)>0;
  if(R.cmp(length,R.mul(w,R.rat(BigInt(Number(variableStart)+Number(variableEnd)))))<0)throw Error('flat-front W phases do not fit');
  let constantFrom=a;
  const phase=(anchor,increasing)=>{const pts=[],desired=[];
   for(let j=0;j<=N;j++){const t=R.rat(BigInt(j),BigInt(N)),t2=R.mul(t,t),t3=R.mul(t2,t),smooth=R.sub(R.mul(R.rat(3n),t2),R.mul(R.rat(2n),t3)),s=increasing?smooth:R.sub(R.one,smooth),width=R.add(w,R.mul(R.sub(flatPeak,w),s));
    pts.push(at(anchor,t,width));desired.push(width);}
   const widths=pts.map((p,i)=>{if(i===0||i===N)return desired[i];let factor;
    for(const j of[i-1,i]){const d=R.vec(pts[j+1],pts[j]),q=ratioRoot(d,long);factor=factor?A.min(factor,q):q;}
    return R.mul(desired[i],factor);});
   if(widths.some((q,i)=>i&&(increasing?R.cmp(q,widths[i-1])<0:R.cmp(q,widths[i-1])>0)))throw Error('flat-front phase monotonicity');
   const id='width-'+phases.length;phases.push({id,kind:'source-flat-front-smooth-profile',exactFrom:pts[0].map(R.str),exactTo:pts[N].map(R.str),exactLengthLowerMM:R.str(w),minimumLengthW:true,
    exactWidthStart:R.str(widths[0]),exactWidthEnd:R.str(widths[N]),samples:N,completeAnalyticApproximationUpperMM:R.str(R.mul(w,R.add(R.rat(43n,160n*BigInt(N)),R.rat(9n,32n*BigInt(N*N))))),
    necessity:'original corner cells need widening; the source-prescribed flat interior front keeps a nominal W central restart separate; one monotone phase, vertical/longitudinal displacement W'});
   for(let j=1;j<pts.length;j++){const before=commands.length;if(role==='bar-upper')topStroke(pts[j-1],pts[j],widths[j-1],widths[j],role,depth,id);else push(pts[j-1],pts[j],widths[j-1],widths[j],role,depth,edge,id);
    for(let k=before;k<commands.length;k++)commands[k].flatFrontBlend=true;}
   return pts[N];
  };
  if(variableStart)constantFrom=phase(a,false);
  const beforeEnd=variableEnd?add(b,scale(long,R.sub(R.zero,w))):b;
  if(!same(constantFrom,beforeEnd)){const p=add(beforeEnd,scale(inward,R.sub(R.sub(front,R.div(w,R.rat(2n))),R.dot(beforeEnd,inward))));
   if(role==='bar-upper')topStroke(constantFrom,p,w,w,role,depth,null);else push(constantFrom,p,w,w,role,depth,edge);constantFrom=p;}
  if(variableEnd)phase(constantFrom,true);
  for(let k=strokeBegin;k<commands.length;k++)commands[k].flatFront={exactInward:inward.map(R.str),exactOffset:R.str(front)};
 }
 function sourceCorner(vertex){return rounded.corners.find(c=>same(P(c.exactVertex),vertex));}
 function join(p,basis,depth,originalVertex,adaptive,referencePivot=p,workingPeak=peak){const c=sourceCorner(originalVertex);if(!c)throw Error('original convex corner identity required');
  const radius=adaptive?R.div(workingPeak,R.rat(2n)):h,required=adaptive?[referencePivot,add(referencePivot,scale(basis[0],h)),add(add(referencePivot,scale(basis[0],h)),scale(basis[1],h)),add(referencePivot,scale(basis[1],h))].map(p=>p.map(R.str)):null;
  joins.push({exactCentre:p.map(R.str),exactRadius:R.str(radius),exactBasis:basis.map(q=>q.map(R.str)),depth,component,sourceIntervals:structuredClone(c.sourceIntervals),originalVertex:c.originalVertex,
   originalCanonicalVertex:c.canonicalVertex,adaptive,independentRequiredCornerCell:required,independentOriginalNominalPivot:referencePivot.map(R.str),rule:adaptive?'needed interior source corner cell with W-long width phases; original cell retained under flat-front redistribution':'confirmed original exterior nominal-W round join, radius W/2'});
 }

 if(bars.length!==7||stems.length!==7)throw Error('connected T currently requires seven nominal W rows on both branches');
 const oldAt=(x,y)=>at(barOrigin,x,y),outerVertices=[barOrigin,add(barOrigin,scale(v,barHeight)),add(stemOrigin,scale(v,stemHeight)),
  add(add(stemOrigin,scale(u,stemWidth)),scale(v,stemHeight)),add(add(barOrigin,scale(u,barWidth)),scale(v,barHeight)),add(barOrigin,scale(u,barWidth))],
  sourceRootLeft=stemOrigin,sourceRootRight=add(stemOrigin,scale(u,stemWidth));
 function cornerSources(vertex,reach){const id=normalized.ring.findIndex(q=>same(q.map(R.exact),vertex));if(id<0)throw Error('original concave corner required');const out=[];
  for(const edge of [(id+7)%8,id]){const a=normalized.ring[edge].map(R.exact),b=normalized.ring[(edge+1)%8].map(R.exact),d=R.vec(b,a),length=A.abs(d[d[0].n?0:1]),t=R.div(R.dot(R.vec(vertex,a),d),R.dot(d,d)),r=R.div(reach,length);
   if(R.cmp(r,R.one)>0)throw Error('finite original concave neighbourhood required');
   out.push(...mapInterval([normalized],[source],{ring:0,edge,exactU0:R.str(t),exactU1:R.str(t.n?R.sub(R.one,r):r)}).map(q=>({...q,role:'original-concave-source-offset-allocation',bankGroup:'source-concave-'+id})));}
  return out;
 }
 function assignStemOwnership(first,edge,neighbourhood,opposite=null){
  const batch=commands.splice(first),root=R.dot(stemOrigin,v);
  for(const q of batch){const a=P(q.exactFrom),b=P(q.exactTo),aa=R.dot(a,v),bb=R.dot(b,v),cuts=[R.zero,R.one];
   if(R.cmp(aa,root)*R.cmp(bb,root)<0)cuts.splice(1,0,R.div(R.sub(root,aa),R.sub(bb,aa)));
   for(let i=1;i<cuts.length;i++){const point=t=>add(a,scale(R.vec(b,a),t)),A0=point(cuts[i-1]),B0=point(cuts[i]),
     width=t=>R.add(R.parse(q.exactWidthStart),R.mul(R.sub(R.parse(q.exactWidthEnd),R.parse(q.exactWidthStart)),t)),
     above=R.cmp(R.dot(add(A0,B0),v),R.mul(root,R.rat(2n)))>=0;
    commands.push({...q,exactFrom:A0.map(R.str),exactTo:B0.map(R.str),exactWidthStart:R.str(width(cuts[i-1])),exactWidthEnd:R.str(width(cuts[i])),
     sourceIntervals:above?owner(edge,A0,B0,'original-finite-stem-body').concat(opposite===null?[]:owner(opposite,A0,B0,'original-finite-opposite-stem-body')):structuredClone(neighbourhood)});
   }
  }
 }
 // Original finite concave bank neighbourhoods, not clamped projections of
 // an extended stem bank. The layer planner fixes each reach before emission.
 const basePush=push;
 function bankStroke(a,b,p0,p1,role,depth,edge){stroke(a,b,p0,p1,role,depth,edge);}
 function dual(a,b,p0,p1,oldA,oldB,role,depth,edge,n0,F0,n1,F1){const axis=unit(R.vec(oldB,oldA)),first=R.cmp(p0,w)>0,last=R.cmp(p1,w)>0,
   toNormal=(p,old,n)=>add(p,scale(n,R.sub(R.dot(old,n),R.dot(p,n)))),A=first?toNormal(add(a,scale(axis,w)),oldA,n0):a,
   B=last?toNormal(add(b,scale(axis,R.sub(R.zero,w))),oldB,n1):b;
  if(first){if(R.cmp(p0,flatPeak)>0)stroke(a,A,p0,w,role,depth,edge);else flatStroke(a,A,p0,w,role,depth,edge,n0,F0);}
  if(!same(A,B)){if(role==='bar-upper')topStroke(A,B,w,w,role,depth,null);else push(A,B,w,w,role,depth,edge);}
  if(last){if(R.cmp(p1,flatPeak)>0)stroke(B,b,w,p1,role,depth,edge);else flatStroke(B,b,w,p1,role,depth,edge,n1,F1);}
 }
 for(let depth=0;depth<3;depth++){
  const d=R.mul(w,R.rat(BigInt(depth))),o=R.add(d,h),x0=o,x1=R.sub(barWidth,o),y0=o,y1=R.sub(barHeight,o),xl=R.add(R.dot(R.vec(stemOrigin,barOrigin),u),o),xr=R.sub(R.add(R.dot(R.vec(stemOrigin,barOrigin),u),stemWidth),o),yt=R.sub(R.add(barHeight,stemHeight),o),
   old=[oldAt(x0,y0),oldAt(x0,y1),oldAt(xl,y1),oldAt(xl,yt),oldAt(xr,yt),oldAt(xr,y1),oldAt(x1,y1),oldAt(x1,y0)],
   bases=[[scale(u,R.rat(-1n)),scale(v,R.rat(-1n))],[scale(u,R.rat(-1n)),v],[u,scale(v,R.rat(-1n))],[scale(u,R.rat(-1n)),v],[u,v],[scale(u,R.rat(-1n)),scale(v,R.rat(-1n))],[u,v],[u,scale(v,R.rat(-1n))]],
   vertices=[outerVertices[0],outerVertices[1],sourceRootLeft,outerVertices[2],outerVertices[3],sourceRootRight,outerVertices[4],outerVertices[5]],
   flat=depth===2,widths=old.map((_,i)=>i===2||i===5||flat?flatPeak:depth?peak:w),
   heads=old.map((p,i)=>i===2||i===5||flat?add(p,scale(add(...bases[i]),R.div(R.sub(flatPeak,w),R.rat(2n)))):p),
   seam=oldAt(R.add(x0,R.mul(w,R.rat(6n))),y0),begin=commands.length,reach=R.mul(w,R.rat(BigInt(depth+1)));
  originalNominalSkeleton.push(...old.map((a,i)=>({from:a.map(R.str),to:old[(i+1)%8].map(R.str)})));
  // All root-extension command ownership is a source-defined finite L-bank
  // neighbourhood. The unchanged source topology, normals and widths decide it.
  const stemBefore=commands.length,sourceSides=[cornerSources(sourceRootLeft,reach),cornerSources(sourceRootRight,reach)];
  if(flat){const inward=v,F=R.dot(oldAt(R.zero,R.add(d,w)),inward);dual(seam,heads[0],w,widths[0],seam,old[0],'bar-lower',depth,bottom,inward,F,inward,F);
   const left=u,FL=R.dot(oldAt(R.add(d,w),R.zero),left);dual(heads[0],heads[1],widths[0],widths[1],old[0],old[1],'bar-left-cap',depth,leftCap,left,FL,left,FL);
  }else{bankStroke(seam,heads[0],w,widths[0],'bar-lower',depth,bottom);bankStroke(heads[0],heads[1],widths[0],widths[1],'bar-left-cap',depth,leftCap);}
  const down=scale(v,R.rat(-1n)),upperInner=R.dot(oldAt(R.zero,R.sub(barHeight,R.add(d,w))),down),upperOuter=R.dot(oldAt(R.zero,R.sub(barHeight,d)),v);
  dual(heads[1],heads[2],widths[1],widths[2],old[1],old[2],'bar-upper',depth,upperLeft,flat?down:v,flat?upperInner:upperOuter,v,upperOuter);
  let n=commands.length;dual(heads[2],heads[3],widths[2],widths[3],old[2],old[3],'stem-left',depth,leftStem,scale(u,R.rat(-1n)),R.dot(oldAt(R.sub(xl,h),R.zero),scale(u,R.rat(-1n))),
   flat?u:scale(u,R.rat(-1n)),R.dot(oldAt(flat?R.add(xl,h):R.sub(xl,h),R.zero),flat?u:scale(u,R.rat(-1n))));
  assignStemOwnership(n,leftStem,sourceSides[0]);
  if(flat){const topDown=scale(v,R.rat(-1n)),F=R.dot(oldAt(R.zero,R.sub(yt,h)),topDown);dual(heads[3],heads[4],widths[3],widths[4],old[3],old[4],'stem-cap',depth,topStem,topDown,F,topDown,F);}
  else bankStroke(heads[3],heads[4],widths[3],widths[4],'stem-cap',depth,topStem);
  n=commands.length;dual(heads[4],heads[5],widths[4],widths[5],old[4],old[5],'stem-right',depth,rightStem,flat?scale(u,R.rat(-1n)):u,R.dot(oldAt(flat?R.sub(xr,h):R.add(xr,h),R.zero),flat?scale(u,R.rat(-1n)):u),u,R.dot(oldAt(R.add(xr,h),R.zero),u));
  assignStemOwnership(n,rightStem,sourceSides[1]);
  dual(heads[5],heads[6],widths[5],widths[6],old[5],old[6],'bar-upper',depth,upperRight,v,upperOuter,flat?down:v,flat?upperInner:upperOuter);
  if(flat){const right=scale(u,R.rat(-1n)),FR=R.dot(oldAt(R.sub(barWidth,R.add(d,w)),R.zero),right),bottomIn=v,FB=R.dot(oldAt(R.zero,R.add(d,w)),bottomIn);
   dual(heads[6],heads[7],widths[6],widths[7],old[6],old[7],'bar-right-cap',depth,rightCap,right,FR,right,FR);
   dual(heads[7],seam,widths[7],w,old[7],seam,'bar-lower',depth,bottom,bottomIn,FB,bottomIn,FB);
  }else{bankStroke(heads[6],heads[7],widths[6],widths[7],'bar-right-cap',depth,rightCap);bankStroke(heads[7],seam,widths[7],w,'bar-lower',depth,bottom);}
  const end=commands.length;push(seam,add(seam,scale(u,R.sub(R.zero,h))),w,w,'source-owned-half-W-closure',depth,bottom);
  courses.push({component,depth,startCommand:begin,endCommand:commands.length,closed:true,start:seam.map(R.str),end:commands.at(-1).exactTo,sourceBoundaryClockwise:true,terminalOverrunMM:.5*W});
  events.push({kind:'same-width-source-owned-closure',component,commandFrom:end,commandTo:commands.length,limitExactMM2:R.str(R.mul(w,h)),scope:'whole final connected T banks and turns, coupled source closure'});
  for(let i=0;i<8;i++){
   if(i===2||i===5){const required=[old[i],add(old[i],scale(bases[i][0],h)),add(add(old[i],scale(bases[i][0],h)),scale(bases[i][1],h)),add(old[i],scale(bases[i][1],h))];
    joins.push({exactCentre:heads[i].map(R.str),exactRadius:R.str(R.div(flatPeak,R.rat(2n))),exactBasis:bases[i].map(p=>p.map(R.str)),depth,component,sourceIntervals:sourceSides[i===2?0:1],originalVertex:normalized.sourceVertices[normalized.ring.findIndex(p=>same(p.map(R.exact),vertices[i]))],originalCanonicalVertex:normalized.ring.findIndex(p=>same(p.map(R.exact),vertices[i])),adaptive:true,independentRequiredCornerCell:required.map(p=>p.map(R.str)),independentOriginalNominalPivot:old[i].map(R.str),rule:'source concave quarter-cell retained under necessary flat-front widening'});
   }else join(heads[i],bases[i],depth,vertices[i],depth!==0,old[i],widths[i]);
  }
  component++;
 }

 const d=R.mul(w,R.rat(3n)),barY=R.add(d,h),barA=oldAt(R.sub(barWidth,d),barY),barB=oldAt(d,barY),barBegin=commands.length,
  middle=R.add(R.dot(R.vec(stemOrigin,barOrigin),u),R.div(stemWidth,R.rat(2n))),lowWidth=R.mul(w,R.exact(central.barLow)),centrePeak=R.mul(w,R.exact(central.barPeak)),bottomLevel=d,N=20;
 function centreAt(x,width){return oldAt(x,barY);}
 function centrePhase(x0,x1,w0,w1){const points=[],desired=[],inward=scale(v,R.rat(-1n)),front=R.dot(oldAt(R.zero,bottomLevel),inward);
  for(let j=0;j<=N;j++){const t=R.rat(BigInt(j),BigInt(N)),smooth=R.sub(R.mul(R.rat(3n),R.mul(t,t)),R.mul(R.rat(2n),R.mul(R.mul(t,t),t))),width=R.add(w0,R.mul(R.sub(w1,w0),smooth));
   points.push(centreAt(R.add(x0,R.mul(R.sub(x1,x0),t)),width));desired.push(width);}
  const widths=points.map((p,i)=>{if(i===0||i===N)return desired[i];let factor;for(const j of [i-1,i]){const axis=R.vec(points[j+1],points[j]),length=A.sqrtBounds(R.dot(axis,axis))[0],q=R.div(length,A.abs(R.dot(axis,u)));factor=factor?A.min(factor,q):q;}return desired[i];}),
   id='width-'+phases.length;
  phases.push({id,kind:'source-prescribed-central-flat-bottom-profile',exactLengthLowerMM:R.str(w),minimumLengthW:true,exactWidthStart:R.str(w0),exactWidthEnd:R.str(w1),samples:N,
   necessity:'source joint free span is only .75W at the old concave radius minimum; central W phases and the .8W stem interface require a source-planned medial peak, not an independent overlap restart'});
  const first=commands.length;for(let j=1;j<=N;j++)push(points[j-1],points[j],widths[j-1],widths[j],'bar-central-adaptive',3,bottom,id);
  // The central axis is straight; variable-width ribbons share exact normal cross-sections. No phase bevel or independent cap is emitted.
 }
 const xs=[2,1,0,-1,-2].map(k=>R.add(middle,R.mul(w,R.add(R.rat(BigInt(k)),R.exact(central.barLead)))));
 push(barA,centreAt(xs[0],w),w,w,'bar-central-start',3,bottom);
 for(let i=0;i<4;i++)centrePhase(xs[i],xs[i+1],[w,lowWidth,centrePeak,lowWidth][i],[lowWidth,centrePeak,lowWidth,w][i]);
 push(centreAt(xs[4],w),barB,w,w,'bar-central-stop',3,bottom);
 originalNominalSkeleton.push({from:barA.map(R.str),to:barB.map(R.str)});
 courses.push({component,depth:3,startCommand:barBegin,endCommand:commands.length,closed:false,start:barA.map(R.str),end:barB.map(R.str),terminalOverrunMM:0});component++;
 const stemA=oldAt(middle,R.sub(R.add(barHeight,stemHeight),d)),stemB=oldAt(middle,R.mul(w,R.exact(central.stemStop))),stemBegin=commands.length,stemNarrow=R.mul(w,R.exact(central.stemWidth)),
  phaseStart=oldAt(middle,R.mul(w,R.rat(345n,64n))),phaseEnd=oldAt(middle,R.mul(w,R.rat(281n,64n))),stemSources=cornerSources(sourceRootLeft,R.mul(w,R.rat(4n))).concat(cornerSources(sourceRootRight,R.mul(w,R.rat(4n))));
 function stemPush(a,b,w0,w1,role,phase=null){const index=commands.length;push(a,b,w0,w1,role,3,leftStem,phase);assignStemOwnership(index,leftStem,stemSources,rightStem);}
 stemPush(stemA,phaseStart,w,w,'stem-central-start');const id='width-'+phases.length;
 phases.push({id,kind:'source-central-stem-contraction',exactLengthMM:R.str(w),exactWidthStart:R.str(w),exactWidthEnd:R.str(stemNarrow),minimumLengthW:true,
  necessity:'the prescribed neighbouring root fronts leave less than W of free transverse material; contraction starts only after the disjoint W start'});
 stemPush(phaseStart,phaseEnd,w,stemNarrow,'stem-central-contraction',id);stemPush(phaseEnd,stemB,stemNarrow,stemNarrow,'stem-central-joint-stop');
 originalNominalSkeleton.push({from:stemA.map(R.str),to:oldAt(middle,R.add(d,w)).map(R.str)});
 courses.push({component,depth:3,startCommand:stemBegin,endCommand:commands.length,closed:false,start:stemA.map(R.str),end:stemB.map(R.str),terminalOverrunMM:0});component++;
 events.push({kind:'coupled-source-central-T-allocation',eventCommands:Array.from({length:commands.length-barBegin},(_,i)=>barBegin+i),commandFrom:barBegin,commandTo:commands.length,
  limitExactMM2:R.str(R.mul(w,h)),scope:'all central bar/stem ribbons, phase bevels, both terminal contacts and all final older/widened T banks; one shared ceiling'});
 const originalRequiredTiles=[];
 for(const [left,right,low,high]of [[R.zero,barWidth,R.zero,barHeight],[R.dot(R.vec(stemOrigin,barOrigin),u),R.add(R.dot(R.vec(stemOrigin,barOrigin),u),stemWidth),barHeight,R.add(barHeight,stemHeight)]]){
  if(buildSourceTiles)for(let x=left;R.cmp(x,right)<0;x=R.add(x,w))for(let y=low;R.cmp(y,high)<0;y=R.add(y,w)){
   if(originalRequiredTiles.length>=512)throw Error('bounded independently source-tiled connected T required');const xx=A.min(R.add(x,w),right),yy=A.min(R.add(y,w),high);
   originalRequiredTiles.push([[x,y],[xx,y],[xx,yy],[x,yy]].map(p=>oldAt(...p).map(R.str)));
  }
 }
 return{source:structuredClone(source),W,count,body,rounded,commands,courses,phases,joins,events,originalNominalSkeleton,originalRequiredTiles,barRows:bars.length,stemRows:stems.length,
  rules:{sourceGeometryUnchanged:true,sourcePlanBeforeEmission:true,ordinaryWidth:W,maxWidthExact:R.str(peak),widthNecessityIndependent:false,minimumWidthPhaseLength:W,
   exteriorCornerExceptionsOnly:true,ordinaryIntersectionsHaveNoGlobalHalfW2Ceiling:true,explicitEventCeilingExactMM2:R.str(R.mul(w,h))}};
}
function proveRequiredMaterial(plan,all,e,signal){
 const sourceTiles=createExactCells(plan.originalRequiredTiles),tileTarget=sourceTiles.difference(plan.originalRequiredTiles,plan.rounded.corners.map(q=>q.exactSquare)),target={missingFragments:tileTarget.cells},
  offsets=[[e,R.zero],[R.sub(R.zero,e),R.zero],[R.zero,e],[R.zero,R.sub(R.zero,e)]],
  expanded=all.map(p=>hull(p.map(q=>q.map(R.exact)).flatMap(q=>offsets.map(d=>add(q,d))))),cells=createExactCells(expanded,{maxCells:1536}),remaining=cells.difference(target.missingFragments,expanded,{signal,order:'bbox-largest-first'}),failures=remaining.cells.length?[{uncoveredFragments:remaining.cells.length,exactFragments:remaining.cells.map(p=>p.map(q=>q.map(R.str)))}]:[];
 const exterior=plan.joins.filter(q=>!q.adaptive),exteriorIdentity=exterior.length===plan.rounded.corners.length&&exterior.every(q=>{
  const r=plan.rounded.corners.find(p=>p.canonicalVertex===q.originalCanonicalVertex);return r&&same(P(r.exactCentre),P(q.exactCentre))&&R.cmp(R.parse(q.exactRadius),R.div(R.exact(plan.W),R.rat(2n)))===0;
 });
 return{covered:!failures.length&&exteriorIdentity,errorRadiusExact:e,serializable:{covered:!failures.length&&exteriorIdentity,cellsChecked:target.missingFragments.length,
  failures,work:remaining.work,exactErrorNeighborhoodRadiusMM:R.str(e),originalExteriorSectorIdentity:exteriorIdentity,
  sourceTarget:'unchanged C minus six independently source-derived outer half-W squares, plus their original prescribed analytic quarterdisks; no adaptive corner cell or missing region removed',
  proof:'complete convex source-cell subtraction against full emitted polygon union expanded by rational L1 diamond inside Euclidean error disk; exterior disks independently bounded by complete analytic sag reserve',
  fullPhysicalFlowValidated:false}};
}
function createTRedistributedCentralCourses(){const c=load('optimized-worker.js').context;return{generate({source,W=1,count=7,signal,includeMultiplicity=false,includeExactMissingArea=false,onStage,onProfile,eventOnly=false,runtimeOnly=false,sharedLedger=false,centralPolicy={}}){
 let profileTime=performance.now();const mark=name=>{const now=performance.now();onProfile?.({name,ms:now-profileTime});profileTime=now;};
 if(signal?.aborted)throw Error('reopened T cancelled');const plan=planTRedistributedCentralCourses(source,W,count,centralPolicy,!runtimeOnly),w=R.exact(W),commands=plan.commands.map(q=>({...q,kind:'print',from:P(q.exactFrom).map(R.number),to:P(q.exactTo).map(R.number),widthStart:ceilNumber(R.parse(q.exactWidthStart)),widthEnd:ceilNumber(R.parse(q.exactWidthEnd))}));mark('source plan and finite command conversion');
 // Correct finite width representation, not the restart predicate. Incident
 // cells share one vertex width and must obey the independent plane exactly.
 const vertices=new Map(),bits=new DataView(new ArrayBuffer(8)),down=x=>{if(!x)return-Number.MIN_VALUE;bits.setFloat64(0,x,false);bits.setBigUint64(0,bits.getBigUint64(0,false)+(x>0?-1n:1n),false);return bits.getFloat64(0,false);},floor=q=>{let n=R.number(q);for(let i=0;i<8&&R.cmp(R.exact(n),q)>0;i++)n=down(n);if(!Number.isFinite(n)||R.cmp(R.exact(n),q)>0)throw Error('finite directed width bound required');return n;};
 for(const q of commands)for(const [point,key]of [[q.exactFrom,'widthStart'],[q.exactTo,'widthEnd']]){const id=q.component+':'+point.join(',');if(!vertices.has(id))vertices.set(id,[]);vertices.get(id).push({q,key});}
 for(const refs of vertices.values())if(refs.some(r=>r.q.flatFront)){
  let width=Math.min(...refs.map(r=>r.q[r.key]));
  refs.forEach(r=>r.q[r.key]=width);if(!refs.some(({q,key})=>{if(!q.flatFront)return false;const cell=c.frameThroughNeckRibbon(q.from,q.to,q.widthStart,q.widthEnd);return(key==='widthStart'?[cell[0],cell[3]]:[cell[1],cell[2]]).some(p=>R.cmp(R.dot(p.map(R.exact),P(q.flatFront.exactInward)),R.parse(q.flatFront.exactOffset))>0);}))continue;
  // Solve against the ACTUAL finite normal once. Linear ULP stepping alone
  // scales badly with world coordinates. The reserve is charged by the all-
  // point construction certificate and grants no tolerance outside the plane.
  for(const{q,key}of refs)if(q.flatFront){const dx=q.to[0]-q.from[0],dy=q.to[1]-q.from[1],L=Math.hypot(dx,dy),n=[-dy/L,dx/L].map(R.exact),plane=P(q.flatFront.exactInward),coefficient=A.abs(R.dot(n,plane)),anchor=(key==='widthStart'?q.from:q.to).map(R.exact);if(coefficient.n){const offset=R.parse(q.flatFront.exactOffset),safe=R.exact(down(down(down(floor(offset))))),limit=R.div(R.mul(R.rat(2n),R.sub(safe,R.dot(anchor,plane))),coefficient);width=Math.min(width,floor(limit));}}
  for(let k=0;k<8;k++){refs.forEach(r=>r.q[r.key]=width);const bad=refs.some(({q,key})=>{if(!q.flatFront)return false;const cell=c.frameThroughNeckRibbon(q.from,q.to,q.widthStart,q.widthEnd);
   return (key==='widthStart'?[cell[0],cell[3]]:[cell[1],cell[2]]).some(p=>R.cmp(R.dot(p.map(R.exact),P(q.flatFront.exactInward)),R.parse(q.flatFront.exactOffset))>0);});if(!bad)break;
   width=down(width);if(R.cmp(R.exact(width),R.mul(w,R.rat(3n,5n)))<0||k===7)throw Error('strict finite flat-front representation unavailable at nominal width');}
  if(R.cmp(R.exact(width),R.mul(w,R.rat(3n,5n)))<0)throw Error('finite flat-front width fell below prescribed limit');
 }
 mark('shared finite width plane guards');
 if(runtimeOnly){const ends=new Map();commands.forEach((q,i)=>{const key=q.component+':'+q.exactTo.join(',');if(!ends.has(key))ends.set(key,[]);ends.get(key).push(i);});
  const cornerJoins=plan.joins.map(q=>{const key=q.component+':'+q.exactCentre.join(','),ids=(ends.get(key)??[]).filter(i=>commands[i+1]?.component===q.component&&commands[i+1].exactFrom.join(',')===q.exactCentre.join(','));if(ids.length!==1)throw Error('one planned continuous turn required');return{...q,afterCommand:ids[0],exactPrescribedRadius:q.exactRadius,exactRadius:R.str(R.div(R.exact(commands[ids[0]].widthEnd),R.rat(2n)))};});
  return{kind:'source-T-runtime-construction-only',W,count,source:structuredClone(source),plan,commands,cornerJoins,completePrescribedMaterialConstructionCertified:false,ownerAccepted:false,selectedCommands:[],selectedExecution:[],scope:'fresh source emission only; all local material/source/ledger/protocol qualification is still required'};}
 const quads=commands.map(q=>c.frameThroughNeckRibbon(q.from,q.to,q.widthStart,q.widthEnd)),material=sourceCells(source);mark('actual ribbon cells');
 const proofs=eventOnly?[]:commands.map(q=>A.provePolylineTransform([q.exactFrom,q.exactTo],[q.from,q.to],[[0]],{referenceWidths:[q.exactWidthStart,q.exactWidthEnd],outputWidths:[q.widthStart,q.widthEnd],nozzleWidth:W})),construction=proofs.reduce((m,p)=>A.max(m,R.parse(p.exactUpperBound)),R.zero);mark('per-command complete transform proofs');
 const containment=eventOnly?[]:commands.map((q,i)=>({nozzle:c.frameThroughNeckExactClearance(q.from,q.to,source,W),feed:proveFeedInsideSource(quads[i],source,material)}));mark('whole command nozzle and feed guards');
 // Explicit 2D ROUND-JOIN footprints attached to actual continuous turns.
 // They are not extra printing moves or an invented widening of the nozzle.
 const footprints=[],joinEvidence=[];let joinBound=R.zero;
 for(const q of plan.joins){if(signal?.aborted)throw Error('reopened T cancelled');const centre=P(q.exactCentre),basis=q.exactBasis.map(P),r=R.parse(q.exactRadius),shrink=R.div(r,R.rat(1n<<32n)),radius=R.sub(r,shrink),points=[],exact=[];
  const course=plan.courses.find(p=>p.component===q.component),ids=Array.from({length:course.endCommand-course.startCommand-1},(_,i)=>i+course.startCommand).filter(i=>same(P(commands[i].exactTo),centre)&&same(P(commands[i+1].exactFrom),centre));
  if(ids.length!==1||!same(commands[ids[0]].to.map(R.exact),centre))throw Error('nominal rounded join must own one exact emitted continuous source turn');
  exact.push(centre);for(let j=0;j<=8;j++){const t=R.rat(BigInt(j),8n),t2=R.mul(t,t),den=R.add(R.one,t2),a=R.div(R.sub(R.one,t2),den),b=R.div(R.mul(R.rat(2n),t),den);
   exact.push(add(centre,scale(add(scale(basis[0],a),scale(basis[1],b)),radius)));}
  points.push(...exact.map(p=>p.map(R.number)));let representation=R.zero,sag=R.zero;
  exact.forEach((p,i)=>representation=A.max(representation,p.reduce((s,v,k)=>R.add(s,A.abs(R.sub(v,R.exact(points[i][k])))),R.zero)));
  if(R.cmp(representation,R.div(shrink,R.rat(2n)))>0)throw Error('bounded inward round-join representation unavailable');
  for(let j=1;j<exact.length-1;j++){const d=R.vec(exact[j+1],exact[j]),mid2=R.sub(R.mul(radius,radius),R.div(R.dot(d,d),R.rat(4n)));sag=A.max(sag,R.sub(radius,A.sqrtBounds(mid2)[0]));}
  const bound=R.add(shrink,R.add(sag,representation));joinBound=A.max(joinBound,bound);footprints.push(points);joinEvidence.push({...q,afterCommand:ids[0],polygon:points,
   exactSagUpperMM:R.str(sag),exactShrinkReserveMM:R.str(shrink),exactRepresentationUpperMM:R.str(representation),completeSectorConstructionUpperMM:R.str(bound),
   kind:'nominal-continuous-turn-round-join-2D-footprint',extraPrintCommands:0,nominalNozzleWidth:W,physicalDepositionValidated:false});
 }
 // A sampled flat-front phase has bevel joins between its command normals.
 // Only the outside wedge is additional to adjacent ribbons. A round disk at
 // each tessellation vertex would destroy the independently prescribed plane.
 mark('rounded turns including analytic error');const bevelEvidence=[];
 for(let i=0;i+1<commands.length;i++)if(commands[i].component===commands[i+1].component&&same(P(commands[i].exactTo),P(commands[i+1].exactFrom))&&
  (commands[i].flatFrontBlend||commands[i+1].flatFrontBlend)&&!joinEvidence.some(q=>q.afterCommand===i)){
  const incoming=R.vec(commands[i].to.map(R.exact),commands[i].from.map(R.exact)),outgoing=R.vec(commands[i+1].to.map(R.exact),commands[i+1].from.map(R.exact)),turn=R.cross(incoming,outgoing);
  if(!turn.n)continue;
  const side=turn.n>0n?-1:1,polygon=[commands[i].to,quads[i][side>0?1:2],quads[i+1][side>0?0:3]],p=hull(polygon.map(q=>q.map(R.exact))).map(q=>q.map(R.number));
  if(p.length<3)continue;footprints.push(p);bevelEvidence.push({afterCommand:i,component:commands[i].component,
   polygon:p,kind:'continuous-flat-front-phase-bevel-wedge',extraPrintCommands:0,sourceIntervals:structuredClone(commands[i].sourceIntervals.concat(commands[i+1].sourceIntervals))});
 }
 mark('actual continuous bevel cells');onStage?.('command cells and continuous joins');
 if(eventOnly){const auxiliary=joinEvidence.concat(bevelEvidence),finalCells=quads.map((polygon,i)=>({polygon,command:i,role:commands[i].role,component:commands[i].component,depth:commands[i].depth,sourceIntervals:commands[i].sourceIntervals}))
   .concat(auxiliary.map(q=>({polygon:q.polygon,command:q.afterCommand,role:q.kind,component:q.component,depth:commands[q.afterCommand].depth,sourceIntervals:q.sourceIntervals}))),
  eventIds=plan.events.map(event=>event.eventCommands??Array.from({length:event.commandTo-event.commandFrom},(_,i)=>event.commandFrom+i)),
  shared=sharedLedger?require('./T-shared-exact-ledger.cjs').sharedExactLedger(finalCells.map(q=>q.polygon),W,eventIds.map(ids=>({eventCellIds:finalCells.map((q,i)=>ids.includes(q.command)?i:-1).filter(i=>i>=0)})),{signal}):null,
  eventEvidence=plan.events.map((event,i)=>{const ids=eventIds[i],reference=finalCells.filter(q=>!ids.includes(q.command)),charge=shared?shared.events[i]:exactJointCharge(reference.map(q=>q.polygon),finalCells.map(q=>q.polygon),W,{maxWork:1000000});
   return{...event,allFinalBanksIncluded:true,eventCommandIds:ids,charge,eventPassed:charge.passed,areaLineage:charge.areas.map(p=>({...p,firstOwner:finalCells[p.first],secondOwner:finalCells[p.second]}))};});
  mark('all-final coupled event ledgers');return{kind:'source-T-exact-event-preflight-only',source:structuredClone(source),W,count,plan,commands,cornerJoins:joinEvidence,phaseBevels:bevelEvidence,eventEvidence,
   preflightOnly:true,completePrescribedMaterialConstructionCertified:false,ownerAccepted:false,routeAccepted:false,selectedCommands:[],selectedExecution:[],
   scope:'exact all-final coupled events only; whole material/source/nozzle/construction proof deliberately deferred, never route acceptance'};
 }

 const all=quads.concat(footprints),cells=createExactCells(all,{maxCells:1536}),original=cells.prepare(plan.rounded.originalMaterialCells),out=cells.difference(cells.cells,original,{signal}),
  outside={completeOriginalMaterialCovered:out.covered,missingOriginalAreaExactMM2:out.exactArea},missing=includeExactMissingArea?cells.difference(original,cells.cells,{signal}):null,violations=[];
 for(let i=0;i<cells.cells.length;i++)for(const q of plan.rounded.corners){const section=intersectConvexCells(cells.cells[i],q.exactSquare.map(P),{work:0,maxWork:1000000}),r=R.parse(q.exactRadius),centre=P(q.exactCentre);
  if(section.some(p=>R.cmp(R.dot(R.vec(p,centre),R.vec(p,centre)),R.mul(r,r))>0))violations.push({command:i,canonicalVertex:q.canonicalVertex});}
 const contained=out.covered&&!violations.length,E=plan.rounded.excludedAreaExactBoundsMM2.map(R.parse),area=missing?R.parse(missing.exactArea):null,rounded={actualCommandedPolygonsContainedInPrescribedMaterial:contained,
  outsideOriginalCAD:outside,cornerExclusionViolations:violations,originalCADMinusU:missing?{missingOriginalAreaExactMM2:missing.exactArea,completeOriginalMaterialCovered:missing.covered}:{computed:false,reason:'whole-point prescribed coverage certificate is used; exact tiny discretization-gap area inventory deferred'},
  prescribedMaterialMinusUExactAreaBoundsMM2:contained&&area?[R.str(R.sub(area,E[1])),R.str(R.sub(area,E[0]))]:null,physicalPrintValidated:false},
  nominal=plan.originalNominalSkeleton.map(q=>c.frameThroughNeckRibbon(P(q.from).map(R.number),P(q.to).map(R.number),W,W)),
  mandatoryCorners=plan.joins.filter(q=>q.adaptive).map(q=>q.independentRequiredCornerCell),outerSquares=plan.rounded.corners.map(q=>q.exactSquare),
  inventory=originalMaterialDifference(plan.rounded.originalMaterialCells,nominal.concat(mandatoryCorners.map(p=>p.map(q=>q.map(s=>R.number(R.parse(s))))),outerSquares)),
  auxiliary=joinEvidence.concat(bevelEvidence),prefix=end=>quads.slice(0,end).concat(auxiliary.filter(q=>q.afterCommand+1<end).map(q=>q.polygon)),
  finalCells=quads.map((polygon,i)=>({polygon,command:i,role:commands[i].role,component:commands[i].component,depth:commands[i].depth,sourceIntervals:commands[i].sourceIntervals})).concat(auxiliary.map(q=>({polygon:q.polygon,command:q.afterCommand,role:q.kind,component:q.component,depth:commands[q.afterCommand].depth,sourceIntervals:q.sourceIntervals}))),
  eventEvidence=plan.events.map(event=>{const ids=event.eventCommands??Array.from({length:event.commandTo-event.commandFrom},(_,i)=>event.commandFrom+i),eventCells=finalCells.filter(q=>ids.includes(q.command)),reference=finalCells.filter(q=>!ids.includes(q.command)),charge=exactJointCharge(reference.map(q=>q.polygon),finalCells.map(q=>q.polygon),W,{maxWork:1000000});
   return{...event,allFinalBanksIncluded:true,eventCommandIds:ids,charge,eventPassed:charge.passed,areaLineage:charge.areas.map(a=>({...a,firstOwner:finalCells[a.first],secondOwner:finalCells[a.second]}))};}),
  restartEvidence=plan.courses.filter(q=>q.component>0).map(course=>{const q=commands[course.startCommand],d=R.vec(P(q.exactTo),P(q.exactFrom)),length=A.sqrtBounds(R.dot(d,d));
   if(R.cmp(length[0],w)<0||q.widthStart!==W||q.widthEnd!==W)throw Error('internal restart requires a complete nominal-W first course segment');
   const t=R.div(w,length[1]),end=add(P(q.exactFrom),scale(d,t)).map(R.number),first=c.frameThroughNeckRibbon(q.from,end,W,W),prior=prefix(course.startCommand),charge=exactJointCharge(prior,prior.concat([first]),W,{maxWork:1000000});
   return{component:course.component,depth:course.depth,firstNominalWFeedStart:q.from,firstNominalWFeedEnd:end,charge,strictDisjoint:charge.chargeUpperBoundMM2===0,
    scope:'complete first nominal-W feed rectangle versus every previously emitted ribbon and continuous turn footprint; no independent end/start round-cap dose assumed'};}),
  flatBound=plan.phases.reduce((m,q)=>q.completeAnalyticApproximationUpperMM?A.max(m,R.parse(q.completeAnalyticApproximationUpperMM)):m,R.zero),
  materialProof=proveRequiredMaterial(plan,all,R.mul(w,R.rat(29n,2000n)),signal),
  accuracy=materialProof.covered&&inventory.completeOriginalMaterialCovered?A.certifyBudget(W,[{name:'complete source-planned axes/fixed nozzle/working widths to finite commands',verified:true,exactUpperBound:R.str(construction)},
   {name:'independent unchanged required material domains to full emitted cell union; whole cubic phases and analytic original corner sectors',verified:materialProof.covered&&inventory.completeOriginalMaterialCovered,
    exactUpperBound:R.str(R.add(A.max(materialProof.errorRadiusExact,R.add(flatBound,joinBound)),R.div(w,R.rat(1n<<31n))))}]):{accepted:false,reason:'independent complete material coverage failed',physicalPrintValidated:false};
 onStage?.('complete source material, coupled events and strict restart proof');
 const multiplicity=includeMultiplicity?cells.measure(signal):{commanded2DMultiplicityCertified:false,deferred:true,reason:'global ordinary D/P inventory does not gate explicit seam events; full flow/volume is separately deferred'};
 onStage?.('done');
 const execution=[];let previous=null;for(const q of commands){if(previous&&q.component!==previous.component)execution.push({kind:'travel',from:previous.to,to:q.from,beforeDepth:q.depth});execution.push({...q});previous=q;}
 return{kind:'generated-source-redistributed-central-T-courses',source:structuredClone(source),W,count,plan,commands,execution,cornerJoins:joinEvidence,phaseBevels:bevelEvidence,restartEvidence,
  footprintSemantics:'explicit nominal 2D continuous-turn rounded joins plus flat command ribbons; no independent start/end round caps, no extra move/dose, physical flow deferred',
  wholeNominalNozzleAndFeedContained:containment.every(q=>q.nozzle.passed&&q.feed.passed)&&outside.completeOriginalMaterialCovered&&rounded.actualCommandedPolygonsContainedInPrescribedMaterial,
  containment,roundedMaterialAccounting:rounded,sourceCellInventory:inventory,requiredMaterialCoverage:materialProof.serializable,flatPhaseCompleteApproximationUpperMM:R.str(flatBound),
  completePrescribedMaterialConstructionCertified:accuracy.accepted&&inventory.completeOriginalMaterialCovered&&materialProof.covered&&rounded.actualCommandedPolygonsContainedInPrescribedMaterial,
  accuracy,multiplicity,eventEvidence,eventBudgetsPassed:eventEvidence.every(q=>q.eventPassed),
  widthsWithinLimits:commands.every(q=>[q.widthStart,q.widthEnd].every(v=>R.cmp(R.exact(v),R.mul(w,R.rat(3n,5n)))>=0&&R.cmp(R.exact(v),R.mul(w,R.rat(8n,5n)))<=0)),
  ordinaryWidthNecessityIndependent:false,sourceOriginalContoursPreserved:true,outsideIn:commands.every((q,i)=>!i||q.depth>=commands[i-1].depth),
  primaryContinuousCoursePreopened:false,primaryExplicitSeamCommands:1,courses:plan.courses.length,internalRestartOverlapAuthorized:false,
  strictInternalRestartFirstWFeedDisjoint:restartEvidence.every(q=>q.strictDisjoint),strictInternalRestartFeedDisjoint:false,completeStartStopProtocolCertified:false,
  sourceFaceBindingCertified:false,roundJoinRuntimeRepresentationIntegrated:false,maximalContinuityOverArbitrary2DAlternativesCertified:false,
  ownerAccepted:false,selectedCommands:[],selectedExecution:[],physicalPrintValidated:false,
  scope:'full source-prescribed 2D material constructor in bounded odd long-arm T class; explicit event budgets, source-first ordinary corner widths, complete analytic sector bounds; production/runtime and general maximality still unresolved'};
}};}
module.exports={planTRedistributedCentralCourses,createTRedistributedCentralCourses};
