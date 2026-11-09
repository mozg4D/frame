import {roles,roleOf,isOptics,fail,validateRelations,bounds} from './authoring.js';
import {installHelpers} from './viewport.js';
const empty={type:'object',properties:{},additionalProperties:false};
const unavailable=()=>{throw fail('OPTICS_AUTHORING_ONLY','Optics is unfinished. Scene tracing, optimization, measured images/power and result publication are unavailable.');};
export async function activate(context){
 if(context.version!==1)throw fail('API_VERSION','Unsupported Frame plugin API.');
 const D=context.document,M=context.math;
 const find=hash=>{const n=D.nodes.find(q=>q.nativeHash===hash);if(!isOptics(n))throw fail('INVALID_OWNER','Select an Optics authoring object.');return n;};
 const owner=hash=>{const n=find(hash);if(n.type!=='optics')throw fail('INVALID_OWNER','Select an Optics Design Space.');return n;};
 const inspect=hash=>{
  const n=find(hash),issues=[];
  if(n.type!=='optics'){try{validateRelations(D.nodes,n,n.params);}catch(e){issues.push({code:e.code,message:e.message});}if(!n.params.Optics)issues.push({code:'OWNER_UNASSIGNED',message:'Assign this plane to an Optics task.'});}
  const members=n.type==='optics'?D.nodes.filter(q=>roleOf(q)&&q.params.Optics===hash).map(q=>({hash:q.nativeHash,role:roleOf(q),enabled:q.enabled!==false})):undefined;
  return {hash,type:n.type,state:'unfinished',stage:'native-authoring-foundation',authoringOnly:true,sceneSolverAvailable:false,optimizerAvailable:false,materialPhysicsAvailable:false,resultAvailable:false,viewportEdgePickingAvailable:false,parameters:{...n.params},...(members?{planes:members}:{}),issues,planeConvention:n.type==='optics'?null:{axes:'local X/Y',normal:'+Z',forwardSide:'+Z',size:'native transform in mm',textureU:'+X',textureV:'+Y'},measuredPower:null,calculatedImage:null};
 };
 const createPlane=async(hash,{role})=>{
  owner(hash);if(!roles.includes(role))throw fail('INVALID_ARGUMENT','Choose Subject, Sensor, Source or Target.');let n;
  D.transaction(()=>{n=D.create('optics_'+role,hash,role[0].toUpperCase()+role.slice(1));n.params.Optics=hash;const frame=M.I();frame[12]=0;frame[14]=['subject','source'].includes(role)?-75:75;n.creationFrame=Array.from(M.pack(frame));D.select(n.nativeHash,'objects');});
  await context.editor.selectOwner(n.nativeHash);return inspect(n.nativeHash);
 };
 context.operations.register([
  {id:'status',description:'Inspect unfinished availability and native authoring references; no calculation or fabricated zero-valued result.',inputSchema:empty,readOnly:true,run:inspect},
  {id:'inspect',description:'Read compact authoring parameters, task membership and invalid-link diagnostics. Does not capture geometry or validate physical feasibility.',inputSchema:empty,readOnly:true,run:inspect},
  {id:'add-plane',description:'Create an ordinary native Subject, Sensor, Source or Target with an explicit task reference, in one Undo transaction.',inputSchema:{type:'object',properties:{role:{type:'string',enum:roles}},required:['role'],additionalProperties:false},readOnly:false,run:createPlane},
  ...roles.map(role=>({id:'create-'+role,description:'Create a native '+role+' authoring plane. No physical calculation is started.',inputSchema:empty,readOnly:false,run:hash=>createPlane(hash,{role})})),
  ...['solve','optimize','stop','create-result','to-mesh','results'].map(id=>({id,description:'Unavailable in this unfinished foundation. Rejects without mutation, geometry capture or numerical work.',inputSchema:empty,readOnly:true,run:unavailable}))
 ]);
 context.editor.register({
  parameters:(n,changes)=>validateRelations(D.nodes,n,{...n.params,...changes}),
  bounds:hash=>{const n=D.nodes.find(q=>q.nativeHash===hash);return isOptics(n)?bounds(n.type):null;}
 });
 context.attributes.register(hash=>{
  const n=find(hash),notice={id:'status',label:'Unfinished',disabled:true};
  if(n.type==='optics')return {actions:[notice],groups:[{label:'Add plane',actions:roles.map(role=>({id:'create-'+role,label:role[0].toUpperCase()+role.slice(1)}))}]};
  return {actions:[notice],hiddenFields:[...(n.type==='optics_subject'?(n.params.Distance==='Infinity'?['Depth min','Depth max']:['Horizontal field','Vertical field']):[]),...(n.type==='optics_target'&&n.params.Goal==='Relative'?['Irradiance']:[])]};
 });
 await installHelpers(context,{find});
}
