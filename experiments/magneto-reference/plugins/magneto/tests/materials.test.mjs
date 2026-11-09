import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {createMaterial, validateMaterial, createInitialState, evaluateMaterial} from '../materials.js';
const hard = (extra = {}) => createMaterial({kind:'hard', saturationMagnetization:1000,
  reversibleSusceptibility:.2, remanentMagnetization:600, initialRemanenceFraction:1,
  coerciveField:1000, irreversibleSusceptibility:1, ...extra});
const soft = createMaterial({kind:'soft', saturationMagnetization:1000, reversibleSusceptibility:10});
const close = (a,b,eps=1e-9) => {assert.equal(a.length,b.length); a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<eps, `${a} != ${b}`));};
const evaluate = (m,H,baselineRemanence=createInitialState(m).remanence) => evaluateMaterial(m,{H,baselineRemanence});

test('soft reversible analytic tanh response, zero and saturation', () => {
  assert.equal(validateMaterial(soft),true);
  close(evaluate(soft,[0,0,0]).M,[0,0,0]);
  close(evaluate(soft,[100,0,0]).M,[1000*Math.tanh(1),0,0]);
  close(evaluate(soft,[1e100,0,0]).M,[1000,0,0]);
  close(evaluate(soft,[-1e100,0,0]).M,[-1000,0,0]);
  close(evaluate(soft,[0,0,0]).remanence,[0,0,0]);
});
test('local X reset, zero field remanence, immutable independent sample records',()=>{
  const m=hard(), a=createInitialState(m), b=createInitialState(m);
  close(a.remanence,[600,0,0]); close(evaluate(m,[0,0,0]).M,[600,0,0]);
  assert.notEqual(a,b); assert.notEqual(a.remanence,b.remanence);
  assert.ok(Object.isFrozen(a.remanence));
  assert.throws(()=>{a.remanence[0]=0;});
  const pulse=evaluate(m,[-3000,0,0]); close(pulse.remanence,[-600,0,0]);
  close(createInitialState(m).remanence,[600,0,0]);
});
test('weak reversible perturbation recovers exactly without persistent change',()=>{
  const m=hard(), weak=evaluate(m,[-100,50,0]);
  close(weak.remanence,[600,0,0]); assert.notDeepEqual(weak.M,weak.remanence);
  close(evaluate(m,[0,0,0],weak.remanence).M,[600,0,0]);
});
test('positive/negative pulses persist after field removal, virgin and partial states',()=>{
  const m=hard({initialRemanenceFraction:0});
  close(evaluate(m,[0,0,0]).M,[0,0,0]);
  const partial=evaluate(m,[1300,0,0]); close(partial.remanence,[300,0,0]);
  close(evaluate(m,[0,0,0],partial.remanence).M,[300,0,0]);
  const positive=evaluate(m,[3000,0,0]); close(positive.remanence,[600,0,0]);
  close(evaluate(m,[-800,0,0],positive.remanence).remanence,[200,0,0]);
  close(evaluate(m,[-1000,0,0],positive.remanence).remanence,[0,0,0]);
  const negative=evaluate(m,[-3000,0,0],positive.remanence);
  close(negative.remanence,[-600,0,0]);
  close(evaluate(m,[0,0,0],negative.remanence).M,[-600,0,0]);
});
test('material-specific coercive law and repeated trials use unchanged baseline',()=>{
  const a=hard({initialRemanenceFraction:0}), b=hard({initialRemanenceFraction:0,coerciveField:2000});
  const baseline=[0,0,0], target=evaluate(a,[1300,0,0],baseline);
  assert.ok(target.remanence[0]>0); close(evaluate(b,[1300,0,0],baseline).remanence,baseline);
  for(let i=0;i<100;i++) assert.deepEqual(evaluate(a,[1300,0,0],baseline),target);
  close(baseline,[0,0,0]);
  // An unchanged field in a later physical step is also idempotent for this play law.
  close(evaluate(a,[1300,0,0],target.remanence).remanence,target.remanence);
});
test('isotropic evaluation is rotation covariant, including irreversible vector change',()=>{
  const rotate=([x,y,z])=>[-y,z,-x]; // orthogonal proper rotation
  const m=hard(), H=[-1700,700,350], base=[300,200,-100];
  const a=evaluate(m,H,base), b=evaluate(m,rotate(H),rotate(base));
  close(b.M,rotate(a.M)); close(b.remanence,rotate(a.remanence));
  assert.ok(Math.abs(a.saturation-b.saturation)<1e-12);
});
test('all finite test directions preserve saturation bounds, extreme fields remain finite',()=>{
  const m=hard();
  for(const H of [[1e300,-1e300,1e300],[-1e300,0,0],[0,1e300,0],[3000,2000,-4000]]) {
    const out=evaluate(m,H);
    assert.ok(out.M.every(Number.isFinite)); assert.ok(Math.hypot(...out.M)<=1000*(1+1e-14));
    assert.ok(Math.hypot(...out.remanence)<=600*(1+1e-14));
    assert.ok(out.saturation>=0&&out.saturation<=1);
  }
});
test('reject invalid data, unvalidated materials, inconsistent state and unsupported fields',()=>{
  for(const v of [NaN,Infinity,-1,'100']) assert.throws(()=>hard({coerciveField:v}));
  assert.throws(()=>hard({coerciveField:100}));
  assert.throws(()=>hard({initialRemanenceFraction:1.1}));
  assert.throws(()=>hard({remanentMagnetization:1001}));
  assert.throws(()=>hard({temperature:20}));
  assert.throws(()=>createMaterial({kind:'steel'}));
  assert.throws(()=>validateMaterial({...soft}));
  for(const H of [[NaN,0,0],[1,2],[0,Infinity,0],['1',0,0],[Number.MAX_VALUE,Number.MAX_VALUE,0]]) assert.throws(()=>evaluate(hard(),H));
  assert.throws(()=>evaluateMaterial(soft,{H:[0,0,0]}));
  assert.throws(()=>evaluate(soft,[0,0,0],[1,0,0]));
  assert.throws(()=>evaluate(hard(),[0,0,0],[601,0,0]));
});
test('completed CPU evaluation timing, not native or GPU qualification',t=>{
  const m=hard(), baseline=createInitialState(m).remanence;
  const start=performance.now(); let checksum=0;
  for(let i=0;i<20000;i++) checksum+=evaluate(m,[(i%4000)-2000,100,0],baseline).M[0];
  const elapsed=performance.now()-start;
  assert.ok(Number.isFinite(checksum));
  t.diagnostic(`20000 completed material evaluations: ${elapsed.toFixed(2)} ms; checksum=${checksum}`);
});
