/** Exact frame-cubic-projection-r14 color/view-normal operations.
 * Append shader helpers; caller owns texture policy, lighting/output and draws.
 * No Scene352/Draw288 changes, resource allocations or renderer activation.
 */
const finite=(a,size,name)=>{const values=a?.elements??a;if(values?.length!==size||!Array.from(values).every(x=>Number.isFinite(x)&&Number.isFinite(Math.fround(x))))throw Error(name+': finite Float32-compatible values required');return Array.from(values);};
const unit=v=>{const length=Math.hypot(...v);if(!Number.isFinite(length)||length===0)throw Error('Nonzero finite normal required');return v.map(x=>x/length);};
export function frameCubicWeights(normal){const n=finite(normal,3,'Projection normal'),fourth=n.map(x=>x**4),sum=fourth.reduce((a,b)=>a+b,0);if(!Number.isFinite(sum))throw Error('Bounded projection normal required');return fourth.map(x=>x/Math.max(sum,1e-12));}
export function frameCubicCoordinates(mapInverse,mapNormal,localPosition,localNormal){
 const m=finite(mapInverse,16,'Map inverse'),n=finite(mapNormal,9,'Map normal'),p=finite(localPosition,3,'Local position'),v=finite(localNormal,3,'Local normal');
 const point=Array.from({length:3},(_,r)=>m[r]*p[0]+m[r+4]*p[1]+m[r+8]*p[2]+m[r+12]);
 const direction=unit(Array.from({length:3},(_,r)=>n[r]*v[0]+n[r+3]*v[1]+n[r+6]*v[2]));return {point,direction,weights:frameCubicWeights(direction),uvs:[[point[2],point[1]],[point[0],point[2]],[point[0],point[1]]]};
}
export function frameCubicBumpView(normal,heightDx,heightDyTop,bump,hasMap=true){
 const n=finite(normal,3,'View normal');if(![heightDx,heightDyTop,bump].every(x=>Number.isFinite(x)&&Number.isFinite(Math.fround(x))))throw Error('Finite bump/derivatives required');
 if(!hasMap||Math.abs(bump)<=1e-6)return n;return unit([n[0]-bump*heightDx,n[1]+bump*heightDyTop,n[2]]);
}
export function assertCubicCamera(camera){
 const m=finite(camera?.matrixWorldInverse??camera,16,'View matrix');if(Math.abs(m[3])+Math.abs(m[7])+Math.abs(m[11])+Math.abs(m[15]-1)>1e-6)throw Error('Affine rigid view matrix required for world-space cubic lighting');
 const columns=[m.slice(0,3),m.slice(4,7),m.slice(8,11)];for(let i=0;i<3;i++)for(let j=0;j<3;j++){const dot=columns[i].reduce((s,x,k)=>s+x*columns[j][k],0);if(Math.abs(dot-(i===j?1:0))>1e-6)throw Error('Scaled/sheared camera requires a reviewed view-space lighting adapter');}return true;
}
export function frameCubicWorldNormal(normal,view){
 const n=finite(normal,3,'View normal'),m=finite(view,16,'View matrix');assertCubicCamera(m);return unit([0,4,8].map(i=>m[i]*n[0]+m[i+1]*n[1]+m[i+2]*n[2]));
}
const canonical=s=>String(s).replace(/\r\n/g,'\n').trim();
export function assertCubicMapSubset(material,object,{camera=null}={}){
 if(!material?._frameProjectionInstalled||material.userData?.frameProjection!==true||material.customProgramCacheKey?.()!=='frame-cubic-projection-r14')throw Error('Reviewed cubic r14 material required');
 if(canonical(material.onBeforeCompile)!==CUBIC_COMPILE_SOURCE)throw Error('Cubic compile hook differs from pinned r14 source; reviewed adapter required');
 if(!material.isMeshStandardMaterial||material.isMeshPhysicalMaterial||material.type!=='MeshStandardMaterial')throw Error('Cubic adapter currently covers isotropic MeshStandardMaterial only');
 if(!object?.isMesh||object.isSkinnedMesh||object.isBatchedMesh||object.morphTargetInfluences?.some(v=>v!==0))throw Error('Cubic deformers/custom primitives require evaluated-coordinate adapters');
 if(!object.geometry?.attributes?.normal)throw Error('Reviewed local normal attributes required for cubic projection');
 if(material.flatShading)throw Error('Cubic flat-normal path requires separate full-material comparison');
 for(const key of ['normalMap','bumpMap','displacementMap','roughnessMap','metalnessMap','emissiveMap','alphaMap','lightMap','aoMap','envMap'])if(material[key])throw Error(key+' requires a reviewed cubic/native material adapter');
 if(material.map&&(material.map.isCubeTexture||material.map.isCompressedTexture||material.map.isData3DTexture||material.map.isDataArrayTexture))throw Error('Cubic map requires reviewed native 2D texture policy');
 const uniforms=material._frameUniforms,inv=finite(uniforms?.frameMapInv?.value,16,'frameMapInv'),normal=finite(uniforms?.frameMapNormal?.value,9,'frameMapNormal');
 if(Math.abs(inv[3])+Math.abs(inv[7])+Math.abs(inv[11])+Math.abs(inv[15]-1)>1e-6)throw Error('Affine cubic mapping required');
 const a=inv.slice(0,3),b=inv.slice(4,7),c=inv.slice(8,11),cross=(u,v)=>[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],det=a.reduce((s,x,i)=>s+x*cross(b,c)[i],0);
 if(!Number.isFinite(det)||Math.abs(det)<1e-30)throw Error('Singular cubic mapping requires an explicit adapter');
 const expected=[...cross(b,c),...cross(c,a),...cross(a,b)].map(x=>x/det);
 if(expected.some((x,i)=>Math.abs(x-normal[i])>1e-6*Math.max(1,Math.abs(x))))throw Error('Cubic map normal/inverse relationship differs from pinned updateFrameProjection');
 const bump=uniforms?.frameBump?.value;if(!Number.isFinite(bump)||!Number.isFinite(Math.fround(bump)))throw Error('Finite frameBump required');
 if(camera)assertCubicCamera(camera);return {source:'frame-cubic-projection-r14',hasMap:!!material.map,bump,requiresRigidCamera:true};
}
export const CUBIC_MAP_WGSL=/*wgsl*/`
fn frameCubicTexture(tex:texture_2d<f32>,sampler_:sampler,p:vec3f,n:vec3f)->vec4f {
 var weights=pow(abs(n),vec3f(4.0));weights/=max(dot(weights,vec3f(1.0)),1e-12);
 return textureSample(tex,sampler_,p.zy)*weights.x+textureSample(tex,sampler_,p.xz)*weights.y+textureSample(tex,sampler_,p.xy)*weights.z;
}
fn frameCubicBumpView(viewNormal:vec3f,height:f32,bump:f32,hasMap:bool)->vec3f {
 // GL fragment y grows upward; native fragment y grows downward.
 // Quad pairing and discarded helper lanes require native pixel comparison.
 let gradient=vec3f(dpdx(height),-dpdy(height),0.0);
 if(hasMap&&abs(bump)>0.000001){return normalize(viewNormal-bump*gradient);}return viewNormal;
}
fn frameCubicWorldNormal(viewNormal:vec3f,view:mat4x4f)->vec3f {
 // Exactly Three's normalize((vec4(normal,0) * viewMatrix).xyz).
 return normalize(transpose(mat3x3f(view[0].xyz,view[1].xyz,view[2].xyz))*viewNormal);
}
`;

export const CUBIC_COMPILE_SOURCE="function(shader) {\n     \n     \n    Object.assign(shader.uniforms, this._frameUniforms);\n    shader.vertexShader = `varying vec3 vFrameLocalPos; varying vec3 vFrameLocalNormal;\\n` + shader.vertexShader\n      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\\n vFrameLocalNormal=objectNormal;')\n      .replace('#include <begin_vertex>', '#include <begin_vertex>\\n vFrameLocalPos=transformed;');\n    const textureHelper=`\n#ifdef USE_MAP\nvec4 frameTexture(vec3 p,vec3 n) {\n  vec3 w=pow(abs(n),vec3(4.0)); w/=max(dot(w,vec3(1.0)),1e-12);\n  return texture2D(map,p.zy)*w.x+texture2D(map,p.xz)*w.y+texture2D(map,p.xy)*w.z;\n}\n#endif`;\n    shader.fragmentShader=`varying vec3 vFrameLocalPos; varying vec3 vFrameLocalNormal;\nuniform mat4 frameMapInv; uniform mat3 frameMapNormal; uniform float frameBump;\\n` + shader.fragmentShader;\n     \n    shader.fragmentShader=shader.fragmentShader.replace('#include <map_pars_fragment>','#include <map_pars_fragment>\\n'+textureHelper)\n      .replace('#include <map_fragment>',`#ifdef USE_MAP\n vec3 frameP=(frameMapInv*vec4(vFrameLocalPos,1.0)).xyz;\n vec3 frameN=normalize(frameMapNormal*vFrameLocalNormal);\n diffuseColor*=frameTexture(frameP,frameN);\n#endif`)\n      .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>\n#ifdef USE_MAP\n if(abs(frameBump)>0.000001){\n  vec3 bumpP=(frameMapInv*vec4(vFrameLocalPos,1.0)).xyz;\n  vec3 bumpN=normalize(frameMapNormal*vFrameLocalNormal);\n  float bumpH=dot(frameTexture(bumpP,bumpN).rgb,vec3(0.299,0.587,0.114));\n  normal=normalize(normal-frameBump*vec3(dFdx(bumpH),dFdy(bumpH),0.0));\n }\n#endif`);\n  }";
export const CUBIC_EDITOR_SHA256="bd10bbf25afa20196de6750fd6f2b6dfd3eb8bdb309c1b240823f1e6e0dd7222";
export const CUBIC_INSTALL_SHA256="896d34b262c68b5a136db117cfdd41f18b7ed5efc7f2237c84ce21840fc5abed";
export const CUBIC_UPDATE_SHA256="4ae3c5fffa49a4068f197dd25a4a3d569d120b46e0a288d186a8009a305f08dc";

/** Explicit measured GL coarse-bottom-left contract, not a vendor heuristic. */
export function assertCubicDerivativeCapability({calibration,canvasHeight,sampleCount=1,texturePolicy,sourceTexture=null}={}){
 if(!Number.isInteger(canvasHeight)||canvasHeight<1||canvasHeight>=2**24)throw Error('Full integer canvas height required for GL quad phase');
 if(sampleCount!==1)throw Error('Cubic coarse reconstruction requires single-sample rasterization');
 if(!calibration?.diagnosticComplete||calibration.nativeGPU!==true||!calibration.affineControlPass||!calibration.classificationsPass||!Array.isArray(calibration.errors)||calibration.errors.length)throw Error('Native derivative calibration required; CPU/source receipts cannot enable this path');
 const cross=calibration.cases?.filter(c=>c.field==='cross');
 if(cross?.length!==3||!['default','fine','coarse'].every(mode=>cross.some(c=>c.derivativeMode===mode))||cross.some(c=>c.glClassification?.[0]?.profile!=='coarse-bottom-left'||!Number.isFinite(c.glClassification[0].maxAbsolute)||c.glClassification[0].maxAbsolute>1e-6))throw Error('Measured GL coarse-bottom-left derivative profile required');
 const sampler=texturePolicy?.sampler;
 if(texturePolicy?.mipLevelCount!==1||!['nearest','linear'].includes(sampler?.minFilter)||sampler.minFilter!==sampler.magFilter||(sampler.maxAnisotropy??1)!==1)throw Error('One mip with matching nearest/linear min/mag and no anisotropy required');
 if(sourceTexture&&(![1003,1006].includes(sourceTexture.minFilter)||sourceTexture.minFilter!==sourceTexture.magFilter||(sourceTexture.anisotropy??1)!==1))throw Error('Source cubic sampler requires base-level nearest/linear filtering');
 return {profile:'coarse-bottom-left',canvasHeight,sampleCount:1,coreWGSL:true,mipLevelCount:1};
}
export function frameCubicQuadCenters(fragmentXY,canvasHeight){
 const p=finite(fragmentXY,2,'Fragment coordinate');if(!Number.isInteger(canvasHeight)||canvasHeight<1||canvasHeight>=2**24)throw Error('Full integer canvas height required');
 const left=2*Math.floor(Math.floor(p[0])/2)+.5,glRow=canvasHeight-1-Math.floor(p[1]),glBottom=2*Math.floor(glRow/2),bottom=canvasHeight-glBottom-.5;
 return {lowerLeft:[left,bottom],lowerRight:[left+1,bottom],upperLeft:[left,bottom-1]};
}
export function frameCubicReconstructAt(state,fragmentXY,sampleXY){
 const p=finite(fragmentXY,2,'Fragment coordinate'),t=finite(sampleXY,2,'Sample coordinate'),d=t.map((x,i)=>x-p[i]);
 const {reciprocal,reciprocalDx,reciprocalDy}=state;if(![reciprocal,reciprocalDx,reciprocalDy].every(Number.isFinite))throw Error('Finite reciprocal-w fields required');
 const r=reciprocal+reciprocalDx*d[0]+reciprocalDy*d[1];if(!Number.isFinite(r)||r===0)throw Error('Reconstructed reciprocal-w must be finite and nonzero');
 const reconstruct=(q,x,y)=>{q=finite(q,3,'Affine numerator');x=finite(x,3,'Affine x slope');y=finite(y,3,'Affine y slope');return q.map((v,i)=>(v+x[i]*d[0]+y[i]*d[1])/r);};
 return {local:reconstruct(state.qPosition,state.qPositionDx,state.qPositionDy),localNormal:reconstruct(state.qNormal,state.qNormalDx,state.qNormalDy),reciprocal:r};
}
export function frameCubicBumpViewGradient(viewNormal,gradient,bump,hasMap=true){
 const n=finite(viewNormal,3,'View normal'),g=finite(gradient,3,'GL gradient');if(!Number.isFinite(bump)||!Number.isFinite(Math.fround(bump)))throw Error('Finite bump required');
 if(!hasMap||Math.abs(bump)<=1e-6)return n;return unit(n.map((v,i)=>v-bump*g[i]));
}
export const CUBIC_GL_COARSE_WGSL=/*wgsl*/`
struct FrameCubicAffineState {
 qPosition:vec3f,qNormal:vec3f,reciprocal:f32,
 qPositionDx:vec3f,qPositionDy:vec3f,qNormalDx:vec3f,qNormalDy:vec3f,
 reciprocalDx:f32,reciprocalDy:f32
}
fn frameCubicHeightAtBase(tex:texture_2d<f32>,sampler_:sampler,state:FrameCubicAffineState,delta:vec2f,mapInverse:mat4x4f,mapNormal:mat4x4f)->f32 {
 let r=state.reciprocal+state.reciprocalDx*delta.x+state.reciprocalDy*delta.y;
 let local=(state.qPosition+state.qPositionDx*delta.x+state.qPositionDy*delta.y)/r;
 let localNormal=(state.qNormal+state.qNormalDx*delta.x+state.qNormalDy*delta.y)/r;
 let p=(mapInverse*vec4f(local,1.0)).xyz;let n=normalize((mapNormal*vec4f(localNormal,0.0)).xyz);
 var weights=pow(abs(n),vec3f(4.0));weights/=max(dot(weights,vec3f(1.0)),1e-12);
 let color=textureSampleLevel(tex,sampler_,p.zy,0.0)*weights.x+textureSampleLevel(tex,sampler_,p.xz,0.0)*weights.y+textureSampleLevel(tex,sampler_,p.xy,0.0)*weights.z;
 return dot(color.rgb,vec3f(0.299,0.587,0.114));
}
fn frameCubicGradientGLCoarse(tex:texture_2d<f32>,sampler_:sampler,local:vec3f,localNormal:vec3f,fragmentPosition:vec4f,mapInverse:mat4x4f,mapNormal:mat4x4f,canvasHeight:f32)->vec3f {
 // Perspective interpolation divided by its reciprocal-w is rational. The
 // numerators below and reciprocal-w itself are affine on the triangle.
 let r=fragmentPosition.w;let qPosition=local*r;let qNormal=localNormal*r;
 let state=FrameCubicAffineState(qPosition,qNormal,r,dpdxFine(qPosition),dpdyFine(qPosition),dpdxFine(qNormal),dpdyFine(qNormal),dpdxFine(r),dpdyFine(r));
 let pixel=floor(fragmentPosition.xy);let glRow=canvasHeight-1.0-pixel.y;
 let left=2.0*floor(pixel.x*0.5)+0.5;let bottom=canvasHeight-2.0*floor(glRow*0.5)-0.5;
 let delta=vec2f(left,bottom)-fragmentPosition.xy;
 let lowerLeft=frameCubicHeightAtBase(tex,sampler_,state,delta,mapInverse,mapNormal);
 let lowerRight=frameCubicHeightAtBase(tex,sampler_,state,delta+vec2f(1.0,0.0),mapInverse,mapNormal);
 let upperLeft=frameCubicHeightAtBase(tex,sampler_,state,delta-vec2f(0.0,1.0),mapInverse,mapNormal);
 return vec3f(lowerRight-lowerLeft,upperLeft-lowerLeft,0.0);
}
fn frameCubicBumpViewGradient(viewNormal:vec3f,gradient:vec3f,bump:f32,hasMap:bool)->vec3f {
 if(hasMap&&abs(bump)>0.000001){return normalize(viewNormal-bump*gradient);}return viewNormal;
}
`;

/** Experimental runtime domain gate; canonical single-sample gate above stays intact.
 * A measured GL profile is required even at 1x. The caller must explicitly opt
 * into experimental 4x after reviewing the native window-domain receipt.
 */
export function assertCubicWindowDerivativeCapability({calibration,canvasHeight,sampleCount=1,texturePolicy,sourceTexture=null,experimentalMSAA=false}={}){
 if(![1,4].includes(sampleCount))throw Error('Window cubic sampleCount must be 1 or 4');
 if(sampleCount===4&&experimentalMSAA!==true)throw Error('Experimental gl-window cubic MSAA requires explicit integration approval');
 const base=assertCubicDerivativeCapability({calibration,canvasHeight,sampleCount:1,texturePolicy,sourceTexture});
 return {...base,renderDomain:'gl-window',sampleCount,experimentalOnly:true};
}
export function frameCubicGLWindowCenters(fragmentXY){
 const p=finite(fragmentXY,2,'GL-window fragment coordinate');if(p.some(v=>v<0))throw Error('Nonnegative GL-window fragment coordinate required');
 const [x,y]=p.map(v=>2*Math.floor(Math.floor(v)/2)+.5);return {lowerLeft:[x,y],lowerRight:[x+1,y],upperLeft:[x,y+1]};
}
// This is the exact reflected candidate tested by the native 126/1920 matrices.
// Guard both replacements so later canonical helper edits cannot silently drift.
const windowPhaseSource='let pixel=floor(fragmentPosition.xy);let glRow=canvasHeight-1.0-pixel.y;\n let left=2.0*floor(pixel.x*0.5)+0.5;let bottom=canvasHeight-2.0*floor(glRow*0.5)-0.5;';
const windowUpperSource='delta-vec2f(0.0,1.0)';
if(!CUBIC_GL_COARSE_WGSL.includes(windowPhaseSource)||!CUBIC_GL_COARSE_WGSL.includes(windowUpperSource))throw Error('Canonical cubic reconstruction changed; review reflected helper');
export const CUBIC_GL_WINDOW_WGSL=CUBIC_GL_COARSE_WGSL.replace(windowPhaseSource,'let pixel=floor(fragmentPosition.xy);\n let left=2.0*floor(pixel.x*0.5)+0.5;let bottom=2.0*floor(pixel.y*0.5)+0.5;').replace(windowUpperSource,'delta+vec2f(0.0,1.0)');

/** PRIVATE add-on. Baseline canonical and one-mip helpers remain untouched.
 * Caller supplies the original reflected affine helper so this add-on neither
 * imports a second runtime role nor changes layouts, bindings or ownership.
 */
export const FRAME_CUBIC_MIP_RECEIPT_KIND='frame-cubic-mip-window-v1';
export const FRAME_CUBIC_MIP_PROFILES=['fine','coarse-bottom-left','coarse-bottom-right','coarse-top-left','coarse-top-right'];
const oldHeight=`fn frameCubicHeightAtBase(tex:texture_2d<f32>,sampler_:sampler,state:FrameCubicAffineState,delta:vec2f,mapInverse:mat4x4f,mapNormal:mat4x4f)->f32 {`;
const oldLower=` let lowerLeft=frameCubicHeightAtBase(tex,sampler_,state,delta,mapInverse,mapNormal);
 let lowerRight=frameCubicHeightAtBase(tex,sampler_,state,delta+vec2f(1.0,0.0),mapInverse,mapNormal);
 let upperLeft=frameCubicHeightAtBase(tex,sampler_,state,delta+vec2f(0.0,1.0),mapInverse,mapNormal);`;
const pointWGSL=/*wgsl*/`
struct FrameCubicMipPoint {p:vec3f,n:vec3f}
fn frameCubicMipPointAt(state:FrameCubicAffineState,delta:vec2f,mapInverse:mat4x4f,mapNormal:mat4x4f)->FrameCubicMipPoint {
 let r=state.reciprocal+state.reciprocalDx*delta.x+state.reciprocalDy*delta.y;
 let local=(state.qPosition+state.qPositionDx*delta.x+state.qPositionDy*delta.y)/r;
 let localNormal=(state.qNormal+state.qNormalDx*delta.x+state.qNormalDy*delta.y)/r;
 return FrameCubicMipPoint((mapInverse*vec4f(local,1.0)).xyz,normalize((mapNormal*vec4f(localNormal,0.0)).xyz));
}
fn frameCubicHeightAtGrad(tex:texture_2d<f32>,sampler_:sampler,point:FrameCubicMipPoint,dx:vec3f,dy:vec3f)->f32 {
 // Gradients belong to projected UVs; the normalized raw normal only controls
 // the source's fourth-power color weights and never the sampler footprint.
 let p=point.p;var weights=pow(abs(point.n),vec3f(4.0));weights/=max(dot(weights,vec3f(1.0)),1e-12);
 let color=textureSampleGrad(tex,sampler_,p.zy,dx.zy,dy.zy)*weights.x+textureSampleGrad(tex,sampler_,p.xz,dx.xz,dy.xz)*weights.y+textureSampleGrad(tex,sampler_,p.xy,dx.xy,dy.xy)*weights.z;
 return dot(color.rgb,vec3f(0.299,0.587,0.114));
}
`;
/** Compile-time selection follows an independently measured GL implicitLOD
 * profile. The exported color frameCubicTexture keeps implicit textureSample.
 */
export function cubicGLWindowMipWGSL(windowWGSL,implicitLODProfile){
 if(!FRAME_CUBIC_MIP_PROFILES.includes(implicitLODProfile))throw Error('Measured GL implicitLOD footprint profile required');
 if(typeof windowWGSL!=='string'||windowWGSL.split(oldHeight).length!==2||windowWGSL.split(oldLower).length!==2||!windowWGSL.includes('let bottom=2.0*floor(pixel.y*0.5)+0.5;'))throw Error('Pinned reflected affine reconstruction required for mip add-on');
 const a=windowWGSL.indexOf(oldHeight),b=windowWGSL.indexOf('\nfn frameCubicGradientGLCoarse(',a);if(b<a)throw Error('Reflected reconstruction function boundary changed');
 const points=` let ll=frameCubicMipPointAt(state,delta,mapInverse,mapNormal);
 let lr=frameCubicMipPointAt(state,delta+vec2f(1.0,0.0),mapInverse,mapNormal);
 let ul=frameCubicMipPointAt(state,delta+vec2f(0.0,1.0),mapInverse,mapNormal);
 let ur=frameCubicMipPointAt(state,delta+vec2f(1.0,1.0),mapInverse,mapNormal);
 let bottomDx=lr.p-ll.p;let topDx=ur.p-ul.p;let leftDy=ul.p-ll.p;let rightDy=ur.p-lr.p;`;
 let samples;if(implicitLODProfile==='fine')samples=`
 let lowerLeft=frameCubicHeightAtGrad(tex,sampler_,ll,bottomDx,leftDy);
 let lowerRight=frameCubicHeightAtGrad(tex,sampler_,lr,bottomDx,rightDy);
 let upperLeft=frameCubicHeightAtGrad(tex,sampler_,ul,topDx,leftDy);`;
 else {const dx=implicitLODProfile.includes('bottom')?'bottomDx':'topDx',dy=implicitLODProfile.endsWith('left')?'leftDy':'rightDy';samples=`
 let lowerLeft=frameCubicHeightAtGrad(tex,sampler_,ll,${dx},${dy});
 let lowerRight=frameCubicHeightAtGrad(tex,sampler_,lr,${dx},${dy});
 let upperLeft=frameCubicHeightAtGrad(tex,sampler_,ul,${dx},${dy});`;}
 return (windowWGSL.slice(0,a)+pointWGSL+windowWGSL.slice(b)).replace(oldLower,points+samples);
}
function scalarCalibration(calibration){if(!calibration?.diagnosticComplete||calibration.nativeGPU!==true||!calibration.affineControlPass||!calibration.classificationsPass||!Array.isArray(calibration.errors)||calibration.errors.length)throw Error('Native derivative calibration required; CPU/source receipts cannot enable this path');const cross=calibration.cases?.filter(c=>c.field==='cross');if(cross?.length!==3||!['default','fine','coarse'].every(mode=>cross.some(c=>c.derivativeMode===mode))||cross.some(c=>c.glClassification?.[0]?.profile!=='coarse-bottom-left'||!Number.isFinite(c.glClassification[0].maxAbsolute)||c.glClassification[0].maxAbsolute>1e-6))throw Error('Measured GL coarse-bottom-left derivative profile required');}
/** Source/CPU checks cannot construct this receipt. The caller separately owns
 * device/generation freshness, as for the existing scalar capability.
 */
export function assertCubicWindowMipDerivativeCapability({calibration,textureLODCalibration,canvasHeight,sampleCount=1,texturePolicy,sourceTexture,experimentalMSAA=false}={}){
 if(!Number.isInteger(canvasHeight)||canvasHeight<1||canvasHeight>=2**24)throw Error('Full integer canvas height required for GL quad phase');if(![1,4].includes(sampleCount))throw Error('Window cubic sampleCount must be 1 or 4');if(sampleCount===4&&experimentalMSAA!==true)throw Error('Experimental gl-window cubic MSAA requires explicit integration approval');scalarCalibration(calibration);
 const s=texturePolicy?.sampler,t=sourceTexture,levels=texturePolicy?.mipLevelCount,min=t?.minFilter,mag=t?.magFilter;if(!t||![1004,1005,1007,1008].includes(min)||mag!==([1004,1005].includes(min)?1003:1006)||(t.anisotropy??1)!==1||t.generateMipmaps===false||t.mipmaps?.length)throw Error('Matching native/source mip-filtered nearest or linear texture with generated mips and anisotropy 1 required');
 if(!Number.isInteger(levels)||levels<1||!Number.isInteger(texturePolicy.width)||!Number.isInteger(texturePolicy.height)||Math.min(texturePolicy.width,texturePolicy.height)<1||levels!==1+Math.floor(Math.log2(Math.max(texturePolicy.width,texturePolicy.height)))||s?.minFilter!==([1004,1005].includes(min)?'nearest':'linear')||s.magFilter!==s.minFilter||s.mipmapFilter!==([1005,1008].includes(min)?'linear':'nearest')||(s.maxAnisotropy??1)!==1||s.lodMinClamp!==0||s.lodMaxClamp!==levels-1)throw Error('Unmodified full generated mip-chain texture policy required');
 const receipt=textureLODCalibration;if(receipt?.kind!==FRAME_CUBIC_MIP_RECEIPT_KIND||receipt.nativeGPU!==true||receipt.actualWebGL!==true||receipt.diagnosticComplete!==true||receipt.mipChainControlPass!==true||receipt.colorControlPass!==true||receipt.bumpControlPass!==true||receipt.implicitLODProfilePass!==true||receipt.tolerance!==.008||!Array.isArray(receipt.errors)||receipt.errors.length||!FRAME_CUBIC_MIP_PROFILES.includes(receipt.implicitLODProfile)||!receipt.sampleCounts?.includes(sampleCount)||!receipt.sourceFilters?.some(v=>v.minFilter===min&&v.magFilter===mag))throw Error('Fresh native/actual GL mip/color/bump and implicitLOD receipt required; scalar or CPU receipts cannot enable mip reconstruction');
 return {profile:'coarse-bottom-left',implicitLODProfile:receipt.implicitLODProfile,canvasHeight,sampleCount,coreWGSL:true,mipLevelCount:levels,renderDomain:'gl-window',experimentalOnly:true,textureSubset:'generated-mips-matching-filters-anisotropy1'};
}

/** CPU model of all four rational quad samples and sampler UV footprints.
 * It verifies reconstruction arithmetic only, never hardware acceptance.
 */
export function frameCubicMipFootprints({state,fragmentXY,mapInverse,mapNormal,reconstructAt,coordinates,quadCenters,implicitLODProfile}){if(!FRAME_CUBIC_MIP_PROFILES.includes(implicitLODProfile))throw Error('Explicit footprint profile required');const centers=quadCenters(fragmentXY),points={...centers,upperRight:[centers.lowerRight[0],centers.upperLeft[1]]},values=Object.fromEntries(Object.entries(points).map(([k,p])=>{const local=reconstructAt(state,fragmentXY,p);return [k,coordinates(mapInverse,mapNormal,local.local,local.localNormal)];}));const subtract=(a,b)=>a.map((v,i)=>v-b[i]),dxBottom=subtract(values.lowerRight.point,values.lowerLeft.point),dxTop=subtract(values.upperRight.point,values.upperLeft.point),dyLeft=subtract(values.upperLeft.point,values.lowerLeft.point),dyRight=subtract(values.upperRight.point,values.lowerRight.point);return Object.fromEntries(Object.entries(values).map(([k,v])=>{const dx=implicitLODProfile==='fine'?(k.startsWith('lower')?dxBottom:dxTop):(implicitLODProfile.includes('bottom')?dxBottom:dxTop),dy=implicitLODProfile==='fine'?(k.endsWith('Left')?dyLeft:dyRight):(implicitLODProfile.endsWith('left')?dyLeft:dyRight),uvs=v.uvs;return [k,{...v,uvs,dx:[[dx[2],dx[1]],[dx[0],dx[2]],[dx[0],dx[1]]],dy:[[dy[2],dy[1]],[dy[0],dy[2]],[dy[0],dy[1]]]}];}));}
