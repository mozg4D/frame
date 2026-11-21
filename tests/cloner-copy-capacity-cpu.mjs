import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const text=readFileSync(resolve(process.argv[2]||'index.html'),'utf8');
function span(from,to){
 const i=text.indexOf(from),j=text.indexOf(to,i+from.length);
 assert.ok(i>=0&&j>i,`Exact runtime block missing: ${from}`);
 return text.slice(i,j);
}
const safe=span('    const frameReplicaArrayMax=', '    function surfacePlacements(');
const pathIndices=span('    function frameClonerPathIndices(', '    function frameClonerPathPlan(');
const selection=span('    function unionSelectionBounds(', '\n    function ');
const {frameClonerPlacementCount,countChecked,layout,pathIndex,jump,union,selectionBytes}=new Function(`
 ${safe}${pathIndices}${selection}
 return {frameClonerPlacementCount,countChecked:frameReplicaPlacementCount,layout:frameReplicaLayout,
   pathIndex:frameClonerPathIndices,jump:frameReplicaRandomJump,union:unionSelectionBounds,selectionBytes:frameReplicaSelectionBytes};
`)();

const radial=count=>({type:'radial',count});
const matrix=(x,y,z)=>({type:'matrix','count x':x,'count y':y,'count z':z});
assert.equal(frameClonerPlacementCount(radial(100001)),100001n);
assert.equal(frameClonerPlacementCount({type:'object',count:170000}),170000n);
assert.equal(frameClonerPlacementCount(matrix(500,300,1)),150000n);
assert.equal(frameClonerPlacementCount(matrix(100,100,1000)),10000000n);
assert.equal(frameClonerPlacementCount(matrix(100,100,1001)),10010000n);
assert.equal(frameClonerPlacementCount(matrix(Number.MAX_SAFE_INTEGER,2,7)),126100789566373874n);
assert.throws(()=>frameClonerPlacementCount(radial(Infinity)),/finite safe count/);
assert.throws(()=>frameClonerPlacementCount(radial(Number.MAX_SAFE_INTEGER+1)),/finite safe count/);
assert.equal(countChecked(0xffffffff),0xffffffff);
assert.throws(()=>countChecked(0x100000000),/array length/);

const empty={meshes:2,curves:0,faces:24},a=layout(empty,{meshes:100000,curves:0,faces:1200000});
assert.deepEqual(layout(a,{meshes:50000,curves:0,faces:600000}),{meshes:150002,curves:0,faces:1800024});
assert.equal(layout(empty,{meshes:1,curves:0,faces:0xfffffffe-24}).faces,0xfffffffe);
assert.throws(()=>layout(empty,{meshes:1,curves:0,faces:0xffffffff-24}),/32-bit viewport IDs/);
const maxCar=Math.floor(0xfffffffe/1744);
assert.equal(maxCar,2462710);assert.equal(layout({meshes:0,curves:0,faces:0},{meshes:maxCar,curves:0,faces:maxCar*1744}).faces,4294966240);
assert.throws(()=>layout({meshes:0,curves:0,faces:0},{meshes:maxCar+1,curves:0,faces:(maxCar+1)*1744}),/32-bit viewport IDs/);
assert.equal(selectionBytes(33554432,{maxStorageBufferBindingSize:134217728,maxBufferSize:268435456}),134217728);
assert.throws(()=>selectionBytes(33554433,{maxStorageBufferBindingSize:134217728,maxBufferSize:268435456}),/GPU storage limit/);
assert.throws(()=>layout({meshes:0xffffffff,curves:0,faces:0},{meshes:1,curves:0,faces:0}),/array length/);

// Indexed spline path bounds must match the prior per-placement condition
// exactly, including a negative start offset and near-endpoint tolerance.
for(const length of [1.27,10,23,-1+21.25])for(const step of [.125,1,2.13,60])
 for(const offset of [-102,-.3,0,2.2,20.25,1e-10])for(const closed of [false,true]){
  const old=[],nominal=Math.max(1,Math.floor(length/step+1e-10)+(closed?0:1));
  for(let i=0;i<nominal;i++){const d=i*step+offset;if(closed||d>=0&&d<=length+1e-9)old.push(i);}
  const [start,end]=pathIndex(length,step,offset,closed);
  assert.deepEqual(Array.from({length:end-start},(_,i)=>start+i),old,[length,step,offset,closed].join(','));
 }
assert.deepEqual(pathIndex(15e6,1,0,false),[0,15000001]);
assert.deepEqual(pathIndex(15e6,1,0,true),[0,15000000]);
assert.throws(()=>pathIndex(1,Number.MIN_VALUE,0,false),/safe integer/);

// The indexed generator must use the exact prior global seeded sequence,
// including all draws for placements skipped by alternate source families.
const next=s=>(Math.imul(s,1664525)+1013904223)>>>0;
for(const seed of [1,7,0xfffffffe]){
 const seq=[seed];for(let i=0;i<90000;i++)seq.push(next(seq.at(-1)));
 for(const i of [0,1,2,29,114,1024,9999])
  assert.equal(jump(i*9)(seed),seq[i*9]);
 for(const stride of [1,2,5,97])for(let first=0;first<Math.min(stride,4);first++){
  let value=jump(first*9)(seed);
  for(let i=first;i<10000;i+=stride){
   assert.equal(value,seq[9*i]);
   for(let j=0;j<9;j++)value=next(value);
   value=jump((stride-1)*9)(value);
  }
 }
}
const boxes=Array.from({length:150000},(_,i)=>({min:[-i,0,1],max:[i,10,2]}));
assert.deepEqual(union(boxes),{min:[-149999,0,1],max:[149999,10,2],center:[0,5,1.5]});
assert.equal(union([]),null);
assert.doesNotMatch(span('    function surfacePlacements(', '    async function ensureIndependentGeometry'),/\b100000\b/);
assert.doesNotMatch(span('    function syncReplicas(', '    function syncNativeObjects'),/\b100000\b/);

console.log('Exact Cloner count, real array/face capacity, spline margins, seeded random parity and 150k bounds pass.');
