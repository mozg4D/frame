'use strict';
const fs=require('fs'),assert=require('assert/strict'),R=require('../core/rational.cjs');
const {generateCornerFan}=require('../core/rectangle-corner-fan.cjs'),{hash}=require('../core/mesh-section.cjs');
const {distanceSquared}=require('../core/source-bank-coverage-audit.cjs'),{load}=require('../core/adapter.cjs');
const c=load('optimized-worker.js').context,start=performance.now(),rows=[];let checks=0;
for(const W of [.5,1,2]){
 const source=[[0,0],[20*W,0],[20*W,1.7*W],[0,1.7*W]],before=hash(source),t=performance.now(),q=generateCornerFan(source,W,0);
 assert.equal(hash(source),before);assert(q.accuracy.accepted&&q.completeOriginalCornerApproximationCertified&&q.wholeSourceNozzleAndFeedContained);
 assert.equal(q.selectedCommands.length,0);assert(!q.restartProtocolCertified&&!q.fullRouteWidthNecessityCertified&&!q.routeAccepted);
 assert.equal(q.independentStartsUnqualified,113);assert(q.accuracy.totalUpperBoundMM/W<.02);
 assert(q.commands.every(p=>p.sourceIntervals.length&&p.widthStart===p.widthEnd&&p.widthStart>=.6*W&&p.widthStart<=1.6*W));checks+=7;
 // Independent finite lattice sanity checks do not establish the all-point
 // certificate; that certificate is the source-only analytic derivation.
 const feed=q.commands.map(p=>c.frameThroughNeckRibbon(p.from,p.to,p.widthStart,p.widthEnd).map(p=>p.map(R.exact))),
  bound=R.exact(q.accuracy.totalUpperBoundMM),squared=R.mul(bound,bound);
 for(let x=0;x<=8;x++)for(let y=0;y<=8;y++){
  const p=[x*W/16,y*W/16].map(R.exact),dist=feed.reduce((min,poly)=>{const d=distanceSquared(p,poly);return !min||R.cmp(d,min)<0?d:min;},null);
  assert(R.cmp(dist,squared)<=0);checks++;
 }
 rows.push({W,commands:q.commands.length,constructionAndCornerDeviationBoundW:q.accuracy.totalUpperBoundMM/W,
  wholeSourceFeedAndNozzleContained:true,startsQualified:false,fullLayerAccepted:false,wallMS:performance.now()-t});
}
const source=[[0,0],[20,0],[20,1.7],[0,1.7]];
for(const corner of [1,2,3]){const q=generateCornerFan(source,1,corner);assert(q.wholeSourceNozzleAndFeedContained&&q.accuracy.accepted);checks++;}
const a=generateCornerFan(source),b=generateCornerFan(source.slice().reverse()),geometry=q=>q.commands.map(c=>[c.from,c.to,c.widthStart,c.widthEnd]);
assert.deepEqual(geometry(a),geometry(b));checks++;
assert.throws(()=>generateCornerFan(source,1,0,{aborted:true}),/cancelled/);checks++;
const result={status:'PASS',checks,rows,sourceReferenceIndependent:true,completeCouponProof:'analytic all-point correspondence; lattice sanity is not a positive certificate',
 fullLayersAccepted:0,startsQualified:false,widthNecessityForWholeRoute:false,internalRestartOverlapAuthorized:false,totalMS:performance.now()-start};
fs.writeFileSync('evidence/corner-fan-light.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
