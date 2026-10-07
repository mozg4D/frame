/** Shared texture contract for async native snapshots, uploads and sampler policy.
 * No texture downsampling on the CPU and no mutation of authored image data.
 */
export function textureState(texture){
 if(!texture)return [];
 const image=texture.image??texture.source?.data;
 return [texture,texture.version,texture.source,texture.source?.version,image,image?.data,
  image?.width,image?.height,image?.videoWidth,image?.videoHeight,image?.data?.byteLength,
  texture.wrapS,texture.wrapT,texture.magFilter,texture.minFilter,texture.flipY,texture.colorSpace,
  texture.generateMipmaps,texture.anisotropy,texture.format,texture.type,texture.premultiplyAlpha,
  texture.mipmaps,texture.mipmaps?.length,texture.matrixAutoUpdate,texture.rotation,
  texture.offset?.x,texture.offset?.y,texture.repeat?.x,texture.repeat?.y,texture.center?.x,texture.center?.y];
}
export function textureStateCurrent(texture,state){
 const now=textureState(texture);return now.length===state.length&&now.every((v,i)=>Object.is(v,state[i]));
}
export function texturePolicy(source,maxDimension=Infinity){
 const image=source.image??source.source?.data;
 if(!image)throw Error('Texture image is not loaded');
 const width=image.videoWidth??image.width,height=image.videoHeight??image.height;
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||Math.max(width,height)>maxDimension)throw Error('Texture size invalid or exceeds device limits');
 if(source.mipmaps?.length)throw Error('Authored mip chains require an explicit texture adapter');
 if(source.premultiplyAlpha)throw Error('Premultiplied source texture requires an explicit adapter');
 if(source.format!==undefined&&source.format!==1023||source.type!==undefined&&source.type!==1009)throw Error('Only RGBA8 native colour textures are supported');
 if(![undefined,'','srgb','srgb-linear'].includes(source.colorSpace))throw Error('Unsupported texture colour space');
 const min=source.minFilter??1006,mag=source.magFilter??1006;
 if(![1003,1004,1005,1006,1007,1008].includes(min)||![1003,1006].includes(mag))throw Error('Unsupported texture filter');
 const address=value=>{if(value===undefined||value===1001)return 'clamp-to-edge';if(value===1000)return 'repeat';if(value===1002)return 'mirror-repeat';throw Error('Unsupported texture wrap mode');};
 const mipFilter=[1004,1005,1007,1008].includes(min),generate=mipFilter&&source.generateMipmaps!==false;
 const mipLevelCount=generate?1+Math.floor(Math.log2(Math.max(width,height))):1;
 const magFilter=mag===1003?'nearest':'linear',minFilter=[1003,1004,1005].includes(min)?'nearest':'linear',mipmapFilter=[1005,1008].includes(min)?'linear':'nearest';
 const anisotropy=source.anisotropy??1;
 if(!Number.isFinite(anisotropy)||anisotropy<1)throw Error('Invalid texture anisotropy');
 return {width,height,format:source.colorSpace==='srgb'?'rgba8unorm-srgb':'rgba8unorm',mipLevelCount,
  sampler:{addressModeU:address(source.wrapS),addressModeV:address(source.wrapT),magFilter,minFilter,mipmapFilter,
   lodMinClamp:0,lodMaxClamp:mipLevelCount-1,maxAnisotropy:magFilter==='linear'&&minFilter==='linear'&&mipmapFilter==='linear'?Math.min(16,Math.floor(anisotropy)):1}};
}
export function mipSizes(width,height){
 if(!Number.isInteger(width)||!Number.isInteger(height)||Math.min(width,height)<1)throw Error('Positive integer mip dimensions required');
 const sizes=[[width,height]];while(width>1||height>1){width=Math.max(1,Math.floor(width/2));height=Math.max(1,Math.floor(height/2));sizes.push([width,height]);}return sizes;
}
