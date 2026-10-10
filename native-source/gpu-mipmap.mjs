/** Measured mip generation shared by production and native calibration.
 * RGB loads decode sRGB; every render target write quantizes that mip.
 * This profile is independent of the GL implicit-LOD derivative profile.
 */
export const FRAME_MIP_GENERATION_PROFILES=Object.freeze(['bilinear-center-v1','area-coverage-odd-v1']);
export const FRAME_MIP_GENERATION_SHADER_SHA256=Object.freeze({
 'bilinear-center-v1':'71d2860c11bea4c701340c9d69fa9231245a3b2575cd7f6ec4a7377547af3c7f',
 'area-coverage-odd-v1':'31d89126f109323b8da6b68088ba165afda186dffecd2fea13a8123c10cd9674'
});
export const FRAME_MIP_CALIBRATION_SIZES=Object.freeze([[32,32],[31,19],[3,5],[1,7],[7,1],[6,5],[5,6]].map(Object.freeze));
export const FRAME_MIP_BILINEAR_WGSL=/*wgsl*/`
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
const bilinearFragment=' return textureSampleLevel(sourceMip,mipSampler,input.uv,0.0);';
export const FRAME_MIP_AREA_WGSL=FRAME_MIP_BILINEAR_WGSL.replace(bilinearFragment,/*wgsl*/`
 let extent=textureDimensions(sourceMip,0);
 // Keep passing baseline arithmetic for even extents and unit tails.
 if((extent.x==1u||extent.x%2u==0u)&&(extent.y==1u||extent.y%2u==0u)){
  return textureSampleLevel(sourceMip,mipSampler,input.uv,0.0);
 }
 let destination=max(vec2u(1u),extent/2u);let output=vec2u(input.position.xy);
 let first=output*extent/destination;var color=vec4f(0.0);
 for(var y=0u;y<3u;y++){for(var x=0u;x<3u;x++){
  let source=first+vec2u(x,y);if(any(source>=extent)){continue;}
  // Integer overlap numerators avoid fractional-boundary cancellation.
  let lower=max(source*destination,output*extent);
  let upper=min((source+vec2u(1u))*destination,(output+vec2u(1u))*extent);
  if(any(upper<=lower)){continue;}let overlap=upper-lower;
  let weight=vec2f(overlap)/vec2f(extent);
  color+=textureLoad(sourceMip,vec2i(source),0)*weight.x*weight.y;
 }}
 return color;
`);
export function frameMipGenerationWGSL(profile){
 if(profile==='bilinear-center-v1')return FRAME_MIP_BILINEAR_WGSL;
 if(profile==='area-coverage-odd-v1')return FRAME_MIP_AREA_WGSL;
 throw Error('Known explicitly measured mip generation profile required');
}
export async function frameMipGenerationShaderSHA256(profile){
 const bytes=new TextEncoder().encode(frameMipGenerationWGSL(profile));
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
 if(hash!==FRAME_MIP_GENERATION_SHADER_SHA256[profile])throw Error('Mip generation shader differs from its pinned profile');return hash;
}
export async function createFrameMipGenerator(device,{profile,formats=['rgba8unorm','rgba8unorm-srgb'],guard=()=>{}}={}){
 const code=frameMipGenerationWGSL(profile);guard();const shaderSHA256=await frameMipGenerationShaderSHA256(profile);guard();
 const module=device.createShaderModule({label:'Frame mip generation '+profile,code}),info=await module.getCompilationInfo();guard();
 if(info.messages.some(m=>m.type==='error'))throw Error(info.messages.map(m=>m.message).join('\n'));
 const layout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,sampler:{type:'filtering'}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float',viewDimension:'2d'}}]});
 const sampler=device.createSampler({minFilter:'linear',magFilter:'linear',mipmapFilter:'nearest',addressModeU:'clamp-to-edge',addressModeV:'clamp-to-edge'});
 const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]}),pipelines=new Map();
 for(const format of formats){if(!['rgba8unorm','rgba8unorm-srgb'].includes(format))throw Error('Explicit mip target format required');guard();pipelines.set(format,await device.createRenderPipelineAsync({label:'Frame mip '+profile+' '+format,layout:pipelineLayout,vertex:{module,entryPoint:'mipVertex'},fragment:{module,entryPoint:'mipFragment',targets:[{format}]},primitive:{topology:'triangle-list'}}));guard();}
 return Object.freeze({device,profile,shaderSHA256,module,layout,sampler,pipelines});
}
export function generateFrameMipChain(device,texture,format,levels,setup){
 if(setup?.device!==device||!FRAME_MIP_GENERATION_PROFILES.includes(setup.profile)||setup.shaderSHA256!==FRAME_MIP_GENERATION_SHADER_SHA256[setup.profile]||!Number.isInteger(levels)||levels<1||levels>texture.mipLevelCount)throw Error('Current device and matching mip profile/shader setup required');
 const pipeline=setup.pipelines.get(format);if(!pipeline)throw Error('Mipmap format pipeline was not prepared');const encoder=device.createCommandEncoder({label:'Frame '+setup.profile+' mip chain'});
 for(let level=1;level<levels;level++){
  const source=texture.createView({baseMipLevel:level-1,mipLevelCount:1}),target=texture.createView({baseMipLevel:level,mipLevelCount:1});
  const bind=device.createBindGroup({layout:setup.layout,entries:[{binding:0,resource:setup.sampler},{binding:1,resource:source}]});
  const pass=encoder.beginRenderPass({label:'Frame mip '+level,colorAttachments:[{view:target,loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}}]});
  pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.draw(3);pass.end();
 }
 device.queue.submit([encoder.finish()]);
}
export function assertFrameMipGenerationAttempt(attempt){
 const a=attempt;if(!a||!FRAME_MIP_GENERATION_PROFILES.includes(a.mipGenerationProfile)||a.nativeGPU!==true||a.diagnosticComplete!==true||a.tolerance!==.008||!Array.isArray(a.errors)||a.errors.length||a.baseUploadExact!==true||!Array.isArray(a.cases)||a.cases.length!==FRAME_MIP_CALIBRATION_SIZES.length)throw Error('Mip generation candidate has a GPU/GL/upload or incomplete measurement error');
 let pass=true;
 for(const[w,h]of FRAME_MIP_CALIBRATION_SIZES){
  const rows=a.cases.filter(c=>c.width===w&&c.height===h);if(rows.length!==1)throw Error('Each mip generation control size is required once');const c=rows[0],t=c.defaultTexture;
  if(!c.diagnosticComplete||t?.minFilter!==1008||t.magFilter!==1006||t.generateMipmaps!==true||t.anisotropy!==1||t.colorSpace!=='srgb')throw Error('Actual default source texture controls required');
  let width=w,height=h,level=0;
  do{const r=c.levels?.[level];if(!r||r.level!==level||r.width!==width||r.height!==height||!Number.isFinite(r.maxDecodedAbsolute)||r.maxDecodedAbsolute<0||level===0&&r.exactEncodedMatch!==true)throw Error('Complete finite mip levels and exact base bytes required');pass&&=r.maxDecodedAbsolute<=.008;level++;if(width===1&&height===1)break;width=Math.max(1,Math.floor(width/2));height=Math.max(1,Math.floor(height/2));}while(true);
  if(c.levels.length!==level)throw Error('Mipmap level count does not match the source');
 }
 if(a.pass!==pass||a.mipShaderSHA256!==FRAME_MIP_GENERATION_SHADER_SHA256[a.mipGenerationProfile])throw Error('Measured mip outcome or shader/profile identity inconsistent');return a;
}
export async function selectFrameMipGeneration(attempts,ownerGeneration){
 if(!Number.isSafeInteger(ownerGeneration)||ownerGeneration<1||!Array.isArray(attempts)||attempts.length!==FRAME_MIP_GENERATION_PROFILES.length)throw Error('Fresh GPU generation and complete profile attempts required');
 for(let i=0;i<attempts.length;i++){const a=assertFrameMipGenerationAttempt(attempts[i]);if(a.mipGenerationProfile!==FRAME_MIP_GENERATION_PROFILES[i]||a.ownerGeneration!==ownerGeneration||a.mipShaderSHA256!==await frameMipGenerationShaderSHA256(a.mipGenerationProfile))throw Error('Mip generation shader/profile/generation mismatch');}
 const selected=attempts.find(a=>a.pass);if(!selected)throw Error('No measured mip generation profile passes unchanged .008 controls');
 return {kind:'frame-mip-generation-selection-v1',nativeGPU:true,actualWebGL:true,diagnosticComplete:true,tolerance:.008,errors:[],ownerGeneration,profile:selected.mipGenerationProfile,shaderSHA256:selected.mipShaderSHA256,baselinePreferred:true,attempts};
}
export function assertFrameMipGenerationReceipt(receipt){
 const r=receipt;if(r?.kind!=='frame-mip-generation-selection-v1'||r.nativeGPU!==true||r.actualWebGL!==true||r.diagnosticComplete!==true||r.tolerance!==.008||!Array.isArray(r.errors)||r.errors.length||!Number.isSafeInteger(r.ownerGeneration)||r.ownerGeneration<1||!FRAME_MIP_GENERATION_PROFILES.includes(r.profile)||!Array.isArray(r.attempts)||r.attempts.length!==FRAME_MIP_GENERATION_PROFILES.length)throw Error('Fresh measured mip generation receipt required');
 for(let i=0;i<r.attempts.length;i++){const a=assertFrameMipGenerationAttempt(r.attempts[i]);if(a.mipGenerationProfile!==FRAME_MIP_GENERATION_PROFILES[i]||a.ownerGeneration!==r.ownerGeneration)throw Error('Mip generation receipt attempts are stale or unordered');}
 const first=r.attempts.find(a=>a.pass);if(!first||first.mipGenerationProfile!==r.profile||first.mipShaderSHA256!==r.shaderSHA256||r.baselinePreferred!==true)throw Error('Selected mip generation profile/shader does not match passing measurements');return r;
}
