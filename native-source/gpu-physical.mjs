/** Isotropic MeshStandard + Lambert math pinned to bundled Three r186.
 * No display/editor/Scene ABI changes. Physical extensions require adapters.
 * Source-derived DFG table is appended by the private delivery generator.
 */
// Shader formulas and DFG data: Copyright 2010-2026 Three.js Authors, MIT.
export const PHYSICAL_THREE_SHA256='ed200c36396533a895a276bdf539ca86bd7ec8909d483de4f6eb5bda32cb24ec';
export const PHYSICAL_DFG_LAYOUT_ENTRY=Object.freeze({binding:2,visibility:2,texture:Object.freeze({sampleType:'unfilterable-float'})});
const saturation=x=>Math.max(0,Math.min(1,x)),mix=(a,b,t)=>a.map((v,i)=>v*(1-t)+b[i]*t);
const rgb=(v,name)=>{if(v?.length!==3||!Array.from(v).every(Number.isFinite))throw Error(name+': finite RGB required');return Array.from(v);};
export function assertStandardCoverage(material,{defaultOnBeforeCompile,defaultCustomProgramCacheKey,defaultOnBeforeRender}={}){
 if(material?.isMeshPhysicalMaterial||material?.type!=='MeshStandardMaterial'||!material.isMeshStandardMaterial)throw Error('Only isotropic MeshStandardMaterial is covered; physical/custom materials require adapters');
 if(Object.entries(material.defines??{}).some(([key,value])=>key!=='STANDARD'||value!==''))throw Error('Custom material defines require a reviewed native shader adapter');
 for(const key of ['alphaMap','aoMap','lightMap','bumpMap','normalMap','displacementMap','emissiveMap','roughnessMap','metalnessMap','envMap'])if(material[key])throw Error(key+' requires an explicit native material adapter');
 for(const [key,expected]of [['onBeforeCompile',defaultOnBeforeCompile],['customProgramCacheKey',defaultCustomProgramCacheKey],['onBeforeRender',defaultOnBeforeRender]])if(material[key]&&material[key]!==expected)throw Error(key+' requires a reviewed native hook adapter');
 if(![material.roughness,material.metalness].every(x=>Number.isFinite(x)&&x>=0&&x<=1))throw Error('Bounded Standard roughness/metalness required');
 return true;
}
export function decodeHalf(word){const sign=word&0x8000?-1:1,exponent=(word>>>10)&31,fraction=word&1023;return exponent===0?sign*fraction*2**-24:exponent===31?(fraction?NaN:sign*Infinity):sign*(1+fraction/1024)*2**(exponent-15);}
export function sampleStandardDfg(roughness,dotNV){
 if(![roughness,dotNV].every(Number.isFinite))throw Error('Finite DFG coordinates required');
 const x=saturation(roughness)*16-.5,y=saturation(dotNV)*16-.5,ix=Math.floor(x),iy=Math.floor(y),tx=x-ix,ty=y-iy;
 const texel=(u,v,c)=>decodeHalf(DFG_HALF_WORDS[(Math.max(0,Math.min(15,v))*16+Math.max(0,Math.min(15,u)))*2+c]);
 return [0,1].map(c=>(texel(ix,iy,c)*(1-tx)+texel(ix+1,iy,c)*tx)*(1-ty)+(texel(ix,iy+1,c)*(1-tx)+texel(ix+1,iy+1,c)*tx)*ty);
}
export function physicalSchlick(f0,f90,dotVH){const f=2**((-5.55473*dotVH-6.98316)*dotVH);return rgb(f0,'F0').map(v=>v*(1-f)+f90*f);}
export function physicalSmith(alpha,dotNL,dotNV){const a2=alpha*alpha,gv=dotNL*Math.sqrt(a2+(1-a2)*dotNV*dotNV),gl=dotNV*Math.sqrt(a2+(1-a2)*dotNL*dotNL);return .5/Math.max(gv+gl,1e-6);}
export function physicalDistribution(alpha,dotNH){const a2=alpha*alpha,denom=dotNH*dotNH*(a2-1)+1;return (1/Math.PI)*a2/(denom*denom);}
export function standardMaterialState(base,roughness,metalness,geometryRoughness,dotNV){
 const color=rgb(base,'Base');if(![roughness,metalness,geometryRoughness,dotNV].every(Number.isFinite)||roughness<0||roughness>1||metalness<0||metalness>1||geometryRoughness<0)throw Error('Bounded Standard parameters required');
 const r=Math.min(Math.max(roughness,.0525)+geometryRoughness,1),dfg=sampleStandardDfg(r,saturation(dotNV)),specularColor=[.04,.04,.04],specularColorBlended=mix(specularColor,color,metalness),ess=dfg[0]+dfg[1];
 return {diffuseColor:color,diffuseContribution:color.map(v=>v*(1-metalness)),specularColor,specularColorBlended,specularF90:1,roughness:r,metalness,dfg,multiScatteringCompensation:specularColorBlended.map(v=>1+v*(1/ess-1))};
}
export function physicalMultiscattering(dfg,specularColor,f90=1){
 const single=rgb(specularColor,'Specular').map(v=>v*dfg[0]+f90*dfg[1]),ems=1-dfg[0]-dfg[1],average=specularColor.map(v=>v+(1-v)*.047619);
 return {single,multi:single.map((v,i)=>v*average[i]/(1-ems*average[i])*ems)};
}
const unit=v=>{const a=rgb(v,'Direction'),length=Math.hypot(...a);if(length===0)throw Error('Nonzero direction required');return a.map(x=>x/length);},dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
export function standardDirectCPU(m,normal,view,light,lightColor){
 const n=unit(normal),v=unit(view),l=unit(light),nl=saturation(dot(n,l)),color=rgb(lightColor,'Light');if(nl===0)return {diffuse:[0,0,0],specular:[0,0,0]};
 const half=unit(l.map((x,i)=>x+v[i])),nv=saturation(dot(n,v)),nh=saturation(dot(n,half)),vh=saturation(dot(v,half)),irradiance=color.map(x=>nl*x);
 const f=physicalSchlick(m.specularColorBlended,m.specularF90,vh),fd=physicalSchlick(m.specularColor,m.specularF90,vh),vd=physicalSmith(m.roughness*m.roughness,nl,nv)*physicalDistribution(m.roughness*m.roughness,nh);
 return {diffuse:irradiance.map((x,i)=>x*m.diffuseContribution[i]/Math.PI*(1-fd[i])),specular:irradiance.map((x,i)=>x*f[i]*vd*m.multiScatteringCompensation[i])};
}
export function standardIndirectDiffuseCPU(m,irradiance){const s=physicalMultiscattering(m.dfg,m.specularColor,m.specularF90);return rgb(irradiance,'Irradiance').map((x,i)=>x*m.diffuseContribution[i]/Math.PI*(1-s.single[i]-s.multi[i]));}
export function standardIBLCPU(m,radiance,iblIrradiance){
 const dielectric=physicalMultiscattering(m.dfg,m.specularColor,m.specularF90),metallic=physicalMultiscattering(m.dfg,m.diffuseColor,m.specularF90),single=mix(dielectric.single,metallic.single,m.metalness),multi=mix(dielectric.multi,metallic.multi,m.metalness),cosine=rgb(iblIrradiance,'IBL irradiance').map(x=>x/Math.PI),r=rgb(radiance,'Radiance');
 return {diffuse:cosine.map((x,i)=>x*m.diffuseContribution[i]*(1-dielectric.single[i]-dielectric.multi[i])),specular:r.map((x,i)=>x*single[i]+cosine[i]*multi[i])};
}

export const PHYSICAL_MATH_WGSL=/*wgsl*/`
struct PhysicalStandard {
 diffuseColor:vec3f,diffuseContribution:vec3f,specularColor:vec3f,specularColorBlended:vec3f,
 roughness:f32,metalness:f32,specularF90:f32,dfg:vec2f,multiScatteringCompensation:vec3f
}
struct PhysicalLighting {diffuse:vec3f,specular:vec3f}
struct PhysicalScattering {single:vec3f,multi:vec3f}
fn physicalSchlick(f0:vec3f,f90:f32,dotVH:f32)->vec3f {let fresnel=exp2((-5.55473*dotVH-6.98316)*dotVH);return f0*(1.0-fresnel)+vec3f(f90*fresnel);}
fn physicalSmith(alpha:f32,dotNL:f32,dotNV:f32)->f32 {let a2=alpha*alpha;let gv=dotNL*sqrt(a2+(1.0-a2)*dotNV*dotNV);let gl=dotNV*sqrt(a2+(1.0-a2)*dotNL*dotNL);return 0.5/max(gv+gl,1e-6);}
fn physicalDistribution(alpha:f32,dotNH:f32)->f32 {let a2=alpha*alpha;let denominator=dotNH*dotNH*(a2-1.0)+1.0;return 0.3183098861837907*a2/(denominator*denominator);}
fn physicalGeometryRoughness(nonPerturbedNormal:vec3f)->f32 {let dxy=max(abs(dpdx(nonPerturbedNormal)),abs(dpdy(nonPerturbedNormal)));return max(max(dxy.x,dxy.y),dxy.z);}
fn physicalEffectiveRoughness(roughness:f32,geometryRoughness:f32)->f32 {return min(max(roughness,0.0525)+geometryRoughness,1.0);}
fn physicalPrepareStandard(base:vec3f,roughness:f32,metalness:f32,dfg:vec2f)->PhysicalStandard {
 let dielectric=vec3f(0.04);let blended=mix(dielectric,base,metalness);let compensation=vec3f(1.0)+blended*(1.0/(dfg.x+dfg.y)-1.0);
 return PhysicalStandard(base,base*(1.0-metalness),dielectric,blended,roughness,metalness,1.0,dfg,compensation);
}
fn physicalLambertDirect(base:vec3f,normal:vec3f,lightDirection:vec3f,lightColor:vec3f)->vec3f {return clamp(dot(normal,lightDirection),0.0,1.0)*lightColor*base*0.3183098861837907;}
fn physicalLambertIndirect(base:vec3f,irradiance:vec3f)->vec3f {return irradiance*base*0.3183098861837907;}
fn physicalStandardDirect(m:PhysicalStandard,normal:vec3f,viewDirection:vec3f,lightDirection:vec3f,lightColor:vec3f)->PhysicalLighting {
 let nl=clamp(dot(normal,lightDirection),0.0,1.0);if(nl==0.0){return PhysicalLighting(vec3f(0.0),vec3f(0.0));}
 let halfDirection=normalize(lightDirection+viewDirection);let nv=clamp(dot(normal,viewDirection),0.0,1.0);let nh=clamp(dot(normal,halfDirection),0.0,1.0);let vh=clamp(dot(viewDirection,halfDirection),0.0,1.0);
 let irradiance=nl*lightColor;let alpha=m.roughness*m.roughness;let f=physicalSchlick(m.specularColorBlended,m.specularF90,vh);let fd=physicalSchlick(m.specularColor,m.specularF90,vh);
 let specular=irradiance*f*(physicalSmith(alpha,nl,nv)*physicalDistribution(alpha,nh))*m.multiScatteringCompensation;
 let diffuse=irradiance*m.diffuseContribution*0.3183098861837907*(vec3f(1.0)-fd);return PhysicalLighting(diffuse,specular);
}
fn physicalMultiscattering(dfg:vec2f,specular:vec3f,f90:f32)->PhysicalScattering {
 let single=specular*dfg.x+vec3f(f90*dfg.y);let ems=1.0-dfg.x-dfg.y;let average=specular+(vec3f(1.0)-specular)*0.047619;
 let multi=single*average/(vec3f(1.0)-ems*average)*ems;return PhysicalScattering(single,multi);
}
fn physicalStandardIndirectDiffuse(m:PhysicalStandard,irradiance:vec3f)->vec3f {let dielectric=physicalMultiscattering(m.dfg,m.specularColor,m.specularF90);return irradiance*m.diffuseContribution*0.3183098861837907*(vec3f(1.0)-dielectric.single-dielectric.multi);}
fn physicalStandardIBL(m:PhysicalStandard,radiance:vec3f,iblIrradiance:vec3f)->PhysicalLighting {
 let dielectric=physicalMultiscattering(m.dfg,m.specularColor,m.specularF90);let metallic=physicalMultiscattering(m.dfg,m.diffuseColor,m.specularF90);
 let single=mix(dielectric.single,metallic.single,m.metalness);let multi=mix(dielectric.multi,metallic.multi,m.metalness);let cosineIrradiance=iblIrradiance*0.3183098861837907;
 return PhysicalLighting(m.diffuseContribution*(vec3f(1.0)-dielectric.single-dielectric.multi)*cosineIrradiance,radiance*single+multi*cosineIrradiance);
}
`;
export const PHYSICAL_WGSL=PHYSICAL_MATH_WGSL+/*wgsl*/`
@group(0) @binding(2) var physicalDfgTexture:texture_2d<f32>;
fn physicalDfg(roughness:f32,dotNV:f32)->vec2f {
 let p=clamp(vec2f(roughness,dotNV),vec2f(0.0),vec2f(1.0))*16.0-vec2f(0.5);let xy=vec2i(floor(p));let t=fract(p);
 let a=textureLoad(physicalDfgTexture,clamp(xy,vec2i(0),vec2i(15)),0).rg;let b=textureLoad(physicalDfgTexture,clamp(xy+vec2i(1,0),vec2i(0),vec2i(15)),0).rg;
 let c=textureLoad(physicalDfgTexture,clamp(xy+vec2i(0,1),vec2i(0),vec2i(15)),0).rg;let d=textureLoad(physicalDfgTexture,clamp(xy+vec2i(1,1),vec2i(0),vec2i(15)),0).rg;return mix(mix(a,b,t.x),mix(c,d,t.x),t.y);
}
fn physicalStandard(base:vec3f,roughness:f32,metalness:f32,geometryRoughness:f32,normal:vec3f,viewDirection:vec3f)->PhysicalStandard {
 let effective=physicalEffectiveRoughness(roughness,geometryRoughness);let dfg=physicalDfg(effective,clamp(dot(normal,viewDirection),0.0,1.0));return physicalPrepareStandard(base,effective,metalness,dfg);
}
`;
const dfgRows=new WeakMap(),unavailable=s=>new DOMException('DFG '+s,'AbortError');
export async function createPhysicalDfg(ownerOrDevice){
 const d=ownerOrDevice?.device??ownerOrDevice;if(!d?.queue)throw Error('Existing GPUDevice required');
 let row=dfgRows.get(d);
 if(!row||row.retired||row.state==='lost'){
  row={state:'preparing',refs:0,retired:false,destroyed:false};dfgRows.set(d,row);const fresh=row;
  fresh.destroy=()=>{if(fresh.destroyed)return;fresh.destroyed=true;fresh.texture?.destroy();if(dfgRows.get(d)===fresh)dfgRows.delete(d);};
  d.lost.then(()=>{fresh.state='lost';fresh.retired=true;fresh.destroy();});
  fresh.ready=(async()=>{d.pushErrorScope('validation');let failure;
   try{fresh.texture=d.createTexture({label:'Frame exact Three DFG LUT',size:[16,16],format:'rg16float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});d.queue.writeTexture({texture:fresh.texture},new Uint16Array(DFG_HALF_WORDS),{bytesPerRow:64,rowsPerImage:16},[16,16]);}
   catch(error){failure=error;}
   const error=await d.popErrorScope();if(failure||error||fresh.state==='lost'){fresh.retired=true;fresh.destroy();throw failure??(error?Error(error.message):unavailable('lost'));}fresh.state='ready';
  })();
 }
 await row.ready;if(row.state!=='ready'||row.retired||row.destroyed)throw unavailable(row.state);row.refs++;let released=false,done;
 return {device:d,texture:row.texture,layoutEntry:PHYSICAL_DFG_LAYOUT_ENTRY,bindEntry:{binding:2,resource:row.texture.createView()},isCurrent:()=>!released&&row.state==='ready'&&!row.destroyed,
  release(){if(released)return done;released=true;if(--row.refs)return;if(row.state==='ready')row.state='retiring';row.retired=true;done=d.queue.onSubmittedWorkDone().catch(()=>{}).then(()=>row.destroy());return done;}};
}

// Exact MIT-licensed Three r186 DFG LUT half-float words (16x16 RG).
export const DFG_HALF_WORDS=Object.freeze([
 0x30b5,0x3ad1,0x314c,0x3a4d,0x33d2,0x391c,0x35ef,0x3828,0x37f3,0x36a6,0x38d1,0x3539,0x3979,0x3410,0x39f8,0x3252,0x3a53,0x30f0,0x3a94,0x2fc9,0x3abf,0x2e35,0x3ada,0x2d05,0x3ae8,0x2c1f,0x3aed,0x2ae0,0x3aea,0x29d1,0x3ae1,0x28ff,
 0x3638,0x38e4,0x364a,0x38ce,0x3699,0x385e,0x374e,0x372c,0x3839,0x35a4,0x38dc,0x3462,0x396e,0x32c4,0x39de,0x3134,0x3a2b,0x3003,0x3a59,0x2e3a,0x3a6d,0x2ce1,0x3a6e,0x2bba,0x3a5f,0x2a33,0x3a49,0x290a,0x3a2d,0x2826,0x3a0a,0x26e8,
 0x3894,0x36d7,0x3897,0x36c9,0x38a3,0x3675,0x38bc,0x35ac,0x38ee,0x349c,0x393e,0x3332,0x3997,0x3186,0x39e2,0x3038,0x3a13,0x2e75,0x3a29,0x2cf5,0x3a2d,0x2bac,0x3a21,0x29ff,0x3a04,0x28bc,0x39dc,0x2790,0x39ad,0x261a,0x3978,0x24fa,
 0x39ac,0x34a8,0x39ac,0x34a3,0x39ae,0x3480,0x39ae,0x3423,0x39b1,0x330e,0x39c2,0x31a9,0x39e0,0x3063,0x39fc,0x2eb5,0x3a0c,0x2d1d,0x3a14,0x2bcf,0x3a07,0x29ff,0x39e9,0x28a3,0x39be,0x273c,0x3989,0x25b3,0x394a,0x2488,0x3907,0x2345,
 0x3a77,0x3223,0x3a76,0x321f,0x3a73,0x3204,0x3a6a,0x31b3,0x3a58,0x3114,0x3a45,0x303b,0x3a34,0x2eb6,0x3a26,0x2d31,0x3a1e,0x2bef,0x3a0b,0x2a0d,0x39ec,0x28a1,0x39c0,0x271b,0x3987,0x2580,0x3944,0x2449,0x38fa,0x22bd,0x38ac,0x2155,
 0x3b07,0x2fca,0x3b06,0x2fca,0x3b00,0x2fb8,0x3af4,0x2f7c,0x3adb,0x2eea,0x3ab4,0x2e00,0x3a85,0x2cec,0x3a5e,0x2bc5,0x3a36,0x2a00,0x3a0d,0x2899,0x39dc,0x2707,0x39a0,0x2562,0x395a,0x2424,0x390b,0x2268,0x38b7,0x20fd,0x385f,0x1fd1,
 0x3b69,0x2cb9,0x3b68,0x2cbb,0x3b62,0x2cbb,0x3b56,0x2cae,0x3b3b,0x2c78,0x3b0d,0x2c0a,0x3acf,0x2ae3,0x3a92,0x2998,0x3a54,0x2867,0x3a17,0x26d0,0x39d3,0x253c,0x3989,0x2402,0x3935,0x2226,0x38dc,0x20bd,0x387d,0x1f54,0x381d,0x1db3,
 0x3ba9,0x296b,0x3ba8,0x296f,0x3ba3,0x297b,0x3b98,0x2987,0x3b7f,0x2976,0x3b4e,0x2927,0x3b0e,0x2895,0x3ac2,0x27b7,0x3a73,0x263b,0x3a23,0x24e7,0x39d0,0x239b,0x3976,0x21d9,0x3917,0x207e,0x38b2,0x1ee7,0x384b,0x1d53,0x37c7,0x1c1e,
 0x3bd2,0x25cb,0x3bd1,0x25d3,0x3bcd,0x25f0,0x3bc2,0x261f,0x3bad,0x2645,0x3b7d,0x262d,0x3b3e,0x25c4,0x3aec,0x250f,0x3a93,0x243a,0x3a32,0x22ce,0x39d0,0x215b,0x3969,0x202a,0x38fe,0x1e6e,0x388f,0x1cf1,0x381f,0x1b9b,0x3762,0x19dd,
 0x3be9,0x21ab,0x3be9,0x21b7,0x3be5,0x21e5,0x3bdd,0x2241,0x3bc9,0x22a7,0x3ba0,0x22ec,0x3b62,0x22cd,0x3b0f,0x2247,0x3aae,0x2175,0x3a44,0x2088,0x39d4,0x1f49,0x3960,0x1dbe,0x38e9,0x1c77,0x3870,0x1ae8,0x37f1,0x1953,0x3708,0x181b,
 0x3bf6,0x1cea,0x3bf6,0x1cfb,0x3bf3,0x1d38,0x3bec,0x1dbd,0x3bda,0x1e7c,0x3bb7,0x1f25,0x3b7d,0x1f79,0x3b2c,0x1f4c,0x3ac6,0x1ea6,0x3a55,0x1dbb,0x39da,0x1cbd,0x395a,0x1b9d,0x38d8,0x1a00,0x3855,0x18ac,0x37ab,0x173c,0x36b7,0x1598,
 0x3bfc,0x1736,0x3bfc,0x1759,0x3bf9,0x17e7,0x3bf4,0x1896,0x3be4,0x1997,0x3bc6,0x1aa8,0x3b91,0x1b84,0x3b43,0x1bd2,0x3ade,0x1b8a,0x3a65,0x1acd,0x39e2,0x19d3,0x3957,0x18cd,0x38ca,0x17b3,0x383e,0x1613,0x376d,0x14bf,0x366f,0x135e,
 0x3bff,0x101b,0x3bff,0x1039,0x3bfc,0x10c8,0x3bf9,0x1226,0x3bea,0x1428,0x3bcf,0x1584,0x3b9f,0x16c5,0x3b54,0x179a,0x3af0,0x17ce,0x3a76,0x1771,0x39ea,0x16a4,0x3956,0x15a7,0x38bf,0x14a7,0x3829,0x1379,0x3735,0x11ea,0x362d,0x10a1,
 0x3c00,0x61b,0x3c00,0x66a,0x3bfe,0x81c,0x3bfa,0xa4c,0x3bed,0xd16,0x3bd5,0xfb3,0x3ba9,0x114d,0x3b63,0x127c,0x3b01,0x132f,0x3a85,0x1344,0x39f4,0x12d2,0x3957,0x120d,0x38b5,0x1122,0x3817,0x103c,0x3703,0xed3,0x35f0,0xd6d,
 0x3c00,0x7a,0x3c00,0x89,0x3bfe,0x11d,0x3bfb,0x27c,0x3bf0,0x4fa,0x3bda,0x881,0x3bb1,0xacd,0x3b6f,0xc97,0x3b10,0xd7b,0x3a93,0xdf1,0x39fe,0xdef,0x3959,0xd8a,0x38af,0xce9,0x3808,0xc31,0x36d5,0xaf0,0x35b9,0x9a3,
 0x3c00,0x0,0x3c00,0x1,0x3bff,0x15,0x3bfb,0x59,0x3bf2,0xfd,0x3bdd,0x1df,0x3bb7,0x31c,0x3b79,0x47c,0x3b1d,0x5d4,0x3aa0,0x6d5,0x3a08,0x75a,0x395d,0x75e,0x38aa,0x6f7,0x37f4,0x648,0x36ac,0x576,0x3586,0x49f,
]);
