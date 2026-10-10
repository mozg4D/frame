'use strict';
const R=require('./rational.cjs'),A=require('./accuracy-contract.cjs');
const {load}=require('./adapter.cjs'),{buildOrthogonalLevel}=require('./orthogonal-level-plan.cjs');
const {auditRouteGeometry}=require('./route-geometry-contract.cjs');
const {exactContained,exactOnDirectedInterval}=require('./neck-owned-seam-charge.cjs');
function clippedOwnership(source,from,to,intervals) {
  return intervals.flatMap(q=>{
    if(q.role!=='finite-original-offset-bank')return [structuredClone(q)];
    const a=source[q.edge].map(R.exact),b=source[(q.edge+1)%source.length].map(R.exact),d=R.vec(b,a);
    const at=p=>R.div(R.dot(R.vec(p.map(R.exact),a),d),R.dot(d,d));
    const u=at(from),v=at(to),oldA=R.parse(q.exactU0),oldB=R.parse(q.exactU1);
    const lo=A.max(A.min(u,v),A.min(oldA,oldB)),hi=A.min(A.max(u,v),A.max(oldA,oldB));
    if(R.cmp(lo,hi)>0)return [];
    const x=R.cmp(u,v)<=0?lo:hi,y=R.cmp(u,v)<=0?hi:lo;
    return [{...structuredClone(q),u0:R.number(x),u1:R.number(y),exactU0:R.str(x),exactU1:R.str(y)}];
  });
}
function createRouteGenerator() {
  const c=load('optimized-worker.js').context;
  return {generate({rings,W=1,count=1,signal}) {
    const start=performance.now();
    if(!(W>0)||!Number.isFinite(W)||!Number.isInteger(count)||count<1||count>64)
      throw Error('invalid nominal width or count');
    if(signal?.aborted)throw Error('route generation cancelled');
    if(!Array.isArray(rings)||rings.length!==1)
      return {status:'unsupported-route-class',reasons:['single original simple source required'],
        sourcePreserved:true,availableSourceRings:structuredClone(rings)};
    const original=rings[0],source=original.map(p=>p.slice()),levels=[];
    try {
      for(let depth=0;depth<count;depth++)levels.push(buildOrthogonalLevel(original,W,depth,c,signal));
      if(levels.reduce((sum,l)=>sum+l.points.length+3,0)>4096)throw Error('bounded complete route command count');
    }catch(e) {
      if(signal?.aborted)throw e;
      return {status:'unsupported-route-class',reasons:[e.message],sourcePreserved:true,source,
        independentlyConstructedLevels:levels.length,requestedPerimeters:count,
        routeAccepted:false,wholeLayerAccuracyCertified:false,wallMS:performance.now()-start};
    }
    const paths=[],travels=[],seams=[],required=[],ledger=[],commands=[],reasons=[];
    let last=null;
    for(const level of levels) {
      if(signal?.aborted)throw Error('route generation cancelled');
      const depth=level.depth;
      let loop=level.points.slice(),ownership=level.sourceIntervals.slice();
      const candidates=loop.map((a,i)=>({a,b:loop[(i+1)%loop.length],i})).filter(({a,b})=>
        (a[0]===b[0]||a[1]===b[1])&&Math.hypot(b[0]-a[0],b[1]-a[1])>=W);
      candidates.sort((a,b)=>a.a[1]-b.a[1]||a.a[0]-b.a[0]||a.b[1]-b.b[1]||a.b[0]-b.b[0]);
      if(!candidates.length){reasons.push('no certified straight closure interval');continue;}
      const seam=candidates[0].i;
      loop=loop.slice(seam).concat(loop.slice(0,seam));
      ownership=ownership.slice(seam).concat(ownership.slice(0,seam));
      const x=loop[0],y=loop[1],length=Math.hypot(...y.map((v,k)=>v-x[k]));
      const distance=Math.min(length-W,length/2+depth*W);
      if(distance>0&&distance<length) {
        const mid=x.map((v,k)=>v+(y[k]===v?0:Math.sign(y[k]-v)*distance));
        const whole=c.frameThroughNeckRibbon(x,y,W,W);
        if(exactOnDirectedInterval(mid,x,y)&&exactContained(c.frameThroughNeckRibbon(x,mid,W,W),whole)&&
          exactContained(c.frameThroughNeckRibbon(mid,y,W,W),whole)) {
          const first=ownership[0];
          loop=[mid,...loop.slice(1),x];
          ownership=[clippedOwnership(source,mid,y,first),...ownership.slice(1),
            clippedOwnership(source,x,mid,first)];
        }else reasons.push('uncertified exact source planned phase subdivision');
      }
      const a=loop[0],b=loop[1],end=a.map((v,k)=>v+(b[k]===v?0:Math.sign(b[k]-v)*.5*W));
      const points=loop.concat([a,end]),widths=points.map(()=>W);
      const quads=loop.map((p,i)=>c.frameThroughNeckRibbon(p,loop[(i+1)%loop.length],W,W));
      const closure=c.frameThroughNeckRibbon(a,end,W,W);
      const owned=exactOnDirectedInterval(end,a,b)&&exactContained(closure,quads[0]);
      if(!owned)reasons.push('unbound closure ribbon');
      required.push(...level.requiredCells);
      // Explicit prescribed .5W same-width source-owned closure subset.
      // New connectors and moved ribbons receive no such protocol credit.
      ledger.push(...quads);if(owned)ledger.push(closure);
      paths.push({points,widths,depth});
      seams.push({depth,lengthMM:.5*W,exactSameWidthSourcePlannedSubset:owned});
      if(last)travels.push({from:last,to:a,lengthMM:Math.hypot(...a.map((v,k)=>v-last[k])),beforeDepth:depth});
      for(let i=1;i<points.length;i++)commands.push({kind:'print',from:points[i-1],to:points[i],
        widthStart:W,widthEnd:W,depth,closure:i===points.length-1,
        sourceIntervals:clippedOwnership(source,points[i-1],points[i],ownership[(i-1)%loop.length])});
      last=end;
    }
    let geometry;
    try {geometry=auditRouteGeometry({source:original,paths,originalQuads:ledger,requiredCells:required,W,signal},c);}
    catch(e){if(signal?.aborted)throw e;reasons.push(e.message);}
    if(!geometry?.geometryPassed)reasons.push('combined geometry gates fail');
    if(paths.length!==levels.length)reasons.push('missing planned level');
    if(commands.some(q=>!q.sourceIntervals.length))reasons.push('unbound command original source support');
    let emittedReserve=R.zero;
    for(const q of commands) {
      const a=q.from.map(R.exact),b=q.to.map(R.exact),normal=A.normal(R.vec(b,a));
      const quad=c.frameThroughNeckRibbon(q.from,q.to,W,W);
      for(let k=0;k<4;k++) {
        const ideal=A.corner(k===0||k===3?a:b,normal,R.exact(W),k<2?1:-1);
        emittedReserve=A.max(emittedReserve,quad[k].reduce((sum,v,j)=>
          R.add(sum,A.max(A.abs(R.sub(R.exact(v),ideal[j][0])),
            A.abs(R.sub(R.exact(v),ideal[j][1])))),R.zero));
      }
    }
    const levelBound=levels.reduce((v,l)=>A.max(v,R.parse(l.accuracy.totalExactUpperBoundMM)),R.zero);
    const finiteCommandPlanAccuracy={...A.certifyBudget(W,[
      {name:'all independently prescribed complete source offset levels',verified:true,exactUpperBound:R.str(levelBound)},
      {name:'all emitted feed corner representations including closures',verified:true,exactUpperBound:R.str(emittedReserve)}
    ]),wholeTrajectoryDeviationCertified:false,scope:'entire finite perimeter command plan; complete material allocation and continuous circle feed remain separate'};
    if(!finiteCommandPlanAccuracy.accepted)reasons.push('complete finite command plan accuracy unresolved');
    const clockwise=paths.every(p=>p.points.slice(0,-2).reduce((sum,a,i,loop)=>
      R.add(sum,R.cross(a.map(R.exact),loop[(i+1)%loop.length].map(R.exact))),R.zero).n>0n);
    const outsideIn=paths.every((p,i)=>p.depth===i);
    if(!clockwise||!outsideIn)reasons.push('directed clockwise or outside-in schedule unresolved');
    const innerAccuracy={accepted:true,totalExactUpperBoundMM:R.str(levelBound),
      scope:'independent topology-preserving source offset levels'};
    const transitionPlan=require('./route-transition-plan.cjs').planTransitions(original,paths,W,c,innerAccuracy);
    if(transitionPlan.connections)reasons.push('connector closure and joint-ledger rematerialization not yet certified');
    const execution=[];
    for(let depth=0;depth<paths.length;depth++) {
      const travel=travels.find(t=>t.beforeDepth===depth);
      if(travel)execution.push({kind:'travel',...travel,widthStart:0,widthEnd:0});
      execution.push(...commands.filter(q=>q.depth===depth));
    }
    const supported=!reasons.length;
    return {status:supported?'supported-finite-perimeter-route':'unsupported-route-class',
      sourcePreserved:true,source,paths,commands,execution,travels,seams,transitionPlan,geometry,reasons,
      geometryRouteSupported:geometry?.geometryPassed===true,innerPlanAccuracyCertified:true,innerAccuracy,
      finiteCommandPlanAccuracy,requestedPerimeters:count,actualPerimeters:levels.length,
      levelPlans:levels.map(({points,sourceIntervals,requiredCells,...proof})=>proof),
      clockwiseTraversalCertified:clockwise,outsideInDepthSchedulingCertified:outsideIn,
      clockwiseAndOutsideIn:clockwise&&outsideIn,closureOverlapMM:.5*W,
      transitionMode:'explicit travel for uncertified connectors',
      supportedClass:'wide simple x-monotone orthogonal source with topology-preserving requested offsets',
      newGeneratorConstructedCommands:true,retainedWorkerOutputUsedAsReference:false,
      completeFinitePerimeterPlanCertified:supported,wholeSourceAllocationCertified:false,
      wholeLayerAccuracyCertified:false,sourceFaceAngleBindingCertified:false,routeAccepted:false,
      wallMS:performance.now()-start};
  }};
}
module.exports={createRouteGenerator};
