import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhysicalStateController as create } from '../physical-state.js';
const result = state => ({state,residual:0,tolerance:0});
test('replacement cannot install a candidate released by its own cancellation', async()=>{
  const released=[];const c=create({initialState:{},releaseState:s=>released.push(s)});
  const trial={};const step=c.beginStep({time:1});await step.iterate(()=>result(trial));
  try { c.reset({state:trial}); } catch { c.dispose(); return; }
  const next=c.beginStep({time:2});await next.iterate(({baseState})=>{assert.ok(!released.includes(baseState),'baseline has already been released');return result({});});c.dispose();
});
test('supersession cannot reopen a controller disposed by an abort listener', async()=>{
  const c=create({initialState:{}});const a=c.beginStep({time:1});let finish;
  const work=a.iterate(({signal})=>{signal.addEventListener('abort',()=>c.dispose(),{once:true});return new Promise(r=>finish=r);});
  let b;try { b=c.beginStep({time:2}); } catch {}
  finish(result({}));await work.catch(()=>{});
  assert.equal(c.inspect().disposed,true);assert.equal(c.inspect().active,null,'disposed controller owns an open step');
});
test('reset cannot resurrect a lease after an abort listener disposes controller', async()=>{
  const released=[];const c=create({initialState:{},releaseState:s=>released.push(s)});const a=c.beginStep({time:1});let finish;
  const work=a.iterate(({signal})=>{signal.addEventListener('abort',()=>c.dispose(),{once:true});return new Promise(r=>finish=r);});
  const replacement={};let accepted=false;try { c.reset({state:replacement});accepted=true; } catch {}
  finish(result({}));await work.catch(()=>{});c.dispose();
  assert.ok(!accepted || released.includes(replacement),'reset accepted ownership after dispose and leaks the replacement');
});
test('stale return alias cannot release the active step candidate', async()=>{
  const released=[];const c=create({initialState:{},releaseState:s=>released.push(s)});const a=c.beginStep({time:1});let finish;
  const old=a.iterate(()=>new Promise(r=>finish=r));const b=c.beginStep({time:2});const shared={};await b.iterate(()=>result(shared));
  finish(result(shared));await old.catch(()=>{});
  assert.ok(!released.includes(shared),'stale result released active candidate');b.commit();c.dispose();
});
test('release callback cannot orphan a reentrant active step during supersession', async()=>{
  let nested;let armed=false;const released=[];let c;
  c=create({initialState:{},releaseState:s=>{released.push(s);if(armed){armed=false;nested=c.beginStep({time:3});}}});
  const a=c.beginStep({time:1});await a.iterate(()=>result({}));armed=true;
  try { c.beginStep({time:2}); } catch (error) { assert.equal(error.name,'MagnetoStateError'); assert.equal(error.message,'Reentrant physical state change'); }
  assert.ok(!nested || nested.inspect().phase !== 'open' || c.inspect().active?.id === nested.inspect().id,'supersession orphaned an open reentrant step');
  c.dispose();
});
