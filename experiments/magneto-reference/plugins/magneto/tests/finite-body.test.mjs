import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {evaluateCuboidField as evaluate, MU0, FINITE_BODY_CAPABILITIES as caps} from '../finite-body.js';
import {evaluateDirect} from '../direct-kernel.js';
const body=(M=[0,0,1], halfSize=[1,1,1], center=[0,0,0])=>({center,halfSize,magnetization:M});
const run=(bodies,targets)=>evaluate({units:'SI',bodies,targets});
const close=(a,b,tol=2e-12)=>assert.ok(Math.abs(a-b)<=tol*Math.max(1,Math.abs(b)),`${a} != ${b}`);
const vector=(a,b,tol)=>a.forEach((v,k)=>close(v,b[k],tol));
test('cube center H=-M/3 and interior B=mu0(H+M), exterior B=mu0H',()=>{
  const M=[11,-7,19], r=run([body(M)],[[0,0,0],[2,3,4]]);
  vector(r.H[0],M.map(v=>-v/3)); vector(r.B[0],M.map(v=>MU0*2*v/3));
  vector(r.materialM[0],M); vector(r.materialM[1],[0,0,0]); vector(r.B[1],r.H[1].map(v=>MU0*v));
  assert.deepEqual(r.region,['interior','exterior']);
});
test('independent axial rectangular-face solid angles for a bar, inside and outside',()=>{
  const a=.3,b=.7,c=2.4,M=17000;
  // On the symmetry axis each face subtends signed Omega=4 atan(ab/(d sqrt(d²+a²+b²))).
  const omega=d=>4*Math.atan(a*b/(d*Math.sqrt(d*d+a*a+b*b)));
  for(const z of [-12,-2.40001,-1.8,0,1.7,2.40001,12]) {
    const expected=M*(omega(z-c)-omega(z+c))/(4*Math.PI);
    vector(run([body([0,0,M],[a,b,c])],[[0,0,z]]).H[0],[0,0,expected],1e-10);
  }
});
test('signed magnetization, zero, linearity and multi-body superposition including overlaps',()=>{
  const targets=[[.2,.3,.1],[2,3,4]], a=body([3,5,-2]),b=body([-7,2,11],[.7,1.1,.9],[.1,-.1,.2]);
  const A=run([a],targets),B=run([b],targets),both=run([a,b],targets);
  for(let i=0;i<2;i++) {vector(both.H[i],A.H[i].map((v,k)=>v+B.H[i][k]));vector(both.B[i],A.B[i].map((v,k)=>v+B.B[i][k]));}
  assert.equal(both.region[0],'overlap'); vector(both.materialM[0],[-4,7,9]);
  const flipped=run([{...a,magnetization:a.magnetization.map(v=>-3*v)}],targets);
  flipped.H.forEach((v,i)=>vector(v,A.H[i].map(x=>-3*x)));
  const zero=run([body([0,0,0])],targets);zero.H.forEach(v=>vector(v,[0,0,0]));
});
test('far cube field tends to independent point dipole with volume*magnetization moment',()=>{
  const M=[3,-7,11], p=[32,41,-27],distance=Math.hypot(...p),moment=M.map(v=>8*v),dot=moment.reduce((s,v,k)=>s+v*p[k],0);
  const dipole=p.map((v,k)=>(3*v*dot/distance**5-moment[k]/distance**3)/(4*Math.PI));
  const actual=run([body(M)],[p]).H[0];
  assert.ok(Math.hypot(...actual.map((v,k)=>v-dipole[k]))/Math.hypot(...dipole)<2e-6);
});
test('geometric scale and translation covariance across bounded tiny/large SI scales',()=>{
  const a=body([8,-3,2],[.5,.9,1.2]),p=[1.7,.2,-.5],base=run([a],[p]);
  for(const scale of [1e-90,1e-5,13,1e90]) {
    const t=[3,-2,4].map(v=>v*scale),b={...a,center:t,halfSize:a.halfSize.map(v=>v*scale)},q=p.map((v,k)=>v*scale+t[k]);
    vector(run([b],[q]).H[0],base.H[0],3e-12);
  }
});
test('near face field is finite; face interior Bnormal and Htangential are continuous in limit',()=>{
  const a=body([3,5,7],[1,.8,1.2]);
  for(const eps of [1e-3,1e-5,1e-7,1e-9]) {
    const r=run([a],[[1-eps,.2,-.3],[1+eps,.2,-.3]]);
    r.H.flat().forEach(v=>assert.ok(Number.isFinite(v)));
    close(r.H[1][0]-r.H[0][0],3,20*eps);close(r.B[1][0],r.B[0][0],MU0*20*eps);
    close(r.H[1][1],r.H[0][1],20*eps);close(r.H[1][2],r.H[0][2],20*eps);
  }
});
test('undefined surfaces, edges, corners and surface collar reject, even with zero M',()=>{
  for(const p of [[1,0,0],[1,1,0],[1,1,1],[1+5e-11,0,0],[1-5e-11,0,0]]) assert.throws(()=>run([body([0,0,0])],[p]),/surface/);
  // Coplanar extensions outside the actual rectangle are well defined, including an edge-line extension.
  const r=run([body([3,5,7])],[[1,2,.2],[1,1,2]]); r.H.flat().forEach(v=>assert.ok(Number.isFinite(v)));
});
test('bounded numerical domain rejects excessive aspect, distance, coordinates and magnitude',()=>{
  assert.throws(()=>run([body([0,0,1],[1,1,17])],[[0,0,0]]),/aspect/);
  assert.throws(()=>run([body()],[[65,0,0]]),/distance/);
  assert.throws(()=>run([body([0,0,1],[1,1,1],[1e7,0,0])],[[1e7,0,0]]),/resolution/);
  assert.throws(()=>run([body()],[[1e7,0,0]]),/resolution/);
  for(const x of [Infinity,NaN,1e200]) assert.throws(()=>run([body([x,0,1])],[[0,0,0]]));
  assert.throws(()=>run([body([1e-200,0,1])],[[0,0,0]]),/magnetization/);
  assert.throws(()=>run([body([0,0,1],[1e-110,1e-110,1e-110])],[[0,0,0]]),/halfSize/);
  assert.ok(run([body([1e100,-1e100,1e100])],[[0,0,0]]).B[0].every(Number.isFinite));
});
test('strict shapes, dense arrays, capacities and unit quaternions fail closed',()=>{
  const request=()=>({units:'SI',bodies:[body()],targets:[[0,0,0]]});
  for(const change of [r=>r.units='mm',r=>r.bodies[0].radius=1,r=>r.bodies[0].halfSize[0]=0,r=>r.bodies[0].rotation=[0,0,0,2],r=>r.targets=new Array(1),r=>r.bodies=new Array(1),r=>r.targets[0]=[0,0],r=>r.options={},r=>r.bodies=Array.from({length:33},()=>body()),r=>r.targets=Array.from({length:513},()=>[0,0,0])]) {const r=request();change(r);assert.throws(()=>evaluate(r));}
  const r=request();Object.defineProperty(r.bodies[0],'center',{get(){throw new Error('getter called');}});assert.throws(()=>evaluate(r),/accessors/);
  assert.equal(caps.maxBodies,32);assert.equal(caps.maxTargets,512);
});
test('evaluation snapshots inputs, freezes outputs and returns no partial result on a later bad target',()=>{
  const a=body(),points=[[0,0,0]],r=run([a],points);a.magnetization[2]=19;points[0][0]=3;
  close(r.H[0][2],-1/3);assert.ok(Object.isFrozen(r));assert.ok(Object.isFrozen(r.H[0]));
  assert.throws(()=>r.H[0][0]=99,TypeError);assert.throws(()=>run([body()],[[0,0,0],[1,0,0]]),/surface/);
  assert.deepEqual(run([],[[100,100,100]]).H,[[0,0,0]]);assert.equal(run([body()],[]).metrics.targets,0);
});
test('existing softened point-sample interaction is measurably different near a cuboid face',()=>{
  const M=[0,0,1],point=[0,0,1.01],exact=run([body(M)],[point]).H[0][2];
  const softened=evaluateDirect([{objectId:'cube',position:[0,0,0],volume:8,moment:[0,0,8]},{objectId:'target',position:point,volume:1e-12,moment:[0,0,0]}]).H[1][2];
  assert.ok(Math.abs(exact-softened)>Math.abs(exact)*.1);
});
test('bounded timing reports near-face and many-target complete evaluations',()=>{
  const bodies=Array.from({length:32},(_,i)=>body([i+1,-.5,1]));
  for(const mode of ['near-face','many-target']) {
    const targets=Array.from({length:512},(_,i)=>mode==='near-face'?[1+1e-7,.2+(i%16)*.02,-.3+Math.floor(i/16)*.01]:[2+i/16,3+(i%7),4+(i%11)]);
    const start=performance.now(),r=run(bodies,targets),elapsedMs=performance.now()-start;
    const budgetMs=3000;
    assert.equal(r.metrics.faceEvaluations,98304);assert.ok(r.H.flat().every(Number.isFinite));assert.ok(elapsedMs<budgetMs,`${mode} exceeded ${budgetMs}ms CPU fixture budget`);
    console.log(JSON.stringify({operation:`finite-body-${mode}`,bodies:32,targets:512,faceEvaluations:r.metrics.faceEvaluations,elapsedMs,budgetMs}));
  }
});
