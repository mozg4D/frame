import test from 'node:test';
import assert from 'node:assert/strict';
import {activate} from '../plugin.js';
import {nativeCreationFixture,math} from './native-creation-fixture.mjs';

const packed=[.02,0,0,0,.02,0,0,0,.02,0,0,0];
const expected=Array.from(math.unpack(packed));
async function fixture(){
 const native=nativeCreationFixture(),owner=native.create('thermal');native.sync();
 let operations,editor,viewport;
 await activate({version:1,device:null,document:native.context.document,math,
  operations:{register:value=>operations=value},editor:{...native.context.editor,register:value=>{editor=value;native.context.editor.register(value);}},attributes:{register(){}},
  viewport:{register:async value=>viewport=value},requestAttributes(){},requestDraw(){},scene:{capture(){throw Error('Probe creation must not capture geometry.');}}});
 const create=async()=>{const result=await operations.find(o=>o.id==='create-probe').run(owner.nativeHash,{});return native.nodes.find(n=>n.nativeHash===result.hash);};
 return {native,owner,editor,viewport,create};
}
const edgeLengths=(lines,frame)=>Array.from({length:lines.length/6},(_,i)=>{
 const a=math.point(frame,lines.slice(i*6,i*6+3)),b=math.point(frame,lines.slice(i*6+3,i*6+6));return Math.hypot(...a.map((v,k)=>b[k]-v));
});
test('Probe creation installs an actual 2 mm native helper at owner-local origin in one transaction',async()=>{
 const f=await fixture(),probe=await f.create(),hash=probe.nativeHash;
 assert.equal(f.native.transactions,1);assert.equal(probe.parent,f.owner.id);assert.equal(probe.params.Thermal,f.owner.nativeHash);assert.deepEqual(f.native.selected,{hash,area:'objects'});
 assert.deepEqual(Array.from(f.native.packed(hash)),packed);assert.deepEqual(Array.from(f.native.local(hash)),expected);assert.deepEqual(Array.from(f.native.world(hash)),expected);
 assert.equal(Object.hasOwn(probe,'creationFrame'),false);assert.deepEqual(probe.tags,[]);assert.equal(probe.pluginRecords,undefined);
 assert.deepEqual(f.viewport.bounds,{min:[-50,-50,-50],max:[50,50,50]});assert.equal(f.viewport.render,undefined);assert.equal(f.viewport.lines.length,72);
 assert.deepEqual(edgeLengths(f.viewport.lines,f.native.local(hash)),Array(12).fill(2));
 assert.deepEqual(math.point(f.native.local(hash),f.viewport.bounds.min),[-1,-1,-1]);assert.deepEqual(math.point(f.native.local(hash),f.viewport.bounds.max),[1,1,1]);
});
test('actual core reproduces the old transform-only 100 mm Probe defect',async()=>{
 const f=await fixture();f.native.entry.editor={...f.editor,created:n=>{if(n.type==='thermal_probe')n.transform[2]=n.transform[5]=n.transform[8]=.02;}};
 const probe=await f.create();assert.deepEqual([probe.transform[2],probe.transform[5],probe.transform[8]],[.02,.02,.02]);
 assert.equal(f.native.packed(probe.nativeHash),undefined);assert.deepEqual(Array.from(f.native.local(probe.nativeHash)),Array.from(math.I()));
 assert.deepEqual(edgeLengths(f.viewport.lines,f.native.local(probe.nativeHash)),Array(12).fill(100));assert.notDeepEqual(Array.from(f.native.local(probe.nativeHash)),expected);
});
test('standalone Probe has a one-shot native initializer and no inferred Thermal reference',async()=>{
 const f=await fixture(),probe=f.native.create('thermal_probe');assert.deepEqual(probe.creationFrame,packed);assert.equal(probe.parent,null);assert.equal(probe.params.Thermal,'');
 f.native.sync();assert.equal(Object.hasOwn(probe,'creationFrame'),false);assert.deepEqual(Array.from(f.native.local(probe.nativeHash)),expected);assert.deepEqual(Array.from(f.native.world(probe.nativeHash)),expected);
});
test('Probe 2 mm default stays parent-local under translation rotation reflection and anisotropic scaling',async()=>{
 for(const scales of [[2,3,.5],[-2,3,.5]]){
  const f=await fixture(),scale=math.I();[scale[0],scale[5],scale[10]]=scales;
  const ownerWorld=math.mul(math.rotation([1,2,3],.713),scale);ownerWorld.set([100,-200,300],12);f.native.setLocal(f.owner.nativeHash,ownerWorld);
  const probe=await f.create(),local=f.native.local(probe.nativeHash),world=f.native.world(probe.nativeHash);
  assert.deepEqual(Array.from(local),expected);assert.deepEqual(Array.from(world),Array.from(math.mul(ownerWorld,local)));assert.deepEqual(Array.from(world.slice(12,15)),[100,-200,300]);
  assert.deepEqual(edgeLengths(f.viewport.lines,local),Array(12).fill(2));
  for(let axis=0;axis<3;axis++)assert.ok(Math.abs(100*Math.hypot(...world.slice(axis*4,axis*4+3))-2*Math.abs(scales[axis]))<1e-12);
 }
});
test('repeated native sync preserves Probe frame and later authored edits instead of restoring defaults',async()=>{
 const f=await fixture(),probe=await f.create(),hash=probe.nativeHash;
 for(let i=0;i<3;i++)f.native.sync();assert.deepEqual(Array.from(f.native.packed(hash)),packed);
 const edited=math.mul(math.rotation([0,0,1],.37),math.stretch([1,0,0],.5));edited.set([3,4,5],12);f.native.setLocal(hash,edited);
 probe.transform=[99,0,99,99,0,99,99,0,99];for(let i=0;i<3;i++)f.native.sync();
 assert.deepEqual(Array.from(f.native.local(hash)),Array.from(edited));assert.deepEqual(Array.from(f.native.packed(hash)),Array.from(math.pack(edited)));assert.equal(Object.hasOwn(probe,'creationFrame'),false);
});
test('Probe initialization does not change native Thermal or corrected Fan defaults',async()=>{
 const f=await fixture();await f.create();const fan=f.native.create('thermal_fan');f.native.sync();
 assert.deepEqual(Array.from(f.native.local(f.owner.nativeHash)),Array.from(math.I()));assert.deepEqual(Array.from(f.native.packed(fan.nativeHash)),[.3,0,0,0,.3,0,0,0,.1,-25,-12.5,-12.5]);
});
test('32 complete source-extracted native Probe creations and syncs stay below 1500 ms',async()=>{
 const f=await fixture(),started=performance.now();for(let i=0;i<32;i++){const probe=await f.create();assert.deepEqual(Array.from(f.native.packed(probe.nativeHash)),packed);assert.deepEqual(edgeLengths(f.viewport.lines,f.native.local(probe.nativeHash)),Array(12).fill(2));}
 const wallMs=performance.now()-started;assert.ok(wallMs<1500,`${wallMs} ms exceeds 1500 ms`);console.log(JSON.stringify({operation:'32 source-extracted native Probe creations and syncs',wallMs,budgetMs:1500,hardwareVerified:false}));
});
