'use strict';
const R=require('./rational.cjs'),{proveRequiredFeedCells}=require('./trajectory-union-accuracy.cjs'),{exactJointCharge}=require('./exact-joint-charge.cjs');
// Bounded prototype: horizontal symmetric channel with two previously printed
// nominal bank endcaps. A geometry certificate is not protocol authorization.
function deriveCapRestart(upper,lower,W,c,{maximumWidth=1.6*W}={}){
 const line=cap=>{const [a,b]=cap.map(p=>p.map(R.exact)),d=R.vec(b,a);if(!d[0].n)throw Error('vertical cap cannot define finite widening restart');const m=R.div(d[1],d[0]),k=R.sub(a[1],R.mul(m,a[0]));return{a,b,d,m,k};},u=line(upper),l=line(lower),gain=R.sub(u.m,l.m);if(!gain.n)throw Error('parallel support caps');
 const point=width=>{const x=R.div(R.sub(R.exact(width),R.sub(u.k,l.k)),gain),y=R.div(R.add(R.add(R.mul(u.m,x),u.k),R.add(R.mul(l.m,x),l.k)),R.rat(2n));return[x,y].map(R.number);};
 const reserve=W*1e-10,from=point(.6*W+reserve),to=point(maximumWidth),widths=[.6*W,maximumWidth-reserve],quad=c.frameThroughNeckRibbon(from,to,...widths),finite=[];
 for(const cap of[u,l])for(const p of[from,to]){const t=R.div(R.dot(R.vec(p.map(R.exact),cap.a),cap.d),R.dot(cap.d,cap.d));finite.push(R.cmp(t,R.zero)>0&&R.cmp(t,R.one)<0);}
 return{points:[from,to],widths,capSupportFinite:finite.every(Boolean),supportParametersStrictlyInside:finite,feedRepresentationReserveMM:reserve,quad,protocolCertified:false,classification:'finite endcap free-space restart geometry; normative width-phase compatibility still required'};
}
function verifySplitRoute(source,nominal,paths,W,c,{restart,adaptiveReference}={}){
 const invariants={sourceNozzle:true,sourceFeed:true,workingWidths:true,finiteRestartSupport:false,priorFeedDisjoint:false,completeNominalBankCoverage:false,completeAdaptiveCoverage:false,jointSeamBudget:false,clockwiseAndOrder:false,closureProtocol:false,sourceAngleAssociations:false,computationalAccuracy:false,restartProtocol:false};
 const {sourceCells,proveFeedInsideSource}=require('./exact-source-feed.cjs'),material=sourceCells(source),owners=[];for(let p=0;p<paths.length;p++)for(let i=1;i<paths[p].points.length;i++){const q=paths[p],a=q.points[i-1],b=q.points[i],nozzle=c.frameThroughNeckExactClearance(a,b,source,W).passed,legacyFloatFeed=c.frameAdaptiveOpenRibbonWithin(a,b,q.widths[i-1],q.widths[i],[source],0),exactFeed=proveFeedInsideSource(c.frameThroughNeckRibbon(a,b,q.widths[i-1],q.widths[i]),source,material),feed=exactFeed.passed;owners.push({path:p,segment:i-1,nozzle,feed,legacyFloatFeed,exactFeed});invariants.sourceNozzle&&=nozzle;invariants.sourceFeed&&=feed;}invariants.workingWidths=paths.every(p=>p.widths.every(w=>w>=.6*W&&w<=1.6*W));
 const quads=p=>p.points.slice(1).map((b,i)=>c.frameThroughNeckRibbon(p.points[i],b,p.widths[i],p.widths[i+1])),all=paths.flatMap(quads),prior=paths.slice(0,2).flatMap(quads),middle=quads(paths[2]),profile=require('vm').runInContext('frameThroughNeckProfile',c);invariants.priorFeedDisjoint=middle.every(q=>prior.every(p=>profile.disjointConvex(q,p)));
 // Recompute support from actual prior ribbons and actual restart commands.
 // Supplied restart flags or coordinates are not owner authority.
 const left=quads(paths[0]),caps=[[left[0][0],left[0][3]],[left.at(-1)[1],left.at(-1)[2]]],supportParameters=[];
 for(const cap of caps){const [a,b]=cap.map(p=>p.map(R.exact)),d=R.vec(b,a),L2=R.dot(d,d);for(const p of paths[2].points.slice(0,2)){const t=R.div(R.dot(R.vec(p.map(R.exact),a),d),L2);supportParameters.push({exactParameter:R.str(t),finite:R.cmp(t,R.zero)>0&&R.cmp(t,R.one)<0});}}
 invariants.finiteRestartSupport=supportParameters.every(q=>q.finite)&&paths[2].widths[0]===.6*W;
 const required=nominal.map((a,i)=>c.frameThroughNeckRibbon(a,nominal[(i+1)%nominal.length],W,W)),coverage=proveRequiredFeedCells(required,paths,W);invariants.completeNominalBankCoverage=coverage.requiredCellsCovered;
 const adaptiveCoverage=adaptiveReference?proveRequiredFeedCells(quads(adaptiveReference),paths,W):null;invariants.completeAdaptiveCoverage=adaptiveCoverage?.requiredCellsCovered===true;
 const jointCharge=exactJointCharge(required,all,W);invariants.jointSeamBudget=jointCharge.passed;
 return{status:'unqualified-split-route',invariants,supportParameters,failedInvariants:Object.keys(invariants).filter(k=>!invariants[k]),owners,coverage,adaptiveCoverage,jointCharge,routeAccepted:false,wholeSourceCoverageCertified:false,wholeTrajectoryDeviationCertified:false,physicalPrintValidated:false};
}
module.exports={deriveCapRestart,verifySplitRoute};
