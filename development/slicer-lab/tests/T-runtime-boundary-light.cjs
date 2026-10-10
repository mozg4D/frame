'use strict';
const fs=require('fs'),assert=require('assert/strict'),{compileTExecution,replayTExecution}=require('../experiments/T-runtime-commands.cjs'),{hash}=require('../core/mesh-section.cjs'),{createExactCells}=require('../experiments/T-exact-cells.cjs');
const a=require('../experiments/T-redistributed-central-courses.cjs').createTRedistributedCentralCourses().generate({source:[[0,0],[36,0],[36,7],[21,7],[21,28],[14,28],[14,7],[0,7]],runtimeOnly:true});let checks=0;
for(const change of [q=>delete q.commands[0],q=>delete q.plan.courses[0],q=>delete q.cornerJoins[0],q=>delete q.commands[0].from[0],q=>delete q.cornerJoins[0].exactBasis[0][0],q=>delete q.commands[0].sourceIntervals[0],q=>delete q.cornerJoins[0].sourceIntervals[0].sourceStart[0]]){const q=structuredClone(a);change(q);assert.throws(()=>compileTExecution(q),/sparse/);checks++;}
const raw=structuredClone(a);raw.cornerJoins[0].sourceIntervals[0].exactU0=((1n<<1024n)+'/'+(1n<<1024n));assert.throws(()=>compileTExecution(raw),/raw rational/);checks++;
for(const p of [new Array(1),[[[0,0],[1,0],new Array(2)]]]){assert.throws(()=>createExactCells(p),/sparse/);checks++;}
const r=compileTExecution(a);assert(replayTExecution(r,{generation:1}).finished);checks++;
for(const recompute of [false,true]){const q=structuredClone(compileTExecution(a));q.triangles[0].points[0][0]+=.125;if(recompute)q.bufferSignature=hash({commands:q.commands,cells:q.cells,triangles:q.triangles,execution:q.execution});assert.throws(()=>replayTExecution(q,{generation:1}),/changed T runtime/);checks++;}
assert.throws(()=>replayTExecution(structuredClone(r),{generation:1}),/unowned/);checks++;
const changed=structuredClone(a);changed.commands[0].widthStart+=.125;assert.throws(()=>require('../experiments/T-runtime-commands.cjs').assertOwnedTExecution(r,changed),/changed allocation/);checks++;
assert(Object.isFrozen(r)&&Object.isFrozen(r.commands[0].from)&&Object.isFrozen(r.triangles[0].points[0]));checks++;
const out={passed:true,checks,sparseArraysExplicitlyRejected:true,standaloneTrianglesBoundToOwnedCompilation:true,recomputedSignatureCannotAuthorizeTamper:true,transportRequiresOwnerRecompilation:true,publicRuntimeDeeplyImmutable:true,freshGeneratedAllocation:true};
fs.writeFileSync('evidence/T-runtime-boundary-light.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out));
