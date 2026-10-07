/** Owner-run startup scalar derivative calibration. No GPU on import.
 * Temporary Three/WebGL oracle measures the backend profile; this is never a
 * viewport fallback. All temporary resources are fenced and released. */
import {classifyDerivativePixels}from './cubic-derivative-profile.mjs';
const VERTEX=/*wgsl*/`
struct OriginVertex {@builtin(position)position:vec4f,@location(0)local:vec2f}
@vertex fn originVertex(@builtin(vertex_index)i:u32)->OriginVertex {let xy=vec2f(f32((i<<1u)&2u),f32(i&2u))*2.0-vec2f(1.0);return OriginVertex(vec4f(xy,0.0,1.0),xy);}
`;
const expression=(field,language)=>field==='cross'?(language==='wgsl'?'v.local.x*v.local.y':'localProbe.x*localProbe.y'):(language==='wgsl'?'v.local.x+2.0*v.local.y':'localProbe.x+2.0*localProbe.y');
export async function measureFrameCubicDerivativeProfile({sharedDevice,THREE:T,width=8,height=8,tolerance=1e-6}={}){
 if(!sharedDevice?.device||!T?.WebGLRenderer)throw Error('Existing native owner and full bundled Three required');
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<4||height<4||width%2||height%2)throw Error('Even derivative calibration dimensions >=4 required');
 const d=sharedDevice.device,result={diagnosticComplete:false,nativeGPU:true,width,height,tolerance,scope:'Analytic affine/cross scalar fields only; no textures, alpha discard, cubic hook or lighting. Tests backend derivative origin; does not certify cubic parity.',cases:[],errors:[]};
 let renderer,geometry,material,target,nativeTarget,read,scopeOpen=false;const uncaptured=e=>result.errors.push(String(e.error));d.addEventListener('uncapturederror',uncaptured);
 try{
  d.pushErrorScope('validation');scopeOpen=true;renderer=new T.WebGLRenderer({canvas:document.createElement('canvas'),antialias:false});renderer.setSize(width,height);renderer.outputColorSpace=T.LinearSRGBColorSpace;renderer.toneMapping=T.NoToneMapping;renderer.setClearColor(0,0);
  renderer.debug.onShaderError=(gl,program,vs,fs)=>{throw Error('Derivative GL calibration: '+gl.getShaderInfoLog(fs));};
  target=new T.WebGLRenderTarget(width,height,{type:T.FloatType,format:T.RGBAFormat,depthBuffer:false});target.texture.colorSpace=T.LinearSRGBColorSpace;
  const scene=new T.Scene(),camera=new T.OrthographicCamera(-1,1,1,-1,.1,10);camera.position.z=1;geometry=new T.PlaneGeometry(2,2);const quad=new T.Mesh(geometry,null);quad.frustumCulled=false;scene.add(quad);
  nativeTarget=d.createTexture({size:[width,height],format:'rgba32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});const bytesPerRow=Math.ceil(width*16/256)*256;read=d.createBuffer({size:bytesPerRow*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  for(const field of ['affine','cross']){
   material=new T.ShaderMaterial({vertexShader:'varying vec2 localProbe;void main(){localProbe=position.xy;gl_Position=vec4(position.xy,0.0,1.0);}',fragmentShader:'varying vec2 localProbe;void main(){float h='+expression(field,'glsl')+';gl_FragColor=vec4(dFdx(h),dFdy(h),h,1.0);}',depthTest:false,depthWrite:false,toneMapped:false});quad.material=material;renderer.setRenderTarget(target);renderer.render(scene,camera);
   const glBottom=new Float32Array(width*height*4),glPixels=new Float32Array(glBottom.length);renderer.readRenderTargetPixels(target,0,0,width,height,glBottom);for(let y=0;y<height;y++)glPixels.set(glBottom.subarray((height-1-y)*width*4,(height-y)*width*4),y*width*4);
   const glClassification=classifyDerivativePixels(glPixels,field,width,height);
   for(const derivativeMode of ['default','fine','coarse']){
    const suffix=derivativeMode==='default'?'':derivativeMode==='fine'?'Fine':'Coarse',code=VERTEX+'\n@fragment fn originPixel(v:OriginVertex)->@location(0)vec4f {let h='+expression(field,'wgsl')+';return vec4f(dpdx'+suffix+'(h),-dpdy'+suffix+'(h),h,1.0);}',module=d.createShaderModule({code}),info=await module.getCompilationInfo();if(info.messages.some(m=>m.type==='error'))throw Error(info.messages.map(m=>m.message).join('\n'));
    const pipeline=await d.createRenderPipelineAsync({layout:'auto',vertex:{module,entryPoint:'originVertex'},fragment:{module,entryPoint:'originPixel',targets:[{format:'rgba32float'}]}}),encoder=d.createCommandEncoder(),pass=encoder.beginRenderPass({colorAttachments:[{view:nativeTarget.createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}}]});pass.setPipeline(pipeline);pass.draw(3);pass.end();encoder.copyTextureToBuffer({texture:nativeTarget},{buffer:read,bytesPerRow},[width,height]);d.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
    const mapped=new Float32Array(read.getMappedRange()),nativePixels=new Float32Array(width*height*4);for(let y=0;y<height;y++)nativePixels.set(mapped.subarray(y*bytesPerRow/4,y*bytesPerRow/4+width*4),y*width*4);read.unmap();const nativeClassification=classifyDerivativePixels(nativePixels,field,width,height),witnessQuad=[];let mismatch=0;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4,native=Array.from(nativePixels.subarray(i,i+4)),three=Array.from(glPixels.subarray(i,i+4));for(let c=0;c<4;c++){if(!Number.isFinite(native[c])||!Number.isFinite(three[c]))throw Error('Nonfinite derivative calibration pixel');mismatch=Math.max(mismatch,Math.abs(native[c]-three[c]));}if(x<2&&y>=2&&y<=3)witnessQuad.push({x,y,native,three});}
    result.cases.push({field,derivativeMode,maxNativeVsGL:mismatch,glClassification,nativeClassification,witnessQuad});
    if(glClassification[0].maxAbsolute>tolerance||nativeClassification[0].maxAbsolute>tolerance)throw Error('Derivative output does not match any enumerated finite-difference profile');
    if(field==='affine'&&mismatch>tolerance)throw Error('Affine derivative positive control failed');
   }material.dispose();material=null;
  }
  const validation=await d.popErrorScope();scopeOpen=false;if(validation)throw Error(validation.message);if(result.errors.length)throw Error('Derivative calibration uncaptured errors');result.diagnosticComplete=true;result.affineControlPass=true;result.classificationsPass=true;result.parityMatches=result.cases.every(c=>c.maxNativeVsGL<=tolerance);result.note='Completion means analytic fields classified and affine control matched; cross-field GL/native mismatch is preserved in parityMatches and case output. This is not a cubic parity receipt.';
 }catch(error){result.reason=String(error);result.stack=error.stack;}
 finally{if(scopeOpen){const error=await d.popErrorScope();if(error)result.errors.push(error.message);}await d.queue.onSubmittedWorkDone().catch(()=>{});read?.destroy();nativeTarget?.destroy();material?.dispose();geometry?.dispose();target?.dispose();renderer?.dispose();renderer?.forceContextLoss();d.removeEventListener('uncapturederror',uncaptured);}
 return result;
}
