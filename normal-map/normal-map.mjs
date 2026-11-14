export const defaults = Object.freeze({mode:0,range:null,gamma:1,denoise:0.85,bands:[1,1,0.35],strength:3,feature:[0.2,0.6,8,0.03],wrap:true,normalY:1});

// Analyze only 16K pixels; this is exposure normalization, not CPU image conversion.
export function analyze(image, mode=0) {
  const canvas = new OffscreenCanvas(128,128), ctx = canvas.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(image,0,0,128,128);
  const {data}=ctx.getImageData(0,0,128,128), values=[];
  for(let i=0;i<data.length;i+=4) if(data[i+3]>0) {
    const r=data[i]/255,g=data[i+1]/255,b=data[i+2]/255;
    values.push(mode===1?Math.max(r,g,b)-Math.min(r,g,b):r*.2126+g*.7152+b*.0722);
  }
  values.sort((a,b)=>a-b);
  const q=x=>values[Math.min(values.length-1,Math.floor(x*values.length))]??0;
  return {range:[q(.02),q(.98)],median:q(.5),contrast:q(.98)-q(.02)};
}

export async function createConverter(device) {
  if(!device) throw Error('A WebGPU GPUDevice is required.');
  const code=await (await fetch(new URL('./normal.wgsl',import.meta.url))).text();
  const module=device.createShaderModule({label:'Standalone normal-map kernels',code});
  const info=await module.getCompilationInfo();
  const errors=info.messages.filter(m=>m.type==='error');
  if(errors.length) throw Error(errors.map(m=>`${m.lineNum}: ${m.message}`).join('\n'));
  const layout=device.createBindGroupLayout({entries:[
    {binding:0,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:'float'}},
    {binding:1,visibility:GPUShaderStage.COMPUTE,storageTexture:{access:'write-only',format:'rgba16float'}},
    {binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}},
    {binding:3,visibility:GPUShaderStage.COMPUTE,sampler:{type:'filtering'}},
    {binding:4,visibility:GPUShaderStage.COMPUTE,storageTexture:{access:'write-only',format:'rgba8unorm'}}
  ]});
  const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
  const names=['prepare','morphology','seed','distance','bevel','downsample','normal'];
  const pipelines=Object.fromEntries(await Promise.all(names.map(async entryPoint=>[entryPoint,await device.createComputePipelineAsync({layout:pipelineLayout,compute:{module,entryPoint}})])));
  const sampler=wrap=>device.createSampler({addressModeU:wrap?'repeat':'clamp-to-edge',addressModeV:wrap?'repeat':'clamp-to-edge',magFilter:'linear',minFilter:'linear'});
  const samplers=[sampler(false),sampler(true)];
  let busy=false;
  return {
    async convert(image, options={}) {
      if(busy) throw Error('Await the previous conversion before reusing this converter.');
      const p={...defaults,...options};
      for(const k of Object.keys(options)) if(!(k in defaults)) throw Error(`Unknown option: ${k}`);
      const width=image.width,height=image.height;
      if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||Math.max(width,height)>device.limits.maxTextureDimension2D) throw Error('Invalid or unsupported image dimensions.');
      if(![0,1,2,3].includes(p.mode)||![1,-1].includes(p.normalY)||typeof p.wrap!=='boolean') throw Error('Invalid mode, normalY or wrap.');
      const stats=analyze(image,p.mode); p.range??=stats.range;
      if(!Array.isArray(p.range)||p.range.length!==2||p.range[0]>p.range[1]||!Array.isArray(p.bands)||p.bands.length!==3||!Array.isArray(p.feature)||p.feature.length!==4||![...p.range,...p.bands,...p.feature,p.strength,p.gamma,p.denoise].every(Number.isFinite)||p.gamma<=0||p.denoise<0||p.denoise>1||p.strength<0||p.feature[2]<=0||p.feature[2]>32) throw Error('Invalid conversion parameters.');
      busy=true;
      const resources=[], own=x=>(resources.push(x),x), usage=GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST;
      const texture=(format,w=width,h=height,mipLevelCount=1,extra=0)=>own(device.createTexture({size:[w,h],format,mipLevelCount,usage:usage|extra}));
      let result;
      try {
        const start=performance.now(), levels=Math.min(6,1+Math.floor(Math.log2(Math.max(width,height))));
        const input=own(device.createTexture({size:[width,height],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT}));
        device.queue.copyExternalImageToTexture({source:image},{texture:input},[width,height]);
        const scratchWidth=p.mode>=2?width:1,scratchHeight=p.mode>=2?height:1;
        const a=texture('rgba16float',scratchWidth,scratchHeight),b=p.mode>=2?texture('rgba16float'):a,pyramid=texture('rgba16float',width,height,levels);
        const output=texture('rgba8unorm',width,height,1,GPUTextureUsage.COPY_SRC);
        const timestamp=device.features.has('timestamp-query');
        const queries=timestamp?own(device.createQuerySet({type:'timestamp',count:2})):null;
        const queryBuffer=timestamp?own(device.createBuffer({size:16,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC})):null;
        const queryRead=timestamp?own(device.createBuffer({size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ})):null;
        const encoder=device.createCommandEncoder(); let passes=0;
        // Dispatches have separate resource usage scopes; one pass avoids pass overhead.
        const pass=encoder.beginComputePass(timestamp?{timestampWrites:{querySet:queries,beginningOfPassWriteIndex:0,endOfPassWriteIndex:1}}:{});
        const dispatch=(name,source,target,w=width,h=height,step=0,morphology=0)=>{
          const bytes=new ArrayBuffer(80), f=new Float32Array(bytes),u=new Uint32Array(bytes),i=new Int32Array(bytes);
          u.set([width,height,p.mode,p.wrap?1:0]); f.set([...p.range,p.gamma,p.denoise],4);
          f.set([...p.bands,p.strength],8); f.set(p.feature,12); f[16]=p.normalY;i[17]=step;i[18]=morphology;
          const buffer=own(device.createBuffer({size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}));device.queue.writeBuffer(buffer,0,bytes);
          const group=device.createBindGroup({layout,entries:[{binding:0,resource:source},{binding:1,resource:target},{binding:2,resource:{buffer}},{binding:3,resource:samplers[+p.wrap]},{binding:4,resource:output.createView()}]});
          pass.setPipeline(pipelines[name]);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(w/8),Math.ceil(h/8));passes++;
        };
        dispatch('prepare',input.createView(),p.mode>=2?a.createView():pyramid.createView({baseMipLevel:0,mipLevelCount:1}));
        let current=a,other=b;
        const swap=()=>{[current,other]=[other,current];};
        if(p.mode===2) { for(const m of [1,-1])for(const axis of [0,1]) {dispatch('morphology',current.createView(),other.createView(),width,height,axis,m);swap();} }
        if(p.mode>=2) {
          dispatch('seed',current.createView(),other.createView());swap();
          // Bounded jump flood: only the <=32px bevel neighborhood matters.
          for(let step=2**Math.ceil(Math.log2(p.feature[2]));step>=1;step/=2) {dispatch('distance',current.createView(),other.createView(),width,height,step);swap();}
          dispatch('distance',current.createView(),other.createView(),width,height,1);swap();
          dispatch('bevel',current.createView(),pyramid.createView({baseMipLevel:0,mipLevelCount:1}));
        }
        for(let level=1;level<levels;level++) dispatch('downsample',pyramid.createView({baseMipLevel:level-1,mipLevelCount:1}),pyramid.createView({baseMipLevel:level,mipLevelCount:1}),Math.max(1,width>>level),Math.max(1,height>>level));
        // The normal pass uses the whole pyramid and a separate unused storage view.
        dispatch('normal',pyramid.createView(),a.createView());
        pass.end();
        if(timestamp) {encoder.resolveQuerySet(queries,0,2,queryBuffer,0);encoder.copyBufferToBuffer(queryBuffer,0,queryRead,0,16);}
        const stride=Math.ceil(width*4/256)*256,read=own(device.createBuffer({size:stride*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}));
        encoder.copyTextureToBuffer({texture:output},{buffer:read,bytesPerRow:stride},[width,height]);
        device.queue.submit([encoder.finish()]);
        await Promise.all([read.mapAsync(GPUMapMode.READ),...(timestamp?[queryRead.mapAsync(GPUMapMode.READ)]:[])]);
        const pixels=new Uint8ClampedArray(width*height*4),mapped=new Uint8Array(read.getMappedRange());
        for(let y=0;y<height;y++) pixels.set(mapped.subarray(y*stride,y*stride+width*4),y*width*4);
        const gpuMs=timestamp?(()=>{const t=new BigUint64Array(queryRead.getMappedRange());return Number(t[1]-t[0])/1e6;})():null;
        read.unmap();if(timestamp)queryRead.unmap();
        result={width,height,pixels,options:p,analysis:stats,timing:{gpuMs,computeReadbackMs:performance.now()-start,passes}};
      } finally {for(const resource of resources)resource.destroy();busy=false;}
      return result;
    }
  };
}

export async function png(result) {
  const canvas=new OffscreenCanvas(result.width,result.height);
  canvas.getContext('2d').putImageData(new ImageData(result.pixels,result.width,result.height),0,0);
  return new Uint8Array(await (await canvas.convertToBlob({type:'image/png'})).arrayBuffer());
}
