'use strict';
// A complete independent mesh -> planned commands -> owner rederivation path.
// Accepted scope is finite requested perimeters. Material allocation stays open.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const R=require('./rational.cjs'),A=require('./accuracy-contract.cjs');
const {sectionMesh,verifySection,hash}=require('./mesh-section.cjs');
const {createRouteGenerator}=require('./route-generator.cjs');
const {auditPhysicalPrintRoutes}=require('./physical-path-direction.cjs');
function revision() {
  const h=crypto.createHash('sha256');
  for(const name of fs.readdirSync(__dirname).filter(n=>/\.(cjs|js)$/.test(n)).sort()) {
    h.update(name);h.update(fs.readFileSync(path.join(__dirname,name)));
  }
  return h.digest('hex');
}
function stableRoute(q) {
  const copy=structuredClone(q);delete copy.wallMS;return copy;
}
function validateJob(job) {
  if(!job||!Number.isFinite(job.z)||!(job.W>0)||!Number.isFinite(job.W)||
    !Number.isInteger(job.count)||job.count<1||job.count>64)throw Error('invalid mesh route job');
}
function exactPhysicalOrthogonal(section) {
  return section.exactRings.length===1&&section.exactRings[0].every((a,i,ring)=>{
    const b=ring[(i+1)%ring.length],d=R.vec(b.map(R.parse),a.map(R.parse));
    return !!d[0].n!==!!d[1].n;
  });
}
function bindCommandsToActualFaces(section,commands) {
  return commands.map((command,index)=>{
    const originalIntervals=command.sourceIntervals.map(cell=>{
      const a=R.parse(cell.exactU0),b=R.parse(cell.exactU1);
      if(cell.ring!==0||!Number.isInteger(cell.edge)||
        [a,b].some(t=>R.cmp(t,R.zero)<0||R.cmp(t,R.one)>0))
        throw Error('unbound finite original command source interval');
      const faces=section.edgeFaces[0]?.[cell.edge];
      if(!faces?.length)throw Error('command lacks actual source triangle');
      const triangles=faces.map(f=>{
        const start=f.exactSectionStart.map(R.parse),end=f.exactSectionEnd.map(R.parse);
        const at=t=>start.map((v,k)=>R.str(R.add(v,R.mul(t,R.sub(end[k],v)))));
        return {faceId:f.faceId,sourceAngle:f.sourceAngle,vertexIds:f.vertexIds.slice(),
          exactSectionStart:at(a),exactSectionEnd:at(b),
          exactU0:cell.exactU0,exactU1:cell.exactU1,
          membershipProof:'finite convex subset of independently rederived original triangle-plane segment'};
      });
      return {ring:cell.ring,edge:cell.edge,role:cell.role,
        exactU0:cell.exactU0,exactU1:cell.exactU1,actualTriangleIntervals:triangles};
    });
    if(!originalIntervals.length)throw Error('command has no finite original source support');
    return {command:index,depth:command.depth,sourceAngle:Math.max(...originalIntervals
      .flatMap(q=>q.actualTriangleIntervals.map(f=>f.sourceAngle))),originalIntervals,
      meshSignature:section.meshSignature,sourceGeneration:section.sourceGeneration,
      currentPlane:section.z,ownerVerifiedAgainstTriangles:true};
  });
}
function createMeshRouteCore() {
  const generator=createRouteGenerator(),kernelRevision=revision();
  function prepare(mesh,job,signal) {
    validateJob(job);if(signal?.aborted)throw Error('mesh route cancelled');
    const section=sectionMesh(mesh,job.z);
    const route=stableRoute(generator.generate({rings:section.rings,W:job.W,count:job.count,signal}));
    return {kind:'independent-mesh-route-proposal',job:{z:job.z,W:job.W,count:job.count},
      sourceGeneration:mesh.generation,kernelRevision,section,route};
  }
  function verify(mesh,proposal,expectedJob,signal) {
    validateJob(expectedJob);if(signal?.aborted)throw Error('mesh route cancelled');
    if(proposal?.kind!=='independent-mesh-route-proposal'||
      proposal.sourceGeneration!==mesh.generation||proposal.kernelRevision!==kernelRevision||
      hash(proposal.job)!==hash({z:expectedJob.z,W:expectedJob.W,count:expectedJob.count}))
      throw Error('stale or unbound mesh route proposal');
    const section=verifySection(mesh,proposal.section);
    if(section.z!==expectedJob.z)throw Error('unbound mesh route plane');
    const route=stableRoute(generator.generate({rings:section.rings,W:expectedJob.W,count:expectedJob.count,signal}));
    if(hash(route)!==hash(proposal.route))throw Error('changed generated commands or forged route receipt');
    const supported=route.status==='supported-finite-perimeter-route';
    const physicalReference=exactPhysicalOrthogonal(section);
    const sourceAngleEvidence=supported?bindCommandsToActualFaces(section,route.commands):[];
    const accuracy=supported&&physicalReference?{...A.certifyBudget(expectedJob.W,[
      {name:'exact physical triangle plane section to orthogonal finite source',
        verified:true,exactUpperBound:section.conversionExactUpperBound},
      {name:'complete source-bound generated axis nozzle and feed command plan',
        verified:true,exactUpperBound:route.finiteCommandPlanAccuracy.totalExactUpperBoundMM}
    ]),wholeTrajectoryDeviationCertified:false,scope:'complete requested finite perimeter plan; not complete material allocation'}:
      {accepted:false,wholeTrajectoryDeviationCertified:false,reason:physicalReference?
        route.reasons?.[0]:'exact physical orthogonal source reference required'};
    const physicalDirection=supported?auditPhysicalPrintRoutes(route.commands):{clockwise:false};
    const accepted=supported&&physicalDirection.clockwise&&section.closedComponentsQualified&&accuracy.accepted&&
      sourceAngleEvidence.length===route.commands.length&&sourceAngleEvidence.length>0;
    return {kind:'owner-verified-independent-mesh-route',kernelRevision,
      job:structuredClone(proposal.job),sourceGeneration:mesh.generation,sourceVerified:true,
      finitePerimeterRouteAccepted:accepted,commandProducer:accepted?'independent-route-generator':'unsupported',
      newGeneratorCommandsSelected:accepted,retainedWorkerOutputUsedAsReference:false,
      commands:accepted?route.commands:[],execution:accepted?route.execution:[],
      physicalDirection,selectedCoordinateSpace:'physical-mm-right-handed-XY-Z-up; no axis reflection',
      sourceAngleEvidence,sourceFaceAngleBindingCertified:accepted,accuracy,
      completeFinitePerimeterPlanCertified:accepted,
      finitePlanCoverageCertified:accepted&&route.geometry.coverage.requiredCellsCovered,
      jointSeamAndNozzleAndWidthAndOrderCertified:accepted,
      availableCandidateRoute:route,availableClosedSourceRings:section.rings,
      availableUnresolvedGeometry:section.unresolvedComponents,diagnostics:section.diagnostics,
      wholeSectionQualified:section.closedComponentsQualified,
      wholeSourceAllocationCertified:false,wholeLayerAccuracyCertified:false,
      continuousCircleFeedCertified:false,ownerAccepted:false,routeAccepted:false,
      physicalPrintValidated:false,physicalMaterialAnalysisDeferred:true,
      internalRestartOverlapAuthorized:false,
      scope:'generated finite requested perimeters with actual triangle source ownership; full material allocation, global continuity, native UI and printing remain unqualified'};
  }
  function slice(mesh,job,signal) {
    const proposal=prepare(mesh,job,signal);
    return verify(mesh,JSON.parse(JSON.stringify(proposal)),job,signal);
  }
  return {prepare,verify,slice,kernelRevision};
}
module.exports={createMeshRouteCore};

