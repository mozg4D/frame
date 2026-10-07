/** Explicit ports of Frame's three segment displays and surface-angle shader.
 * Source paths/widths/nozzle commands are never modified. Native only; shared display/device.
 */
import {SCENE_WGSL} from './gpu-display.mjs';
import {DisplayGeometryCache,stampAttribute,attributeCurrent,normalMatrix4} from './display-packets.mjs';
import {IDENTITY} from './gpu-selection.mjs';
import {assertRenderDomain,renderDomainWGSL,renderDomainFrontFace} from './render-domain.mjs';
export const PRINTER_WGSL=SCENE_WGSL+/*wgsl*/`
struct Segment {a:vec4f,b:vec4f,layerMeta:vec4f}
struct Settings {
 world:mat4x4f, normal:mat4x4f, printerInverse:mat4x4f,
 range:vec4f, options:vec4f, volume:vec4f, buildWorld:vec4f, counts:vec4u
}
@group(1) @binding(0) var<storage,read> segments:array<Segment>;
@group(1) @binding(1) var<storage,read> positions:array<f32>;
@group(1) @binding(2) var<storage,read> attributes:array<f32>;
@group(1) @binding(3) var<uniform> settings:Settings;
@group(1) @binding(4) var<storage,read> instanceMatrices:array<mat4x4f>;
struct Varying {
 @builtin(position) position:vec4f, @location(0) side:f32, @location(1) risk:f32,
 @location(2) pixels:vec4f, @location(3) radii:vec2f,
 @location(4) world:vec3f, @location(5) eye:vec3f, @location(6) normal:vec3f
}
const corners=array<vec2f,6>(vec2f(0.0,-1.0),vec2f(1.0,-1.0),vec2f(0.0,1.0),vec2f(0.0,1.0),vec2f(1.0,-1.0),vec2f(1.0,1.0));
fn unit(v:vec3f)->vec3f{return v/max(length(v),1e-20);}
fn outside()->Varying{var o:Varying;o.position=vec4f(2.0,2.0,2.0,1.0);return o;}
fn visible(s:Segment,original:bool)->bool {
 return (original||s.layerMeta.z>0.0)&&s.layerMeta.x>=settings.range.x&&s.layerMeta.x<=settings.range.y&&!(s.layerMeta.x==settings.range.y&&s.layerMeta.y>=settings.range.z);
}
@vertex fn ribbon(@builtin(vertex_index)v:u32,@builtin(instance_index)i:u32)->Varying {
 let s=segments[i];if(!visible(s,false)){return outside();}let corner=corners[v];
 let raw=s.b.xz-s.a.xz;let length2=length(raw);if(length2<1e-20){return outside();}
 let tangent=raw/length2;let n=vec2f(-tangent.y,tangent.x);let endpoint=mix(s.a.xyz,s.b.xyz,corner.x);
 let mv=scene.view*settings.world;let eye=(mv*vec4f(endpoint,1.0)).xyz;
 let horizontal=unit((mv*vec4f(n.x,0.0,n.y,0.0)).xyz);let vertical=unit((mv*vec4f(0.0,1.0,0.0,0.0)).xyz);
 let axis=cross(vertical,horizontal);let ortho=scene.options.z<0.5;let sight=select(unit(-eye),vec3f(0.0,0.0,1.0),ortho);
 var side=cross(axis,sight);side=select(horizontal,unit(side),length(side)>1e-5);
 let nh=dot(side,horizontal);let nv=dot(side,vertical);let width=mix(select(settings.range.w,s.a.w,s.a.w>=0.0),select(settings.range.w,s.b.w,s.b.w>=0.0),corner.x);let height=s.layerMeta.z;
 let radius=max(1e-8,length(vec2f(nh*width,nv*height))*0.5);
 let section=vec2f(nh*width*width,nv*height*height)/(4.0*radius);
 let pixel=2.0*select(max(0.001,-eye.z),1.0,ortho)/(scene.projection[1][1]*scene.options.w);let expand=max(1.0,pixel*0.55/radius);
 // Exact axial cap planes: no miter extension and no rounded endcaps.
 let point=endpoint+corner.y*vec3f(n.x*section.x,section.y,n.y*section.x)*expand;
 var o:Varying;o.position=scene.viewProjection*settings.world*vec4f(point,1.0);o.side=corner.y;o.risk=s.layerMeta.w*settings.options.x;return o;
}
struct Clip {a:vec4f,b:vec4f,valid:u32}
fn clipLine(a:vec4f,b:vec4f)->Clip{
 let da=array<f32,6>(a.w+a.x,a.w-a.x,a.w+a.y,a.w-a.y,a.z,a.w-a.z);let db=array<f32,6>(b.w+b.x,b.w-b.x,b.w+b.y,b.w-b.y,b.z,b.w-b.z);var lo=0.0;var hi=1.0;
 for(var k=0u;k<6u;k++){let x=da[k];let y=db[k];if(x<0.0&&y<0.0){return Clip(a,b,0u);}if((x<0.0)!=(y<0.0)){let t=x/(x-y);if(x<0.0){lo=max(lo,t);}else{hi=min(hi,t);}}}
 let ca=mix(a,b,lo);let cb=mix(a,b,hi);return Clip(ca,cb,select(0u,1u,lo<=hi&&ca.w>1e-12&&cb.w>1e-12));
}
@vertex fn debugLine(@builtin(vertex_index)v:u32,@builtin(instance_index)i:u32)->Varying{
 let s=segments[i];let original=settings.counts.z==1u;if(!visible(s,original)){return outside();}
 let a=scene.viewProjection*settings.world*vec4f(s.a.xyz,1.0);let b=scene.viewProjection*settings.world*vec4f(s.b.xyz,1.0);let clipped=clipLine(a,b);if(clipped.valid==0u){return outside();}
 let px=scene.viewport.xy+(vec2f(clipped.a.x/clipped.a.w,-clipped.a.y/clipped.a.w)*0.5+0.5)*scene.viewport.zw;
 let py=scene.viewport.xy+(vec2f(clipped.b.x/clipped.b.w,-clipped.b.y/clipped.b.w)*0.5+0.5)*scene.viewport.zw;
 var direction=py-px;direction=select(vec2f(1.0,0.0),direction/max(length(direction),1e-20),length(direction)>1e-6);let n=vec2f(-direction.y,direction.x);let corner=corners[v];
 var o:Varying;o.radii=vec2f(2.7,0.65)*settings.options.z;o.pixels=vec4f(px,py);o.risk=s.layerMeta.w*settings.options.x;o.position=mix(clipped.a,clipped.b,corner.x);
 let offset=(direction*(corner.x*2.0-1.0)+n*corner.y)*(o.radii.x+settings.options.z)/scene.viewport.zw*2.0*o.position.w;
 o.position=vec4f(o.position.xy+vec2f(offset.x,-offset.y),o.position.zw);return o;
}
@vertex fn warning(@builtin(vertex_index)v:u32,@builtin(instance_index)i:u32)->Varying{
 let p=v*3u;let a=v*9u;let local=vec3f(positions[p],positions[p+1u],positions[p+2u]);let im=instanceMatrices[i];
 var o:Varying;o.world=(settings.world*im*vec4f(local,1.0)).xyz;o.eye=(scene.view*vec4f(o.world,1.0)).xyz;
 // Instance normals use reciprocal squared column lengths, matching non-sheared Frame TRS instances.
 let nx=im[0].xyz;let ny=im[1].xyz;let nz=im[2].xyz;let sourceNormal=vec3f(attributes[a],attributes[a+1u],attributes[a+2u]);
 let normal=mat3x3f(nx,ny,nz)*(sourceNormal/max(vec3f(dot(nx,nx),dot(ny,ny),dot(nz,nz)),vec3f(1e-20)));
 o.normal=(scene.view*settings.normal*vec4f(normal,0.0)).xyz;o.position=scene.viewProjection*vec4f(o.world,1.0);return o;
}
fn outputColor(color:vec3f,alpha:f32)->vec4f{
 var c=color;if(settings.options.w>0.5){c*=scene.options.x;if(scene.options.y>0.5){c=clamp((c*(2.51*c+0.03))/(c*(2.43*c+0.59)+0.14),vec3f(0.0),vec3f(1.0));}}
 let x=max(c,vec3f(0.0));let rgb=select(1.055*pow(x,vec3f(1.0/2.4))-0.055,12.92*x,x<=vec3f(0.0031308));return vec4f(rgb,alpha);
}
@fragment fn ribbonColor(o:Varying)->@location(0)vec4f{
 let rim=abs(o.side);let crown=max(0.0,1.0-rim*rim);let light=0.035+0.965*crown*crown*crown;
 let edge=1.0-smoothstep(1.0-min(0.75,fwidth(rim)),1.0,rim);let risk=o.risk>settings.options.y&&o.risk>0.0;return outputColor(select(vec3f(0.43,0.255,0.115),vec3f(1.0,0.12,0.12),risk)*light,edge);
}
@fragment fn debugColor(o:Varying)->@location(0)vec4f{
 let a=o.pixels.xy;let b=o.pixels.zw;let p=o.position.xy;let d=b-a;let t=clamp(dot(p-a,d)/max(dot(d,d),1e-8),0.0,1.0);
 let stroke=length(p-a-t*d);let point=min(length(p-a),length(p-b));let alpha=max(1.0-smoothstep(o.radii.y-0.5,o.radii.y+0.5,stroke),1.0-smoothstep(o.radii.x-0.5,o.radii.x+0.5,point));if(alpha<=0.0){discard;}
 var color=select(vec3f(0.55,0.85,0.9),vec3f(1.0,0.76,0.36),point<=o.radii.x);if(settings.counts.z==1u){color=select(vec3f(0.14,0.95,0.69),vec3f(0.2,1.0,0.62),point<=o.radii.x);}else if(o.risk>settings.options.y&&o.risk>0.0){color=vec3f(1.0,0.12,0.12);}
 return outputColor(color,alpha);
}
@fragment fn warningColor(o:Varying)->@location(0)vec4f{
 let local=(settings.printerInverse*vec4f(o.world,1.0)).xyz;
 let derivative=cross(dpdx(o.eye),dpdy(o.eye));let lengthNormal=length(derivative);let normal=unit(derivative);let oriented=select(normal,-normal,dot(normal,o.normal)<0.0);
 let build=unit((scene.view*vec4f(settings.buildWorld.xyz,0.0)).xyz);
 if(local.y<=0.000001||local.y>settings.volume.y||abs(local.x)>settings.volume.x*0.5||abs(local.z)>settings.volume.z*0.5||lengthNormal<=1e-20){discard;}
 if(-dot(oriented,build)<=settings.options.y+0.000001){discard;}return outputColor(vec3f(1.0,0.12,0.12),1.0);
}
`;
export function printerShader(renderDomain='canonical'){
 if(assertRenderDomain(renderDomain)==='canonical')return PRINTER_WGSL;
 const replace=(code,a,b)=>{if(code.split(a).length!==2)throw Error('Printer shader domain hook changed');return code.replace(a,b);};
 let code=replace(PRINTER_WGSL,'o.side=corner.y;o.risk=s.layerMeta.w*settings.options.x;return o;','o.side=corner.y;o.risk=s.layerMeta.w*settings.options.x;o.position=frameRenderPosition(o.position);return o;');
 code=replace(code,'o.position=vec4f(o.position.xy+vec2f(offset.x,-offset.y),o.position.zw);return o;','o.position=vec4f(o.position.xy+vec2f(offset.x,-offset.y),o.position.zw);o.position=frameRenderPosition(o.position);return o;');
 code=replace(code,'o.position=scene.viewProjection*vec4f(o.world,1.0);return o;','o.position=frameRenderPosition(scene.viewProjection*vec4f(o.world,1.0));return o;');
 code=replace(code,'let p=o.position.xy;let d=b-a;','let p=frameCanonicalFragmentPoint(o.position.xy,scene.options.w);let d=b-a;');
 return code+renderDomainWGSL(renderDomain);
}
// SHA256 of the exact reviewed vertex\0fragment sources in the pinned printer module.
export const REVIEWED_PRINTER_SHADERS=Object.freeze({"warning":"612a9f2d11c28d26047a8f0892d36624a9b9f50224c5933b3cc9b80f09fd903e","debug":"1c2ec2208aecc5c72e09c5d2625ef71a6d3d3aa36f6c8a75d39c14d79e0f2525","solid":"d57a48d6ae38fd3226497ca924698a9db7bcf939f01818c303c52a36b6a55f77","original":"2aed03d95182b6680402bfc1f0f51d77b189a8d4bf9e5754804bb5cd84f283ef"});
const value=(m,key,fallback=0)=>m.uniforms?.[key]?.value??fallback;
const same=(a,b)=>a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
const array=m=>Array.from(m?.elements??m??IDENTITY);
function uniformsStamp(m){const u=m.uniforms??{};return Object.keys(u).filter(k=>!['viewport','buildView','pixelHeight','pixelRatio'].includes(k)).sort().flatMap(k=>{const v=u[k]?.value;return [k,v,...(v?.elements??(v?.toArray?v.toArray():[]))];}).concat([m.vertexShader,m.fragmentShader,m.transparent,m.depthTest,m.depthWrite,m.toneMapped]);}
export class PrinterGeometryCache {
 constructor(){this.rows=new WeakMap();this.surfaces=new DisplayGeometryCache();}
 capture(g,original){
  const names=['segmentStart','segmentEnd','segmentMeta','segmentRisk','segmentWidths'],attrs=names.map(k=>g.attributes[k]),count=g.instanceCount;
  if(!Number.isSafeInteger(count)||count<0)throw Error('Printer segment count required');const old=this.rows.get(g);
  if(old&&old.original===original&&old.count===count&&attrs.every((a,i)=>attributeCurrent(a,old.stamps[i])))return old;
  if(!attrs[0]||!attrs[1]||!attrs[2]||attrs[0].itemSize!==3||attrs[1].itemSize!==3||attrs[2].itemSize!==(original?2:3)||attrs.some(a=>a&&a.count<count))throw Error('Printer segment layout differs from the reviewed source');
  if(attrs[3]&&attrs[3].itemSize!==1||attrs[4]&&attrs[4].itemSize!==2)throw Error('Printer risk/width layout differs');
  const segments=new Float32Array(count*12);
  for(let i=0;i<count;i++){const [a,b,m,r,w]=attrs;segments.set([a.getX(i),a.getY(i),a.getZ(i),w?w.getX(i):-1,b.getX(i),b.getY(i),b.getZ(i),w?w.getY(i):-1,m.getX(i),m.getY(i),original?1:m.getZ(i),r?r.getX(i):0],i*12);}
  if(!segments.every(Number.isFinite))throw Error('Invalid printer data');const stamps=attrs.map(stampAttribute);
  const row={segments,count,original,stamps,isCurrent:()=>g.instanceCount===count&&names.every((k,i)=>attributeCurrent(g.attributes[k],stamps[i]))};this.rows.set(g,row);return row;
 }
}
/** Called before generic material capture; returns null for unrelated drawables. */
export function capturePrinterObject(object,camera,{cache=new PrinterGeometryCache(),mode='solid',pixelRatio=1}={}){
 const tag=object.userData??{};if(!tag.frameAngleWarning&&!tag.framePrinter&&!tag.framePrinterOriginal)return null;
 const m=object.material,g=object.geometry;const pure=['wire','wireframe','isoparms','spline-cage'].includes(mode);
 if(tag.frameAngleWarning&&pure)return {packets:[],isCurrent:()=>object.material===m&&object.geometry===g};
 if(tag.frameAngleWarning&&!m.isShaderMaterial)return null;
 if(!m.isShaderMaterial||Array.isArray(m))throw Error('Unreviewed printer display material');
 const kind=tag.frameAngleWarning?'warning':tag.framePrinterOriginal?'original':m.uniforms?.pixelHeight?'solid':'debug';
 const world=array(object.matrixWorld),normal=normalMatrix4(world);let geometry,instances;
 if(kind==='warning'){
  geometry=cache.surfaces.capture(g);const count=object.isInstancedMesh?object.count:1;
  const data=object.isInstancedMesh?object.instanceMatrix.array.slice(0,count*16):new Float32Array(IDENTITY);if(data.length!==count*16)throw Error('Warning instance layout');
  // Sheared instances require an explicit inverse-transpose buffer; do not pretend TRS.
  for(let i=0;i<count;i++){const at=i*16;const cols=[data.subarray(at,at+3),data.subarray(at+4,at+7),data.subarray(at+8,at+11)];for(let a=0;a<3;a++)for(let b=a+1;b<3;b++){const dot=cols[a].reduce((s,x,k)=>s+x*cols[b][k],0),length=Math.hypot(...cols[a])*Math.hypot(...cols[b]);if(Math.abs(dot)>length*1e-5)throw Error('Sheared warning instances need inverse-transpose adapter');}}
  instances={count,data};
 }else{geometry=cache.capture(g,kind==='original');instances={count:1,data:new Float32Array(IDENTITY)};}
 const inv=array(value(m,'printerInverse',IDENTITY)),inverseTranspose=normalMatrix4(inv),build=[inverseTranspose[1],inverseTranspose[5],inverseTranspose[9]],volume=value(m,'volume');
 const uniforms={world,normal:Array.from(normal),printerInverse:inv,range:[value(m,'firstLayer',1),value(m,'lastLayer',1),value(m,'layerPosition',0),value(m,'lineWidth',1)],options:[value(m,'supportEnabled',0),kind==='warning'?value(m,'angleSin',.70710678):value(m,'warningAngle',45),pixelRatio,m.toneMapped===false?0:1],volume:volume?.toArray?volume.toArray():[0,0,0],buildWorld:build};
 const total=kind==='warning'?(geometry.indices?.length??geometry.vertexCount):geometry.count;const draw=g.drawRange??{start:0,count:Infinity};
 const start=kind==='warning'?Math.max(0,draw.start):0,count=kind==='warning'?Math.max(0,Math.min(total-start,draw.count)):total;
 if(kind==='warning'&&(start%3||count%3))throw Error('Warning triangle range alignment');
 const packet={kind:'printer-'+kind,role:kind,object,geometry,printerInstances:instances,instances:{data:new Float32Array([...world,...normal,1,1,1,1])},uniforms,start,count,material:{transparent:!!m.transparent,depthWrite:m.depthWrite!==false,depthTest:m.depthTest!==false},renderOrder:object.renderOrder??0,sourceShaders:{vertex:m.vertexShader,fragment:m.fragmentShader}};
 const us=uniformsStamp(m),instanceAttribute=stampAttribute(object.instanceMatrix),drawState=JSON.stringify(g.drawRange),parents=[];for(let p=object;p;p=p.parent)parents.push([p,p.parent,p.visible]);
 return {packets:[packet],isCurrent:()=>object.geometry===g&&object.material===m&&same(array(object.matrixWorld),world)&&geometry.isCurrent()&&same(uniformsStamp(m),us)&&attributeCurrent(object.instanceMatrix,instanceAttribute)&&(!object.isInstancedMesh||object.count===instances.count)&&JSON.stringify(g.drawRange)===drawState&&parents.every(([p,par,v])=>p.parent===par&&p.visible===v)};
}
export function packPrinter(packet){const f=new Float32Array(68),u=new Uint32Array(f.buffer),p=packet.uniforms;f.set(p.world,0);f.set(p.normal,16);f.set(p.printerInverse,32);f.set(p.range,48);f.set(p.options,52);f.set([...p.volume,0],56);f.set([...p.buildWorld,0],60);u[64]=packet.geometry.count??0;u[65]=packet.geometry.vertexCount??0;u[66]=packet.role==='original'?1:0;if(!f.subarray(0,64).every(Number.isFinite))throw Error('Invalid printer uniforms');return f;}
export class FrameGpuPrinter {
 static async create(display){const p=new FrameGpuPrinter(display);try{await p.init();return p;}catch(e){p.dispose();throw e;}}
 constructor(display){Object.defineProperty(this,'renderDomain',{value:assertRenderDomain(display.renderDomain??'canonical'),enumerable:true});this.display=display;this.device=display.device;this.pool=display.pool;this.handles=new Set();this.pipelines=new Map();this.state='initializing';this.unregister=null;this.reviewed=new Map();this.device.lost.then(()=>this.dispose());}
 async init(){const d=this.device;d.pushErrorScope('validation');let failure;
  try{this.module=d.createShaderModule({label:'Frame printer widths heights ranges warnings',code:printerShader(this.renderDomain)});this.compilation=await this.module.getCompilationInfo();const errors=this.compilation.messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(m=>m.message).join('\n'));
   this.objectLayout=d.createBindGroupLayout({entries:[0,1,2,4].map(binding=>({binding,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}})).concat([{binding:3,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform',minBindingSize:272}}])});this.layout=d.createPipelineLayout({bindGroupLayouts:[this.display.sceneLayout,this.objectLayout]});if(this.state!=='initializing')throw Error('Device lost during printer init');this.state='ready';this.unregister=this.display.registerExtension(this);
  }catch(e){failure=e;}const error=await d.popErrorScope();if(failure)throw failure;if(error)throw Error(error.message);
 }
 async _review(p){if(!p.sourceShaders)return;const {vertex,fragment}=p.sourceShaders,key=vertex+'\0'+fragment;let promise=this.reviewed.get(key);if(!promise){promise=(async()=>{const bytes=new TextEncoder().encode(key);const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');if(digest!==REVIEWED_PRINTER_SHADERS[p.role])throw Error('Printer shader changed; explicit port review required: '+p.role);return true;})();this.reviewed.set(key,promise);}await promise;}
 async prepare(p){if(this.state!=='ready')throw Error('Printer GPU unavailable');await this._review(p);if(this.state!=='ready')throw Error('Printer GPU lost');const borrowed=[];const add=(data,usage,label,min=4)=>{const r=this.pool.borrow(data,usage,label,min);borrowed.push(r);return r.buffer;};
  try{const h={owner:this,packet:p,borrowed,released:false};const storage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,g=p.geometry;h.segments=add(g.segments??new Float32Array(12),storage,'Frame segments',48);h.positions=add(g.positions??new Float32Array(3),storage,'Frame positions');h.attributes=add(g.extras??new Float32Array(9),storage,'Frame normals UV colour');h.uniform=add(packPrinter(p),GPUBufferUsage.UNIFORM,'Frame printer uniforms');h.instances=add(p.printerInstances.data,storage,'Frame warning instances',64);h.bind=this.device.createBindGroup({layout:this.objectLayout,entries:[h.segments,h.positions,h.attributes,h.uniform,h.instances].map((buffer,binding)=>({binding,resource:{buffer}}))});
   if(g.indices){h.index=add(g.indices,GPUBufferUsage.INDEX,'Frame indices');h.indexFormat=g.indices instanceof Uint16Array?'uint16':'uint32';}
   const key=JSON.stringify([p.role,p.material.depthWrite,p.material.depthTest,p.material.transparent]);if(!this.pipelines.has(key)){const entry=p.role==='warning'?'warning':p.role==='solid'?'ribbon':'debugLine',fragment=p.role==='warning'?'warningColor':p.role==='solid'?'ribbonColor':'debugColor';const desc={layout:this.layout,vertex:{module:this.module,entryPoint:entry},fragment:{module:this.module,entryPoint:fragment,targets:[{format:this.display.format,...(p.material.transparent?{blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}:{})}]},primitive:{topology:'triangle-list',cullMode:'none',frontFace:renderDomainFrontFace('ccw',this.renderDomain)},multisample:{count:this.display.sampleCount,alphaToCoverageEnabled:p.role==='solid'&&this.display.sampleCount>1},depthStencil:{format:'depth32float',depthWriteEnabled:p.material.depthWrite,depthCompare:p.material.depthTest?'less-equal':'always'}};this.pipelines.set(key,this.device.createRenderPipelineAsync(desc).catch(e=>{this.pipelines.delete(key);throw e;}));}h.pipeline=await this.pipelines.get(key);if(this.state!=='ready')throw Error('Printer GPU lost during preparation');this.handles.add(h);return h;
  }catch(e){for(const r of borrowed)this.pool.release(r);throw e;}
 }
 encode(pass,h,sceneBind){if(this.state!=='ready'||h.released||h.owner!==this)throw Error('Invalid printer GPU handle');pass.setPipeline(h.pipeline);pass.setBindGroup(0,sceneBind);pass.setBindGroup(1,h.bind);const p=h.packet;if(p.role==='warning'){if(h.index){pass.setIndexBuffer(h.index,h.indexFormat);pass.drawIndexed(p.count,p.printerInstances.count,p.start,0,0);}else pass.draw(p.count,p.printerInstances.count,p.start,0);}else if(p.count)pass.draw(6,p.count,0,0);}
 release(h){if(h?.owner!==this||h.released)return;h.released=true;for(const r of h.borrowed)this.pool.release(r);this.handles.delete(h);}
 dispose(){if(this.state==='disposed')return;this.state='disposed';this.unregister?.();for(const h of [...this.handles])this.release(h);this.pipelines.clear();this.reviewed.clear();}
}
