import test from 'node:test';
import assert from 'node:assert/strict';
import { createMaterial } from '../materials.js';
import { MU0 } from '../direct-kernel.js';
import { createReferenceProblem as problem,createReferenceState as initial,solveReference as solve,createReferenceSession as session,referenceLoads as loads } from '../reference-solver.js';
const close=(a,b,tol)=>assert.ok(Math.abs(a-b)<=tol,a+' != '+b+', tol '+tol);
function fixture(density=1e10,z=.01){
  const R=.02,area=1e-10,N=256;
  return {units:'SI',materials:{m:createMaterial({kind:'hard',saturationMagnetization:1000,reversibleSusceptibility:0,remanentMagnetization:600,initialRemanenceFraction:1,coerciveField:1000,irreversibleSusceptibility:1})},
    objects:[{id:'magnet',translation:[0,0,z],rotation:[0,-Math.SQRT1_2,0,Math.SQRT1_2]},{id:'wire'}],
    samples:[{id:'magnet-sample',objectId:'magnet',materialId:'m',localPosition:[0,0,0],volume:1e-12}],
    currentBases:[{id:'loop',density,samples:Array.from({length:N},(_,i)=>{const a=2*Math.PI*(i+.5)/N;return {id:'wire-'+i,objectId:'wire',localPosition:[R*Math.cos(a),R*Math.sin(a),0],basisDensity:[-Math.sin(a),Math.cos(a),0],volume:area*2*Math.PI*R/N};})}]};
}
test('prescribed closed-ring current fixture matches independent on-axis Biot-Savart field',async()=>{
  const p=problem(fixture()),r=await solve(p,initial(p));assert.equal(r.metrics.converged,true);const H=r.state.H[0][0]+200;
  const exact=.02**2/(2*(.02**2+.01**2)**1.5);close(H/exact,1,2e-6);close(r.state.H[0][1],0,1e-12);close(r.state.H[0][2],0,1e-12);
});
test('signed amplitude changes reuse the normalized target field and preserve physical remanence',async()=>{
  const s=session(fixture());const a=await s.solveFrame({time:0});assert.equal(a.result.metrics.currentBasisBuilds,1);assert.equal(a.result.metrics.currentBasisHits,0);
  s.updateProblem(fixture(-1e10));const b=await s.solveFrame({time:1});assert.equal(b.result.metrics.currentBasisBuilds,0);assert.equal(b.result.metrics.currentBasisHits,1);
  close(b.result.state.H[0][0]+200,-(a.result.state.H[0][0]+200),1e-11);close(b.result.state.remanence[0][0],600,0);
  s.updateProblem(fixture(0));const off=await s.solveFrame({time:2});close(off.result.state.H[0][0],-200,1e-10);assert.equal(off.result.metrics.currentBasisBuilds,0);s.dispose();
});
test('magnet loads in a prescribed ring agree with loop gradient and energy derivative; source reaction is rejected',async()=>{
  const p=problem(fixture()),r=await solve(p,initial(p)),f=loads(p,r.state,{selectedOwners:['magnet'],pivot:[0,0,.01]});
  const exact=-3*MU0*600e-12*.02**2*.01/(2*(.02**2+.01**2)**2.5);assert.ok(f.force[2]<0);close(f.force[2]/exact,1,4e-6);close(f.force[0],0,1e-24);close(f.force[1],0,1e-24);
  const dx=1e-7;const E=async z=>{const q=problem(fixture(1e10,z));return (await solve(q,initial(q))).state.fixedMomentInteractionEnergy;};const fd=-((await E(.01+dx))-(await E(.01-dx)))/(2*dx);close(f.force[2]/fd,1,1e-7);
  assert.throws(()=>loads(p,r.state,{selectedOwners:['wire']}),/source-reaction/);
});
test('current geometry edits rebuild target field cache; invalid quadrature and external cache injection fail closed',async()=>{
  const s=session(fixture());await s.solveFrame({time:0});s.updateProblem(fixture(1e10,.02));const r=await s.solveFrame({time:1});assert.equal(r.result.metrics.currentBasisBuilds,1);s.dispose();
  const bad=fixture();bad.currentBases[0].samples[0].volume=0;assert.throws(()=>problem(bad));
  const sparse=fixture();sparse.currentBases[0].samples=new Array(3);assert.throws(()=>problem(sparse));const p=problem(fixture());await assert.rejects(solve(p,initial(p),{basisCache:new Map()}),/private/);
});
