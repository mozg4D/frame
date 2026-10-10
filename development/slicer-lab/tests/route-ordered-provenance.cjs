'use strict';
const assert=require('assert/strict'),fs=require('fs'),R=require('../core/rational.cjs');
const {canonicalRing}=require('../core/contour-core.cjs'),{createRouteGenerator}=require('../core/route-generator.cjs');
const {createMeshRouteCore}=require('../core/mesh-route-contract.cjs'),{prism}=require('./mesh-fixtures.cjs');
const start=performance.now(),g=createRouteGenerator(),meshCore=createMeshRouteCore(),rows=[];
let checks=0,checkedIntervals=0,multiIntervalCommands=0,clippedBankIntervals=0;
const shapes={wideT:[[0,0],[30,0],[30,7],[19,7],[19,24],[12,24],[12,7],[0,7]],
 rectangle:[[0,0],[30,0],[30,24],[0,24]]};
function refine(source){return source.flatMap((a,i)=>[0,.25,.5,.75].map(t=>
 a.map((v,k)=>v+(source[(i+1)%source.length][k]-v)*t)));}
const same=(a,b)=>a.every((v,k)=>R.cmp(v,b[k])===0);
function audit(source,commands){
 const S=source.map(p=>p.map(R.exact)),normalized=canonicalRing(source);
 for(const command of commands){
  const intervals=command.sourceIntervals;
  assert(intervals.length);checks++;
  const locations=intervals.map(q=>{
   const a=S[q.edge],b=S[(q.edge+1)%S.length],point=u=>a.map((v,k)=>R.add(v,R.mul(R.parse(u),R.sub(b[k],v)))),
    from=point(q.exactU0),to=point(q.exactU1),canonicalEdge=normalized.sourceEdgeChains.findIndex(chain=>chain.includes(q.edge)),
    ca=normalized.ring[canonicalEdge].map(R.exact),cb=normalized.ring[(canonicalEdge+1)%normalized.ring.length].map(R.exact),d=R.vec(cb,ca),
    canonicalAt=p=>R.div(R.dot(R.vec(p,ca),d),R.dot(d,d));
   assert.deepEqual(q.sourceStart,source[q.edge]);assert.deepEqual(q.sourceEnd,source[(q.edge+1)%source.length]);
   assert.equal(q.canonicalExactU0,R.str(canonicalAt(from)));assert.equal(q.canonicalExactU1,R.str(canonicalAt(to)));
   checkedIntervals++;checks+=4;
   if(q.role==='finite-original-offset-bank'){
    // Original projected positions must advance in actual command direction.
    assert(R.cmp(R.dot(R.vec(to,from),R.vec(command.to.map(R.exact),command.from.map(R.exact))),R.zero)>=0);checks++;
    if(q.exactU0!=='0'&&q.exactU0!=='1'||q.exactU1!=='0'&&q.exactU1!=='1')clippedBankIntervals++;
   }
   return{from,to};
  });
  if(intervals.length>1)multiIntervalCommands++;
  // Ordered continuity of immutable ORIGINAL source positions, independent of
  // the generator's reversing/index mapping and independent of set coverage.
  for(let i=1;i<locations.length;i++){assert(same(locations[i-1].to,locations[i].from),'original source partition out of traversal order');checks++;}
 }
}
let negativeControl=false;
for(const W of [.5,1,2])for(const reverse of [false,true])for(const [kind,shape]of Object.entries(shapes)){
 const source=refine(shape.map(p=>p.map(v=>v*W)));if(reverse)source.reverse();
 const before=JSON.stringify(source),route=g.generate({rings:[source],W,count:3});
 assert.equal(route.status,'supported-finite-perimeter-route');assert.equal(JSON.stringify(source),before);
 assert(route.physicalDirection.clockwise);assert.equal(route.transitionPlan.connections,0);checks+=4;
 audit(source,route.commands);audit(source,JSON.parse(JSON.stringify(route.execution)).filter(q=>q.kind==='print'));
 if(!negativeControl){
  const broken=structuredClone(route.commands),target=broken.find(q=>q.sourceIntervals.length>2&&q.sourceIntervals[0].role==='finite-original-offset-bank');
  assert(target);const previous=JSON.stringify(target.sourceIntervals);target.sourceIntervals.reverse();
  assert.notEqual(JSON.stringify(target.sourceIntervals),previous);assert.throws(()=>audit(source,broken),/out of traversal order/);checks+=3;negativeControl=true;
 }
 rows.push({W,reverse,kind,sourceEdges:source.length,commands:route.commands.length,physicalClockwise:true});
}
for(const [kind,shape]of Object.entries(shapes))for(const reverse of [false,true]){
 const source=refine(shape);if(reverse)source.reverse();const mesh=prism(source),job={z:.5,W:1,count:3},
  proposal=meshCore.prepare(mesh,job),received=JSON.parse(JSON.stringify(proposal)),owned=meshCore.verify(mesh,received,job),final=JSON.parse(JSON.stringify(owned));
 assert(final.finitePerimeterRouteAccepted);assert(final.physicalDirection.clockwise);checks+=2;
 audit(proposal.section.rings[0],final.commands);
 for(let i=0;i<final.commands.length;i++){
  const actual=final.sourceAngleEvidence[i].originalIntervals.map(q=>[q.ring,q.edge,q.exactU0,q.exactU1,q.role]),
   expected=final.commands[i].sourceIntervals.map(q=>[q.ring,q.edge,q.exactU0,q.exactU1,q.role]);
  assert.deepEqual(actual,expected);assert(final.sourceAngleEvidence[i].originalIntervals.every(q=>q.actualTriangleIntervals.length>0));checks+=2;
 }
 rows.push({kind,reverse,meshFinalJSON:true,commands:final.commands.length,actualTriangleBindingOrdered:true});
}
assert(multiIntervalCommands>0&&clippedBankIntervals>0&&negativeControl);checks++;
const result={status:'PASS',checks,kernelRevision:meshCore.kernelRevision,rows,checkedIntervals,multiIntervalCommands,clippedBankIntervals,
 negativeOrderControlRejected:negativeControl,sourceInputsPreserved:true,wholeMaterialAllocationClaimed:false,totalMS:performance.now()-start};
fs.writeFileSync('evidence/route-ordered-provenance.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
