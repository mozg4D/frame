'use strict';
const assert=require('assert/strict'),fs=require('fs'),crypto=require('crypto'),path=require('path'),R=require('../core/rational.cjs');
const {createAnnulusCore}=require('../core/annulus-route.cjs'),{annulus,doubleWindingStar}=require('./annulus-fixtures.cjs'),
 {auditAnnulusRequiredCells}=require('../core/annulus-required-cell-audit.cjs'),{load}=require('../core/adapter.cjs'),
 {hash}=require('../core/mesh-section.cjs');
const core=createAnnulusCore(),c=load('optimized-worker.js').context,start=performance.now(),rows=[];let checks=0,base;
for(const W of [.5,1,2])for(const reversed of [false,true]){
 const source=annulus({W,reversed,subdivisions:reversed?2:1,turn:reversed?1:0,translation:reversed?[8*W,-4*W]:[0,0]}),
  before=hash(source),t=performance.now(),q=core.generate({rings:source,W,count:1});
 assert.equal(hash(source),before);assert.equal(q.status,'full-annulus-protocol-candidate');
 assert(q.wholeMandatorySourceCoveragePassed&&q.wholeSourceAllocationCertified&&q.accuracy.accepted);
 assert(q.geometry.wholeNominalNozzleContained&&q.geometry.wholeFeedContained&&q.geometry.charge.passed);
 assert(q.geometry.coverage.allPointProof&&!q.geometry.coverage.positiveSamplingUsed&&q.geometry.coverage.requiredCellsCovered);
 assert(q.sourceTraversalProtocolCertified&&q.restartAndClosureProtocolCertified&&q.widthNecessityCertified&&q.clockwiseAndOutsideIn);
 assert(q.physicalDirection.clockwise&&q.physicalDirection.signedTwiceAreaMM2.startsWith('-'));
 const newell=q.commands.filter(p=>!p.closure).reduce((s,p)=>s+(p.from[0]-p.to[0])*(p.from[1]+p.to[1]),0);
 assert(newell<0,'physical +Z top-view lap must be clockwise, independently of the Frame sign flag');checks+=2;
 assert.equal(q.commands.length,130);assert.equal(q.independentStartCount,1);assert.equal(q.internalRestartCount,0);
 assert.equal(q.ordinaryWidthPhasesRequired,0);assert(q.commands.every(p=>p.widthStart===p.widthEnd&&p.widthStart>=W&&p.widthStart<=1.6*W));
 assert(q.accuracy.totalUpperBoundMM/W<.02);assert(q.geometry.charge.chargeUpperBoundMM2/(W*W)<.5,JSON.stringify({W,reversed,charge:q.geometry.charge}));
 const exactCharge=R.parse(q.geometry.charge.exactChargeUpperBoundMM2),displayCharge=R.exact(q.geometry.charge.chargeUpperBoundMM2);
 assert(R.cmp(displayCharge,exactCharge)>=0);
 assert(R.cmp(R.sub(displayCharge,exactCharge),R.mul(R.exact(W*W),R.rat(1n,281474976710656n)))<=0);checks+=2;
 const overlap=q.geometry.overlapAccounting;
 assert(overlap.grossAllFinalPairOverlapUpperMM2>W*W);
 assert(Math.abs(overlap.grossAllFinalPairOverlapUpperMM2-overlap.prescribedNominalPairOverlapUpperMM2-overlap.seamAdditionalChargeUpperMM2)<1e-12*W*W);
 assert(!overlap.grossOverlapIsSeamCharge&&!overlap.physicalVolumeOrExtrusionMultiplicityValidated);checks+=3;
 assert(q.seamLengthUpperMM<=.5*W);assert(!q.plan.intentionalDesignGap&&!q.plan.sourceReferenceDerivedFromOutput);
 assert(!q.ownerAccepted&&!q.routeAccepted&&!q.physicalPrintValidated);assert.equal(q.selectedCommands.length,0);checks+=16;
 rows.push({W,reversed,subdivisions:reversed?2:1,commands:q.commands.length,generatorMS:performance.now()-t,
  constructionBoundW:q.accuracy.totalUpperBoundMM/W,actualMaterialBoundW:q.geometry.coverage.upperBoundMM/W,
  seamChargeW2:q.geometry.charge.chargeUpperBoundMM2/(W*W),workingWidthW:q.commands[0].widthStart/W});
 rows.at(-1).grossGeometricPairOverlapW2=q.geometry.overlapAccounting.grossAllFinalPairOverlapUpperMM2/(W*W);
 rows.at(-1).prescribedNominalPairOverlapW2=q.geometry.overlapAccounting.prescribedNominalPairOverlapUpperMM2/(W*W);
 if(W===1&&!reversed)base={source,q};
}
// Independent DIRECT half-plane checks of every actual quad and capsule.
// Convex half-planes and exact endpoint-square bounds establish every point;
// this is not a lattice test or a sample-based positive containment claim.
const t=performance.now(),O=base.source[0].map(p=>p.map(R.exact)),I=base.source[1].map(p=>p.map(R.exact)),
 quads=base.q.commands.map(p=>c.frameThroughNeckRibbon(p.from,p.to,p.widthStart,p.widthEnd)),r2=R.rat(1n,4n);
for(let k=0;k<base.q.commands.length;k++){
 const cmd=base.q.commands[k],ends=[cmd.from,cmd.to].map(p=>p.map(R.exact)),quad=quads[k].map(p=>p.map(R.exact));
 for(let e=0;e<O.length;e++){
  const a=O[e],d=R.vec(O[(e+1)%O.length],a),L2=R.dot(d,d);
  for(const p of ends){const h=R.cross(d,R.vec(p,a));assert(h.n>=0n&&R.cmp(R.mul(h,h),R.mul(r2,L2))>=0);checks++;}
  for(const p of quad){assert(R.cross(d,R.vec(p,a)).n>=0n);checks++;}
 }
 const e=k===0||k>=O.length?0:O.length-k,a=I[e],d=R.vec(I[(e+1)%I.length],a),L2=R.dot(d,d);
 for(const p of ends){const h=R.cross(d,R.vec(p,a));assert(h.n<=0n&&R.cmp(R.mul(h,h),R.mul(r2,L2))>=0);checks++;}
 for(const p of quad){assert(R.cross(d,R.vec(p,a)).n<=0n);checks++;}
}
const directContainmentMS=performance.now()-t;
const missing=structuredClone(quads);missing.splice(5,1);assert.throws(()=>auditAnnulusRequiredCells(base.q.plan,missing,1));checks++;
const narrow=structuredClone(quads);narrow[5]=c.frameThroughNeckRibbon(base.q.commands[5].from,base.q.commands[5].to,.5,.5);
assert(!auditAnnulusRequiredCells(base.q.plan,narrow,1).requiredCellsCovered);checks++;
const coarse=core.generate({rings:annulus({facets:16}),W:1,count:1});assert(!coarse.wholeMandatorySourceCoveragePassed&&!coarse.geometry.coverage.requiredCellsCovered);checks++;
assert.throws(()=>core.generate({rings:doubleWindingStar()}),/single exact radial winding/);checks++;
for(const bad of [
 ()=>core.generate({rings:annulus().concat([[[0,0],[1,0],[0,1]]])}),
 ()=>core.generate({rings:annulus(),count:2}),
 ()=>{const rings=annulus();rings[1][7][0]+=1e-5;return core.generate({rings});},
 ()=>core.generate({rings:annulus({alpha:62/64})}),
 ()=>core.generate({rings:annulus(),signal:{aborted:true}})
]){assert.throws(bad);checks++;}
const revision=crypto.createHash('sha256');
for(const name of fs.readdirSync(path.join(__dirname,'../core')).filter(n=>/\.(cjs|js)$/.test(n)).sort()){
 revision.update(name);revision.update(fs.readFileSync(path.join(__dirname,'../core',name)));
}
const receipt={status:'PASS',checks,kernelRevision:revision.digest('hex'),rows,directContainmentMS,negativeControls:9,doubleOriginalWindingRejected:true,totalMS:performance.now()-start,
 originalMaterialReference:true,allPointOracle:'complete original radial cells to individual actual convex feed quads',
 pureHelperOnly:true,fullLayersOwnerAccepted:0,productionPoolCreated:false,privateFixtureIncluded:false};
fs.writeFileSync('evidence/annulus-light.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
