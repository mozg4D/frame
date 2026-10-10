'use strict';
// Independent topology-preserving orthogonal levels. References are fixed from
// original source corners and exact rational circle supports before emission.
const R=require('./rational.cjs'), A=require('./accuracy-contract.cjs');
const {canonicalRing}=require('./contour-core.cjs');
const {sourceCells,proveFeedInsideSource}=require('./exact-source-feed.cjs');
const {diagnoseExactTopology}=require('./section-topology.cjs');
const {mapInterval,reverseDirectedIntervals}=require('./provenance.cjs');
function sourceIntervals(source,normalized,markers,i,j) {
  const a=markers[i],b=markers[j],n=normalized.ring.length;
  if(a.cornerId===b.cornerId) {
    return [(a.cornerId+n-1)%n,a.cornerId].flatMap(edge=>
      mapInterval([normalized],[source],{ring:0,edge})
        .map(q=>({...q,role:'finite-original-corner-support'})));
  }
  const edge=a.cornerId, p=normalized.ring[edge].map(R.exact);
  const d=R.vec(normalized.ring[(edge+1)%n].map(R.exact),p);
  const project=q=>A.max(R.zero,A.min(R.one,R.div(R.dot(R.vec(q,p),d),R.dot(d,d))));
  return mapInterval([normalized],[source],{
    ring:0,edge,exactU0:R.str(project(a.exactPoint)),exactU1:R.str(project(b.exactPoint))
  }).map(q=>({...q,role:'finite-original-offset-bank'}));
}
function buildOrthogonalLevel(source,W,depth,c,signal) {
  if(signal?.aborted)throw Error('route generation cancelled');
  const normalized=canonicalRing(source),s=normalized.ring,S=s.map(p=>p.map(R.exact));
  const area=S.reduce((sum,p,i)=>R.add(sum,R.cross(p,S[(i+1)%S.length])),R.zero);
  if(!area.n)throw Error('degenerate source');
  const sign=area.n<0n?-1:1, radius=R.mul(R.exact(W),R.rat(BigInt(2*depth+1),2n));
  const minDistance=Math.max(2*W,2*R.number(radius));
  const material=sourceCells(source);
  for(let i=0;i<s.length;i++) {
    if(signal?.aborted)throw Error('route generation cancelled');
    const d=R.vec(S[(i+1)%s.length],S[i]);
    if(d[0].n&&d[1].n)throw Error('orthogonal original source required');
    for(let j=0;j<i;j++) {
      if((i+1)%s.length===j||(j+1)%s.length===i)continue;
      if(c.frameAcuteVariableSegmentsWithin(s[i],s[(i+1)%s.length],
        s[j],s[(j+1)%s.length],minDistance,0,0))
        throw Error(depth?'requested inner offset changes topology or has insufficient source feature clearance':
          'wide source feature greater than2W required');
    }
  }
  // Rational unit normals (1-t^2,2t)/(1+t^2) cover the entire quarter circle.
  // Density is fixed only by W, depth and an independent analytic arc bound.
  let supports,arcBound,N=8;
  for(;;N*=2) {
    if(N>256)throw Error('bounded orthogonal tangent density');
    supports=Array.from({length:N+1},(_,i)=>{
      const t=R.rat(BigInt(i),BigInt(N)),tt=R.mul(t,t),den=R.add(R.one,tt);
      return [R.div(R.sub(R.one,tt),den),R.div(R.mul(R.rat(2n),t),den)];
    });
    supports=[...new Map(supports.flatMap(p=>[p,p.slice().reverse()])
      .map(p=>[p.map(R.str).join(','),p])).values()].sort((a,b)=>R.cmp(a[1],b[1]));
    arcBound=R.zero;
    for(let i=1;i<supports.length;i++) {
      const cos=R.dot(supports[i-1],supports[i]);
      const sec=A.sqrtBounds(R.div(R.rat(2n),R.add(R.one,cos)))[1];
      arcBound=A.max(arcBound,R.mul(radius,R.sub(sec,R.one)));
    }
    if(R.cmp(arcBound,R.mul(R.exact(W),R.rat(9n,500n)))<=0)break;
  }
  const circleVertices=[[radius,R.zero]];
  for(let i=1;i<supports.length;i++) {
    const a=supports[i-1],b=supports[i],det=R.cross(a,b);
    circleVertices.push([R.div(R.mul(radius,R.sub(b[1],a[1])),det),
      R.div(R.mul(radius,R.sub(a[0],b[0])),det)]);
  }
  circleVertices.push([R.zero,radius]);
  const markers=[];
  for(let i=0;i<s.length;i++) {
    const p=S[i],d1=R.vec(p,S[(i+s.length-1)%s.length]),d2=R.vec(S[(i+1)%s.length],p);
    const inward=d=>d[0].n?[0,sign*(d[0].n<0n?-1:1)]:[-sign*(d[1].n<0n?-1:1),0];
    const a=inward(d1),b=inward(d2),turn=R.cross(d1,d2).n*BigInt(sign);
    if(!turn)throw Error('unresolved orthogonal corner');
    for(const [x,y]of turn>0n?[[radius,radius]]:circleVertices) {
      const exactPoint=p.map((v,k)=>R.add(v,R.add(R.mul(x,R.rat(BigInt(a[k]))),R.mul(y,R.rat(BigInt(b[k]))))));
      markers.push({cornerId:i,corner:s[i],exactPoint,point:exactPoint.map(R.number)});
    }
  }
  if(markers.length>2048)throw Error('bounded orthogonal level size');
  const topo=diagnoseExactTopology([markers.map(m=>m.exactPoint.map(R.str))]);
  if(!topo.complete||topo.diagnostics.length)throw Error('source offset contact or topology change');
  const reference=markers.map(m=>m.point.slice()),points=reference.map(p=>p.slice());
  const fits=(a,b)=>c.frameThroughNeckExactClearance(a,b,source,W).passed&&
    proveFeedInsideSource(c.frameThroughNeckRibbon(a,b,W,W),source,material).passed;
  let passes=0;
  for(;passes<8;passes++) {
    if(signal?.aborted)throw Error('route generation cancelled');
    const bad=new Set();
    for(let i=0;i<points.length;i++)if(!fits(points[i],points[(i+1)%points.length])) {
      bad.add(i);bad.add((i+1)%points.length);
    }
    if(!bad.size)break;
    for(const i of bad)points[i]=points[i].map((v,k)=>v+(reference[i][k]-markers[i].corner[k])*2**-42);
  }
  if(passes===8)throw Error('bounded exact source representation repair unresolved');
  const emittedTopology=diagnoseExactTopology([points.map(p=>p.map(v=>R.str(R.exact(v))))]);
  if(!emittedTopology.complete||emittedTopology.diagnostics.length)throw Error('emitted offset topology unresolved');
  const transform=A.provePolylineTransform(markers.map(m=>m.exactPoint.map(R.str)),points,
    points.map((_,i)=>[i]),{referenceWidths:points.map(()=>W),outputWidths:points.map(()=>W),nozzleWidth:W,closed:true});
  const accuracy=A.certifyBudget(W,[{name:'entire independently source-derived exact rational tangent level',
    verified:true,exactUpperBound:transform.exactUpperBound}]);
  if(!accuracy.accepted)throw Error('orthogonal level cumulative construction budget');
  let intervals=markers.map((_,i)=>sourceIntervals(source,normalized,markers,i,(i+1)%markers.length));
  let directedPoints=points;
  if(sign<0) {
    directedPoints=points.slice().reverse();
    intervals=points.map((_,i)=>reverseDirectedIntervals(intervals[(points.length-2-i+points.length)%points.length]));
  }
  return {points:directedPoints,sourceIntervals:intervals,depth,accuracy,
    requiredCells:reference.map((p,i)=>c.frameThroughNeckRibbon(p,reference[(i+1)%reference.length],W,W)),
    analyticCircleAxisAndNozzleBoundMM:require('./mesh-section.cjs').upper(arcBound),
    sourceCircleAxisAndNozzleAccuracy:A.certifyBudget(W,[
      ...accuracy.stages,{name:'entire analytic quarter circle to exact rational tangent supports',
        verified:true,exactUpperBound:R.str(arcBound)}]),
    tangentSubdivisions:N,representationRepairPasses:passes,
    continuousCircleFeedCertified:false,sourceReferenceIndependent:true,
    topologyPreservingOffsetCertified:true,wholeSourceAllocationCertified:false};
}
module.exports={buildOrthogonalLevel};

