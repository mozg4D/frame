/** Bounded quasistatic chronological CPU reference. No native timeline or curves. */
import { createReferenceProblem, createReferenceState, solveReference } from './reference-solver.js';

const issuedSchedules = new WeakMap();
export const ANIMATION_REFERENCE_LIMITS = Object.freeze({maxKnots:128,maxAcceptedSteps:4096,maxEvaluations:16384,maxDepth:20});
const keys=(v,allowed,label)=>{if(!v||typeof v!=='object'||Array.isArray(v))throw new TypeError(`${label} must be an object`);for(const k of Object.keys(v))if(!allowed.includes(k))throw new TypeError(`Unsupported ${label} field: ${k}`);};
const finite=(x,label)=>{if(typeof x!=='number'||!Number.isFinite(x))throw new TypeError(`${label} must be finite`);return x;};
const vector=v=>{if(!Array.isArray(v)||v.length!==3)throw new TypeError('uniformH must be vec3');return Object.freeze(Array.from(v,x=>finite(x,'uniformH')));};
const fail=(reason,message)=>{throw Object.assign(new Error(message),{name:'ReferenceAnimationError',reason});};
const checkAbort=signal=>{if(signal?.aborted)throw Object.assign(new Error('Reference animation aborted'),{name:'AbortError'});};
const bounded=(value,fallback,maximum,label)=>{const x=value??fallback;if(!Number.isInteger(x)||x<1||x>maximum)throw new RangeError(`${label} is outside bounded reference limits`);return x;};

/** Every knot explicitly specifies every supported source; no hidden callback events. */
export function createReferenceSchedule(problem,input){
  // This also checks problem provenance without exposing reference-solver internals.
  createReferenceState(problem);
  keys(input,['knots'],'schedule');
  if(!Array.isArray(input.knots)||input.knots.length<1||input.knots.length>ANIMATION_REFERENCE_LIMITS.maxKnots)throw new RangeError('Schedule requires 1..128 explicit knots');
  const basisIds=problem.currentBases.map(b=>b.id);let previous=null;
  const knots=Array.from(input.knots,k=>{
    keys(k,['time','uniformH','currentDensities'],'knot');const time=finite(k.time,'knot time');
    if(previous!==null&&(!(time>previous)||!Number.isFinite(time-previous)))throw new RangeError('Knot times must strictly increase with finite intervals');previous=time;
    const uniformH=vector(k.uniformH);keys(k.currentDensities,basisIds,'currentDensities');
    if(Object.keys(k.currentDensities).length!==basisIds.length||basisIds.some(id=>!Object.hasOwn(k.currentDensities,id)))throw new TypeError('Every current basis density is required at every knot');
    const currentDensities=Object.freeze(Object.fromEntries(basisIds.map(id=>[id,finite(k.currentDensities[id],'signed current density')])));
    return Object.freeze({time,uniformH,currentDensities});
  });
  const schedule=Object.freeze({kind:'magneto-reference-piecewise-linear-v1',knots:Object.freeze(knots)});
  issuedSchedules.set(schedule,problem);return schedule;
}

function options(input={}){
  keys(input,['tolerance','maxAcceptedSteps','maxEvaluations','maxDepth','yieldEvery'],'animation option');
  const tolerance=finite(input.tolerance??1e-3,'animation tolerance');if(tolerance<1e-10||tolerance>1e-1)throw new RangeError('Animation tolerance must be in [1e-10, 0.1]');
  return Object.freeze({tolerance,maxAcceptedSteps:bounded(input.maxAcceptedSteps,1024,4096,'maxAcceptedSteps'),
    maxEvaluations:bounded(input.maxEvaluations,4096,16384,'maxEvaluations'),maxDepth:bounded(input.maxDepth,16,20,'maxDepth'),yieldEvery:bounded(input.yieldEvery,16,128,'yieldEvery')});
}
function at(problem,source){
  return createReferenceProblem({units:problem.units,materials:problem.materials,objects:problem.objects,samples:problem.samples,
    selfDemagnetization:problem.selfDemagnetization,uniformH:source.uniformH,
    currentBases:problem.currentBases.map(b=>({...b,density:source.currentDensities[b.id]}))});
}
function midpoint(a,b){
  const time=a.time+(b.time-a.time)/2;
  const average=(x,y)=>x/2+y/2;
  return {time,uniformH:a.uniformH.map((x,i)=>average(x,b.uniformH[i])),
    currentDensities:Object.fromEntries(Object.keys(a.currentDensities).map(id=>[id,average(a.currentDensities[id],b.currentDensities[id])]))};
}
function errorEstimate(problem,start,coarse,half,fine){
  let error=0;
  problem.samples.forEach((sample,i)=>{
    const ms=problem.materials[sample.materialId].saturationMagnetization;
    for(const field of ['M','remanence']){
      error=Math.max(error,Math.hypot(...fine[field][i].map((x,j)=>x-coarse[field][i][j]))/ms,
        Math.hypot(...half[field][i].map((x,j)=>x-(start[field][i][j]/2+coarse[field][i][j]/2)))/ms);
    }
  });
  if(!Number.isFinite(error))fail('NONFINITE_ERROR','Nonfinite chronological error estimate');return error;
}

/** Pure transaction: the issued baseline is untouched and only full success returns state. */
export async function solveReferenceAnimation(problem,initialState,schedule,input={}){
  keys(input,['signal','solverOptions','animationOptions'],'animation solve option');
  if(issuedSchedules.get(schedule)!==problem)throw new TypeError('Use an issued schedule for this exact reference problem');
  const {signal}=input;if(signal&&(typeof signal.addEventListener!=='function'||typeof signal.removeEventListener!=='function'))throw new TypeError('signal must be an AbortSignal');
  const config=options(input.animationOptions);
  if(input.solverOptions!==undefined)keys(input.solverOptions,['maxIterations','tolerance','yieldEvery','yieldControl'],'solver option');
  // The driver also yields between solves; avoid a timer per tiny nonlinear fixture.
  const solverOptions=Object.freeze({yieldEvery:128,...input.solverOptions});
  checkAbort(signal);const started=performance.now();const trace=[];
  let evaluations=0,solverEvaluations=0,acceptedSteps=0,rejectedIntervals=0,maxDepthReached=0,maxAcceptedError=0;
  async function evaluate(source,baseline){
    checkAbort(signal);if(evaluations>=config.maxEvaluations)fail('EVALUATION_BUDGET','Chronological solve evaluation budget exhausted');
    evaluations++;const p=at(problem,source);const result=await solveReference(p,baseline,{signal,solverOptions});
    checkAbort(signal);solverEvaluations+=result.metrics.evaluations;
    if(!result.metrics.converged)fail('NOT_CONVERGED','Chronological reference physical solve did not converge');
    if(evaluations%config.yieldEvery===0){await new Promise(resolve=>setTimeout(resolve,0));checkAbort(signal);}
    return {problem:p,...result};
  }
  function record(source,result,knotIndex,depth,error){
    if(acceptedSteps>=config.maxAcceptedSteps)fail('STEP_BUDGET','Chronological accepted-step budget exhausted');
    acceptedSteps++;maxAcceptedError=Math.max(maxAcceptedError,error);
    trace.push(Object.freeze({time:source.time,knotIndex,depth,error,residual:result.residual,
      maxMagnetization:Math.max(...result.state.M.map(v=>Math.hypot(...v))),maxRemanence:Math.max(...result.state.remanence.map(v=>Math.hypot(...v)))}));
  }
  async function interval(a,b,start,knotIndex,depth){
    checkAbort(signal);maxDepthReached=Math.max(maxDepthReached,depth);
    const mid=midpoint(a,b);
    if(!(mid.time>a.time&&mid.time<b.time))fail('TIME_RESOLUTION','Cannot represent a chronological midpoint');
    let coarse=await evaluate(b,start),half=await evaluate(mid,start),fine=await evaluate(b,half.state);
    const error=errorEstimate(problem,start,coarse.state,half.state,fine.state);
    if(error<=config.tolerance){record(mid,half,null,depth,error);record(b,fine,knotIndex,depth,error);return fine;}
    rejectedIntervals++;coarse=null;half=null;fine=null;
    if(depth>=config.maxDepth)fail('REFINEMENT_LIMIT','Chronological refinement depth exhausted');
    // Trial histories are discarded. Both children replay from their true chronological baseline.
    let left=await interval(a,mid,start,null,depth+1);const baseline=left.state;left=null;
    return interval(mid,b,baseline,knotIndex,depth+1);
  }
  const knots=schedule.knots;let final=await evaluate(knots[0],initialState);record(knots[0],final,0,0,0);
  for(let i=1;i<knots.length;i++)final=await interval(knots[i-1],knots[i],final.state,i,0);
  checkAbort(signal);
  return Object.freeze({status:'CPU_CHRONOLOGICAL_REFERENCE_ONLY',state:final.state,finalProblem:final.problem,trace:Object.freeze(trace),
    metrics:Object.freeze({evaluations,solverEvaluations,acceptedSteps,rejectedIntervals,maxDepthReached,maxAcceptedError,knotCount:knots.length,tolerance:config.tolerance,wallMs:performance.now()-started})});
}
