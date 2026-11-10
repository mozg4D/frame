import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {captureStructuralDomain} from '../capture.js';
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],owner='a'.repeat(32),part='b'.repeat(32);
const html=await readFile(new URL('../../../index.html',import.meta.url),'utf8');
const start=html.indexOf('    function pluginSnapshot('),end=html.indexOf('    function pluginViewport(',start);
assert.ok(start>0&&end>start);const source=html.slice(start,end);
function fixture(){
 const state={revision:0,epoch:'native',world:[...identity],frame:2,transforming:false,signatureSuffix:'',captures:0,stampHook:null};
 const nodes=[{nativeHash:owner,type:'structural',params:{'Voxel size':25}}],device={};
 const resource=new Proxy({},{get(){throw Error('BORROWED RESOURCE TOUCHED');}});
 const mesh=(hash=part,bounds={min:[-10,-10,-10],max:[10,10,10]})=>{if(!nodes.some(n=>n.nativeHash===hash))nodes.push({nativeHash:hash,type:'mesh'});return {hashId:hash,triangleCount:12,vertexCount:8,positions:resource,indices:resource,version:1,frameWorld:[...identity],bounds};};
 const meshes=[mesh()];let serial=0;const identities=new WeakMap(),pluginIdentity=v=>{if(!identities.has(v))identities.set(v,++serial);return identities.get(v);};
 // Execute the actual current-core snapshot function with CPU geometry/resource
 // providers. These providers do no polygon evaluation, rendering or GPU work.
 const native=new Function('nodes','FramePlugins','scene','renderer','FM','objectWorld','pluginIdentity','nativeSurfaceOccurrences','pluginGeometryAccuracy','transformedBox','localMeshBox',source+';return pluginSnapshot;')(
 nodes,{owner:()=>true},{},{device},{inv:()=>identity,mul:(_,m)=>m},()=>state.world,pluginIdentity,()=>meshes,()=>({known:false}),(b)=>b,m=>m.bounds);
 const context={device,document:{nodes,get frame(){return state.frame;},world:()=>state.world},fields:{authoringStamp(){state.stampHook?.();return {epoch:state.epoch,revision:state.revision};}},scene:{get transforming(){return state.transforming;},capture(hash,keys){state.captures++;return native(hash,keys);},signature(hash,keys){return native(hash,keys,false).signature+state.signatureSuffix;}}};
 return {state,context,nodes,meshes,mesh,resource};
}
function authored(capture){const {domain,frame}=capture.descriptor,count=domain.count;return {owner:{source:owner,uid:'owner'},frame,cells:[...domain.cells],spacingMetres:[...domain.spacingMetres],bodies:[{source:part,uid:'material',material:{young:210e9,poisson:.3,density:7800,yieldStrength:250e6},occupancy:Array(count).fill(1)}],fixtures:[{source:'support',uid:'fixture',occupancy:Array.from({length:count},(_,i)=>i%domain.cells[0]===0?1:0)}],forces:[]};}
test('actual current-core capture supplies borrowed geometry but no effective Structural tags',()=>{
 const f=fixture(),c=captureStructuralDomain(f.context,owner),d=c.descriptor,borrowed=c.borrowGeometry();
 assert.deepEqual(d.domain.cells,[4,4,4]);assert.deepEqual(d.domain.spacingMetres,[.025,.025,.025]);assert.equal(d.domain.count,64);
 assert.equal(borrowed[0].positions,f.resource);assert.equal('tags'in borrowed[0],false);assert.equal(d.effectiveTagsAvailable,false);assert.equal(d.occupancy,'unclassified');
 assert.ok(!JSON.stringify(d).includes('positions'));assert.ok(Object.isFrozen(d.domain.cells));assert.equal(d.geometryReadbackBytes,0);c.retire();
});
test('broad phase excludes only proven distant bounds; crossing/unknown bounds retain actual references',()=>{
 const f=fixture();f.meshes.push(f.mesh('c'.repeat(32),{min:[60,0,0],max:[80,1,1]}),f.mesh('d'.repeat(32),{min:[49,0,0],max:[500,1,1]}),f.mesh('e'.repeat(32),null));
 const c=captureStructuralDomain(f.context,owner);assert.deepEqual(c.descriptor.occurrences.map(m=>m.solid),[0,2,3]);assert.equal(c.borrowGeometry().length,3);assert.equal(c.descriptor.occupancy,'unclassified');c.retire();
});
test('repeated occurrences of one source stay distinct, including texture storage',()=>{
 const f=fixture();f.meshes.push({...f.mesh(),paged:true});const c=captureStructuralDomain(f.context,owner);assert.equal(c.descriptor.occurrences.length,2);assert.equal(c.descriptor.occurrences[1].storage,'texture');assert.equal(c.borrowGeometry()[0].hash,c.borrowGeometry()[1].hash);c.retire();
});
test('physical grid accepts rotated nonuniform box and rejects shear/reflection before capture',()=>{
 const f=fixture();f.state.world=[0,2,0,0,-1,0,0,0,0,0,1,0,1000,2000,3000,1];const c=captureStructuralDomain(f.context,owner);assert.deepEqual(c.descriptor.domain.cells,[8,4,4]);c.descriptor.domain.originWorldMetres.forEach((v,k)=>assert.ok(Math.abs(v-[1.05,1.9,2.95][k])<1e-14));c.retire();
 for(const world of [[1,0,0,0,1,1,0,0,0,0,1,0,0,0,0,1],[-1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]]){const bad=fixture();bad.state.world=world;assert.throws(()=>captureStructuralDomain(bad.context,owner),/Sheared|Reflected/);assert.equal(bad.state.captures,0);}
});
test('invalid owner, pitch, capacity and active transform reject before resource capture',()=>{
 for(const change of [f=>f.nodes[0].type='other',f=>f.nodes[0].params['Voxel size']=0,f=>f.nodes[0].params['Voxel size']=1,f=>f.state.transforming=true]){const f=fixture();change(f);assert.throws(()=>captureStructuralDomain(f.context,owner));assert.equal(f.state.captures,0);}
});
test('source replacement, frame and epoch changes invalidate before borrowed access',()=>{
 for(const change of [f=>f.meshes[0].version++,f=>f.state.frame++,f=>f.state.epoch='new',f=>f.state.signatureSuffix='changed',f=>f.context.device={}]){const f=fixture(),c=captureStructuralDomain(f.context,owner);change(f);assert.throws(()=>c.borrowGeometry(),/Stale/);c.retire();}
});
test('native stamp rejects edit-back ABA even when source signature and final world match',()=>{
 const f=fixture(),c=captureStructuralDomain(f.context,owner);f.state.world[12]=3;f.state.world[12]=0;f.state.revision+=2;assert.throws(()=>c.assertCurrent(),/Stale/);c.retire();
});
test('an observed stale capture cannot revive when the frame returns',()=>{
 const f=fixture(),c=captureStructuralDomain(f.context,owner);f.state.frame++;
 assert.throws(()=>c.assertCurrent(),/Stale/);f.state.frame--;
 assert.throws(()=>c.borrowGeometry(),/retired/);c.retire();
});
test('stamp race during capture rejects and retirement revokes all new borrows',()=>{
 const f=fixture();f.state.stampHook=()=>f.state.revision++;assert.throws(()=>captureStructuralDomain(f.context,owner),/Stale/);
 const other=fixture(),c=captureStructuralDomain(other.context,owner);c.retire();c.retire();assert.throws(()=>c.borrowGeometry(),/retired/);assert.throws(()=>c.prepareAuthoredBoundaryCase(authored(c)),/retired/);
});
test('captured grid validates authored boundary conditions without certifying geometry occupancy',()=>{
 const f=fixture(),c=captureStructuralDomain(f.context,owner),input=authored(c),p=c.prepareAuthoredBoundaryCase(input);
 assert.equal(p.problems.length,1);assert.equal(p.geometryClassified,false);assert.equal(p.sceneSolved,false);assert.match(p.occupancyEvidence,/caller-authored/);
 for(const change of [i=>i.frame++,i=>i.owner.source='other',i=>i.cells[0]++,i=>i.spacingMetres[0]*=2,i=>i.fixtures=[]]){const bad=authored(c);change(bad);assert.throws(()=>c.prepareAuthoredBoundaryCase(bad));}c.retire();
});
test('domain metadata does not alias owner/world or source bounds',()=>{
 const f=fixture(),c=captureStructuralDomain(f.context,owner);f.meshes[0].bounds.min[0]=-99;assert.equal(c.descriptor.occurrences[0].bounds.min[0],-10);assert.throws(()=>{c.descriptor.domain.spacingMetres[0]=7;},TypeError);c.retire();
});
test('100 complete CPU capture/validate/retire cycles stay below 2 seconds',()=>{
 const f=fixture(),started=performance.now();for(let i=0;i<100;i++){const c=captureStructuralDomain(f.context,owner);c.prepareAuthoredBoundaryCase(authored(c));c.retire();}const ms=performance.now()-started;assert.ok(ms<2000,`${ms}ms`);console.log(JSON.stringify({operation:'100 source-extracted native capture/boundary/retire cycles',ms,limitMs:2000,hardwareValidated:false}));
});
