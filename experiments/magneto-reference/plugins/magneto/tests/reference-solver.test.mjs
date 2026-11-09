import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createMaterial } from '../materials.js';
import { MU0 } from '../direct-kernel.js';
import { createReferenceProblem as problem,createReferenceState as initial,solveReference as solve,createReferenceSession as session,referenceLoads as loads,REFERENCE_CAPABILITIES } from '../reference-solver.js';
const soft=(chi=3,ms=1e6)=>createMaterial({kind:'soft',saturationMagnetization:ms,reversibleSusceptibility:chi});
const hard=(fraction=1,chi=0)=>createMaterial({kind:'hard',saturationMagnetization:1000,reversibleSusceptibility:chi,remanentMagnetization:600,initialRemanenceFraction:fraction,coerciveField:1000,irreversibleSusceptibility:1});
const scene=(m=hard(),H=[0,0,0],extra={})=>({units:'SI',materials:{m},objects:[{id:'a'}],samples:[{id:'s',objectId:'a',materialId:'m',localPosition:[0,0,0],volume:1e-9}],uniformH:H,...extra});
const close=(a,b,tol=1e-6)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b} within ${tol}`);
const vclose=(a,b,tol=1e-6)=>a.forEach((x,i)=>close(x,b[i],tol));
const rotateZ=([x,y,z])=>[-y,x,z];

test('reference capabilities and SI/weighted/rigid contracts fail closed',()=>{
  assert.equal(REFERENCE_CAPABILITIES.gpu,false);assert.equal(REFERENCE_CAPABILITIES.currentDensityConductorSolve,false);
  for(const change of [{units:'mm'},{unknown:true},{currentDensityPlanes:[]},{samples:[]},{objects:[{id:'a',scale:[2,1,1]}]},{objects:[{id:'a',rotation:[0,0,0,2]}]},{objects:[{id:'a',rotation:new Array(4)}]}])assert.throws(()=>problem(scene(hard(),[0,0,0],change)));
  const holes=scene().samples;holes.length=2;assert.throws(()=>problem(scene(hard(),[0,0,0],{samples:holes})));
  const negative=scene();negative.samples[0].volume=-1;assert.throws(()=>problem(negative));
  const big=scene();big.samples=Array.from({length:129},(_,i)=>({...big.samples[0],id:`s${i}`}));assert.throws(()=>problem(big));
  assert.throws(()=>problem(scene(hard(),new Array(3))));assert.throws(()=>session(scene(),{solverOptions:{maxIterations:0}}));
});

test('one uniform permanent-magnet sphere matches exact demagnetization and induction identity',async()=>{
  const p=problem(scene());const r=await solve(p,initial(p));assert.equal(r.metrics.converged,true);vclose(r.state.M[0],[600,0,0]);vclose(r.state.H[0],[-200,0,0]);vclose(r.state.B[0],[MU0*400,0,0],1e-14);
});

test('weak-field soft sphere matches independent linear demagnetization solution',async()=>{
  const H=[2,3,-4],p=problem(scene(soft(),H));const r=await solve(p,initial(p),{solverOptions:{tolerance:1e-12}});
  assert.equal(r.metrics.converged,true);vclose(r.state.M[0],H.map(x=>1.5*x),3e-6);vclose(r.state.H[0],H.map(x=>.5*x),1e-6);
});

test('saturating soft sphere agrees with independent scalar bisection oracle',async()=>{
  for(const H of [.1,10,500]){
    const p=problem(scene(soft(100,1000),[H,0,0]));const r=await solve(p,initial(p),{solverOptions:{tolerance:1e-10}});
    let lo=0,hi=1000;for(let k=0;k<100;k++){const mid=(lo+hi)/2;if(mid-1000*Math.tanh(100*(H-mid/3)/1000)>0)hi=mid;else lo=mid;}
    assert.equal(r.metrics.converged,true,JSON.stringify(r.metrics));close(r.state.M[0][0],(lo+hi)/2,5e-5);assert.ok(r.state.saturation[0]<=1);
  }
});

test('hard remanence survives weak reversible loading and recovers after removal',async()=>{
  const s=session(scene(hard(1,.2)));const zero=await s.solveFrame({time:0});assert.equal(zero.committed,true);const base=zero.result.state.M[0][0];
  s.updateProblem(scene(hard(1,.2),[30,0,0]));const weak=await s.solveFrame({time:1});close(weak.result.state.remanence[0][0],600);assert.ok(weak.result.state.M[0][0]>base);
  s.updateProblem(scene(hard(1,.2)));const back=await s.solveFrame({time:2});close(back.result.state.M[0][0],base,3e-5);s.dispose();
});

test('partial signed magnetizing pulse commits once and is retained after the current is removed',async()=>{
  const m=hard(0),data=scene(m,[1200,0,0],{selfDemagnetization:'none'}),s=session(data);const a=await s.solveFrame({time:0});close(a.result.state.remanence[0][0],200,1e-10);
  const repeat=await s.solveFrame({time:0});close(repeat.result.state.remanence[0][0],200,1e-10);
  s.updateProblem({...data,uniformH:[0,0,0]});const off=await s.solveFrame({time:1});close(off.result.state.remanence[0][0],200,1e-10);
  s.updateProblem({...data,uniformH:[-4000,0,0]});const reversed=await s.solveFrame({time:2});close(reversed.result.state.remanence[0][0],-600,1e-10);
  s.updateProblem({...data,uniformH:[0,0,0]});const retained=await s.solveFrame({time:3});close(retained.result.state.remanence[0][0],-600,1e-10);s.dispose();
});

function magnets(){return scene(hard(),[0,0,0],{objects:[{id:'a',translation:[-.05,0,0]},{id:'b',translation:[.05,0,0]}],samples:[{id:'s1',objectId:'a',materialId:'m',localPosition:[0,0,0],volume:1e-12},{id:'s2',objectId:'b',materialId:'m',localPosition:[0,0,0],volume:1e-12}]});}
test('two-magnet force matches textbook far limit, action/reaction and fixed-moment energy derivative',async()=>{
  const input=magnets(),p=problem(input),r=await solve(p,initial(p));assert.equal(r.metrics.converged,true);
  const a=loads(p,r.state,{selectedOwners:['a']}),b=loads(p,r.state,{selectedOwners:['b']});vclose(a.force,b.force.map(x=>-x),1e-28);
  const expected=3*MU0*(600e-12)**2/(2*Math.PI*.1**4);assert.ok(a.force[0]>0);close(a.force[0]/expected,1,1e-5);
  const dx=1e-6;const e=async sign=>{const data=magnets();data.objects[0].translation[0]+=sign*dx;const q=problem(data);return (await solve(q,initial(q))).state.fixedMomentInteractionEnergy;};
  const fd=-((await e(1))-(await e(-1)))/(2*dx);close(a.force[0]/fd,1,1e-8);
});

test('object rotation rotates local-X magnetization and assembly forces covariantly',async()=>{
  const d=magnets(),p=problem(d),r=await solve(p,initial(p));const f=loads(p,r.state,{selectedOwners:['a']}).force;
  const turned=magnets();turned.objects=turned.objects.map(o=>({...o,translation:rotateZ(o.translation),rotation:[0,0,Math.SQRT1_2,Math.SQRT1_2]}));const q=problem(turned),s=await solve(q,initial(q));
  vclose(s.state.M[0],r.state.M[0],1e-9);vclose(loads(q,s.state,{selectedOwners:['a']}).force,rotateZ(f),1e-25);
});

test('all-owner selection eliminates internal loads; uniform field adds intrinsic torque',async()=>{
  const input=magnets();input.uniformH=[0,0,10];const p=problem(input),r=await solve(p,initial(p));const g=loads(p,r.state,{selectedOwners:['a','b'],pivot:[1,2,3]});
  vclose(g.force,[0,0,0],0);vclose(g.torque,[0,-2*MU0*600e-12*10,0],1e-24);
  assert.throws(()=>loads(p,{...r.state,converged:false},{selectedOwners:['a']}));assert.throws(()=>loads(p,r.state,{selectedOwners:['a','a']}));
});

test('nonconvergence cannot replace a previously committed physical state or expose certified loads',async()=>{
  const input=scene(soft(3,1000));const s=session(input,{solverOptions:{maxIterations:1,tolerance:1e-14}});assert.equal((await s.solveFrame({time:0})).committed,true);const first=s.getResult();
  s.updateProblem({...input,uniformH:[100,0,0]});const attempted=await s.solveFrame({time:1});assert.equal(attempted.committed,false);assert.equal(s.inspect().revision,1);assert.equal(s.getResult(),first);assert.equal(s.inspect().dirty,true);s.dispose();
});

test('cooperative abort and stale source edit do not commit partial state',async()=>{
  let s,once=true;s=session(scene(soft(100,1000),[10,0,0]),{solverOptions:{yieldEvery:1,yieldControl:async()=>{if(once){once=false;s.updateProblem(scene(soft(100,1000),[20,0,0]));}}}});
  await assert.rejects(s.solveFrame({time:0}),/aborted/);assert.equal(s.inspect().revision,0);assert.equal(s.getResult(),null);assert.equal((await s.solveFrame({time:0})).committed,true);s.dispose();
  const ac=new AbortController();const a=session(scene(soft(),[2,0,0]),{solverOptions:{yieldEvery:1,yieldControl:async()=>ac.abort()}});await assert.rejects(a.solveFrame({time:0,signal:ac.signal}),/aborted/);assert.equal(a.inspect().revision,0);a.dispose();
});

test('material/layout edits require an explicit reset; detached methods have no hidden receiver requirement',async()=>{
  const s=session(scene(hard()));await s.solveFrame({time:0});const update=s.updateProblem;assert.throws(()=>update(scene(hard(0))),/resetProblem/);assert.equal(s.inspect().dirty,false);
  const reset=s.resetProblem;reset(scene(hard(0)));assert.equal(s.getResult(),null);assert.equal(s.inspect().dirty,true);const r=await s.solveFrame({time:0});vclose(r.result.state.M[0],[0,0,0]);s.dispose();
});

test('source/state layouts and nonfinite physical outputs are rejected before publication',async()=>{
  const p=problem(scene()),state=initial(p);await assert.rejects(solve(p,{...state,layoutKey:'wrong'}),/layout mismatch/);
  const huge=scene(hard(),[1e308,0,0]);huge.samples[0].volume=1e300;const q=problem(huge);await assert.rejects(solve(q,initial(q)),/finite|unrepresentable|nonfinite/);
});

test('128-sample reference operation has a completed-operation budget and reports its bounded scope',async()=>{
  const input=scene(hard());input.samples=Array.from({length:128},(_,i)=>({id:`s${i}`,objectId:'a',materialId:'m',localPosition:[i*.01,0,0],volume:1e-12}));
  const p=problem(input),start=performance.now(),r=await solve(p,initial(p));const wallMs=performance.now()-start;assert.equal(r.metrics.converged,true);assert.ok(wallMs<3000,`${wallMs} ms exceeds 3000 ms`);
  console.log(JSON.stringify({operation:'128-sample CPU reference frame',wallMs,budgetMs:3000,iterations:r.metrics.iterations,evaluations:r.metrics.evaluations}));
});
test('64-sample nonlinear reference frame completes under its bounded CPU budget',async()=>{
  const input=scene(soft(20,1000),[10,2,1]);input.samples=Array.from({length:64},(_,i)=>({id:'soft-'+i,objectId:'a',materialId:'m',localPosition:[i*.01,0,0],volume:1e-12}));
  const p=problem(input),start=performance.now(),r=await solve(p,initial(p));const wallMs=performance.now()-start;
  assert.equal(r.metrics.converged,true,JSON.stringify(r.metrics));assert.ok(r.metrics.iterations>0);assert.ok(wallMs<3000,wallMs+' ms exceeds 3000 ms');
  console.log(JSON.stringify({operation:'64-sample nonlinear CPU reference frame',wallMs,budgetMs:3000,iterations:r.metrics.iterations,evaluations:r.metrics.evaluations}));
});
