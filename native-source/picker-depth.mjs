/** Explicit picker depth policies. Geometry and edge modes intentionally ignore
 * display materials, exactly like the old authoring pick passes. Optional display
 * coverage reuses the CURRENT display shader, textures and immutable numeric ABI.
 */
import {DEPTH_WGSL,selectionDepthShader,multiply4} from './gpu-selection.mjs';
import {DISPLAY_WGSL,displayShader,packDraw,packView} from './gpu-display.mjs';
import {relativeClipMatrices,relativeDisplayPacket} from './relative-frame.mjs';
import {assertRenderDomain,assertAdapterRenderDomain,renderDomainRect,renderDomainFrontFace} from './render-domain.mjs';
export const PICKER_DEPTH_WGSL=DISPLAY_WGSL+`
@fragment fn pickerCoverage(o:Varying){let unused=displayCoverage(o);}
`;
export function pickerDepthShader(renderDomain='canonical'){return displayShader(renderDomain)+'\n@fragment fn pickerCoverage(o:Varying){let unused=displayCoverage(o);}\n';}
const fail=m=>{throw Error(m);};
export const DEPTH_COMPARE=Object.freeze(['never','always','less','less-equal','equal','greater-equal','greater','not-equal']);
export function displayDepthPolicy(material){
 if(material.unsupported?.length)fail('Unported display depth coverage: '+material.unsupported.join(', '));
 const source=material.source;if(source?.stencilWrite)fail('Stencil depth is unsupported by the current depth32float native viewport; explicit stencil adapter required');
 const code=source?.depthFunc??3,compare=material.depthTest?DEPTH_COMPARE[code]:'always';if(!compare)fail('Unknown Three material depth comparison');
 if(![material.depthBias??0,material.slopeBias??0,material.clipBias??0].every(Number.isFinite))fail('Nonfinite material depth bias');
 return {compare,write:!!material.depthWrite,bias:Math.trunc(material.depthBias??0),slope:material.slopeBias??0};
}
export function pickerGeometryPacket(snapshot,camera,{range='all'}={}){
 const parts=snapshot.packets.filter(p=>p.kind==='triangles'||p.kind==='wire');if(!parts.length)fail('Semantic model-surface geometry required');
 const first=parts[0],g=first.geometry,instances=first.instances;if(parts.some(p=>p.geometry!==g||p.instances!==instances))fail('One source drawable per picker binding');
 const matrices=relativeClipMatrices(instances,camera);
 const total=g.indices?.length??g.vertexCount;
 const draw=snapshot.pickerDrawRange??g.source?.drawRange??{start:0,count:Infinity},start=range==='draw'?Math.max(0,draw.start):0,end=range==='draw'?Math.min(total,draw.count===Infinity?total:start+draw.count):total;
 if(!Number.isInteger(start)||!Number.isInteger(end)||start%3||(end-start)%3||end<start)fail('Picker draw range must contain complete triangles');
 return {positions:g.positions,indices:g.indices,clipMatrices:matrices,instanceRanges:instances.ranges.map(r=>({...r})),ranges:[{start,count:end-start,cullMode:'none'}],objectId:first.objectId??first.object.uuid};
}
export class FramePickerDepth {
 static async create(host,{display=null}={}){
  if(display&&(display.device!==host.device||display.state!=='ready'||host.resourcePool&&display.pool!==host.resourcePool))fail('Same-device/shared-pool ready display texture owner required');
  if(display)assertAdapterRenderDomain(display,host.renderDomain??'canonical');const p=new FramePickerDepth(host,display),d=host.device;d.pushErrorScope('validation');let issue;
  try{
   const opaque=d.createShaderModule({label:'Frame exact opaque authoring depth',code:selectionDepthShader(p.renderDomain)});const material=d.createShaderModule({label:'Frame matching display depth coverage',code:pickerDepthShader(p.renderDomain)});
   for(const [name,module]of [['opaque',opaque],['material',material]]){const info=await module.getCompilationInfo();p.compilation.push({name,messages:info.messages});if(info.messages.some(q=>q.type==='error'))fail('Picker depth WGSL compilation failed: '+info.messages.filter(q=>q.type==='error').map(q=>q.message).join('; '));}
   p.opaqueModule=opaque;p.materialModule=material;
   const layout=d.createPipelineLayout({bindGroupLayouts:[host.depthLayout]});
   for(const policy of ['edge','geometry'])p.opaquePipelines.set(policy,await d.createRenderPipelineAsync({label:'Frame '+policy+' forced DoubleSide opaque depth',layout,vertex:{module:opaque,entryPoint:'vs'},primitive:{topology:'triangle-list',cullMode:'none'},multisample:{count:1},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'less-equal',depthBias:policy==='edge'?2:0,depthBiasSlopeScale:policy==='edge'?2:0}}));
   p.sceneLayout=d.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform',minBindingSize:352}},{binding:1,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage',minBindingSize:32}}]});
   p.objectLayout=d.createBindGroupLayout({entries:[0,1,2,4].map(binding=>({binding,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}})).concat([{binding:3,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform',minBindingSize:288}}])});
   p.textureLayout=display?.textureLayout??d.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,sampler:{type:'filtering'}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float',viewDimension:'2d'}}]});
   p.materialLayout=d.createPipelineLayout({bindGroupLayouts:[p.sceneLayout,p.objectLayout,p.textureLayout]});
  }catch(e){issue=e;}const error=await d.popErrorScope();if(issue)throw issue;if(error)throw Error(error.message);return p;
 }
 constructor(host,display){Object.defineProperty(this,'renderDomain',{value:assertRenderDomain(host.renderDomain??'canonical'),enumerable:true});this.host=host;this.display=display;this.opaquePipelines=new Map();this.materialPipelines=new Map();this.compilation=[];this.prepared=new Set();this.white=null;this.disposed=false;}
 _white(){
  if(!this.white){const d=this.host.device,texture=d.createTexture({label:'Frame untextured depth coverage',size:[1,1],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});try{d.queue.writeTexture({texture},new Uint8Array([255,255,255,255]),{bytesPerRow:4},[1,1]);this.white={texture,sampler:d.createSampler({minFilter:'linear',magFilter:'linear'})};}catch(e){texture.destroy();throw e;}}
  return this.white;
 }
 async _pipeline(m,frontFace,cullMode){
  const q=displayDepthPolicy(m),key=JSON.stringify([frontFace,cullMode,q]);
  if(!this.materialPipelines.has(key))this.materialPipelines.set(key,this.host.device.createRenderPipelineAsync({label:'Frame display coverage depth '+key,layout:this.materialLayout,vertex:{module:this.materialModule,entryPoint:'triangles'},fragment:{module:this.materialModule,entryPoint:'pickerCoverage',targets:[]},primitive:{topology:'triangle-list',frontFace:renderDomainFrontFace(frontFace,this.renderDomain),cullMode},multisample:{count:1},depthStencil:{format:'depth32float',depthWriteEnabled:q.write,depthCompare:q.compare,depthBias:q.bias,depthBiasSlopeScale:q.slope}}).catch(e=>{this.materialPipelines.delete(key);throw e;}));return this.materialPipelines.get(key);
 }
 async prepare(snapshots,camera,policy){
  if(this.disposed)fail('Picker depth owner disposed');if(!['edge','geometry','display'].includes(policy))fail('Unknown explicit picker depth policy');
  const result={policy,opaque:[],handles:[],buffers:[],borrows:[],textures:[],released:false,camera:{...camera,worldOrigin:camera.worldOrigin?.slice(),viewProjection64:camera.viewProjection64?.slice(),viewProjection:camera.viewProjection.slice(),viewport:camera.viewport.slice()}};
  const h=this.host,add=b=>(result.buffers.push(b),b),borrow=(data,usage,label)=>{const r=h._borrow(data,usage,label);result.borrows.push(r);return r.buffer;};
  // Snapshot custom comparison/stencil fields BEFORE the first pipeline await.
  const packets=snapshots.flatMap(s=>s.packets.map(p=>({...p,material:{...p.material,source:{depthFunc:p.material.source?.depthFunc,stencilWrite:p.material.source?.stencilWrite}}})));
  try{
   if(policy!=='display')for(const snapshot of snapshots)result.opaque.push(h.prepare(pickerGeometryPacket(snapshot,result.camera,{range:policy==='edge'?'draw':'all'})));
   else for(const source of packets){
    const p=relativeDisplayPacket(source,result.camera.worldOrigin);
    if(p.kind!=='triangles'||p.pickerOnlyGeometry)fail('Display depth needs actual visible semantic triangle packets, not raw-only authoring geometry');const m=p.material;displayDepthPolicy(m);const g=p.geometry,instances=p.instances;
    const positions=borrow(g.positions,GPUBufferUsage.STORAGE,'Frame positions'),attributes=borrow(g.extras,GPUBufferUsage.STORAGE,'Frame depth normals UV colour'),instanceBuffer=borrow(instances.data,GPUBufferUsage.STORAGE,'Frame depth world instances');
    const uniform=add(h._buffer(packDraw(p),GPUBufferUsage.UNIFORM,'Frame matching depth draw uniforms')),elements=add(h._storage(new Uint32Array([0,0]),'Frame unused depth element IDs'));
    const handle={packet:p,draws:[],bind:h.device.createBindGroup({layout:this.objectLayout,entries:[positions,attributes,instanceBuffer,uniform,elements].map((buffer,binding)=>({binding,resource:{buffer}}))})};result.handles.push(handle);
    if(g.indices){handle.index=borrow(g.indices,GPUBufferUsage.INDEX,'Frame indices');handle.indexFormat=g.indices instanceof Uint16Array?'uint16':'uint32';}
    if(m.texture){if(!this.display)fail('Textured display depth requires the existing shared display texture owner');const t=this.display._texture(m.texture);result.textures.push(t);handle.textureBind=t.bind;}
    else {const t=this._white();handle.textureBind=h.device.createBindGroup({layout:this.textureLayout,entries:[{binding:0,resource:t.sampler},{binding:1,resource:t.texture.createView()}]});}
    const sides=m.transparent&&m.cullMode==='none'&&!m.forceSinglePass?['front','back']:[m.cullMode];for(const cullMode of sides)for(const range of instances.ranges)handle.draws.push({range,pipeline:await this._pipeline(m,range.frontFace,cullMode)});
   }
   this.prepared.add(result);return result;
  }catch(e){this.releasePrepared(result);throw e;}
 }
 render(prepared,options){
  const h=this.host,d=h.device,{width,height,viewport}=options;if(prepared.released||this.disposed)fail('Picker depth preparation released');
  if(Math.max(width,height)>d.limits.maxTextureDimension2D)fail('Picker depth exceeds texture limit');
  const texture=d.createTexture({label:'Frame '+prepared.policy+' on-demand picker depth',size:[width,height],format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
  try{
   const encoder=d.createCommandEncoder({label:'Frame '+prepared.policy+' picker depth'}),pass=encoder.beginRenderPass({colorAttachments:[],depthStencilAttachment:{view:texture.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});const rasterViewport=renderDomainRect(viewport,height,this.renderDomain);pass.setViewport(...rasterViewport,0,1);pass.setScissorRect(...rasterViewport);
   if(prepared.policy!=='display')for(const p of prepared.opaque){if(!p.instanceCount)continue;pass.setPipeline(this.opaquePipelines.get(prepared.policy));pass.setBindGroup(0,p.depthBind);if(p.indexBuffer)pass.setIndexBuffer(p.indexBuffer,p.indexFormat);for(const r of p.ranges)if(r.count)pass[p.indexBuffer?'drawIndexed':'draw'](...(p.indexBuffer?[r.count,p.instanceCount,r.start,0,0]:[r.count,p.instanceCount,r.start,0]));}
   else {
    const camera=prepared.camera,view=h._buffer(packView({...camera,cameraPosition:camera.cameraPosition??[0,0,0],directionalLights:[]}),GPUBufferUsage.UNIFORM,'Frame matching depth view');prepared.buffers.push(view);const lights=h._storage(new Float32Array(8),'Frame unused depth lights');prepared.buffers.push(lights);
    pass.setBindGroup(0,d.createBindGroup({layout:this.sceneLayout,entries:[{binding:0,resource:{buffer:view}},{binding:1,resource:{buffer:lights}}]}));
    const depthOf=p=>{const v=camera.viewMatrix,m=p.instances.data;return !v||m.length<16?0:-(v[2]*m[12]+v[6]*m[13]+v[10]*m[14]+v[14]);};
    const sorted=prepared.handles.slice().sort((a,b)=>a.packet.renderOrder-b.packet.renderOrder||Number(a.packet.material.transparent)-Number(b.packet.material.transparent)||(a.packet.material.transparent?depthOf(b.packet)-depthOf(a.packet):depthOf(a.packet)-depthOf(b.packet)));
    for(const a of sorted){const p=a.packet;if(!p.instances.count)continue;pass.setBindGroup(1,a.bind);pass.setBindGroup(2,a.textureBind);if(a.index)pass.setIndexBuffer(a.index,a.indexFormat);for(const {range,pipeline}of a.draws){if(!range.count)continue;pass.setPipeline(pipeline);if(a.index)pass.drawIndexed(p.count,range.count,p.start,0,range.start);else pass.draw(p.count,range.count,p.start,range.start);}}
   }pass.end();d.queue.submit([encoder.finish()]);const depth={owner:h,renderDomain:this.renderDomain,texture,width,height,viewport:viewport.slice(),epoch:h.epoch,disposed:false};h.ownedTextures.add(depth);return depth;
  }catch(e){texture.destroy();throw e;}
 }
 releasePrepared(p){if(!p||p.released)return;p.released=true;for(const q of p.opaque)this.host.release(q);for(const b of p.buffers)b.destroy();for(const r of p.borrows)this.host._return(r);for(const t of p.textures)this.display._releaseTexture(t);this.prepared.delete(p);}
 dispose(){if(this.disposed)return;this.disposed=true;for(const p of this.prepared)this.releasePrepared(p);this.white?.texture.destroy();}
}
