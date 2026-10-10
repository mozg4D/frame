'use strict';
const fs=require('fs'),assert=require('assert/strict'),{prism}=require('./mesh-fixtures.cjs');
const {createMeshRouteCore}=require('../core/mesh-route-contract.cjs');
const {createMeshAllocationCore}=require('../core/mesh-allocation-contract.cjs');
const start=performance.now(),route=createMeshRouteCore(),allocation=createMeshAllocationCore(),
 job={z:.5,W:1,count:1},mesh=prism([[0,0],[12,0],[12,3],[8,3],[8,8],[5,8],[5,3],[0,3]]),
 t=performance.now(),p=route.prepare(mesh,job),q=route.verify(mesh,JSON.parse(JSON.stringify(p)),job),encoded=JSON.stringify(q),end=performance.now();
assert(q.finitePerimeterRouteAccepted&&q.newGeneratorCommandsSelected&&q.sourceFaceAngleBindingCertified);
assert(!q.ownerAccepted&&!q.routeAccepted&&!q.wholeSourceAllocationCertified);assert.equal(q.commands.length,42);
const r=prism([[0,0],[20,0],[20,3.4],[0,3.4]]),j={z:.5,W:1,count:7},t2=performance.now(),proposal=allocation.prepare(r,j),
 result=allocation.verify(r,JSON.parse(JSON.stringify(proposal)),j),end2=performance.now();
assert(result.sourceVerified&&result.sourceFaceAngleBindingCertified&&result.accuracy.accepted);assert.equal(result.selectedCommands.length,0);
assert(!result.completeOriginalMaterialCoveragePassed&&!result.ownerAccepted);assert.equal(result.kernelRevision,q.kernelRevision);
const forged=JSON.parse(JSON.stringify(proposal));forged.kernelRevision='a1801487a9ef1d394cf2e61186b72ec0cb444f7844754850c6ab836c74e138ba';
assert.throws(()=>allocation.verify(r,forged,j));
const receipt={status:'PASS',checks:8,kernelRevision:q.kernelRevision,
 finiteT:{fullHelperJSONOwnerEncodingMS:end-t,newGeneratorCommands:42,finitePerimeterAccepted:true,wholeLayerAccepted:false},
 flatAllocation:{meshJSONOwnerMS:end2-t2,wholeLayerAccepted:false},staleCheckpoint12Rejected:true,totalMS:performance.now()-start,
 heavyHistoricalBaselineRun:false,privateFixtureIncluded:false};
fs.writeFileSync('evidence/checkpoint13-sanity.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
