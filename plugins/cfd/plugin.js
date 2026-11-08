// Native CFD authoring only. No flow state, numerical imports or geometry capture.
const failure=(code,message)=>Object.assign(new Error(message),{code});
const emptySchema={type:'object',properties:{},additionalProperties:false};
export const LOCAL_BOX=Object.freeze({min:Object.freeze([-500,0,-500]),max:Object.freeze([500,1000,500]),pivot:Object.freeze([-500,0,-500])});
export function validateParameters(params){
  if(!Number.isFinite(params.Speed)||params.Speed<0)throw failure('INVALID_ARGUMENT','Speed must be a finite nonnegative value in m/s.');
  if(!Number.isFinite(params.Altitude))throw failure('INVALID_ARGUMENT','Altitude must be finite, in metres.');
  if(!['Air','Water'].includes(params.Medium))throw failure('INVALID_ARGUMENT','Medium must be Air or Water.');
  if(!['None','Road'].includes(params.Ground))throw failure('INVALID_ARGUMENT','Ground must be None or Road.');
}
export function helperLines(){
  const corners=[[-500,0,-500],[500,0,-500],[500,0,500],[-500,0,500],[-500,1000,-500],[500,1000,-500],[500,1000,500],[-500,1000,500]],lines=[];
  for(let i=0;i<4;i++)lines.push(...corners[i],...corners[(i+1)%4],...corners[i+4],...corners[(i+1)%4+4],...corners[i],...corners[i+4]);
  // Face-to-face local-X direction marker, never a streamline or a result.
  lines.push(-500,500,0,500,500,0,500,500,0,420,550,0,500,500,0,420,450,0);
  return new Float32Array(lines);
}
export async function activate(context){
  if(context.version!==1)throw failure('API_VERSION','Unsupported Frame plugin API.');
  const find=hash=>{const n=context.document.nodes.find(n=>n.nativeHash===hash&&n.type==='cfd');if(!n)throw failure('INVALID_OWNER','Select an existing CFD object.');return n;};
  const status=hash=>{const n=find(hash);return {stage:'authoring-preview',state:'under-construction',authoringOnly:true,solverAvailable:false,resultsAvailable:false,geometryDiagnosticAvailable:false,registeredTags:[],owner:{hash:n.nativeHash,type:n.type},parameters:{...n.params},localBox:{min:[...LOCAL_BOX.min],max:[...LOCAL_BOX.max],pivot:[...LOCAL_BOX.pivot],unit:'mm'},flow:{directionLocal:[1,0,0],inletLocalX:-500,outletLocalX:500,speedUnit:'m/s',markerOnly:true},geometryParticipation:'planned-automatic-box-intersection',geometryEvaluated:false};};
  const unavailable=()=>{throw failure('CFD_AUTHORING_ONLY','CFD is under construction. Only native authoring is available; no flow, force, pressure or separation is calculated.');};
  context.operations.register([
    {id:'status',description:'Inspect native authoring parameters and explicit under-construction capabilities. No geometry qualification or physical result.',inputSchema:emptySchema,readOnly:true,run:status},
    ...['solve-frame','solve-animation','results'].map(id=>({id,description:'Unavailable in the authoring preview. Always rejects with CFD_AUTHORING_ONLY before numerical work or mutation.',inputSchema:{type:'object',properties:{},additionalProperties:true},readOnly:true,run:unavailable}))
  ]);
  context.editor.register({parameters:(n,changes)=>{if(n.type!=='cfd')return null;validateParameters({...n.params,...changes});return {};}});
  context.attributes.register(hash=>{find(hash);return {actions:[{id:'status',label:'Under construction',disabled:true}]};});
  await context.viewport.register({pivot:[...LOCAL_BOX.pivot],bounds:{min:[...LOCAL_BOX.min],max:[...LOCAL_BOX.max]},lines:helperLines(),color:[.45,.68,.78,.75],selectedColor:[.7,.86,1,.9],settings:()=>[0,0,0,0],shader:'fn pluginSurface(local:vec3f, normal:vec3f, build:vec3f, settings:vec4f)->vec4f { discard; return vec4f(0.0); }'});
}
