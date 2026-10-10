'use strict';
// Source-only T BODY construction. This is not an approved full-layer plan.
// Original cap/corner material and restart/closure rules cannot be waived.
const R=require('./rational.cjs'),A=require('./accuracy-contract.cjs');
const {canonicalRing}=require('./contour-core.cjs'),{mapInterval}=require('./provenance.cjs'),{load}=require('./adapter.cjs');
const {sourceCells,proveFeedInsideSource}=require('./exact-source-feed.cjs');
const {commandedMultiplicity,originalMaterialDifference}=require('./deposition-multiplicity.cjs');
const {exactJointCharge}=require('./exact-joint-charge.cjs');
const eq=(a,b)=>R.cmp(a,b)===0,half=q=>R.div(q,R.rat(2n));
function rotate(p,turn){let q=p.slice();for(let i=0;i<turn;i++)q=[R.sub(R.zero,q[1]),q[0]];return q;}
function model(source,W,count){
 const normalized=canonicalRing(source),raw=normalized.ring.map(p=>p.map(R.exact)),w=R.exact(W);let found;
 if(raw.length!==8)throw Error('bounded eight-corner axis-aligned T required');
 for(let turn=0;turn<4&&!found;turn++){
  const P=raw.map(p=>rotate(p,turn)),unique=k=>[...new Map(P.map(p=>[R.str(p[k]),p[k]])).values()].sort(R.cmp),xs=unique(0),ys=unique(1);
  if(xs.length!==4||ys.length!==3)continue;
  const[x0,x1,x2,x3]=xs,[y0,y1,y2]=ys,expected=[[x0,y0],[x3,y0],[x3,y1],[x2,y1],[x2,y2],[x1,y2],[x1,y1],[x0,y1]];
  const starts=expected.map((p,i)=>p.every((v,k)=>eq(v,P[0][k]))?i:-1).filter(i=>i>=0),cyclic=starts.some(start=>[-1,1].some(sign=>
   P.every((p,i)=>p.every((v,k)=>eq(v,expected[(start+sign*i+16)%8][k])))));
  if(!cyclic)continue;
  const integer=q=>{const n=R.div(q,w);if(n.d!==1n||n.n<3n||n.n>BigInt(2*count)||n.n>32n)throw Error('T source bar/stem width requires bounded integral nominal W rows');return Number(n.n);};
  found={P,normalized,turn,x0,x1,x2,x3,y0,y1,y2,barRows:integer(R.sub(y1,y0)),stemRows:integer(R.sub(x2,x1))};
 }
 if(!found)throw Error('exact orthogonal T source required');
 const m=found;
 if([R.sub(m.x1,m.x0),R.sub(m.x3,m.x2),R.sub(m.y2,m.y1)].some(q=>R.cmp(q,R.mul(w,R.rat(2n)))<=0))throw Error('long independent bar arms and stem required');
 return m;
}
function planTBody(source,W=1,count=7,{caps=false}={}){
 if(!(W>0)||!Number.isFinite(W)||!Number.isInteger(count)||count<1||count>64)throw Error('invalid T fill candidate job');
 const m=model(source,W,count),w=R.exact(W),h=half(w),physical=p=>rotate(p,(4-m.turn)%4),rows=[];
 const bank=(axis,value)=>m.P.findIndex((p,i)=>eq(p[axis],value)&&eq(m.P[(i+1)%8][axis],value));
 const bottom=bank(1,m.y0),leftStem=bank(0,m.x1),rightStem=bank(0,m.x2);
 function row(from,to,depth,role,edge){
  const a=physical(from),b=physical(to),p=m.normalized.ring[edge].map(R.exact),d=R.vec(m.normalized.ring[(edge+1)%8].map(R.exact),p),
   at=q=>R.div(R.dot(R.vec(q,p),d),R.dot(d,d));
  const intervals=mapInterval([m.normalized],[source],{ring:0,edge,exactU0:R.str(at(a)),exactU1:R.str(at(b))})
   .map(q=>({...q,role:'original-source-T-body-or-cap-bank',bankGroup:role}));
  rows.push({exactFrom:a.map(R.str),exactTo:b.map(R.str),exactWidth:R.str(w),depth,role,sourceIntervals:intervals});
 }
 for(let k=0;k<m.barRows;k++){
  const y=R.add(m.y0,R.mul(w,R.rat(BigInt(2*k+1),2n))),a=[R.add(m.x0,h),y],b=[R.sub(m.x3,h),y];
  row(...(k<m.barRows/2?[b,a]:[a,b]),Math.min(k,m.barRows-1-k),'bar-body',bottom);
 }
 for(let k=0;k<m.stemRows;k++){
  const x=R.add(m.x1,R.mul(w,R.rat(BigInt(2*k+1),2n))),a=[x,m.y1],b=[x,R.sub(m.y2,h)],low=k<m.stemRows/2;
  row(...(low?[a,b]:[b,a]),Math.min(k,m.stemRows-1-k),'stem-body',low?leftStem:rightStem);
 }
 const bodyRows=rows.length;
 if(caps){
  row([R.add(m.x0,h),R.add(m.y0,h)],[R.add(m.x0,h),R.sub(m.y1,h)],0,'left-original-cap',bank(0,m.x0));
  row([R.sub(m.x3,h),R.sub(m.y1,h)],[R.sub(m.x3,h),R.add(m.y0,h)],0,'right-original-cap',bank(0,m.x3));
  row([R.add(m.x1,h),R.sub(m.y2,h)],[R.sub(m.x2,h),R.sub(m.y2,h)],0,'stem-original-cap',bank(1,m.y2));
 }
 rows.sort((a,b)=>a.depth-b.depth);
 const required=sourceCells(source),targetCells=[],cell=(x0,x1,y0,y1)=>targetCells.push(
  [[x0,y0],[x1,y0],[x1,y1],[x0,y1]].map(physical).map(p=>p.map(R.str)));
 // Candidate P is specified from source extents BEFORE actual commands. It
 // explicitly includes the complete central body, unlike perimeter coupons.
 cell(R.add(m.x0,h),R.sub(m.x3,h),m.y0,m.y1);
 cell(m.x1,m.x2,m.y1,R.sub(m.y2,h));
 if(caps){
  cell(m.x0,R.add(m.x0,w),R.add(m.y0,h),R.sub(m.y1,h));
  cell(R.sub(m.x3,w),m.x3,R.add(m.y0,h),R.sub(m.y1,h));
  cell(R.add(m.x1,h),R.sub(m.x2,h),R.sub(m.y2,w),m.y2);
 }
 return{kind:'source-only-T-body-candidate-reference',source:structuredClone(source),W,count,rows,bodyRows,
  originalMaterialCells:required.map(p=>p.map(v=>v.map(R.str))),
  candidateTargetCells:targetCells,
  candidatePrescribedTargetResolved:false,rulePrescribedTargetResolved:false,
  targetScope:'independent nominal W body/cap polygons; the separately source-derived rounded full-T material target is not attached to this candidate',
  approvedOriginalMaterialExceptions:[],originalMaterialOmittedFromCoverageTarget:false,
  internalRestartOverlapAuthorized:false,capsDiagnostic:caps};
}
function createTBodyCandidateCore(){const c=load('optimized-worker.js').context;return{generate({source,W=1,count=7,caps=false,signal}){
 if(signal?.aborted)throw Error('T fill candidate cancelled');const plan=planTBody(source,W,count,{caps}),paths=[],commands=[];let error=R.zero;
 for(const row of plan.rows){if(signal?.aborted)throw Error('T fill candidate cancelled');const points=[row.exactFrom,row.exactTo].map(p=>p.map(v=>R.number(R.parse(v)))),
  proof=A.provePolylineTransform([row.exactFrom,row.exactTo],points,[[0]],{referenceWidths:[row.exactWidth,row.exactWidth],outputWidths:[W,W],nozzleWidth:W});
  error=A.max(error,R.parse(proof.exactUpperBound));paths.push({points,widths:[W,W],depth:row.depth});
  commands.push({kind:'print',from:points[0],to:points[1],widthStart:W,widthEnd:W,depth:row.depth,role:row.role,sourceIntervals:structuredClone(row.sourceIntervals)});
 }
 const quads=commands.map(q=>c.frameThroughNeckRibbon(q.from,q.to,W,W)),material=sourceCells(source),
  containment=commands.map((q,i)=>({command:i,nozzle:c.frameThroughNeckExactClearance(q.from,q.to,source,W),feed:proveFeedInsideSource(quads[i],source,material)})),
  originalCoverage=originalMaterialDifference(plan.originalMaterialCells,quads),multiplicity=commandedMultiplicity(quads),
  candidateTargetToActual=originalMaterialDifference(plan.candidateTargetCells,quads),actualToCandidateTarget=originalMaterialDifference(quads,plan.candidateTargetCells),
  bodyNominal=plan.rows.filter(row=>row.role==='bar-body'||row.role==='stem-body').map(row=>c.frameThroughNeckRibbon(row.exactFrom.map(s=>R.number(R.parse(s))),row.exactTo.map(s=>R.number(R.parse(s))),W,W)),
  addedCharge=exactJointCharge(bodyNominal,quads,W),candidateCertificate=A.certifyBudget(W,[{name:'independent exact source-only candidate axis/nozzle/feed plan to emitted finite commands',verified:true,exactUpperBound:R.str(error)}]),
  candidatePlanAccuracy={...candidateCertificate,accepted:false,candidatePlanConstructionAccepted:candidateCertificate.accepted,
   computationalTrajectoryDeviationCertified:false,wholeTrajectoryDeviationCertified:false,shapeDeviationSpecificationResolved:false,
   candidateConstructionErrorCertified:true,rulePrescribedTargetResolved:false,CADToTargetDifferenceIncludedAsComputationalError:false,
   interpretation:'computational construction error versus independently defined unresolved T candidate; no user-confirmed complete prescribed plan',
   metric:'additive construction deviation from exact candidate axes, nozzle and ribbon cells; candidate-only, without rule-plan approval'},execution=[];
 commands.forEach((q,i)=>{if(i)execution.push({kind:'travel',from:commands[i-1].to,to:q.from,widthStart:0,widthEnd:0});execution.push(q);});
 return{kind:'generated-full-original-T-diagnostic',status:'T-candidate-unqualified-by-original-material-and-protocol',plan,commands,paths,execution,candidatePlanAccuracy,
  originalCoverage,multiplicity,addedCharge,candidateTargetToActual,actualToCandidateTarget,
  wholeCandidatePUnionEqualsActualU:candidateTargetToActual.completeOriginalMaterialCovered&&actualToCandidateTarget.completeOriginalMaterialCovered,
  wholeNozzleAndFeedContained:containment.every(q=>q.nozzle.passed&&q.feed.passed),containment,
  nominalWidthOnly:true,ordinaryWidthChanges:0,sourcePreserved:true,newGeneratorConstructedCommands:true,
  wholeMandatorySourceCoveragePassed:false,sourceTraversalProtocolCertified:false,restartAndClosureProtocolCertified:false,
  internalRestartOverlapAuthorized:false,diagnosticCapsRestartOverlapProposed:caps,rulePrescribedTargetResolved:false,
  physicalPrintValidated:false,physicalFlowValidated:false,selectedCommands:[],ownerAccepted:false,routeAccepted:false,wholeSourceAllocationCertified:false,
  reasons:['complete prescribed material coverage not proved by body/cap rectangles','rounded full-T material plan is accounted separately','independent open starts and missing closure/continuity remain unqualified',
   ...(caps?['cap/body positive restart overlap is diagnostic only and not authorized','added cap overlap exceeds unchanged joint budget']:[]) ]};
}};}
module.exports={planTBody,createTBodyCandidateCore};
