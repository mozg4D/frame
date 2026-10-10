'use strict';
const fs=require('fs'),assert=require('assert/strict'),{createExactCells}=require('../experiments/T-exact-cells.cjs');
const square=[[[0,0],[2,0],[2,2],[0,2]]];let checks=0;
const n=1n<<1024n,raw=n+'/'+n;assert.equal(raw.length,619);checks++;
for(const value of [raw,'-'+raw,'0/'+n]){assert.throws(()=>createExactCells([[[value,0],[0,1],[0,0]]]),/representation/);checks++;assert.throws(()=>createExactCells(square).difference(square,[[[value,0],[0,1],[0,0]]]),/representation/);checks++;}
assert.throws(()=>createExactCells([[[{n,d:n},0],[0,1],[0,0]]]),/representation/);checks++;
const edge=1n<<1023n;assert.equal(createExactCells([[[edge+'/'+edge,0],[0,1],[0,0]]]).measure().unionAreaExactMM2,'1/2');checks++;
const out={passed:true,checks,rawAndReducedPartsBits:1024,reviewer619CharacterCounterexampleRejected:true,rawObjectStringParity:true,positive1024BitBoundary:true};
fs.writeFileSync('evidence/T-raw-rational-string-guard.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out));
