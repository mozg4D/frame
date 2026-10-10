'use strict';
// Fresh clean-package smoke: deliberately no full owner/report fixture.
const fs=require('fs'),assert=require('assert/strict'),{prism}=require('./mesh-fixtures.cjs'),{createTLocalAtlasMesh}=require('../experiments/T-local-atlas-mesh.cjs');
assert(!fs.existsSync('evidence/T-redistributed-central-owner-receipt.json'),'clean package must not contain historical full owner report');
const source=[[0,0],[36,0],[36,7],[21,7],[21,28],[14,28],[14,7],[0,7]],mesh=prism(source,{generation:27}),job={z:.5,W:1,count:7},consumer=createTLocalAtlasMesh(),t=performance.now(),proposal=consumer.prepare(mesh,job),owner=consumer.verify(mesh,JSON.parse(JSON.stringify(proposal)),job),ms=performance.now()-t;
assert(owner.ownerAccepted&&owner.routeAccepted&&owner.newGeneratorCommandsSelected&&!owner.retainedWorkerFallbackSelected);
assert(owner.ownerQualificationFromFreshSource&&!owner.ownerReusedSameVerifiedSource&&owner.selectedCommands.length===701&&owner.runtimeReplay.finished&&owner.runtimeReplay.travels===4);
assert(owner.qualification.material.passed&&owner.qualification.material.totalUpperBoundW<=.02&&owner.qualification.wholeActualFeedContainedInOriginalP&&owner.qualification.wholeNominalNozzleAndFeedContained);
assert(owner.qualification.eventEvidence.every(q=>q.eventPassed)&&owner.qualification.startStopProtocol.starts.every(q=>q.strictPriorFeedDisjoint)&&!owner.productionIntegrationApproved&&!owner.productionCreatesPool);
const out={passed:true,sourceKernelRevision:owner.kernelRevision,commands:701,paths:5,travels:4,errorW:owner.qualification.material.totalUpperBoundW,originalFullOwnerReportPresent:false,projectionBytes:fs.statSync('fixtures/T-local-material-certified-projection-v1.json').size,freshSourceAndOwner:true,ownerMemoUsed:false,completeNewSourceMS:ms,productionIntegrationApproved:false};
fs.writeFileSync('evidence/T-lean-checkpoint-clean.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out));
