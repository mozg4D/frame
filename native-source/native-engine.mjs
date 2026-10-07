/** Composed native display + printer + on-demand marquee on ONE device.
 * Engine integration boundary, not yet the legacy Frame viewport/event replacement.
 */
import {FrameGpuDevice} from './gpu-resources.mjs';
import {FrameGpuDisplay,displayPolicyOptions} from './gpu-display.mjs';
import {FrameGpuEnvironment} from './gpu-environment.mjs';
import {FrameGpuPrinter,PrinterGeometryCache,capturePrinterObject} from './gpu-printer.mjs';
import {DisplayGeometryCache,DisplayInstanceCache,captureDisplayScene,cameraPacket} from './display-packets.mjs';
import {FrameGpuSelection,multiply4} from './gpu-selection.mjs';
import {LatestSelection,TopologyCache} from './interaction-controller.mjs';
import {drainCooperatively} from './topology-islands.mjs';
import {relativeClipMatrices,relativeDisplaySnapshot} from './relative-frame.mjs';
import {assertRenderDomain,assertAdapterRenderDomain} from './render-domain.mjs';
const abort=m=>new DOMException(m,'AbortError');
/** Uses the SAME immutable positions and index objects as colour packets. */
export function selectionPacketFromDisplay(snapshot,camera){
 const parts=snapshot.packets.filter(p=>p.kind==='triangles'||p.kind==='wire');if(!parts.length)throw Error('Selection needs explicit model-surface data, not its helper lines');
 const first=parts[0],g=first.geometry,instances=first.instances;
 for(const p of parts){if(p.geometry!==g||p.instances!==instances)throw Error('One source object per selection packet');const m=p.material;
  if(m.unsupported?.length||m.transparent||m.color[3]<1||m.alphaTest>0||!m.depthWrite||!m.depthTest)throw Error('Translucent/custom depth requires its own selection adapter');}
 const count=instances.count,clipMatrices=relativeClipMatrices(instances,camera);
 return {positions:g.positions,indices:g.indices,clipMatrices,instanceRanges:instances.ranges.map(r=>({...r})),ranges:parts.map(p=>({start:p.start,count:p.count,cullMode:p.material.cullMode})),objectId:first.objectId??first.object.uuid};
}
/** CPU materialisation yields; no source arrays or live selection are partially edited. */
export function* decodeMarqueeWork(mask,topology,domain,{batch=4096}={}){
 const s=topology.selection;if(!s)throw Error('GPU tables missing from background topology');const perInstance=domain==='vertex'?s.representatives.length:domain==='edge'?topology.edgeCount:domain==='face'?topology.faceCount:-1;
 if(perInstance<0)throw Error('Invalid selection domain');const source=domain==='vertex'?mask.vertices:mask.elements;if(source.length!==mask.instanceCount*perInstance)throw Error('GPU mask layout mismatch');
 const instances=[];let work=0;
 for(let i=0;i<mask.instanceCount;i++){
  let count=0;for(let j=0;j<perInstance;j++){if(source[i*perInstance+j])count+=domain==='vertex'?s.vertexAliases.offsets[j+1]-s.vertexAliases.offsets[j]:1;if(++work%batch===0)yield;}
  const ids=new Uint32Array(count);let at=0;
  for(let j=0;j<perInstance;j++){if(source[i*perInstance+j]){if(domain==='vertex'){for(let k=s.vertexAliases.offsets[j];k<s.vertexAliases.offsets[j+1];k++){ids[at++]=s.vertexAliases.members[k];if(++work%batch===0)yield;}}else ids[at++]=j;}if(++work%batch===0)yield;}
  instances.push({instance:i,ids});
 }return {domain,instances};
}
export class NativeMarquee {
 /** Call only after a marquee request. Sources are semantic model surfaces, not UI overlays. */
 static async create(host,{surfaces,sources,camera,width,height,viewport=camera.viewport,through=false,topologyForObject,isCurrent=()=>true,yieldTask,depthTolerance=0}){
  const session=new NativeMarquee(host,{camera,width,height,viewport,through,isCurrent,yieldTask,depthTolerance});
  try{
   for(const snapshot of surfaces){if(!isCurrent()||!snapshot.isCurrent())throw abort('Surface changed before marquee');const packet=selectionPacketFromDisplay(snapshot,camera);session.surfaceSnapshots.push(snapshot);session.occluders.push(host.prepare(packet));}
   for(const {snapshot,domain}of sources){if(!isCurrent()||!snapshot.isCurrent())throw abort('Source changed before marquee');const object=snapshot.packets[0].object;const ready=await topologyForObject(object);if(!ready.isCurrent()||!snapshot.isCurrent())throw abort('Topology changed before marquee');
    const topo=ready.topology,packet=selectionPacketFromDisplay(snapshot,camera),elements=domain==='edge'?topo.selection.edges:domain==='face'?topo.selection.faces:null;
    if(!['vertex','edge','face'].includes(domain))throw Error('Unknown selection domain');if(topo.vertexCount!==packet.positions.length/3)throw Error('Topology/display source mismatch');
    const p=host.prepare(packet,elements,{representatives:topo.selection.representatives});session.targets.push({p,ready,snapshot,domain,objectId:packet.objectId});}
   if(!session.current())throw abort('Marquee snapshot changed');return session;
  }catch(e){await session.dispose();throw e;}
 }
 constructor(host,options){this.host=host;Object.assign(this,options);this.occluders=[];this.surfaceSnapshots=[];this.targets=[];this.depth=null;this.disposed=false;this.running=null;this.controller=null;}
 current(){return !this.disposed&&this.host.state==='ready'&&this.isCurrent()&&this.surfaceSnapshots.every(s=>s.isCurrent())&&this.targets.every(t=>t.snapshot.isCurrent()&&t.ready.isCurrent());}
 async select(rectangle,{signal,isCurrent=()=>true}={}){
  if(this.running)throw Error('Coalesce marquee requests before calling select');const controller=new AbortController();this.controller=controller;
  const onAbort=()=>controller.abort();signal?.addEventListener('abort',onAbort,{once:true});if(signal?.aborted)controller.abort();const valid=()=>this.current()&&isCurrent()&&!controller.signal.aborted;
  const operation=(async()=>{if(!valid())throw abort('Marquee snapshot stale');if(rectangle===null)return [];
   if(!this.depth)this.depth=this.through?this.host.screen(this):this.host.renderDepth(this.occluders,this);
   const output=[];
   for(const t of this.targets){if(!valid())throw abort('Marquee changed');const job=this.host.select(t.p,this.depth,{rectangle,through:this.through,depthTolerance:this.depthTolerance,signal:controller.signal,isCurrent:valid});
    try{const mask=await job.read();const selection=await drainCooperatively(decodeMarqueeWork(mask,t.ready.topology,t.domain),{signal:controller.signal,isCurrent:valid,yieldTask:this.yieldTask});output.push({objectId:t.objectId,...selection});}finally{await job.dispose();}}
   if(!valid())throw abort('Marquee changed before result');return output;
  })();this.running=operation;
  try{return await operation;}finally{signal?.removeEventListener('abort',onAbort);if(this.running===operation)this.running=null;if(this.controller===controller)this.controller=null;}
 }
 /** Optional atomic UI adapter; latest rectangle supersedes intermediate mouse updates. */
 controllerFor({prepareCommit,commit,onError}){return new LatestSelection({run:(intent,control)=>this.select(intent.rectangle,control),prepareCommit,commit,onError});}
 async dispose(){if(this.disposed)return;this.disposed=true;this.controller?.abort();if(this.running)await this.running.catch(()=>{});if(this.depth)this.host.releaseDepth(this.depth);for(const t of this.targets)this.host.release(t.p);for(const p of this.occluders)this.host.release(p);this.targets=[];this.occluders=[];}
}
export class FrameNativeEngine {
 static async create({sharedDevice=null,format='bgra8unorm',sampleCount=1,onError=()=>{},topologyOptions=null,renderDomain='canonical',cubicWindowCapability=null,quadTopology='list',basicSpecialization='disabled',standardSpecialization='disabled'}={}){
  assertRenderDomain(renderDomain);const policies=displayPolicyOptions({quadTopology,basicSpecialization,standardSpecialization});
  const owner=sharedDevice instanceof FrameGpuDevice?sharedDevice:sharedDevice?new FrameGpuDevice(sharedDevice):await FrameGpuDevice.request();const engine=new FrameNativeEngine(owner,{renderDomain,...policies});engine.ownsOwner=!(sharedDevice instanceof FrameGpuDevice);
  try{engine.display=await FrameGpuDisplay.create(owner.device,{resourcePool:owner.pool,format,sampleCount,onError,renderDomain,cubicWindowCapability,...policies});engine.selection=await FrameGpuSelection.create(owner.device,{resourcePool:owner.pool,renderDomain});engine.printer=await FrameGpuPrinter.create(engine.display);if(topologyOptions)engine.topology=new TopologyCache(topologyOptions);return engine;}
  catch(e){await engine.dispose();throw e;}
 }
 constructor(owner,{renderDomain='canonical',...options}={}){for(const [name,value]of Object.entries(displayPolicyOptions(options)))Object.defineProperty(this,name,{value,enumerable:true});Object.defineProperty(this,'renderDomain',{value:assertRenderDomain(renderDomain),enumerable:true});this.owner=owner;this.device=owner.device;this.geometryCache=new DisplayGeometryCache();this.instanceCache=new DisplayInstanceCache();this.printerCache=new PrinterGeometryCache();this.views=new Set();this.marquees=new Set();this.disposed=false;}
 /** Preparing a colour view DOES NOT compute visibility/Connected/selection depth. */
 async prepareView(scene,camera,{width,height,viewport=[0,0,width,height],mode='solid',pixelRatio=1,include=()=>true,lighting={}}={}){
  if(this.disposed)throw Error('Native engine disposed');assertAdapterRenderDomain(this.display,this.renderDomain);assertAdapterRenderDomain(this.selection,this.renderDomain);assertAdapterRenderDomain(this.printer,this.renderDomain);
  if(scene.environment||scene.fog||scene.background?.isTexture)throw Error('Environment, fog and textured background need explicit native adapters');
  const view=cameraPacket(camera,{width,height,viewport,...lighting,relative:true});const projection0=Array.from(camera.projectionMatrix.elements),cameraWorld0=Array.from(camera.matrixWorldInverse.elements),layerMask=camera.layers?.mask;
  const snapshot=relativeDisplaySnapshot(captureDisplayScene(scene,camera,{geometryCache:this.geometryCache,instanceCache:this.instanceCache,include,adapter:o=>capturePrinterObject(o,camera,{cache:this.printerCache,mode,pixelRatio})}),view.worldOrigin);const handles=[];
  try{for(const packet of snapshot.packets)handles.push(packet.kind.startsWith('printer-')?await this.printer.prepare(packet):await this.display.prepare(packet,{pixelRatio}));
   const prepared={engine:this,camera:view,snapshot,handles,width,height,users:0,retired:false,isCurrent:()=>!this.disposed&&!prepared.retired&&snapshot.isCurrent()&&camera.projectionMatrix.elements.every((x,i)=>Object.is(x,projection0[i]))&&camera.matrixWorldInverse.elements.every((x,i)=>Object.is(x,cameraWorld0[i]))&&camera.layers?.mask===layerMask};
   if(!prepared.isCurrent())throw abort('Display changed during preparation');this.views.add(prepared);prepared.dispose=()=>{prepared.retired=true;this._freeView(prepared);};return prepared;
  }catch(e){for(const h of handles)h.owner.release(h);throw e;}
 }
 _freeView(view){if(!view.retired||view.users)return;for(const h of view.handles)h.owner.release(h);view.handles=[];this.views.delete(view);}
 async present(views,{context=null,texture=null,width=views[0]?.width,height=views[0]?.height,clearColor}={}){
  if(this.disposed||!views.length||views.some(v=>v.engine!==this||!v.isCurrent()))throw abort('Display snapshot stale');for(const v of views)v.users++;
  try{return await this.display.render({context,texture,width,height,clearColor,views,isCurrent:()=>views.every(v=>v.isCurrent())});}
  finally{for(const v of views){v.users--;this._freeView(v);}}
 }
 async environmentManager(){
  if(this.disposed)throw abort('Engine disposed');
  if(!this.environmentOpening)this.environmentOpening=FrameGpuEnvironment.create(this.owner).then(async manager=>{if(this.disposed){await manager.dispose();throw abort('Engine disposed during environment initialization');}this.environment=manager;return manager;});
  return this.environmentOpening;
 }
 async beginMarquee(options){
  if(this.disposed)throw Error('Engine disposed');if(this.openingMarquee||this.marquees.size)throw Error('Close the previous marquee session before beginning another');
  const opening=NativeMarquee.create(this.selection,{...options,topologyForObject:options.topologyForObject??(object=>{if(!this.topology)throw Error('Shared-budget topology worker must be configured');return this.topology.get(object.geometry);})});this.openingMarquee=opening;
  try{const m=await opening;if(this.disposed){await m.dispose();throw abort('Engine disposed during marquee preparation');}this.marquees.add(m);const dispose=m.dispose.bind(m);m.dispose=async()=>{await dispose();this.marquees.delete(m);};return m;}
  finally{if(this.openingMarquee===opening)this.openingMarquee=null;}
 }
 async dispose(){if(this.disposed)return;this.disposed=true;this.topology?.dispose();await this.openingMarquee?.catch(()=>{});await Promise.all([...this.marquees].map(m=>m.dispose()));this.display?.queue.dispose();await this.display?.queue.idle();await this.device.queue.onSubmittedWorkDone().catch(()=>{});for(const v of [...this.views]){v.retired=true;this._freeView(v);}this.printer?.dispose();this.selection?.dispose();await this.display?.dispose();await this.environmentOpening?.catch(()=>{});await this.environment?.dispose();if(this.ownsOwner)this.owner.dispose();}
}
