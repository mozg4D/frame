import test from 'node:test';
import assert from 'node:assert/strict';
import {createMaterial} from '../materials.js';
import {createReferenceProblem,createReferenceState} from '../reference-solver.js';
import {createReferenceSchedule,solveReferenceAnimation,ANIMATION_REFERENCE_LIMITS} from '../reference-animation.js';
const hard=()=>createMaterial({kind:'hard',saturationMagnetization:1000,reversibleSusceptibility:0,remanentMagnetization:600,initialRemanenceFraction:0,coerciveField:1000,irreversibleSusceptibility:1});
const soft=()=>createMaterial({kind:'soft',saturationMagnetization:1000,reversibleSusceptibility:4});
const scene=(material=hard(),extra={})=>createReferenceProblem({units:'SI',materials:{m:material},objects:[{id:'a'}],samples:[{id:'s',objectId:'a',materialId:'m',localPosition:[0,0,0],volume:1e-9}],selfDemagnetization:'none',...extra});
const knot=(time,H,currentDensities={})=>({time,uniformH:Array.isArray(H)?H:[H,0,0],currentDensities});
const schedule=(p,knots)=>createReferenceSchedule(p,{knots});
const close=(a,b,tol=3e-5)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b} within ${tol}`);
const run=(p,knots,options)=>solveReferenceAnimation(p,createReferenceState(p),schedule(p,knots),options);

test('schedule input is explicit, dense, finite, ordered, bounded and provenance checked',async()=>{
  const p=scene(),valid=[knot(0,0),knot(1,1200)];
  for(const bad of [[],new Array(2),[knot(0,0),knot(0,1)],[knot(1,0),knot(0,1)],[knot(NaN,0)],
    [{time:0,uniformH:[0,0,0]}],[{...knot(0,0),objects:[]}],[knot(0,[Infinity,0,0])],Array.from({length:129},(_,i)=>knot(i,0))])assert.throws(()=>schedule(p,bad));
  assert.throws(()=>createReferenceSchedule({...p},{knots:valid}),/createReferenceProblem/);
  assert.throws(()=>createReferenceSchedule(p,{knots:valid,source:()=>0}));
  await assert.rejects(solveReferenceAnimation(p,createReferenceState(p),{...schedule(p,valid)}),/issued schedule/);
  await assert.rejects(solveReferenceAnimation(scene(),createReferenceState(p),schedule(p,valid)),/exact reference/);
  for(const animationOptions of [{tolerance:0},{tolerance:Infinity},{maxDepth:21},{maxEvaluations:16385},{maxAcceptedSteps:0},{unknown:true}])await assert.rejects(run(p,valid,{animationOptions}));
  await assert.rejects(run(p,valid,{solverOptions:null}));
  await assert.rejects(run(p,valid,{solverOptions:{unknown:true}}));
  await assert.rejects(solveReferenceAnimation(p,{...createReferenceState(p)},schedule(p,valid)),/layout mismatch/);
  assert.equal(ANIMATION_REFERENCE_LIMITS.maxKnots,128);
});

test('issued schedules detach all source data and successful traces retain scalars only',async()=>{
  const p=scene(),input=[knot(0,0),knot(1,1200),knot(2,0)],s=schedule(p,input);
  input[1].uniformH[0]=-4000;input[1].time=-1;input.push(knot(3,-4000));
  const r=await solveReferenceAnimation(p,createReferenceState(p),s);close(r.state.remanence[0][0],200);
  assert.ok(Object.isFrozen(s)&&Object.isFrozen(s.knots[1].uniformH)&&Object.isFrozen(r)&&Object.isFrozen(r.trace));
  assert.deepEqual(r.trace.filter(x=>x.knotIndex!==null).map(x=>[x.time,x.knotIndex]),[[0,0],[1,1],[2,2]]);
  assert.equal(r.trace.length,r.metrics.acceptedSteps);
  r.trace.forEach((row,i)=>{Object.values(row).forEach(value=>assert.ok(value===null||typeof value==='number'));assert.ok(Object.isFrozen(row));if(i)assert.ok(row.time>r.trace[i-1].time);});
  assert.ok(!('frames' in r));assert.equal(r.state.sceneKey,r.finalProblem.sceneKey);
});

test('soft nonlinear intermediate response refines despite zero endpoint history error',async()=>{
  const p=scene(soft()),r=await run(p,[knot(0,0),knot(1,1000)],{animationOptions:{tolerance:1e-3},solverOptions:{tolerance:1e-11}});
  assert.ok(r.metrics.rejectedIntervals>0);assert.ok(r.metrics.acceptedSteps>3);assert.ok(r.metrics.maxAcceptedError<=1e-3);
  r.trace.forEach(row=>close(row.maxMagnetization,1000*Math.tanh(4*row.time),3e-7));
  close(r.state.M[0][0],1000*Math.tanh(4),3e-7);
});

test('signed current-basis amplitudes combine with uniformH and retain a partial pulse',async()=>{
  const volume=1,radius=Math.cbrt(3/(4*Math.PI)),factor=volume/(4*Math.PI*(1+radius**2)**1.5),density=1200/factor;
  const p=scene(hard(),{uniformH:[999,0,0],objects:[{id:'a',translation:[0,-1,0]},{id:'wire'}],currentBases:[{id:'basis',density:999,samples:[{id:'w',objectId:'wire',localPosition:[0,0,0],basisDensity:[0,0,1],volume}]}]});
  for(const missing of [{}, {basis:NaN},{basis:0,other:1}])assert.throws(()=>schedule(p,[knot(0,0,missing)]));
  const points=[knot(0,0,{basis:0}),knot(1,100,{basis:density}),knot(2,0,{basis:0}),knot(3,-100,{basis:-density}),knot(4,0,{basis:0})];
  const r=await run(p,points);close(r.state.remanence[0][0],-300);close(r.state.M[0][0],-300);
  assert.equal(r.finalProblem.currentBases[0].density,0);assert.deepEqual(r.finalProblem.uniformH,[0,0,0]);
});

test('vector path rejection replays chronologically and agrees with independent fine projections',async()=>{
  const points=[knot(0,[0,0,0]),knot(1,[1400,0,0]),knot(2,[0,1400,0]),knot(3,[0,0,0])],p=scene();
  const project=(r,H)=>{const d=H.map((x,i)=>x-r[i]),n=Math.hypot(...d);let out=n>1000?r.map((x,i)=>x+d[i]*(1-1000/n)):r;const m=Math.hypot(...out);return m>600?out.map(x=>x*600/m):out;};
  let oracle=[0,0,0];for(let j=1;j<points.length;j++)for(let i=1;i<=10000;i++)oracle=project(oracle,points[j-1].uniformH.map((x,k)=>x+(points[j].uniformH[k]-x)*i/10000));
  const started=performance.now(),r=await run(p,points,{animationOptions:{tolerance:1e-5},solverOptions:{tolerance:1e-11}}),wallMs=performance.now()-started;
  assert.ok(wallMs<3000,`${wallMs} exceeds dynamic vector history 3000ms budget`);
  console.log(JSON.stringify({operation:'dynamic-vector-path CPU chronological reference',wallMs,budgetMs:3000,evaluations:r.metrics.evaluations,acceptedSteps:r.metrics.acceptedSteps,rejectedIntervals:r.metrics.rejectedIntervals}));
  assert.ok(r.metrics.rejectedIntervals>0);r.state.remanence[0].forEach((x,i)=>close(x,oracle[i],.5));
  const coarse=await run(p,points,{animationOptions:{tolerance:1e-3},solverOptions:{tolerance:1e-11}});
  const distance=state=>Math.hypot(...state.remanence[0].map((x,i)=>x-oracle[i]));assert.ok(distance(r.state)<distance(coarse.state)/3);
  const replay=await run(p,points,{animationOptions:{tolerance:1e-5},solverOptions:{tolerance:1e-11}});assert.deepEqual(replay.state,r.state);assert.deepEqual(replay.trace,r.trace);
});

test('evaluation, accepted-step, depth and midpoint-resolution failures expose no candidate',async()=>{
  const p=scene(),base=createReferenceState(p),before=JSON.stringify(base),s=schedule(p,[knot(0,0),knot(1,1200)]);
  for(const [animationOptions,reason] of [[{maxEvaluations:2},'EVALUATION_BUDGET'],[{maxAcceptedSteps:1},'STEP_BUDGET'],[{maxDepth:1,tolerance:1e-10},'REFINEMENT_LIMIT']]){
    await assert.rejects(solveReferenceAnimation(p,base,s,{animationOptions}),error=>error.reason===reason&&!('state' in error)&&!('trace' in error));
    assert.equal(JSON.stringify(base),before);
  }
  await assert.rejects(run(p,[knot(1,0),knot(1+Number.EPSILON,1200)]),error=>error.reason==='TIME_RESOLUTION');
  close((await solveReferenceAnimation(p,base,s)).state.remanence[0][0],200);
});

test('mid-run cancellation and nonlinear nonconvergence leave issued baseline unchanged',async()=>{
  const p=scene(soft()),base=createReferenceState(p),before=JSON.stringify(base),s=schedule(p,[knot(0,0),knot(1,1000)]),ac=new AbortController();let yielded=0;
  await assert.rejects(solveReferenceAnimation(p,base,s,{signal:ac.signal,solverOptions:{yieldEvery:1,yieldControl:async()=>{yielded++;ac.abort();}}}),{name:'AbortError'});
  assert.ok(yielded>0);assert.equal(JSON.stringify(base),before);
  await assert.rejects(solveReferenceAnimation(p,base,s,{solverOptions:{maxIterations:1,tolerance:1e-14}}),error=>error.reason==='NOT_CONVERGED'&&!('state' in error));
  await assert.rejects(solveReferenceAnimation(p,base,s,{solverOptions:{yieldEvery:1,yieldControl:async()=>{throw new Error('Injected cooperative failure');}}}),/Injected cooperative failure/);
  assert.equal(JSON.stringify(base),before);assert.equal((await solveReferenceAnimation(p,base,s)).state.converged,true);
});

test('128-knot completed operation stays within reference bounds and reports CPU cost',async()=>{
  const p=scene(),points=Array.from({length:128},(_,i)=>knot(i,0)),start=performance.now(),r=await run(p,points),wallMs=performance.now()-start;
  assert.equal(r.metrics.knotCount,128);assert.equal(r.metrics.acceptedSteps,255);assert.equal(r.metrics.evaluations,382);
  assert.ok(r.metrics.evaluations<=4096);assert.ok(wallMs<3000,`${wallMs} exceeds 3000ms`);
  console.log(JSON.stringify({operation:'128-knot bounded CPU chronological reference',wallMs,budgetMs:3000,evaluations:r.metrics.evaluations,acceptedSteps:r.metrics.acceptedSteps}));
});
