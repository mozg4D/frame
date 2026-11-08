import {validateFanParameters,inspectNativeFans} from './native-fan.js';

// Authoring preview only. No numerical runtime, job map, fields or solver imports.
const error=(code,message)=>Object.assign(new Error(message),{code});
const emptySchema={type:'object',properties:{},additionalProperties:false};
const unsupported=()=>{throw error('THERMAL_AUTHORING_ONLY','Thermal is under construction. This preview supports native authoring only; solving and temperature measurement are unavailable.');};

export async function activate(context){
  if(context.version!==1)throw error('API_VERSION','Unsupported Frame plugin API.');
  const D=context.document;
  const find=hash=>{const n=D.nodes.find(n=>n.nativeHash===hash);if(!n||!['thermal','thermal_probe','thermal_fan'].includes(n.type))throw error('INVALID_OWNER','Thermal authoring object no longer exists.');return n;};
  const owner=hash=>{const n=find(hash);if(n.type!=='thermal')throw error('INVALID_OWNER','Select a Thermal object.');return n;};
  const status=hash=>{const n=find(hash);return {stage:'authoring-preview',state:'under-construction',type:n.type,authoringOnly:true,sceneSolver:false,generalSceneSolver:false,solverCoupled:false,numericalAvailable:false,measurementAvailable:false};};
  const create=type=>async hash=>{
    owner(hash);let n;
    D.transaction(()=>{n=D.create(type,hash,type==='thermal_fan'?'Fan':'Probe');n.params.Thermal=hash;D.select(n.nativeHash,'objects');});
    await context.editor.selectOwner(n.nativeHash);
    return {hash:n.nativeHash,type:n.type,authoringOnly:true};
  };
  context.operations.register([
    {id:'create-fan',description:'Create a separate 30 by 30 by 10 mm native Fan helper. Its internal Thermal ownership is preserved; new Fans point along local +X. Authoring only, without a solver.',inputSchema:emptySchema,readOnly:false,run:create('thermal_fan')},
    {id:'create-probe',description:'Create a 2 mm native Probe helper at the owner origin with an explicit Thermal reference. Authoring only; no temperature is measured.',inputSchema:emptySchema,readOnly:false,run:create('thermal_probe')},
    {id:'fan-inputs',description:'Inspect detached native Fan parameters, local-X direction and frame metadata. Never certifies containment, grid alignment or numerical eligibility.',inputSchema:emptySchema,readOnly:true,run:hash=>inspectNativeFans(context,hash)},
    {id:'status',description:'Read the explicit under-construction authoring-only status. No numerical result exists in this preview.',inputSchema:emptySchema,readOnly:true,run:status},
    // Explicit rejection endpoints prevent earlier numerical API callers from
    // treating saved authoring as a qualified calculation. They do no work.
    ...['solve-grid','solve-scene','measure','inspect','inspect-velocity'].map(id=>({id,description:'Unavailable in the authoring preview. Always rejects with THERMAL_AUTHORING_ONLY before any mutation or numerical work.',inputSchema:{type:'object',properties:{},additionalProperties:true},readOnly:true,run:unsupported}))
  ]);
  context.editor.register({
    created:n=>{
      if(n.type==='thermal_probe'){const frame=context.math.I();frame[0]=frame[5]=frame[10]=.02;n.creationFrame=Array.from(context.math.pack(frame));}
      if(n.type==='thermal_fan'){const frame=context.math.I();frame[0]=frame[5]=.3;frame[10]=.1;frame.set([-25,-12.5,-12.5],12);n.creationFrame=Array.from(context.math.pack(frame));}
    },
    parameters:(n,changes)=>{
      if(n.type==='thermal_fan'){validateFanParameters(D,{...n.params,...changes});return {};}
      if(n.type==='thermal_probe'){const value=changes.Thermal??n.params.Thermal;if(typeof value!=='string'||value&&!D.nodes.some(q=>q.nativeHash===value&&q.type==='thermal'))throw error('INVALID_ARGUMENT','Select a Thermal object.');return {};}
      if(n.type!=='thermal')return null;
      for(const value of Object.values({...n.params,...changes}))if(!Number.isFinite(value)||value < -273.15)throw error('INVALID_ARGUMENT','Temperature must be at least absolute zero.');
      return {};
    }
  });
  context.attributes.register(hash=>{
    const n=find(hash),notice={id:'status',label:'Under construction',disabled:true};
    if(n.type==='thermal_probe')return {hiddenFields:['Thermal'],actions:[notice]};
    if(n.type==='thermal_fan')return {hiddenFields:['Thermal','Direction'],labels:{'Shutoff pressure':'Pressure'},units:{'Shutoff pressure':'Pa','Free flow':'m³/s'},ranges:{'Shutoff pressure':{min:0},'Free flow':{min:Number.MIN_VALUE}},actions:[notice]};
    return {units:{Ambient:'°C',Initial:'°C'},actions:[notice,{id:'create-fan',label:'Fan'},{id:'create-probe',label:'Probe'}]};
  });
  // Reuse the original native shared 100 mm line primitive. Probe/Fan sizes
  // are ordinary one-shot native frames, not special rendering or scene data.
  const lines=[];for(let axis=0;axis<3;axis++)for(let a=0;a<2;a++)for(let b=0;b<2;b++){const p=[-50,-50,-50],q=[-50,-50,-50];p[(axis+1)%3]=q[(axis+1)%3]=a?50:-50;p[(axis+2)%3]=q[(axis+2)%3]=b?50:-50;q[axis]=50;lines.push(...p,...q);}
  await context.viewport.register({bounds:{min:[-50,-50,-50],max:[50,50,50]},lines:new Float32Array(lines),color:[.86,.61,.46,1],selectedColor:[1,.75,.5,1],settings:()=>[0,0,0,0],shader:'fn pluginSurface(local:vec3f, normal:vec3f, build:vec3f, settings:vec4f)->vec4f { discard; return vec4f(0.0); }'});
}
