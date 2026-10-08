/** On-demand native face-marquee / nearest-edge adapters. No WebGL fallback.
 * Caller captures semantic model snapshots synchronously, before awaiting preparation.
 * This module does not switch Frame's renderer or its synchronous event handlers.
 */
import {rectangleParams} from './gpu-selection.mjs';
import {decodeMarqueeWork} from './native-engine.mjs';
import {FrameRibbonPicker,RIBBON_WGSL} from './picker-ribbon.mjs';
import {FramePickerDepth,pickerGeometryPacket} from './picker-depth.mjs';
import {FrameGpuCornerVisibility} from './native-corner.mjs';
import {drainCooperatively} from './topology-islands.mjs';
import {stampAttribute,attributeCurrent,DisplayGeometryCache,DisplayInstanceCache,captureDisplayObject,captureMaterial} from './display-packets.mjs';
import {textureState,textureStateCurrent} from './texture-policy.mjs';
import {relativeDisplayPacket} from './relative-frame.mjs';

import {assertRenderDomain,assertAdapterRenderDomain} from './render-domain.mjs';
export const EDGE_PICK_WGSL=RIBBON_WGSL;

/** Authoring proxies include raw geometry even when colour drawRange/material
 * visibility yields no display packet. Reuse the engine's existing capture caches.
 */
export function captureNativePickerGeometry(object,{geometryCache=new DisplayGeometryCache(),instanceCache=new DisplayInstanceCache()}={}){
 const snapshot=captureDisplayObject(object,{geometryCache,instanceCache,strict:false});if(snapshot.packets.length)return snapshot;
 if(!object.isMesh)fail('Raw authoring picker geometry must be a mesh drawable');
 const geometry=geometryCache.capture(object.geometry),instances=instanceCache.capture(object),material=Array.isArray(object.material)?object.material.find(Boolean):object.material;
 const packet={object,geometry,instances,material:captureMaterial(material,object,{strict:false}),kind:'triangles',start:0,count:geometry.indices?.length??geometry.vertexCount,indices:null,renderOrder:object.renderOrder??0,objectId:object.userData?.hash??object.uuid,pickerOnlyGeometry:true};
 return {...snapshot,packets:[packet],pickerDrawRange:{...object.geometry.drawRange}};
}

const abort=m=>new DOMException(m,'AbortError');
const fail=m=>{throw Error(m);};
const same=(a,b)=>a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
const id=x=>typeof x==='string'&&x.length||Number.isSafeInteger(x)?x:fail('Explicit stable object/instance ID required');
const integer=(x,name)=>Number.isSafeInteger(x)&&x>=0&&x<=0xffffffff?x:fail(name+' must be Uint32');
const matrix=x=>{const a=Array.from(x);if(a.length!==16||!a.every(Number.isFinite))fail('Finite clip/view matrix required');return a;};
function copyIdentity(identity){
 if(!identity)return identity;
 const objectId=identity.objectId,batchId=identity.batchId,instances=identity.instances?.map(q=>({instanceId:q.instanceId,sourceObjectId:q.sourceObjectId})),vertexIds=identity.vertexIds?.slice(),faceIds=identity.faceIds?.slice();
 return {...identity,instances,vertexIds,faceIds,isCurrent:()=>identity.objectId===objectId&&identity.batchId===batchId&&(!instances||identity.instances?.length===instances.length&&instances.every((q,i)=>identity.instances[i].instanceId===q.instanceId&&identity.instances[i].sourceObjectId===q.sourceObjectId))&&(!vertexIds||identity.vertexIds?.length===vertexIds.length&&same(Array.from(identity.vertexIds),Array.from(vertexIds)))&&(!faceIds||identity.faceIds?.length===faceIds.length&&same(Array.from(identity.faceIds),Array.from(faceIds)))&&(!identity.isCurrent||identity.isCurrent())};
}

/** Integrator's explicit asynchronous native host, never a THREE/WebGL facade. */
export function nativePickerHost(renderer){
 const bridge=renderer?.bridge,engine=renderer?.nativeEngine,host=engine?.selection;
 if(renderer?.isFrameNativeViewportRenderer!==true||!bridge||bridge.engine!==engine||renderer.domElement!==bridge.canvas||host?.device!==engine?.device||host?.state!=='ready'||!bridge.lease?.isCurrent())fail('Ready canonical native viewport renderer/shared selection owner required');
 const renderDomain=assertRenderDomain(engine.renderDomain??'canonical');for(const adapter of [renderer,bridge,host,engine.display])assertAdapterRenderDomain(adapter,renderDomain);
 return {renderDomain,host,engine,bridge,canvas:bridge.canvas,isCurrent:()=>renderer.isFrameNativeViewportRenderer===true&&renderer.bridge===bridge&&renderer.nativeEngine===engine&&renderer.domElement===bridge.canvas&&bridge.engine===engine&&engine.selection===host&&engine.device===host.device&&bridge.lease.isCurrent()&&[renderer,bridge,host,engine.display].every(q=>(q?.renderDomain??'canonical')===renderDomain)&&host.state==='ready'&&!bridge.disposed&&!engine.disposed};
}

/** Call INSIDE the synchronous per-view native capture, before temporary restore.
 * Stable authored/instance attributes and logical scene/view generation invalidate
 * this numeric snapshot; intentional render-only material/parent restoration does not.
 */
export function captureNativePickerView(renderer,{surfaces=[],sources=[],camera,width,height,viewport=camera.viewport,through=false,isCurrent,...options}){
 const owner=nativePickerHost(renderer);if(typeof isCurrent!=='function')fail('Explicit logical scene/view generation guard required for render-time picker capture');
 const pixelRatio=options.pixelRatio??owner.bridge.pixelRatio??1;if(pixelRatio!==1&&!options.ribbonGrid)fail('Legacy CSS ribbon grid from pickerCoordinates is required above unit pixel ratio');
 const vp=matrix(camera.viewProjection),view=Array.from(viewport),cache=new Map(),resize=owner.bridge.resizeGeneration;
 const current=()=>owner.isCurrent()&&isCurrent()&&owner.bridge.resizeGeneration===resize&&owner.canvas.width===width&&owner.canvas.height===height;
 const detach=snapshot=>{
  if(cache.has(snapshot))return cache.get(snapshot);
  if(!snapshot?.packets?.length)fail('Immutable semantic drawable packets required');
  const first=snapshot.packets[0],object=first.object,geometry=first.geometry;
  const attrs=[object.instanceMatrix,object.instanceColor,...[0,1,2,3].map(i=>geometry.source?.attributes?.['replicaCol'+i]),geometry.source?.attributes?.instanceMatrix];
  const stamps=attrs.map(stampAttribute),count=object.count,geometryCount=geometry.source?.instanceCount;
  const packets=snapshot.packets.map(source=>{const p=relativeDisplayPacket(source,camera.worldOrigin);return {...p,material:{...p.material,color:p.material.color.slice(),source:Object.freeze({depthFunc:p.material.source?.depthFunc,stencilWrite:p.material.source?.stencilWrite,alphaHash:p.material.source?.alphaHash,alphaToCoverage:p.material.source?.alphaToCoverage})}};});
  const textures=packets.map(p=>p.material.texture).filter(Boolean).map(t=>({t,state:textureState(t),version:t.version,sourceVersion:t.source?.version,image:t.image??t.source?.data})),groups=JSON.stringify(geometry.source?.groups),drawRange=JSON.stringify(geometry.source?.drawRange);
  const detached={packets,pickerDrawRange:{...(snapshot.pickerDrawRange??geometry.source?.drawRange??{start:0,count:Infinity})},isCurrent:()=>current()&&geometry.isCurrent()&&JSON.stringify(geometry.source?.groups)===groups&&JSON.stringify(geometry.source?.drawRange)===drawRange&&textures.every(q=>q.t.version===q.version&&q.t.source?.version===q.sourceVersion&&(q.t.image??q.t.source?.data)===q.image&&textureStateCurrent(q.t,q.state))&&object.count===count&&geometry.source?.instanceCount===geometryCount&&[object.instanceMatrix,object.instanceColor,...[0,1,2,3].map(i=>geometry.source?.attributes?.['replicaCol'+i]),geometry.source?.attributes?.instanceMatrix].every((a,i)=>attributeCurrent(a,stamps[i]))};
  cache.set(snapshot,detached);return detached;
 };
 return {...options,pixelRatio,surfaces:through?[]:surfaces.map(detach),sources:sources.map(b=>({...b,identity:copyIdentity(b.identity),snapshot:detach(b.snapshot),geometry:b.geometry??b.snapshot.packets[0].geometry.source})),camera:{...camera,worldOrigin:camera.worldOrigin?.slice(),viewProjection64:camera.viewProjection64?.slice(),viewProjection:new Float32Array(vp),viewport:view.slice()},width,height,viewport:view,through,isCurrent:current};
}

/** CSS/client top-left -> native canvas top-left physical pixels; no camera crop. */
export function pickerCoordinates({canvasRect,viewRect,pixelRatio=1,width,height}){
 const a=[canvasRect.x,canvasRect.y,viewRect.x,viewRect.y,viewRect.w,viewRect.h,pixelRatio,width,height];
 if(!a.every(Number.isFinite)||pixelRatio<=0||!Number.isSafeInteger(width)||!Number.isSafeInteger(height))fail('Invalid picker dimensions');
 const x=Math.round((viewRect.x-canvasRect.x)*pixelRatio),y=Math.round((viewRect.y-canvasRect.y)*pixelRatio);
 const right=Math.round((viewRect.x+viewRect.w-canvasRect.x)*pixelRatio),bottom=Math.round((viewRect.y+viewRect.h-canvasRect.y)*pixelRatio);
 const viewport=[x,y,right-x,bottom-y];rectangleParams([0,0,width,height],viewport,width,height);
 const ribbonGrid={viewport:[0,0,Math.max(1,Math.round(viewRect.w)),Math.max(1,Math.round(viewRect.h))],rankingViewport:[0,0,viewRect.w,viewRect.h],origin:[(viewRect.x-canvasRect.x)*pixelRatio,(viewRect.y-canvasRect.y)*pixelRatio],pixelRatio};
 return {width,height,viewport,pixelRatio,ribbonGrid,point:(clientX,clientY)=>[(clientX-canvasRect.x)*pixelRatio,(clientY-canvasRect.y)*pixelRatio],rectangle:box=>[(box.x0-canvasRect.x)*pixelRatio,(box.y0-canvasRect.y)*pixelRatio,(box.x1-canvasRect.x)*pixelRatio,(box.y1-canvasRect.y)*pixelRatio]};
}

/** Group authored raw edge aliases once; topology came from the existing shared-budget worker. */
export function* edgePickerTablesWork(topology,{batch=4096}={}){
 const {edges,group,vertexCount}=topology;if(!(edges instanceof Uint32Array)||edges.length%2||!(group instanceof Uint32Array)||group.length!==vertexCount)fail('Exact topology raw edges/groups required');
 const lookup=new Map(),groups=[];let work=0;
 // n*n-1 stays below 2^53; out-of-range or noninteger legacy values keep string keys.
 const numericPairs=Number.isSafeInteger(vertexCount)&&vertexCount>0&&vertexCount<=94906265;
 for(let e=0;e<edges.length/2;e++){
  const a=edges[e*2],b=edges[e*2+1];if(a>=vertexCount||b>=vertexCount)fail('Edge raw ID outside source');
  const ga=group[a],gb=group[b],lo=Math.min(ga,gb),hi=Math.max(ga,gb);
  const key=numericPairs&&Number.isInteger(lo)&&Number.isInteger(hi)&&lo>=0&&lo<vertexCount&&hi>=0&&hi<vertexCount?lo*vertexCount+hi:lo+':'+hi,rawKey=Math.min(a,b)+':'+Math.max(a,b);
  let q=lookup.get(key);if(!q){q={a,b,rawEdgeIds:[],keys:[]};lookup.set(key,q);groups.push(q);}
  q.rawEdgeIds.push(e);q.keys.push(rawKey);if(++work%batch===0)yield;
 }
 const pairs=new Uint32Array(groups.length*2);for(let i=0;i<groups.length;i++){pairs[i*2]=groups[i].a;pairs[i*2+1]=groups[i].b;if(++work%batch===0)yield;}
 return {pairs,groups};
}

function captureIdentity(identity,packet,topology,object){
 identity??={objectId:packet.objectId,batchId:object.uuid};
 const count=packet.clipMatrices.length/16,objectId=id(identity.objectId),batchId=id(identity.batchId??object.uuid);
 if(count!==1&&!identity.instances)fail('Instanced/cloner bindings require explicit stable per-occurrence identities');
 const input=identity.instances??[{instanceId:0,sourceObjectId:objectId}];if(input.length!==count)fail('Instance identity count mismatch');
 const instances=input.map((q,i)=>({localInstance:i,instanceId:id(q.instanceId),sourceObjectId:id(q.sourceObjectId??objectId)}));
 const unique=new Set(instances.map(q=>JSON.stringify([q.instanceId,q.sourceObjectId])));if(unique.size!==count)fail('Duplicate occurrence identities in one batch');
 const vertexIds=identity.vertexIds?.slice()??null,faceIds=identity.faceIds?.slice()??null;
 if(vertexIds&&(!(vertexIds instanceof Uint32Array)||vertexIds.length!==topology.vertexCount))fail('Authored raw vertex map mismatch');
 if(faceIds&&(!(faceIds instanceof Uint32Array)||faceIds.length!==topology.faceCount))fail('Authored face map mismatch');
 const current=()=>identity.objectId===objectId&&(identity.batchId??object.uuid)===batchId&&(!identity.instances||identity.instances.length===instances.length&&instances.every((q,i)=>identity.instances[i].instanceId===q.instanceId&&(identity.instances[i].sourceObjectId??objectId)===q.sourceObjectId))&&(!vertexIds||identity.vertexIds?.length===vertexIds.length&&same(Array.from(identity.vertexIds),Array.from(vertexIds)))&&(!faceIds||identity.faceIds?.length===faceIds.length&&same(Array.from(identity.faceIds),Array.from(faceIds)))&&(!identity.isCurrent||identity.isCurrent());
 return {objectId,batchId,instances,vertexIds,faceIds,isCurrent:current};
}

export class FrameNativePickers {
 static async forRenderer(renderer){const owner=nativePickerHost(renderer),p=await FrameNativePickers.create(owner.host,{display:owner.engine.display});if(!owner.isCurrent()){await p.dispose();throw abort('Native viewport owner changed during picker initialization');}return p;}
 static async create(host,{display=null}={}){
  if(host?.state!=='ready')fail('Existing ready shared FrameGpuSelection required');
  const p=new FrameNativePickers(host);
  try{p.depthOwner=await FramePickerDepth.create(host,{display});p.ribbon=await FrameRibbonPicker.create(host);p.compilation=p.ribbon.compilation;if(host.state!=='ready')throw abort('Native selection device unavailable');return p;}
  catch(e){p.depthOwner?.dispose();p.disposed=true;throw e;}
 }
 constructor(host){Object.defineProperty(this,'renderDomain',{value:assertRenderDomain(host.renderDomain??'canonical'),enumerable:true});this.host=host;this.sessions=new Set();this.disposed=false;this.opening=null;this.cornerVisibility=null;this.cornerOpening=null;}
 async cornerOwner(){
  if(this.disposed)throw abort('Native picker adapter disposed');if(this.cornerVisibility)return this.cornerVisibility;
  if(!this.cornerOpening)this.cornerOpening=FrameGpuCornerVisibility.create(this.host).then(owner=>{if(this.disposed){owner.dispose();throw abort('Native picker adapter disposed during corner initialization');}this.cornerVisibility=owner;return owner;}).finally(()=>{this.cornerOpening=null;});
  return await this.cornerOpening;
 }
 async prepare(options){
  assertAdapterRenderDomain(this.host,this.renderDomain);assertAdapterRenderDomain(this.depthOwner,this.renderDomain);assertAdapterRenderDomain(this.ribbon,this.renderDomain);if(this.disposed||this.opening||this.sessions.size||this.host.jobs.size)fail('Close the previous native picker operation first');
  const captured={...options,sources:(options.sources??[]).map(b=>({...b,geometry:b.geometry??b.snapshot.packets[0].geometry.source,identity:copyIdentity(b.identity)}))};
  const opening=NativePickerSession.create(this,captured);this.opening=opening;
  try{const s=await opening;if(this.disposed){await s.dispose();throw abort('Picker disposed during preparation');}this.sessions.add(s);return s;}finally{if(this.opening===opening)this.opening=null;}
 }
 async dispose(){if(this.disposed)return;this.disposed=true;await this.opening?.catch(()=>{});await this.cornerOpening?.catch(()=>{});await Promise.all([...this.sessions].map(s=>s.dispose()));this.cornerVisibility?.dispose();this.depthOwner?.dispose();}
}

export class NativePickerSession {
 static async create(adapter,{surfaces=[],sources=[],camera,width,height,viewport=camera.viewport,through=false,topologyForObject,topologyForGeometry,isCurrent=()=>true,yieldTask,depthTolerance=0,signal,faceDepthPolicy='geometry',pixelRatio=1,ribbonGrid=null,ribbonWidth=3*pixelRatio,selectionDomain='face',edgeQuery=true}={}){
  rectangleParams([0,0,width,height],Array.from(viewport),width,height,depthTolerance);
  if(!['geometry','display'].includes(faceDepthPolicy)||!Number.isFinite(ribbonWidth)||ribbonWidth<=0)fail('Explicit valid face depth policy and physical ribbon width required');
  if(!['vertex','edge','face'].includes(selectionDomain)||typeof edgeQuery!=='boolean')fail('Explicit native selection domain and edge-query policy required');
  if(pixelRatio!==1&&!ribbonGrid)fail('Legacy CSS ribbon grid required above unit pixel ratio');
  if(ribbonGrid){ribbonGrid={viewport:Array.from(ribbonGrid.viewport),rankingViewport:Array.from(ribbonGrid.rankingViewport),origin:Array.from(ribbonGrid.origin),pixelRatio:ribbonGrid.pixelRatio};const a=[...ribbonGrid.viewport,...ribbonGrid.rankingViewport,...ribbonGrid.origin,ribbonGrid.pixelRatio];if(!a.every(Number.isFinite)||ribbonGrid.viewport.length!==4||ribbonGrid.rankingViewport.length!==4||ribbonGrid.origin.length!==2||ribbonGrid.viewport.some(v=>!Number.isInteger(v))||ribbonGrid.viewport[0]!==0||ribbonGrid.viewport[1]!==0||ribbonGrid.viewport[2]<1||ribbonGrid.viewport[3]<1||ribbonGrid.pixelRatio!==pixelRatio||pixelRatio<=0)fail('Invalid captured legacy ribbon CSS grid');}
  const viewProjection=matrix(camera.viewProjection),s=new NativePickerSession(adapter,{width,height,viewport:Array.from(viewport),through:!!through,depthTolerance,isCurrent,yieldTask,signal,faceDepthPolicy,ribbonWidth,ribbonGrid,selectionDomain,edgeQuery});
  const camera0=Array.from(camera.viewProjection),viewport0=Array.from(camera.viewport),origin0=camera.worldOrigin?.slice(),vp640=camera.viewProjection64?.slice();
  s.guards.push(()=>same(Array.from(camera.viewProjection),camera0)&&same(Array.from(camera.viewport),viewport0)&&(!origin0||camera.worldOrigin&&same(camera.worldOrigin,origin0))&&(!vp640||camera.viewProjection64&&same(camera.viewProjection64,vp640)));
  const captured={...camera,worldOrigin:origin0?.slice(),viewProjection64:vp640?.slice(),viewProjection:new Float32Array(viewProjection),viewport:Array.from(viewport)};s.camera=captured;
  try{
   if(!s.dataCurrent())throw abort('Picker source stale before preparation');
   if(!s.through)for(const snapshot of surfaces){
    if(!snapshot.isCurrent())throw abort('Occluder snapshot stale');s.snapshots.push(snapshot);s.occluders.push(snapshot);
    const extras=snapshot.packets.map(p=>[p.material.source,p.material.source?.depthFunc,p.material.source?.stencilWrite]);s.guards.push(()=>extras.every(([m,depth,stencil])=>m?.depthFunc===depth&&m?.stencilWrite===stencil));
   }
   for(const binding of sources){
    const {snapshot}=binding;if(!snapshot?.packets?.length||!snapshot.isCurrent())throw abort('Target snapshot stale');
    s.snapshots.push(snapshot);const object=snapshot.packets[0].object;
    const geometry=binding.geometry??snapshot.packets[0].geometry.source;
    const ready=binding.ready??await (topologyForGeometry?topologyForGeometry(geometry):topologyForObject?.(object,geometry));if(!ready?.topology||!ready.isCurrent())fail('Existing shared-budget topology is required');
    if(!s.dataCurrent()||!snapshot.isCurrent())throw abort('Picker changed during topology preparation');
    const packet=pickerGeometryPacket(snapshot,captured),topology=ready.topology;
    if(topology.vertexCount!==packet.positions.length/3)fail('Topology/source vertex count mismatch');
    const identity=captureIdentity(binding.identity,packet,topology,object),key=JSON.stringify([identity.objectId,identity.batchId]);
    if(s.bindingKeys.has(key))fail('Duplicate source object/batch identity');s.bindingKeys.add(key);s.guards.push(ready.isCurrent,identity.isCurrent);
    const tables=edgeQuery?await drainCooperatively(edgePickerTablesWork(topology),{signal,isCurrent:()=>s.dataCurrent(),yieldTask}):null;
    const ribbonOrder=binding.ribbonOrder??s.targets.length;if(!Number.isSafeInteger(ribbonOrder)||ribbonOrder<0)fail('Stable ribbon draw order required');
    const elements=selectionDomain==='edge'?topology.selection.edges:selectionDomain==='face'?topology.selection.faces:null;
    const p=s.host.prepare(packet,elements,{representatives:topology.selection.representatives});
    const target={p,topology,identity,tables,object,pickPacket:packet,ribbonOrder,edgeBuffer:null};s.targets.push(target);
    if(edgeQuery)target.edgeBuffer=s.host._storage(tables.pairs,'Frame immutable logical pick edges');
   }
   if(!s.dataCurrent())throw abort('Picker snapshot changed');s.epoch=s.host.epoch;return s;
  }catch(e){await s.dispose();throw e;}
 }
 constructor(adapter,options){this.adapter=adapter;this.host=adapter.host;Object.assign(this,options);this.snapshots=[];this.guards=[];this.occluders=[];this.targets=[];this.bindingKeys=new Set();this.depths=new Map();this.camera=null;this.disposed=false;this.running=null;this.controller=null;this.epoch=this.host.epoch;}
 dataCurrent(){return !this.adapter.disposed&&this.host.state==='ready'&&!this.signal?.aborted&&this.isCurrent()&&this.snapshots.every(s=>s.isCurrent())&&this.guards.every(f=>f());}
 current(){return !this.disposed&&this.dataCurrent()&&this.host.epoch===this.epoch;}
 async _depth(policy){
  if(this.depths.has(policy))return this.depths.get(policy).depth;
  const dimensions=policy==='edge'&&this.ribbonGrid?{width:this.ribbonGrid.viewport[2],height:this.ribbonGrid.viewport[3],viewport:this.ribbonGrid.viewport}:this;
  if(this.through){const depth=this.host.screen(dimensions);this.depths.set(policy,{depth});return depth;}
  if(this.host.jobs.size)fail('Coalesce native depth/ribbon/marquee operations');
  let prepared,depth,pending;const reservation={cancel:()=>this.controller?.abort(),dispose:async()=>{reservation.cancel();await pending?.catch(()=>{});}};this.host.jobs.add(reservation);
  pending=(async()=>{
   try{prepared=await this.adapter.depthOwner.prepare(this.occluders,this.camera,policy);if(!this.current()||this.controller?.signal.aborted)throw abort('Picker changed during depth pipeline preparation');
    depth=this.adapter.depthOwner.render(prepared,dimensions);if(!this.current())throw abort('Picker changed before depth result');this.depths.set(policy,{prepared,depth});return depth;
   }catch(e){if(depth)this.host.releaseDepth(depth);this.adapter.depthOwner.releasePrepared(prepared);throw e;}
   finally{this.host.jobs.delete(reservation);}
  })();return await pending;
 }
 async _run(run,{signal,isCurrent=()=>true}={}){
  if(this.running||this.host.jobs.size)fail('Coalesce native picker queries before submission');
  const controller=new AbortController(),onAbort=()=>controller.abort();this.controller=controller;
  signal?.addEventListener('abort',onAbort,{once:true});if(signal?.aborted)controller.abort();
  const valid=()=>this.current()&&!controller.signal.aborted&&isCurrent();
  const operation=(async()=>{if(!valid())throw abort('Native picker source stale');const result=await run(valid,controller.signal);if(!valid())throw abort('Picker changed before result');return result;})();this.running=operation;
  try{return await operation;}finally{signal?.removeEventListener('abort',onAbort);if(this.running===operation)this.running=null;if(this.controller===controller)this.controller=null;}
 }
 /** Replacement for visible-face marquee; preserves installed ALL-corner semantics. */
 visibleFaces(rectangle,control={}){
  if(this.selectionDomain!=='face')fail('visibleFaces requires a face-domain session');
  return this.marquee(rectangle,control);
 }
 /** On-demand GPU vertex masks and all-corner CSR edge/face masks. Raw aliases
  * are expanded cooperatively, with explicit authored/occurrence identities. */
 marquee(rectangle,control={}){
  const domain=this.selectionDomain;
  const normalized=rectangleParams(Array.from(rectangle),this.viewport,this.width,this.height,this.depthTolerance).rectangle;
  return this._run(async(valid,signal)=>{
   if(!this.targets.length)return [];const exactCorner=!this.through&&this.faceDepthPolicy==='geometry';if(exactCorner&&this.depthTolerance!==0)fail('Exact corner geometry requires zero depth tolerance');
   const corner=exactCorner?await this.adapter.cornerOwner():null,depth=corner?null:await this._depth(this.faceDepthPolicy),output=[];if(!valid())throw abort('Face source stale after visibility preparation');
   const occluderPackets=corner?this.occluders.map(snapshot=>pickerGeometryPacket(snapshot,this.camera)):null;
   for(const t of this.targets){
    const job=corner?corner.select(t.p,{packet:t.pickPacket,occluderPackets,representatives:t.topology.selection.representatives,rectangle:normalized,viewport:this.viewport,width:this.width,height:this.height,isCurrent:valid,signal}):this.host.select(t.p,depth,{rectangle:normalized,through:this.through,depthTolerance:this.depthTolerance,isCurrent:valid,signal});
    try{const mask=await job.read(),decoded=await drainCooperatively(decodeMarqueeWork(mask,t.topology,domain),{signal,isCurrent:valid,yieldTask:this.yieldTask});
     for(const row of decoded.instances){const identity=t.identity.instances[row.instance],map=domain==='vertex'?t.identity.vertexIds:domain==='face'?t.identity.faceIds:null,ids=map?Uint32Array.from(row.ids,i=>map[i]):row.ids,keys=[];
      if(domain==='edge')for(const i of row.ids){const a=t.topology.edges[i*2],b=t.topology.edges[i*2+1],u=t.identity.vertexIds?.[a]??a,v=t.identity.vertexIds?.[b]??b;keys.push(Math.min(u,v)+':'+Math.max(u,v));}
      output.push({objectId:t.identity.objectId,batchId:t.identity.batchId,...identity,rawIds:row.ids,ids,keys,domain,isCurrent:()=>this.dataCurrent()});}
    }finally{await job.dispose();}
   }return output;
  },control);
 }
 /** Legacy visible-ribbon admission, then unconstrained nearest edge distance. */
 pickEdgeNear(point,{radius=20,signal,isCurrent=()=>true}={}){
  if(!this.edgeQuery)fail('Ribbon queries were not prepared for this marquee session');
  const pointer=Array.from(point);if(pointer.length!==2||!pointer.every(Number.isFinite)||!Number.isFinite(radius)||radius<0||radius>Math.max(this.width,this.height))fail('Invalid physical pointer/radius');
  return this._run(async(valid,signal)=>{
   const [x,y,w,h]=this.viewport;if(pointer[0]<x||pointer[0]>=x+w||pointer[1]<y||pointer[1]>=y+h||!this.targets.length)return null;
   const depth=await this._depth('edge');if(!valid())throw abort('Edge source stale after depth preparation');
   const grid=this.ribbonGrid,queryPoint=grid?pointer.map((v,i)=>(v-grid.origin[i])/grid.pixelRatio):pointer,queryRadius=grid?radius/grid.pixelRatio:radius;
   const q=await this.adapter.ribbon.pick(this.targets,depth,queryPoint,{radius:queryRadius,width:grid?this.ribbonWidth/grid.pixelRatio:this.ribbonWidth,through:this.through,tolerance:this.depthTolerance,signal,isCurrent:valid,rankingViewport:grid?.rankingViewport??depth.viewport});if(!q)return null;
   if(grid){q.distanceSquared*=grid.pixelRatio*grid.pixelRatio;q.screen=q.screen.map((v,i)=>grid.origin[i]+v*grid.pixelRatio);}
   const t=q.target,localInstance=Math.floor(q.occurrence/t.tables.groups.length),edgeId=q.occurrence%t.tables.groups.length,edge=t.tables.groups[edgeId],identity=t.identity.instances[localInstance],v=t.identity.vertexIds;
   const keys=edge.keys.map(k=>{const [a,b]=k.split(':').map(Number),u=v?v[a]:a,z=v?v[b]:b;return Math.min(u,z)+':'+Math.max(u,z);});
   return {objectId:t.identity.objectId,batchId:t.identity.batchId,...identity,mesh:t.object,domain:'edge',edgeId,rawEdge:[edge.a,edge.b],edge:[v?v[edge.a]:edge.a,v?v[edge.b]:edge.b,keys[0]],keys,rawEdgeIds:edge.rawEdgeIds.slice(),distanceSquared:q.distanceSquared,depth:q.depth,t:q.t,interpolationClamped:q.interpolationClamped,screen:q.screen,isCurrent:()=>this.dataCurrent()};
  },{signal,isCurrent});
 }

 async dispose(){
  if(this.disposed)return;this.disposed=true;this.controller?.abort();if(this.running)await this.running.catch(()=>{});
  for(const {prepared,depth}of this.depths.values()){this.host.releaseDepth(depth);this.adapter.depthOwner.releasePrepared(prepared);}this.depths.clear();for(const t of this.targets){t.edgeBuffer?.destroy();this.host.release(t.p);}this.targets=[];this.occluders=[];this.adapter.sessions.delete(this);
 }
}

/** Promise/generator adapter; synchronous frameDrainSelectionWork MUST NOT consume it. */
export function createNativeVisibleFacePicker(session){
 const pick=(options,control)=>session.visibleFaces(options.rectangle,control);
 pick.asynchronous=true;pick.steps=function*(options,control){const result=yield pick(options,control);if(result===undefined)fail('Native face picker steps require an asynchronous drain');return result;};return pick;
}

/** Latest pointer intent. Capture is synchronous; preparation/readback can await.
 * Uses one active request and one replaceable queued request. No per-frame work.
 * Click callers must await a click intent before running object fallback/Connected.
 */
export class LatestNativePickerRequest {
 constructor({adapter,capture,commit,onError=()=>{}}){if(typeof capture!=='function'||typeof commit!=='function')fail('Picker capture/commit callbacks required');Object.assign(this,{adapter,capture,commit,onError});this.generation=0;this.pending=null;this.active=null;this.disposed=false;this.idlePromise=Promise.resolve();}
 request(intent){
  if(this.disposed)return Promise.reject(abort('Picker controller disposed'));
  if(!['edge','face'].includes(intent?.domain))return Promise.reject(Error('Native picker intent must be edge or face'));
  const generation=++this.generation,immutable={...intent,point:intent.point&&Array.from(intent.point),rectangle:intent.rectangle&&Array.from(intent.rectangle)};
  // Synchronous callback must snapshot actual drawables, source/selection generation,
  // camera matrices, viewport and identity tables before any render-state restoration.
  let captured;try{captured=this.capture(immutable);}catch(e){return Promise.reject(e);}if(captured?.then)fail('Native picker capture must be synchronous');
  this.active?.controller.abort();if(this.pending)this.pending.reject(abort('Picker request superseded before start'));
  const promise=new Promise((resolve,reject)=>{this.pending={generation,intent:immutable,captured,resolve,reject};});
  if(!this.active)this._pump();return promise;
 }
 _pump(){
  if(this.disposed||this.active||!this.pending)return;
  const q=this.pending;this.pending=null;const controller=new AbortController();this.active={q,controller};
  const valid=()=>!this.disposed&&q.generation===this.generation&&!controller.signal.aborted;
  this.idlePromise=(async()=>{let session;
   try{session=await this.adapter.prepare({...q.captured,signal:controller.signal});
    const result=q.intent.domain==='face'?await session.visibleFaces(q.intent.rectangle,{signal:controller.signal,isCurrent:valid}):await session.pickEdgeNear(q.intent.point,{radius:q.intent.radius,signal:controller.signal,isCurrent:valid});
    if(!valid()||!session.dataCurrent())throw abort('Native picker intent changed before commit');this.commit(result,q.intent);q.resolve(result);
   }catch(e){q.reject(e);if(e.name!=='AbortError')this.onError(e);}
   finally{await session?.dispose();this.active=null;this._pump();}
  })();
 }
 invalidate(){this.generation++;this.active?.controller.abort();if(this.pending){this.pending.reject(abort('Picker intent invalidated'));this.pending=null;}}
 async dispose(){if(this.disposed)return;this.disposed=true;this.invalidate();await this.idlePromise;}
}
