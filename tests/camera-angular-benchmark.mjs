import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {serve} from '../tools/browser.mjs';

// Compare identical, visibility-weighted incident radiance on an equal-solid-angle hemisphere.
// Each visible patch requests one outgoing direction and roughness, or two Schlick columns.
async function benchmark({patches,repeats,devices}){
  const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
  if(!adapter||adapter.info.isFallbackAdapter)throw Error('Hardware WebGPU required');
  const device=await adapter.requestDevice(),owned=[];
  const rows=3*patches,K=256,N=512;
  const L=new Float32Array(rows*K),W=new Float32Array(K*N),expected=new Float32Array(rows*2);
  const requested=row=>2*(Math.imul(Math.floor(row/3),29)%256);
  const dir=(mu,phi)=>[Math.sqrt(1-mu*mu)*Math.cos(phi),Math.sqrt(1-mu*mu)*Math.sin(phi),mu];
  for(let k=0;k<K;k++)for(let v=0;v<64;v++){
    const view=dir(((v>>3)+.5)/8,(v%8+.5)*Math.PI/4);
    for(let m=0;m<4;m++){
      const alpha=[.4,.6,.8,1][m]**2,a2=alpha*alpha,col=(v*4+m)*2;
      const G=z=>2*z/(z+Math.sqrt(a2+(1-a2)*z*z));
      for(let u=0;u<4;u++)for(let w=0;w<4;w++){
        const l=dir(((k>>4)+(u+.5)/4)/16,((k%16)+(w+.5)/4)*Math.PI/8);
        const vh=Math.sqrt(Math.max(1e-15,(1+view[0]*l[0]+view[1]*l[1]+view[2]*l[2])*.5));
        const nh=(l[2]+view[2])/(2*vh),D=a2/(Math.PI*(1+(a2-1)*nh*nh)**2);
        const weight=D*G(l[2])*G(view[2])/(4*view[2])*(2*Math.PI/(K*16)),q=(1-vh)**5;
        W[k*N+col]+=weight*(1-q);W[k*N+col+1]+=weight*q;
      }
    }
  }
  for(let r=0;r<rows;r++){
    const patch=Math.floor(r/3),col=requested(r),fixture=patch%4;
    for(let k=0;k<K;k++){
      const value=fixture===0?1:fixture===1?(k===(patch%256)?48:0):
        fixture===2?((k&15)>7&&(k&15)<12&&(k>>4)>9?5:.001):(k%41===0?120:(.002+k*.0001)*(1+(r%3)));
      L[r*K+k]=value;expected[r*2]+=value*W[k*N+col];expected[r*2+1]+=value*W[k*N+col+1];
    }
  }
  const buffer=(size,usage)=>{const b=device.createBuffer({size,usage});owned.push(b);return b;};
  const storage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST;
  const make=data=>{const b=buffer(data.byteLength,storage);device.queue.writeBuffer(b,0,data);return b;};
  const light=make(L),weights=make(W),dense=buffer(rows*N*4,storage),useful=buffer(rows*2*4,storage);
  const input16=buffer(rows*K*2,storage),read=buffer(rows*8,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);
  const code=`
    const rows=SHOW_ROWSu;
    @group(0) @binding(0) var<storage,read> a:array<f32>;
    @group(0) @binding(1) var<storage,read> b:array<f32>;
    @group(0) @binding(2) var<storage,read_write> y:array<f32>;
    @group(0) @binding(3) var<storage,read_write> packed:array<u32>;
    @group(0) @binding(4) var<storage,read> halfResults:array<u32>;
    var<workgroup> at:array<f32,256>;var<workgroup> bt:array<f32,256>;
    var<workgroup> partial:array<vec2f,64>;
    @compute @workgroup_size(16,16) fn full(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_id) li:vec3u){
      let row=wg.y*16u+li.y;let col=wg.x*16u+li.x;let id=li.y*16u+li.x;var sum=0.;
      for(var block=0u;block<16u;block++){
        at[id]=a[min(row,rows-1u)*256u+block*16u+li.x];bt[id]=b[(block*16u+li.y)*512u+col];workgroupBarrier();
        for(var k=0u;k<16u;k++){sum=fma(at[li.y*16u+k],bt[k*16u+li.x],sum);}workgroupBarrier();
      }
      if(row<rows){y[row*512u+col]=sum;}
    }
    fn column(row:u32)->u32{return ((row/3u*29u)%256u)*2u;}
    @compute @workgroup_size(64) fn visible(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_index) id:u32){
      let row=wg.x;let col=column(row);var sum=vec2f(0.);
      for(var k=id;k<256u;k+=64u){let i=k*512u+col;sum+=a[row*256u+k]*vec2f(b[i],b[i+1u]);}
      partial[id]=sum;workgroupBarrier();
      for(var n=32u;n>0u;n>>=1u){if(id<n){partial[id]+=partial[id+n];}workgroupBarrier();}
      if(id==0u){y[row*2u]=partial[0].x;y[row*2u+1u]=partial[0].y;}
    }
    @compute @workgroup_size(64) fn packHalf(@builtin(global_invocation_id) id:vec3u){
      let i=id.x;if(i<rows*128u){packed[i]=pack2x16float(vec2f(a[2u*i],a[2u*i+1u]));}
    }
    @compute @workgroup_size(64) fn selectFull(@builtin(global_invocation_id) id:vec3u){
      let row=id.x;if(row>=rows){return;}let i=row*512u+column(row);y[row*2u]=a[i];y[row*2u+1u]=a[i+1u];
    }
    @compute @workgroup_size(64) fn selectHalf(@builtin(global_invocation_id) id:vec3u){
      let row=id.x;if(row>=rows){return;}let v=unpack2x16float(halfResults[(row*512u+column(row))/2u]);y[row*2u]=v.x;y[row*2u+1u]=v.y;
    }`.replace('SHOW_ROWS',String(rows));
  const module=device.createShaderModule({code}),pipelines={};
  for(const entryPoint of ['full','visible','packHalf','selectFull','selectHalf']){
    pipelines[entryPoint]=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint}});
  }
  const dispatch=(encoder,name,bindings,...workgroups)=>{
    const p=pipelines[name],g=device.createBindGroup({layout:p.getBindGroupLayout(0),
      entries:bindings.map(([binding,buffer])=>({binding,resource:{buffer}}))});
    const pass=encoder.beginComputePass();pass.setPipeline(p);pass.setBindGroup(0,g);pass.dispatchWorkgroups(...workgroups);pass.end();
  };
  const percent=(list,q)=>[...list].sort((a,b)=>a-b)[Math.ceil(list.length*q)-1];
  const measure=async fn=>{await fn();const raw=[];for(let n=0;n<repeats;n++){const at=performance.now();await fn();raw.push(performance.now()-at);}return {p50:percent(raw,.5),p95:percent(raw,.95),raw};};
  const finished=()=>device.queue.onSubmittedWorkDone();
  const accuracy=async()=>{
    const e=device.createCommandEncoder();e.copyBufferToBuffer(useful,0,read,0,rows*8);
    device.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);
    try{const actual=new Float32Array(read.getMappedRange());let err=0,den=0,worst=0;
      for(let i=0;i<actual.length;i++){if(!Number.isFinite(actual[i]))throw Error('Invalid angular result');const d=actual[i]-expected[i];err+=d*d;den+=expected[i]**2;worst=Math.max(worst,Math.abs(d));}
      return {nrmse:Math.sqrt(err/den),maxAbs:worst};
    }finally{read.unmap();}
  };
  const runWGSL=async full=>{const e=device.createCommandEncoder();
    if(full){dispatch(e,'full',[[0,light],[1,weights],[2,dense]],32,Math.ceil(rows/16));dispatch(e,'selectFull',[[0,dense],[2,useful]],Math.ceil(rows/64));}
    else dispatch(e,'visible',[[0,light],[1,weights],[2,useful]],rows);
    device.queue.submit([e.finish()]);await finished();
  };
  const result={adapter:adapter.info.description||adapter.info.architecture,dimensions:[rows,K,N],usefulColumnFraction:2/N,
    input:'white, isolated bright cell, finite panel, directional HDR',wgsl:{},webnn:[]};
  try{
    for(const which of ['visible','full']){
      result.wgsl[which]={...await measure(()=>runWGSL(which==='full')),error:await accuracy()};
    }
    if(!navigator.ml){result.fallback='navigator.ml unavailable';return result;}
    for(const deviceType of devices)for(const dataType of ['float32','float16']){
      const m={deviceType,dataType};result.webnn.push(m);let ctx,graph,input,output;
      try{
        const buildStart=performance.now();
        ctx=await navigator.ml.createContext({deviceType});
        m.supported=ctx.opSupportLimits?.().matmul?.a.dataTypes;
        if(m.supported&&!m.supported.includes(dataType))throw Error('matmul type unavailable');
        const b=new MLGraphBuilder(ctx),desc={dataType,shape:[rows,K]},od={dataType,shape:[rows,N]};
        const w=b.constant({dataType,shape:[K,N]},dataType==='float16'?new Float16Array(W):W);
        graph=await b.build({y:b.matmul(b.input('x',desc),w)});m.graphDevices=graph.devices?Array.from(graph.devices):null;
        const half=dataType==='float16',stages=[],elementBytes=half?2:4;
        let staging,returned;
        try{
          input=await ctx.createExportableTensor({...desc,writable:true},device);
          output=await ctx.createExportableTensor({...od,readable:true},device);m.exchange='exportable tensors';
        }catch(error){
          m.interopError=String(error);input?.destroy();output?.destroy();
          input=await ctx.createTensor({...desc,writable:true});output=await ctx.createTensor({...od,readable:true});
          staging=buffer(rows*K*elementBytes,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);
          returned=buffer(rows*N*elementBytes,storage);m.exchange='GPU readback / WebNN write / WebNN read / GPU upload';
        }
        m.buildMs=performance.now()-buildStart;
        const step=async()=>{
          const t=performance.now(),ib=staging||await ctx.exportToGPU(input),e=device.createCommandEncoder();
          if(half)dispatch(e,'packHalf',[[0,light],[3,input16]],Math.ceil(rows*K/128));
          e.copyBufferToBuffer(half?input16:light,0,ib,0,rows*K*elementBytes);device.queue.submit([e.finish()]);
          if(staging){await staging.mapAsync(GPUMapMode.READ);try{ctx.writeTensor(input,staging.getMappedRange());}finally{staging.unmap();}}
          else ib.destroy();
          const packed=performance.now();ctx.dispatch(graph,{x:input},{y:output});
          const ob=returned||await ctx.exportToGPU(output);
          if(returned)device.queue.writeBuffer(ob,0,await ctx.readTensor(output));
          const out=device.createCommandEncoder(),admitted=performance.now();
          dispatch(out,half?'selectHalf':'selectFull',[[half?4:0,ob],[2,useful]],Math.ceil(rows/64));
          device.queue.submit([out.finish()]);if(!returned)ob.destroy();await finished();
          stages.push({inputSubmitMs:packed-t,dispatchAndRentMs:admitted-packed,publicationFenceMs:performance.now()-admitted});
        };
        Object.assign(m,await measure(step));m.stages=stages.slice(1);m.error=await accuracy();
      }catch(error){m.failure=String(error);}
      finally{output?.destroy();input?.destroy();graph?.destroy();ctx?.destroy();}
    }
    return result;
  }finally{for(const v of owned)v.destroy();device.destroy();}
}
const args=process.argv.slice(2),flag=args.includes('--experimental-webnn'),report=args.find(s=>s.startsWith('--report='))?.slice(9);
const channel=args.find(s=>s.startsWith('--channel='))?.slice(10)||'chromium';
const server=await serve();let browser;
try{
  browser=await chromium.launch({headless:true,channel,args:['--enable-unsafe-webgpu',...(flag?['--enable-features=WebMachineLearningNeuralNetwork','--enable-blink-features=MachineLearningNeuralNetwork']:[])]});
  const page=await browser.newPage();await page.goto(server.url+'/frame-icon.svg');
  const result={browser:browser.version(),experimentalFlag:flag,units:'ms; GPU-resident input through GPU-consumable requested columns',runs:[]};
  for(const patches of [256,4096]){
    const run=await page.evaluate(benchmark,{patches,repeats:7,devices:['gpu','npu']});
    result.runs.push(run);
    console.log(JSON.stringify({patches,wgsl:Object.fromEntries(Object.entries(run.wgsl).map(([k,v])=>[k,v.p50])),webnn:run.webnn.map(m=>({device:m.deviceType,type:m.dataType,p50:m.p50,failure:m.failure})),fallback:run.fallback}));
    if(report)await writeFile(report,JSON.stringify(result,null,2));
    for(const impl of [...Object.values(run.wgsl),...run.webnn.filter(m=>m.error)])assert.ok(impl.error.nrmse<.01);
  }
}finally{await browser?.close();await server.close();}
