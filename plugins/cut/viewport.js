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
