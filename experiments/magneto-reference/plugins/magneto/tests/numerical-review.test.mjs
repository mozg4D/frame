import test from 'node:test';
import assert from 'node:assert/strict';
import { createMaterial } from '../materials.js';
import { evaluateDirect, MU0 } from '../direct-kernel.js';
import { createReferenceProblem, createReferenceState, solveReference, referenceLoads, createReferenceSession } from '../reference-solver.js';
const hard=(overrides={})=>createMaterial({kind:'hard',saturationMagnetization:1000,reversibleSusceptibility:0,remanentMagnetization:600,initialRemanenceFraction:1,coerciveField:1000,irreversibleSusceptibility:1,...overrides});
const scene=(m=hard(),uniformH=[0,0,0])=>({units:'SI',materials:{m},objects:[{id:'a'}],samples:[{id:'s',objectId:'a',materialId:'m',localPosition:[0,0,0],volume:1e-9}],uniformH});
const near=(a,b,tol=1e-8)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);

test('review: solved uniform torque overflow fails closed',async()=>{
  const data=scene(hard({coerciveField:1e300}),[0,1e200,0]);data.samples[0].volume=1e200;
  const p=createReferenceProblem(data),r=await solveReference(p,createReferenceState(p));
  assert.equal(r.metrics.converged,true);assert.equal(r.state.fixedMomentInteractionEnergy,0);
  assert.throws(()=>referenceLoads(p,r.state,{selectedOwners:['a']}),/finite|overflow|representable/i);
});

test('review: edited state cannot claim solved load provenance',async()=>{
  const p=createReferenceProblem(scene(hard(),[0,10,0])),r=await solveReference(p,createReferenceState(p));
  const forged=Object.freeze({...r.state,M:Object.freeze([Object.freeze([2000,0,0])])});
  assert.throws(()=>referenceLoads(p,forged,{selectedOwners:['a']}));
});

test('review: shallow copied problem cannot bypass validated source ownership',()=>{
  const p=createReferenceProblem(scene());
  const forged=Object.freeze({...p,uniformH:[NaN,0,0]});
  assert.throws(()=>createReferenceState(forged));
});

test('review: oblique vector saturation matches independent sphere scalar root',async()=>{
  const ms=700,chi=25,H=120,n=[2/3,-1/3,2/3];
  const m=createMaterial({kind:'soft',saturationMagnetization:ms,reversibleSusceptibility:chi});
  const p=createReferenceProblem(scene(m,n.map(v=>v*H))),r=await solveReference(p,createReferenceState(p),{solverOptions:{tolerance:1e-11}});
  assert.equal(r.metrics.converged,true);
  let lo=0,hi=ms;for(let i=0;i<100;i++){const mid=(lo+hi)/2;if(mid-ms*Math.tanh(chi*(H-mid/3)/ms)>0)hi=mid;else lo=mid;}
  r.state.M[0].forEach((v,k)=>near(v,n[k]*(lo+hi)/2,1e-6));
  r.state.B[0].forEach((v,k)=>near(v,MU0*(r.state.H[0][k]+r.state.M[0][k]),1e-16));
});

test('review: self-demagnetized virgin hard pulse has independent root and retains state',async()=>{
  const m=hard({initialRemanenceFraction:0}),data=scene(m,[1200,0,0]),s=createReferenceSession(data);
  const a=await s.solveFrame({time:0});assert.equal(a.committed,true);
  // M = Hext - M/3 - Hc, below remanence saturation: M=150 A/m.
  near(a.result.state.M[0][0],150,1e-5);near(a.result.state.remanence[0][0],150,1e-5);
  const b=await s.solveFrame({time:0});near(b.result.state.M[0][0],150,1e-5);
  s.updateProblem({...data,uniformH:[0,0,0]});const c=await s.solveFrame({time:1});near(c.result.state.M[0][0],150,1e-5);
  s.dispose();
});

test('review: oblique multi-sample group has zero internal resultant and finite-difference force',()=>{
  const samples=[{position:[.01,.02,.03],moment:[.3,-.4,.2],volume:1e-6,objectId:'a'}, {position:[.04,-.02,.01],moment:[-.1,.6,.2],volume:2e-6,objectId:'a'}, {position:[-.06,.07,.03],moment:[.2,.3,-.1],volume:3e-6,objectId:'b'}];
  const all=evaluateDirect(samples,{selectedOwners:['a','b'],pivot:[3,-2,1]});assert.deepEqual(all.selection,{force:[0,0,0],torque:[0,0,0]});
  const r=evaluateDirect(samples,{selectedOwners:['a']});
  for(let k=0;k<3;k++){
    const dx=1e-6,energy=sign=>evaluateDirect(samples.map(s=>({...s,position:s.position.map((v,j)=>v+(s.objectId==='a'&&j===k?sign*dx:0))}))).energy;
    near(r.selection.force[k],-(energy(1)-energy(-1))/(2*dx),1e-8);
  }
});

test('review: non-axis-aligned rigid rotation and translation preserve local state and world loads',async()=>{
  const d=scene(hard(),[12,-17,9]);d.objects=[{id:'a',translation:[.05,.01,-.02]},{id:'b',translation:[-.03,.07,.08]}];
  d.samples=[{id:'s',objectId:'a',materialId:'m',localPosition:[.002,-.001,.003],volume:1e-8},{id:'t',objectId:'b',materialId:'m',localPosition:[-.001,.003,.002],volume:2e-8}];
  const p=createReferenceProblem(d),r=await solveReference(p,createReferenceState(p));
  const pivot=[.1,-.2,.3],a=referenceLoads(p,r.state,{selectedOwners:['a'],pivot});
  const rot=([x,y,z])=>[z,x,y],translation=[1,2,-3],move=v=>rot(v).map((x,i)=>x+translation[i]);
  const q=createReferenceProblem({...d,uniformH:rot(d.uniformH),objects:d.objects.map(o=>({...o,translation:move(o.translation),rotation:[.5,.5,.5,.5]}))});
  const s=await solveReference(q,createReferenceState(q)),b=referenceLoads(q,s.state,{selectedOwners:['a'],pivot:move(pivot)});
  s.state.M.forEach((v,j)=>v.forEach((x,i)=>near(x,r.state.M[j][i],1e-9)));
  b.force.forEach((v,i)=>near(v,rot(a.force)[i],1e-18));b.torque.forEach((v,i)=>near(v,rot(a.torque)[i],1e-18));
  near(s.state.fixedMomentInteractionEnergy,r.state.fixedMomentInteractionEnergy,1e-18);
});

test('review: caller cache edits cannot poison trusted source field or energy',async()=>{
  const data=scene();data.objects.push({id:'wire',translation:[0,.1,0]});
  data.currentBases=[{id:'coil',density:10,samples:[{id:'j',objectId:'wire',localPosition:[0,0,0],basisDensity:[0,0,1],volume:1e-6}]}];
  const p=createReferenceProblem(data),base=createReferenceState(p),basisCache=new Map();
  await assert.rejects(solveReference(p,base,{basisCache}),/private.*cache/i);
  const expected=await solveReference(p,base);
  const actual=await solveReference(p,base);
  assert.equal(actual.state.fixedMomentInteractionEnergy,expected.state.fixedMomentInteractionEnergy);
  assert.deepEqual(actual.state.H,expected.state.H);
});

test('review: integrated prescribed-current loads match fixed-moment energy derivatives and sign',async()=>{
  const data=scene(hard({coerciveField:1e9}));data.objects=[{id:'a',translation:[.03,.02,.01]},{id:'wire',translation:[0,.1,0]}];
  data.currentBases=[{id:'coil',density:2e6,samples:[{id:'j',objectId:'wire',localPosition:[0,0,0],basisDensity:[0,0,1],volume:1e-6}]}];
  const compute=async d=>{const p=createReferenceProblem(d);const r=await solveReference(p,createReferenceState(p));assert.equal(r.metrics.converged,true);return {r,loads:referenceLoads(p,r.state,{selectedOwners:['a']})};};
  const base=await compute(data),dx=1e-6;
  for(let k=0;k<3;k++){
    const shifted=async sign=>compute({...data,objects:data.objects.map(o=>o.id==='a'?{...o,translation:o.translation.map((v,i)=>v+(i===k?sign*dx:0))}:o)});
    const plus=await shifted(1),minus=await shifted(-1),fd=-(plus.r.state.fixedMomentInteractionEnergy-minus.r.state.fixedMomentInteractionEnergy)/(2*dx);
    near(base.loads.force[k],fd,Math.max(1e-18,Math.abs(fd)*1e-7));
  }
  const reversed=await compute({...data,currentBases:data.currentBases.map(b=>({...b,density:-b.density}))});
  reversed.loads.force.forEach((v,i)=>near(v,-base.loads.force[i],1e-18));
  near(reversed.r.state.fixedMomentInteractionEnergy,-base.r.state.fixedMomentInteractionEnergy,1e-18);
});
