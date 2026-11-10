import test from 'node:test';
import assert from 'node:assert/strict';
import {createMaterial} from '../materials.js';
import {createReferenceProblem,createReferenceState,referenceLoads} from '../reference-solver.js';
import {createReferenceSchedule,solveReferenceAnimation} from '../reference-animation.js';

function fixture({fraction=0,self='none'}={}) {
  return createReferenceProblem({units:'SI',materials:{m:createMaterial({kind:'hard',saturationMagnetization:1000,
    remanentMagnetization:600,initialRemanenceFraction:fraction,reversibleSusceptibility:0,
    coerciveField:1000,irreversibleSusceptibility:1})},objects:[{id:'magnet'}],
    samples:[{id:'sample',objectId:'magnet',materialId:'m',localPosition:[0,0,0],volume:1e-9}],
    uniformH:[0,0,0],selfDemagnetization:self});
}
const solverOptions = {yieldControl: async()=>{}};
const knots = values=>values.map((H,time)=>({time,uniformH:[H,0,0],currentDensities:{}}));
const near=(a,b,tol=2e-5)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);
async function run(p,points) {return solveReferenceAnimation(p,createReferenceState(p),createReferenceSchedule(p,{knots:points}),{solverOptions});}

test('independent scalar play projection matches every prefix of a reversing source history',async()=>{
  const values=[0,1200,0,-1400,0],p=fixture();let expected=0;
  for(let i=0;i<values.length;i++) {
    // For chi_ir=1, no reversible response/self-field: project old state onto [H-Hc,H+Hc], then [-Mr,Mr].
    expected=Math.max(-600,Math.min(600,Math.max(values[i]-1000,Math.min(values[i]+1000,expected))));
    const r=await run(p,knots(values.slice(0,i+1)));near(r.state.remanence[0][0],expected);
    near(r.state.remanence[0][1],0);near(r.state.remanence[0][2],0);
  }
});

test('independent sphere demagnetization reduces a reverse pulse to retained 150 A/m',async()=>{
  const p=fixture({fraction:1,self:'equivalent-sphere'}),r=await run(p,knots([0,-800,0]));
  // At the negative irreversible boundary: M=-800-M/3+1000, hence M=150.
  near(r.state.remanence[0][0],150);near(r.state.M[0][0],150);near(r.state.H[0][0],-50);
});

test('a declared nanosecond-scale pulse retains the same state as the widened source path',async()=>{
  const p=fixture(), points=[{time:0,uniformH:[0,0,0],currentDensities:{}},
    {time:1-1e-9,uniformH:[0,0,0],currentDensities:{}},
    {time:1,uniformH:[1200,0,0],currentDensities:{}},
    {time:1+1e-9,uniformH:[0,0,0],currentDensities:{}},
    {time:2,uniformH:[0,0,0],currentDensities:{}}];
  const a=await run(p,points),b=await run(p,points.map((k,i)=>({...k,time:i})));
  near(a.state.remanence[0][0],200);near(a.state.remanence[0][0],b.state.remanence[0][0]);
});

test('chronological pulse order changes final memory while replay from the same baseline is deterministic',async()=>{
  const p=fixture(),baseline=createReferenceState(p),before=JSON.stringify(baseline);
  const s=createReferenceSchedule(p,{knots:knots([0,1200,0,-1400,0])});
  const a=await solveReferenceAnimation(p,baseline,s,{solverOptions}),b=await solveReferenceAnimation(p,baseline,s,{solverOptions}),reverse=await run(p,knots([0,-1400,0,1200,0]));
  near(a.state.remanence[0][0],-400);near(reverse.state.remanence[0][0],200);
  assert.deepEqual(a.state.remanence,b.state.remanence);assert.equal(JSON.stringify(baseline),before);
  assert.notEqual(a.state,baseline);
});

test('the final state belongs to the final source problem and supports its existing load contract',async()=>{
  const p=fixture(),r=await run(p,knots([0,1200,0]));
  assert.equal(r.state.sceneKey,r.finalProblem.sceneKey);
  const loads=referenceLoads(r.finalProblem,r.state,{selectedOwners:['magnet'],pivot:[0,0,0]});
  loads.force.forEach(v=>near(v,0));loads.torque.forEach(v=>near(v,0));
});

test('pre-cancellation cannot mutate the caller baseline or issue a partial result',async()=>{
  const p=fixture(),baseline=createReferenceState(p),before=JSON.stringify(baseline),controller=new AbortController();
  controller.abort();
  await assert.rejects(solveReferenceAnimation(p,baseline,createReferenceSchedule(p,{knots:knots([0,1200,0])}),{signal:controller.signal,solverOptions}),{name:'AbortError'});
  assert.equal(JSON.stringify(baseline),before);
  near((await run(p,knots([0,1200,0]))).state.remanence[0][0],200);
});

test('vector history agrees with an independently integrated dense play-projection path',async()=>{
  const points=[[0,0,0],[1400,0,0],[0,1400,0],[0,0,0]],p=fixture();
  const schedule=createReferenceSchedule(p,{knots:points.map((uniformH,time)=>({time,uniformH,currentDensities:{}}))});
  let expected=[0,0,0];
  for(let segment=1;segment<points.length;segment++)for(let step=1;step<=4096;step++) {
    const t=step/4096,H=points[segment].map((x,i)=>points[segment-1][i]*(1-t)+x*t);
    const offset=expected.map((x,i)=>x-H[i]),distance=Math.hypot(...offset);
    if(distance>1000)expected=H.map((x,i)=>x+offset[i]*1000/distance);
    const norm=Math.hypot(...expected);if(norm>600)expected=expected.map(x=>x*600/norm);
  }
  const actual=await solveReferenceAnimation(p,createReferenceState(p),schedule,{solverOptions,animationOptions:{tolerance:1e-5}});
  assert.ok(Math.hypot(...actual.state.remanence[0].map((x,i)=>x-expected[i]))<3);
  assert.ok(actual.metrics.rejectedIntervals>0);
  assert.ok(actual.metrics.maxAcceptedError<=actual.metrics.tolerance);
  const markers=actual.trace.filter(row=>row.knotIndex!==null);
  assert.deepEqual(markers.map(row=>row.knotIndex),[0,1,2,3]);
  for(let i=1;i<actual.trace.length;i++)assert.ok(actual.trace[i].time>actual.trace[i-1].time);
  for(const row of actual.trace)for(const value of Object.values(row))assert.ok(value===null||typeof value==='number');
});
