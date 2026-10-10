'use strict';
const assert=require('assert/strict'),fs=require('fs'),{createExactCells}=require('../experiments/T-exact-cells.cjs');
const square=[[[0,0],[2,0],[2,2],[0,2]]];let checks=0;const reject=(fn,re)=>{assert.throws(fn,re);checks++;};
for(const v of [NaN,Infinity,-1,0,1.5,1537,'576',null])reject(()=>createExactCells(square,{maxCells:v}),/cell capacity/);
for(const v of [NaN,Infinity,-1,0,1.5,1000001,'576',null])reject(()=>createExactCells(square).difference(square,square,{maxWork:v}),/work budget/);
for(const bad of [
 [[[0,0,0],[1,0,0],[0,1,0]]],[[[0,0],[1,0],[0,NaN]]],[[[0,0],[1,0],[0,Infinity]]],
 [[[{n:1n<<1100n,d:1n},0],[0,1],[0,0]]],[[[{n:0n,d:1n<<1100n},0],[0,1],[0,0]]],
 [[['1'+'0'.repeat(340)+'/1',0],[0,1],[0,0]]],[[[{n:1n,d:0n},0],[0,1],[0,0]]],
 [[[0,0],[1,1],[0,1],[1,0]]],[[[0,0],[1,0],[1,0],[0,1]]],[[[0,0],[1,0],[2,0]]],
 [[[0,0],[2,0],[1,1],[2,2],[0,2]]]
]){reject(()=>createExactCells(bad),/dimension|representation|finite|rational|nondegenerate|distinct|convex/);
 reject(()=>createExactCells(square).difference(square,bad),/dimension|representation|finite|rational|nondegenerate|distinct|convex/);}
const q=createExactCells(square);reject(()=>q.cells[0][0][0].n=99n,/read only/);reject(()=>q.cells[0].push([{n:0n,d:1n},{n:0n,d:1n}]),/extensible/);
for(const bits of [1025,1101]){const n=1n<<BigInt(bits-1),raw=n+'/'+n;reject(()=>createExactCells([[[raw,0],[0,1],[0,0]]]),/representation/);reject(()=>q.difference(square,[[[raw,0],[0,1],[0,0]]]),/representation/);}
const edge=1n<<1023n;assert.equal(createExactCells([[[edge+'/'+edge,0],[0,1],[0,0]]]).measure().unionAreaExactMM2,'1/2');checks++;
assert(q.difference(square,q.cells).covered);checks++;
const prepared=q.prepare(square);prepared[0][0][0].n=99n;assert(q.difference(square,q.cells).covered);checks++;
assert.equal(q.measure().unionAreaExactMM2,'4/1');checks++;
const reverse=createExactCells(square.map(p=>p.slice().reverse()));assert.equal(reverse.measure().unionAreaExactMM2,'4/1');checks++;
assert(q.difference(square,square,{order:'bbox-largest-first'}).covered);checks++;
reject(()=>q.difference(square,square,{order:'changed-proof'}),/cell order/);
const out={passed:true,checks,helperGuardsClosed:true,coordinateBits:1024,rawAndReducedStringPartsChecked:true,maxClipWork:1000000,maxCellsDefault:576,maxCellsHardLimit:1536,publicCellsImmutable:true,productionFilesChanged:false};
fs.writeFileSync('evidence/T-exact-cells-guards.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out));
