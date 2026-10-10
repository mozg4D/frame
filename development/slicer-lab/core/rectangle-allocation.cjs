'use strict';
// A source-only allocation reference precedes all command construction.
// Flat interior coverage and original cap coverage remain separate obligations.
const R=require('./rational.cjs'),A=require('./accuracy-contract.cjs');
const {canonicalRing}=require('./contour-core.cjs'),{mapInterval}=require('./provenance.cjs');
const eq=(a,b)=>R.cmp(a,b)===0, min=xs=>xs.reduce(A.min),max=xs=>xs.reduce(A.max);
function rectangleSource(source) {
 const normalized=canonicalRing(source),P=normalized.ring.map(p=>p.map(R.exact));
 if(P.length!==4||P.some((p,i)=>{const d=R.vec(P[(i+1)%4],p);return !!d[0].n===!!d[1].n;}))
  throw Error('single exact axis-aligned rectangle required');
 const lo=[0,1].map(k=>min(P.map(p=>p[k]))),hi=[0,1].map(k=>max(P.map(p=>p[k])));
 const extent=R.vec(hi,lo),axis=R.cmp(extent[0],extent[1])>=0?0:1,transverse=1-axis;
 return {normalized,P,lo,hi,axis,transverse,length:extent[axis],gap:extent[transverse]};
}
function allocationWidths(gap,W,count) {
 const w=R.exact(W),g=R.div(gap,w),limit=R.rat(8n,5n);
 if(R.cmp(g,R.one)<0)throw Error('isolated external sub-W exception requires separate nozzle and terminal authority');
 let widths,positions,policy,intentionalGap=R.zero,attached=false;
 if(R.cmp(g,limit)<=0) {
  widths=[gap];positions=[R.div(gap,R.rat(2n))];policy='one necessary source-width bead';
 }else if(R.cmp(g,R.rat(2n))<0) {
  widths=[w,R.sub(gap,w)];positions=[R.div(w,R.rat(2n)),R.sub(gap,R.div(w,R.rat(2n)))];
  intentionalGap=R.div(R.sub(R.mul(w,R.rat(2n)),gap),R.rat(2n));
  policy='nominal W and attached residual gap-minus-W; prescribed opposite straight-bank gap';
  attached=true;
 }else if(R.cmp(g,R.rat(14n,5n))<=0) {
  widths=[R.div(gap,R.rat(2n)),R.div(gap,R.rat(2n))];
  positions=[R.div(gap,R.rat(4n)),R.mul(gap,R.rat(3n,4n))];
  policy='two necessary equal working-width beads';
 }else{
  const n=Number(g.n/g.d);
  if(n>128||n>2*count)throw Error('requested perimeter count cannot allocate complete source gap');
  const residual=R.sub(gap,R.mul(w,R.rat(BigInt(n))));
  widths=Array(n).fill(w);
  if(R.cmp(residual,R.mul(w,R.rat(3n,5n)))<=0)widths[n-1]=R.add(w,residual);
  else{
   widths[n-2]=R.add(w,R.div(residual,R.rat(2n)));
   widths[n-1]=R.add(w,R.div(residual,R.rat(2n)));
  }
  let at=R.zero;
  positions=widths.map(width=>{const p=R.add(at,R.div(width,R.rat(2n)));at=R.add(at,width);return p;});
  policy='nominal W beads; residual allocated only to final one or two necessary beads';
 }
 if(widths.length>2*count||widths.some(width=>R.cmp(width,R.mul(w,R.rat(3n,5n)))<0||
  R.cmp(width,R.mul(w,limit))>0))throw Error('source allocation working width or count limit');
 const order=widths.map((_,i)=>i).sort((a,b)=>Math.min(a,widths.length-1-a)-Math.min(b,widths.length-1-b)||a-b);
 return {widths,positions,order,policy,intentionalGap,attached};
}
function planRectangleAllocation(source,W=1,count=7) {
 if(!(W>0)||!Number.isFinite(W)||!Number.isInteger(count)||count<1||count>64)throw Error('invalid allocation job');
 const rect=rectangleSource(source),w=R.exact(W),half=R.div(w,R.rat(2n));
 if(R.cmp(rect.length,R.mul(w,R.rat(2n)))<=0)throw Error('finite long-bank body and original caps required');
 const layout=allocationWidths(rect.gap,W,count),start=R.add(rect.lo[rect.axis],half),end=R.sub(rect.hi[rect.axis],half);
 const cell=(x0,x1,y0,y1)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]].map(p=>{
  const q=[];q[rect.axis]=p[0];q[rect.transverse]=p[1];return q;
 });
 const cells=[];
 const bodyTop=R.sub(rect.hi[rect.transverse],layout.intentionalGap);
 // The intentional narrow-wall gap applies to the straight finite body only.
 // It never waives either original cap or corner/end region.
 cells.push({role:'complete-original-start-cap',exact:cell(rect.lo[rect.axis],start,rect.lo[rect.transverse],rect.hi[rect.transverse])});
 cells.push({role:'complete-original-straight-body',exact:cell(start,end,rect.lo[rect.transverse],bodyTop)});
 cells.push({role:'complete-original-end-cap',exact:cell(end,rect.hi[rect.axis],rect.lo[rect.transverse],rect.hi[rect.transverse])});
 const rows=layout.order.map(index=>{
  const p=rect.lo.slice(),q=rect.lo.slice(),coordinate=R.add(rect.lo[rect.transverse],layout.positions[index]);
  p[rect.axis]=start;q[rect.axis]=end;p[rect.transverse]=q[rect.transverse]=coordinate;
  // Positive printer-frame CW source traversal: lower horizontal bank forwards,
  // right vertical bank forwards. Opposing source bank follows its direction.
  const lower=index<layout.widths.length/2,forward=rect.axis===0?lower:!lower;
  const from=forward?p:q,to=forward?q:p;
  const banks=rect.P.map((p,edge)=>{
   const next=rect.P[(edge+1)%4];
   return eq(p[rect.transverse],next[rect.transverse])?edge:null;
  }).filter(Number.isInteger);
  const incidence=banks.flatMap(edge=>{
   const a=rect.P[edge],d=R.vec(rect.P[(edge+1)%4],a),at=p=>R.div(R.dot(R.vec(p,a),d),R.dot(d,d));
   return mapInterval([rect.normalized],[source],{ring:0,edge,
    exactU0:R.str(at(from)),exactU1:R.str(at(to))});
  }).map(q=>({...q,role:'finite-original-rectangle-bank-family'}));
  return {index,depth:Math.min(index,layout.widths.length-1-index),exactFrom:from.map(R.str),
   exactTo:to.map(R.str),exactWidth:R.str(layout.widths[index]),sourceIntervals:incidence,
   independentStartAllowed:!layout.attached||index===0,attachedResidual:layout.attached&&index===1};
 });
 // Original finite cap banks are mandatory source-owned nominal W paths.
 // They are planned from the source before emission, not added to match a
 // candidate coverage result. Four original convex corners remain mandatory.
 const capStart=R.add(rect.lo[rect.transverse],half),capEnd=R.sub(rect.hi[rect.transverse],half);
 const capRows=[];
 if(R.cmp(capStart,capEnd)<0)for(const high of [false,true]){
  const p=rect.lo.slice(),q=rect.lo.slice(),coordinate=high?end:start;
  p[rect.axis]=q[rect.axis]=coordinate;p[rect.transverse]=capStart;q[rect.transverse]=capEnd;
  const forward=rect.axis===0?high:!high,from=forward?p:q,to=forward?q:p;
  const edge=rect.P.findIndex((p,i)=>eq(p[rect.axis],rect.P[(i+1)%4][rect.axis])&&
   eq(p[rect.axis],high?rect.hi[rect.axis]:rect.lo[rect.axis]));
  const a=rect.P[edge],d=R.vec(rect.P[(edge+1)%4],a),at=p=>R.div(R.dot(R.vec(p,a),d),R.dot(d,d));
  capRows.push({index:high?'end-cap':'start-cap',depth:0,exactFrom:from.map(R.str),exactTo:to.map(R.str),
   exactWidth:R.str(w),sourceIntervals:mapInterval([rect.normalized],[source],{ring:0,edge,
    exactU0:R.str(at(from)),exactU1:R.str(at(to))}).map(q=>({...q,role:'finite-original-cap-bank'})),
   independentStartAllowed:true,attachedResidual:false});
 }
 const scheduled=rows.filter(q=>q.depth===0).concat(capRows,rows.filter(q=>q.depth>0));
 return {kind:'independent-complete-rectangle-allocation-reference',source:source.map(p=>p.slice()),
  rows:scheduled,requiredCells:cells.map(c=>({role:c.role,points:c.exact.map(p=>p.map(R.number)),exactPoints:c.exact.map(p=>p.map(R.str))})),
  intentionalDesignGap:{authorized:layout.intentionalGap.n>0n,exactWidthMM:R.str(layout.intentionalGap),
   scope:'original straight body only; original caps and corners remain mandatory'},
  allocationPolicy:layout.policy,sourceReferenceIndependent:true,W,count,wholeSourceAllocationCertified:false,
  exactRectangle:{axis:rect.axis,lo:rect.lo.map(R.str),hi:rect.hi.map(R.str)}};
}
function generateRectangleAllocation(source,W=1,count=7,signal) {
 if(signal?.aborted)throw Error('allocation cancelled');
 const plan=planRectangleAllocation(source,W,count);
 const paths=plan.rows.map(row=>{
  if(signal?.aborted)throw Error('allocation cancelled');
  const points=[row.exactFrom,row.exactTo].map(p=>p.map(s=>R.number(R.parse(s)))),width=R.number(R.parse(row.exactWidth));
  return {points,widths:[width,width],depth:row.depth,sourceIntervals:structuredClone(row.sourceIntervals),
   independentStartAllowed:row.independentStartAllowed,attachedResidual:row.attachedResidual};
 });
 let bound=R.zero;
 for(let i=0;i<paths.length;i++) {
  const row=plan.rows[i],p=paths[i];
  const proof=A.provePolylineTransform([row.exactFrom,row.exactTo],p.points,[[0]],{
   referenceWidths:[row.exactWidth,row.exactWidth],outputWidths:p.widths,nozzleWidth:W});
  bound=A.max(bound,R.parse(proof.exactUpperBound));
 }
 const accuracy={...A.certifyBudget(W,[{name:'complete independent rectangle bead plan to emitted axis nozzle and feed',
  verified:true,exactUpperBound:R.str(bound)}]),wholeTrajectoryDeviationCertified:false};
 const commands=paths.map((p,i)=>({kind:'print',from:p.points[0],to:p.points[1],widthStart:p.widths[0],
  widthEnd:p.widths[1],depth:p.depth,sourceIntervals:p.sourceIntervals,role:'source-derived-allocation-bank',
  independentStartAllowed:p.independentStartAllowed,attachedResidual:p.attachedResidual}));
 const execution=[];commands.forEach((command,i)=>{
  if(i)execution.push({kind:'travel',from:commands[i-1].to,to:command.from,widthStart:0,widthEnd:0});
  execution.push(command);
 });
 return {kind:'generated-source-rectangle-allocation',sourcePreserved:true,plan,paths,commands,execution,accuracy,
  actualBeads:paths.length,fullOriginalCapsRequired:true,attachedResidualRestartUnqualified:paths.some(p=>!p.independentStartAllowed),
  routeAccepted:false,wholeSourceAllocationCertified:false,wholeLayerAccuracyCertified:false};
}
module.exports={rectangleSource,allocationWidths,planRectangleAllocation,generateRectangleAllocation};

