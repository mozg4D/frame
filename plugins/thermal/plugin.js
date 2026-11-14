// Exact resource-free physical-frame validator reused from the earlier authoring candidate.
// No Probe sampling, field state or numerical execution is installed in this preview.
const frameFailure = (code, message) => Object.assign(new Error(message), {code});
export function copyPhysicalFrame(frame) {
  if(!frame||frame.kind!=='physical-owner'||!Array.isArray(frame.ownerWorld)||frame.ownerWorld.length!==16||Array.from(frame.ownerWorld).some(x=>!Number.isFinite(x)))throw frameFailure('INVALID_ARGUMENT','Invalid physical field frame.');
  const m=frame.ownerWorld;if(m[3]!==0||m[7]!==0||m[11]!==0||m[15]!==1)throw frameFailure('INVALID_ARGUMENT','Physical field frame must be affine.');
  const axes=[0,4,8].map(i=>m.slice(i,i+3)),lengths=axes.map(a=>Math.hypot(...a));
  if(lengths.some(x=>!Number.isFinite(x)||x<=0))throw frameFailure('INVALID_ARGUMENT','Physical field frame must be invertible.');
  const unit=axes.map((a,i)=>a.map(x=>x/lengths[i]));
  for(let a=0;a<3;a++)for(let b=a+1;b<3;b++)if(Math.abs(unit[a].reduce((s,x,k)=>s+x*unit[b][k],0))>1e-10)throw frameFailure('INVALID_ARGUMENT','Sheared physical field frames are unsupported.');
  return Object.freeze({kind:'physical-owner',ownerWorld:Object.freeze([...m])});
}

// Resource-free native authoring inspection. This is not a solver adapter:
// the authoring preview has no numerical execution path.
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const fields=['Thermal','Shutoff pressure','Free flow','Direction'];
function validateFanProfile(params){
 if(!params||typeof params!=='object'||Array.isArray(params)||Object.keys(params).some(k=>!fields.includes(k)))fail('INVALID_ARGUMENT','Unknown Fan parameter.');
 const ref=params.Thermal;
 if(typeof ref!=='string')fail('INVALID_ARGUMENT','Select a Thermal object or leave the Fan unassigned.');
 if(!Number.isFinite(params['Shutoff pressure'])||params['Shutoff pressure']<0)fail('INVALID_ARGUMENT','Pressure must be nonnegative Pa.');
 if(!Number.isFinite(params['Free flow'])||params['Free flow']<=0)fail('INVALID_ARGUMENT','Free flow must be positive m³/s.');
 if(!['Forward','Reverse'].includes(params.Direction))fail('INVALID_ARGUMENT','Fan direction must be Forward or Reverse along its local X.');
}
export function validateFanParameters(document,params){
 validateFanProfile(params);
 if(params.Thermal&&!document.nodes.some(n=>n.type==='thermal'&&n.nativeHash===params.Thermal))fail('INVALID_ARGUMENT','Select a Thermal object or leave the Fan unassigned.');
}
const affine=m=>m?.length===16&&Array.from(m).every(Number.isFinite)&&m[3]===0&&m[7]===0&&m[11]===0&&m[15]===1;
const issue=e=>({code:e.code||'UNSUPPORTED_FAN_FRAME',message:e.message});

// Only frame/curve metadata is admitted here. Containment, sheet alignment,
// occurrence roles, physical properties and GPU acceptance remain separate.
export function nativeFanMetadata(context,fan){
 const D=context.document,params={...fan.params},direction=params.Direction==='Forward'?1:params.Direction==='Reverse'?-1:null;
 const owner=D.nodes.find(n=>n.type==='thermal'&&n.nativeHash===params.Thermal);
 const result={hash:fan.nativeHash,ownerHash:params.Thermal,authored:{enabled:fan.enabled!==false,visible:fan.visible!==false,params},directionLocal:direction===null?null:[direction,0,0],normalizedWorldAxis:null,
  ownerResolution:{status:owner?'resolved':params.Thermal?'missing-owner':'unassigned',enabled:owner?owner.enabled!==false:null},
  profile:{status:'valid'},box:{localSizeMM:[100,100,100]},mapping:{status:'unresolved-owner',solverEligible:false}};
 try{validateFanProfile(params);}catch(e){result.profile={status:'invalid',error:issue(e)};}
 let world;
 try{
  world=Array.from(D.world(fan.nativeHash));
  if(!affine(world))fail('UNSUPPORTED_FAN_FRAME','Fan frame must be finite and affine for inspection.');
  const lengths=[0,4,8].map(i=>Math.hypot(...world.slice(i,i+3)));
  if(lengths.some(x=>!Number.isFinite(x*100)))fail('UNSUPPORTED_FAN_FRAME','World box dimensions exceed the supported numerical range.');
  result.box.worldCenterMM=world.slice(12,15);result.box.worldEdgeLengthsMM=lengths.map(x=>100*x);
  const axis=world.slice(0,3),max=Math.max(...axis.map(Math.abs));
  if(direction!==null&&max>0){const scaled=axis.map(x=>x/max),length=Math.hypot(...scaled);result.normalizedWorldAxis=scaled.map(x=>x===0?0:direction*x/length);}
 }catch(e){result.mapping={status:'unsupported-frame',solverEligible:false,error:issue(e)};return result;}
 if(!owner)return result;
 try{
  const ownerWorld=Array.from(D.world(owner.nativeHash));copyPhysicalFrame({kind:'physical-owner',ownerWorld});
  // Native direct-child local frame avoids inverse roundoff under a common
  // rotated owner. The exact world equality also rejects evaluated constraints.
  // Other parenting remains valid authoring but is not physically admitted.
  if(typeof owner.id!=='string'||fan.parent!==owner.id)fail('UNSUPPORTED_FAN_FRAME','Physical Fan mapping currently requires a direct child of its explicitly referenced Thermal owner.');
  const relative=Array.from(D.local(fan.nativeHash));
  if(!affine(relative)||Array.from(context.math.mul(ownerWorld,relative)).some((x,i)=>x!==world[i]))fail('UNSUPPORTED_FAN_FRAME','Fan evaluated world frame must exactly match its native owner/local composition.');
  const diagonal=[0,5,10];
  if(!affine(relative)||relative.some((x,i)=>![...diagonal,12,13,14,15].includes(i)&&x!==0)||diagonal.some(i=>relative[i]<=0))fail('UNSUPPORTED_FAN_FRAME','Physical Fan mapping requires exact positive owner-relative diagonal scale and translation; native display transforms remain unrestricted.');
  const centerMM=relative.slice(12,15),sizeMM=diagonal.map(i=>relative[i]*100);
  if(sizeMM.some(x=>!Number.isFinite(x)||x<=0))fail('UNSUPPORTED_FAN_FRAME','Fan dimensions exceed the supported numerical range.');
  result.mapping={status:'supported-frame',solverEligible:false,centerMM,sizeMM,direction,units:'owner-local mm',
   unchecked:['fluid-role','box-containment','grid-face-alignment','partial-internal-sheet','ancestor-enabled-state','GPU-acceptance']};
 }catch(e){result.mapping={status:'unsupported-frame',solverEligible:false,error:issue(e)};}
 return result;
}

export function inspectNativeFans(context,hash){
 const started=performance.now(),D=context.document,target=D.nodes.find(n=>n.nativeHash===hash);
 if(!target||!['thermal','thermal_fan'].includes(target.type))fail('INVALID_OWNER','Select a Thermal owner or Fan.');
 const ownerHash=target.type==='thermal'?hash:target.params.Thermal;
 const owner=D.nodes.find(n=>n.type==='thermal'&&n.nativeHash===ownerHash);
 const matching=owner?D.nodes.filter(n=>n.type==='thermal_fan'&&n.params.Thermal===ownerHash):[],enabled=matching.filter(n=>n.enabled!==false);
 const selection={status:!owner?'unresolved-owner':enabled.length===1?'unique':enabled.length?'multiple':'missing',matchingFanCount:matching.length,directEnabledFanCount:enabled.length,
  disabledFanCount:matching.length-enabled.length,scope:'explicit-reference-and-direct-enabled-flag',ancestorEnabledState:'not-qualified',visibilityAffectsSelection:false};
 const fan=target.type==='thermal_fan'?target:enabled.length===1?enabled[0]:null;
 return {stage:'native-fan-authoring',authoringOnly:true,solverCoupled:false,solverEligible:false,ownerHash,selection,fan:fan?nativeFanMetadata(context,fan):null,
  metrics:{wallMs:performance.now()-started},limitations:['Numerical solving is unavailable in this authoring preview.','A supported frame is not proof of a valid fan sheet or physical eligibility.','Hierarchy does not assign ownership; ancestor enabled semantics are not qualified.']};
}

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
