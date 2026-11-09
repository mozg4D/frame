import test from 'node:test';
import assert from 'node:assert/strict';
import {createConductorGraph, solveConductorCurrent, toReferenceCurrentBasis} from '../conductor-current.js';
import {evaluateCurrentField} from '../direct-kernel.js';

const near = (actual, expected, tolerance=2e-11) => assert.ok(Math.abs(actual-expected)<=tolerance*Math.max(1,Math.abs(expected)), `${actual} != ${expected}`);
function parallel(scale=1) {
  return {units:'SI',nodes:['left','right'],edges:[
    {id:'a',from:'left',to:'right',length:1,area:1,conductivity:scale},
    {id:'b',from:'left',to:'right',length:2,area:1,conductivity:scale},
    {id:'c',from:'left',to:'right',length:3,area:1,conductivity:scale},
    {id:'return',from:'right',to:'left',length:2,area:1,conductivity:scale}
  ],cut:{edges:[{edgeId:'return',sign:1}]}};
}

test('independent three-branch Kirchhoff solution and physical power',()=>{
  const g=createConductorGraph(parallel()), r=solveConductorCurrent(g,{current:6});
  [36/11,18/11,12/11,6].forEach((v,i)=>near(r.flux[i],v));
  near(r.effectiveResistance,28/11);near(r.dissipatedPower,1008/11);
  r.divergence.forEach(v=>near(v,0));
  // Independent electrical potential drop across all three parallel branches.
  near(r.flux[0],2*r.flux[1]);near(r.flux[0],3*r.flux[2]);
});

test('independent constrained power perturbations have stationary minimum and known curvature',()=>{
  const g=createConductorGraph(parallel()), r=solveConductorCurrent(g,{current:6});
  const resistance=[1,2,3,2], direction=[2,-3,1,0]; // exact zero divergence and zero cut flux
  const power=t=>r.flux.reduce((s,q,i)=>s+resistance[i]*(q+t*direction[i])**2,0);
  const baseline=power(0), curvature=25;
  for(const t of [-4,-0.125,0.125,4]) {near(power(t)-baseline,curvature*t*t);assert.ok(power(t)>baseline);}
  near((power(0.125)-power(-0.125))/0.25,0);
});

test('independent node/edge ordering and edge orientation do not change physical solution',()=>{
  const fixture=parallel(), baseline=solveConductorCurrent(createConductorGraph(fixture),{current:-7});
  const order=[3,1,0,2], reversals=new Set(['return','a']);
  fixture.nodes.reverse();
  fixture.edges=order.map(i=>{const e=fixture.edges[i];return reversals.has(e.id)?{...e,from:e.to,to:e.from}:e;});
  fixture.cut.edges[0].sign=-1;
  const actual=solveConductorCurrent(createConductorGraph(fixture),{current:-7});
  order.forEach((oldIndex,newIndex)=>near(actual.flux[newIndex],baseline.flux[oldIndex]*(reversals.has(actual.edgeIds[newIndex])?-1:1)));
  near(actual.dissipatedPower,baseline.dissipatedPower);
});

test('homogeneous conductivity scaling changes power but leaves geometry-normalized current unchanged',()=>{
  const a=solveConductorCurrent(createConductorGraph(parallel()),{current:2});
  for(const factor of [1e-8,1e8]) {
    const b=solveConductorCurrent(createConductorGraph(parallel(factor)),{current:2});
    b.flux.forEach((q,i)=>near(q,a.flux[i]));near(b.effectiveResistance*factor,a.effectiveResistance);
    near(b.dissipatedPower*factor,a.dissipatedPower);
  }
});

test('inactive disconnected loops and dead ends do not receive current',()=>{
  const fixture=parallel();fixture.nodes.push('tip','x','y');
  fixture.edges.push({id:'dead',from:'right',to:'tip',length:1,area:1,conductivity:1},
    {id:'other1',from:'x',to:'y',length:1,area:1,conductivity:1},
    {id:'other2',from:'y',to:'x',length:3,area:1,conductivity:1});
  const r=solveConductorCurrent(createConductorGraph(fixture),{current:3});
  r.flux.slice(4).forEach(q=>near(q,0));r.divergence.forEach(q=>near(q,0));
});

test('quadrature normalization is density-independent and enforces graph/solution identity',()=>{
  const fixture=parallel();fixture.edges.forEach((e,i)=>Object.assign(e,{localPosition:[i,0,0],direction:[1,0,0]}));
  const graph=createConductorGraph(fixture), positive=solveConductorCurrent(graph,{current:3}), negative=solveConductorCurrent(graph,{current:-3});
  const a=toReferenceCurrentBasis(graph,positive,{id:'basis',objectId:'wire'}), b=toReferenceCurrentBasis(graph,negative,{id:'basis',objectId:'wire'});
  assert.deepEqual(a.samples,b.samples);near(b.density,-a.density);
  a.samples.forEach((s,i)=>{near(s.volume,fixture.edges[i].length*fixture.edges[i].area);near(s.basisDensity[0]*a.density,positive.currentDensity[i]);});
  assert.throws(()=>toReferenceCurrentBasis(graph,{...positive},{id:'basis',objectId:'wire'}));
  assert.throws(()=>toReferenceCurrentBasis(createConductorGraph(fixture),positive,{id:'basis',objectId:'wire'}));
});

test('a separating cut cannot drive a closed conductor, including a zero-amplitude request',()=>{
  const fixture=parallel();fixture.cut.edges=fixture.edges.map(e=>({edgeId:e.id,sign:e.id==='return'?-1:1}));
  const g=createConductorGraph(fixture);
  for(const current of [0,1,-1]) assert.throws(()=>solveConductorCurrent(g,{current}),/Impossible cut/);
});

test('graph-derived square-loop field approaches independent exact straight-wire integral',()=>{
  // Four wire integrals: H_z = 4 I/(4 pi) integral[-a,a] a/(a*a+s*s)^(3/2) ds.
  const a=0.1, current=3, exact=Math.SQRT2*current/(Math.PI*a);
  function field(parts,signedCurrent=current) {
    const corners=[[-a,-a,0],[a,-a,0],[a,a,0],[-a,a,0]];
    const nodes=Array.from({length:4*parts},(_,i)=>'n'+i), edges=[];
    for(let side=0;side<4;side++) {
      const start=corners[side],end=corners[(side+1)%4],direction=end.map((x,k)=>(x-start[k])/(2*a));
      for(let part=0;part<parts;part++) {
        const i=side*parts+part;
        edges.push({id:'e'+i,from:nodes[i],to:nodes[(i+1)%nodes.length],length:2*a/parts,area:1e-12,conductivity:1,
          direction,localPosition:start.map((x,k)=>x+(end[k]-x)*(part+0.5)/parts)});
      }
    }
    const g=createConductorGraph({units:'SI',nodes,edges,cut:{edges:[{edgeId:'e0',sign:1}]}});
    const b=toReferenceCurrentBasis(g,solveConductorCurrent(g,{current:signedCurrent}),{id:'loop',objectId:'wire'});
    return evaluateCurrentField(b.samples.map(s=>({objectId:s.objectId,position:s.localPosition,volume:s.volume,currentDensity:s.basisDensity.map(v=>v*b.density)})),[[0,0,0]]).H[0];
  }
  const coarse=field(4),fine=field(8),negative=field(8,-current);
  assert.ok(Math.abs(fine[2]-exact)<Math.abs(coarse[2]-exact)/3);
  assert.ok(Math.abs(fine[2]/exact-1)<0.003);
  near(fine[0],0);near(fine[1],0);negative.forEach((v,k)=>near(v,-fine[k]));
});
