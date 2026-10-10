'use strict';
const assert=require('assert/strict'),fs=require('fs'),R=require('../core/rational.cjs');
const {commandedMultiplicity:M,originalMaterialDifference:diff}=require('../core/deposition-multiplicity.cjs');
const {planTBody,createTBodyCandidateCore}=require('../core/T-fill-candidate.cjs');
const {createMeshAllocationCore}=require('../core/mesh-allocation-contract.cjs'),{prism}=require('./mesh-fixtures.cjs');
const unit=[[0,0],[1,0],[1,1],[0,1]],base=[[0,0],[30,0],[30,7],[19,7],[19,24],[12,24],[12,7],[0,7]];
let checks=0;const start=performance.now(),reject=(fn,pattern)=>{assert.throws(fn,pattern);checks++;};
const malformed=[[[0,0],[2,0],[2,1],[1,1],[1,2],[0,2]],[[0,0],[1,1],[0,1],[1,0]],
 [[0,0,0],[1,0,0],[1,1,0],[0,1,0]],[[0,0],[1,0],[1,1],[0,0]],[[0,0],[2,0],[1,0],[2,1],[0,1]],
 [[0,0],[1,0],[NaN,1]],[[0,0],[1,0],[Infinity,1]],[[0,0],[1,0],[{n:1n,d:0n},1]],
 [[0,0],[1,0],[{n:1,d:1},1]],[[0,0],[1,0],[1]],[[0,0],[1,0]],'polygon'];
for(const p of malformed){reject(()=>M([p]));reject(()=>diff([p],[unit]));reject(()=>diff([unit],[p]));}
for(const maxWork of [NaN,Infinity,-Infinity,'1','garbage',null,0,-1,1.5,1000001,Number.MAX_SAFE_INTEGER+1]){
 reject(()=>M([unit],{maxWork}),/integer multiplicity work budget/);reject(()=>diff([unit],[unit],{maxWork}),/integer multiplicity work budget/);
}
const huge=R.rat(1n<<1100n),big=[[R.zero,R.zero],[huge,R.zero],[huge,R.one],[R.zero,R.one]];
for(const p of [big,big.map(p=>p.map(R.str)),unit.map(p=>p.map(v=>v===1?Number.MIN_VALUE:0))]){
 reject(()=>M([p]),/representation budget/);reject(()=>M([p,unit]),/representation budget/);
 reject(()=>diff([p],[]),/representation budget/);reject(()=>diff([unit],[p]),/representation budget/);
}
for(const p of [unit,unit.slice().reverse(),[[0,0],[.5,0],[1,0],[1,1],[0,1]]]){
 assert.equal(M([p]).unionAreaExactMM2,'1/1');assert(diff([p],[unit]).completeOriginalMaterialCovered);checks+=2;
}
reject(()=>M([unit,unit],{maxWork:1}),/work budget/);
const invalid=[0,1,2,4,3,5,6,7].map(i=>base[i]);reject(()=>planTBody(invalid),/orthogonal T/);
reject(()=>planTBody([0,2,4,6,1,3,5,7].map(i=>base[i])),/orthogonal T/);
for(let start=0;start<8;start++)for(const reverse of [false,true])for(let turn=0;turn<4;turn++){
 const s=base.map((_,i)=>base[(start+(reverse?-i:i)+16)%8]).map(p=>{let[x,y]=p;for(let k=0;k<turn;k++)[x,y]=[-y,x];return[x,y];});
 assert.equal(planTBody(s).bodyRows,14);checks++;
}
const g=createTBodyCandidateCore(),owner=createMeshAllocationCore(),precision=[];
for(const W of [33,65]){
 const source=base.map(p=>p.map(v=>2**52+v*W)),q=g.generate({source,W,count:7});
 assert.equal(q.candidatePlanAccuracy.totalUpperBoundMM,1);assert.equal(q.candidatePlanAccuracy.candidatePlanConstructionAccepted,W===65);
 assert(!q.candidatePlanAccuracy.accepted&&!q.ownerAccepted&&!q.candidatePlanAccuracy.shapeDeviationSpecificationResolved);
 assert(q.candidatePlanAccuracy.interpretation.includes('unresolved T candidate'));checks+=4;
 const o=owner.slice(prism(source),{z:.5,W,count:7,mode:'T-body-diagnostic'});
 assert(!o.ownerAccepted&&!o.accuracy.accepted);assert.equal(o.selectedCommands.length,0);checks+=2;
 precision.push({W,constructionErrorMM:1,limitMM:W/50,candidateConstructionAccepted:W===65,ownerAccepted:false});
}
const result={status:'PASS',checks,malformedCases:malformed.length,budgetControls:11,representationBroadPhaseControls:12,
 validCyclicVariants:64,precision,independentNoInputRepair:true,elapsedMS:performance.now()-start};
fs.writeFileSync('evidence/checkpoint19-input-guards.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
