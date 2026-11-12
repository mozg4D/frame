import {LIMITS,models,modelOf,tree} from './data.js';

// Uses Frame's documented render callback and borrowed camera/object uniforms.
// It creates no device, scene, animation loop, mesh mirror or numerical state.
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

export async function installSymbols(context,{find,members,read,symbol,bounds}){
 const D=context.document,M=context.math,geometry=new Map(Object.keys(models).map(kind=>[kind,symbol(kind)]));let state=null;
 const release=()=>{if(!state)return;state.retired=true;for(const r of state.geometry.values())r.buffer.destroy();for(const r of state.nets.values())r.buffer?.destroy();state=null;};
 const build=(device,format)=>{
  if(state?.device===device&&state.format===format)return state;
  release();const s=state={device,format,geometry:new Map(),nets:new Map(),groups:new WeakMap(),pipelines:[],ready:false,retired:false,error:null};
  const stage=GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT;
  s.layout=device.createBindGroupLayout({entries:[{binding:0,visibility:stage,buffer:{type:'uniform'}},{binding:1,visibility:stage,buffer:{type:'uniform'}}]});
  const module=device.createShaderModule({label:'Circuit authoring line symbols',code:context.viewport.cameraWGSL+shader}),layout=device.createPipelineLayout({bindGroupLayouts:[s.layout]});
  for(const [kind,vertices]of geometry){const buffer=device.createBuffer({label:'Circuit '+kind+' shared symbol',size:vertices.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(buffer,0,vertices);s.geometry.set(kind,{buffer,count:vertices.length/3});}
  s.pending=(async()=>{const info=await module.getCompilationInfo();if(info.messages.some(m=>m.type==='error'))throw Error(info.messages.filter(m=>m.type==='error').map(m=>m.message).join('; '));await Promise.all([false,true].map(async(orthographic,i)=>{s.pipelines[i]=await device.createRenderPipelineAsync({label:'Circuit symbol lines',layout,vertex:{module,entryPoint:'vs',constants:{orthographic},buffers:[{arrayStride:12,attributes:[{shaderLocation:0,offset:0,format:'float32x3'}]}]},fragment:{module,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]},primitive:{topology:'line-list'},depthStencil:{format:'depth24plus',depthWriteEnabled:false,depthCompare:'less-equal'}});}));if(!s.retired){s.ready=true;context.requestDraw();}})().catch(e=>{s.error=e;console.error('Circuit symbol rendering unavailable:',e);});
  device.lost.then(()=>{if(state===s)release();});return s;
 };
 const shown=n=>{for(let p=n;p;p=D.nodes.find(q=>q.id===p.parent))if(!p.visible)return false;return true;};
 const netGeometry=n=>{
  const data=read(n),children=members(n),inverse=M.inv(D.world(n.nativeHash)),points=new Map(data.nets.map(net=>[net.id,[]]));
  if(children.length>LIMITS.components)return null;
  const stamp=JSON.stringify([data,Array.from(inverse),children.map(c=>[c.nativeHash,shown(c),D.world(c.nativeHash),D.records(c.nativeHash)])]);
  let row=state.nets.get(n.nativeHash);if(row?.stamp===stamp)return row;
  row?.buffer?.destroy();row={stamp,count:0,buffer:null};state.nets.set(n.nativeHash,row);
  for(const c of children){if(!shown(c))continue;const matrix=M.mul(inverse,D.world(c.nativeHash));for(const pin of read(c).pins)if(points.has(pin.net))points.get(pin.net).push(M.point(matrix,pin.position));}
  const vertices=new Float32Array([...points.values()].flatMap(tree));if(vertices.length){row.buffer=state.device.createBuffer({label:'Circuit network authoring lines',size:vertices.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});state.device.queue.writeBuffer(row.buffer,0,vertices);row.count=vertices.length/3;}return row;
 };
 const render=({pass,camera,frame,orthographic,hash,device,format})=>{
  let n;try{n=find(hash);}catch{return;}const s=build(device,format);if(!s.ready)return;
  let row;try{row=n.type==='circuit'?(n.params.Nets?netGeometry(n):null):s.geometry.get(modelOf(n));}catch{return;}
  if(!row?.count)return;
  let group=s.groups.get(frame);if(!group||group.camera!==camera){group={camera,value:device.createBindGroup({layout:s.layout,entries:[{binding:0,resource:{buffer:camera}},{binding:1,resource:{buffer:frame}}]})};s.groups.set(frame,group);}
  pass.setPipeline(s.pipelines[orthographic?1:0]);pass.setBindGroup(0,group.value);pass.setVertexBuffer(0,row.buffer);pass.draw(row.count);
 };
 await context.viewport.register({bounds:bounds('circuit'),pivot:[0,0,0],lines:new Float32Array(),color:[.72,.82,.74,1],selectedColor:[.95,.85,.6,1],settings:()=>[0,0,0,0],shader:'fn pluginSurface(local:vec3f,normal:vec3f,build:vec3f,settings:vec4f)->vec4f{discard;return vec4f(0.0);}',render,retire:hash=>{state?.nets.get(hash)?.buffer?.destroy();state?.nets.delete(hash);if(!D.nodes.some(n=>n.type==='circuit'||models[modelOf(n)]))release();}});
}
