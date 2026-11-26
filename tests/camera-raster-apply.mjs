export async function applyRasterGraph(graph,grid,enableML,liveStart){
  const t=window.rasterTracer,dev=t.device,{nodes,edges,maps}=graph,n=nodes.length,owned=[];
  const storage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC;
  const make=(bytes,usage=storage)=>{const b=dev.createBuffer({size:Math.max(16,bytes),usage});owned.push(b);return b;};
  const upload=a=>{const b=make(a.byteLength);dev.queue.writeBuffer(b,0,a);return b;};
  const start=performance.now(),d=new Float32Array(n*4),rho=d.slice(),offsets=new Uint32Array(n+1),links=[],weights=[];
  for(let i=0;i<n;i++){
    d.set(nodes[i].direct,i*4);rho.set(nodes[i].rho,i*4);
    for(const [j,w] of edges[i]){links.push(j);weights.push(w);}
    offsets[i+1]=links.length;
  }
  const src=upload(d),albedo=upload(rho),offset=upload(offsets),ids=upload(Uint32Array.from(links)),coef=upload(Float32Array.from(weights));
  const p=make(d.byteLength),q=make(d.byteLength),sum=make(d.byteLength),read=make(d.byteLength,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);
  const module=dev.createShaderModule({code:`
    @group(0) @binding(0) var<storage,read> input:array<vec4f>;@group(0) @binding(1) var<storage,read> rho:array<vec4f>;
    @group(0) @binding(2) var<storage,read> offset:array<u32>;@group(0) @binding(3) var<storage,read> ids:array<u32>;
    @group(0) @binding(4) var<storage,read> weight:array<f32>;@group(0) @binding(5) var<storage,read_write> out:array<vec4f>;
    @group(0) @binding(6) var<storage,read_write> sum:array<vec4f>;
    @compute @workgroup_size(64) fn step(@builtin(global_invocation_id) u:vec3u){let i=u.x;if(i>=arrayLength(&out)){return;}
      var flux=vec3f(0.);for(var k=offset[i];k<offset[i+1u];k++){flux+=weight[k]*input[ids[k]].rgb;}
      out[i]=vec4f(rho[i].rgb*flux,0.);sum[i]+=out[i];}`});
  const pipe=await dev.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'step'}});
  const groups=[[src,p],[p,q],[q,p]].map(([a,b])=>t.group(pipe.getBindGroupLayout(0),[a,albedo,offset,ids,coef,b,sum]));
  const numerical=async()=>{
    const enc=dev.createCommandEncoder();enc.copyBufferToBuffer(sum,0,read,0,d.byteLength);dev.queue.submit([enc.finish()]);
    await read.mapAsync(GPUMapMode.READ);try{return new Float32Array(read.getMappedRange()).slice();}finally{read.unmap();}
  };
  const run=async()=>{const enc=dev.createCommandEncoder();enc.copyBufferToBuffer(src,0,sum,0,d.byteLength);
    for(const g of groups){const pass=enc.beginComputePass();pass.setPipeline(pipe);pass.setBindGroup(0,g);pass.dispatchWorkgroups(Math.ceil(n/64));pass.end();}
    dev.queue.submit([enc.finish()]);await dev.queue.onSubmittedWorkDone();
  };
  const time=async(fn,count=7)=>{const raw=[];for(let i=0;i<count;i++){const at=performance.now();await fn();raw.push(performance.now()-at);}
    const sorted=raw.toSorted((a,b)=>a-b);return {p50:sorted[Math.ceil(count*.5)-1],p95:sorted.at(-1),raw};
  };
  async function prepareDisplay(){
    const seen=upload(Int32Array.from(maps.at(-1))),tri=upload(Uint32Array.from(nodes,o=>o.tri)),im=t.cameraImage;
    const texture=dev.createTexture({size:[im.width,im.height],format:'rgba16float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC});owned.push(texture);
    const target=texture.createView(),composite=dev.createShaderModule({code:`
      @group(0) @binding(0) var hit:texture_2d<u32>;@group(0) @binding(1) var current:texture_2d<f32>;
      @group(0) @binding(2) var<storage,read> map:array<i32>;@group(0) @binding(3) var<storage,read> tri:array<u32>;
      @group(0) @binding(4) var<storage,read> sum:array<vec4f>;@group(0) @binding(5) var result:texture_storage_2d<rgba16float,write>;
      @group(0) @binding(6) var<storage,read> emission:array<vec4f>;
      @compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) p:vec3u){let wh=textureDimensions(hit);if(any(p.xy>=wh)){return;}
        let triangle=textureLoad(hit,p.xy,0).x;let xy=p.xy*vec2u(GXu,GYu)/wh;let i=map[xy.y*GXu+xy.x];
        var color=textureLoad(current,p.xy,0).rgb;
        if(i>=0&&triangle==tri[i]){color=emission[i].rgb+sum[i].rgb;}textureStore(result,p.xy,vec4f(color,1.));}`.replaceAll('GX',String(grid[0])).replaceAll('GY',String(grid[1]))});
    const diagnostics=(await composite.getCompilationInfo()).messages.filter(m=>m.type==='error');if(diagnostics.length)throw Error(diagnostics.map(m=>m.message).join('\n'));
    const emit=new Float32Array(n*4);nodes.forEach((o,i)=>emit.set(o.emission,i*4));
    const show=await dev.createComputePipelineAsync({layout:'auto',compute:{module:composite,entryPoint:'main'}});
    const hits=im.hits[im.front],bg=t.group(show.getBindGroupLayout(0),[hits,im.hdr[im.front].createView(),seen,tri,sum,target,upload(emit)]);
    const presentation={...im,displayGroups:[t.group(t.display.getBindGroupLayout(0),[t.uniform,target,im.meters[im.front].createView(),t.previewSampler,hits])]};
    const render=async()=>{const e=dev.createCommandEncoder();t.encodeCompute(e,show,'Raster graph native reconstruction',[bg],[im.width,im.height]);t.encodeDisplay(e,presentation,0,true);dev.queue.submit([e.finish()]);await dev.queue.onSubmittedWorkDone();};
    return {render,texture,im};
  }
  const prepMs=performance.now()-start,screen=await prepareDisplay();
  await run();await screen.render();const firstPublishedMs=performance.now()-liveStart;
  const reference=await numerical(),wgsl=await time(run);
  let oracle=Float64Array.from(d),previous=Float64Array.from(d);
  for(let b=0;b<3;b++){const next=new Float64Array(d.length);for(let i=0;i<n;i++)for(const [j,w] of edges[i])for(let k=0;k<3;k++)next[4*i+k]+=rho[4*i+k]*w*previous[4*j+k];oracle=oracle.map((v,i)=>v+next[i]);previous=next;}
  const error=actual=>{let err=0,norm=0;for(let i=0;i<oracle.length;i++){err+=(actual[i]-oracle[i])**2;norm+=oracle[i]**2;}return Math.sqrt(err/Math.max(1e-20,norm));};
  const result={firstPublishedMs,patches:n,links:links.length,prepareSparseMs:prepMs,wgsl:{...wgsl,nrmse:error(reference)},webnn:[]};
  try{
    const M=16,K=32,tileRows=[],donors=[],entries=[];
    const packAt=performance.now();
    for(let first=0;first<n;first+=M){
      const seen=new Map();for(let i=first;i<Math.min(first+M,n);i++)for(const [j] of edges[i])if(!seen.has(j))seen.set(j,seen.size);
      const list=Array.from(seen.keys()),initial=tileRows.length;
      for(let k=0;k<list.length;k+=K){tileRows.push(first);for(let j=0;j<K;j++)donors.push(list[k+j]??-1);}
      for(let i=first;i<Math.min(first+M,n);i++)for(const [j,value] of edges[i]){
        const k=seen.get(j),slot=(initial+Math.floor(k/K))*M*K+(i-first)*K+k%K;entries.push([slot,value]);
      }
    }
    const B=tileRows.length,W=new Float32Array(B*M*K);for(const [i,v] of entries)W[i]=v;
    result.blocks={shape:[B,M,K],rhs:3,occupancy:links.length/W.length,donorSlots:donors.length,distinctDonors:new Set(donors.filter(d=>d>=0)).size,
      usedDonorSlots:donors.filter(d=>d>=0).length,buildMs:performance.now()-packAt};
    const base=t.options;
    async function concurrent(apply){
      const frames=[],jobs=[];
      for(let i=0;i<5;i++){
        const at=performance.now(),job=apply().then(()=>jobs.push(performance.now()-at));
        await t.start({...base,viewKey:'fixed-graph-4k-'+i});frames.push(performance.now()-at);await job;
        if(t.stats.phase!=='preview')throw Error(t.stats.errors.join('\n'));
      }
      return {frames,jobs,frameP95:Math.max(...frames),jobP95:Math.max(...jobs)};
    }
    if(enableML)result.wgsl.concurrent=await concurrent(run);
    if(enableML&&navigator.ml&&B)for(const type of ['float16','int8','int4'])for(const runtime of [false,true]){
      const row={weights:type,runtime};result.webnn.push(row);let ctx,g,x,y,wt;
      try{
        const build=performance.now();ctx=await navigator.ml.createContext({deviceType:'gpu'});
        const b=new MLGraphBuilder(ctx),desc={dataType:type,shape:[B,M,K]},inp={dataType:'float16',shape:[B,K,3]};
        let values,scales,zeros;
        if(type==='float16')values=new Float16Array(W);
        else{
          const bits=type==='int4'?4:8,range=bits===4?15:127;
          values=bits===4?new Uint8Array(W.length/2):new Int8Array(W.length);
          scales=new Float16Array(B*M);zeros=bits===4?new Uint8Array(B*M/2).fill(0x88):new Int8Array(B*M);
          for(let i=0;i<B*M;i++){const start=i*K,max=Math.max(...W.subarray(start,start+K));scales[i]=max?max/range:1;
            for(let k=0;k<K;k++){const j=start+k,v=Math.min(range,Math.round(W[j]/scales[i]));if(bits===4)values[j>>1]|=((v-8)&15)<<((j&1)*4);else values[j]=v;}}
        }
        let weight=runtime?b.input('w',desc):b.constant(desc,values);
        if(scales){const shape=[B,M,1];weight=b.dequantizeLinear(weight,b.constant({dataType:'float16',shape},scales),b.constant({dataType:type,shape},zeros));}
        g=await b.build({y:b.matmul(weight,b.input('x',inp))});row.graphDevices=g.devices?Array.from(g.devices):null;
        x=await ctx.createTensor({...inp,writable:true});y=await ctx.createTensor({dataType:'float16',shape:[B,M,3],readable:true});
        if(runtime){wt=await ctx.createTensor({...desc,writable:true});ctx.writeTensor(wt,values);}
        row.buildMs=performance.now()-build;
        const packed=new Float16Array(B*K*3),inputs=wt?{w:wt,x}:{x};
        const apply=async()=>{
          let prev=d,total=d.slice();
          for(let order=0;order<3;order++){
            for(let j=0;j<donors.length;j++){const id=donors[j];if(id>=0)for(let k=0;k<3;k++)packed[3*j+k]=prev[4*id+k];}
            ctx.writeTensor(x,packed);ctx.dispatch(g,inputs,{y});const values=new Float16Array(await ctx.readTensor(y)),next=new Float32Array(d.length);
            for(let b=0;b<B;b++)for(let r=0;r<M&&tileRows[b]+r<n;r++)for(let k=0;k<3;k++){const out=(tileRows[b]+r)*4+k;next[out]+=rho[out]*values[(b*M+r)*3+k];}
            for(let j=0;j<total.length;j++)total[j]+=next[j];prev=next;
          }
          dev.queue.writeBuffer(sum,0,total);await dev.queue.onSubmittedWorkDone();
        };
        await apply();
        const nrmse=error(await numerical());
        row.nrmse=Number.isFinite(nrmse)?nrmse:null;
        row.accuracyPassed=Number.isFinite(nrmse)&&nrmse<.01;
        if(!row.accuracyPassed)row.accuracyFailure=row.nrmse===null?'Nonfinite radiance':'Normalized RMS error exceeds 1%';
        row.endToEnd=await time(apply,5);if(!runtime)row.concurrent=await concurrent(apply);
      }catch(e){row.failure=String(e);}
      finally{wt?.destroy();x?.destroy();y?.destroy();g?.destroy();ctx?.destroy();}
    }
    await run();
    const {render,texture,im}=screen;result.reconstruct=await time(render,5);
    const side=32,pixels=make(side*side*8,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ),enc=dev.createCommandEncoder();
    enc.copyTextureToBuffer({texture,origin:[Math.floor(im.width/2)-16,Math.floor(im.height/2)-16]}, {buffer:pixels,bytesPerRow:256},[side,side]);dev.queue.submit([enc.finish()]);await pixels.mapAsync(GPUMapMode.READ);
    const pixelsData=new Float16Array(pixels.getMappedRange()),rgb=[0,0,0];for(let i=0;i<side*side;i++)for(let k=0;k<3;k++)rgb[k]+=pixelsData[i*4+k]/(side*side);pixels.unmap();result.center=rgb;
    return result;
  }finally{for(const resource of owned)resource.destroy();}
}
