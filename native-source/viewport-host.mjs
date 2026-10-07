import {displayPolicyOptions}from './gpu-display.mjs';
/** Explicit host for Frame's render loop. Captures each view synchronously and
 * submits once after helpers, camera panes and HUD have all been captured.
 * There is no synchronous readback or WebGL render-target emulation here.
 */
import {FrameViewportBridge} from './viewport-renderer.mjs';
import {assertRenderDomain,assertAdapterRenderDomain} from './render-domain.mjs';
const abort=message=>new DOMException(message,'AbortError');
const linear=x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4;
const srgb=x=>x<=.0031308?12.92*x:1.055*x**(1/2.4)-.055;
export class FrameWebGPUViewportRenderer {
 static async create({canvas=globalThis.document?.createElement('canvas'),bridgeFactory=FrameViewportBridge.create,onError=()=>{},onCapture=null,...options}={}){
  if(!canvas)throw Error('Native viewport canvas required');
  const host=new FrameWebGPUViewportRenderer({canvas,bridgeFactory,onError,options});host.onCapture=onCapture;
  await host.retry();return host;
 }
 constructor({canvas,bridgeFactory=FrameViewportBridge.create,onError=()=>{},options={}}){
  if(options.cubicCapabilityResolver!=null&&typeof options.cubicCapabilityResolver!=='function')throw Error('Explicit cubic startup resolver required');
  Object.defineProperty(this,'cubicCapabilityResolver',{value:options.cubicCapabilityResolver??null,enumerable:true});
  const policies=displayPolicyOptions(options);for(const[name,value]of Object.entries(policies))Object.defineProperty(this,name,{value,enumerable:true});
  Object.defineProperty(this,'renderDomain',{value:assertRenderDomain(options.renderDomain??'canonical'),enumerable:true});this.domElement=canvas;this.bridgeFactory=bridgeFactory;this.onError=onError;this.options={...options,renderDomain:this.renderDomain,...policies};
  this.isFrameNativeViewportRenderer=true;this.ready=false;this.disposed=false;this.generation=0;this.opening=null;this.bridge=null;
  this.width=canvas.width||1;this.height=canvas.height||1;this.pixelRatio=1;this.viewport=[0,0,this.width,this.height];this.scissor=[...this.viewport];this.scissorTest=false;
  this.clearColor=[0,0,0];this.clearAlpha=1;this.shadingMode='solid';this.toneMapping=0;this.toneMappingExposure=1;this.outputColorSpace='srgb';this.autoClear=false;
  this.lastFrame=Promise.resolve({status:'idle'});this.frameOpen=false;
 }
 get nativeEngine(){return this.bridge?.engine??null;}
 get info(){return this.bridge?.info??null;}
 async retry(){
  if(this.disposed)throw abort('Native viewport disposed');if(this.opening)return this.opening;
  const generation=++this.generation;this.ready=false;this.frameOpen=false;
  const operation=(async()=>{
   const old=this.bridge;this.bridge=null;this.unsubscribeLoss?.();this.unsubscribeLoss=null;
   await old?.dispose();if(this.disposed||generation!==this.generation)throw abort('Native viewport initialization superseded');
   let bridge;
   try{
    bridge=await this.bridgeFactory({...this.options,renderDomain:this.renderDomain,cubicCapabilityResolver:this.cubicCapabilityResolver,isCurrent:()=>!this.disposed&&generation===this.generation,quadTopology:this.quadTopology,basicSpecialization:this.basicSpecialization,standardSpecialization:this.standardSpecialization,canvas:this.domElement,onError:e=>{if(!this.disposed&&generation===this.generation&&this.bridge===bridge)this.onError(e);}});
    if(this.disposed||generation!==this.generation)throw abort('Native viewport initialization superseded');
    assertAdapterRenderDomain(bridge,this.renderDomain);assertAdapterRenderDomain(bridge.engine,this.renderDomain);
    for(const[name,value]of Object.entries(displayPolicyOptions(this))){const actual=bridge[name]??bridge.engine?.display?.[name]??bridge.engine?.[name]??displayPolicyOptions()[name];if(actual!==value)throw Error('Native host display policy mismatch: '+name);}
    bridge.setSize(this.width,this.height,this.pixelRatio);bridge.setViewport(...this.viewport);bridge.setScissor(...this.scissor);bridge.setScissorTest(this.scissorTest);
    this.bridge=bridge;this.ready=true;
    this.unsubscribeLoss=bridge.lease.owner.onLoss(info=>{
     if(this.disposed||this.bridge!==bridge)return;
     this.ready=false;this.frameOpen=false;bridge.cancelCapture();
     this.onError(abort('WebGPU device lost: '+(info.message||info.reason||'unknown')));
    });
    return this;
   }catch(error){if(bridge&&this.bridge!==bridge)await bridge.dispose();throw error;}
  })();
  this.opening=operation;try{return await operation;}finally{if(this.opening===operation)this.opening=null;}
 }
 _check(){if(this.disposed||!this.ready||!this.bridge?.lease.isCurrent())throw abort('Native viewport is not ready');}
 setPixelRatio(value){if(!Number.isFinite(value)||value<=0)throw Error('Invalid viewport pixel ratio');this.pixelRatio=value;if(this.ready)this.bridge.setSize(this.width,this.height,value);}
 getPixelRatio(){return this.pixelRatio;}
 setSize(width,height,updateStyle=true){
  if(![width,height].every(Number.isFinite)||width<1||height<1)throw Error('Invalid viewport dimensions');
  this.width=width;this.height=height;this.viewport=[0,0,width,height];this.scissor=[...this.viewport];
  if(updateStyle&&this.domElement.style){this.domElement.style.width=width+'px';this.domElement.style.height=height+'px';}
  if(this.ready)this.bridge.setSize(width,height,this.pixelRatio);
 }
 getSize(target){return target.set(this.width,this.height);}
 getDrawingBufferSize(target){return target.set(Math.round(this.width*this.pixelRatio),Math.round(this.height*this.pixelRatio));}
 setViewport(x,y,w,h){this.viewport=typeof x==='object'?[x.x,x.y,x.z,x.w]:[x,y,w,h];if(this.ready)this.bridge.setViewport(...this.viewport);}
 getViewport(target){return target.set(...this.viewport);}
 setScissor(x,y,w,h){this.scissor=typeof x==='object'?[x.x,x.y,x.z,x.w]:[x,y,w,h];if(this.ready)this.bridge.setScissor(...this.scissor);}
 getScissor(target){return target.set(...this.scissor);}
 setScissorTest(value){this.scissorTest=!!value;if(this.ready)this.bridge.setScissorTest(value);}
 getScissorTest(){return this.scissorTest;}
 setClearColor(value,alpha=this.clearAlpha){
  const rgb=typeof value==='number'?[(value>>>16&255)/255,(value>>>8&255)/255,(value&255)/255].map(linear):[value.r,value.g,value.b];
  if(![...rgb,alpha].every(Number.isFinite))throw Error('Invalid native clear colour');this.clearColor=rgb;this.clearAlpha=alpha;
 }
 getClearColor(target){target.r=this.clearColor[0];target.g=this.clearColor[1];target.b=this.clearColor[2];return target;}
 getClearAlpha(){return this.clearAlpha;}
 beginFrame(){this._check();if(this.frameOpen)throw Error('Unfinished native host frame');this.bridge.beginFrame({clearColor:[...this.clearColor.map(srgb),this.clearAlpha]});this.frameOpen=true;}
 clear(color=true,depth=true){this._check();if(!this.frameOpen)throw Error('Native beginFrame must precede clear');this.bridge.clear({color:color?[...this.clearColor.map(srgb),this.clearAlpha]:null,depth});}
 clearDepth(){this.clear(false,true);}
 render(scene,camera){
  this._check();if(!this.frameOpen)throw Error('Native beginFrame must precede render');
  if(this.outputColorSpace!=='srgb'||![0,4].includes(this.toneMapping))throw Error('Explicit native output/tone mapping adapter required');
  const captured=this.bridge.capture(scene,camera,{mode:this.shadingMode,lighting:{exposure:this.toneMappingExposure,toneMapping:this.toneMapping===4?'aces':'none'}});
  this.onCapture?.({renderer:this,scene,camera,captured});
 }
 endFrame(){this._check();if(!this.frameOpen)throw Error('No native host frame');this.frameOpen=false;return this.lastFrame=this.bridge.endFrame();}
 cancelFrame(){this.frameOpen=false;this.bridge?.cancelCapture();}
 failFrame(error){this.cancelFrame();this.lastFrame=Promise.reject(error);this.lastFrame.catch(()=>{});}
 async whenFrameReady(){
  await this.opening;this._check();
  for(;;){const frame=this.lastFrame;let result;try{result=await frame;}catch(error){if(frame!==this.lastFrame)continue;throw error;}
   this._check();if(frame===this.lastFrame)return result;}
 }
 async dispose(){
  if(this.disposed)return;this.disposed=true;this.ready=false;++this.generation;this.cancelFrame();this.unsubscribeLoss?.();this.unsubscribeLoss=null;
  await this.opening?.catch(()=>{});const bridge=this.bridge;this.bridge=null;await bridge?.dispose();
 }
}
