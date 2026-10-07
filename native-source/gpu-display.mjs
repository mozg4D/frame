/** Native WebGPU colour/line/point backend. Shares device + immutable geometry uploads. */
import {GpuBufferPool,LatestFrameQueue} from './gpu-resources.mjs';
import {textureState,textureStateCurrent,texturePolicy} from './texture-policy.mjs';
import {PHYSICAL_WGSL,createPhysicalDfg} from './gpu-physical.mjs';
import {ENVIRONMENT_WGSL} from './gpu-environment.mjs';
import {CUBIC_MAP_WGSL,CUBIC_GL_WINDOW_WGSL,assertCubicWindowDerivativeCapability,cubicGLWindowMipWGSL,assertCubicWindowMipDerivativeCapability} from './gpu-cubic-map.mjs';
import {assertRenderDomain,renderDomainRect,renderDomainFrontFace,renderDomainWGSL,assertAdapterRenderDomain} from './render-domain.mjs';
import {FrameGpuPresentation} from './gpu-presentation.mjs';
export const SCENE_WGSL=/*wgsl*/`
struct Scene {
 viewProjection:mat4x4f, viewport:vec4f, camera:vec4f,
 lightDirection:vec4f, lightColor:vec4f, ambient:vec4f, options:vec4f, right:vec4f, up:vec4f, view:mat4x4f, projection:mat4x4f, fogColor:vec4f, fogParameters:vec4f
}
@group(0) @binding(0) var<uniform> scene:Scene;
`;
export const DISPLAY_WGSL=SCENE_WGSL+PHYSICAL_WGSL+ENVIRONMENT_WGSL+CUBIC_MAP_WGSL+/*wgsl*/`
// Scene remains 352 bytes for the printer ABI. Its lightDirection slot stores
// the camera's +Z axis, ambient.w the count in this fragment-only storage array.
struct DirectionalLight { direction:vec4f, color:vec4f }
@group(0) @binding(1) var<storage,read> directionalLights:array<DirectionalLight>;
struct Instance { world:mat4x4f, normal:mat4x4f, color:vec4f }
struct Draw {
 color:vec4f, emissive:vec4f, material:vec4f, flags:vec4f, style:vec4f,
 mapInverse:mat4x4f, mapNormal:mat4x4f, uv0:vec4f, uv1:vec4f, uv2:vec4f,
 projection:vec4f, counts:vec4u
}
@group(1) @binding(0) var<storage,read> positions:array<f32>;
@group(1) @binding(1) var<storage,read> attributes:array<f32>;
@group(1) @binding(2) var<storage,read> instances:array<Instance>;
@group(1) @binding(3) var<uniform> draw:Draw;
@group(1) @binding(4) var<storage,read> elementIds:array<u32>;
@group(2) @binding(0) var colorSampler:sampler;
@group(2) @binding(1) var colorTexture:texture_2d<f32>;
struct Varying {
 @builtin(position) position:vec4f, @location(0) world:vec3f,
 @location(1) normal:vec3f, @location(2) uv:vec2f, @location(3) color:vec4f,
 @location(4) local:vec3f, @location(5) localNormal:vec3f, @location(6) point:vec2f
}
fn safeNormal(v:vec3f)->vec3f {return v/max(length(v),1e-20);}
fn sourceVertex(v:u32,i:u32)->Varying {
 var o:Varying;let p=v*3u;let a=v*9u;let inst=instances[i];
 o.local=vec3f(positions[p],positions[p+1u],positions[p+2u]);
 o.localNormal=vec3f(attributes[a],attributes[a+1u],attributes[a+2u]);
 o.world=(inst.world*vec4f(o.local,1.0)).xyz;
 o.normal=(inst.normal*vec4f(o.localNormal,0.0)).xyz;
 o.position=scene.viewProjection*vec4f(o.world,1.0);
 o.position.z-=draw.style.z*o.position.w;
 let uv=vec3f(attributes[a+3u],attributes[a+4u],1.0);
 o.uv=(mat3x3f(draw.uv0.xyz,draw.uv1.xyz,draw.uv2.xyz)*uv).xy;
 let vc=vec4f(attributes[a+5u],attributes[a+6u],attributes[a+7u],attributes[a+8u]);
 o.color=draw.color*inst.color*select(vec4f(1.0),vc,draw.flags.y>0.5);o.point=vec2f(0.0);return o;
}
@vertex fn triangles(@builtin(vertex_index)v:u32,@builtin(instance_index)i:u32)->Varying{return sourceVertex(v,i);}
const corners=array<vec2f,6>(vec2f(0.0,-1.0),vec2f(1.0,-1.0),vec2f(0.0,1.0),vec2f(0.0,1.0),vec2f(1.0,-1.0),vec2f(1.0,1.0));
struct Clipped {a:vec4f,b:vec4f,ta:f32,tb:f32,valid:u32}
fn clipSegment(a:vec4f,b:vec4f)->Clipped {
 let da=array<f32,6>(a.w+a.x,a.w-a.x,a.w+a.y,a.w-a.y,a.z,a.w-a.z);
 let db=array<f32,6>(b.w+b.x,b.w-b.x,b.w+b.y,b.w-b.y,b.z,b.w-b.z);
 var lo=0.0;var hi=1.0;
 for(var k=0u;k<6u;k++){let x=da[k];let y=db[k];if(x<0.0&&y<0.0){return Clipped(a,b,0.0,1.0,0u);}
 if((x<0.0)!=(y<0.0)){let t=x/(x-y);if(x<0.0){lo=max(lo,t);}else{hi=min(hi,t);}}}
 let ca=mix(a,b,lo);let cb=mix(a,b,hi);return Clipped(ca,cb,lo,hi,select(0u,1u,lo<=hi&&ca.w>1e-12&&cb.w>1e-12));
}
@vertex fn lines(@builtin(vertex_index)v:u32,@builtin(instance_index)instance:u32)->Varying {
 let i=instance/draw.counts.x;let edge=instance%draw.counts.x;
 let a=sourceVertex(elementIds[edge*2u],i);let b=sourceVertex(elementIds[edge*2u+1u],i);let segment=clipSegment(a.position,b.position);
 let corner=corners[v];var o=a;
 if(segment.valid==0u){o.position=vec4f(2.0,2.0,2.0,1.0);return o;}
 let delta=(segment.b.xy/segment.b.w-segment.a.xy/segment.a.w)*scene.viewport.zw;
 var normal=vec2f(0.0,1.0);if(length(delta)>1e-10){normal=normalize(vec2f(-delta.y,delta.x));}
 o.position=mix(segment.a,segment.b,corner.x);let shift=normal*corner.y*draw.style.x/scene.viewport.zw*o.position.w;o.position=vec4f(o.position.xy+shift,o.position.zw);
 let t=mix(segment.ta,segment.tb,corner.x);o.color=mix(a.color,b.color,t);o.world=mix(a.world,b.world,t);o.normal=mix(a.normal,b.normal,t);o.local=mix(a.local,b.local,t);o.localNormal=mix(a.localNormal,b.localNormal,t);o.uv=mix(a.uv,b.uv,t);return o;
}
@vertex fn points(@builtin(vertex_index)v:u32,@builtin(instance_index)instance:u32)->Varying {
 let i=instance/draw.counts.x;let p=instance%draw.counts.x;var o=sourceVertex(elementIds[p],i);let corner=corners[v];
 if(o.position.w<=0.0||o.position.z<0.0||o.position.z>o.position.w){o.position=vec4f(2.0,2.0,2.0,1.0);return o;}
 o.point=vec2f(corner.x*2.0-1.0,corner.y);
 var size=draw.style.y;if(draw.projection.w>0.5&&scene.options.z>0.5){size*=scene.viewport.w*0.5/max(o.position.w,1e-9);}
 o.position=vec4f(o.position.xy+o.point*size/scene.viewport.zw*o.position.w,o.position.zw);return o;
}
fn projectedTexture(p:vec3f,n:vec3f)->vec4f {
 return frameCubicTexture(colorTexture,colorSampler,p,n);
}
fn linearToSrgb(c:vec3f)->vec3f {let x=max(c,vec3f(0.0));return select(1.055*pow(x,vec3f(1.0/2.4))-0.055,12.92*x,x<=vec3f(0.0031308));}
fn aces(c:vec3f)->vec3f{return clamp((c*(2.51*c+0.03))/(c*(2.43*c+0.59)+0.14),vec3f(0.0),vec3f(1.0));}
struct DisplayCoverage {base:vec4f,sampled:vec4f}
// Shared display/picker coverage: texture alpha, alphaTest and point silhouette.
fn displayCoverage(o:Varying)->DisplayCoverage {
 var base=o.color;var sampled=vec4f(1.0);
 if(draw.flags.x>0.5){if(draw.projection.x>0.5){let p=(draw.mapInverse*vec4f(o.local,1.0)).xyz;let n=safeNormal((draw.mapNormal*vec4f(o.localNormal,0.0)).xyz);sampled=projectedTexture(p,n);}else{sampled=textureSample(colorTexture,colorSampler,o.uv);}}
 base*=sampled;
 if(base.a<draw.material.w){discard;}
 if(draw.style.w>0.5&&dot(o.point,o.point)>1.0){discard;}
 return DisplayCoverage(base,sampled);
}
@fragment fn shade(o:Varying,@builtin(front_facing)front:bool)->@location(0)vec4f {
 let coverage=displayCoverage(o);let base=coverage.base;let sampled=coverage.sampled;
 let faceNormal=safeNormal(cross(dpdx(o.world),dpdy(o.world)));var n=safeNormal(o.normal);
 if(draw.flags.z>0.5){n=select(faceNormal,-faceNormal,dot(faceNormal,n)<0.0);}
 n=select(-n,n,front);
 // Three computes geometry roughness in view space before bump perturbation.
 let geometryRoughness=physicalGeometryRoughness(safeNormal((scene.view*vec4f(n,0.0)).xyz));
 // Pinned cubic hook perturbs the VIEW normal after alpha discard. Three's
 // actual view strips camera scale; the matrixWorld right/up columns do not.
 if(draw.projection.x>0.5){
  let viewNormal=safeNormal((scene.view*vec4f(n,0.0)).xyz);
  let h=dot(sampled.rgb,vec3f(0.299,0.587,0.114));
  let bumped=frameCubicBumpView(viewNormal,h,draw.projection.y,draw.flags.x>0.5);
  n=frameCubicWorldNormal(bumped,scene.view);
 }
 var rgb=base.rgb;let mode=draw.material.x;
 if(mode>2.5){rgb=safeNormal((scene.view*vec4f(n,0.0)).xyz)*0.5+0.5;}
 else if(mode>0.5){let v=safeNormal(select(scene.lightDirection.xyz,scene.camera.xyz-o.world,scene.options.z>0.5));
  if(mode>1.5){
   let m=physicalStandard(base.rgb,draw.material.y,draw.material.z,geometryRoughness,n,v);
   rgb=physicalStandardIndirectDiffuse(m,scene.ambient.rgb);
   for(var lightIndex=0u;lightIndex<u32(scene.ambient.w);lightIndex++){
    let light=directionalLights[lightIndex];let terms=physicalStandardDirect(m,n,v,safeNormal(light.direction.xyz),light.color.rgb);rgb+=terms.diffuse+terms.specular;
   }
   if(environment.parameters.w>0.5){let terms=physicalStandardIBL(m,environmentSpecularRadiance(v,n,m.roughness),environmentDiffuseIrradiance(n));rgb+=terms.diffuse+terms.specular;}
  }else{
   rgb=physicalLambertIndirect(base.rgb,scene.ambient.rgb);
   for(var lightIndex=0u;lightIndex<u32(scene.ambient.w);lightIndex++){
    let light=directionalLights[lightIndex];rgb+=physicalLambertDirect(base.rgb,n,safeNormal(light.direction.xyz),light.color.rgb);
   }
  }
  rgb+=draw.emissive.rgb;
 }


 if(draw.flags.w>0.5){rgb*=scene.options.x;if(scene.options.y>0.5){rgb=aces(rgb);}}
 var output=linearToSrgb(rgb);
 if(draw.projection.z>0.5&&scene.fogParameters.x>0.5){
  let depth=-(scene.view*vec4f(o.world,1.0)).z;var factor=0.0;
  if(scene.fogParameters.x>1.5){let distance=scene.fogParameters.w*depth;factor=1.0-exp(-distance*distance);}
  else{factor=smoothstep(scene.fogParameters.y,scene.fogParameters.z,depth);}
  output=mix(output,scene.fogColor.rgb,factor);
 }
 // alphaTest sees the texel/opacity alpha above; only surviving opaque output
 // receives alpha=1, as in bundled Three's opaque_fragment.
 return vec4f(output,select(base.a,1.0,draw.counts.z!=0u));
}
`;
/** Explicit rectangular clears, needed when a camera integrator owns one pane.
 * Attachment loadOp=clear ignores scissor and would erase neighbouring views. */
export const CLEAR_WGSL=/*wgsl*/`
@group(0) @binding(0) var<uniform> clearColor:vec4f;
@vertex fn clearVertex(@builtin(vertex_index) id:u32)->@builtin(position) vec4f {
 let x=f32((id<<1u)&2u);let y=f32(id&2u);return vec4f(x*2.0-1.0,y*2.0-1.0,1.0,1.0);
}
@fragment fn clearFragment()->@location(0) vec4f {return clearColor;}
`;
const checkedFinite=(a,label)=>{if(!Array.from(a).every(Number.isFinite))throw Error(`${label}: finite numbers required`);return a;};
/** Canonical exported shader remains byte-identical. Depth adapters use this
 * builder to match their owner's explicit domain without changing captured data. */
export function displayShader(renderDomain='canonical',cubicWindowCapability=null){
 if(assertRenderDomain(renderDomain)==='canonical')return DISPLAY_WGSL;
 const replace=(source,from,to)=>{if(source.split(from).length!==2)throw Error('Display shader boundary changed; review reflected domain');return source.replace(from,to);};
 let code=replace(DISPLAY_WGSL,'->Varying{return sourceVertex(v,i);}','->Varying{var o=sourceVertex(v,i);o.position=frameRenderPosition(o.position);return o;}');
 code=replace(code,'o.uv=mix(a.uv,b.uv,t);return o;','o.uv=mix(a.uv,b.uv,t);o.position=frameRenderPosition(o.position);return o;');
 code=replace(code,'o.position=vec4f(o.position.xy+o.point*size/scene.viewport.zw*o.position.w,o.position.zw);return o;','o.position=vec4f(o.position.xy+o.point*size/scene.viewport.zw*o.position.w,o.position.zw);o.position=frameRenderPosition(o.position);return o;');
 code=replace(code,'let coverage=displayCoverage(o);let base=coverage.base;let sampled=coverage.sampled;',`// Fine affine fields are captured before alpha discard, as in the verified candidate.
 var cubicGradient=vec3f(0.0);
 if(draw.projection.x>0.5&&draw.flags.x>0.5&&abs(draw.projection.y)>0.000001){cubicGradient=frameCubicGradientGLCoarse(colorTexture,colorSampler,o.local,o.localNormal,o.position,draw.mapInverse,draw.mapNormal,scene.options.w);}
 let coverage=displayCoverage(o);let base=coverage.base;let sampled=coverage.sampled;`);
 code=replace(code,'let bumped=frameCubicBumpView(viewNormal,h,draw.projection.y,draw.flags.x>0.5);','let bumped=frameCubicBumpViewGradient(viewNormal,cubicGradient,draw.projection.y,draw.flags.x>0.5);');
 const profile=cubicWindowCapability?.textureLODCalibration?.implicitLODProfile;
 return code+renderDomainWGSL(renderDomain)+(profile?cubicGLWindowMipWGSL(CUBIC_GL_WINDOW_WGSL,profile):CUBIC_GL_WINDOW_WGSL);
}
/** Opt-in compile-time constants, selected only from the uploaded Draw words.
 * All continuous uniforms, coverage and raster state remain on the generic ABI.
 * The complete five-word key prevents a vertex-colour/flat variant alias.
 */
function specializationFeatures(uniform,mode,projection,family){
 if(!(uniform instanceof Float32Array)||uniform.length!==72)throw Error('Packed 288-byte Draw required');
 const words=new Uint32Array(uniform.buffer,uniform.byteOffset,72),indices=[8,12,64,13,14],bits=indices.map(i=>words[i]);
 if(bits[0]!==mode||bits[1]!==0||bits[2]!==projection||bits.slice(3).some(b=>b!==0&&b!==0x3f800000))return null;
 return Object.freeze({mode:uniform[8],hasMap:0,projection:uniform[64],vertexColor:uniform[13],flat:uniform[14],key:family+':'+bits.map(b=>b.toString(16).padStart(8,'0')).join(':')});
}
export function basicSpecializationFeatures(uniform){return specializationFeatures(uniform,0,0,'unmapped-basic-v1');}
export function standardSpecializationFeatures(uniform){return specializationFeatures(uniform,0x40000000,0x3f800000,'unmapped-standard-projection-v1');}
function specializedDisplayShader(renderDomain,features,select){
 const f=new Float32Array(72);f[8]=features?.mode;f[12]=features?.hasMap;f[64]=features?.projection;f[13]=features?.vertexColor;f[14]=features?.flat;
 const checked=select(f);if(!checked||checked.key!==features?.key||['mode','hasMap','projection','vertexColor','flat'].some(k=>!Object.is(features[k],checked[k])))throw Error('Exact unmapped material feature descriptor required');
 let code=displayShader(renderDomain);
 const fields=[['material.x',features.mode,1],['flags.x',features.hasMap,renderDomain==='gl-window'?3:2],['projection.x',features.projection,renderDomain==='gl-window'?3:2],['flags.y',features.vertexColor,1],['flags.z',features.flat,1]];
 for(const [field,value,count]of fields){const token='draw.'+field;if(code.split(token).length!==count+1)throw Error('Material specialization shader boundary changed: '+field);code=code.split(token).join(value+'.0');}
 return code;
}
export function basicDisplayShader(renderDomain,features){return specializedDisplayShader(renderDomain,features,basicSpecializationFeatures);}
export function standardDisplayShader(renderDomain,features){return specializedDisplayShader(renderDomain,features,standardSpecializationFeatures);}

/** Explicit assembly only; material/clip/coverage arithmetic is preserved. */

/** Exact captured-policy choices; immutable owners default to the generic/list control. */
export function displayPolicyOptions({quadTopology='list',basicSpecialization='disabled',standardSpecialization='disabled'}={}){
 if(!['list','strip'].includes(quadTopology))throw Error('Explicit quad topology required');
 if(!['disabled','unmapped-basic-v1'].includes(basicSpecialization))throw Error('Explicit Basic specialization policy required');
 if(!['disabled','unmapped-standard-projection-v1'].includes(standardSpecialization))throw Error('Explicit Standard specialization policy required');
 return Object.freeze({quadTopology,basicSpecialization,standardSpecialization});
}

export function quadShader(code,quadTopology='list'){
 if(!['list','strip'].includes(quadTopology))throw Error('Explicit quad topology required');if(quadTopology==='list')return code;
 const before='const corners=array<vec2f,6>(vec2f(0.0,-1.0),vec2f(1.0,-1.0),vec2f(0.0,1.0),vec2f(0.0,1.0),vec2f(1.0,-1.0),vec2f(1.0,1.0));',after='const corners=array<vec2f,4>(vec2f(0.0,-1.0),vec2f(1.0,-1.0),vec2f(0.0,1.0),vec2f(1.0,1.0));';if(code.split(before).length!==2)throw Error('Quad shader boundary changed');return code.replace(before,after);
}

function shaderError(info){return info.messages.filter(m=>m.type==='error').map(m=>`${m.lineNum}:${m.linePos} ${m.message}`).join('\n');}
export function packDraw(packet,pixelRatio=1){
  const m=packet.material,f=new Float32Array(72),u=new Uint32Array(f.buffer);
  f.set(m.color,0);f.set([...m.emissive,0],4);f.set([{basic:0,lambert:1,standard:2,normal:3}[m.type]??0,m.roughness,m.metalness,m.alphaTest],8);
  f.set([m.texture?1:0,m.vertexColors?1:0,m.flatShading||!packet.geometry.hasNormals?1:0,m.toneMapped?1:0],12);
  f.set([m.lineWidth*pixelRatio,m.pointSize*pixelRatio,m.clipBias??0,packet.kind==='points'&&m.pointCircle?1:0],16);
  f.set(m.mapInverse,20);f.set(m.mapNormal,36);
  for(let i=0;i<3;i++)f.set(m.uvTransform.slice(i*3,i*3+3),52+i*4);
  f.set([m.projection?1:0,m.bump??0,m.fog===false?0:1,m.sizeAttenuation?1:0],64);
  u[68]=packet.kind==='triangles'?0:packet.kind==='points'?packet.indices.length:packet.indices.length/2;u[69]=packet.geometry.vertexCount;u[70]=m.transparent?0:1;u[71]=m.forceSinglePass?1:0;
  checkedFinite(f.subarray(0,68),'Draw uniforms');return f;
}
export function packView(view){
  const f=new Float32Array(88);f.set(view.viewProjection,0);f.set(view.viewport,16);f.set([...view.cameraPosition,0],20);
  const axis=view.cameraDirection??(view.viewMatrix?[view.viewMatrix[2],view.viewMatrix[6],view.viewMatrix[10]]:[0,0,1]);
  f.set([...axis,0],24);f.set([0,0,0,0],28);f.set([...(view.ambient??[0,0,0]),(view.directionalLights??[]).length],32);f.set([view.exposure??1,view.toneMapping==='aces'?1:0,view.perspective?1:0,view.canvasHeight??view.viewport[3]],36);f.set([...(view.cameraRight??[1,0,0]),0],40);f.set([...(view.cameraUp??[0,1,0]),0],44);f.set(view.viewMatrix??[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],48);f.set(view.projection??[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],64);const fog=view.fog??{type:0,color:[0,0,0],near:0,far:1,density:0};f.set([...fog.color,0],80);f.set([fog.type,fog.near,fog.far,fog.density],84);return checkedFinite(f,'View uniforms');
}
export function packDirectionalLights(view){
  const lights=view.directionalLights??[];
  if(!Number.isSafeInteger(lights.length)||lights.length>0xffffff)throw Error('Directional light count exceeds exact Scene count');
  // WebGPU storage bindings cannot be empty; count=0 keeps the dummy unobserved.
  const f=new Float32Array(Math.max(1,lights.length)*8);
  for(let i=0;i<lights.length;i++){
    const l=lights[i];if(l.direction?.length!==3||l.color?.length!==3)throw Error('Directional light layout mismatch');
    f.set(l.direction,i*8);f.set(l.color,i*8+4);
  }
  return checkedFinite(f,'Directional light storage');
}
export const MIPMAP_WGSL=/*wgsl*/`
struct MipVertex { @builtin(position) position:vec4f, @location(0) uv:vec2f }
@group(0) @binding(0) var mipSampler:sampler;
@group(0) @binding(1) var sourceMip:texture_2d<f32>;
@vertex fn mipVertex(@builtin(vertex_index) id:u32)->MipVertex {
 let uv=vec2f(f32((id<<1u)&2u),f32(id&2u));var out:MipVertex;
 out.position=vec4f(uv*2.0-1.0,0.0,1.0);out.uv=vec2f(uv.x,1.0-uv.y);return out;
}
@fragment fn mipFragment(input:MipVertex)->@location(0) vec4f {
 return textureSampleLevel(sourceMip,mipSampler,input.uv,0.0);
}
`;
export class FrameGpuDisplay {
  static async create(rawDevice,{resourcePool=null,format='bgra8unorm',sampleCount=1,onError=()=>{},renderDomain='canonical',cubicWindowCapability=null,quadTopology='list',basicSpecialization='disabled',standardSpecialization='disabled'}={}){
    const display=new FrameGpuDisplay(rawDevice,{resourcePool,format,sampleCount,onError,renderDomain,cubicWindowCapability,quadTopology,basicSpecialization,standardSpecialization});try{await display.init();return display;}catch(e){await display.dispose();throw e;}
  }
  constructor(device,{resourcePool=null,format='bgra8unorm',sampleCount=1,onError=()=>{},renderDomain='canonical',cubicWindowCapability=null,quadTopology='list',basicSpecialization='disabled',standardSpecialization='disabled'}={}){
    if(!['list','strip'].includes(quadTopology))throw Error('Explicit quad topology required');Object.defineProperty(this,'quadTopology',{value:quadTopology,enumerable:true});
    if(!['disabled','unmapped-basic-v1'].includes(basicSpecialization))throw Error('Explicit Basic specialization policy required');
    if(!['disabled','unmapped-standard-projection-v1'].includes(standardSpecialization))throw Error('Explicit Standard specialization policy required');
    Object.defineProperty(this,'standardSpecialization',{value:standardSpecialization,enumerable:true});this.standardModules=new Map();
    Object.defineProperty(this,'basicSpecialization',{value:basicSpecialization,enumerable:true});this.basicModules=new Map();
    assertRenderDomain(renderDomain);Object.defineProperty(this,'renderDomain',{value:renderDomain,enumerable:true});Object.defineProperty(this,'cubicWindowCapability',{value:cubicWindowCapability,enumerable:true});
    if(cubicWindowCapability?.isCurrent&&(cubicWindowCapability.device!==device||!cubicWindowCapability.isCurrent()))throw new DOMException('Cubic display capability is stale or belongs to another device','AbortError');
    if(resourcePool&&resourcePool.device!==device)throw Error('Display and selection must share a GPUDevice');
    if(![1,4].includes(sampleCount))throw Error('Only single-sample or 4x MSAA supported');
    if(!['bgra8unorm','rgba8unorm'].includes(format))throw Error('Explicit linear UNORM canvas format required (shader converts output to sRGB)');
    this.device=device;this.pool=resourcePool??new GpuBufferPool(device);this.ownsPool=!resourcePool;this.format=format;this.sampleCount=sampleCount;this.state='initializing';this.handles=new Set();this.pipelines=new Map();this.textureRows=new Map();this.target=null;this.extensions=new Set();
    this.queue=new LatestFrameQueue(device,{encode:s=>this.encodeFrame(s),onError});
    device.lost.then(()=>{if(this.state==='disposed')return;this.state='lost';this.basicModules.clear();this.standardModules.clear();this.pipelines.clear();this.queue.dispose();this._destroyTargets();this._releaseLighting();for(const h of [...this.handles])this.release(h);});
  }
  async init(){
    const d=this.device;d.pushErrorScope('validation');let error;
    try{
      this.module=d.createShaderModule({label:'Frame native colour lines points',code:quadShader(displayShader(this.renderDomain,this.cubicWindowCapability),this.quadTopology)});this.compilation=await this.module.getCompilationInfo();const problem=shaderError(this.compilation);if(problem)throw Error(problem);
      this.dfg=await createPhysicalDfg(d);
      this.sceneLayout=d.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform',minBindingSize:352}},{binding:1,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage',minBindingSize:32}},this.dfg.layoutEntry]});
      this.objectLayout=d.createBindGroupLayout({entries:[0,1,2,4].map(binding=>({binding,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}})).concat([{binding:3,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform',minBindingSize:288}}])});
      this.textureLayout=d.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,sampler:{type:'filtering'}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float',viewDimension:'2d'}}]});
      this.environmentLayout=d.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform',minBindingSize:160}},...[1,2].map(binding=>({binding,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'unfilterable-float'}}))]});
      this.layout=d.createPipelineLayout({bindGroupLayouts:[this.sceneLayout,this.objectLayout,this.textureLayout,this.environmentLayout]});
      // All pipelines use one layout. Unlit/no-environment views bind immutable
      // zero parameters and valid tiny textures; the uniform gate avoids sampling.
      const zero=this._buffer(new Float32Array(40),GPUBufferUsage.UNIFORM,'Frame disabled environment');this.environmentZero=zero;
      this.environmentBlack=[d.createTexture({label:'Frame disabled PMREM',size:[1,1],format:'rgba16float',usage:GPUTextureUsage.TEXTURE_BINDING}),d.createTexture({label:'Frame disabled HDR',size:[1,1],format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING})];
      this.environmentBind=d.createBindGroup({layout:this.environmentLayout,entries:[{binding:0,resource:{buffer:zero.buffer}},...this.environmentBlack.map((t,i)=>({binding:i+1,resource:t.createView()}))]});
      this.clearModule=d.createShaderModule({label:'Frame rectangular view clear',code:CLEAR_WGSL});
      const clearInfo=await this.clearModule.getCompilationInfo(),clearProblem=shaderError(clearInfo);if(clearProblem)throw Error(clearProblem);
      this.clearLayout=d.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform',minBindingSize:16}}]});
      const clearPipelineLayout=d.createPipelineLayout({bindGroupLayouts:[this.clearLayout]});this.clearPipelines=new Map();
      for(const color of [false,true])for(const depth of [false,true])if(color||depth){const pipeline=await d.createRenderPipelineAsync({label:'Frame per-view clear',layout:clearPipelineLayout,
        vertex:{module:this.clearModule,entryPoint:'clearVertex'},fragment:{module:this.clearModule,entryPoint:'clearFragment',targets:[{format:this.format,writeMask:color?15:0}]},
        primitive:{topology:'triangle-list'},multisample:{count:this.sampleCount},depthStencil:{format:'depth32float',depthWriteEnabled:depth,depthCompare:'always'}});this.clearPipelines.set(color+':'+depth,pipeline);}
      await this._initMipmaps();
      this.white=this._makeTexture({image:{data:new Uint8Array([255,255,255,255]),width:1,height:1},colorSpace:'srgb',wrapS:1001,wrapT:1001,magFilter:1006,minFilter:1006});
      if(this.renderDomain==='gl-window')this.presentation=await FrameGpuPresentation.create(d,{format:this.format,sampleCount:this.sampleCount,renderDomain:this.renderDomain});
      if(this.state!=='initializing')throw Error('Device unavailable during initialization');this.state='ready';
    }catch(e){error=e;}
    const scope=await d.popErrorScope();if(error)throw error;if(scope)throw Error(scope.message);if(this.state==='lost'||this.state==='disposed')throw Error('Device lost during display initialization');
  }
  _check(){if(this.state!=='ready')throw Error('Native display is '+this.state);}
  _buffer(data,usage,label,minBytes=4){return this.pool.borrow(data,usage,label,minBytes);}

  async _initMipmaps(){
    const d=this.device;this.mipModule=d.createShaderModule({label:'Frame native mipmaps',code:MIPMAP_WGSL});
    const info=await this.mipModule.getCompilationInfo(),problem=shaderError(info);if(problem)throw Error(problem);
    this.mipLayout=d.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,sampler:{type:'filtering'}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float',viewDimension:'2d'}}]});
    this.mipSampler=d.createSampler({minFilter:'linear',magFilter:'linear',mipmapFilter:'nearest',addressModeU:'clamp-to-edge',addressModeV:'clamp-to-edge'});
    this.mipPipelines=new Map();const layout=d.createPipelineLayout({bindGroupLayouts:[this.mipLayout]});
    for(const format of ['rgba8unorm','rgba8unorm-srgb']){
      this.mipPipelines.set(format,await d.createRenderPipelineAsync({label:'Frame mipmap '+format,layout,
        vertex:{module:this.mipModule,entryPoint:'mipVertex'},fragment:{module:this.mipModule,entryPoint:'mipFragment',targets:[{format}]},primitive:{topology:'triangle-list'}}));
    }
  }
  _generateMipmaps(texture,format,levels){
    const d=this.device,pipeline=this.mipPipelines.get(format);if(!pipeline)throw Error('Mipmap pipeline was not prepared');
    const encoder=d.createCommandEncoder({label:'Frame mip chain'});
    for(let level=1;level<levels;level++){
      const source=texture.createView({baseMipLevel:level-1,mipLevelCount:1}),target=texture.createView({baseMipLevel:level,mipLevelCount:1});
      const bind=d.createBindGroup({layout:this.mipLayout,entries:[{binding:0,resource:this.mipSampler},{binding:1,resource:source}]});
      const pass=encoder.beginRenderPass({label:'Frame mip '+level,colorAttachments:[{view:target,loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}}]});
      pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.draw(3);pass.end();
    }
    d.queue.submit([encoder.finish()]);
  }
  _makeTexture(source){
    const image=source.image??source.source?.data;if(!image)throw Error('Texture image is not loaded');
    const {width,height,format,mipLevelCount,sampler:samplerDescriptor}=texturePolicy(source,this.device.limits.maxTextureDimension2D);
    const texture=this.device.createTexture({label:'Frame colour texture',size:[width,height],format,mipLevelCount,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});
    try{
      if(image.data){if(!(image.data instanceof Uint8Array||image.data instanceof Uint8ClampedArray)||image.data.length!==width*height*4)throw Error('Only RGBA8 data textures in this adapter');
        let bytes=image.data;if(source.flipY){bytes=new Uint8Array(image.data.length);for(let y=0;y<height;y++)bytes.set(image.data.subarray(y*width*4,(y+1)*width*4),(height-y-1)*width*4);}
        this.device.queue.writeTexture({texture},bytes,{bytesPerRow:width*4,rowsPerImage:height},[width,height]);
      }else this.device.queue.copyExternalImageToTexture({source:image,flipY:!!source.flipY},{texture,colorSpace:'srgb',premultipliedAlpha:false},[width,height]);
      if(mipLevelCount>1)this._generateMipmaps(texture,format,mipLevelCount);
      const sampler=this.device.createSampler(samplerDescriptor);
      const bind=this.device.createBindGroup({layout:this.textureLayout,entries:[{binding:0,resource:sampler},{binding:1,resource:texture.createView()}]});
      return {texture,bind,mipLevelCount,refs:0,source,image,version:source.version,sourceVersion:source.source?.version,settings:this._textureSettings(source),freed:false};
    }catch(e){texture.destroy();throw e;}
  }
  _textureSettings(source){return textureState(source);}
  _texture(source){if(!source){this.white.refs++;return this.white;}let row=this.textureRows.get(source);
    if(row&&(row.version!==source.version||row.sourceVersion!==source.source?.version||row.image!==(source.image??source.source?.data)||!textureStateCurrent(source,row.settings))){this.textureRows.delete(source);row.retired=true;row=null;}
    if(!row){row=this._makeTexture(source);this.textureRows.set(source,row);}row.refs++;return row;
  }
  _releaseTexture(row){if(!row||row.freed)return;if(--row.refs>0||row===this.white)return;row.freed=true;row.texture.destroy();if(this.textureRows.get(row.source)===row)this.textureRows.delete(row.source);}
  async _specializedModule(features){
    this._check();const key=this.renderDomain+':'+this.quadTopology+':'+features.key,cache=features.mode===0?this.basicModules:this.standardModules;
    if(!cache.has(key)){
      const promise=(async()=>{const module=this.device.createShaderModule({label:'Frame '+key,code:quadShader((features.mode===0?basicDisplayShader:standardDisplayShader)(this.renderDomain,features),this.quadTopology)}),info=await module.getCompilationInfo(),problem=shaderError(info);if(problem)throw Error(problem);this._check();return module;})();
      cache.set(key,promise);promise.catch(()=>{if(cache.get(key)===promise)cache.delete(key);});
    }
    return cache.get(key);
  }
  async _pipeline(kind,material,frontFace,features=null){
    frontFace=renderDomainFrontFace(frontFace,this.renderDomain);
    const entry=kind==='triangles'?'triangles':kind==='points'?'points':'lines',m=material;
    const baseKey=[this.quadTopology,entry,m.cullMode,frontFace,m.transparent,m.depthWrite,m.depthTest,m.colorWrite,m.depthBias,m.slopeBias];
    const key=JSON.stringify(features?[...baseKey,this.renderDomain,features.key]:baseKey);
    if(!this.pipelines.has(key)){
      // Install the promise before awaiting compilation, including concurrent prepares.
      const promise=(async()=>{const module=features?await this._specializedModule(features):this.module;this._check();
      const desc={label:'Frame native '+entry+(features?' '+features.key:''),layout:this.layout,vertex:{module,entryPoint:entry},fragment:{module,entryPoint:'shade',targets:[{format:this.format,writeMask:m.colorWrite===false?0:15,...(m.transparent?{blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}:{})}]},
        primitive:{topology:entry!=='triangles'&&this.quadTopology==='strip'?'triangle-strip':'triangle-list',cullMode:entry==='triangles'?m.cullMode:'none',frontFace},multisample:{count:this.sampleCount},depthStencil:{format:'depth32float',depthWriteEnabled:m.depthWrite,depthCompare:m.depthTest?'less-equal':'always',depthBias:entry==='triangles'?Math.trunc(m.depthBias??0):0,depthBiasSlopeScale:entry==='triangles'?m.slopeBias??0:0}};
      return this.device.createRenderPipelineAsync(desc);})();
      this.pipelines.set(key,promise);promise.catch(()=>{if(this.pipelines.get(key)===promise)this.pipelines.delete(key);});
    }
    return this.pipelines.get(key);
  }
  async prepare(packet,{pixelRatio=1}={}){
    this._check();const {geometry:g,instances,material:m}=packet;
    if(!g?.positions||!g.extras||!instances?.data)throw Error('Display packet missing geometry or instances');
    if(m.unsupported?.length)throw Error('Unported material: '+m.unsupported.join(', '));
    if(this.cubicWindowCapability?.isCurrent&&!this.cubicWindowCapability.isCurrent())throw new DOMException('Cubic display capability expired before preparation','AbortError');
    if(this.renderDomain==='gl-window'&&m.projection&&m.texture){
      if(!this.cubicWindowCapability)throw Error('Measured experimental gl-window cubic capability required');
      if(this.sampleCount===4&&this.cubicWindowCapability.experimentalMSAA!==true)throw Error('Experimental gl-window cubic MSAA requires explicit integration approval');
    }
    if(g.positions.length%3||g.extras.length!==g.positions.length*3||instances.data.length!==instances.count*36)throw Error('Display packet array layout mismatch');
    const borrowed=[];let texture;const add=(data,usage,label,min=4)=>{const row=this._buffer(data,usage,label,min);borrowed.push(row);return row.buffer;};
    const dummy=new Uint32Array([0,0]);
    try{
      const storage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,uniform=packDraw(packet,pixelRatio);
      const basic=this.basicSpecialization==='unmapped-basic-v1'?basicSpecializationFeatures(uniform):null,standard=this.standardSpecialization==='unmapped-standard-projection-v1'?standardSpecializationFeatures(uniform):null,features=basic??standard;
      const h={owner:this,packet,basicSpecialization:basic,standardSpecialization:standard,released:false,borrowed,positions:add(g.positions,storage,'Frame positions'),attributes:add(g.extras,storage,'Frame normals UV colour'),instances:add(instances.data,storage,'Frame world instances',144),uniform:add(uniform,GPUBufferUsage.UNIFORM,'Frame draw uniforms'),elements:add(packet.indices??dummy,storage,'Frame line point IDs',8)};
      if(packet.kind==='triangles'&&g.indices){h.index=add(g.indices,GPUBufferUsage.INDEX,'Frame indices');h.indexFormat=g.indices instanceof Uint16Array?'uint16':'uint32';}
      texture=this._texture(m.texture);h.texture=texture;
      h.bind=this.device.createBindGroup({layout:this.objectLayout,entries:[h.positions,h.attributes,h.instances,h.uniform,h.elements].map((buffer,binding)=>({binding,resource:{buffer}}))});
      h.draws=[];
      const sides=packet.kind==='triangles'&&m.transparent&&m.cullMode==='none'&&!m.forceSinglePass?['front','back']:[m.cullMode];
      // Complete the object's back faces before front faces, including all
      // mirrored instance ranges. frontFace supplies each range's winding.
      for(const cullMode of sides)for(const range of instances.ranges){const pipeline=await this._pipeline(packet.kind,{...m,cullMode},range.frontFace,features);h.draws.push({range,pipeline});}
      this._check();this.handles.add(h);return h;
    }catch(e){for(const row of borrowed)this.pool.release(row);if(texture)this._releaseTexture(texture);throw e;}
  }
  registerExtension(extension){this._check();if(extension.device!==this.device||extension.pool!==this.pool||typeof extension.encode!=='function')throw Error('Explicit same-device/pool native extension required');assertAdapterRenderDomain(extension,this.renderDomain);this.extensions.add(extension);return()=>this.extensions.delete(extension);}
  release(handle){if(handle?.owner!==this||handle.released)return;handle.released=true;for(const row of handle.borrowed)this.pool.release(row);this._releaseTexture(handle.texture);this.handles.delete(handle);}
  _destroyTargets(){this.target?.depth.destroy();this.target?.msaa?.destroy();this.target=null;this.presentation?.dispose();}
  _targets(width,height){
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||Math.max(width,height)>this.device.limits.maxTextureDimension2D)throw Error('Display dimensions exceed device limits');
    if(this.target?.width===width&&this.target?.height===height)return this.target;
    this._destroyTargets();const d=this.device;const depth=d.createTexture({label:'Frame colour depth',size:[width,height],sampleCount:this.sampleCount,format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT});let msaa;
    try{if(this.sampleCount>1)msaa=d.createTexture({label:'Frame MSAA colour',size:[width,height],sampleCount:this.sampleCount,format:this.format,usage:GPUTextureUsage.RENDER_ATTACHMENT});}
    catch(e){depth.destroy();throw e;}
    return this.target={width,height,depth,msaa};
  }
  /** Caller supplies a GPUCanvasContext or explicit colour texture for deterministic tests. */
  encodeFrame({context=null,texture=null,width,height,views,clearColor=[.012,.012,.012,1],isCurrent=()=>true}){
    if(this.cubicWindowCapability?.isCurrent&&!this.cubicWindowCapability.isCurrent())throw new DOMException('Cubic display capability expired before encode','AbortError');
    this._check();if(!isCurrent()||!this.dfg.isCurrent()||views?.some(v=>v.environment&&!v.environment.isCurrent()))throw new DOMException('Display source changed before encode','AbortError');if(!views?.length)throw Error('At least one display view required');
    const colorTexture=texture??context?.getCurrentTexture();if(!colorTexture)throw Error('WebGPU colour target required');
    const targets=this.presentation?this.presentation.acquire(width,height):this._targets(width,height),renderTexture=targets.color??colorTexture;
    const d=this.device,refs=[];
    try{
      const encoder=d.createCommandEncoder({label:'Frame colour frame'});
      const pass=encoder.beginRenderPass({label:'Frame all views',colorAttachments:[{view:(targets.msaa??renderTexture).createView(),...(targets.msaa?{resolveTarget:renderTexture.createView()}:{}),clearValue:{r:clearColor[0],g:clearColor[1],b:clearColor[2],a:clearColor[3]},loadOp:'clear',storeOp:'store'}],depthStencilAttachment:{view:targets.depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
      for(const item of views){
        if(item.clear){const c=item.clear,v=c.rectangle;if(v.length!==4||v.some(x=>!Number.isInteger(x))||v[0]<0||v[1]<0||v[2]<0||v[3]<0||v[0]+v[2]>width||v[1]+v[3]>height)throw Error('Invalid rectangular clear');
          if(!v[2]||!v[3]||(!c.color&&!c.depth))continue;
          const row=this._buffer(checkedFinite(new Float32Array(c.color??[0,0,0,0]),'Clear colour'),GPUBufferUsage.UNIFORM,'Frame rectangular clear');refs.push(row);
          const bind=d.createBindGroup({layout:this.clearLayout,entries:[{binding:0,resource:{buffer:row.buffer}}]});
          pass.setViewport(0,0,width,height,0,1);pass.setScissorRect(...renderDomainRect(v,height,this.renderDomain));pass.setPipeline(this.clearPipelines.get(!!c.color+':'+!!c.depth));pass.setBindGroup(0,bind);pass.draw(3);continue;
        }
        const {camera,handles}=item,v=camera.viewport;

        if(v.length!==4||v.some(x=>!Number.isInteger(x))||v[0]<0||v[1]<0||v[2]<1||v[3]<1||v[0]+v[2]>width||v[1]+v[3]>height)throw Error('Viewport must fit physical canvas');
        if(this.renderDomain==='gl-window'&&camera.canvasHeight!==height)throw Error('Reflected view must capture full target height');
        const row=this._buffer(packView(camera),GPUBufferUsage.UNIFORM,'Frame view uniforms');refs.push(row);
        const lights=this._buffer(packDirectionalLights(camera),GPUBufferUsage.STORAGE,'Frame view directional lights',32);refs.push(lights);
        const bind=d.createBindGroup({layout:this.sceneLayout,entries:[{binding:0,resource:{buffer:row.buffer}},{binding:1,resource:{buffer:lights.buffer}},this.dfg.bindEntry]});
        const scissor=camera.scissor??v;if(scissor.length!==4||scissor.some(x=>!Number.isInteger(x))||scissor[0]<0||scissor[1]<0||scissor[2]<0||scissor[3]<0||scissor[0]+scissor[2]>width||scissor[1]+scissor[3]>height)throw Error('Invalid scissor');if(!scissor[2]||!scissor[3])continue;
        pass.setViewport(...renderDomainRect(v,height,this.renderDomain),0,1);pass.setScissorRect(...renderDomainRect(scissor,height,this.renderDomain));pass.setBindGroup(0,bind);pass.setBindGroup(3,item.environment?.bind??this.environmentBind);
        const depthOf=h=>{const v=camera.viewMatrix,m=h.packet.instances.data;if(!v||m.length<16)return 0;return -(v[2]*m[12]+v[6]*m[13]+v[10]*m[14]+v[14]);};
        const sorted=[...handles].sort((a,b)=>a.packet.renderOrder-b.packet.renderOrder||Number(a.packet.material.transparent)-Number(b.packet.material.transparent)||(a.packet.material.transparent?depthOf(b)-depthOf(a):depthOf(a)-depthOf(b)));
        for(const h of sorted){if(h.owner!==this){if(!this.extensions.has(h.owner)||h.released)throw Error('Unknown or released native extension');assertAdapterRenderDomain(h.owner,this.renderDomain);h.owner.encode(pass,h,bind,camera);continue;}if(h.released)throw Error('Display handle released or foreign');const p=h.packet;if(!p.instances.count)continue;
          if(this.renderDomain==='gl-window'&&p.material.projection&&p.material.texture){const policy=texturePolicy(p.material.texture,this.device.limits.maxTextureDimension2D),gate=[1004,1005,1007,1008].includes(p.material.texture.minFilter)?assertCubicWindowMipDerivativeCapability:assertCubicWindowDerivativeCapability;gate({...this.cubicWindowCapability,canvasHeight:height,sampleCount:this.sampleCount,texturePolicy:policy,sourceTexture:p.material.texture});}
          pass.setBindGroup(1,h.bind);pass.setBindGroup(2,h.texture.bind);if(h.index)pass.setIndexBuffer(h.index,h.indexFormat);
          for(const {range,pipeline} of h.draws){pass.setPipeline(pipeline);if(p.kind==='triangles'){if(h.index)pass.drawIndexed(p.count,range.count,p.start,0,range.start);else pass.draw(p.count,range.count,p.start,range.start);}
            else{const elements=p.kind==='points'?p.indices.length:p.indices.length/2;if(elements)pass.draw(this.quadTopology==='strip'?4:6,elements*range.count,0,elements*range.start);}}
        }
      }
      pass.end();if(this.presentation)this.presentation.encode(encoder,targets,colorTexture);let released=false;
      return {commands:[encoder.finish()],release:(control)=>{if(released)return;released=true;for(const row of refs)this.pool.release(row);return this.presentation?.release(targets,control);}};
    }catch(e){for(const row of refs)this.pool.release(row);this.presentation?.release(targets,{submitted:false});throw e;}
  }
  render(frame){this._check();return this.queue.request(frame);}
  async readPixels(texture,width,height){
    this._check();const row=Math.ceil(width*4/256)*256,size=row*height;
    if(size>this.device.limits.maxBufferSize)throw Error('Readback exceeds device limit');
    const buffer=this.device.createBuffer({label:'Frame async image readback',size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    try{const e=this.device.createCommandEncoder();e.copyTextureToBuffer({texture},{buffer,bytesPerRow:row,rowsPerImage:height},[width,height]);this.device.queue.submit([e.finish()]);await buffer.mapAsync(GPUMapMode.READ);
      const padded=new Uint8Array(buffer.getMappedRange()),pixels=new Uint8Array(width*height*4);for(let y=0;y<height;y++)pixels.set(padded.subarray(y*row,y*row+width*4),y*width*4);buffer.unmap();return pixels;
    }finally{buffer.destroy();}
  }
  _releaseLighting(){if(this.lightingReleased)return this.lightingDone;this.lightingReleased=true;if(this.environmentZero)this.pool.release(this.environmentZero);for(const t of this.environmentBlack??[])t.destroy();this.lightingDone=this.dfg?.release();return this.lightingDone;}
  dispose(){if(this.state==='disposed')return this.disposeDone;this.state='disposed';this.basicModules.clear();this.standardModules.clear();this.pipelines.clear();this.queue.dispose();for(const x of [...this.extensions])x.dispose();for(const h of [...this.handles])this.release(h);this.white?.texture.destroy();this._destroyTargets();const done=this._releaseLighting();if(this.ownsPool)this.pool.dispose();return this.disposeDone=Promise.all([done,this.presentation?.dispose()]);}
}
