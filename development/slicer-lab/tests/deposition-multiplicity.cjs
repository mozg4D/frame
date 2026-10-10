'use strict';
const assert=require('assert/strict'),fs=require('fs'),R=require('../core/rational.cjs');
const {commandedMultiplicity}=require('../core/deposition-multiplicity.cjs');
const {proveRequiredFeedCells}=require('../core/trajectory-union-accuracy.cjs');
const {createAnnulusCore}=require('../core/annulus-route.cjs'),{annulus}=require('./annulus-fixtures.cjs'),{load}=require('../core/adapter.cjs');
let checks=0;const start=performance.now(),unit=[[0,0],[1,0],[1,1],[0,1]],rows=[];
for(const W of [.5,1,2]){
 const square=unit.map(p=>p.map(v=>v*W)),q=commandedMultiplicity([square,square,square]);
 assert.equal(R.number(R.parse(q.commandedDuplicateAreaExactMM2))/(W*W),2);
 assert.equal(R.number(R.parse(q.pairIntersectionSumExactMM2))/(W*W),3);assert(q.positiveTripleCoverage);
 assert(q.commanded2DMultiplicityCertified&&!q.physicalFlowOrVolumeCertified&&!q.physicalDepositionMultiplicityCertified);checks+=4;
 const paths=Array.from({length:3},()=>({points:[[0,.5*W],[W,.5*W]],widths:[W,W]}));
 assert(proveRequiredFeedCells([square],paths,W).requiredCellsCovered);checks++;
 const one=commandedMultiplicity([square]),split=commandedMultiplicity([[[0,0],[.5*W,0],[.5*W,W],[0,W]],[[.5*W,0],[W,0],[W,W],[.5*W,W]]]);
 assert.equal(one.unionAreaExactMM2,split.unionAreaExactMM2);assert.equal(split.commandedDuplicateAreaExactMM2,'0/1');checks+=2;
 rows.push({W,triple:q,coveragePassCannotCertifyDeposition:true});
}
const c=load('optimized-worker.js').context,a=createAnnulusCore().generate({rings:annulus(),W:1,count:1}),
 quads=a.commands.map(q=>c.frameThroughNeckRibbon(q.from,q.to,q.widthStart,q.widthEnd)),actual=commandedMultiplicity(quads),nominal=commandedMultiplicity(quads.slice(0,-1)),
 added=R.sub(R.parse(actual.commandedDuplicateAreaExactMM2),R.parse(nominal.commandedDuplicateAreaExactMM2));
assert.equal(actual.pairMinusDuplicateExactMM2,'0/1');assert.equal(nominal.pairMinusDuplicateExactMM2,'0/1');
assert(Math.abs(R.number(added)-a.geometry.charge.chargeUpperBoundMM2)<1e-12);checks+=3;
const adjacent=[[[0,-.5],[4,-.5],[4,.5],[0,.5]],[[0,.5],[4,.5],[4,1.5],[0,1.5]]],
 straight=[['17/10','0/1'],['23/10','0/1'],['23/10','1/1'],['17/10','1/1']],
 straightMetrics=commandedMultiplicity([...adjacent,straight]),diagonalMetrics=commandedMultiplicity([...adjacent,c.frameThroughNeckRibbon([2,0],[3,1],.6,.6)]);
assert.equal(straightMetrics.commandedDuplicateAreaExactMM2,'3/5');assert(R.number(R.parse(diagonalMetrics.commandedDuplicateAreaExactMM2))>.848);
assert.equal(straightMetrics.pairMinusDuplicateExactMM2,'0/1');checks+=3;
const result={status:'PASS',checks,rows,annulus:{actual,nominal,addedCommandedDuplicateAreaExactMM2:R.str(added)},
 connectorNegative:{straight:straightMetrics,diagonal:diagonalMetrics,minimumWorkingWidthNotRelaxed:true},
 physicalFlowValidated:false,totalMS:performance.now()-start};fs.writeFileSync('evidence/deposition-multiplicity.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({status:result.status,checks,totalMS:result.totalMS,tripleD:2,tripleP:3,
 annulusD:R.number(R.parse(actual.commandedDuplicateAreaExactMM2)),annulusPMinusD:actual.pairMinusDuplicateExactMM2,
 annulusNominalD:R.number(R.parse(nominal.commandedDuplicateAreaExactMM2)),annulusAddedD:R.number(added),physicalFlowValidated:false}));
