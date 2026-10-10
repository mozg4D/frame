'use strict';
const assert=require('assert/strict'),fs=require('fs'),{auditPhysicalPrintLoop}=require('../core/physical-path-direction.cjs'),
 {sectionMesh}=require('../core/mesh-section.cjs'),{prism}=require('./mesh-fixtures.cjs'),
 {createMeshAllocationCore}=require('../core/mesh-allocation-contract.cjs'),{createMeshRouteCore}=require('../core/mesh-route-contract.cjs'),
 {annulus,annulusPrism}=require('./annulus-fixtures.cjs');
const start=performance.now();let checks=0;
const clockwise=[[0,0],[0,2],[3,2],[3,0],[0,0]],counterclockwise=clockwise.slice().reverse(),
 commands=points=>points.slice(1).map((p,i)=>({kind:'print',from:points[i],to:p,depth:0})),
 newell=commands=>commands.filter(p=>!p.closure).reduce((s,p)=>s+(p.from[0]-p.to[0])*(p.from[1]+p.to[1]),0);
assert.equal(newell(commands(clockwise)),-12);assert.equal(newell(commands(counterclockwise)),12);
assert(auditPhysicalPrintLoop(commands(clockwise)).clockwise);assert(!auditPhysicalPrintLoop(commands(counterclockwise)).clockwise);checks+=4;
const section=sectionMesh(prism([[0,0],[3,0],[3,2],[0,2]]),.5);
assert(section.closedComponentsQualified);assert(section.rings.flat().every(p=>p[0]>=0&&p[0]<=3&&p[1]>=0&&p[1]<=2));
for(const p of [[0,0],[3,0],[3,2],[0,2]]){assert(section.rings.flat().some(q=>q[0]===p[0]&&q[1]===p[1]));checks++;}checks+=2;
const core=createMeshAllocationCore(),mesh=annulusPrism(annulus()),job={z:.5,W:1,count:1,mode:'continuous-annulus'},
 proposal=core.prepare(mesh,job),encoded=JSON.stringify(proposal),received=JSON.parse(encoded),
 owned=core.verify(mesh,received,job),final=JSON.parse(JSON.stringify(owned));
assert(owned.ownerAccepted);assert(newell(proposal.allocation.commands)<0);assert(newell(received.allocation.commands)<0);
assert(newell(owned.selectedExecution)<0);assert(newell(final.selectedExecution)<0);
assert.deepEqual(final.selectedExecution,proposal.allocation.commands);checks+=6;
const route=createMeshRouteCore(),tmesh=prism([[0,0],[12,0],[12,3],[8,3],[8,8],[5,8],[5,3],[0,3]]),tjob={z:.5,W:1,count:1},
 tp=route.prepare(tmesh,tjob),tq=route.verify(tmesh,JSON.parse(JSON.stringify(tp)),tjob),tf=JSON.parse(JSON.stringify(tq));
assert(tq.finitePerimeterRouteAccepted&&!tq.ownerAccepted);assert(newell(tp.route.commands)<0);assert(newell(tf.commands)<0);
assert(tf.physicalDirection.clockwise);checks+=4;
const receipt={status:'PASS',checks,kernelRevision:core.kernelRevision,knownPhysicalSquare:{clockwiseNewellZ:-12,counterclockwiseNewellZ:12},
 annulusFinalNewellZ:newell(final.selectedExecution),TFinalNewellZ:newell(tf.commands),
 coordinateChain:'mesh physical XYZ -> exact section XY -> source plan -> actual commands -> Frame budget structured clone/worker -> JSON proposal -> owner-selected execution -> final JSON; no axis reflection',
 nativeFrameUIOrGCodeIncluded:false,totalMS:performance.now()-start};
fs.writeFileSync('evidence/physical-clockwise.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
