import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
import {buildTopologyWork} from '../../native-source/topology-islands.mjs';
import {rigidIslandEligibilityWork} from '../../native-source/gpu-island-preview.mjs';
const ctx=vm.createContext({Float32Array,Float64Array,Uint32Array,Uint8Array,Int32Array,DataView,ArrayBuffer,Set,Map,WeakMap,Number,Math});vm.runInContext(fs.readFileSync(new URL('../rigid-component-preview.mjs',import.meta.url),'utf8'),ctx);
const finish=g=>{let q;do{q=g.next();}while(!q.done);return q.value;};
const make=(positions,indices,faces)=>{const pa=new Float32Array(positions),ia=new Uint32Array(indices),top=finish(buildTopologyWork({positions:pa,indices:ia},{packedTables:true})),gate=finish(rigidIslandEligibilityWork(top,ia,new Set(faces)));assert(gate.eligible,JSON.stringify(gate));const t={p:{count:pa.length/3},pa,ia,ids:gate.ids,faceIDs:new Uint32Array(faces),slot:new Int32Array(pa.length/3)};for(let k=0;k<t.ids.length;k++)t.slot[t.ids[k]]=k+1;assert(finish(ctx.frameRigidBuildAliasGuard(t)));return t;};
const cases=[];
let t=make([0,0,0,1,0,0,0,1,0,1,1,0],[0,1,2,1,3,2],[0,1]);assert(t.stableFaceComponent);assert(ctx.frameRigidAliasSafe(t));let moved=new Float32Array(t.ids.length*3);for(let k=0;k<t.ids.length;k++)for(let j=0;j<3;j++)moved[k*3+j]=t.pa[t.ids[k]*3+j]+(j===0?2e-6:0);assert(ctx.frameRigidAliasSafe(t,moved));cases.push('Indexed shared edge remains reusable after translation');
t=make([0,0,0,1,0,0,0,1,0,1,0,0,1,1,0,0,1,0],[0,1,2,3,4,5],[0,1]);assert(t.stableFaceComponent);cases.push('Exact coordinate seam proves stable edge connectivity');
t=make([0,0,0,1,0,0,0,1,0,4e-6,0,0],[0,1,2],[0]);assert(!t.stableFaceComponent);moved=new Float32Array(t.ids.length*3);for(let k=0;k<t.ids.length;k++)for(let j=0;j<3;j++)moved[k*3+j]=t.pa[t.ids[k]*3+j]+(j===0?2e-6:0);assert(!ctx.frameRigidAliasSafe(t,moved));cases.push('Unused near alias retains strict split rejection');
t=make([0,0,0,1,0,0,0,1,0,0,0,0,1.000004,0,0,1,1,0],[0,1,2,3,4,5],[0,1]);assert(!t.stableFaceComponent);cases.push('One exact vertex and a near edge do not prove connectivity');
t=make([0,0,0,1,0,0,0,1,0,0.000004,0,0,1.000004,0,0,1,1,0],[0,1,2,3,4,5],[0,1]);assert(!t.stableFaceComponent);cases.push('Only quantized edge bridge retains strict partition proof');
t=make([0,0,0,1,0,0,0,1,0,10,0,0,11,0,0,10,1,0],[0,1,2,3,4,5],[0]);assert(t.stableFaceComponent);moved=new Float32Array(t.ids.length*3);for(let k=0;k<t.ids.length;k++)for(let j=0;j<3;j++)moved[k*3+j]=t.pa[t.ids[k]*3+j]+(j===0?10:0);assert(!ctx.frameRigidAliasSafe(t,moved));cases.push('Outside-island contact still rejects reuse');
assert.equal(finish(ctx.frameRigidStableFaceComponentWork({...t,aliasGuard:{bytes:67108864}})),false);cases.push('Combined proof budget retains conservative fallback');
// Independently rebuild complete topology after transforms. This checks ID reuse,
// not GPU shader arithmetic, crease normals or browser performance.
let checks=0,seed=31;const rand=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
for(let sample=0;sample<80;sample++){
 const p=[],ix=[],faces=[],size=2+sample%6,scale=10**(-3+sample%5),offset=sample%3?4e-6:0;
 for(let row=0;row<2;row++)for(let col=0;col<=size;col++)p.push(col*scale+offset,row*scale,Math.fround(rand()*scale*.1));
 for(let col=0;col<size;col++){const a=col,b=col+1,c=size+1+col,d=c+1;ix.push(a,b,c,b,d,c);faces.push(col*2,col*2+1);}
 const outside=p.length/3;p.push(1e6,1e6,0,1e6+10,1e6,0,1e6,1e6+10,0);ix.push(outside,outside+1,outside+2);const current=make(p,ix,faces);assert(current.stableFaceComponent);
 for(const [dx,angle,stretch]of[[2e-6,0,1],[.123,0,1],[1e8,0,1],[2.7,.731,1],[3.8,0,-1],[.17,.48,1.3]]){
  const after=current.pa.slice(),values=new Float32Array(current.ids.length*3),co=Math.cos(angle),si=Math.sin(angle);
  for(let k=0;k<current.ids.length;k++){const at=current.ids[k]*3,x=current.pa[at],y=current.pa[at+1];values[k*3]=(x*co-y*si)*stretch+dx;values[k*3+1]=(x*si+y*co)*stretch;values[k*3+2]=current.pa[at+2]*stretch;after.set(values.subarray(k*3,k*3+3),at);}
  if(!ctx.frameRigidAliasSafe(current,values))continue;
  const top=finish(buildTopologyWork({positions:after,indices:current.ia},{packedTables:true})),gate=finish(rigidIslandEligibilityWork(top,current.ia,new Set(faces)));assert(gate.eligible);assert.deepEqual(gate.ids,current.ids);checks++;
 }
}
console.log(JSON.stringify({pass:true,scope:'CPU topology and reuse proof only; no affine normal or hardware claim',cases,freshTopologyComparisons:checks}));
