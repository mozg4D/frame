/** Leased reflected attachments and one exact row-inverting presentation pass.
 * rawDevice is the existing owner's GPUDevice, never a newly requested device.
 * Caller releases after submission completion, or with submitted:false if discarded.
 */
import {assertRenderDomain} from './render-domain.mjs';
export const PRESENTATION_WGSL=/*wgsl*/`
@group(0) @binding(0) var renderedColor:texture_2d<f32>;
@vertex fn presentVertex(@builtin(vertex_index) id:u32)->@builtin(position) vec4f {
 let uv=vec2f(f32((id<<1u)&2u),f32(id&2u));return vec4f(uv*2.0-1.0,0.0,1.0);
}
@fragment fn presentPixel(@builtin(position) position:vec4f)->@location(0) vec4f {
 let pixel=vec2i(position.xy);let size=vec2i(textureDimensions(renderedColor));
 return textureLoad(renderedColor,vec2i(pixel.x,size.y-1-pixel.y),0);
}
`;
export class FrameGpuPresentation {
 static async create(rawDevice,options={}){
  const p=new FrameGpuPresentation(rawDevice,options);try{await p.init();return p;}catch(error){p.dispose();throw error;}
 }
 constructor(rawDevice,{format='bgra8unorm',sampleCount=1,renderDomain='gl-window'}={}){
  if(!rawDevice?.queue||typeof rawDevice.createTexture!=='function')throw Error('Existing raw GPUDevice required for presentation');
  if(assertRenderDomain(renderDomain)!=='gl-window')throw Error('Presentation attachments require explicit gl-window domain');
  if(!['bgra8unorm','rgba8unorm'].includes(format)||![1,4].includes(sampleCount))throw Error('Presentation requires linear UNORM format and sampleCount 1 or 4');
  this.device=rawDevice;this.format=format;this.sampleCount=sampleCount;Object.defineProperty(this,'renderDomain',{value:renderDomain,enumerable:true});
  this.state='initializing';this.current=null;this.targets=new Set();this.leases=new Set();this.releases=new Set();this.serial=0;
  rawDevice.lost.then(()=>{if(this.state==='disposed')return;this.state='lost';this._retireAll();});
 }
 async init(){
  const d=this.device;d.pushErrorScope('validation');let failure;
  try{
   this.module=d.createShaderModule({label:'Frame exact canonical presentation',code:PRESENTATION_WGSL});
   const info=await this.module.getCompilationInfo(),errors=info.messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(m=>m.message).join('\n'));
   this.layout=d.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'unfilterable-float',viewDimension:'2d'}}]});
   this.pipeline=await d.createRenderPipelineAsync({label:'Frame row-inverting presentation',layout:d.createPipelineLayout({bindGroupLayouts:[this.layout]}),vertex:{module:this.module,entryPoint:'presentVertex'},fragment:{module:this.module,entryPoint:'presentPixel',targets:[{format:this.format}]},primitive:{topology:'triangle-list'},multisample:{count:1}});
  }catch(error){failure=error;}
  const scope=await d.popErrorScope();if(failure)throw failure;if(scope)throw Error(scope.message);if(this.state!=='initializing')throw Error('Presentation device unavailable during initialization');this.state='ready';
 }
 _ready(){if(this.state!=='ready')throw Error('Presentation is '+this.state);}
 _destroy(target){if(target.freed||target.refs)return;target.freed=true;target.color?.destroy();target.depth?.destroy();target.msaa?.destroy();this.targets.delete(target);}
 _retire(target){if(!target)return;target.retired=true;this._destroy(target);}
 _retireAll(){this._retire(this.current);this.current=null;for(const target of this.targets)this._retire(target);}
 acquire(width,height){
  this._ready();const limit=this.device.limits.maxTextureDimension2D;
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||height>=2**24||Math.max(width,height)>limit)throw Error('Presentation dimensions exceed device limits');
  let target=this.current;
  if(!target||target.width!==width||target.height!==height){
   const d=this.device;target={width,height,refs:0,retired:false,freed:false};
   try{
    target.color=d.createTexture({label:'Frame reflected resolved color',size:[width,height],format:this.format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC});
    target.depth=d.createTexture({label:'Frame reflected display depth',size:[width,height],sampleCount:this.sampleCount,format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT});
    if(this.sampleCount===4)target.msaa=d.createTexture({label:'Frame reflected MSAA color',size:[width,height],sampleCount:4,format:this.format,usage:GPUTextureUsage.RENDER_ATTACHMENT});
    target.bind=d.createBindGroup({layout:this.layout,entries:[{binding:0,resource:target.color.createView()}]});
   }catch(error){target.retired=true;this._destroy(target);throw error;}
   this._retire(this.current);this.current=target;this.targets.add(target);
  }
  target.refs++;
  const lease={owner:this,id:++this.serial,target,width,height,color:target.color,depth:target.depth,msaa:target.msaa,renderDomain:this.renderDomain,released:false,closing:false};this.leases.add(lease);return lease;
 }
 encode(encoder,lease,destination){
  this._ready();if(lease?.owner!==this||!this.leases.has(lease)||lease.closing||lease.released||lease.target.freed)throw Error('Current presentation target lease required');
  if(!destination||destination===lease.color||destination.width!==lease.width||destination.height!==lease.height||destination.format!==this.format||(destination.sampleCount??1)!==1)throw Error('Separate matching canonical presentation destination required');
  const pass=encoder.beginRenderPass({label:'Frame canonical row presentation',colorAttachments:[{view:destination.createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});
  pass.setViewport(0,0,lease.width,lease.height,0,1);pass.setScissorRect(0,0,lease.width,lease.height);pass.setPipeline(this.pipeline);pass.setBindGroup(0,lease.target.bind);pass.draw(3);pass.end();
 }
 release(lease,{submitted=true}={}){
  if(lease?.owner!==this||lease.released||lease.closing)return lease?.releaseDone;
  lease.closing=true;
  const finish=()=>{lease.released=true;lease.target.refs--;this.leases.delete(lease);if(lease.target.retired)this._destroy(lease.target);};
  if(!submitted){finish();return;}
  // Defend callers that release immediately after submit; never destroy live work.
  const done=Promise.resolve().then(()=>this.device.queue.onSubmittedWorkDone()).catch(()=>{}).then(finish);lease.releaseDone=done;this.releases.add(done);done.finally(()=>this.releases.delete(done));return done;
 }
 dispose(){if(this.state!=='disposed'){this.state='disposed';this._retireAll();}return Promise.all([...this.releases]);}
 stats(){return {domain:this.renderDomain,targets:this.targets.size,leases:this.leases.size,retiredTargets:[...this.targets].filter(t=>t.retired).length,colorBytes:[...this.targets].reduce((sum,t)=>sum+t.width*t.height*4,0)};}
}
