// Resource-free native authoring inspection. This is not a solver adapter:
// the authoring preview has no numerical execution path.
import {copyPhysicalFrame} from './native-frame.js';
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const fields=['Thermal','Shutoff pressure','Free flow','Direction'];
function validateFanProfile(params){
 if(!params||typeof params!=='object'||Array.isArray(params)||Object.keys(params).some(k=>!fields.includes(k)))fail('INVALID_ARGUMENT','Unknown Fan parameter.');
 const ref=params.Thermal;
 if(typeof ref!=='string')fail('INVALID_ARGUMENT','Select a Thermal object or leave the Fan unassigned.');
 if(!Number.isFinite(params['Shutoff pressure'])||params['Shutoff pressure']<0)fail('INVALID_ARGUMENT','Shutoff pressure must be nonnegative Pa.');
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
