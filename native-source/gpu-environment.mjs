/** Native equirectangular HDR -> current bundled Three r186 GGX/cubeUV PMREM.
 * Standalone same-device service; no Scene352 changes or renderer activation.
 * Input is decoded Float32 linear-sRGB RGB(A), never a WebGL render target.
 */
import {GpuBufferPool} from './gpu-resources.mjs';
const abort=m=>new DOMException(m,'AbortError');
export function environmentLayout(width,{cubeSize=null}={}){
 const size=2**Math.floor(Math.log2(cubeSize??width/4)),lodMax=Math.log2(size);
 if(!Number.isSafeInteger(size)||size<16)throw Error('PMREM requires cube size >=16 (equirectangular width >=64)');
 const atlasWidth=3*Math.max(size,112),atlasHeight=4*size,total=lodMax-4+7;
 const levels=Array.from({length:total},(_,i)=>{const faceSize=2**Math.max(4,lodMax-i),x=3*faceSize*Math.max(0,i-lodMax+4),y=4*(size-faceSize),targetRoughness=i/(total-1),sourceRoughness=Math.max(0,i-1)/(total-1);return {index:i,mip:lodMax-i,faceSize,x,y,top:atlasHeight-y-2*faceSize,adjustedRoughness:i?Math.sqrt(targetRoughness**2-sourceRoughness**2)*targetRoughness*1.25:0};});
 return {size,lodMax,atlasWidth,atlasHeight,levels};
}
export function roughnessToMip(r){
 if(!Number.isFinite(r)||r<0||r>1)throw Error('Roughness must be in [0,1]');
 if(r>=.8)return (1-r)/.2-2;if(r>=.4)return (.8-r)*3/.4-1;if(r>=.305)return (.4-r)/.095+2;if(r>=.21)return (.305-r)/.095+3;return r===0?Infinity:-2*Math.log2(1.16*r);
}
export function environmentSourceStamp(source){
 const image=source?.image??source;return [source,image,image?.data,image?.width,image?.height,source?.version,source?.source?.version,source?.colorSpace,source?.flipY,source?.wrapS,source?.wrapT,source?.minFilter,source?.magFilter];
}
const current=(source,stamp)=>environmentSourceStamp(source).every((x,i)=>Object.is(x,stamp[i]));
export function captureLinearHDR(source){
 if(source?.isWebGLRenderTarget||source?.isRenderTargetTexture||source?.texture?.isRenderTargetTexture)throw Error('Decoded original HDR required; render targets are unsupported');
 const image=source?.image??source,{data,width,height}=image??{};
 if(!(data instanceof Float32Array)||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<64||height<32||width!==height*2)throw Error('Float32 RGB(A) 2:1 equirectangular HDR >=64x32 required');
 if(source.colorSpace!=='srgb-linear')throw Error('Decoded HDR must explicitly use linear-sRGB colorSpace srgb-linear');
 if((source.wrapS??1001)!==1001||(source.wrapT??1001)!==1001)throw Error('Non-clamp HDR wrapping requires an explicit environment adapter');
 const minFilter=source.minFilter??1006,magFilter=source.magFilter??1006;
 if(![1003,1006].includes(minFilter)||minFilter!==magFilter)throw Error('Matching nearest or linear HDR filters required; other sampler filtering needs an adapter');
 const channels=data.length/(width*height);if(channels!==3&&channels!==4)throw Error('HDR channel layout must be RGB or RGBA');
 const pixels=new Float32Array(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const from=((source.flipY?height-1-y:y)*width+x)*channels,to=(y*width+x)*4;
  for(let c=0;c<3;c++){const v=data[from+c];if(!Number.isFinite(v)||Math.abs(v)>65504)throw Error('HDR RGB must be finite within half-float PMREM range');pixels[to+c]=v;}pixels[to+3]=1;
 }
 return {width,height,pixels,nearest:minFilter===1003,stamp:environmentSourceStamp(source)};
}
/** Lookup rotation matches Three's transpose(makeRotationFromEuler(scene rotation)). */
export function environmentRotation(e={x:0,y:0,z:0,order:'XYZ'}){
 const order=e.order??'XYZ';if(!['XYZ','YXZ','ZXY','ZYX','YZX','XZY'].includes(order)||![e.x,e.y,e.z].every(Number.isFinite))throw Error('Finite supported Euler required');
 const multiply=(a,b)=>Array.from({length:9},(_,i)=>{const row=i%3,col=Math.floor(i/3);return a[row]*b[col*3]+a[row+3]*b[col*3+1]+a[row+6]*b[col*3+2];});
 let m=[1,0,0,0,1,0,0,0,1];for(const axis of order){const angle=e[axis.toLowerCase()],c=Math.cos(angle),s=Math.sin(angle),r=axis==='X'?[1,0,0,0,c,s,0,-s,c]:axis==='Y'?[c,0,-s,0,1,0,s,0,c]:[c,s,0,-s,c,0,0,0,1];m=multiply(m,r);}return [m[0],m[3],m[6],m[1],m[4],m[7],m[2],m[5],m[8]];
}
function rotation4(value){const a=value?.elements??value??[1,0,0,0,1,0,0,0,1];if(a.length!==9||!Array.from(a).every(Number.isFinite))throw Error('Finite mat3 lookup rotation required');return [a[0],a[1],a[2],0,a[3],a[4],a[5],0,a[6],a[7],a[8],0,0,0,0,1];}
export function packEnvironmentView(layout,{rotation=null,backgroundRotation=rotation,intensity=1,backgroundIntensity=1,nearest=false}={}){
 if(![intensity,backgroundIntensity].every(x=>Number.isFinite(x)&&x>=0))throw Error('Finite nonnegative environment intensities required');
 const f=new Float32Array(40);f.set(rotation4(rotation));f.set(rotation4(backgroundRotation),16);f.set([intensity,backgroundIntensity,layout.lodMax,1],32);f.set([layout.atlasWidth,layout.atlasHeight,layout.size,nearest?1:0],36);return f;
}
export const ENVIRONMENT_CUBEUV_WGSL=/*wgsl*/`
fn envUnit(v:vec3f)->vec3f{return v/max(length(v),1e-20);}
fn envBilinear(tex:texture_2d<f32>,pixel:vec2f)->vec3f {
 let dims=vec2i(textureDimensions(tex));let p=pixel-vec2f(0.5);let i=vec2i(floor(p));let t=fract(p);
 let a=textureLoad(tex,clamp(i,vec2i(0),dims-vec2i(1)),0).rgb;let b=textureLoad(tex,clamp(i+vec2i(1,0),vec2i(0),dims-vec2i(1)),0).rgb;
 let c=textureLoad(tex,clamp(i+vec2i(0,1),vec2i(0),dims-vec2i(1)),0).rgb;let d=textureLoad(tex,clamp(i+vec2i(1,1),vec2i(0),dims-vec2i(1)),0).rgb;return mix(mix(a,b,t.x),mix(c,d,t.x),t.y);
}
fn envEquirect(tex:texture_2d<f32>,direction:vec3f,nearest:bool)->vec3f {
 let d=envUnit(direction);let uv=vec2f(atan2(d.z,d.x)*0.15915494309189535+0.5,asin(clamp(d.y,-1.0,1.0))*0.3183098861837907+0.5);
 // Three equirectangular textures clamp at their authored seam; no guessed wrap.
 if(nearest){let dims=vec2i(textureDimensions(tex));return textureLoad(tex,clamp(vec2i(floor(uv*vec2f(dims))),vec2i(0),dims-vec2i(1)),0).rgb;}
 return envBilinear(tex,uv*vec2f(textureDimensions(tex)));
}
fn envFace(d:vec3f)->u32 {let a=abs(d);if(a.x>a.z){if(a.x>a.y){return select(3u,0u,d.x>0.0);}return select(4u,1u,d.y>0.0);}if(a.z>a.y){return select(5u,2u,d.z>0.0);}return select(4u,1u,d.y>0.0);}
fn envFaceUV(d:vec3f,f:u32)->vec2f {var uv:vec2f;switch f {case 0u:{uv=vec2f(d.z,d.y)/abs(d.x);}case 1u:{uv=vec2f(-d.x,-d.z)/abs(d.y);}case 2u:{uv=vec2f(-d.x,d.y)/abs(d.z);}case 3u:{uv=vec2f(-d.z,d.y)/abs(d.x);}case 4u:{uv=vec2f(-d.x,d.z)/abs(d.y);}default:{uv=vec2f(d.x,d.y)/abs(d.z);}}return (uv+vec2f(1.0))*0.5;}
fn envCube(tex:texture_2d<f32>,direction:vec3f,mip:f32,lodMax:f32)->vec3f {
 let d=envUnit(direction);var f=envFace(d);let filterOffset=max(4.0-mip,0.0);let size=exp2(max(mip,4.0));var uv=envFaceUV(d,f)*(size-2.0)+vec2f(1.0);
 if(f>2u){uv.y+=size;f-=3u;}uv.x+=f32(f)*size+filterOffset*48.0;uv.y+=4.0*(exp2(lodMax)-size);
 return envBilinear(tex,vec2f(uv.x,f32(textureDimensions(tex).y)-uv.y));
}
fn envRoughMip(r:f32)->f32 {if(r>=0.8){return (1.0-r)/0.2-2.0;}if(r>=0.4){return (0.8-r)*7.5-1.0;}if(r>=0.305){return (0.4-r)/0.095+2.0;}if(r>=0.21){return (0.305-r)/0.095+3.0;}return -2.0*log2(max(1.16*r,1e-20));}
fn envFiltered(tex:texture_2d<f32>,direction:vec3f,r:f32,lodMax:f32)->vec3f {let m=clamp(envRoughMip(clamp(r,0.0,1.0)),-2.0,lodMax);let lo=floor(m);let a=envCube(tex,direction,lo,lodMax);if(fract(m)==0.0){return a;}return mix(a,envCube(tex,direction,lo+1.0,lodMax),fract(m));}
`;
/** Optional group3 sampling API. Values are LINEAR; output conversion/fog belong
 * to integrator. diffuseIrradiance includes PI, radiance does not include BRDF.
 */
export const ENVIRONMENT_WGSL=ENVIRONMENT_CUBEUV_WGSL+/*wgsl*/`
struct Environment {rotation:mat4x4f,backgroundRotation:mat4x4f,parameters:vec4f,dimensions:vec4f}
@group(3) @binding(0) var<uniform> environment:Environment;
@group(3) @binding(1) var environmentPMREM:texture_2d<f32>;
@group(3) @binding(2) var environmentHDR:texture_2d<f32>;
fn environmentSample(direction:vec3f,roughness:f32)->vec3f {let d=(environment.rotation*vec4f(direction,0.0)).xyz;return envFiltered(environmentPMREM,d,roughness,environment.parameters.z)*environment.parameters.x;}
fn environmentDiffuseIrradiance(normal:vec3f)->vec3f {return 3.141592653589793*environmentSample(envUnit(normal),1.0);}
fn environmentSpecularRadiance(viewDirection:vec3f,normal:vec3f,roughness:f32)->vec3f {let n=envUnit(normal);let r=clamp(roughness,0.0,1.0);let reflected=reflect(-envUnit(viewDirection),n);let direction=envUnit(mix(reflected,n,r*r*r*r));return environmentSample(direction,r);}
fn environmentBackground(direction:vec3f,blurriness:f32)->vec3f {let d=(environment.backgroundRotation*vec4f(direction,0.0)).xyz;if(blurriness<=0.0){return envEquirect(environmentHDR,d,environment.dimensions.w>0.5)*environment.parameters.y;}return envFiltered(environmentPMREM,d,blurriness,environment.parameters.z)*environment.parameters.y;}
`;
export const ENVIRONMENT_GENERATE_WGSL=ENVIRONMENT_CUBEUV_WGSL+/*wgsl*/`
struct Generate {rectangle:vec4f,settings:vec4f}
@group(0) @binding(0) var<uniform> generation:Generate;
@group(0) @binding(1) var inputEnvironment:texture_2d<f32>;
@vertex fn environmentTriangle(@builtin(vertex_index)i:u32)->@builtin(position)vec4f {let uv=vec2f(f32((i<<1u)&2u),f32(i&2u));return vec4f(uv*2.0-vec2f(1.0),0.0,1.0);}
fn environmentOutput(p:vec2f)->vec3f {let size=generation.rectangle.z;let local=vec2f(p.x-generation.rectangle.x,2.0*size-(p.y-generation.rectangle.y));let col=u32(floor(local.x/size));let row=u32(floor(local.y/size));let face=col+3u*row;let uv=(local-vec2f(f32(col),f32(row))*size-vec2f(1.0))/(size-2.0)*2.0-vec2f(1.0);var d:vec3f;switch face {case 0u:{d=vec3f(1.0,uv.y,uv.x);}case 1u:{d=vec3f(-uv.x,1.0,-uv.y);}case 2u:{d=vec3f(-uv.x,uv.y,1.0);}case 3u:{d=vec3f(-1.0,uv.y,-uv.x);}case 4u:{d=vec3f(-uv.x,-1.0,uv.y);}default:{d=vec3f(uv.x,uv.y,-1.0);}}return envUnit(d);}
@fragment fn environmentConvert(@builtin(position)p:vec4f)->@location(0)vec4f {return vec4f(envEquirect(inputEnvironment,environmentOutput(p.xy),generation.settings.w>0.5),1.0);}
fn envRadical(bits0:u32)->f32 {var bits=(bits0<<16u)|(bits0>>16u);bits=((bits&0x55555555u)<<1u)|((bits&0xAAAAAAAAu)>>1u);bits=((bits&0x33333333u)<<2u)|((bits&0xCCCCCCCCu)>>2u);bits=((bits&0x0F0F0F0Fu)<<4u)|((bits&0xF0F0F0F0u)>>4u);bits=((bits&0x00FF00FFu)<<8u)|((bits&0xFF00FF00u)>>8u);return f32(bits)*2.3283064365386963e-10;}
@fragment fn environmentGGX(@builtin(position)p:vec4f)->@location(0)vec4f {
 let n=environmentOutput(p.xy);let rough=generation.settings.x;let mip=generation.settings.y;let lodMax=generation.settings.z;
 if(rough<0.001){return vec4f(envCube(inputEnvironment,n,mip,lodMax),1.0);}
 let up=select(vec3f(1.0,0.0,0.0),vec3f(0.0,0.0,1.0),abs(n.z)<0.999);let tangent=envUnit(cross(up,n));let bitangent=cross(n,tangent);let alpha=rough*rough;var color=vec3f(0.0);var weight=0.0;
 for(var i=0u;i<256u;i++){let xi=vec2f(f32(i)/256.0,envRadical(i));let r=sqrt(xi.x);let phi=6.283185307179586*xi.y;let t1=r*cos(phi);let t2=r*sin(phi);let h0=envUnit(vec3f(alpha*t1,alpha*t2,sqrt(max(0.0,1.0-t1*t1-t2*t2))));let h=envUnit(tangent*h0.x+bitangent*h0.y+n*h0.z);let l=envUnit(2.0*dot(n,h)*h-n);let nl=max(dot(n,l),0.0);if(nl>0.0){color+=envCube(inputEnvironment,l,mip,lodMax)*nl;weight+=nl;}}
 if(weight>0.0){color/=weight;}return vec4f(color,1.0);
}
`;
export class FrameGpuEnvironment {
 static async create(ownerOrDevice,{resourcePool=null,maxCacheBytes=256*1024*1024}={}){const owner=ownerOrDevice?.device?ownerOrDevice:null,device=owner?.device??ownerOrDevice;if(!device?.queue)throw Error('Existing shared GPUDevice required');const manager=new FrameGpuEnvironment(device,{resourcePool:resourcePool??owner?.pool,maxCacheBytes});try{await manager.init();return manager;}catch(e){await manager.dispose();throw e;}}
 constructor(device,{resourcePool=null,maxCacheBytes}={}){if(resourcePool&&resourcePool.device!==device)throw Error('Environment pool/device mismatch');if(!Number.isSafeInteger(maxCacheBytes)||maxCacheBytes<1)throw Error('Positive cache byte limit required');this.device=device;this.pool=resourcePool??new GpuBufferPool(device);this.ownsPool=!resourcePool;this.maxCacheBytes=maxCacheBytes;this.cache=new Map();this.rows=new Set();this.views=new Set();this.pending=new Set();this.state='initializing';this.bytes=0;device.lost.then(()=>{if(this.state==='disposed')return;this.state='lost';this.cache.clear();for(const row of this.rows)this._destroy(row);for(const view of [...this.views])view.release();});}
 async init(){const d=this.device;d.pushErrorScope('validation');try{this.module=d.createShaderModule({label:'Frame native GGX environment',code:ENVIRONMENT_GENERATE_WGSL});this.compilation=await this.module.getCompilationInfo();const errors=this.compilation.messages.filter(x=>x.type==='error');if(errors.length)throw Error(errors.map(x=>x.message).join('\n'));this.generationLayout=d.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform',minBindingSize:32}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'unfilterable-float'}}]});this.bindingLayout=d.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform',minBindingSize:160}},... [1,2].map(binding=>({binding,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'unfilterable-float'}}))]});const layout=d.createPipelineLayout({bindGroupLayouts:[this.generationLayout]});this.pipelines={};for(const entryPoint of ['environmentConvert','environmentGGX'])this.pipelines[entryPoint]=await d.createRenderPipelineAsync({label:'Frame '+entryPoint,layout,vertex:{module:this.module,entryPoint:'environmentTriangle'},fragment:{module:this.module,entryPoint,targets:[{format:'rgba16float'}]},primitive:{topology:'triangle-list'}});if(this.state!=='initializing')throw abort('Environment device unavailable during init');this.state='ready';}finally{const error=await d.popErrorScope();if(error)throw Error('Environment validation: '+error.message);}}
 _check(){if(this.state!=='ready')throw abort('Environment '+this.state);}
 async prepare(source,options={}){
  this._check();const stamp=environmentSourceStamp(source),image=source?.image??source,layout=environmentLayout(image?.width,options);let row=this.cache.get(source);
  if(row&&!row.retired&&row.layout.size===layout.size&&row.stamp.every((x,i)=>Object.is(x,stamp[i]))){await row.ready;this._check();return this._lease(row);}
  if(row)this.invalidate(source);const hdr=captureLinearHDR(source),cost=hdr.width*hdr.height*16+layout.atlasWidth*layout.atlasHeight*8;
  if(Math.max(layout.atlasWidth,layout.atlasHeight,hdr.width,hdr.height)>this.device.limits.maxTextureDimension2D)throw Error('Environment exceeds texture dimension limit');
  if(cost>this.maxCacheBytes)throw Error('Environment exceeds explicit cache budget');
  if(this.bytes+cost>this.maxCacheBytes)throw Error('Environment cache budget occupied; invalidate unused sources first');
  row={source,stamp:hdr.stamp,layout,cost,nearest:hdr.nearest,refs:0,retired:false,destroyed:false,textures:[],status:'preparing'};this.cache.set(source,row);this.rows.add(row);this.bytes+=cost;
  row.ready=this._generate(row,hdr).then(()=>{this._check();if(!current(source,row.stamp)||row.retired)throw abort('HDR changed during PMREM preparation');row.status='ready';}).catch(e=>{if(this.cache.get(source)===row)this.cache.delete(source);row.retired=true;this._destroy(row);throw e;});this.pending.add(row.ready);try{await row.ready;return this._lease(row);}finally{this.pending.delete(row.ready);}
 }
 async _generate(row,hdr){const d=this.device,L=row.layout,refs=[];let temporary,submitted=false;
  const texture=(desc)=>{const t=d.createTexture(desc);row.textures.push(t);return t;};
  try{row.hdr=texture({label:'Frame decoded linear HDR',size:[hdr.width,hdr.height],format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});d.queue.writeTexture({texture:row.hdr},hdr.pixels,{bytesPerRow:hdr.width*16,rowsPerImage:hdr.height},[hdr.width,hdr.height]);
   row.pmrem=texture({label:'Frame native cubeUV PMREM',size:[L.atlasWidth,L.atlasHeight],format:'rgba16float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST});
   temporary=d.createTexture({label:'Frame PMREM ping pong',size:[L.atlasWidth,L.atlasHeight],format:'rgba16float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
   const encoder=d.createCommandEncoder({label:'Frame native PMREM generation'});
   for(const level of L.levels){const params=new Float32Array([level.x,level.top,level.faceSize,0,level.adjustedRoughness,L.lodMax-level.index+1,L.lodMax,row.nearest?1:0]),uniform=this.pool.borrow(params,GPUBufferUsage.UNIFORM,'Frame PMREM level');refs.push(uniform);const input=level.index?row.pmrem:row.hdr,output=level.index?temporary:row.pmrem;
    const bind=d.createBindGroup({layout:this.generationLayout,entries:[{binding:0,resource:{buffer:uniform.buffer}},{binding:1,resource:input.createView()}]});const pass=encoder.beginRenderPass({colorAttachments:[{view:output.createView(),loadOp:'load',storeOp:'store'}]});pass.setPipeline(this.pipelines[level.index?'environmentGGX':'environmentConvert']);pass.setViewport(level.x,level.top,level.faceSize*3,level.faceSize*2,0,1);pass.setScissorRect(level.x,level.top,level.faceSize*3,level.faceSize*2);pass.setBindGroup(0,bind);pass.draw(3);pass.end();
    if(level.index)encoder.copyTextureToTexture({texture:temporary,origin:[level.x,level.top,0]},{texture:row.pmrem,origin:[level.x,level.top,0]},[level.faceSize*3,level.faceSize*2,1]);
   }
   this._check();if(!current(row.source,row.stamp)||row.retired)throw abort('HDR changed before PMREM submit');d.queue.submit([encoder.finish()]);submitted=true;await d.queue.onSubmittedWorkDone();this._check();
  }finally{if(submitted&&this.state==='ready')await d.queue.onSubmittedWorkDone().catch(()=>{});temporary?.destroy();for(const ref of refs)this.pool.release(ref);}
 }
 _lease(row){this._check();if(row.retired||row.destroyed||row.status!=='ready'||!current(row.source,row.stamp))throw abort('Environment source stale');row.refs++;const manager=this;let released=false;return {manager,row,layout:row.layout,isCurrent:()=>!released&&manager.state==='ready'&&!row.retired&&!row.destroyed&&current(row.source,row.stamp),release(){if(released)return;released=true;row.refs--;manager._retire(row);}};}
 capture(lease,options={}){this._check();if(lease?.manager!==this||!lease.isCurrent())throw abort('Environment lease unavailable');const row=lease.row,ref=this.pool.borrow(packEnvironmentView(row.layout,{...options,nearest:row.nearest}),GPUBufferUsage.UNIFORM,'Frame environment per-view'),hold=this._lease(row);let bind;
  try{bind=this.device.createBindGroup({layout:this.bindingLayout,entries:[{binding:0,resource:{buffer:ref.buffer}},{binding:1,resource:row.pmrem.createView()},{binding:2,resource:row.hdr.createView()}]});}catch(e){this.pool.release(ref);hold.release();throw e;}
  const view={manager:this,bind,layout:this.bindingLayout,isCurrent:()=>!view.released&&hold.isCurrent(),released:false,release:()=>{if(view.released)return view.done;view.released=true;view.done=this.device.queue.onSubmittedWorkDone().catch(()=>{}).then(()=>{this.pool.release(ref);hold.release();this.views.delete(view);});return view.done;}};this.views.add(view);return view;
 }
 invalidate(source){const row=this.cache.get(source);if(!row)return;this.cache.delete(source);row.retired=true;this._retire(row);}
 _retire(row){if(row.retired&&row.refs===0&&row.status==='ready'&&!row.retiring){row.retiring=true;this.device.queue.onSubmittedWorkDone().catch(()=>{}).then(()=>{if(row.refs===0)this._destroy(row);else row.retiring=false;});}}
 _destroy(row){if(row.destroyed)return;row.destroyed=true;for(const t of row.textures)t.destroy();this.rows.delete(row);this.bytes-=row.cost;if(this.cache.get(row.source)===row)this.cache.delete(row.source);}
 async dispose(){if(this.state==='disposed')return;this.state='disposed';this.cache.clear();await Promise.allSettled([...this.pending]);await Promise.all([...this.views].map(v=>v.release()));await this.device.queue.onSubmittedWorkDone().catch(()=>{});for(const row of [...this.rows])this._destroy(row);if(this.ownsPool)this.pool.dispose();}
}
