'use strict';
// Development-only projection. --generate performs ONE full synthetic proof
// with current source, without reading any history/owner report. Coordinate
// expensive proof work separately. A new digest requires separate review.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const PIN='a5ce71b8cf9553a1e3ee5986804eaa08c7c51554ee0e4d96b156d4cb02580f63',sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function project(proof,originalProofSHA256){const a=proof.availableCandidateAllocation,r=proof.runtime;assert(proof.checked2DGeometryPassed&&a.completePrescribedMaterialConstructionCertified&&a.accuracy.accepted&&a.W===1);
 return{kind:'synthetic-T-local-material-projection-v1',originalProofSHA256,coreRevision:'9ea9e79aebe55061e637b1e137f9836406b6119d0946ce7b622db6aa14db757f',kernelRevision:proof.kernelRevision,checked2DGeometryPassed:true,
  availableCandidateAllocation:{W:a.W,count:a.count,source:a.source,completePrescribedMaterialConstructionCertified:true,accuracy:{accepted:true,totalExactUpperBoundMM:a.accuracy.totalExactUpperBoundMM},
   plan:{barRows:a.plan.barRows,stemRows:a.plan.stemRows,body:{rows:a.plan.body.rows.map(q=>({role:q.role,depth:q.depth,exactFrom:q.exactFrom,exactTo:q.exactTo}))},courses:a.plan.courses.map(q=>({component:q.component,startCommand:q.startCommand,endCommand:q.endCommand,closed:q.closed}))},
   commands:a.commands.map(q=>({role:q.role,exactFrom:q.exactFrom,exactTo:q.exactTo,exactWidthStart:q.exactWidthStart,exactWidthEnd:q.exactWidthEnd}))},
  runtime:{cells:r.cells.map(q=>({kind:q.kind,command:q.command,polygon:q.polygon}))}};
}
if(require.main===module){const args=process.argv.slice(2);let proof,originalSHA;
 if(args[0]==='--generate'){const{createTRedistributedCentralCourses}=require('../experiments/T-redistributed-central-courses.cjs'),{compileTExecution}=require('../experiments/T-runtime-commands.cjs'),{hash}=require('../core/mesh-section.cjs'),source=[[0,0],[30,0],[30,7],[19,7],[19,24],[12,24],[12,7],[0,7]],a=createTRedistributedCentralCourses().generate({source,W:1,count:7}),runtime=compileTExecution(a);
  assert(a.completePrescribedMaterialConstructionCertified&&a.wholeNominalNozzleAndFeedContained&&a.eventBudgetsPassed&&a.widthsWithinLimits&&a.outsideIn);assert.equal(hash(runtime.cells.slice(a.commands.length).map(q=>q.polygon)),hash(a.cornerJoins.concat(a.phaseBevels).map(q=>q.polygon)));
  const code=fs.readFileSync(require.resolve('../experiments/T-redistributed-central-courses.cjs'));proof={checked2DGeometryPassed:true,kernelRevision:sha(code),availableCandidateAllocation:a,runtime};originalSHA=null;
 }else{const bytes=fs.readFileSync(args[0]??'evidence/T-redistributed-central-owner-receipt.json');assert.equal(sha(bytes),PIN);proof=JSON.parse(bytes);originalSHA=PIN;}
 const result=project(proof,originalSHA),bytes=Buffer.from(JSON.stringify(result)),destination=path.resolve(args[1]??(args[0]==='--generate'?'fixtures/T-local-material-generated-unreviewed.json':'fixtures/T-local-material-certified-projection-v1.json'));fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,bytes);console.log(JSON.stringify({path:destination,bytes:bytes.length,sha256:sha(bytes),originalProofSHA256:originalSHA,currentFullSyntheticProofGenerated:args[0]==='--generate',newDigestMustBeReviewedBeforeLoading:args[0]==='--generate'}));
}
module.exports={project};
