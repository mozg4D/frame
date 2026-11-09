/** Bounded CPU reference solve. No native geometry/GPU resources are read here. */
import { evaluateDirect, evaluateCurrentField, evaluatePrescribedCurrentLoads, MU0 } from './direct-kernel.js';
import { createMaterial, validateMaterial, createInitialState, evaluateMaterial } from './materials.js';
import { createPhysicalStateController } from './physical-state.js';
const MAX_SAMPLES = 128;
const issuedProblems=new WeakSet(),issuedStates=new WeakSet(),issuedCaches=new WeakSet();
const createBasisCache=()=>{const cache=new Map();issuedCaches.add(cache);return cache;};
const freezeVec = v => Object.freeze([...v]);
const finite = (x, label) => { if (typeof x !== 'number' || !Number.isFinite(x)) throw new TypeError(`${label} must be finite`); return x; };
const vector = (v,label) => {if(!Array.isArray(v)||v.length!==3)throw new TypeError(`${label} must be vec3`);return freezeVec(Array.from(v,x=>finite(x,label)));};
const keys = (obj,allowed,label) => {if(!obj||typeof obj!=='object'||Array.isArray(obj))throw new TypeError(`${label} must be an object`);for(const key of Object.keys(obj))if(!allowed.includes(key))throw new TypeError(`Unsupported ${label} field: ${key}`);};
const id = (s,label) => {if(typeof s!=='string'||!s.length||s.length>256)throw new TypeError(`${label} must be a nonempty identifier`);return s;};
const add = (a,b) => a.map((x,i)=>x+b[i]);
const sub = (a,b) => a.map((x,i)=>x-b[i]);
const scale = (a,s) => a.map(x=>x*s);
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot = (a,b) => a.reduce((s,x,i)=>s+x*b[i],0);
function rotate(q,v,inverse=false){const r=inverse?[-q[0],-q[1],-q[2],q[3]]:q;const t=scale(cross(r.slice(0,3),v),2);return add(v,add(scale(t,r[3]),cross(r.slice(0,3),t)));}
const checkAbort = signal => {if(signal?.aborted)throw Object.assign(new Error('Reference solve aborted'),{name:'AbortError'});};
const deepVectors = values => Object.freeze(values.map(freezeVec));
export const REFERENCE_CAPABILITIES=Object.freeze({weightedLocalSamples:true,rigidTransforms:true,persistentPhysicalSteps:true,
  backend:'CPU_DIRECT_REFERENCE',maxSamples:MAX_SAMPLES,nativeGeometry:false,gpu:false,calibratedMaterialPresets:false,
  currentDensityConductorSolve:false,prescribedCurrentQuadrature:true,currentAmplitudeFieldCache:true,hybridFarField:false,tinyGapQualified:false,nativeUI:false});

export function createReferenceProblem(input){
  keys(input,['units','materials','objects','samples','uniformH','selfDemagnetization','currentBases'],'problem');
  if(input.units!=='SI')throw new TypeError('Reference problem must explicitly use SI units');
  if(!input.materials||typeof input.materials!=='object'||Array.isArray(input.materials))throw new TypeError('materials map is required');
  const materials=Object.create(null);
  for(const [name,definition] of Object.entries(input.materials)){id(name,'material id');validateMaterial(definition);materials[name]=createMaterial(definition);}
  if(!Object.keys(materials).length)throw new TypeError('At least one material is required');
  if(!Array.isArray(input.objects)||!input.objects.length||input.objects.length>MAX_SAMPLES)throw new TypeError('objects are required');
  const objectIds=new Set();
  const objects=Array.from(input.objects,o=>{
    keys(o,['id','translation','rotation','pivot'],'object');id(o.id,'object id');if(objectIds.has(o.id))throw new TypeError('Duplicate object id');objectIds.add(o.id);
    const translation=vector(o.translation??[0,0,0],'translation');const pivot=vector(o.pivot??[0,0,0],'pivot');
    const q=o.rotation??[0,0,0,1];if(!Array.isArray(q)||q.length!==4)throw new TypeError('rotation must be an XYZW unit quaternion');Array.from(q,x=>finite(x,'rotation'));
    const norm=Math.hypot(...q);if(!Number.isFinite(norm)||Math.abs(norm-1)>1e-10)throw new TypeError('Only rigid unit-quaternion transforms are supported');
    return Object.freeze({id:o.id,translation,pivot,rotation:Object.freeze(q.map(x=>x/norm))});
  });
  const objectMap=new Map(objects.map(o=>[o.id,o]));
  if(!Array.isArray(input.samples)||!input.samples.length||input.samples.length>MAX_SAMPLES)throw new RangeError(`Reference solve requires 1..${MAX_SAMPLES} explicit weighted samples`);
  const sampleIds=new Set();
  const samples=Array.from(input.samples,s=>{
    keys(s,['id','objectId','materialId','localPosition','volume'],'sample');id(s.id,'sample id');if(sampleIds.has(s.id))throw new TypeError('Duplicate sample id');sampleIds.add(s.id);
    if(!objectMap.has(s.objectId))throw new TypeError('Unknown sample object');if(!Object.hasOwn(materials,s.materialId))throw new TypeError('Unknown sample material');
    const volume=finite(s.volume,'sample volume');if(volume<=0)throw new RangeError('Sample volume must be positive');
    return Object.freeze({id:s.id,objectId:s.objectId,materialId:s.materialId,localPosition:vector(s.localPosition,'localPosition'),volume});
  });
  const basisInputs=input.currentBases??[];
  if(!Array.isArray(basisInputs)||basisInputs.length>16)throw new RangeError('At most 16 explicitly supplied current bases are supported');
  const basisIds=new Set();let currentCount=0;
  const currentBases=Array.from(basisInputs,b=>{
    keys(b,['id','density','samples'],'current basis');id(b.id,'current basis id');if(basisIds.has(b.id))throw new TypeError('Duplicate current basis id');basisIds.add(b.id);
    const density=finite(b.density,'signed current density');if(!Array.isArray(b.samples)||!b.samples.length)throw new TypeError('A current basis requires explicit quadrature samples');
    const ids=new Set();const entries=Array.from(b.samples,s=>{
      keys(s,['id','objectId','localPosition','basisDensity','volume'],'current sample');id(s.id,'current sample id');if(ids.has(s.id))throw new TypeError('Duplicate current sample id');ids.add(s.id);
      if(!objectMap.has(s.objectId))throw new TypeError('Unknown current-sample object');const volume=finite(s.volume,'current volume');if(volume<=0)throw new RangeError('Current sample volume must be positive');
      if(++currentCount>2048)throw new RangeError('Current quadrature capacity exceeded');
      return Object.freeze({id:s.id,objectId:s.objectId,localPosition:vector(s.localPosition,'current localPosition'),basisDensity:vector(s.basisDensity,'normalized current density'),volume});
    });
    return Object.freeze({id:b.id,density,samples:Object.freeze(entries)});
  });
  for(const object of objects)if(!samples.some(s=>s.objectId===object.id)&&!currentBases.some(b=>b.samples.some(s=>s.objectId===object.id)))throw new TypeError('Every reference object must own a magnetic or current sample');
  const uniformH=vector(input.uniformH??[0,0,0],'uniformH');const selfDemagnetization=input.selfDemagnetization??'equivalent-sphere';
  if(!['equivalent-sphere','none'].includes(selfDemagnetization))throw new TypeError('Unsupported self-demagnetization reference model');
  const layoutKey=JSON.stringify([samples,Object.entries(materials)]);
  const sceneKey=JSON.stringify([layoutKey,objects,uniformH,selfDemagnetization,currentBases]);
  const problem=Object.freeze({units:'SI',materials:Object.freeze(materials),objects:Object.freeze(objects),samples:Object.freeze(samples),currentBases:Object.freeze(currentBases),uniformH,selfDemagnetization,layoutKey,sceneKey});
  issuedProblems.add(problem);
  return problem;
}

export function createReferenceState(problem){
  assertProblem(problem);
  const remanence=problem.samples.map(s=>createInitialState(problem.materials[s.materialId]).remanence);
  const state=Object.freeze({kind:'magneto-cpu-reference-state-v1',layoutKey:problem.layoutKey,remanence:deepVectors(remanence),M:deepVectors(remanence)});
  issuedStates.add(state);return state;
}
function assertProblem(problem){
  if(!problem||!issuedProblems.has(problem))throw new TypeError('Use createReferenceProblem');
}
function assertState(problem,state){
  if(!state||!issuedStates.has(state)||state.kind!=='magneto-cpu-reference-state-v1'||state.layoutKey!==problem.layoutKey||!Array.isArray(state.remanence)||state.remanence.length!==problem.samples.length||!Array.isArray(state.M)||state.M.length!==problem.samples.length)throw new TypeError('Reference physical state layout mismatch');
  state.remanence.forEach(v=>vector(v,'baseline remanence'));state.M.forEach(v=>vector(v,'baseline M'));
  problem.samples.forEach((s,i)=>evaluateMaterial(problem.materials[s.materialId],{H:[0,0,0],baselineRemanence:state.remanence[i]}));
}
function worldData(problem,M){
  const objectMap=new Map(problem.objects.map(o=>[o.id,o]));
  return problem.samples.map((s,i)=>{const o=objectMap.get(s.objectId);return {position:add(o.translation,rotate(o.rotation,s.localPosition)),moment:scale(rotate(o.rotation,M[i]),s.volume),volume:s.volume,objectId:s.objectId};});
}
function worldCurrentSources(problem,basis){
  const objects=new Map(problem.objects.map(o=>[o.id,o]));
  return basis.samples.map(s=>{const o=objects.get(s.objectId);return {objectId:s.objectId,position:add(o.translation,rotate(o.rotation,s.localPosition)),currentDensity:rotate(o.rotation,s.basisDensity),volume:s.volume};});
}
function prepareExternalField(problem,cache){
  const targets=worldData(problem,problem.samples.map(()=>[0,0,0])).map(s=>s.position);
  const H=targets.map(()=>[...problem.uniformH]);let builds=0,hits=0;
  for(const basis of problem.currentBases){
    const sources=worldCurrentSources(problem,basis);const key=JSON.stringify([targets,sources]);let field=cache.get(key);
    if(field){hits++;cache.delete(key);cache.set(key,field);}else{field=evaluateCurrentField(sources,targets).H;cache.set(key,field);builds++;while(cache.size>16)cache.delete(cache.keys().next().value);}
    field.forEach((h,i)=>{H[i]=vector(add(H[i],scale(h,basis.density)),'external current H');});
  }
  return {H,builds,hits};
}
function evaluateResidual(problem,baseState,M,externalH){
  const world=worldData(problem,M);const interactions=evaluateDirect(world);const objectMap=new Map(problem.objects.map(o=>[o.id,o]));
  const H=[],B=[],responses=[];let residual=0;
  problem.samples.forEach((s,i)=>{
    const o=objectMap.get(s.objectId);const magneticH=rotate(o.rotation,interactions.H[i],true);const imposedH=rotate(o.rotation,externalH[i],true);
    const h=add(add(magneticH,imposedH),problem.selfDemagnetization==='equivalent-sphere'?scale(M[i],-1/3):[0,0,0]);
    vector(h,'total H');const response=evaluateMaterial(problem.materials[s.materialId],{H:h,baselineRemanence:baseState.remanence[i]});
    const error=Math.hypot(...sub(response.M,M[i]))/problem.materials[s.materialId].saturationMagnetization;
    if(!Number.isFinite(error))throw new RangeError('Nonfinite constitutive residual');residual=Math.max(residual,error);
    H.push(h);B.push(vector(scale(add(h,M[i]),MU0),'material B'));responses.push(response);
  });
  return {world,interactions,H,B,responses,residual};
}
function options(input={}){
  keys(input,['maxIterations','tolerance','yieldEvery','yieldControl'],'solver option');
  const out={maxIterations:input.maxIterations??256,tolerance:input.tolerance??1e-8,yieldEvery:input.yieldEvery??8,yieldControl:input.yieldControl??(()=>new Promise(r=>setTimeout(r,0)))};
  if(!Number.isInteger(out.maxIterations)||out.maxIterations<1||out.maxIterations>4096)throw new RangeError('maxIterations is outside bounded reference limits');
  if(typeof out.tolerance!=='number'||!Number.isFinite(out.tolerance)||out.tolerance<1e-14||out.tolerance>1e-2)throw new RangeError('tolerance is outside bounded reference limits');
  if(!Number.isInteger(out.yieldEvery)||out.yieldEvery<1||out.yieldEvery>128||typeof out.yieldControl!=='function')throw new TypeError('Invalid cooperative yielding contract');
  return out;
}

export async function solveReference(problem,baseState,{signal,solverOptions,basisCache=createBasisCache()}={}){
  assertProblem(problem);assertState(problem,baseState);const config=options(solverOptions);checkAbort(signal);
  const start=performance.now();if(!issuedCaches.has(basisCache))throw new TypeError('Only the private reference-session basis cache is accepted');const external=prepareExternalField(problem,basisCache);let M=baseState.M.map(v=>[...v]);let evaluation=evaluateResidual(problem,baseState,M,external.H);let iteration=0,evaluations=1,rejectedSteps=0;
  let stepSize=.5;let reason='iteration-limit';
  while(evaluation.residual>config.tolerance&&iteration<config.maxIterations){
    checkAbort(signal);const direction=evaluation.responses.map((r,i)=>sub(r.M,M[i]));let accepted=false;let trialStep=Math.min(.8,stepSize);
    for(let backtrack=0;backtrack<24;backtrack++){
      const trialM=M.map((v,i)=>add(v,scale(direction[i],trialStep)));const trial=evaluateResidual(problem,baseState,trialM,external.H);evaluations++;
      if(trial.residual<=config.tolerance||trial.residual<evaluation.residual*(1-1e-4*trialStep)){
        M=trialM;evaluation=trial;stepSize=Math.min(.8,trialStep*1.5);accepted=true;break;
      }
      rejectedSteps++;trialStep*=.5;
    }
    iteration++;
    if(!accepted){reason='no-residual-descent';break;}
    if(iteration%config.yieldEvery===0){await config.yieldControl();checkAbort(signal);}
  }
  checkAbort(signal);const converged=evaluation.residual<=config.tolerance;if(converged)reason='converged';
  const remanence=evaluation.responses.map(r=>r.remanence);
  const fixedMomentInteractionEnergy=finite(evaluation.interactions.energy-MU0*evaluation.world.reduce((sum,s,i)=>sum+dot(s.moment,external.H[i]),0),'fixed-moment energy');
  const state=Object.freeze({kind:'magneto-cpu-reference-state-v1',layoutKey:problem.layoutKey,sceneKey:problem.sceneKey,converged,
    M:deepVectors(M),remanence:deepVectors(remanence),H:deepVectors(evaluation.H),B:deepVectors(evaluation.B),
    saturation:Object.freeze(evaluation.responses.map(r=>r.saturation)),
    fixedMomentInteractionEnergy});
  issuedStates.add(state);
  const metrics=Object.freeze({iterations:iteration,evaluations,rejectedSteps,currentBasisBuilds:external.builds,currentBasisHits:external.hits,wallMs:performance.now()-start,reason,converged,residual:evaluation.residual,tolerance:config.tolerance});
  return Object.freeze({state,residual:evaluation.residual,tolerance:config.tolerance,metrics});
}

export function referenceLoads(problem,state,{selectedOwners,pivot}={}){
  assertProblem(problem);assertState(problem,state);
  if(state.sceneKey!==problem.sceneKey||state.converged!==true)throw new TypeError('Loads require a solved state for the exact reference scene');
  if(!Array.isArray(selectedOwners)||!selectedOwners.length||new Set(selectedOwners).size!==selectedOwners.length||selectedOwners.some(owner=>!problem.objects.some(o=>o.id===owner)))throw new TypeError('A nonempty unique selection of known reference owners is required');
  if(problem.currentBases.some(b=>b.samples.some(s=>selectedOwners.includes(s.objectId))))throw new TypeError('Resultant current-conductor loads require an unsupported source-reaction model');
  const p=vector(pivot??[0,0,0],'world pivot');const world=worldData(problem,state.M);const selected=new Set(selectedOwners);const direct=evaluateDirect(world,{selectedOwners,pivot:p});
  let currentForce=[0,0,0],currentTorque=[0,0,0];
  for(const basis of problem.currentBases){
    const sources=worldCurrentSources(problem,basis).map(s=>({...s,currentDensity:scale(s.currentDensity,basis.density)}));
    const contribution=evaluatePrescribedCurrentLoads(sources,world,{selectedOwners,pivot:p});
    currentForce=add(currentForce,contribution.selection.force);currentTorque=add(currentTorque,contribution.selection.torque);
  }
  const extraTorque=world.filter(s=>selected.has(s.objectId)).reduce((sum,s)=>add(sum,scale(cross(s.moment,problem.uniformH),MU0)),[0,0,0]);
  return Object.freeze({force:vector(add(direct.selection.force,currentForce),'force'),torque:vector(add(add(direct.selection.torque,extraTorque),currentTorque),'torque'),pivot:p,
    scope:'Fixed-moment interaction loads of this bounded reference model; not nonlinear free-energy or native geometry certification'});
}

export function createReferenceSession(input,{solverOptions}={}){
  let problem=createReferenceProblem(input);let initial=createReferenceState(problem);let lastResult=null;let dirty=true;let releasedLeases=0;let callSerial=0;const basisCache=createBasisCache();const referenceOptions=options(solverOptions);
  const controller=createPhysicalStateController({initialState:initial,releaseState:()=>{releasedLeases++;}});
  const inspect=()=>Object.freeze({...controller.inspect(),dirty,releasedLeases,capabilities:REFERENCE_CAPABILITIES,sceneKey:problem.sceneKey});
  return Object.freeze({
    inspect,
    getResult:()=>lastResult,
    async solveFrame({time,signal}={}){
      const captured=problem;const serial=++callSerial;const step=controller.beginStep({time,signal});dirty=true;let solved;
      try{
        await step.iterate(async ({baseState,signal:stepSignal})=>{solved=await solveReference(captured,baseState,{signal:stepSignal,solverOptions:referenceOptions,basisCache});return solved;});
        if(solved.residual>solved.tolerance){step.abort('Reference solver did not converge');return Object.freeze({committed:false,metrics:solved.metrics,status:'NOT_CONVERGED'});}
        const metadata=step.commit();lastResult=Object.freeze({state:solved.state,metrics:solved.metrics,time,sceneKey:captured.sceneKey});if(serial===callSerial)dirty=false;
        return Object.freeze({committed:true,status:'CPU_REFERENCE_ONLY',result:lastResult,metadata});
      }catch(error){step.abort('Reference solve failed');throw error;}
    },
    updateProblem(input){const next=createReferenceProblem(input);if(next.layoutKey!==problem.layoutKey)throw new TypeError('Material/sample-layout changes require resetProblem');controller.invalidate();problem=next;dirty=true;return inspect();},
    resetProblem(input){const next=createReferenceProblem(input);const state=createReferenceState(next);controller.reset({state});problem=next;initial=state;lastResult=null;dirty=true;return inspect();},
    clearTransient(){controller.clearTransient();return inspect();},
    dispose(){lastResult=null;basisCache.clear();return controller.dispose();},
  });
}
