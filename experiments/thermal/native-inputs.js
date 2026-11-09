import {copyPhysicalFrame} from '../../plugins/thermal/native-frame.js';

// Unregistered native input observation. The adapter owns no GPU resources;
// inherited native tag.list settlement can perform geometry/plugin GPU work.
// This is NOT geometry
// classification, a solver request, tag registration, or a public operation.
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const need=(ok,message,code='INVALID_NATIVE_INPUT')=>{if(!ok)fail(code,message);};
const hash=x=>typeof x==='string'&&/^[a-f0-9]{32}$/.test(x);
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const kinds=['thermal_material','thermal_heater'];
const materialKeys=['Density','Specific heat','Conductivity'];
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
function object(value,keys){
 need(value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value)),'Expected native plain-data parameters.');
 const d=Object.getOwnPropertyDescriptors(value);
 need(Reflect.ownKeys(d).length===keys.length&&keys.every(k=>Object.hasOwn(d,k)&&d[k].enumerable&&Object.hasOwn(d[k],'value')),'Parameters must use exactly the explicit physical schema.');
 return Object.fromEntries(keys.map(k=>[k,d[k].value]));
}
function vector(value,length){
 need(Array.isArray(value)&&Object.getPrototypeOf(value)===Array.prototype&&value.length===length,'Expected native numeric array.');
 const d=Object.getOwnPropertyDescriptors(value);
 need(Reflect.ownKeys(d).length===length+1&&Array.from({length},(_,i)=>d[i]).every(x=>x?.enumerable&&Object.hasOwn(x,'value')&&finite(x.value)),'Expected dense own numeric data.');
 return Array.from({length},(_,i)=>d[i].value);
}
export function nativeMaterialSI(parameters){
 const p=object(parameters,materialKeys);
 need(Object.values(p).every(x=>finite(x)&&x>0),'Density, mass-specific heat and conductivity must be explicitly positive.');
 const capacity=p.Density*p['Specific heat'];
 need(finite(capacity)&&capacity>=2**-1022,'Density times mass-specific heat is not representable.','NUMERICAL_RANGE');
 return freeze({densityKgPerM3:p.Density,specificHeatJPerKgK:p['Specific heat'],conductivityWPerMK:p.Conductivity,volumetricHeatCapacityJPerM3K:capacity});
}
function nativeHeaterSI(parameters){
 const p=object(parameters,['Power']);
 need(finite(p.Power)&&(p.Power===0||Math.abs(p.Power)>=2**-1022),'Heater Power must be representable signed total watts.');
 return freeze({powerWatts:p.Power,model:'constant-total-object-power'});
}
function schemaStamp(rows){
 need(Array.isArray(rows),'Native tag discovery unavailable.','THERMAL_TAGS_UNAVAILABLE');
 return kinds.map((kind,index)=>{
  const matches=rows.filter(row=>row.kind===kind),keys=index===0?materialKeys:['Power'];
  need(matches.length===1&&matches[0].plugin==='thermal','Thermal physical tags are not installed under their native plugin. Opaque saved data is not active authoring.','THERMAL_TAGS_UNAVAILABLE');
  const fields=object(matches[0].fields,keys);
  need(Object.values(fields).every(finite),'Thermal tag declaration must provide scalar numeric fields in explicit SI units.','UNSUPPORTED_TAG_SCHEMA');
  return {kind,plugin:matches[0].plugin,fields};
 });
}
function readToken(value,owner){
 need(value?.owner===owner&&value.field==='name'&&value.availability==='available'&&value.access==='read-write'&&typeof value.epoch==='string'&&value.epoch.length>0&&Number.isSafeInteger(value.revision)&&value.revision>=0,'Native epoch/generation observation is unavailable.','NATIVE_LIFECYCLE_UNAVAILABLE');
 return {epoch:value.epoch,revision:value.revision};
}

/** Invoke outside the Frame command queue, after native scene settlement.
 * Uses the existing FIFO read APIs. Never call this recursively from a
 * plugins.command handler. This observational path intentionally does not use
 * the core's separate synchronous context.fields.authoringStamp() capability.
 * The comparison observes native revisions asynchronously. It is NOT atomic:
 * an ABA edit after a read and before its promise resumes can escape it.
 * Never use this comparison as a numerical kernel check or solve authority.
 * tag.list also settles/flushes native plugins. An in-flight job guard must
 * not re-enter that path; a future plugin could wait on its own work tail.
 */
export async function captureNativeThermalInputs(context,ownerHash,{signal}={}){
 need(hash(ownerHash),'Canonical Thermal owner hash required.');
 need(context?.api&&typeof context.api.call==='function'&&context.document&&typeof context.document.world==='function'&&typeof context.scene?.capture==='function','Current native document/capture/API context required.');
 need(!signal||typeof signal.aborted==='boolean'&&typeof signal.addEventListener==='function'&&typeof signal.removeEventListener==='function','Invalid cancellation signal.');
 const start=performance.now(),D=context.document;
 let retired=false,baseline=null,token=null,descriptors=null,checks=0,reads=0;
 const cancel=()=>{need(!signal?.aborted,'Native input capture cancelled.','CANCELLED');need(!retired,'Native input observation retired.','RETIRED_INPUT');};
 const retire=()=>{retired=true;baseline=null;token=null;descriptors=null;signal?.removeEventListener('abort',retire);};
 signal?.addEventListener('abort',retire,{once:true});
 async function call(name,args={}){cancel();reads++;const result=await context.api.call(name,args);cancel();return result;}
 function observe(){
  cancel();need(!D.playing&&!D.exporting&&!context.scene.transforming,'Pause playback and finish native transformations/export before capturing inputs.','NATIVE_BUSY');
  const nodes=D.nodes;need(Array.isArray(nodes),'Native nodes unavailable.');
  const byHash=new Map(),byID=new Map();
  for(const n of nodes){const list=byHash.get(n.nativeHash)||[];list.push(n);byHash.set(n.nativeHash,list);const ids=byID.get(n.id)||[];ids.push(n);byID.set(n.id,ids);}
  const unique=h=>{const found=byHash.get(h);need(found?.length===1,'Missing or ambiguous native owner.','INVALID_OWNER');return found[0];};
  const owner=unique(ownerHash);need(owner.type==='thermal','Expected a native Thermal owner.','INVALID_OWNER');
  function ancestry(n){
   const seen=new Set();let child=n;
   while(child){need(!seen.has(child),'Cyclic native hierarchy.');seen.add(child);need(child.enabled!==false,'Disabled native owner or ancestor.','NATIVE_DISABLED');
    if(child!==n)need(!(child.tags||[]).some(t=>kinds.includes(t.kind)),'Inherited physical tags are outside this direct-owner stage.','UNSUPPORTED_INHERITANCE');
    if(child.parent===null||child.parent===undefined)break;
    const found=byID.get(child.parent);need(found?.length===1,'Missing or ambiguous native parent.','INVALID_OWNER');child=found[0];
   }
   return [...seen];
  }
  const ancestors=ancestry(owner),world=copyPhysicalFrame({kind:'physical-owner',ownerWorld:vector(Array.from(D.world(ownerHash)),16)}).ownerWorld;
  const ownerParams=object(owner.params,['Ambient','Initial']);need(Object.values(ownerParams).every(x=>finite(x)&&x>=-273.15),'Invalid Thermal temperatures.');
  const captured=context.scene.capture(ownerHash,['Initial','Ambient']);cancel();
  need(captured?.device===context.device&&captured.device&&typeof captured.scene==='number'&&typeof captured.signature==='string'&&typeof captured.contentSignature==='string'&&Array.isArray(captured.meshes),'Invalid native scene capture.');
  const capturedOwners=new Set(captured.meshes.map(m=>m.hash));
  need(!nodes.some(n=>(n.tags||[]).some(t=>kinds.includes(t.kind))&&!capturedOwners.has(n.nativeHash)),'An active physical tag owner is absent from native visible capture. Visibility is not a physical exclusion policy.','UNCAPTURED_PHYSICAL_SOURCE');
  need(captured.meshes.length>0&&captured.meshes.length<=64,'Native observation supports 1..64 occurrences.','NATIVE_INPUT_LIMIT');
  const used=new Set(),sourceRefs=[],resources=[],occurrences=captured.meshes.map((mesh,index)=>{
   need(hash(mesh.hash)&&mesh.solid===index,'Invalid captured occurrence identity.');
   need(!used.has(mesh.hash),'Repeated native owners/instances need explicit source allocation semantics.','UNSUPPORTED_OCCURRENCES');used.add(mesh.hash);
   const n=unique(mesh.hash);need(n!==owner&&!['thermal','thermal_fan','thermal_probe'].includes(n.type),'Helpers cannot supply physical material.');
   // Current pluginSnapshot omits canonical replica provenance. A single
   // occurrence is therefore not evidence of a direct source owner.
   need(!['instance','cloner','symmetry'].includes(n.type)&&n.instanceCloud===undefined&&!n.replicaSource&&!n.replicaMatrix&&!mesh.replicaSource&&!mesh.replicaMatrix,'Replica and instance-cloud source provenance is unavailable in this capture contract.','UNSUPPORTED_SOURCE_KIND');
   sourceRefs.push(n,...ancestry(n));
   need(Array.isArray(n.tags),'Native tags unavailable.');
   const material=n.tags.filter(t=>t.kind==='thermal_material'),heater=n.tags.filter(t=>t.kind==='thermal_heater');
   need(material.length===1&&heater.length<=1,'Every captured occurrence requires one direct active Material and at most one direct Heater.');
   for(const tag of [...material,...heater]){
    need(hash(tag.uid)&&!tag.referencesUnresolved,'Unresolved or missing physical tag identity.');
    need(n.tags.filter(t=>t.uid===tag.uid).length===1,'Physical tag UID is ambiguous within its native owner.','AMBIGUOUS_TAG_IDENTITY');
   }
   need(Number.isSafeInteger(mesh.vertexCount)&&mesh.vertexCount>=3&&Number.isSafeInteger(mesh.triangleCount)&&mesh.triangleCount>0&&['buffer','texture'].includes(mesh.storage),'Invalid captured geometry metadata.');
   const matrix=vector(mesh.matrix,16);need(matrix[3]===0&&matrix[7]===0&&matrix[11]===0&&matrix[15]===1,'Captured occurrence matrix must be affine.');
   resources.push(mesh.positions,mesh.indices);need(mesh.positions&&mesh.indices,'Native geometry resources unavailable.');
   const si=nativeMaterialSI(material[0].params),power=heater.length?{sourceOwner:mesh.hash,tagUID:heater[0].uid,...nativeHeaterSI(heater[0].params)}:null;
   return {occurrence:index,owner:mesh.hash,sourceKind:n.type,matrix,vertexCount:mesh.vertexCount,triangleCount:mesh.triangleCount,storage:mesh.storage,material:{sourceOwner:mesh.hash,tagUID:material[0].uid,...si},heater:power};
  });
  const lengths=[0,4,8].map(i=>Math.hypot(...world.slice(i,i+3))),data={scope:'native-thermal-input-observation',solverReady:false,currentnessCertified:false,geometryClassified:false,completePhysicalScene:false,presentationFilter:'native-visible-occurrences',owner:ownerHash,ownerWorld:[...world],ownerLocalMillimetresToMetres:lengths.map(x=>x*.001),initialCelsius:ownerParams.Initial,ambientCelsius:ownerParams.Ambient,boundaryCondition:'not-defined-by-ambient',occurrences};
  need(data.ownerLocalMillimetresToMetres.every(x=>finite(x)&&x>=2**-1022),'Physical frame scale is not representable.','NUMERICAL_RANGE');
  return {owner,ancestors,sourceRefs,resources,device:captured.device,scene:captured.scene,signature:captured.signature,contentSignature:captured.contentSignature,data};
 }
 function compare(current){
  const identities=['ancestors','sourceRefs','resources'];
  need(current.owner===baseline.owner&&current.device===baseline.device&&current.scene===baseline.scene&&current.signature===baseline.signature&&current.contentSignature===baseline.contentSignature&&identities.every(k=>current[k].length===baseline[k].length&&current[k].every((v,i)=>v===baseline[k][i]))&&same(current.data,baseline.data),'Native owner, geometry, tags or frame changed.','STALE_INPUT');
 }
 try{
  descriptors=schemaStamp(await call('tag.list'));
  token=readToken(await call('fields.read',{owner:ownerHash,field:'name'}),ownerHash);
  baseline=observe();
  const finalToken=readToken(await call('fields.read',{owner:ownerHash,field:'name'}),ownerHash);
  need(same(token,finalToken),'Native authoring changed during capture.','STALE_INPUT');compare(observe());
  const snapshot=freeze({...baseline.data,nativeToken:{...token}}),captureWallMs=performance.now()-start;
  return Object.freeze({snapshot,
   get metrics(){return {captureWallMs,completedChecks:checks,nativeReads:reads,adapterOwnedGPUBytes:0,adapterGeometryReadbackBytes:0,inheritedNativeSettlement:true,wholeCallGPUWorkMeasured:false};},
   async checkObservedInputs(){
    try{cancel();compare(observe());need(same(descriptors,schemaStamp(await call('tag.list'))),'Native physical schema changed.','STALE_INPUT');const current=readToken(await call('fields.read',{owner:ownerHash,field:'name'}),ownerHash);need(same(current,token),'Native authoring epoch/generation changed.','STALE_INPUT');compare(observe());checks++;return {observationMatched:true,currentnessCertified:false};}catch(e){retire();throw e;}
   },dispose:retire
  });
 }catch(e){retire();throw e;}
}
