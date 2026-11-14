// Authoring only. This module neither interprets nor emits machine commands.
export const STORAGE_KEY='frame.cut.settings';
export const BLOCKS=Object.freeze(['Start G-code','Finish G-code','Tool on G-code','Tool off G-code']);
export const DEFAULTS=Object.freeze({Mode:'Cut',Speed:1000,Passes:1,'Line width':.2,'Lead-in':1,...Object.fromEntries(BLOCKS.map(k=>[k,'']))});
export const failure=(code,message)=>Object.assign(new Error(message),{code});
export function validate(params){
  if(!['Cut','Mark'].includes(params.Mode))throw failure('INVALID_ARGUMENT','Invalid Cut mode.');
  if(!Number.isFinite(params.Speed)||params.Speed<.001)throw failure('INVALID_ARGUMENT','Speed must be at least 0.001 mm/min.');
  if(!Number.isSafeInteger(params.Passes)||params.Passes<1)throw failure('INVALID_ARGUMENT','Passes must be a positive safe integer.');
  for(const k of ['Line width','Lead-in'])if(!Number.isFinite(params[k])||params[k]<0)throw failure('INVALID_ARGUMENT',k+' must be nonnegative.');
  for(const k of BLOCKS)if(typeof params[k]!=='string'||params[k].length>16384||!params[k].isWellFormed())throw failure('INVALID_ARGUMENT',k+' must be valid Unicode text of at most 16384 code units.');
  return Object.fromEntries(Object.keys(DEFAULTS).map(k=>[k,params[k]]));
}
export function loadSettings(storage){
  try{const record=JSON.parse(storage.getItem(STORAGE_KEY));if(record?.version===1)return {params:validate({...DEFAULTS,...record.params}),source:'local',storageAvailable:true};}catch{}
  return {params:{...DEFAULTS},source:'factory',storageAvailable:!!storage};
}
// Coalesced native observations, not a parallel scene. New owners alone receive
// defaults; native duplication/HASH overwrite params with their authored values.
export function settingsObserver(context,storage){
  let last=loadSettings(storage),seen=new Map(),references=new Map(),queued=false;
  function observe(exclude=null){
    const owners=context.document.nodes.filter(n=>n.type==='cut'&&n!==exclude),next=new Map(),changed=[];
    const restored=owners.some(n=>references.has(n.nativeHash)&&references.get(n.nativeHash)!==n);
    for(const n of owners){try{const p=validate(n.params),key=JSON.stringify(p);next.set(n.nativeHash,key);if(restored||seen.get(n.nativeHash)!==key)changed.push({n,p});}catch{}}
    seen=next;references=new Map(owners.map(n=>[n.nativeHash,n]));if(!changed.length)return;
    const selected=context.document.selected.filter(n=>n.type==='cut');
    const chosen=(changed.length>1&&selected.length===1?changed.find(x=>x.n===selected[0]):null)||changed.at(-1);
    last={params:chosen.p,source:'native',owner:chosen.n.nativeHash,storageAvailable:!!storage};
    try{storage?.setItem(STORAGE_KEY,JSON.stringify({version:1,params:last.params}));}catch{last.storageAvailable=false;}
  }
  return {observe,schedule(){if(!queued){queued=true;queueMicrotask(()=>{queued=false;observe();});}},created(n){if(n.type==='cut'){observe(n);Object.assign(n.params,last.params);}},status(){return {...last,params:{...last.params}};}};
}

// Four static axis vertices on Frame's shared device and borrowed uniforms.
// Projection is the native plugin camera contract also used by Printer.
const shader=`
struct Camera{rotation:mat4x4f,centerScale:vec4f,viewport:vec4f,clip:vec4f,frame:vec4f,modes:vec4f};
struct Frame{matrix:mat4x4f,inverse:mat4x4f,color:vec4f,settings:vec4f};
@group(0) @binding(0) var<uniform> camera:Camera;
@group(1) @binding(0) var<uniform> frame:Frame;
override orthographic:bool=false;
struct Output{@builtin(position) position:vec4f,@location(0) color:vec3f};
@vertex fn axes(@builtin(vertex_index) vertex:u32)->Output{
 let ends=array<vec3f,2>(vec3f(1000,0,0),vec3f(0,0,1000));
 let colors=array<vec3f,2>(vec3f(.82,.24,.22),vec3f(.28,.44,.85));
 let local=select(vec3f(0),ends[vertex/2u],vertex%2u!=0u);
 let p=(frameCameraRelative(camera.rotation)*vec4f(((frame.matrix*vec4f(local,1)).xyz-camera.centerScale.xyz)*camera.centerScale.w,1)).xyz;
 let xy=p.xy+camera.viewport.zw;let depth=-p.z;var out:Output;out.color=colors[vertex/2u];
 if(orthographic){out.position=vec4f(xy.x*camera.viewport.y/camera.viewport.x,xy.y*camera.viewport.y,(depth-camera.clip.x)/(camera.clip.y-camera.clip.x),1);}
 else{out.position=vec4f(xy.x*camera.clip.w/camera.viewport.x,xy.y*camera.clip.w,(camera.clip.y*depth-camera.clip.x*camera.clip.y)/(camera.clip.y-camera.clip.x),depth);}return out;
}
@fragment fn fs(input:Output)->@location(0) vec4f{return vec4f(input.color,1);}`;
export function createAxes(context){
 let device=null,pipelines=null,pending=null,groups=new WeakMap(),layouts,error=null;
 function prepare(d){
  if(pending)return;device=d;
  error=null;pending=(async()=>{
   const module=d.createShaderModule({label:'Cut local axes',code:context.viewport.cameraWGSL+shader});
   layouts=[0,1].map(()=>d.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:'uniform'}}]}));
   const layout=d.createPipelineLayout({bindGroupLayouts:layouts});
   const built=await Promise.all([false,true].map(orthographic=>d.createRenderPipelineAsync({label:'Cut local axes',layout,vertex:{module,entryPoint:'axes',constants:{orthographic}},fragment:{module,entryPoint:'fs',targets:[{format:navigator.gpu.getPreferredCanvasFormat()}]},primitive:{topology:'line-list'},depthStencil:{format:'depth24plus',depthWriteEnabled:false,depthCompare:'always'}})));
   if(device===d){pipelines=built;context.requestDraw();}
  })().catch(e=>{pipelines=null;error={code:'CUT_VIEWPORT_UNAVAILABLE',message:String(e.message)};}).finally(()=>{pending=null;});
 }
 const group=(buffer,index)=>{let g=groups.get(buffer);if(!g){g=device.createBindGroup({layout:layouts[index],entries:[{binding:0,resource:{buffer}}]});groups.set(buffer,g);}return g;};
 const render=({pass,camera,frame,orthographic,device:d})=>{
  if(device!==d){pipelines=null;groups=new WeakMap();prepare(d);}
  if(!pipelines)return;
  pass.setPipeline(pipelines[orthographic?1:0]);pass.setBindGroup(0,group(camera,0));pass.setBindGroup(1,group(frame,1));pass.draw(4);
 };
 render.status=()=>({ready:!!pipelines,pending:!!pending,error});return render;
}

const empty={type:'object',properties:{},additionalProperties:false};
export async function activate(context){
  if(context.version!==1)throw failure('API_VERSION','Unsupported Frame plugin API.');
  let storage;try{storage=globalThis.localStorage;}catch{}
  const defaults=settingsObserver(context,storage);
  const owner=hash=>{const n=context.document.nodes.find(n=>n.nativeHash===hash&&n.type==='cut');if(!n)throw failure('INVALID_OWNER','Select a Cut object.');return n;};
  const axes=createAxes(context);
  const status=hash=>{const n=owner(hash);defaults.observe();return {stage:'authoring-preview',authoringOnly:true,state:'unavailable',generationAvailable:false,geometryEvaluated:false,resultAvailable:false,job:null,viewport:axes.status(),parameters:{...n.params},defaults:defaults.status(),plane:{axes:['X','Z'],normal:[0,-1,0],origin:[0,0,0],min:[0,0,0],max:[1000,0,1000],units:'mm',dimensions:'native transform scale',gcodeAxes:['local X','local Z']},tags:{cut_avoid:'No head entry, including travel; not evaluated yet',cut_no_cut:'Tool-off region on every pass; not evaluated yet'},reason:'CUT_AUTHORING_ONLY'};};
  const unavailable=hash=>{owner(hash);throw failure('CUT_AUTHORING_ONLY','Cut currently supports native authoring only. Evaluated source extraction, shared Outline integration, routes, jobs, preview and G-code output are not implemented.');};
  context.editor.register({created:n=>defaults.created(n),documentChanged:()=>defaults.schedule(),restored:()=>defaults.schedule(),parameters:(n,changes)=>{if(n.type!=='cut')return null;validate({...n.params,...changes});defaults.schedule();return {};}});
  context.operations.register([
    {id:'status',description:'Inspect authoring and explicit missing generation capabilities, without geometry capture.',inputSchema:empty,readOnly:true,run:status},
    ...['generate','sources','result','save'].map(id=>({id,description:'Unavailable in this authoring milestone; rejects CUT_AUTHORING_ONLY without creating work or output.',inputSchema:empty,readOnly:true,run:unavailable})),
    {id:'cancel',description:'No generation job exists in the authoring milestone.',inputSchema:empty,readOnly:true,run:hash=>{owner(hash);return {cancelled:false,job:null,reason:'CUT_AUTHORING_ONLY'};}}
  ]);
  context.attributes.register(hash=>{owner(hash);return {actions:[{id:'generate',label:'Generate',disabled:true}]};});
  await context.viewport.register({renderKind:'helper',pivot:[0,0,0],bounds:{min:[0,0,0],max:[1000,0,1000]},
    lines:new Float32Array([0,0,0,1000,0,0,1000,0,0,1000,0,1000,1000,0,1000,0,0,1000,0,0,1000,0,0,0]),color:[.65,.58,.46,1],selectedColor:[.85,.74,.53,1],settings:()=>[0,0,0,0],render:axes,
    shader:'fn pluginSurface(local:vec3f,normal:vec3f,build:vec3f,settings:vec4f)->vec4f { discard; return vec4f(0.0); }'});
}
