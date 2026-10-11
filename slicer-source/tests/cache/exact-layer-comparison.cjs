'use strict';
// Review harness only. execute must use the existing Frame task/shared budget.
// Never starts a pool, reads private files, or runs a scene by itself.
const DEFAULT_PLAN=Object.freeze({kind:'identical-prefix-warmup',lastLayer:91,selectedLayers:Object.freeze([1,32,64,69,70,71,...Array.from({length:20},(_,i)=>72+i)]),coordinateTolerance:0,widthTolerance:0,angleTolerance:0,maxWitnessBytes:64*1024**2});
function exactEncode(value,stack=new Set()){
 if(value===null)return['null'];
 switch(typeof value){
  case'undefined':return['undefined'];case'boolean':return['boolean',value];case'string':return['string',value];
  case'number':{if(!Number.isFinite(value))throw Error('Nonfinite value in exact witness');const b=new ArrayBuffer(8),d=new DataView(b);d.setFloat64(0,value,false);return['f64',Array.from(new Uint8Array(b),q=>q.toString(16).padStart(2,'0')).join('')];}
  case'bigint':return['bigint',value.toString()];
  case'object':break;default:throw Error('Unsupported witness value '+typeof value);
 }
 if(stack.has(value))throw Error('Cyclic witness value');stack.add(value);let result;
 const tag=Object.prototype.toString.call(value);
 if(ArrayBuffer.isView(value)){const bytes=new Uint8Array(value.buffer,value.byteOffset,value.byteLength);if(tag==='[object Float32Array]'||tag==='[object Float64Array]')for(const n of value)if(!Number.isFinite(n))throw Error('Nonfinite typed geometry/angle');result=['view',tag.slice(8,-1),Array.from(bytes,q=>q.toString(16).padStart(2,'0')).join('')];}
 else if(Object.prototype.toString.call(value)==='[object ArrayBuffer]')result=['buffer',Array.from(new Uint8Array(value),q=>q.toString(16).padStart(2,'0')).join('')];
 else if(Array.isArray(value))result=['array',Array.from({length:value.length},(_,i)=>Object.hasOwn(value,i)?exactEncode(value[i],stack):['hole'])];
 else if(tag==='[object Map]')result=['map',Array.from(value,([k,v])=>[exactEncode(k,stack),exactEncode(v,stack)])];
 else if(tag==='[object Set]')result=['set',Array.from(value,q=>exactEncode(q,stack))];
 else if(Object.prototype.toString.call(value)==='[object Object]')result=['object',Object.keys(value).sort().map(k=>[k,exactEncode(value[k],stack)])];
 else throw Error('Unsupported witness object '+Object.prototype.toString.call(value));
 stack.delete(value);return result;
}
function exactDifference(a,b,path='$'){
 if(Object.is(a,b))return null;if(typeof a!==typeof b||a===null||b===null||typeof a!=='object')return{path,baseline:a,candidate:b};
 const aa=Array.isArray(a),bb=Array.isArray(b);if(aa!==bb)return{path,baselineType:aa?'array':'object',candidateType:bb?'array':'object'};
 const ak=Object.keys(a),bk=Object.keys(b);if(ak.length!==bk.length||ak.some((k,i)=>k!==bk[i]))return{path,baselineKeys:ak,candidateKeys:bk};
 for(const k of ak){const d=exactDifference(a[k],b[k],path+(aa?'['+k+']':'.'+k));if(d)return d;}return null;
}
function validatePlan(plan){
 if(plan.kind!=='identical-prefix-warmup'||!Number.isSafeInteger(plan.lastLayer)||plan.lastLayer<1||plan.lastLayer>256||!Array.isArray(plan.selectedLayers)||!plan.selectedLayers.length||plan.selectedLayers.some((q,i)=>!Number.isSafeInteger(q)||q<1||q>plan.lastLayer||i>0&&q<=plan.selectedLayers[i-1]))throw Error('Invalid bounded comparison plan');
 if(plan.coordinateTolerance!==0||plan.widthTolerance!==0||plan.angleTolerance!==0)throw Error('Scheduling A/B must compare exactly; 2% W is not an A/B allowance');
 if(!Number.isSafeInteger(plan.maxWitnessBytes)||plan.maxWitnessBytes<1024||plan.maxWitnessBytes>64*1024**2)throw Error('Invalid witness retention limit');
}
function unique(source,a,b){if(source.split(a).length!==2)throw Error('Unique comparison anchor required: '+a.slice(0,100));return source.replace(a,b);}
function instrumentForComparison(workerSource,plan=DEFAULT_PLAN){
 validatePlan(plan);let s=workerSource;
 s=unique(s,'const wake=()=>{for(const resolve of wakeups.splice(0))resolve();}',`send({layers:[],qaPlan:{occupiedPrefix:activeLayers.filter(layer=>layer<=${plan.lastLayer}),fullOccupiedCount:activeLayers.length,lastLayer:${plan.lastLayer}}});last=Math.min(last,${plan.lastLayer});activeLayers.splice(activeLayers.findIndex(layer=>layer>${plan.lastLayer})<0?activeLayers.length:activeLayers.findIndex(layer=>layer>${plan.lastLayer}));\n  const wake=()=>{for(const resolve of wakeups.splice(0))resolve();}`);
 s=unique(s,'if(output.paths.length||entry.recovery)batch.push({layer:entry.layer,...output,references:references(entry.job.values)});','send({layers:[],qaCommit:{layer:entry.layer,empty:output.paths.length===0,recovery:!!entry.recovery}});\n    if(output.paths.length||entry.recovery)batch.push({layer:entry.layer,...output,references:references(entry.job.values)});');
 return s;
}
function createCapture(plan=DEFAULT_PLAN){
 validatePlan(plan);const selected=new Set(plan.selectedLayers),definitions=new Map(),angles=new Map(),layers=[],commits=[];let occupancy=null,occupiedPrefix=null,complete=false;
 const encode=q=>exactEncode(q),limit=q=>{if(new TextEncoder().encode(JSON.stringify(q)).length>plan.maxWitnessBytes)throw Object.assign(Error('Exact witness retention limit exceeded'),{code:'FRAME_QA_WITNESS_LIMIT'});};
 function packet(q){
  if(q.type==='sliceStatus')return;
  if(q.qaPlan){if(occupancy)throw Error('Duplicate occupied plan');occupancy=encode(q.qaPlan);occupiedPrefix=q.qaPlan.occupiedPrefix.slice();const missing=plan.selectedLayers.filter(layer=>!occupiedPrefix.includes(layer));if(missing.length)throw Error('Requested layers are not source-occupied: '+missing.join(','));}
  if(q.qaCommit){const previous=commits.at(-1);if(previous&&q.qaCommit.layer<=previous.layer)throw Error('Commit order mismatch');commits.push(structuredClone(q.qaCommit));}
  for(const d of q.referenceDefs||[]){if(!Number.isSafeInteger(d.id)||d.id<1||!d.value?.section||!d.value?.inset)throw Error('Invalid source reference definition');if(definitions.has(d.id))throw Error('Duplicate source reference ID '+d.id);definitions.set(d.id,encode(d.value));}
  for(const d of q.angleValuesList||[])if(selected.has(d.layer)){if(angles.has(d.layer))throw Error('Duplicate source-angle packet '+d.layer);angles.set(d.layer,encode(d.angleValues));}
  for(const layer of q.layers||[])if(selected.has(layer.layer)){const prev=layers.at(-1);if(prev&&layer.layer<=prev.layer)throw Error('Layer output order mismatch');const ids=layer.referenceIds||[];for(const id of ids)if(!definitions.has(id))throw Error('Unresolved source reference '+id);layers.push({layer:layer.layer,referenceIds:ids.slice(),output:encode(layer)});}
  limit({occupancy,layers,angles:[...angles],definitions:[...definitions],commits});
 }
 function finish(){
  if(!occupancy||complete)throw Error('Missing/duplicate capture completion');complete=true;
  const missing=plan.selectedLayers.filter(layer=>!commits.some(q=>q.layer===layer));if(missing.length)throw Error('Missing committed selected layers '+missing.join(','));if(commits.length!==occupiedPrefix.length||commits.some((q,i)=>q.layer!==occupiedPrefix[i]))throw Error('Occupied prefix was not committed exactly once in order');
  for(const layer of plan.selectedLayers){const row=commits.find(q=>q.layer===layer);if(!row.empty&&!layers.some(q=>q.layer===layer))throw Error('Missing nonempty final output '+layer);}
  for(const layer of layers)if(!commits.find(q=>q.layer===layer.layer).empty&&!angles.has(layer.layer))throw Error('Missing source-angle annotation '+layer.layer);
  const used=new Set(layers.flatMap(q=>q.referenceIds));const result={schema:'frame-exact-layer-witness-v1',plan:encode(plan),occupancy,commits:encode(commits),layers,sourceReferences:[...definitions].filter(([id])=>used.has(id)).map(([id,value])=>({id,value})),sourceAngles:[...angles].sort((a,b)=>a[0]-b[0]).map(([layer,value])=>({layer,value})),tolerances:{coordinates:0,widths:0,angles:0},successfulOutputOnly:true};limit(result);return result;
 }
 return{packet,finish};
}
async function runPair({execute,baselineSource,candidateSource,meshes,params,plan=DEFAULT_PLAN,cpuWindowConfirmed=false,signal,inputKind='private-real-scene',maxRunMS=90000}){
 if(cpuWindowConfirmed!==true)throw Error('A coordinated CPU window is required; this harness never starts automatically');
 if(typeof execute!=='function')throw Error('Provide existing Frame frameSlicerTask/shared-budget adapter');if(params.angleWarnings!==true)throw Error('Exact source-angle comparison requires angleWarnings=true');if(!['private-real-scene','synthetic'].includes(inputKind)||!Number.isInteger(maxRunMS)||maxRunMS<1||maxRunMS>90000)throw Error('Invalid comparison execution boundary');validatePlan(plan);
 const inputBefore=JSON.stringify(exactEncode({meshes,params})),runs=[];
 for(const [name,source]of [['baseline',baselineSource],['candidate',candidateSource]]){
  if(signal?.aborted)throw Error('Comparison cancelled');const capture=createCapture(plan),controller=new AbortController(),cancel=()=>controller.abort(),timer=setTimeout(cancel,maxRunMS);signal?.addEventListener('abort',cancel,{once:true});let stats;
  try{stats=await execute({name,workerSource:instrumentForComparison(source,plan),meshes,params,signal:controller.signal,onUpdate:capture.packet});if(controller.signal.aborted)throw Error('Comparison cancelled or bounded run timed out');}finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
  if(JSON.stringify(exactEncode({meshes,params}))!==inputBefore)throw Error('Immutable input changed during '+name);
  runs.push({name,witness:capture.finish(),stats});
 }
 const difference=exactDifference(runs[0].witness,runs[1].witness);return{equal:difference===null,difference,runs,privateRealSceneRun:inputKind==='private-real-scene',fullBaseline:false,successfulOutputEquivalenceOnly:true,newPool:false};
}
const api={DEFAULT_PLAN,exactEncode,exactDifference,validatePlan,instrumentForComparison,createCapture,runPair};
if(typeof module==='object')module.exports=api;else globalThis.FrameExactLayerComparison=api;
