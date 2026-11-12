import {helper,isOptics} from './authoring.js';
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
 await context.viewport.register({bounds:{min:[-50,-50,-50],max:[50,50,50]},pivot:[0,0,0],lines:new Float32Array(),color:[.56,.8,.84,1],selectedColor:[.8,.95,1,1],enabledAffectsVisibility:false,settings:()=>[0,0,0,0],shader:'fn pluginSurface(local:vec3f,normal:vec3f,build:vec3f,settings:vec4f)->vec4f{discard;return vec4f(0.0);}',
  render:({pass,camera,frame,orthographic,hash,device,format})=>{let n;try{n=find(hash);}catch{return;}const s=build(device,format);if(!s.ready)return;const row=s.geometry.get(n.type==='optics'?'optics':'plane');let group=s.groups.get(frame);if(!group||group.camera!==camera){group={camera,value:device.createBindGroup({layout:s.layout,entries:[{binding:0,resource:{buffer:camera}},{binding:1,resource:{buffer:frame}}]})};s.groups.set(frame,group);}pass.setPipeline(s.pipelines[orthographic?1:0]);pass.setBindGroup(0,group.value);pass.setVertexBuffer(0,row.buffer);pass.draw(row.count);},
  retire:()=>{if(!context.document.nodes.some(isOptics))release();}
 });
}
