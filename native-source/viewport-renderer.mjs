/** Frame's synchronous scene traversal -> asynchronous native frame submission.
 * Capture MUST occur inside legacy render(scene,camera): Frame restores temporary
 * batching, helper visibility and parent matrices immediately after that call.
 * This bridge never retains a callback that traverses those restored objects later.
 * It is an integration boundary, not a WebGL fallback or a THREE renderer facade.
 */
import {frameGpuBroker} from './device-broker.mjs';
import {FrameNativeEngine} from './native-engine.mjs';
import {captureDisplayScene,cameraPacket,captureLighting} from './display-packets.mjs';
import {capturePrinterObject} from './gpu-printer.mjs';
import {packDraw,displayPolicyOptions} from './gpu-display.mjs';
import {LatestFrameQueue} from './gpu-resources.mjs';
import {textureState,textureStateCurrent} from './texture-policy.mjs';
import {environmentSourceStamp,environmentRotation} from './gpu-environment.mjs';
import {relativeDisplaySnapshot} from './relative-frame.mjs';
import {assertRenderDomain,assertAdapterRenderDomain} from './render-domain.mjs';
const abort=m=>new DOMException(m,'AbortError');
/** GL/CSS bottom-left input -> GPU physical top-left. Round shared boundaries,
 * not each width independently, so four odd-sized views neither overlap nor crack. */
export function physicalViewport(rect,width,height,pixelRatio){
 if(![...rect,width,height,pixelRatio].every(Number.isFinite)||pixelRatio<=0)throw Error('Invalid viewport coordinates');
 const [x,y,w,h]=rect;if(w<0||h<0)throw Error('Negative viewport extent');
 const left=Math.round(x*pixelRatio),right=Math.round((x+w)*pixelRatio);
 const top=Math.round((height-y-h)*pixelRatio),bottom=Math.round((height-y)*pixelRatio);
 const pw=Math.round(width*pixelRatio),ph=Math.round(height*pixelRatio);
 if(left<0||top<0||right>pw||bottom>ph)throw Error('Viewport outside native canvas');
 return [left,top,right-left,bottom-top];
}
const srgb=x=>x<=.0031308?x*12.92:1.055*Math.pow(x,1/2.4)-.055;
const encodeColor=(value,alpha=1)=>[srgb(value.r),srgb(value.g),srgb(value.b),alpha];
export class FrameViewportBridge {
 static async create({canvas,broker=frameGpuBroker,format='bgra8unorm',sampleCount=4,onError=()=>{},engineFactory=FrameNativeEngine.create,renderDomain='canonical',cubicWindowCapability=null,cubicCapabilityResolver=null,isCurrent=()=>true,quadTopology='list',basicSpecialization='disabled',standardSpecialization='disabled'}={}){
  assertRenderDomain(renderDomain);const policies=displayPolicyOptions({quadTopology,basicSpecialization,standardSpecialization});if(!canvas?.getContext)throw Error('Viewport canvas required');
  if(typeof isCurrent!=='function'||cubicCapabilityResolver!==null&&typeof cubicCapabilityResolver!=='function')throw Error('Explicit viewport startup guards required');
  if(!isCurrent())throw abort('Viewport initialization superseded before acquisition');
  const lease=await broker.acquire('viewport');let engine,bridge;
  try{
   const current=()=>lease.isCurrent()&&isCurrent();if(!current())throw abort('Viewport initialization superseded after acquisition');
   const context=canvas.getContext('webgpu');if(!context)throw Error('No WebGPU canvas context; no WebGL fallback');
   if(cubicCapabilityResolver){
    cubicWindowCapability=await cubicCapabilityResolver(lease.owner,{isCurrent:current});
    if(!current()||cubicWindowCapability?.device!==lease.device||typeof cubicWindowCapability.isCurrent!=='function'||!cubicWindowCapability.isCurrent())throw abort('Viewport cubic capability is stale or belongs to another device');
   }
   engine=await engineFactory({sharedDevice:lease.owner,format,sampleCount,onError,renderDomain,cubicWindowCapability,...policies});
   for(const [name,value]of Object.entries(policies)){const actual=engine.display?.[name]??engine[name]??displayPolicyOptions()[name];if(actual!==value)throw Error("Native display policy mismatch: "+name);}
   assertAdapterRenderDomain(engine,renderDomain);if(!current()||cubicWindowCapability?.isCurrent&&!cubicWindowCapability.isCurrent())throw abort('Viewport device or capability was lost during initialization');
   context.configure({device:lease.device,format,alphaMode:'premultiplied',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
   bridge=new FrameViewportBridge({canvas,context,lease,engine,onError});return bridge;
  }catch(error){try{await engine?.dispose();}finally{lease.release();}throw error;}
 }
 constructor({canvas,context,lease,engine,onError=()=>{}}){
  for(const [name,value]of Object.entries(displayPolicyOptions(engine.display??engine)))Object.defineProperty(this,name,{value,enumerable:true});
  Object.defineProperty(this,'renderDomain',{value:assertRenderDomain(engine.renderDomain??'canonical'),enumerable:true});Object.assign(this,{canvas,context,lease,engine,onError});this.device=lease.device;
  this.width=canvas.width||1;this.height=canvas.height||1;this.pixelRatio=1;this.viewport=[0,0,this.width,this.height];this.scissor=[...this.viewport];this.scissorTest=false;
  this.serial=0;this.resizeGeneration=0;this.builder=null;this.disposed=false;this.handles=new Map();this.ids=new WeakMap();this.nextId=0;
  this.queue=new LatestFrameQueue(this.device,{encode:frame=>this._encode(frame),onError:e=>{if(e.name!=='AbortError')onError(e);}});this.lastFrame=Promise.resolve({status:'idle'});
  this.info={render:{calls:0,triangles:0,lines:0,points:0},memory:{geometries:0,textures:0,uploadBuffers:0,bufferBytes:0},autoReset:false,reset:()=>{this.info.render={calls:0,triangles:0,lines:0,points:0};}};
 }
 _check(){if(this.disposed||!this.lease.isCurrent())throw Error('Native viewport is not ready');}
 setSize(width,height,pixelRatio=this.pixelRatio){
  this._check();if(![width,height,pixelRatio].every(Number.isFinite)||width<1||height<1||pixelRatio<=0)throw Error('Invalid native viewport size');
  if(width!==this.width||height!==this.height||pixelRatio!==this.pixelRatio||this.canvas.width!==Math.round(width*pixelRatio)||this.canvas.height!==Math.round(height*pixelRatio))this.resizeGeneration++;
  this.width=width;this.height=height;this.pixelRatio=pixelRatio;this.canvas.width=Math.round(width*pixelRatio);this.canvas.height=Math.round(height*pixelRatio);this.viewport=[0,0,width,height];this.scissor=[...this.viewport];
 }
 setViewport(x,y,w,h){this.viewport=[x,y,w,h];}
 setScissor(x,y,w,h){this.scissor=[x,y,w,h];}
 setScissorTest(enabled){this.scissorTest=!!enabled;}
 beginFrame({clearColor=[0,0,0,1]}={}){
  this._check();if(this.builder)throw Error('Unfinished native frame');
  this.builder={id:++this.serial,width:this.canvas.width,height:this.canvas.height,resizeGeneration:this.resizeGeneration,lease:this.lease,views:[],clearColor:[...clearColor]};
 }
 /** Explicit per-view clear, including transparent camera-integrator holes.
  * No render-attachment clear may erase previously drawn neighbouring viewports. */
 clear({color=null,depth=true}={}){
  if(!this.builder)throw Error('beginFrame must precede native clear');
  const rect=physicalViewport(this.scissorTest?this.scissor:[0,0,this.width,this.height],this.width,this.height,this.pixelRatio);
  if(rect[2]&&rect[3])this.builder.views.push({clear:{rectangle:rect,color:color&&[...color],depth}});
 }
 capture(scene,camera,{mode='solid',include=()=>true,lighting={}}={}){
  this._check();if(!this.builder)throw Error('beginFrame must precede scene capture');
  // Match bundled Three's render-time refresh, including manually controlled matrices.
  if(scene.matrixWorldAutoUpdate===true)scene.updateMatrixWorld();
  if(camera.parent===null&&camera.matrixWorldAutoUpdate===true)camera.updateMatrixWorld();
  if(scene.background?.isTexture)throw Error('Environment background adapter required before drawing this Frame viewport');
  const rect=physicalViewport(this.viewport,this.width,this.height,this.pixelRatio);if(!rect[2]||!rect[3])return;
  const scissor=physicalViewport(this.scissorTest?this.scissor:this.viewport,this.width,this.height,this.pixelRatio);
  const view=cameraPacket(camera,{width:this.canvas.width,height:this.canvas.height,viewport:rect,...lighting,...captureLighting(scene,camera),fog:scene.fog,relative:true});view.scissor=scissor;
  const snapshot=relativeDisplaySnapshot(captureDisplayScene(scene,camera,{geometryCache:this.engine.geometryCache,instanceCache:this.engine.instanceCache,include,adapter:o=>capturePrinterObject(o,camera,{cache:this.engine.printerCache,mode,pixelRatio:this.pixelRatio})}),view.worldOrigin);
  // Capture numeric environment settings here, before per-view restoration.
  // Original HDR bytes are version guarded until asynchronous native upload.
  let environment=null;
  if(scene.environment&&snapshot.packets.some(p=>p.material?.type==='standard')){
   const source=scene.environment,stamp=environmentSourceStamp(source);
   environment={source,stamp,rotation:environmentRotation(scene.environmentRotation),intensity:scene.environmentIntensity??1};
  }
  // Packets contain copied numeric draw state. Discard live-scene isCurrent here:
  // temporary render batching is intentionally restored before async compilation.
  // Only texture/image changes must still reject, because texels are read later.
  const textureGuards=[];for(const p of snapshot.packets){const t=p.material?.texture;if(t){const stamp=textureState(t);textureGuards.push(()=>textureStateCurrent(t,stamp));}}
  this.builder.views.push({camera:view,packets:snapshot.packets,textureGuards,pixelRatio:this.pixelRatio,environment});
  if(scene.background?.isColor)this.builder.views[this.builder.views.length-1].background=encodeColor(scene.background);
  return this.builder.views[this.builder.views.length-1];
 }
 endFrame(){
  this._check();const frame=this.builder;if(!frame)throw Error('No native frame to submit');this.builder=null;
  if(!frame.views.length)return this.lastFrame=Promise.resolve({status:'empty'});
  this.lastFrame=this.queue.request(frame);this.lastFrame.catch(()=>{});return this.lastFrame;
 }
 cancelCapture(){this.builder=null;}
 _id(value){if(!value||typeof value!=='object')return String(value);let id=this.ids.get(value);if(!id)this.ids.set(value,id=++this.nextId);return id;}
 _key(packet,ratio){
  if(packet.kind.startsWith('printer-'))return null; // printer uniforms can be camera dependent; retained per in-flight frame only
  const m=packet.material,t=m.texture;
  return [this.renderDomain,this._id(packet.geometry),this._id(packet.instances),this._id(packet.indices),packet.kind,packet.start,packet.count,packet.renderOrder,
   m.cullMode,m.transparent,m.depthWrite,m.depthTest,m.colorWrite,m.depthBias,m.slopeBias,this._id(t),t?.version,t?.source?.version,
   ...textureState(t).map(v=>this._id(v)),
   ...new Uint32Array(packDraw(packet,ratio).buffer)].join('|');
 }
 _assertFrameCurrent(frame){
  if(this.engine.display.cubicWindowCapability?.isCurrent&&!this.engine.display.cubicWindowCapability.isCurrent())throw abort('Cubic viewport capability expired before submission');
  assertAdapterRenderDomain(this.engine,this.renderDomain);assertAdapterRenderDomain(this.engine.display,this.renderDomain);if(this.disposed||frame.lease!==this.lease||!frame.lease.isCurrent())throw abort('Viewport device lost before native submission');
  if(this.engine.display.dfg&&!this.engine.display.dfg.isCurrent())throw abort('Physical DFG lost before native submission');
  if(frame.views.some(v=>v.environment&&!environmentSourceStamp(v.environment.source).every((x,i)=>Object.is(x,v.environment.stamp[i]))))throw abort('Environment changed before native submission');
  if(frame.resizeGeneration!==this.resizeGeneration||frame.width!==this.canvas.width||frame.height!==this.canvas.height)throw abort('Viewport resized before native submission');
 }
 async _encode(frame){
  this._assertFrameCurrent(frame);
  const transient=[],added=[],used=new Set(),views=[],environmentViews=[];let encoded;
  let released=false;const release=async({submitted=false}={})=>{if(released)return;released=true;await encoded?.release?.({submitted});for(const view of environmentViews)view.release();for(const h of transient)h.owner.release(h);if(!submitted)for(const[key,h]of added){h.owner.release(h);if(this.handles.get(key)===h)this.handles.delete(key);}for(const[key,row]of this.handles)if(!used.has(key)){row.owner.release(row);this.handles.delete(key);}};
  try{
   for(const source of frame.views){
    if(source.clear){views.push(source);continue;}
    if(!source.textureGuards.every(f=>f()))throw abort('Texture changed before upload');
    let environment=null;
    if(source.environment){
     const manager=await this.engine.environmentManager();this._assertFrameCurrent(frame);
     const lease=await manager.prepare(source.environment.source);
     try{this._assertFrameCurrent(frame);environment=manager.capture(lease,source.environment);environmentViews.push(environment);}finally{lease.release();}
    }
    const handles=[];
    for(const p of source.packets){
     const key=this._key(p,source.pixelRatio);let h=key&&this.handles.get(key);
     if(!h){h=p.kind.startsWith('printer-')?await this.engine.printer.prepare(p):await this.engine.display.prepare(p,{pixelRatio:source.pixelRatio});if(key){this.handles.set(key,h);added.push([key,h]);}else transient.push(h);}
     if(key)used.add(key);handles.push(h);
    }
    if(source.background)views.push({clear:{rectangle:source.camera.scissor,color:source.background,depth:true}});
    views.push({camera:source.camera,handles,environment});
   }
   this._assertFrameCurrent(frame);
   if(!frame.views.every(v=>!v.textureGuards||v.textureGuards.every(f=>f())))throw abort('Texture changed during native preparation');
   encoded=this.engine.display.encodeFrame({context:this.context,width:frame.width,height:frame.height,clearColor:frame.clearColor,views});
   const handles=views.flatMap(v=>v.handles??[]),geometry=new Set(handles.map(h=>h.packet.geometry));
   this.info.memory={geometries:geometry.size,textures:this.engine.display.textureRows.size,uploadBuffers:this.engine.owner.pool.entries.size,bufferBytes:this.engine.owner.pool.bytes};
   // Count submitted primitives (screen lines/points and ribbons are actual quads),
   // not an unmeasured hardware throughput or peak process-memory estimate.
   const stats={calls:0,triangles:0,lines:0,points:0};
   for(const v of views){if(v.clear){if((v.clear.color||v.clear.depth)&&v.clear.rectangle[2]&&v.clear.rectangle[3]){stats.calls++;stats.triangles++;}continue;}
    for(const h of v.handles){const p=h.packet;
     if(p.kind.startsWith('printer-')){if(p.count){stats.calls++;stats.triangles+=p.role==='warning'?Math.floor(p.count/3)*p.printerInstances.count:p.count*2;}}
     else if(p.instances.count){stats.calls+=h.draws.length;stats.triangles+=p.kind==='triangles'?Math.floor(p.count/3)*p.instances.count:(p.indices.length/(p.kind==='points'?1:2))*2*p.instances.count;}
    }
   }this.info.render=stats;
   return {commands:encoded.commands,assertCurrent:()=>this._assertFrameCurrent(frame),release};
  }catch(error){await encoded?.release?.({submitted:false});for(const view of environmentViews)view.release();for(const h of transient)h.owner.release(h);for(const [key,h]of added){h.owner.release(h);if(this.handles.get(key)===h)this.handles.delete(key);}throw error;}
 }
 async completed(){return this.lastFrame;}
 async dispose(){
  if(this.disposed)return;this.disposed=true;this.builder=null;this.queue.dispose();
  await this.queue.idle();await this.device.queue.onSubmittedWorkDone().catch(()=>{});
  for(const h of this.handles.values())h.owner.release(h);this.handles.clear();
  await this.engine.dispose();this.context.unconfigure?.();this.lease.release();
 }
}
