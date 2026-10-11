'use strict';
const {base,candidate,context,assert,same,writeReceipt}=require('./test-support.cjs'),checks=[];
const rect=[{X:0,Y:0},{X:8,Y:0},{X:8,Y:8},{X:0,Y:8}],originals=[rect],actual=structuredClone(originals),q=context(candidate),old=context(base),expected=Array.from(old.baseline.quality(actual,originals));
const valid=q.baseline.create(originals),foreign=context(candidate),alien=foreign.baseline.create(originals);let accesses=0;
const fake={active:true,originals,edgeKeys(){accesses++;return new Set();},originalArea(){accesses++;return 0;},originalPIP(){accesses++;return 1;}};
const throwing=new Proxy({}, {get(){accesses++;throw Error('No untrusted getter');},has(){accesses++;throw Error('No untrusted has trap');}}),wrapped=new Proxy(valid,{get(){accesses++;throw Error('Wrapped context is foreign');}}),revocable=Proxy.revocable({},{});revocable.revoke();
for(const [name,value]of [['incomplete',{active:true,originals}],['fake',fake],['inherited',Object.create(valid)],['foreign kernel',alien],['throwing Proxy',throwing],['wrapped authentic',wrapped],['revoked Proxy',revocable.proxy],['ordinary getters',{get active(){accesses++;throw Error('No getter');}}]]){const before=q.api.baselineTopologyCacheDiagnostics();same(Array.from(q.baseline.quality(actual,originals,value)),expected,name);same(q.api.baselineTopologyCacheDiagnostics(),before);assert.equal(accesses,0);checks.push(name+' ignored before properties; exact uncached quality');}
for(const value of [null,undefined,false,0,1,'context',Symbol('context')])same(Array.from(q.baseline.quality(actual,originals,value)),expected);checks.push('primitive/missing contexts ignored');
valid.release();alien.release();assert.equal(q.api.baselineTopologyCacheDiagnostics().activeContexts,0);assert.equal(foreign.api.baselineTopologyCacheDiagnostics().activeContexts,0);checks.push('foreign and authentic contexts release fully');
const broken=context(candidate.replace('baselineTopologyFactoryContexts.has(topology)&&',''));
assert.throws(()=>broken.baseline.quality(actual,originals,{active:true,originals}),e=>e.name==='TypeError');checks.push('removed authentication negative detects fake incomplete context');
const falsifier={active:true,originals,edgeKeys:()=>new Set(),originalArea:()=>0,originalPIP:()=>1};assert.deepEqual(Array.from(broken.baseline.quality(actual,originals,falsifier)),[0]);checks.push('removed authentication negative detects forged proof');
let touched=0;assert.throws(()=>broken.baseline.quality(actual,originals,new Proxy({}, {get(){touched++;throw Error('negative proxy');}})),/negative proxy/);assert.equal(touched,1);checks.push('removed authentication negative detects property access');
writeReceipt('authenticity-receipt.json','FRAME_P123_AUTHENTICITY_COMPLETED',checks);
