'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),R=require('./rational.cjs'),A=require('./accuracy-contract.cjs');
const {sectionMesh,verifySection,hash}=require('./mesh-section.cjs');
const {createRectangleAllocationCore}=require('./rectangle-allocation-contract.cjs');
const {createAnnulusCore}=require('./annulus-route.cjs');
const {auditPhysicalPrintLoop}=require('./physical-path-direction.cjs');
function coreRevision(){const h=crypto.createHash('sha256');for(const name of fs.readdirSync(__dirname).filter(n=>/\.(cjs|js)$/.test(n)).sort()){h.update(name);h.update(fs.readFileSync(path.join(__dirname,name)));}return h.digest('hex');}
function jobValue(job){if(!job||!Number.isFinite(job.z)||!(job.W>0)||!Number.isFinite(job.W)||!Number.isInteger(job.count)||job.count<1||job.count>64||!['flat-banks','continuous-1.7-return','continuous-1.7-turn-seam','continuous-annulus','T-body-diagnostic','T-caps-diagnostic','T-terminal-portals-diagnostic','T-branch-portals-diagnostic','T-combined-portals-diagnostic'].includes(job.mode??'flat-banks'))throw Error('invalid allocation mesh job');return{z:job.z,W:job.W,count:job.count,mode:job.mode??'flat-banks'};}
function bind(section,commands){return commands.map((q,index)=>({command:index,depth:q.depth,
 originalIntervals:q.sourceIntervals.map(cell=>{
  const u=[cell.exactU0,cell.exactU1].map(R.parse),faces=section.edgeFaces[cell.ring]?.[cell.edge];
  if(!Number.isInteger(cell.ring)||!faces?.length||u.some(q=>R.cmp(q,R.zero)<0||R.cmp(q,R.one)>0))throw Error('unbound allocation source interval');
  return {...cell,actualTriangleIntervals:faces.map(f=>{
   const a=f.exactSectionStart.map(R.parse),b=f.exactSectionEnd.map(R.parse),
    at=t=>a.map((v,k)=>R.str(R.add(v,R.mul(t,R.sub(b[k],v)))));
   return {faceId:f.faceId,sourceAngle:f.sourceAngle,exactSectionStart:at(u[0]),exactSectionEnd:at(u[1]),
    exactU0:cell.exactU0,exactU1:cell.exactU1,membershipProof:'finite convex subset of independently rederived triangle plane source'};
  })};
 }),meshSignature:section.meshSignature,sourceGeneration:section.sourceGeneration,currentPlane:section.z,ownerVerifiedAgainstTriangles:true}));}
function createMeshAllocationCore(){
 const core=createRectangleAllocationCore(),kernelRevision=coreRevision();
 let annulus,Tbody,Tportal;
 function evaluate(section,job,signal){
  if(job.mode.startsWith('T-')){
   if(section.rings.length!==1||!section.closedComponentsQualified||section.conversionExactUpperBound!=='0/1')
    return{status:'unsupported-allocation-class',reasons:['one qualified exact physical T source section required'],sourcePreserved:true,availableSourceRings:section.rings};
   try{if(job.mode.includes('-portals-'))return(Tportal??=require('./T-open-portals.cjs').createTOpenPortalCore()).generate({source:section.rings[0],W:job.W,count:job.count,
    terminal:job.mode!=='T-branch-portals-diagnostic',branch:job.mode!=='T-terminal-portals-diagnostic',signal});
    return (Tbody??=require('./T-fill-candidate.cjs').createTBodyCandidateCore()).generate({source:section.rings[0],W:job.W,count:job.count,caps:job.mode==='T-caps-diagnostic',signal});}
   catch(e){if(signal?.aborted)throw e;return{status:'unsupported-allocation-class',reasons:[e.message],sourcePreserved:true,availableSourceRings:section.rings};}
  }
  if(job.mode==='continuous-annulus'){
   if(!section.closedComponentsQualified||section.conversionExactUpperBound!=='0/1')
    return{status:'unsupported-allocation-class',reasons:['qualified exact Float64 original physical annulus section required'],sourcePreserved:true,availableSourceRings:section.rings};
   try{return (annulus??=createAnnulusCore()).generate({rings:section.rings,W:job.W,count:job.count,signal});}
   catch(e){if(signal?.aborted)throw e;return{status:'unsupported-allocation-class',reasons:[e.message],sourcePreserved:true,availableSourceRings:section.rings};}
  }
  if(section.rings.length!==1)return{status:'unsupported-allocation-class',reasons:['single original rectangle source required'],availableSourceRings:section.rings};
  try{return core.generate({source:section.rings[0],W:job.W,count:job.count,mode:job.mode,signal});}
  catch(e){if(signal?.aborted)throw e;return{status:'unsupported-allocation-class',reasons:[e.message],sourcePreserved:true,source:section.rings[0]};}
 }
 function prepare(mesh,job,signal){
  const trusted=jobValue(job);if(signal?.aborted)throw Error('mesh allocation cancelled');
  const section=sectionMesh(mesh,trusted.z),allocation=evaluate(section,trusted,signal);
  return{kind:'independent-mesh-allocation-proposal',kernelRevision,sourceGeneration:mesh.generation,job:trusted,section,allocation};
 }
 function verify(mesh,proposal,job,signal){
  const trusted=jobValue(job);if(signal?.aborted)throw Error('mesh allocation cancelled');
  if(proposal?.kind!=='independent-mesh-allocation-proposal'||proposal.kernelRevision!==kernelRevision||
   proposal.sourceGeneration!==mesh.generation||hash(proposal.job)!==hash(trusted))throw Error('stale or unbound allocation proposal');
  const section=verifySection(mesh,proposal.section);
  if(section.z!==trusted.z)throw Error('unbound allocation plane');
  const allocation=evaluate(section,trusted,signal);
  if(hash(allocation)!==hash(proposal.allocation))throw Error('changed allocation commands, required material, omission or protocol receipt');
  const sourceAngleEvidence=allocation.commands?bind(section,allocation.commands):[];
  for(const row of sourceAngleEvidence)row.sourceAngle=Math.max(...row.originalIntervals.flatMap(q=>q.actualTriangleIntervals.map(f=>f.sourceAngle)));
  const exactOrthogonal=section.exactRings.length===1&&section.exactRings[0].every((p,i,ring)=>{
   const d=R.vec(ring[(i+1)%ring.length].map(R.parse),p.map(R.parse));return !!d[0].n!==!!d[1].n;
  });
  const physicalReference=exactOrthogonal||(trusted.mode==='continuous-annulus'&&section.closedComponentsQualified&&section.conversionExactUpperBound==='0/1');
  const accuracy=allocation.accuracy&&physicalReference?{...A.certifyBudget(trusted.W,[
   {name:trusted.mode==='continuous-annulus'?'exact original physical annular section to Float64 source':'exact original physical rectangle section to Float64 source',verified:true,exactUpperBound:section.conversionExactUpperBound},
   {name:'complete source-only bead allocation to emitted finite commands',verified:true,exactUpperBound:allocation.accuracy.totalExactUpperBoundMM}
  ]),wholeTrajectoryDeviationCertified:trusted.mode==='continuous-annulus'&&allocation.accuracy.accepted}:{accepted:false,reason:'independent exact physical allocation reference unresolved'};
  // Only the new, complete original annular domain can pass the layer owner.
  // Rejected rectangles and their local coupons cannot inherit this selection.
  const physicalDirection=trusted.mode==='continuous-annulus'&&allocation.commands?
   auditPhysicalPrintLoop(allocation.commands):{clockwise:false,scope:'no selected annular physical loop'};
  const accepted=trusted.mode==='continuous-annulus'&&physicalDirection.clockwise&&section.closedComponentsQualified&&
   section.conversionExactUpperBound==='0/1'&&accuracy.accepted===true&&
   allocation.wholeMandatorySourceCoveragePassed===true&&allocation.geometry?.geometryPassed===true&&
   allocation.sourceTraversalProtocolCertified===true&&allocation.restartAndClosureProtocolCertified===true&&
   allocation.widthNecessityCertified===true&&allocation.internalRestartCount===0&&allocation.independentStartCount===1&&
   sourceAngleEvidence.length===allocation.commands?.length&&sourceAngleEvidence.every(row=>row.originalIntervals.length&&
    row.originalIntervals.every(q=>q.actualTriangleIntervals.length));
  return{kind:'owner-verified-mesh-allocation-candidate',kernelRevision,job:trusted,sourceGeneration:mesh.generation,
   sourceVerified:true,sourceFaceAngleBindingCertified:sourceAngleEvidence.length>0,sourceAngleEvidence,accuracy,
   availableCandidateAllocation:allocation,availableClosedSourceRings:section.rings,availableUnresolvedGeometry:section.unresolvedComponents,
   completeOriginalMaterialCoveragePassed:allocation.wholeMandatorySourceCoveragePassed===true,
   selectedCommands:accepted?structuredClone(allocation.commands):[],selectedExecution:accepted?structuredClone(allocation.execution):[],
   physicalDirection,selectedCoordinateSpace:'physical-mm-right-handed-XY-Z-up; no axis reflection',
   routeAccepted:accepted,ownerAccepted:accepted,wholeSourceAllocationCertified:accepted,
   wholeLayerAccuracyCertified:accepted,internalRestartOverlapAuthorized:false,physicalPrintValidated:false,
   newGeneratorCommandsSelected:accepted,retainedWorkerFallbackSelected:false,
   scope:accepted?'complete original two-bank annular layer, one continuous clockwise source-owned route, all mesh/source/protocol and cumulative construction gates passed':
    'complete original material coverage cannot inherit an interior-only proof; candidate commands remain unselected until caps and full protocols pass'};
 }
 return{prepare,verify,slice(mesh,job,signal){return verify(mesh,JSON.parse(JSON.stringify(prepare(mesh,job,signal))),job,signal);},kernelRevision};
}
module.exports={createMeshAllocationCore};

