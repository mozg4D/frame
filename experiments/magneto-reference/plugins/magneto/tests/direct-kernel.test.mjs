import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {evaluateDirect as run,evaluateCurrentField,MU0,MAX_DIRECT_SAMPLES} from '../direct-kernel.js';
const sample=(position,moment,objectId='a',volume=1e-6)=>({position,moment,objectId,volume});
const close=(a,b,rtol=1e-8,atol=1e-18)=>assert.ok(Math.abs(a-b)<=atol+rtol*Math.max(Math.abs(a),Math.abs(b)),`${a} != ${b}`);
const vector=(a,b,tol=1e-8)=>a.forEach((x,k)=>close(x,b[k],tol));
const pair=()=>[sample([.03,.01,-.02],[.2,-.1,.3]),sample([-.01,.04,.02],[-.15,.22,.08],'b')];
const rotated=(v,h)=>[Math.cos(h)*v[0]-Math.sin(h)*v[1],Math.sin(h)*v[0]+Math.cos(h)*v[1],v[2]];
test('independent textbook axial and equatorial dipoles in far field',()=>{
  const c=MU0/(4*Math.PI),m=.2,r=2;
  let s=[sample([0,0,0],[0,0,m],'a',1e-18),sample([0,0,r],[0,0,m],'b',1e-18)];
  let result=run(s);
  close(result.B[1][2],2*c*m/r**3,1e-10);
  close(result.energy,-2*c*m*m/r**3,1e-10);
  close(result.forces[1][2],-6*c*m*m/r**4,1e-10);
  s[1].position=[r,0,0]; result=run(s);
  close(result.B[1][2],-c*m/r**3,1e-10);
  close(result.energy,c*m*m/r**3,1e-10);
  close(result.forces[1][0],3*c*m*m/r**4,1e-10);
});
test('analytic pair force is negative energy derivative on both samples',()=>{
  const s=pair(),base=run(s),h=1e-7;
  for(let i=0;i<2;i++) for(let k=0;k<3;k++) {
    const p=structuredClone(s),m=structuredClone(s);p[i].position[k]+=h;m[i].position[k]-=h;
    close(base.forces[i][k],-(run(p).energy-run(m).energy)/(2*h),2e-8);
  }
  vector(base.forces[0],base.forces[1].map(x=>-x));
});
test('intrinsic and selected rigid torque are energy rotation derivatives',()=>{
  const s=pair(),h=1e-6,base=run(s,{selectedOwners:['a'],pivot:[0,0,0]});
  const p=structuredClone(s),m=structuredClone(s);p[0].moment=rotated(p[0].moment,h);m[0].moment=rotated(m[0].moment,-h);
  close(base.torques[0][2],-(run(p).energy-run(m).energy)/(2*h),1e-8);
  p[0].position=rotated(p[0].position,h);m[0].position=rotated(m[0].position,-h);
  close(base.selection.torque[2],-(run(p).energy-run(m).energy)/(2*h),1e-8);
});
test('fields are moment derivatives, H=B/mu0 and energy counts each pair once',()=>{
  const s=pair(),base=run(s),h=1e-6;
  for(let k=0;k<3;k++) {const p=structuredClone(s),m=structuredClone(s);p[0].moment[k]+=h;m[0].moment[k]-=h;close(base.B[0][k],-(run(p).energy-run(m).energy)/(2*h));}
  close(base.energy,-.5*s.reduce((sum,x,i)=>sum+x.moment.reduce((v,m,k)=>v+m*base.B[i][k],0),0));
  vector(base.H[0],base.B[0].map(x=>x/MU0));assert.equal(base.pairCount,1);
});
test('internal forces and torques cannot leak into selected group resultant',()=>{
  const s=pair();s.push(sample([.04,-.03,.08],[.3,.1,-.2],'c'));
  const all=run(s,{selectedOwners:['a','b','c']});assert.deepEqual(all.selection,{force:[0,0,0],torque:[0,0,0]});
  const left=run(s,{selectedOwners:['a','b']}),right=run(s,{selectedOwners:['c']});
  vector(left.selection.force,right.selection.force.map(x=>-x));vector(left.selection.torque,right.selection.torque.map(x=>-x));
  const isolated=run([s[0]],{selectedOwners:['a']});assert.deepEqual(isolated.B,[[0,0,0]]);assert.equal(isolated.energy,0);
});
test('coincidence remains finite with zero pair force and opposite intrinsic torque',()=>{
  const s=pair();s[1].position=[...s[0].position];const r=run(s);
  assert.ok(Number.isFinite(r.energy));vector(r.forces[0],[0,0,0]);vector(r.torques[0],r.torques[1].map(x=>-x));
});
test('support tends monotonically toward textbook field away from support',()=>{
  const s=[sample([0,0,0],[0,0,1],'a',.01),sample([0,0,1],[0,0,0],'b',.01)];
  const exact=2e-7,errors=[1,.5,.25,.125].map(supportScale=>Math.abs(run(s,{supportScale}).B[1][2]-exact));
  errors.slice(1).forEach((e,i)=>assert.ok(e<errors[i]));
});
test('volume refinement preserves total moment and converges to far-field point oracle',()=>{
  // Coincident subdivision isolates weight and support convergence, not spatial volume accuracy.
  const target=sample([0,0,2],[0,0,0],'target',1e-18),errors=[];
  for(const n of [1,8,64]) {
    const s=Array.from({length:n},()=>sample([0,0,0],[0,0,.4/n],'source',1e-3/n));s.push(target);
    errors.push(Math.abs(run(s).B[n][2]-2e-7*.4/8));
  }
  assert.ok(errors[2]<errors[1]&&errors[1]<errors[0]);
});
test('signed current reference reverses and matches independent Biot-Savart far limit',()=>{
  const source={position:[0,0,0],currentDensity:[0,0,2],volume:1e-18,objectId:'wire'};
  const a=evaluateCurrentField([source],[[1,0,0],[0,0,0]]);
  close(a.B[0][1],2e-25,1e-10,1e-35);vector(a.B[1],[0,0,0]);
  source.currentDensity=[0,0,-2];vector(evaluateCurrentField([source],[[1,0,0]]).B[0],a.B[0].map(x=>-x));
});
test('rejects malformed, nonfinite, overflow and capacity without mutating inputs',()=>{
  for(const mutate of [s=>s[1].moment[0]=NaN,s=>s[1].volume=0,s=>s[1].position[1]=Infinity,s=>s[1].objectId='',s=>s[1].moment=[1,2]]) {const s=pair();mutate(s);assert.throws(()=>run(s));}
  assert.throws(()=>run(Array(MAX_DIRECT_SAMPLES+1).fill(pair()[0])));
  assert.throws(()=>run(Array(1)));assert.throws(()=>run([{...pair()[0],moment:Array(3)}]));
  assert.throws(()=>evaluateCurrentField([],Array(1)));
  assert.throws(()=>run(pair(),{supportScale:0}));assert.throws(()=>run(pair(),{selectedOwners:['missing']}));
  const overflow=pair();overflow[0].moment=[1e308,1e308,1e308];overflow[1].moment=[1e308,1e308,1e308];assert.throws(()=>run(overflow));
  const s=pair(),copy=structuredClone(s);run(s);assert.deepEqual(s,copy);
});
test('CPU reference bounded throughput smoke budget, not a GPU benchmark',t=>{
  const s=Array.from({length:256},(_,i)=>sample([i*.01,(i%7)*.02,(i%11)*.03],[.01,.02,.03],String(i)));
  const start=performance.now();const result=run(s);const ms=performance.now()-start;
  assert.equal(result.pairCount,32640);assert.ok(ms<5000,`256 samples took ${ms} ms`);t.diagnostic(`256 samples / 32640 pairs: ${ms.toFixed(2)} ms; generous CI budget 5000 ms`);
});


import {evaluatePrescribedCurrentLoads as currentLoads} from '../direct-kernel.js';
const currents=()=>[{position:[-.02,.01,.03],currentDensity:[2e4,-3e4,4e4],volume:2e-6,objectId:'current'}];
test('prescribed-current loads differentiate fixed-current energy and match field API',()=>{
  const sources=currents(),dipoles=pair(),base=currentLoads(sources,dipoles),h=1e-7;
  const field=evaluateCurrentField(sources,dipoles.map(s=>s.position));
  base.B.forEach((v,i)=>vector(v,field.B[i]));
  for(let i=0;i<dipoles.length;i++) for(let k=0;k<3;k++) {
    const p=structuredClone(dipoles),m=structuredClone(dipoles);p[i].position[k]+=h;m[i].position[k]-=h;
    close(base.forces[i][k],-(currentLoads(sources,p).fixedMomentEnergy-currentLoads(sources,m).fixedMomentEnergy)/(2*h),2e-8);
  }
});
test('prescribed-current intrinsic and selected rigid torques match energy derivatives',()=>{
  const sources=currents(),dipoles=pair(),pivot=[.01,-.02,.03],h=1e-6;
  const base=currentLoads(sources,dipoles,{selectedOwners:['a'],pivot});
  const p=structuredClone(dipoles),m=structuredClone(dipoles);
  p[0].moment=rotated(p[0].moment,h);m[0].moment=rotated(m[0].moment,-h);
  close(base.torques[0][2],-(currentLoads(sources,p).fixedMomentEnergy-currentLoads(sources,m).fixedMomentEnergy)/(2*h),2e-8);
  p[0].position=rotated(p[0].position.map((x,k)=>x-pivot[k]),h).map((x,k)=>x+pivot[k]);
  m[0].position=rotated(m[0].position.map((x,k)=>x-pivot[k]),-h).map((x,k)=>x+pivot[k]);
  close(base.selection.torque[2],-(currentLoads(sources,p).fixedMomentEnergy-currentLoads(sources,m).fixedMomentEnergy)/(2*h),2e-8);
});
test('current sign reverses all loads and selected aggregation includes only target owners',()=>{
  const sources=currents(),dipoles=pair(),positive=currentLoads(sources,dipoles,{selectedOwners:['a','b']}),negativeSources=structuredClone(sources);
  negativeSources[0].currentDensity=negativeSources[0].currentDensity.map(x=>-x);
  const negative=currentLoads(negativeSources,dipoles,{selectedOwners:['a','b']});
  for(const key of ['B','H','forces','torques'])positive[key].forEach((v,i)=>vector(v,negative[key][i].map(x=>-x)));
  close(positive.fixedMomentEnergy,-negative.fixedMomentEnergy);
  for(const key of ['force','torque'])vector(positive.selection[key],negative.selection[key].map(x=>-x));
  const a=currentLoads(sources,dipoles,{selectedOwners:['a']}),b=currentLoads(sources,dipoles,{selectedOwners:['b']});
  for(const key of ['force','torque'])vector(positive.selection[key],a.selection[key].map((x,k)=>x+b.selection[key][k]));
  assert.deepEqual(currentLoads(sources,dipoles,{selectedOwners:[]}).selection,{force:[0,0,0],torque:[0,0,0]});
  sources[0].currentDensity=[0,0,0];assert.equal(currentLoads(sources,dipoles).fixedMomentEnergy,0);
});
test('current coincidence finite force has independent analytic value',()=>{
  const sources=[{position:[0,0,0],currentDensity:[0,0,2],volume:1e-6,objectId:'s'}],dipoles=[sample([0,0,0],[0,3,0])];
  const r=currentLoads(sources,dipoles),radius=Math.cbrt(3e-6/(4*Math.PI));
  vector(r.B[0],[0,0,0]);vector(r.torques[0],[0,0,0]);
  close(r.forces[0][0],1e-7*1e-6*6/radius**3);close(r.forces[0][1],0);close(r.forces[0][2],0);
});
test('current loads fail closed on invalid inputs, capacities, overflow and do not mutate',()=>{
  const sources=currents(),dipoles=pair(),original=structuredClone({sources,dipoles});
  currentLoads(sources,dipoles);assert.deepEqual({sources,dipoles},original);
  assert.throws(()=>currentLoads(Array(1),dipoles));assert.throws(()=>currentLoads(sources,Array(1)));
  assert.throws(()=>currentLoads(sources,dipoles,{selectedOwners:['current']}));
  assert.throws(()=>currentLoads(sources,dipoles,{selectedOwners:Array(1)}));
  assert.throws(()=>currentLoads(sources,dipoles,{supportScale:Infinity}));assert.throws(()=>currentLoads(sources,dipoles,{pivot:[NaN,0,0]}));
  assert.throws(()=>currentLoads(sources,Array(MAX_DIRECT_SAMPLES+1).fill(dipoles[0])));
  sources[0].currentDensity=[Infinity,0,0];assert.throws(()=>currentLoads(sources,dipoles));
  sources[0].currentDensity=[1e308,1e308,1e308];dipoles[0].moment=[1e308,1e308,1e308];assert.throws(()=>currentLoads(sources,dipoles));
});
test('prescribed-current CPU reference throughput budget',t=>{
  const sources=Array.from({length:128},(_,i)=>({...currents()[0],position:[i*.01,.01,.03]}));
  const dipoles=Array.from({length:128},(_,i)=>sample([i*.01,-.02,.03],[.01,.02,.03],String(i)));
  const start=performance.now(),result=currentLoads(sources,dipoles),ms=performance.now()-start;
  assert.equal(result.pairCount,16384);assert.ok(ms<5000);t.diagnostic(`128x128 prescribed-current interactions: ${ms.toFixed(2)} ms; CPU CI budget 5000 ms`);
});
