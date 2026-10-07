/** Native reproduction of the old edge-ID ribbon, then its CPU seen-ID ranking.
 * No centreline-only visibility test, raycaster, peeling, or authored mutation.
 */
import {assertRenderDomain,assertAdapterRenderDomain,renderDomainWGSL} from './render-domain.mjs';
export const RIBBON_WGSL=/*wgsl*/`
struct Params { viewport:vec4f,tile:vec4f,options:vec4f,counts:vec4u }
@group(0) @binding(0) var<storage,read> positions:array<f32>;
@group(0) @binding(1) var<storage,read> matrices:array<mat4x4f>;
@group(0) @binding(2) var<storage,read> edges:array<u32>;
@group(0) @binding(3) var<uniform> params:Params;
@group(0) @binding(4) var depth:texture_depth_2d;
struct Out { @builtin(position) position:vec4f,@location(0) @interpolate(flat) id:u32 }
const ends=array<u32,6>(0u,1u,1u,0u,1u,0u);
const sides=array<f32,6>(-1.0,-1.0,1.0,-1.0,1.0,1.0);
@vertex fn ribbon(@builtin(vertex_index)v:u32,@builtin(instance_index)id:u32)->Out {
 let occurrence=id/params.counts.x;let edge=id%params.counts.x;
 let ai=edges[edge*2u]*3u;let bi=edges[edge*2u+1u]*3u;
 let a=matrices[occurrence]*vec4f(positions[ai],positions[ai+1u],positions[ai+2u],1.0);
 let b=matrices[occurrence]*vec4f(positions[bi],positions[bi+1u],positions[bi+2u],1.0);
 // Exactly the legacy shader: expand the ORIGINAL clip endpoints, THEN let
 // fixed-function homogeneous triangle clipping run. Never clip the centreline first.
 let delta=(b.xy/b.w-a.xy/a.w)*params.viewport.zw;var direction=vec2f(1.0,0.0);
 if(length(delta)>1e-6){direction=normalize(delta);}
 let normal=vec2f(-direction.y,direction.x);var p=select(a,b,ends[v]==1u);
 p=vec4f(p.xy+normal*sides[v]*params.options.x/params.viewport.zw*p.w,p.zw);
 let ndc=p.xy/p.w;
 let pixel=params.viewport.xy+vec2f(ndc.x*0.5+0.5,0.5-ndc.y*0.5)*params.viewport.zw;
 let local=(pixel-params.tile.xy)/params.tile.zw;
 var out:Out;out.position=vec4f(vec2f(local.x*2.0-1.0,1.0-local.y*2.0)*p.w,p.zw);
 out.id=params.counts.y+id+1u;return out;
}
@fragment fn identify(o:Out)->@location(0)u32 {
 if(params.options.y==0.0){
  let pixel=vec2i(floor(o.position.xy)+params.tile.xy);
  if(o.position.z>textureLoad(depth,pixel,0)+params.options.z){discard;}
 }
 return o.id;
}
`;
// ID tiles and ranking remain canonical; only their sampled depth resource changes rows.
export function ribbonShader(depthRenderDomain='canonical'){
 if(assertRenderDomain(depthRenderDomain)==='canonical')return RIBBON_WGSL;
 return RIBBON_WGSL.replace('textureLoad(depth,pixel,0)','textureLoad(depth,frameRenderDepthPixel(pixel,i32(textureDimensions(depth).y)),0)')+renderDomainWGSL(depthRenderDomain);
}
const fail=m=>{throw Error(m);};
const abort=m=>new DOMException(m,'AbortError');
export function ribbonRegion(viewport,point,radius){
 const [vx,vy,vw,vh]=viewport,x=Math.round(point[0]-vx)+vx,y=Math.round(point[1]-vy)+vy;
 // readRenderTargetPixels' inclusive square [rounded-R, rounded+R]. The
 // physical radius is integer; fractional radii cannot describe that old read.
 if(!Number.isSafeInteger(radius)||radius<0)fail('Legacy ribbon radius must be an integer physical pixel count');
 const x0=Math.max(vx,x-radius),y0=Math.max(vy,y-radius),x1=Math.min(vx+vw,x+radius+1),y1=Math.min(vy+vh,y+radius+1);
 return [x0,y0,Math.max(0,x1-x0),Math.max(0,y1-y0)];
}
/** Raster supplied Uint32 IDs are top-left rows; legacy GL readback visits bottom
 * rows first. Only the FIRST occurrence of an ID participates; <= picks the last
 * seen ID at equal distance. This also preserves overlapping-ribbon overwrite.
 */
export function rankRibbonIds(pixels,region,targets,viewport,point,radius){
 const seen=new Set(),lookup=targets.filter(t=>t.ribbonCount);let best=null,bd=radius*radius,scan=0;
 const project=(p,m,vertex)=>{const k=vertex*3,x=p[k],y=p[k+1],z=p[k+2],w=m[3]*x+m[7]*y+m[11]*z+m[15];return [viewport[0]+((m[0]*x+m[4]*y+m[8]*z+m[12])/w*.5+.5)*viewport[2],viewport[1]+(.5-(m[1]*x+m[5]*y+m[9]*z+m[13])/w*.5)*viewport[3],(m[2]*x+m[6]*y+m[10]*z+m[14])/w,w];};
 for(let y=region[3]-1;y>=0;y--)for(let x=0;x<region[2];x++,scan++){
  const id=pixels[y*region[2]+x];if(!id||seen.has(id))continue;seen.add(id);
  let lo=0,hi=lookup.length-1,target;while(lo<=hi){const mid=Math.floor((lo+hi)/2),q=lookup[mid];if(id<=q.ribbonBase)hi=mid-1;else if(id>q.ribbonBase+q.ribbonCount)lo=mid+1;else{target=q;break;}}if(!target)fail('Native ribbon ID outside immutable occurrence table');
  const occurrence=id-target.ribbonBase-1,edge=occurrence%target.tables.groups.length,instance=Math.floor(occurrence/target.tables.groups.length),raw=target.tables.groups[edge],packet=target.pickPacket;
  const matrix=packet.clipMatrices.subarray(instance*16,instance*16+16),a=project(packet.positions,matrix,raw.a),b=project(packet.positions,matrix,raw.b);
  const dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy,t=length>1e-9?Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/length)):0;
  const screen=[a[0]+t*dx,a[1]+t*dy],distanceSquared=(point[0]-screen[0])**2+(point[1]-screen[1])**2;
  if(!Number.isFinite(distanceSquared)||distanceSquared>bd)continue;
  const denominator=(1-t)*b[3]+t*a[3],sourceT=t*a[3]/denominator,interpolationClamped=!Number.isFinite(sourceT)||sourceT<0||sourceT>1;
  // Legacy rank is intentionally unclipped. Keep its ID/distance policy while
  // retaining the public interpolation contract for opposite-sign endpoint w.
  bd=distanceSquared;best={target,occurrence,distanceSquared,t:Math.max(0,Math.min(1,Number.isFinite(sourceT)?sourceT:0)),interpolationClamped,depth:a[2]+t*(b[2]-a[2]),screen,scanOrder:scan};
 }return best;
}
export class FrameRibbonPicker {
 static async create(host){
  const p=new FrameRibbonPicker(host),d=host.device;d.pushErrorScope('validation');let issue;
  try{
   const module=d.createShaderModule({label:'Frame native legacy ID ribbon',code:ribbonShader(p.renderDomain)});p.compilation=await module.getCompilationInfo();
   if(p.compilation.messages.some(q=>q.type==='error'))fail('Ribbon WGSL compilation failed: '+p.compilation.messages.filter(q=>q.type==='error').map(q=>q.message).join('; '));
   p.layout=d.createBindGroupLayout({entries:[0,1,2].map(binding=>({binding,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}})).concat([{binding:3,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}},{binding:4,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'depth'}}])});
   const layout=d.createPipelineLayout({bindGroupLayouts:[p.layout]});
   // The old ShaderMaterial was FrontSide; Three flips frontFace for reflected
   // mesh transforms even though screen expansion itself emits a fixed winding.
   for(const frontFace of ['ccw','cw'])p.pipelines.set(frontFace,await d.createRenderPipelineAsync({label:'Frame ID ribbon '+frontFace,layout,vertex:{module,entryPoint:'ribbon'},fragment:{module,entryPoint:'identify',targets:[{format:'r32uint'}]},primitive:{topology:'triangle-list',cullMode:'back',frontFace},multisample:{count:1}}));
  }catch(e){issue=e;}const error=await d.popErrorScope();if(issue)throw issue;if(error)throw Error(error.message);return p;
 }
 constructor(host){Object.defineProperty(this,'renderDomain',{value:assertRenderDomain(host.renderDomain??'canonical'),enumerable:true});Object.defineProperty(this,'outputRenderDomain',{value:'canonical',enumerable:true});this.host=host;this.pipelines=new Map();}
 async pick(targets,depth,point,{radius,width=3,through=false,tolerance=0,signal,isCurrent,rankingViewport=depth.viewport}={}){
  assertAdapterRenderDomain(depth,this.renderDomain);const h=this.host,d=h.device,region=ribbonRegion(depth.viewport,point,radius),[x,y,w,hh]=region;if(!w||!hh)return null;
  if(h.jobs.size)fail('One pending native selection/ribbon per shared host');
  let base=0;for(const t of targets){t.ribbonBase=base;t.ribbonCount=t.tables.groups.length*t.p.instanceCount;base+=t.ribbonCount;if(!Number.isSafeInteger(base)||base>0xfffffffe)fail('Explicit ribbon batching required for Uint32 occurrence IDs');}
  if(!base)return null;const row=Math.ceil(w*4/256)*256,size=row*hh;if(size>d.limits.maxBufferSize)fail('Ribbon ROI readback exceeds buffer limits');
  const buffers=[],textures=[];let cancelled=false,freed=false,readPromise=null,submitted=false;
  const valid=()=>!freed&&!cancelled&&!signal?.aborted&&h.state==='ready'&&!depth.disposed&&depth.epoch===h.epoch&&isCurrent();
  const onAbort=()=>{cancelled=true;},cleanup=()=>{if(freed)return;freed=true;signal?.removeEventListener('abort',onAbort);for(const b of buffers)b.destroy();for(const t of textures)t.destroy();h.jobs.delete(job);};
  const job={cancel:onAbort,dispose:async()=>{onAbort();if(readPromise)await readPromise.catch(()=>{});else if(submitted)await d.queue.onSubmittedWorkDone().catch(()=>{});cleanup();}};
  if(!valid())throw abort('Ribbon source stale before submission');signal?.addEventListener('abort',onAbort,{once:true});h.jobs.add(job);
  try{
   const texture=d.createTexture({label:'Frame inclusive pointer ID ribbon',size:[w,hh],format:'r32uint',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});textures.push(texture);
   const encoder=d.createCommandEncoder({label:'Frame visible ID ribbons'}),pass=encoder.beginRenderPass({colorAttachments:[{view:texture.createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});pass.setViewport(0,0,w,hh,0,1);pass.setScissorRect(0,0,w,hh);
   // Legacy clones share material/renderOrder and use Three's opaque z/id sort.
   // The owner may supply the existing clone's creation order for equal-z history.
   const order=targets.slice().sort((a,b)=>{const A=a.pickPacket.clipMatrices,B=b.pickPacket.clipMatrices,az=A[14]/A[15],bz=B[14]/B[15];return (Number.isFinite(az)&&Number.isFinite(bz)?az-bz:0)||a.ribbonOrder-b.ribbonOrder;});
   for(const t of order){if(!t.ribbonCount)continue;const header=new ArrayBuffer(64),f=new Float32Array(header),u=new Uint32Array(header);f.set(depth.viewport);f.set(region,4);f.set([width,through?1:0,tolerance,0],8);u.set([t.tables.groups.length,t.ribbonBase,0,0],12);
    const params=h._buffer(new Uint8Array(header),GPUBufferUsage.UNIFORM,'Frame inclusive ribbon parameters');buffers.push(params);
    const bind=d.createBindGroup({layout:this.layout,entries:[{binding:0,resource:{buffer:t.p.positions}},{binding:1,resource:{buffer:t.p.matrices}},{binding:2,resource:{buffer:t.edgeBuffer}},{binding:3,resource:{buffer:params}},{binding:4,resource:depth.texture.createView()}]});pass.setBindGroup(0,bind);
    for(const range of t.p.instanceRanges){if(!range.count)continue;pass.setPipeline(this.pipelines.get(range.frontFace));pass.draw(6,t.tables.groups.length*range.count,0,t.tables.groups.length*range.start);}
   }pass.end();d.queue.submit([encoder.finish()]);submitted=true;
   const read=d.createBuffer({label:'Frame asynchronous pointer ribbon readback',size,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});buffers.push(read);
   const copy=d.createCommandEncoder({label:'Frame requested inclusive ribbon pixels'});copy.copyTextureToBuffer({texture},{buffer:read,bytesPerRow:row,rowsPerImage:hh},[w,hh]);d.queue.submit([copy.finish()]);
   readPromise=(async()=>{await read.mapAsync(GPUMapMode.READ);if(!valid())throw abort('Ribbon changed during readback');const mapped=new Uint32Array(read.getMappedRange()),pixels=new Uint32Array(w*hh);for(let yy=0;yy<hh;yy++)pixels.set(mapped.subarray(yy*row/4,yy*row/4+w),yy*w);read.unmap();return rankRibbonIds(pixels,region,targets,rankingViewport,point,radius);})();return await readPromise;
  }finally{await job.dispose();}
 }
}
