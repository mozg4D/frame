import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createPhysicalStateController as create } from '../physical-state.js';
const state = (value = 0) => Object.freeze({ remanence: value });
const result = (s, residual = 0, tolerance = 1e-6) => ({ state: s, residual, tolerance });
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const setup = () => { const initial=state(), released=[]; const c=create({initialState:initial,releaseState:s=>released.push(s)}); return {c,initial,released}; };
const converge = async (c, time, s=state()) => { const step=c.beginStep({time}); await step.iterate(()=>result(s)); step.commit(); return s; };

test('input contracts are strict and do not coerce physical time', () => {
  for (const initialState of [null, undefined, 1, 'state', Promise.resolve({})]) assert.throws(()=>create({initialState}));
  const {c}=setup();
  for(const time of [undefined,NaN,Infinity,-Infinity,'0',null]) assert.throws(()=>c.beginStep({time}));
  assert.throws(()=>c.beginStep({time:0,signal:{}}));
  assert.equal(c.inspect().active,null); c.dispose();
});

test('a converged trial is the only physical publication point', async () => {
  const {c,initial,released}=setup(); const next=state(2); const step=c.beginStep({time:0});
  await step.iterate(({baseState})=>{assert.equal(baseState,initial);return result(next)});
  assert.equal(c.inspect().revision,0); assert.equal(c.inspect().time,null); assert.deepEqual(released,[]);
  step.commit(); assert.equal(c.inspect().revision,1); assert.equal(c.inspect().time,0);
  assert.throws(()=>step.commit(),/closed|stale/); assert.deepEqual(released,[]);
  c.dispose(); assert.deepEqual(new Set(released),new Set([initial,next])); assert.equal(released.length,2);
});

test('all nonlinear iterations use one fixed persistent baseline', async () => {
  const {c,initial,released}=setup(); const step=c.beginStep({time:1}); let last=null;
  for(let i=1;i<=8;i++) await step.iterate(({baseState,previousState,iteration})=>{
    assert.equal(baseState,initial); assert.equal(previousState,last); assert.equal(iteration,i);
    const next=state(baseState.remanence+2); last=next; return result(next,i===8?0:1);
  });
  assert.equal(last.remanence,2); assert.equal(released.length,7); step.commit();
  const later=c.beginStep({time:2}); await later.iterate(({baseState})=>{assert.equal(baseState,last);return result(state(4))});later.commit();c.dispose();
});

test('repeated Solve Frame recomputes from preceding physical state', async () => {
  const {c,initial,released}=setup(); const first=await converge(c,5,state(10));
  const step=c.beginStep({time:5}); const rerun=state(10);
  await step.iterate(({baseState})=>{assert.equal(baseState,initial);return result(rerun)});step.commit();
  assert.ok(released.includes(first)); assert.ok(!released.includes(initial));
  const advanced=c.beginStep({time:6}); await advanced.iterate(({baseState})=>{assert.equal(baseState,rerun);return result(state(20))});advanced.commit();
  assert.ok(released.includes(initial)); assert.throws(()=>c.beginStep({time:5}),/checkpoint/);c.dispose();
});

test('unconverged, incomplete and invalid results cannot commit', async () => {
  const {c,initial,released}=setup(); const step=c.beginStep({time:0});assert.throws(()=>step.commit(),/converged/);
  await step.iterate(()=>result(state(),0.01,0.001)); assert.throws(()=>step.commit(),/converged/);
  for(const invalid of [null, {},result(null),result(initial),result(state(),NaN),result(state(),-1),result(state(),0,Infinity),result(state(),0,-1)]) {
    await assert.rejects(step.iterate(()=>invalid));assert.throws(()=>step.commit(),/converged/);
  }
  assert.equal(c.inspect().revision,0);assert.ok(!released.includes(initial));c.dispose();
});

test('failed iteration blocks a previously converged trial until recovery', async () => {
  const {c}=setup();const step=c.beginStep({time:0});await step.iterate(()=>result(state(1)));
  await assert.rejects(step.iterate(()=>{throw Error('backend failed')}),/backend failed/);
  assert.throws(()=>step.commit(),/converged/);await step.iterate(()=>result(state(2)));step.commit();c.dispose();
});

test('concurrent iteration and in-flight commit are rejected', async () => {
  const {c}=setup();const step=c.beginStep({time:0});const gate=deferred();const work=step.iterate(()=>gate.promise);
  await assert.rejects(step.iterate(()=>result(state())),/already pending/);assert.throws(()=>step.commit(),/pending/);
  gate.resolve(result(state()));await work;step.commit();c.dispose();
});

test('supersession rejects late completion and releases only the stale result', async () => {
  const {c,initial,released}=setup();const a=c.beginStep({time:0});const gate=deferred();const late=state(9);let oldSignal;
  const work=a.iterate(({signal})=>{oldSignal=signal;return gate.promise});const b=c.beginStep({time:1});
  assert.equal(oldSignal.aborted,true);gate.resolve(result(late));await assert.rejects(work,/stale/);
  assert.ok(released.includes(late));assert.ok(!released.includes(initial));await b.iterate(()=>result(state(1)));b.commit();c.dispose();
});

test('abort while awaiting holds the previous trial until evaluator finishes', async () => {
  const {c,released}=setup();const step=c.beginStep({time:0});const previous=state(1);await step.iterate(()=>result(previous,1));
  const gate=deferred();const work=step.iterate(({previousState})=>{assert.equal(previousState,previous);return gate.promise});step.abort();
  assert.ok(!released.includes(previous));gate.resolve(result(state(2)));await assert.rejects(work,/stale/);assert.ok(released.includes(previous));c.dispose();
});

test('dispose during evaluation holds baseline and trial leases until completion', async () => {
  const {c,initial,released}=setup();const step=c.beginStep({time:0});const previous=state(1);await step.iterate(()=>result(previous,1));
  const gate=deferred();const work=step.iterate(()=>gate.promise);c.dispose();assert.deepEqual(released,[]);
  gate.resolve(result(state(2)));await assert.rejects(work,/disposed/);assert.ok(released.includes(initial));assert.ok(released.includes(previous));assert.equal(released.length,3);
});

test('reset while evaluating cannot release the in-use physical baseline', async () => {
  const {c,initial,released}=setup();const step=c.beginStep({time:0});const gate=deferred();const work=step.iterate(()=>gate.promise);const reset=state(100);
  c.reset({state:reset});assert.ok(!released.includes(initial));gate.resolve(result(state(2)));await assert.rejects(work,/stale/);
  assert.ok(released.includes(initial));const again=c.beginStep({time:0});await again.iterate(({baseState})=>{assert.equal(baseState,reset);return result(state(101))});again.commit();c.dispose();
});

test('authoring invalidation prevents stale commit but keeps physical state', async () => {
  const {c,initial,released}=setup();const step=c.beginStep({time:0});const trial=state(1);await step.iterate(()=>result(trial));c.invalidate();
  assert.throws(()=>step.commit(),/stale/);assert.ok(released.includes(trial));assert.ok(!released.includes(initial));assert.equal(c.inspect().revision,0);c.dispose();
});

test('clearTransient never evicts committed persistent state', async () => {
  const {c,initial,released}=setup();const committed=await converge(c,1,state(5));c.clearTransient();
  assert.deepEqual(released,[]);assert.equal(c.inspect().time,1);const s=c.beginStep({time:2});await s.iterate(({baseState})=>{assert.equal(baseState,committed);return result(state(6))});s.abort();
  assert.ok(!released.includes(committed));assert.ok(!released.includes(initial));c.dispose();
});

test('checkpoint restore explicitly permits chronological replay', async () => {
  const {c}=setup();await converge(c,10,state(10));const checkpoint=state(3);c.restoreCheckpoint({state:checkpoint,time:3});
  const step=c.beginStep({time:4});await step.iterate(({baseState})=>{assert.equal(baseState,checkpoint);return result(state(4))});step.commit();assert.equal(c.inspect().time,4);c.dispose();
});

test('already aborted and mid-flight external signals are honored', async () => {
  const {c,released}=setup();const controller=new AbortController();controller.abort();assert.throws(()=>c.beginStep({time:0,signal:controller.signal}),/already aborted/);
  const controller2=new AbortController();const step=c.beginStep({time:0,signal:controller2.signal});const gate=deferred();const work=step.iterate(()=>gate.promise);controller2.abort();const late=state(1);
  gate.resolve(result(late));await assert.rejects(work,/stale/);assert.ok(released.includes(late));assert.equal(c.inspect().active,null);c.dispose();
});

test('retired leases, alias candidates and reused trial leases are rejected', async () => {
  const {c,released}=setup();const s=c.beginStep({time:0});const first=state(1);await s.iterate(()=>result(first,1));await s.iterate(()=>result(state(2),1));assert.ok(released.includes(first));
  await assert.rejects(s.iterate(()=>result(first)),/live opaque/);const repeat=state(3);await s.iterate(()=>result(repeat,1));await assert.rejects(s.iterate(()=>result(repeat)),/independent/);c.dispose();
});

test('release callback failure does not make a committed swap uncertain', async () => {
  const c=create({initialState:state(),releaseState:()=>{throw Error('release failure')}});await converge(c,1);await converge(c,2);
  assert.equal(c.inspect().revision,2);assert.equal(c.inspect().time,2);assert.deepEqual(c.inspect().releaseErrors,['release failure']);c.dispose();assert.equal(c.inspect().disposed,true);
});

test('metadata is defensive and controller disposal is idempotent', async () => {
  const {c}=setup();const s=c.beginStep({time:0});await s.iterate(()=>result(state()));const a=s.inspect();a.convergence.residual=100;assert.equal(s.inspect().convergence.residual,0);
  c.inspect().releaseErrors.push('not real');assert.deepEqual(c.inspect().releaseErrors,[]);assert.equal(c.dispose(),true);assert.equal(c.dispose(),false);assert.throws(()=>c.beginStep({time:1}),/disposed/);
});

test('10,000 completed lifecycle steps are bounded and retain only two physical leases', async () => {
  const {c,released}=setup();const start=performance.now();let produced=0;
  for(let i=0;i<10000;i++){await converge(c,i,state(i));produced++;}
  const wallMs=performance.now()-start;assert.ok(wallMs<3000,`completed-operation wall time ${wallMs} ms exceeds 3000 ms`);
  assert.equal(released.length,produced-1);c.dispose();assert.equal(released.length,produced+1);
  console.log(JSON.stringify({operation:'10000 physical state steps',wallMs,budgetMs:3000,createdLeases:produced+1,releasedLeases:released.length}));
});

test('a convergence accessor cannot reenter invalidation and leak a stale candidate', async () => {
  const {c,released}=setup();const s=c.beginStep({time:0});const late=state(9);
  await assert.rejects(s.iterate(()=>({state:late,get residual(){c.invalidate();return 0},tolerance:1e-6})),/stale/);
  assert.ok(released.includes(late));assert.equal(c.inspect().revision,0);c.dispose();
});

test('restoring a completed physical checkpoint cannot apply its transition twice at the same time', async () => {
  const {c}=setup();c.restoreCheckpoint({state:state(3),time:3});assert.equal(c.inspect().canRecomputeTime,false);
  assert.throws(()=>c.beginStep({time:3}),/checkpoint.*twice/);await converge(c,4,state(4));assert.equal(c.inspect().canRecomputeTime,true);
  const step=c.beginStep({time:4});await step.iterate(()=>result(state(4)));step.commit();c.dispose();
});
