/**
 * Frame WebGPU migration: shared-device depth and per-vertex selection.
 * No WebGL fallback; no automatic per-frame selection; no geometric source mutation.
 * Screen policy: one single-sample depth texel, all vertices inside the rectangle.
 * This module is NOT a replacement for the complete Frame display renderer yet.
 */
import {assertRenderDomain,assertAdapterRenderDomain,renderDomainRect,renderDomainFrontFace,renderDomainWGSL} from './render-domain.mjs';
export const DEPTH_WGSL = /* wgsl */ `
@group(0) @binding(0) var<storage, read> positions: array<f32>;
@group(0) @binding(1) var<storage, read> clipMatrices: array<mat4x4<f32>>;
@vertex fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32)
  -> @builtin(position) vec4f {
  let p = v * 3u;
  return clipMatrices[i] * vec4f(positions[p], positions[p+1u], positions[p+2u], 1.0);
}
`;

export const VERTEX_WGSL = /* wgsl */ `
struct Params {
  viewport: vec4f,
  rectangle: vec4f,
  counts: vec4u, // source vertices, instances, output vertices, through
  options: vec4f // depth tolerance; dispatch row width; reserved
}
@group(0) @binding(0) var<storage, read> positions: array<f32>;
@group(0) @binding(1) var<storage, read> clipMatrices: array<mat4x4<f32>>;
@group(0) @binding(2) var depth: texture_depth_2d;
@group(0) @binding(3) var<storage, read_write> mask: array<u32>;
@group(0) @binding(4) var<uniform> params: Params;
@group(0) @binding(5) var<storage, read> representatives: array<u32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) tid: vec3u) {
  let rowWidth = u32(params.options.y);
  if (params.counts.z == 0u || rowWidth == 0u) { return; }
  if (tid.y > (params.counts.z - 1u) / rowWidth) { return; }
  let base = tid.y * rowWidth;
  if (tid.x >= params.counts.z - base) { return; }
  let id = base + tid.x;
  mask[id] = 0u;
  let instance = id / params.counts.x;
  var v = id % params.counts.x;
  if (params.options.z > 0.5) { v = representatives[v]; }
  let p = v * 3u;
  let c = clipMatrices[instance] * vec4f(positions[p], positions[p+1u], positions[p+2u], 1.0);
  if (!(c.w > 0.0)) { return; }
  let n = c.xyz / c.w;
  if (!(all(n.xy >= vec2f(-1.0)) && all(n.xy <= vec2f(1.0)) && n.z >= 0.0 && n.z <= 1.0)) { return; }
  let s = params.viewport.xy + vec2f(n.x * 0.5 + 0.5, 0.5 - n.y * 0.5) * params.viewport.zw;
  if (!(all(s >= params.rectangle.xy) && all(s <= params.rectangle.zw))) { return; }
  // Raster viewport is half-open. A point on its right/bottom edge has no sample.
  if (!(all(s >= params.viewport.xy) && all(s < params.viewport.xy + params.viewport.zw))) { return; }
  if (params.counts.w != 0u) { mask[id] = 1u; return; }
  let pixel = vec2i(floor(s));
  let size = vec2i(textureDimensions(depth));
  if (any(pixel < vec2i(0)) || any(pixel >= size)) { return; }
  let closest = textureLoad(depth, pixel, 0);
  mask[id] = select(0u, 1u, n.z <= closest + params.options.x);
}
`;

export const ELEMENT_WGSL = /* wgsl */ `
struct Params { counts: vec4u } // vertices/instance, elements/instance, total elements, dispatch row width
@group(0) @binding(0) var<storage, read> vertexMask: array<u32>;
@group(0) @binding(1) var<storage, read> offsets: array<u32>;
@group(0) @binding(2) var<storage, read> indices: array<u32>;
@group(0) @binding(3) var<storage, read_write> elementMask: array<u32>;
@group(0) @binding(4) var<uniform> params: Params;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) tid: vec3u) {
  let rowWidth = params.counts.w;
  if (params.counts.z == 0u || rowWidth == 0u) { return; }
  if (tid.y > (params.counts.z - 1u) / rowWidth) { return; }
  let base = tid.y * rowWidth;
  if (tid.x >= params.counts.z - base) { return; }
  let id = base + tid.x;
  let instance = id / params.counts.y;
  let element = id % params.counts.y;
  let begin = offsets[element];
  let end = offsets[element + 1u];
  var accepted = end > begin;
  for (var j = begin; j < end; j++) {
    if (vertexMask[instance * params.counts.x + indices[j]] == 0u) { accepted = false; break; }
  }
  elementMask[id] = select(0u, 1u, accepted);
}
`;

export function selectionDepthShader(renderDomain='canonical'){
 if(assertRenderDomain(renderDomain)==='canonical')return DEPTH_WGSL;
 return DEPTH_WGSL.replace('return clipMatrices[i] * vec4f(positions[p], positions[p+1u], positions[p+2u], 1.0);','return frameRenderPosition(clipMatrices[i] * vec4f(positions[p], positions[p+1u], positions[p+2u], 1.0));')+renderDomainWGSL(renderDomain);
}
export function selectionVertexShader(renderDomain='canonical'){
 if(assertRenderDomain(renderDomain)==='canonical')return VERTEX_WGSL;
 return VERTEX_WGSL.replace('textureLoad(depth, pixel, 0)','textureLoad(depth, frameRenderDepthPixel(pixel,size.y), 0)')+renderDomainWGSL(renderDomain);
}

const U32_MAX = 0xffffffff;
export function dispatchShape(count, limit) {
  if(!Number.isSafeInteger(count)||count<0||count>0xffffffff||!Number.isSafeInteger(limit)||limit<1)throw Error('Invalid dispatch size');
  const total=Math.ceil(count/64),x=Math.min(total,limit,65535),y=x?Math.ceil(total/x):0;
  if(y>limit)throw Error('Dispatch exceeds device workgroup dimensions');
  return {x,y,rowWidth:x*64};
}
const fail = message => { throw new Error(message); };
const abort = message => new DOMException(message, 'AbortError');
const finite = (x, label) => Number.isFinite(x) || fail(`${label}: finite number required`);
const integer = (x, label, min = 0) => (Number.isSafeInteger(x) && x >= min && x <= U32_MAX) || fail(`${label}: integer out of range`);
export const IDENTITY = Object.freeze([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);

/** Column-major multiplication in JS double precision, no input mutation. */
export function multiply4(a, b) {
  if (a.length !== 16 || b.length !== 16) fail('4x4 matrices required');
  const c = new Float64Array(16);
  for (let j=0;j<4;j++) for (let i=0;i<4;i++) {
    let s=0; for (let k=0;k<4;k++) s+=a[k*4+i]*b[j*4+k]; c[j*4+i]=s;
  }
  return c;
}
/** Converts a legacy [-w,+w] clip Z to WebGPU [0,+w], exactly once. */
export function webgpuProjection(projection, convention) {
  if (!['webgl','webgpu'].includes(convention)) fail('Explicit projection convention required');
  const a = new Float64Array(projection);
  if (a.length!==16 || !Array.from(a).every(Number.isFinite)) fail('Invalid projection');
  if (convention==='webgl') for(let col=0;col<4;col++) a[col*4+2]=(a[col*4+2]+a[col*4+3])*0.5;
  return a;
}
export function validatePacket(packet) {
  const {positions, clipMatrices, indices=null} = packet;
  if (!(positions instanceof Float32Array) || positions.length%3) fail('positions must be packed Float32 xyz');
  if (!(clipMatrices instanceof Float32Array) || clipMatrices.length%16) fail('clipMatrices must be packed Float32 mat4');
  for (const v of positions) finite(v,'position');
  for (const v of clipMatrices) finite(v,'clip matrix');
  const vertexCount=positions.length/3, instanceCount=clipMatrices.length/16;
  integer(vertexCount,'vertex count');integer(instanceCount,'instance count');
  integer(vertexCount*instanceCount,'occurrence count');
  if (indices!==null && !(indices instanceof Uint16Array || indices instanceof Uint32Array)) fail('indices must be Uint16 or Uint32');
  if (indices) for (const v of indices) if(v>=vertexCount) fail('Triangle index outside positions');
  const total=indices?indices.length:vertexCount;
  const ranges=packet.ranges??[{start:0,count:total,cullMode:'none'}];
  const instanceRanges=packet.instanceRanges??[{start:0,count:instanceCount,frontFace:'ccw'}];
  let nextInstance=0;
  for(const r of instanceRanges){integer(r.start,'instance range start');integer(r.count,'instance range count');if(r.start!==nextInstance||r.start+r.count>instanceCount||!['ccw','cw'].includes(r.frontFace))fail('Invalid instance ranges');nextInstance+=r.count;}
  if(nextInstance!==instanceCount)fail('Instance ranges must partition occurrences');
  for (const r of ranges) {
    integer(r.start,'range start');integer(r.count,'range count');
    if(!['none','front','back'].includes(r.cullMode??'none'))fail('Unsupported culling');
    if(r.start+r.count>total || r.count%3 || r.start%3) fail('Triangle ranges must be aligned and in bounds');
  }
  return {vertexCount, instanceCount, occurrenceCount:vertexCount*instanceCount, indices, ranges:ranges.map(r=>({...r})), instanceRanges:instanceRanges.map(r=>({...r}))};
}
export function validateElements(elements, vertexCount) {
  if (!elements) return 0;
  const {offsets, indices}=elements;
  if(!(offsets instanceof Uint32Array) || !(indices instanceof Uint32Array) || offsets.length<1) fail('CSR Uint32 offsets/indices required');
  if(offsets[0]!==0 || offsets.at(-1)!==indices.length) fail('CSR endpoints mismatch');
  for(let i=1;i<offsets.length;i++) if(offsets[i]<offsets[i-1]) fail('CSR offsets not monotone');
  for(const v of indices) if(v>=vertexCount) fail('Element vertex outside positions');
  return offsets.length-1;
}
export function rectangleParams(rectangle, viewport, width, height, depthTolerance=0) {
  if(!Array.isArray(rectangle)||rectangle.length!==4||!Array.isArray(viewport)||viewport.length!==4) fail('rectangle and viewport must have four entries');
  [...rectangle,...viewport,depthTolerance].forEach(v=>finite(v,'viewport input'));
  integer(width,'width',1);integer(height,'height',1);
  if(viewport.some(v=>!Number.isInteger(v))||viewport[2]<=0||viewport[3]<=0||viewport[0]<0||viewport[1]<0||viewport[0]+viewport[2]>width||viewport[1]+viewport[3]>height) fail('Viewport must fit the depth texture on integer pixels');
  if(depthTolerance<0||depthTolerance>1e-3) fail('Depth tolerance outside explicit supported range [0, 0.001]');
  return {rectangle:[Math.min(rectangle[0],rectangle[2]),Math.min(rectangle[1],rectangle[3]),Math.max(rectangle[0],rectangle[2]),Math.max(rectangle[1],rectangle[3])],viewport:[...viewport],depthTolerance};
}

/**
 * Host for a SINGLE shared GPUDevice. Rendering outside selection may use the same device.
 * Source data is validated/uploaded once on prepare(), not for each mouse movement.
 * Source replacement requires release()/prepare(); automatic invalidation is caller-owned.
 */
export class FrameGpuSelection {
  static async create(device, options = {}) {
    const host = new FrameGpuSelection(device, options);
    try { await host._init(); return host; } catch(e) { host.dispose(); throw e; }
  }
  constructor(device, {resourcePool = null,renderDomain='canonical'} = {}) {
    Object.defineProperty(this,'renderDomain',{value:assertRenderDomain(renderDomain),enumerable:true});
    if (resourcePool && resourcePool.device !== device) throw Error("Selection pool must use the shared device");
    this.resourcePool = resourcePool;
    if(!device?.createBuffer||!device?.queue) fail('A real shared GPUDevice is required');
    this.device=device;this.state='initializing';this.prepared=new Set();this.jobs=new Set();this.epoch=0;
    this.sharedBuffers=new Map();this.ownedTextures=new Set();this.emptyDepth=null;this.serial=0;this.lostInfo=null;
    device.lost.then(info=>{if(this.state!=='disposed'){this.state='lost';this.lostInfo=info;this.epoch++;for(const job of this.jobs){job.cancel();job.dispose?.();}}});
  }
  async _init() {
    const d=this.device;d.pushErrorScope('validation');
    let problem=null;
    try {
      const stages=[['depth',selectionDepthShader(this.renderDomain)],['vertex',selectionVertexShader(this.renderDomain)],['element',ELEMENT_WGSL]];
      const modules={};this.compilation=[];
      for(const [name,code] of stages){
        const module=d.createShaderModule({label:`Frame ${name}`,code});
        const info=await module.getCompilationInfo();
        this.compilation.push({name,messages:[...info.messages].map(m=>({type:m.type,message:m.message,line:m.lineNum,column:m.linePos}))});
        if(info.messages.some(m=>m.type==='error'))fail(`WGSL ${name}: ${info.messages.filter(m=>m.type==='error').map(m=>m.message).join('; ')}`);
        modules[name]=module;
      }
      this.depthPipelines=new Map();
      // A single shared explicit layout makes a packet binding reusable for every side policy.
      this.depthLayout=d.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}},{binding:1,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}}]});
      const layout=d.createPipelineLayout({bindGroupLayouts:[this.depthLayout]});
      for(const cullMode of ['none','back','front'])for(const frontFace of ['ccw','cw'])
        this.depthPipelines.set(cullMode+':'+frontFace,await d.createRenderPipelineAsync({label:'Frame immutable occlusion depth '+cullMode+':'+frontFace,layout,vertex:{module:modules.depth,entryPoint:'vs'},primitive:{topology:'triangle-list',cullMode,frontFace:renderDomainFrontFace(frontFace,this.renderDomain)},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'less-equal'}}));
      this.vertexPipeline=await d.createComputePipelineAsync({label:'Frame all raw vertices, no pixel ID collisions',layout:'auto',compute:{module:modules.vertex,entryPoint:'main'}});
      this.elementPipeline=await d.createComputePipelineAsync({label:'Frame ALL vertices conjunction',layout:'auto',compute:{module:modules.element,entryPoint:'main'}});
    } catch(e) {problem=e;}
    const error=await d.popErrorScope();
    if(problem)throw problem;if(error)fail(error.message);
    if(this.state==='lost'||this.state==='disposed')fail('GPU device unavailable during initialization');
    this.state='ready';
  }
  _ready() {if(this.state!=='ready')fail(`WebGPU selection is ${this.state}`);}
  _buffer(data,usage,label) {
    const bytes=Math.max(4,Math.ceil(data.byteLength/4)*4),limit=this.device.limits.maxBufferSize;
    if(bytes>limit)fail(`${label}: exceeds GPU maxBufferSize; explicit batching required`);
    const buffer=this.device.createBuffer({label,size:bytes,usage,mappedAtCreation:true});
    try {new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(data.buffer,data.byteOffset,data.byteLength));buffer.unmap();return buffer;} catch(error){buffer.destroy();throw error;}
  }
  _storage(data,label,minBytes=4) {
    if(data.byteLength<minBytes){const padded=new Uint8Array(minBytes);padded.set(new Uint8Array(data.buffer,data.byteOffset,data.byteLength));data=padded;}
    if(Math.max(4,data.byteLength)>this.device.limits.maxStorageBufferBindingSize)fail(`${label}: exceeds storage binding limit; explicit batching required`);
    return this._buffer(data,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,label);
  }
  _borrow(data, usage, label) {
    if (this.resourcePool) return this.resourcePool.borrow(data, usage === GPUBufferUsage.STORAGE ? usage | GPUBufferUsage.COPY_DST : usage, label);
    let r=this.sharedBuffers.get(data);
    if(r){if(r.usage!==usage)fail('Shared upload usage mismatch');r.refs++;return r;}
    const buffer=usage===GPUBufferUsage.STORAGE?this._storage(data,label):this._buffer(data,usage,label);
    r={data,usage,buffer,refs:1};this.sharedBuffers.set(data,r);return r;
  }
  _return(r){if(this.resourcePool){this.resourcePool.release(r);return;}if(--r.refs===0){r.buffer.destroy();this.sharedBuffers.delete(r.data);}}
  prepare(packet, elements=null, {representatives=null}={}) {
    this._ready();const sourceInfo=validatePacket(packet);if(representatives!==null&&!(representatives instanceof Uint32Array))fail('Representative raw IDs must be Uint32');
    if(representatives)for(const id of representatives)if(id>=sourceInfo.vertexCount)fail('Representative outside geometry');
    const vertexCount=representatives?.length??sourceInfo.vertexCount;integer(vertexCount*sourceInfo.instanceCount,'logical vertex occurrences');
    const info={...sourceInfo,sourceVertexCount:sourceInfo.vertexCount,vertexCount,occurrenceCount:vertexCount*sourceInfo.instanceCount},elementCount=validateElements(elements,vertexCount);
    integer(info.instanceCount*elementCount,'element occurrences');
    dispatchShape(info.occurrenceCount,this.device.limits.maxComputeWorkgroupsPerDimension);
    dispatchShape(info.instanceCount*elementCount,this.device.limits.maxComputeWorkgroupsPerDimension);
    const owned=[],borrowed=[]; const add=b=>(owned.push(b),b),borrow=(data,usage,label)=>{const r=this._borrow(data,usage,label);borrowed.push(r);return r.buffer;};
    try {
      const p={owner:this,...info,elementCount,released:false,positions:borrow(packet.positions,GPUBufferUsage.STORAGE,'Frame positions'),matrices:add(this._storage(packet.clipMatrices,'Frame per-instance clip matrices',64)),owned,borrowed};
      if(info.indices)p.indexBuffer=borrow(info.indices,GPUBufferUsage.INDEX,'Frame indices');
      p.indexFormat=info.indices instanceof Uint16Array?'uint16':'uint32';
      if(elements){p.offsets=add(this._storage(elements.offsets,'Frame CSR offsets'));p.elements=add(this._storage(elements.indices,'Frame CSR indices'));}
      p.depthBind=this.device.createBindGroup({layout:this.depthLayout,entries:[{binding:0,resource:{buffer:p.positions}},{binding:1,resource:{buffer:p.matrices}}]});
      p.representatives=add(this._storage(representatives??new Uint32Array(1),'Frame logical representative IDs'));p.hasRepresentatives=representatives!==null;
      this.prepared.add(p);return p;
    } catch(e) {for(const b of owned)b.destroy();for(const r of borrowed)this._return(r);throw e;}
  }
  release(p) {
    if(p?.owner!==this||p.released)return;
    p.released=true;this.epoch++;for(const b of p.owned)b.destroy();for(const r of p.borrowed)this._return(r);this.prepared.delete(p);
  }
  invalidate(){this.epoch++;for(const job of this.jobs)job.cancel();}
  /** Depth is refreshed only by an explicit call, never automatically every animation frame. */
  renderDepth(packets, {width,height,viewport=[0,0,width,height]}={}) {
    this._ready();rectangleParams([0,0,width,height],viewport,width,height);
    const d=this.device;
    if(width>d.limits.maxTextureDimension2D||height>d.limits.maxTextureDimension2D)fail('Depth dimensions exceed GPU limits');
    for(const p of packets)if(p?.owner!==this||p.released)fail('Invalid occluder packet');
    const texture=d.createTexture({label:'Frame immutable selection depth',size:[width,height],format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
    try {
      const encoder=d.createCommandEncoder({label:'Frame selection depth'});
      const pass=encoder.beginRenderPass({colorAttachments:[],depthStencilAttachment:{view:texture.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
      const rasterViewport=renderDomainRect(viewport,height,this.renderDomain);pass.setViewport(...rasterViewport,0,1);pass.setScissorRect(...rasterViewport);
      for(const p of packets){if(!p.instanceCount)continue;pass.setBindGroup(0,p.depthBind);if(p.indexBuffer)pass.setIndexBuffer(p.indexBuffer,p.indexFormat);
        for(const r of p.ranges)for(const ir of p.instanceRanges)if(r.count&&ir.count){pass.setPipeline(this.depthPipelines.get((r.cullMode??'none')+':'+ir.frontFace));if(p.indexBuffer)pass.drawIndexed(r.count,ir.count,r.start,0,ir.start);else pass.draw(r.count,ir.count,r.start,ir.start);}}
      pass.end();d.queue.submit([encoder.finish()]);
      const depth={owner:this,renderDomain:this.renderDomain,texture,width,height,viewport:[...viewport],epoch:this.epoch,disposed:false};this.ownedTextures.add(depth);return depth;
    }catch(e){texture.destroy();throw e;}
  }
  /** Wire/isoparms supplies only a viewport; no scene depth pass or visibility work is needed. */
  screen({width,height,viewport=[0,0,width,height]}={}) {
    this._ready();rectangleParams([0,0,width,height],viewport,width,height);
    if(!this.emptyDepth)this.emptyDepth=this.device.createTexture({label:'Frame unreferenced through-mode binding',size:[1,1],format:'depth32float',usage:GPUTextureUsage.TEXTURE_BINDING});
    return {renderDomain:this.renderDomain,texture:this.emptyDepth,width,height,viewport:[...viewport],epoch:this.epoch,disposed:false,throughOnly:true};
  }
  releaseDepth(depth){if(depth?.owner!==this||depth.disposed)return;depth.disposed=true;depth.texture.destroy();this.ownedTextures.delete(depth);}
  /**
   * Shared renderer depth is also accepted: {texture,width,height,viewport,epoch,disposed:false}.
   * Must be depth32float, sampleCount=1, no reverse Z; caller promises it is the correct view.
   * Cancellation invalidates output, not GPU instructions already in flight.
   */
  select(p, depth, {rectangle,through=false,depthTolerance=0,isCurrent=()=>true,signal=null}={}) {
    this._ready();if(p?.owner!==this||p.released)fail('Invalid selection packet');
    if(this.jobs.size)fail('One pending selection per host; coalesce mouse requests before submit');
    if(!depth?.texture||depth.disposed||depth.epoch!==this.epoch)fail('Depth snapshot is stale');
    assertAdapterRenderDomain(depth,this.renderDomain);
    if(depth.throughOnly&&!through)fail('A real occlusion depth pass is required in solid modes');
    const limits=this.device.limits;
    const opts=rectangleParams(rectangle,depth.viewport,depth.width,depth.height,depthTolerance);
    const vbytes=Math.max(4,p.occurrenceCount*4),ebytes=Math.max(4,p.elementCount*p.instanceCount*4);
    if(Math.max(vbytes,ebytes)>limits.maxStorageBufferBindingSize)fail('Selection result exceeds binding limit; batch required');
    if(signal?.aborted)throw abort('Selection cancelled before submit');
    if(!isCurrent())throw abort('Selection source is stale before submit');
    const d=this.device,owned=[],add=b=>(owned.push(b),b),epoch=this.epoch;
    const vd=dispatchShape(p.occurrenceCount,limits.maxComputeWorkgroupsPerDimension),ed=dispatchShape(p.elementCount*p.instanceCount,limits.maxComputeWorkgroupsPerDimension);
    let cancelled=false,readPromise=null,freed=false,settle=null;
    const isValid=()=>!freed&&!cancelled&&this.state==='ready'&&!p.released&&!depth.disposed&&epoch===this.epoch&&isCurrent();
    const job={id:++this.serial,cancel(){cancelled=true;},get valid(){return isValid();},read:null,dispose:null,vertexBuffer:null,elementBuffer:null};
    const onAbort=()=>job.cancel();signal?.addEventListener('abort',onAbort,{once:true});
    const cleanup=()=>{if(freed)return;freed=true;signal?.removeEventListener('abort',onAbort);for(const b of owned)b.destroy();this.jobs.delete(job);};
    try {
      const vertexBuffer=add(d.createBuffer({label:'Frame vertex mask',size:vbytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}));
      const elementBuffer=add(d.createBuffer({label:'Frame element mask',size:ebytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}));
      const header=new ArrayBuffer(64),f=new Float32Array(header),u=new Uint32Array(header);
      f.set(opts.viewport,0);f.set(opts.rectangle,4);u.set([p.vertexCount,p.instanceCount,p.occurrenceCount,through?1:0],8);f[12]=depthTolerance;f[13]=vd.rowWidth;f[14]=p.hasRepresentatives?1:0;
      const params=add(this._buffer(new Uint8Array(header),GPUBufferUsage.UNIFORM,'Frame selection parameters'));
      const bind=d.createBindGroup({layout:this.vertexPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:p.positions}},{binding:1,resource:{buffer:p.matrices}},{binding:2,resource:depth.texture.createView()},{binding:3,resource:{buffer:vertexBuffer}},{binding:4,resource:{buffer:params}},{binding:5,resource:{buffer:p.representatives}}]});
      const encoder=d.createCommandEncoder({label:'Frame screen marquee'});let pass=encoder.beginComputePass();pass.setPipeline(this.vertexPipeline);pass.setBindGroup(0,bind);if(p.occurrenceCount)pass.dispatchWorkgroups(vd.x,vd.y);pass.end();
      if(p.elementCount&&p.instanceCount){
        const ep=add(this._buffer(new Uint32Array([p.vertexCount,p.elementCount,p.elementCount*p.instanceCount,ed.rowWidth]),GPUBufferUsage.UNIFORM,'Frame element parameters'));
        const eb=d.createBindGroup({layout:this.elementPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:vertexBuffer}},{binding:1,resource:{buffer:p.offsets}},{binding:2,resource:{buffer:p.elements}},{binding:3,resource:{buffer:elementBuffer}},{binding:4,resource:{buffer:ep}}]});
        pass=encoder.beginComputePass();pass.setPipeline(this.elementPipeline);pass.setBindGroup(0,eb);pass.dispatchWorkgroups(ed.x,ed.y);pass.end();
      }
      d.queue.submit([encoder.finish()]);this.jobs.add(job);job.vertexBuffer=vertexBuffer;job.elementBuffer=elementBuffer;
      // GPU masks can feed highlight passes directly. Allocate/copy staging only on read().
      job.read=()=>readPromise??=(async()=>{
        try {
          if(freed||!isValid())throw abort('Selection result became stale before readback');
          const readVertex=add(d.createBuffer({label:'Frame vertex readback',size:vbytes,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}));
          const readElement=add(d.createBuffer({label:'Frame element readback',size:ebytes,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}));
          const copy=d.createCommandEncoder({label:'Frame requested selection readback'});
          copy.copyBufferToBuffer(vertexBuffer,0,readVertex,0,vbytes);copy.copyBufferToBuffer(elementBuffer,0,readElement,0,ebytes);d.queue.submit([copy.finish()]);
          const maps=await Promise.allSettled([readVertex.mapAsync(GPUMapMode.READ),readElement.mapAsync(GPUMapMode.READ)]);
          const failed=maps.find(r=>r.status==='rejected');if(failed)throw failed.reason;
          if(!isValid())throw abort('Selection result became stale');
          const vertices=new Uint32Array(readVertex.getMappedRange().slice(0,p.occurrenceCount*4));
          const elements=new Uint32Array(readElement.getMappedRange().slice(0,p.elementCount*p.instanceCount*4));
          readVertex.unmap();readElement.unmap();return {vertices,elements,epoch,instanceCount:p.instanceCount,vertexCount:p.vertexCount,elementCount:p.elementCount};
        } finally {cleanup();}
      })();
      job.dispose=async()=>{job.cancel();if(readPromise){await readPromise.catch(()=>{});return;}settle??=d.queue.onSubmittedWorkDone().catch(()=>{}).finally(cleanup);await settle;};
      return job;
    } catch(e){cleanup();throw e;}
  }
  dispose(){if(this.state==='disposed')return;this.state='disposed';this.epoch++;for(const job of [...this.jobs]){job.cancel();job.dispose?.();}for(const p of [...this.prepared])this.release(p);for(const dep of [...this.ownedTextures])this.releaseDepth(dep);this.emptyDepth?.destroy();this.emptyDepth=null;}
}
