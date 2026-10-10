'use strict';
// Physical millimetres: right-handed XY, Z up, viewed from +Z toward the bed.
// Positive signed area is counterclockwise. No camera/canvas/Frame reflection.
const R=require('./rational.cjs');
const PHYSICAL_CLOCKWISE_SIGN=-1;
function auditPhysicalPrintLoop(commands){
 if(!Array.isArray(commands)||commands.length<3||commands.length>4096||commands.some(q=>q.kind!=='print'||
  [q.from,q.to].some(p=>!Array.isArray(p)||p.length!==2||p.some(v=>!Number.isFinite(v)))))throw Error('physical print-loop command shape');
 const closureAt=commands.findIndex(q=>q.closure),body=closureAt<0?commands:commands.slice(0,closureAt),
  seam=closureAt<0?[]:commands.slice(closureAt),same=(a,b)=>a.every((v,k)=>v===b[k]);
 if(body.length<3||body.some((q,i)=>i&&!same(q.from,body[i-1].to))||!same(body.at(-1).to,body[0].from)||
  seam.length>1||seam.some(q=>!q.closure||!same(q.from,body[0].from)))throw Error('incomplete physical closed lap or unbound seam tail');
 const area=body.reduce((s,q)=>R.add(s,R.cross(q.from.map(R.exact),q.to.map(R.exact))),R.zero);
 return{coordinateSpace:'physical-mm-right-handed-XY-Z-up; top view from +Z',
  signedTwiceAreaMM2:R.str(area),clockwise:area.n<0n,counterclockwise:area.n>0n,
  closedLapCommands:body.length,closureCommands:seam.length,axesReflected:false,
  method:'exact signed area of complete ACTUAL ordered command lap; explicit seam tail excluded'};
}
function auditPhysicalPrintRoutes(commands){
 const depths=[...new Set(commands.map(q=>q.depth))];
 const loops=depths.map(depth=>({depth,...auditPhysicalPrintLoop(commands.filter(q=>q.depth===depth))}));
 return{clockwise:loops.length>0&&loops.every(q=>q.clockwise),loops,axesReflected:false,
  coordinateSpace:'physical-mm-right-handed-XY-Z-up; top view from +Z'};
}
module.exports={PHYSICAL_CLOCKWISE_SIGN,auditPhysicalPrintLoop,auditPhysicalPrintRoutes};
