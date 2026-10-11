import {reviewURL} from '../source-paths.mjs';
import assert from 'node:assert/strict';
import * as T from '../fixtures/three-core.mjs';
import {verifySource} from '../verify-source.mjs';
import {verifyCandidate} from './verify-candidate.mjs';
const {DisplayGeometryCache}=await import(reviewURL('../candidate/native-source/display-packets.mjs',import.meta.url));
const {registerRigidGpuGeometry,installRigidGpuAttributeViews,captureRigidGpuGeometry,unregisterRigidGpuGeometry,touchRigidGpuGeometry}=await import(reviewURL('../candidate/native-source/gpu-island-preview.mjs',import.meta.url));
verifySource();verifyCandidate();
const checks=[];
function fixture(){
 const g=new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(Float32Array.of(0,0,0,1,0,0,0,1,0),3)).setAttribute('normal',new T.BufferAttribute(Float32Array.of(0,0,1,0,0,1,0,0,1),3)).setIndex(new T.BufferAttribute(Uint32Array.of(0,1,2),1));
 const cache=new DisplayGeometryCache(),numeric=cache.capture(g),wire=new T.BufferGeometry().setAttribute('position',g.attributes.position).setIndex(new T.BufferAttribute(Uint32Array.of(0,1,1,2,2,0),1)),seed=cache.capture(wire);
 // The trusted preseed contract installed by actual editor Bind is covered by
 // v4f-preinstalled-packed-bind-controls; here isolate each native guard.
 seed.positions=numeric.positions;seed.indices=wire.index.array;
 let current=true;const e=registerRigidGpuGeometry(g,numeric,{isCurrent:()=>current});installRigidGpuAttributeViews(e);
 return{g,cache,numeric,wire,seed,e,owner(v){current=v;},dispose(){unregisterRigidGpuGeometry(g,e);}};
}
for(const [name,mutate]of [
 ['different packed position storage',x=>{x.seed.positions=x.seed.positions.slice();}],
 ['different index storage',x=>{x.seed.indices=x.seed.indices.slice();}],
 ['different vertex count',x=>{x.seed.vertexCount++;}],
 ['normal layout flag',x=>{x.seed.hasNormals=true;}],
 ['UV layout flag',x=>{x.seed.hasUV=true;}],
 ['color layout flag',x=>{x.seed.hasColors=true;}],
 ['non-Float32 extras',x=>{x.seed.extras=new Float64Array(x.seed.extras);}],
 ['wrong extras length',x=>{x.seed.extras=x.seed.extras.slice(1);}],
 ['stale seeded packet',x=>{x.wire.index.needsUpdate=true;}]
]){
 const x=fixture(),expected=x.seed.extras.slice();mutate(x);const row=captureRigidGpuGeometry(x.wire,x.seed);assert.notEqual(row.extras,x.seed.extras,name);assert.equal(row.extras.length,x.numeric.vertexCount*9);assert.deepEqual([...row.extras],[...expected]);assert(row.isCurrent());x.dispose();checks.push(name+' uses validated fresh alias extras');
}
{
 const x=fixture();x.seed.isCurrent=()=>{throw Error('injected row guard');};assert.throws(()=>captureRigidGpuGeometry(x.wire,x.seed),/injected row guard/);assert(!x.e.aliases.has(x.wire));assert(!x.e.rows.has(x.wire));x.seed.isCurrent=()=>true;assert.equal(captureRigidGpuGeometry(x.wire,x.seed).extras,x.seed.extras);x.dispose();checks.push('failed seed currentness evaluation publishes neither alias nor packet and can retry');
}
{
 const x=fixture();x.wire.index.array[0]=3;x.wire.index.needsUpdate=true;assert.throws(()=>captureRigidGpuGeometry(x.wire,x.seed),/out of range/);assert(!x.e.aliases.has(x.wire));assert(!x.e.rows.has(x.wire));x.wire.index.array[0]=0;x.wire.index.needsUpdate=true;assert(captureRigidGpuGeometry(x.wire,x.seed).isCurrent());x.dispose();checks.push('invalid stale seed publishes neither alias nor packet and repaired IDs can retry');
}
{
 const x=fixture(),a=captureRigidGpuGeometry(x.wire,x.seed);assert.equal(a.extras,x.seed.extras);assert.equal(captureRigidGpuGeometry(x.wire,x.seed),a);x.wire.setIndex(new T.BufferAttribute(Uint16Array.of(0,2),1));assert.equal(a.isCurrent(),false);const b=captureRigidGpuGeometry(x.wire,x.seed);assert.notEqual(b,a);assert.notEqual(b.extras,a.extras);assert.deepEqual([...b.indices],[0,2]);assert(b.isCurrent());x.dispose();checks.push('index attribute replacement invalidates packet, revalidates Uint16 IDs, and allocates distinct extras');
}
{
 const x=fixture();x.wire.setIndex(new T.BufferAttribute(Int32Array.of(0,1),1));assert.throws(()=>captureRigidGpuGeometry(x.wire,x.seed),/must be unsigned/);assert(!x.e.aliases.has(x.wire));x.dispose();checks.push('signed alias index rejected before cache reuse');
}
{
 const x=fixture(),a=captureRigidGpuGeometry(x.wire,x.seed);x.e.positionView=(i,j)=>x.numeric.positions[i*3+j]+(j===0?4:0);x.g.attributes.position.needsUpdate=true;assert.equal(a.isCurrent(),false);assert.equal(captureRigidGpuGeometry(x.wire,x.seed),null);touchRigidGpuGeometry(x.e);const b=captureRigidGpuGeometry(x.wire,x.seed);assert(b.isCurrent());assert.notEqual(b,a);assert.equal(b.positions,x.numeric.positions);x.dispose();checks.push('raw version bump invalidates owner until explicit touch creates a new packet revision');
}
{
 const x=fixture(),a=captureRigidGpuGeometry(x.wire,x.seed);x.owner(false);assert.equal(a.isCurrent(),false);assert.equal(captureRigidGpuGeometry(x.g,x.numeric),null);assert.equal(captureRigidGpuGeometry(x.wire,x.seed),null);x.dispose();checks.push('retired owner blocks primary and alias captures');
}
{
 const x=fixture(),a=captureRigidGpuGeometry(x.wire,x.seed);x.g.dispose();assert.equal(a.isCurrent(),false);assert.equal(captureRigidGpuGeometry(x.wire,x.seed),null);assert.throws(()=>touchRigidGpuGeometry(x.e),/disposed/);x.dispose();checks.push('geometry disposal retires old alias and refuses subsequent touch');
}
{
 const x=fixture(),a=captureRigidGpuGeometry(x.wire,x.seed),oldX=x.g.attributes.position.getX;assert.equal(unregisterRigidGpuGeometry(x.g,{}),false);assert(a.isCurrent());assert.equal(unregisterRigidGpuGeometry(x.g,x.e),true);assert.notEqual(x.g.attributes.position.getX,oldX);assert.equal(a.isCurrent(),false);assert.equal(captureRigidGpuGeometry(x.wire,x.seed),null);assert.equal(unregisterRigidGpuGeometry(x.g,x.e),false);checks.push('identity-guarded unregister restores wrappers, invalidates aliases, and is idempotent');
}
{
 const x=fixture(),a=captureRigidGpuGeometry(x.wire,x.seed);x.dispose();const nextNumeric=x.cache.capture(x.g),e=registerRigidGpuGeometry(x.g,nextNumeric);installRigidGpuAttributeViews(e);const b=captureRigidGpuGeometry(x.wire,x.seed);assert.notEqual(b.rigidEntry,a.rigidEntry);assert.equal(a.isCurrent(),false);assert(b.isCurrent());unregisterRigidGpuGeometry(x.g,e);checks.push('same geometry can register a replacement owner without reviving retired packets');
}
console.log(JSON.stringify({pass:true,scope:'Exact native source guard and publication matrix on synthetic geometry; no hardware acceptance',checks},null,2));
