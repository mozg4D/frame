'use strict';
// Source-owned OPEN portal construction. No approval of full T/start/closure.
const R=require('./rational.cjs'),A=require('./accuracy-contract.cjs');
const {planTBody}=require('./T-fill-candidate.cjs'),{canonicalRing}=require('./contour-core.cjs'),{mapInterval}=require('./provenance.cjs');
const {load}=require('./adapter.cjs'),{sourceCells,proveFeedInsideSource}=require('./exact-source-feed.cjs');
const {commandedMultiplicity,originalMaterialDifference}=require('./deposition-multiplicity.cjs'),{exactJointCharge}=require('./exact-joint-charge.cjs');
const {planTRoundedMaterial,accountRoundedMaterial}=require('./T-rounded-prescribed-plan.cjs');
const {hull,intersectConvexCells}=require('./trajectory-union-accuracy.cjs');
const eq=(a,b)=>R.cmp(a,b)===0,point=p=>p.map(R.parse),half=q=>R.div(q,R.rat(2n));
function quad(a,b,w){const d=R.vec(b,a),axis=d[0].n?0:1;if(d[1-axis].n||!d[axis].n)throw Error('orthogonal source portal required');
 const n=[R.zero,R.zero];n[1-axis]=R.rat((axis===0?1n:-1n)*(d[axis].n>0n?1n:-1n));
 return[a.map((v,k)=>R.add(v,R.mul(half(w),n[k]))),b.map((v,k)=>R.add(v,R.mul(half(w),n[k]))),
  b.map((v,k)=>R.sub(v,R.mul(half(w),n[k]))),a.map((v,k)=>R.sub(v,R.mul(half(w),n[k])))];}
function planTOpenPortals(source,W=1,count=7,{terminal=true,branch=false}={}){
 const body=planTBody(source,W,count),normalized=canonicalRing(source),w=R.exact(W),rows=structuredClone(body.rows),
  barIds=rows.map((q,i)=>q.role==='bar-body'?i:null).filter(Number.isInteger),outer=barIds.filter(i=>rows[i].depth===0),
  lower=outer[0],upper=outer[1],l=rows[lower],u=rows[upper],a=point(l.exactTo),b=point(u.exactFrom),
  direction=R.vec(point(l.exactFrom),a),axis=direction[0].n?0:1,cross=1-axis,inside=R.rat(direction[axis].n>0n?1n:-1n),
  portals=[],groups=[],branchInfo=[];
 if(outer.length!==2)throw Error('two source-derived outer bar banks required');
 const exactRow=(from,to,role,depth,sourceIntervals)=>({exactFrom:from.map(R.str),exactTo:to.map(R.str),exactWidth:R.str(w),role,depth,sourceIntervals});
 function remap(row,from,to){const edge=normalized.sourceEdgeChains.findIndex(chain=>chain.includes(row.sourceIntervals[0].edge)),
  p=normalized.ring[edge].map(R.exact),d=R.vec(normalized.ring[(edge+1)%8].map(R.exact),p),at=q=>R.div(R.dot(R.vec(q,p),d),R.dot(d,d));
  return exactRow(from,to,row.role,row.depth,mapInterval([normalized],[source],{ring:0,edge,exactU0:R.str(at(from)),exactU1:R.str(at(to))})
   .map(q=>({...q,role:row.sourceIntervals[0].role,bankGroup:row.sourceIntervals[0].bankGroup})));
 }
 if(terminal){
  const capEdge=normalized.ring.findIndex((p,i)=>{const q=normalized.ring[(i+1)%8];return eq(R.exact(p[axis]),R.exact(q[axis]))&&
   eq(A.abs(R.sub(R.exact(p[axis]),a[axis])),half(w))&&R.cmp(A.min(a[cross],b[cross]),A.min(R.exact(p[cross]),R.exact(q[cross])))>=0&&
   R.cmp(A.max(a[cross],b[cross]),A.max(R.exact(p[cross]),R.exact(q[cross])))<=0;});
  if(capEdge<0)throw Error('finite original terminal cap owner unresolved');
  const p=normalized.ring[capEdge].map(R.exact),d=R.vec(normalized.ring[(capEdge+1)%8].map(R.exact),p),at=q=>R.div(R.dot(R.vec(q,p),d),R.dot(d,d)),
   owner=mapInterval([normalized],[source],{ring:0,edge:capEdge,exactU0:R.str(at(a)),exactU1:R.str(at(b))})
    .map(q=>({...q,role:'original-finite-terminal-portal-cap',bankGroup:'terminal-cap'}));
  portals.push(exactRow(a,b,'terminal-source-owned-portal',0,owner));
  for(const i of barIds)if(i!==lower&&i!==upper){const f=point(rows[i].exactFrom),t=point(rows[i].exactTo);
   for(const p of[f,t])if(eq(p[axis],a[axis]))p[axis]=R.add(p[axis],R.mul(inside,half(w)));
   rows[i]=remap(rows[i],f,t);
  }
 }
 if(branch){
  const stemId=rows.findIndex(q=>q.role==='stem-body'&&q.depth===0),stem=rows[stemId],stemStart=point(stem.exactFrom),stemEnd=point(stem.exactTo),
   junction=point(u.exactFrom);junction[axis]=stemStart[axis];
  const left=remap(rows[upper],point(rows[upper].exactFrom),junction),right=remap(rows[upper],junction,point(rows[upper].exactTo));
  const stemEdge=normalized.sourceEdgeChains.findIndex(chain=>chain.includes(stem.sourceIntervals[0].edge)),
   endpoints=[normalized.ring[stemEdge],normalized.ring[(stemEdge+1)%8]].map(p=>p.map(R.exact)),
   corner=endpoints.find(p=>eq(p[cross],stemStart[cross]));
  if(!corner)throw Error('finite original branch vertex unresolved');
  const area=normalized.ring.reduce((s,p,i)=>R.add(s,R.cross(p.map(R.exact),normalized.ring[(i+1)%8].map(R.exact))),R.zero),
   incoming=normalized.ring.findIndex((p,i)=>{const q=normalized.ring[(i+1)%8];return(area.n>0n?p:q).every((v,k)=>eq(R.exact(v),corner[k]));}),
   outgoing=normalized.ring.findIndex((p,i)=>{const q=normalized.ring[(i+1)%8];return(area.n>0n?q:p).every((v,k)=>eq(R.exact(v),corner[k]));}),owner=[];
  for(const[edge,first]of[[incoming,true],[outgoing,false]]){
   const p=normalized.ring[edge].map(R.exact),q=normalized.ring[(edge+1)%8].map(R.exact),k=eq(p[0],q[0])?1:0,L=A.abs(R.sub(q[k],p[k])),dt=R.div(half(w),L),
    end=first?(area.n>0n?R.zero:R.one):(area.n>0n?R.one:R.zero),
    start=first?(area.n>0n?dt:R.sub(R.one,dt)):(area.n>0n?R.sub(R.one,dt):dt),u0=first?start:end,u1=first?end:start;
   owner.push(...mapInterval([normalized],[source],{ring:0,edge,exactU0:R.str(u0),exactU1:R.str(u1)})
    .map(q=>({...q,role:'original-ordered-concave-branch-vertex-neighbourhood',bankGroup:'branch-vertex-event'})));
  }
  const portal=exactRow(junction,stemStart,'branch-source-owned-portal',0,owner);
  portals.push(portal);rows[upper]=left;rows.push(right);
  // This is a CONNECTED coupon, not permission to restart the stranded right
  // fragment at the already printed branch portal.
  branchInfo.push({exactCorner:corner.map(R.str),exactJunction:junction.map(R.str),stemId,
   rightFragment:rows.length-1,sourceIncidentCanonicalEdges:[incoming,outgoing],fixedYChannelOddNodes:4,
   fixedYChannelsNeedAtLeastTwoEdgeOnceTrails:true,generalContinuityImpossibilityProved:false});
  if(terminal)groups.push([lower,{portal:0},upper,{portal:1},stemId]);else groups.push([upper,{portal:0},stemId]);
 }else if(terminal)groups.push([lower,{portal:0},upper]);
 const used=new Set(groups.flat().filter(Number.isInteger));for(const i of rows.map((_,i)=>i).sort((a,b)=>rows[a].depth-rows[b].depth||a-b))if(!used.has(i))groups.push([i]);
 const commands=groups.flatMap((group,component)=>group.map(id=>({...structuredClone(typeof id==='number'?rows[id]:portals[id.portal]),component}))),
  portalCells=portals.map(row=>quad(point(row.exactFrom),point(row.exactTo),w).map(p=>p.map(R.str))),
  fixedPlacementMandatoryJointCells=[];
 const intersect=(portal,row)=>intersectConvexCells(hull(portalCells[portal].map(point)),hull(quad(point(row.exactFrom),point(row.exactTo),w)),{work:0,maxWork:1000000});
 if(terminal)for(const row of [rows[lower],rows[upper]])fixedPlacementMandatoryJointCells.push(intersect(0,row));
 if(branch)for(const row of [rows[upper],rows[branchInfo[0].rightFragment]])fixedPlacementMandatoryJointCells.push(intersect(terminal?1:0,row));
 const jointArea=fixedPlacementMandatoryJointCells.reduce((s,p)=>R.add(s,R.div(A.abs(p.reduce((a,q,i)=>R.add(a,R.cross(q,p[(i+1)%p.length])),R.zero)),R.rat(2n))),R.zero);
 return{kind:'source-owned-T-open-portal-plan',source:structuredClone(source),W,count,body,rows,portals,commands,groups,branchInfo,
  immutableOriginalBodyTargetCells:structuredClone(body.candidateTargetCells),portalCells,originalCADCells:body.originalMaterialCells,
  sourceOnlyTargetBeforeEmission:true,removedTargetCells:[],removedOverlapCredit:false,roundedMaterialPlan:planTRoundedMaterial(source,W,count),
  fixedPlacementMandatoryJointCells:fixedPlacementMandatoryJointCells.map(p=>p.map(q=>q.map(R.str))),fixedPlacementNecessaryChargeExactMM2:R.str(jointArea),
  fixedPlacementOverlapScope:'unavoidable intersections for THESE source-derived W-width portal axes and retained endpoint ribbons; no lower bound over other 2D routes',
  connectedCouponInternalRestarts:0,wholeTIndependentComponents:groups.length,wholeTStartClosureOrClockwiseApproved:false};
}
function createTOpenPortalCore(){const c=load('optimized-worker.js').context;return{generate({source,W=1,count=7,terminal=true,branch=false,signal}){
 if(signal?.aborted)throw Error('T portal cancelled');const plan=planTOpenPortals(source,W,count,{terminal,branch});let constructionError=R.zero;
 const commands=plan.commands.map(row=>{if(signal?.aborted)throw Error('T portal cancelled');const from=point(row.exactFrom).map(R.number),to=point(row.exactTo).map(R.number),
  proof=A.provePolylineTransform([row.exactFrom,row.exactTo],[from,to],[[0]],{referenceWidths:[row.exactWidth,row.exactWidth],outputWidths:[W,W],nozzleWidth:W});
  constructionError=A.max(constructionError,R.parse(proof.exactUpperBound));return{
   kind:'print',from,to,widthStart:W,widthEnd:W,depth:row.depth,role:row.role,component:row.component,sourceIntervals:structuredClone(row.sourceIntervals)};}),
  quads=commands.map(q=>c.frameThroughNeckRibbon(q.from,q.to,W,W)),nominal=plan.body.rows.map(row=>c.frameThroughNeckRibbon(point(row.exactFrom).map(R.number),point(row.exactTo).map(R.number),W,W)),
  material=sourceCells(source),containment=commands.map((q,i)=>({command:i,nozzle:c.frameThroughNeckExactClearance(q.from,q.to,source,W),feed:proveFeedInsideSource(quads[i],source,material)})),
  bodyCoverage=originalMaterialDifference(plan.immutableOriginalBodyTargetCells,quads),target=plan.immutableOriginalBodyTargetCells.concat(plan.portalCells),
  candidateTargetToActual=originalMaterialDifference(target,quads),actualToCandidateTarget=originalMaterialDifference(quads,target),
  addedCharge=exactJointCharge(nominal,quads,W),multiplicity=commandedMultiplicity(quads),originalCoverage=originalMaterialDifference(plan.originalCADCells,quads),
  roundedMaterial=accountRoundedMaterial(plan.roundedMaterialPlan,quads),
  couponCommands=commands.filter(q=>q.component===0),couponQuads=quads.filter((_,i)=>commands[i].component===0),couponCharge=exactJointCharge(nominal,couponQuads,W),
  continuous=couponCommands.every((q,i)=>!i||q.from.every((v,k)=>v===couponCommands[i-1].to[k])),
  candidateCertificate=A.certifyBudget(W,[{name:'independent exact source-owned candidate portal/row axes and complete ribbon cells to finite commands',verified:true,exactUpperBound:R.str(constructionError)}]);
 return{kind:'generated-source-owned-T-open-portals',plan,commands,couponCommands,containment,
  wholeNozzleAndFeedContained:containment.every(q=>q.nozzle.passed&&q.feed.passed),originalBodyTargetPreserved:bodyCoverage.completeOriginalMaterialCovered,bodyCoverage,
  candidateTargetEqualsActual:candidateTargetToActual.completeOriginalMaterialCovered&&actualToCandidateTarget.completeOriginalMaterialCovered,
  addedCharge,multiplicity,originalCoverage,connectedCouponContinuous:continuous,connectedCouponInternalRestarts:0,
  candidatePlanAccuracy:{...candidateCertificate,accepted:false,candidatePlanConstructionAccepted:candidateCertificate.accepted,
   computationalTrajectoryDeviationCertified:false,wholeTrajectoryDeviationCertified:false,shapeDeviationSpecificationResolved:false,
   interpretation:'computational construction error versus source-owned open candidate commands; not a complete user-prescribed T route'},
  outsideInDepthOrderCertified:commands.every((q,i)=>!i||q.depth>=commands[i-1].depth),maximalContinuityCertified:false,
  couponCharge,couponMultiplicity:commandedMultiplicity(couponQuads),couponGeometryAndJointPassed:continuous&&couponCharge.passed&&candidateCertificate.accepted&&containment.filter((_,i)=>commands[i].component===0).every(q=>q.nozzle.passed&&q.feed.passed),
  wholeTComponents:plan.groups.length,strandedBranchRestartUnqualified:branch,rulePrescribedCornerTargetResolved:true,roundedMaterial,
  closedPhysicalClockwiseRouteCertified:false,internalRestartOverlapAuthorized:false,ownerAccepted:false,routeAccepted:false,
  selectedCommands:[],wholeSourceAllocationCertified:false,physicalFlowValidated:false,
  scope:'continuous source-owned coupon(s), retained complete candidate body and independently accounted rounded material target; whole T coverage/continuity/restarts remain unqualified'};
}};}
module.exports={planTOpenPortals,createTOpenPortalCore};
