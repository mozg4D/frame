'use strict';
// Constructive continuity experiment: replace two duplicate closure tails with
// real full-W diagonal print links. Retain every complete original T lap and P.
// This simple construction is expected to FAIL the unchanged coupled event limit.
const R=require('../core/rational.cjs'),{canonicalRing}=require('../core/contour-core.cjs'),{mapInterval}=require('../core/provenance.cjs');
const {compileTExecution}=require('./T-runtime-commands.cjs'),{exactJointCharge}=require('../core/exact-joint-charge.cjs');
function buildTDirectLapLinks(a){
 const old=a.commands,courses=a.plan.courses;if(courses.length!==5)throw Error('five source T courses required');const commands=[],index=new Map(),links=[],nextCourses=[],n=canonicalRing(a.source),bottom=n.ring.findIndex((p,i)=>p[1]===0&&n.ring[(i+1)%n.ring.length][1]===0);
 // Canonical synthetic orientation is an explicit admitted experiment bound.
 if(bottom<0||a.W!==1||a.source.some(p=>p.some(v=>!Number.isFinite(v))))throw Error('canonical W1 horizontal T experiment only');
 for(let component=0;component<3;component++){
  const c=courses[component],end=c.endCommand-(component<2?1:0);for(let i=c.startCommand;i<end;i++){index.set(i,commands.length);commands.push({...old[i],component:0});}
  if(component<2){const from=commands.at(-1).to,to=old[courses[component+1].startCommand].from,edge=n.ring[bottom].map(R.exact),d=R.vec(n.ring[(bottom+1)%n.ring.length].map(R.exact),edge),l=R.dot(d,d),t=p=>R.str(R.div(R.dot(R.vec(p.map(R.exact),edge),d),l)),id=commands.length;
   commands.push({kind:'print',from,to,exactFrom:from.map(v=>R.str(R.exact(v))),exactTo:to.map(v=>R.str(R.exact(v))),widthStart:1,widthEnd:1,exactWidthStart:'1/1',exactWidthEnd:'1/1',
    component:0,depth:component+1,role:'source-direct-full-W-lap-link',flatFrontBlend:true,phase:null,
    sourceIntervals:mapInterval([n],[a.source],{ring:0,edge:bottom,exactU0:t(from),exactU1:t(to)}).map(q=>({...q,role:'original-finite-lap-link-bank',bankGroup:'source-direct-lap-link'}))});links.push(id);}
 }
 nextCourses.push({component:0,depth:0,depthTo:2,startCommand:0,endCommand:commands.length,closed:false});
 for(let k=3;k<5;k++){const c=courses[k],begin=commands.length;for(let i=c.startCommand;i<c.endCommand;i++){index.set(i,commands.length);commands.push({...old[i],component:k-2});}nextCourses.push({...c,component:k-2,startCommand:begin,endCommand:commands.length});}
 const cornerJoins=a.cornerJoins.map(q=>({...q,afterCommand:index.get(q.afterCommand),component:0})),proposal={...a,commands,cornerJoins,plan:{...a.plan,commands,courses:nextCourses}},runtime=compileTExecution(proposal),
  events=links.map(command=>{const final=runtime.cells,eventCellIds=final.map((q,i)=>({q,i})).filter(({q})=>q.command===command||q.kind!=='ribbon'&&q.command===command-1).map(({i})=>i),reference=final.filter((q,i)=>!eventCellIds.includes(i)),charge=exactJointCharge(reference.map(q=>q.polygon),final.map(q=>q.polygon),1,{maxWork:1000000});
   return{kind:'all-final-coupled-direct-lap-link',eventCommandIds:[command],eventCellIds,bothLinkEndTurnCellsIncluded:true,allFinalBanksIncluded:true,charge,areaLineage:charge.areas.map(p=>({...p,firstOwner:final[p.first],secondOwner:final[p.second]}))};});
 return{kind:'constructed-three-course-direct-lap-link-candidate',commands,runtime,courses:nextCourses,events,
  fullOriginalLapsRetained:true,onlyDuplicateClosureTailsRemoved:true,sourceOriginalCAndPUnchanged:true,sourceCoverageProofNotRerun:true,
  eventBudgetsPassed:events.every(e=>e.charge.passed),ownerAccepted:false,routeAccepted:false,selectedCommands:[],selectedExecution:[],globalMaximumContinuityCertified:false};
}
module.exports={buildTDirectLapLinks};
