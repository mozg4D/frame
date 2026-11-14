// Compact authoring validation only. References are native hashes, never names.
export const roles=Object.freeze(['subject','sensor','source','target']);
export const fail=(code,message)=>Object.assign(new Error(message),{code});
export const roleOf=n=>roles.find(role=>n?.type==='optics_'+role)||null;
export const isOptics=n=>n?.type==='optics'||!!roleOf(n);
export function validateRelations(nodes,n,params){
  if(!isOptics(n))return null;
  const find=h=>nodes.find(q=>q.nativeHash===h);
  if(n.type==='optics')return {};
  if(typeof params.Optics!=='string'||params.Optics&&find(params.Optics)?.type!=='optics')throw fail('INVALID_ARGUMENT','Optics must reference an existing native Design Space.');
  const key=n.type==='optics_subject'?'Sensor':n.type==='optics_source'?'Target':null;
  if(key){const h=params[key],target=find(h);if(typeof h!=='string'||h&&(!params.Optics||target?.type!=='optics_'+key.toLowerCase()||target.params.Optics!==params.Optics))throw fail('INVALID_ARGUMENT',key+' must belong to the same Optics task.');}
  if(n.type==='optics_subject'&&params.Distance==='Finite'&&params['Depth min']>params['Depth max'])throw fail('INVALID_ARGUMENT','Depth min must not exceed Depth max.');
  // Owner reassignment cannot silently leave inbound relationships crossing tasks.
  if(params.Optics!==n.params.Optics&&nodes.some(q=>['optics_source','optics_subject'].includes(q.type)&&(q.params.Target===n.nativeHash||q.params.Sensor===n.nativeHash)&&q.params.Optics!==params.Optics))throw fail('OPTICS_LINKED_PLANE','Clear incoming links before moving this plane to another task.');
  return {};
}
export function helper(type){
  const out=[],line=(a,b)=>out.push(...a,...b);
  if(type==='optics'){
    for(let axis=0;axis<3;axis++)for(let a=0;a<2;a++)for(let b=0;b<2;b++){const p=[-50,-50,-50],q=[-50,-50,-50];p[(axis+1)%3]=q[(axis+1)%3]=a?50:-50;p[(axis+2)%3]=q[(axis+2)%3]=b?50:-50;q[axis]=50;line(p,q);}
  }else{
    const p=[[-50,-50,0],[50,-50,0],[50,50,0],[-50,50,0]];for(let i=0;i<4;i++)line(p[i],p[(i+1)%4]);
    // Local +Z marker defines the directed plane frame, not a simulated ray.
    line([0,0,0],[0,0,10]);line([0,0,10],[2,0,7]);line([0,0,10],[-2,0,7]);
  }
  return new Float32Array(out);
}
export const bounds=type=>type==='optics'?{min:[-50,-50,-50],max:[50,50,50]}:{min:[-50,-50,0],max:[50,50,10]};

// Shared Frame device/pass/uniforms. Two tiny reusable line buffers only.
// Browser selection and native bounds work; projected edge hit paths await a
// generic per-owner line descriptor instead of a parallel plugin picker.
const shader=`
struct Camera{rotation:mat4x4f,centerScale:vec4f,viewport:vec4f,clip:vec4f,frame:vec4f,modes:vec4f};
struct ObjectFrame{matrix:mat4x4f,inverse:mat4x4f,color:vec4f,settings:vec4f};
@group(0) @binding(0) var<uniform> camera:Camera;
@group(0) @binding(1) var<uniform> object:ObjectFrame;
override orthographic:bool=false;
@vertex fn vs(@location(0) point:vec3f)->@builtin(position) vec4f{
 let world=(object.matrix*vec4f(point,1)).xyz;
 let p=frameCameraRelative(camera.rotation)*vec4f((world-camera.centerScale.xyz)*camera.centerScale.w,1);
 let xy=p.xy+camera.viewport.zw;let depth=-p.z;
 if(orthographic){return vec4f(xy.x*camera.viewport.y/camera.viewport.x,xy.y*camera.viewport.y,(depth-camera.clip.x)/(camera.clip.y-camera.clip.x),1);}
 return vec4f(xy.x*camera.clip.w/camera.viewport.x,xy.y*camera.clip.w,(camera.clip.y*depth-camera.clip.x*camera.clip.y)/(camera.clip.y-camera.clip.x),depth);
}
@fragment fn fs()->@location(0) vec4f{return object.color;}`;
export async function installHelpers(context,{find}){
 let state=null;
 const release=()=>{if(!state)return;state.retired=true;for(const row of state.geometry.values())row.buffer.destroy();state=null;};
 const build=(device,format)=>{
  if(state?.device===device&&state.format===format)return state;
  release();const s=state={device,format,geometry:new Map(),groups:new WeakMap(),pipelines:[],ready:false,retired:false};
  const stage=GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT;
  s.layout=device.createBindGroupLayout({entries:[{binding:0,visibility:stage,buffer:{type:'uniform'}},{binding:1,visibility:stage,buffer:{type:'uniform'}}]});
  const module=device.createShaderModule({label:'Optics authoring helpers',code:context.viewport.cameraWGSL+shader}),layout=device.createPipelineLayout({bindGroupLayouts:[s.layout]});
  for(const type of ['optics','plane']){const points=helper(type),buffer=device.createBuffer({label:'Optics '+type+' helper',size:points.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(buffer,0,points);s.geometry.set(type,{buffer,count:points.length/3});}
  s.pending=(async()=>{const info=await module.getCompilationInfo();if(info.messages.some(m=>m.type==='error'))throw Error(info.messages.filter(m=>m.type==='error').map(m=>m.message).join('; '));await Promise.all([false,true].map(async(orthographic,i)=>{s.pipelines[i]=await device.createRenderPipelineAsync({label:'Optics authoring lines',layout,vertex:{module,entryPoint:'vs',constants:{orthographic},buffers:[{arrayStride:12,attributes:[{shaderLocation:0,offset:0,format:'float32x3'}]}]},fragment:{module,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]},primitive:{topology:'line-list'},depthStencil:{format:'depth24plus',depthWriteEnabled:false,depthCompare:'less-equal'}});}));if(!s.retired){s.ready=true;context.requestDraw();}})().catch(e=>console.error('Optics helper rendering unavailable:',e));
  device.lost.then(()=>{if(state===s)release();});return s;
 };
 await context.viewport.register({renderKind:'helper',bounds:{min:[-50,-50,-50],max:[50,50,50]},pivot:[0,0,0],lines:new Float32Array(),color:[.56,.8,.84,1],selectedColor:[.8,.95,1,1],enabledAffectsVisibility:false,settings:()=>[0,0,0,0],shader:'fn pluginSurface(local:vec3f,normal:vec3f,build:vec3f,settings:vec4f)->vec4f{discard;return vec4f(0.0);}',
  render:({pass,camera,frame,orthographic,hash,device,format})=>{let n;try{n=find(hash);}catch{return;}const s=build(device,format);if(!s.ready)return;const row=s.geometry.get(n.type==='optics'?'optics':'plane');let group=s.groups.get(frame);if(!group||group.camera!==camera){group={camera,value:device.createBindGroup({layout:s.layout,entries:[{binding:0,resource:{buffer:camera}},{binding:1,resource:{buffer:frame}}]})};s.groups.set(frame,group);}pass.setPipeline(s.pipelines[orthographic?1:0]);pass.setBindGroup(0,group.value);pass.setVertexBuffer(0,row.buffer);pass.draw(row.count);},
  retire:()=>{if(!context.document.nodes.some(isOptics))release();}
 });
}

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
