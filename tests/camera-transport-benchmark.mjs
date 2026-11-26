import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {basename} from 'node:path';
import {chromium} from 'playwright';
import {serve,ready} from '../tools/browser.mjs';
import {cavityData,sparseReplay,intrinsicChecks,residualChecks,quantizedResidualProbe} from './camera-transport-replay.mjs';

async function physicalReplay({nx,ny,instances,repeats,withFrame,reflectance}){
  const data=window.cavityData(nx,ny,instances),{n,rows,W,X,R,selected,reference}=data;
  const tracer=window.transportCamera,device=tracer.device,owned=[];
  const storage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC;
  const buffer=(bytes,usage=storage)=>{const b=device.createBuffer({size:Math.max(4,bytes),usage});owned.push(b);return b;};
  const upload=a=>{const b=buffer(a.byteLength);device.queue.writeBuffer(b,0,a);return b;};
  const x=upload(X),r=upload(R),w=upload(W),ping=buffer(X.byteLength),pong=buffer(X.byteLength),sum=buffer(X.byteLength);
  const halfX=buffer(X.length*2),result16=buffer(X.length*2),inputRead=buffer(X.length*2,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);
  const read=buffer(n*4*selected.length,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);
  const module=device.createShaderModule({code:`
    const n=NNu;const rows=RRowsu;
    @group(0) @binding(0) var<storage,read> a:array<f32>;
    @group(0) @binding(1) var<storage,read> w:array<f32>;
    @group(0) @binding(2) var<storage,read> reflectance:array<f32>;
    @group(0) @binding(3) var<storage,read_write> p:array<f32>;
    @group(0) @binding(4) var<storage,read_write> total:array<f32>;
    @group(0) @binding(5) var<storage,read_write> packed:array<u32>;
    var<workgroup> leftTile:array<f32,256>;var<workgroup> rightTile:array<f32,256>;
    @compute @workgroup_size(16,16) fn blocked(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_id) li:vec3u){
      let row=wg.y*16u+li.y;let col=wg.x*16u+li.x;let slot=li.y*16u+li.x;
      let begin=select(0u,n/2u,wg.x*16u<n/2u);var v=0.;
      for(var base=begin;base<begin+n/2u;base+=16u){
        leftTile[slot]=a[min(rows-1u,row)*n+base+li.x];rightTile[slot]=w[(base+li.y)*n+col];workgroupBarrier();
        for(var k=0u;k<16u;k++){v=fma(leftTile[li.y*16u+k],rightTile[k*16u+li.x],v);}workgroupBarrier();
      }
      if(row<rows){let idx=row*n+col;let value=v*reflectance[idx];p[idx]=value;total[idx]+=value;}
    }
    @compute @workgroup_size(128) fn pack(@builtin(global_invocation_id) id:vec3u){
      let i=id.x;if(i<rows*n/2u){packed[i]=pack2x16float(vec2f(a[i*2u],a[i*2u+1u]));}
    }
    @compute @workgroup_size(128) fn unpack(@builtin(global_invocation_id) id:vec3u){
      let i=id.x;if(i<rows*n/2u){let q=unpack2x16float(packed[i]);total[i*2u]=q.x;total[i*2u+1u]=q.y;}
    }`.replace('NN',String(n)).replace('RRows',String(rows))});
  const compile=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');
  if(compile.length)throw Error(compile.map(m=>m.lineNum+': '+m.message).join('\n'));
  const pipes={};
  for(const entryPoint of ['blocked','pack','unpack'])pipes[entryPoint]=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint}});
  const bind=(name,resources)=>device.createBindGroup({layout:pipes[name].getBindGroupLayout(0),entries:resources.map(([binding,buffer])=>({binding,resource:{buffer}}))});
  const pack=bind('pack',[[0,x],[5,halfX]]),unpack=bind('unpack',[[4,sum],[5,result16]]);
  const groups=[[x,ping],[ping,pong],[pong,ping],[ping,pong]].map(([input,output])=>bind('blocked',[[0,input],[1,w],[2,r],[3,output],[4,sum]]));
  const dispatch=(enc,name,bg,...groups)=>{const p=enc.beginComputePass();p.setPipeline(pipes[name]);p.setBindGroup(0,bg);p.dispatchWorkgroups(...groups);p.end();};
  const runWGSL=async()=>{
    const e=device.createCommandEncoder();e.copyBufferToBuffer(x,0,sum,0,X.byteLength);
    for(const g of groups)dispatch(e,'blocked',g,n/16,Math.ceil(rows/16));
    device.queue.submit([e.finish()]);await device.queue.onSubmittedWorkDone();
  };
  function stats(times){const v=[...times].sort((a,b)=>a-b),p=q=>v[Math.ceil(v.length*q)-1];return {p50:p(.5),p95:p(.95),p99:p(.99),raw:times};}
  const measure=async fn=>{const first=performance.now();await fn();const firstMs=performance.now()-first,raw=[];
    for(let j=0;j<repeats;j++){const t=performance.now();await fn();raw.push(performance.now()-t);}
    return {...stats(raw),firstMs};};
  const error=async()=>{
    const e=device.createCommandEncoder();selected.forEach((row,j)=>e.copyBufferToBuffer(sum,row*n*4,read,j*n*4,n*4));device.queue.submit([e.finish()]);
    await read.mapAsync(GPUMapMode.READ);try{const actual=new Float32Array(read.getMappedRange());let s=0,d=0,worst=0;
      for(let i=0;i<actual.length;i++){const expected=reference[Math.floor(i/n)][i%n],diff=expected-actual[i];if(!Number.isFinite(diff))throw Error('Non-finite transport result');
        s+=diff*diff;d+=expected**2;worst=Math.max(worst,Math.abs(diff));}return {nrmse:Math.sqrt(s/d),maxAbs:worst};
    }finally{read.unmap();}
  };
  const base=tracer.options,original=base.camera;let frameIndex=0;
  const nativeFrame=async()=>{
    const angle=.006*((frameIndex++%12)-6),c=Math.cos(angle),s=Math.sin(angle),f=original.forward,r=original.right;
    const camera={...original,aspect:16/9,forward:f.map((v,i)=>c*v+s*r[i]),right:r.map((v,i)=>c*v-s*f[i])};
    await tracer.start({...base,camera,renderer:'Path tracer',rect:{x:0,y:0,w:3840,h:2160},outputSize:[3840,2160],current:undefined,
      viewKey:'transport-'+frameIndex,quality:50,finish:false,refine:false,motion:true,previewPresentation:true});
    if(tracer.stats.phase!=='preview')throw Error('Failed 4K render: '+tracer.stats.errors);
  };
  const together=async fn=>{
    const frames=[],jobs=[];await nativeFrame();
    for(let i=0;i<repeats;i++){const t=performance.now();
      const op=fn().then(()=>jobs.push(performance.now()-t));await nativeFrame();frames.push(performance.now()-t);await op;
    }
    return {frame:stats(frames),frameOver16_67:frames.filter(ms=>ms>1000/60).length,job:stats(jobs)};
  };
  const report={patches:n,instances,rows,orders:4,geometry:'Two inward facing parallel plates; per-instance D and RGB reflectance',nonzeroFraction:.5,
    usefulOutputFraction:1,constructionAndOracleMs:data.constructionMs,wgsl:null,webnn:[]};
  try{
    report.wgsl={...await measure(runWGSL),error:await error()};
    if(withFrame){report.cameraAlone=await measure(nativeFrame);report.wgsl.concurrent=await together(runWGSL);}
    if(!navigator.ml){report.fallback='navigator.ml unavailable';return report;}
    for(const deviceType of ['gpu','npu'])for(const variant of deviceType==='gpu'?
      ['fp16','fp16-input','int8','uint4-constant','uint4-input','int4-constant','int4-input']:['fp16','int8','uint4-constant','int4-constant','int4-input']){
      const m={deviceType,variant,arithmetic:'unverified',fusion:'unverified'};report.webnn.push(m);
      const mark='Frame transport '+deviceType+' '+variant+' '+n;
      performance.mark(mark+' begin');
      let ctx,graph,input,output,weightTensor,reflectanceTensor,ticket;
      try{
        const t=performance.now();ctx=await navigator.ml.createContext({deviceType});
        const b=new MLGraphBuilder(ctx),desc={dataType:'float16',shape:[rows,n]},wd={dataType:'float16',shape:[n,n]};
        const xd=b.input('x',desc),rho=new Float16Array(R);
        const rd=reflectance==='input'?b.input('rho',desc):b.constant(desc,rho);
        let wc,wBytes,operandDesc;
        if(variant.startsWith('fp16')){wBytes=new Float16Array(W);operandDesc=wd;wc=variant.endsWith('-input')?b.input('w',wd):b.constant(wd,wBytes);}
        else{
          const bits=variant==='int8'?8:4,maximum=bits===8?127:15,type=bits===8?'int8':variant.startsWith('uint4')?'uint4':'int4',signed4=type==='int4';
          const blocks=n/32,scales=new Float16Array(n*blocks),zeros=new Uint8Array(Math.ceil(n*blocks*bits/8));
          wBytes=bits===8?new Int8Array(n*n):new Uint8Array(n*n/2);
          if(signed4)zeros.fill(0x88);
          for(let d=0;d<n;d++)for(let g=0;g<blocks;g++){
            const off=d*n+g*32;let hi=0;for(let i=0;i<32;i++)hi=Math.max(hi,W[off+i]);
            const scale=hi>0?hi/maximum:1;scales[d*blocks+g]=scale;
            for(let i=0;i<32;i++){const q=Math.min(maximum,Math.round(W[off+i]/scale));
              if(bits===8)wBytes[off+i]=q;else wBytes[(off+i)>>1]|=((q-(signed4?8:0))&15)<<(((off+i)&1)*4);}
          }
          operandDesc={dataType:type,shape:[n,n]};m.packedBytes=wBytes.byteLength;
          const runtime=variant.endsWith('-input'),q=runtime?b.input('w',operandDesc):b.constant(operandDesc,wBytes);m.packedOperandAccepted=true;
          wc=b.dequantizeLinear(q,b.constant({dataType:'float16',shape:[n,blocks]},scales),
            b.constant({dataType:type,shape:[n,blocks]},bits===8?new Int8Array(zeros.buffer):zeros));m.qdqAccepted=true;
        }
        let current=xd,acc=xd;
        for(let i=0;i<4;i++){current=b.mul(b.matmul(current,wc),rd);acc=b.add(acc,current);}
        graph=await b.build({y:acc,done:b.slice(acc,[0,0],[1,1])});m.graphBuilt=true;m.graphDevices=graph.devices?Array.from(graph.devices):null;
        ticket=await ctx.createTensor({dataType:'float16',shape:[1,1],readable:true});
        let interop=true;
        try{input=await ctx.createExportableTensor({...desc,writable:true},device);output=await ctx.createExportableTensor({...desc,readable:true},device);}
        catch(e){input?.destroy();output?.destroy();m.interopError=String(e);interop=false;input=await ctx.createTensor({...desc,writable:true});output=await ctx.createTensor({...desc,readable:true});}
        if(variant.endsWith('-input')){weightTensor=await ctx.createTensor({...operandDesc,writable:true});ctx.writeTensor(weightTensor,wBytes);}
        const inputs=weightTensor?{x:input,w:weightTensor}:{x:input},outputs={y:output,done:ticket};
        if(reflectance==='input'){
          reflectanceTensor=await ctx.createTensor({...desc,writable:true});
          ctx.writeTensor(reflectanceTensor,rho);
          inputs.rho=reflectanceTensor;
        }
        m.buildAndAllocateMs=performance.now()-t;m.exchange=interop?'GPU tensor interop':'staged through host';
        ctx.writeTensor(input,new Float16Array(X));
        ctx.dispatch(graph,inputs,outputs);
        const hostResult=new Float16Array(await ctx.readTensor(output));
        let hostErr=0,hostNorm=0;for(let s=0;s<selected.length;s++)for(let j=0;j<n;j++){
          const expected=reference[s][j],actual=hostResult[selected[s]*n+j];
          hostErr+=(actual-expected)**2;hostNorm+=expected**2;
        }
        m.directTensorNRMSE=Math.sqrt(hostErr/hostNorm);
        const resident=async()=>{ctx.dispatch(graph,inputs,outputs);await ctx.readTensor(ticket);};
        m.resident=await measure(resident);
        const stages=[];
        const exchange=async()=>{
          const t=performance.now(),ib=interop?await ctx.exportToGPU(input):inputRead;
          const e=device.createCommandEncoder();dispatch(e,'pack',pack,Math.ceil(X.length/256));e.copyBufferToBuffer(halfX,0,ib,0,X.length*2);device.queue.submit([e.finish()]);
          if(interop)ib.destroy();else{await ib.mapAsync(GPUMapMode.READ);try{ctx.writeTensor(input,ib.getMappedRange());}finally{ib.unmap();}}
          const uploaded=performance.now();ctx.dispatch(graph,inputs,outputs);
          const ob=interop?await ctx.exportToGPU(output):result16;
          if(!interop)device.queue.writeBuffer(ob,0,await ctx.readTensor(output));
          const readAt=performance.now(),publish=device.createCommandEncoder();
          dispatch(publish,'unpack',interop?bind('unpack',[[4,sum],[5,ob]]):unpack,Math.ceil(X.length/256));
          device.queue.submit([publish.finish()]);if(interop)ob.destroy();await device.queue.onSubmittedWorkDone();
          stages.push([uploaded-t,readAt-uploaded,performance.now()-readAt]);
        };
        m.endToEnd=await measure(exchange);m.stages=stages.slice(1);m.error=await error();
        if(weightTensor){
          m.changedWeights=[];
          for(const fraction of [.05,.25]){
            const changed=wBytes.slice(),words=Math.round(wBytes.length*fraction);
            // The edited receiver band loses its internal links. The browser uploads whole tensors.
            changed.fill(variant==='int4-input'?0x88:0,0,words);
            const times=await measure(async()=>{ctx.writeTensor(weightTensor,changed);await exchange();});
            m.changedWeights.push({fraction,uploadedBytes:changed.byteLength,...times});
          }
          ctx.writeTensor(weightTensor,wBytes);
        }
        if(withFrame&&variant==='fp16')m.concurrent=await together(exchange);
      }catch(e){m.failure=String(e);}
      finally{performance.mark(mark+' end');weightTensor?.destroy();reflectanceTensor?.destroy();input?.destroy();output?.destroy();ticket?.destroy();graph?.destroy();ctx?.destroy();}
    }
    return report;
  }finally{for(const b of owned)b.destroy();}
}

const args=process.argv.slice(2),scene=args.find(s=>!s.startsWith('--')),reportPath=args.find(s=>s.startsWith('--report='))?.slice(9);
assert.ok(scene,'Pass a HASH scene to use as the foreground 4K workload');
const profilePath=args.find(s=>s.startsWith('--profile='))?.slice(10);
const channel=args.find(s=>s.startsWith('--channel='))?.slice(10)||'chromium';
const reflectance=args.find(s=>s.startsWith('--reflectance='))?.slice(14)||'input';
assert.ok(['constant','input'].includes(reflectance),'Expected --reflectance=constant or --reflectance=input');
const server=await serve();let browser;
try{
  browser=await chromium.launch({headless:true,channel,args:['--enable-unsafe-webgpu','--enable-features=WebMachineLearningNeuralNetwork','--enable-blink-features=MachineLearningNeuralNetwork']});
  const page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1});
  const cdp=profilePath?await browser.newBrowserCDPSession():null,traceEvents=[];
  if(cdp){
    const categories=(await cdp.send('Tracing.getCategories')).categories.filter(k=>/webnn|tflite|onnx|litert|directml/i.test(k));
    cdp.on('Tracing.dataCollected',e=>traceEvents.push(...e.value));
    await cdp.send('Tracing.start',{categories:[...categories,'webnn','blink.user_timing'].join(','),transferMode:'ReportEvents'});
  }
  await page.goto(server.url+'/index.html');await ready(page);
  const call=(n,a={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[n,a]);
  await page.evaluate(()=>{
    const src=document.getElementById('frame-pathtracer');
    src.textContent=src.textContent.replace('return new FrameRenderer(container,changed);','return window.transportCamera=new FrameRenderer(container,changed);');
    if(frameEngine.renderer.device.adapterInfo.isFallbackAdapter)throw Error('Hardware WebGPU required');
  });
  await call('scene.open',{name:basename(scene),base64:(await readFile(scene)).toString('base64')});
  await call('scene.create',{type:'render',params:{environment:'default',quality:1,realtime:'off','resolution x':160,'resolution y':90}});
  await call('render.export',{kind:'image',download:false});await call('render.stop');
  await page.addScriptTag({content:'window.cavityData='+cavityData.toString()});
  const report={browser:browser.version(),scene:basename(scene),reflectance,units:'ms',runs:[],intrinsic:intrinsicChecks(),coarse:residualChecks()};
  assert.ok(report.coarse.rankLost&&report.coarse.rejects>0&&report.coarse.residual<1e-8);
  report.sparse=await page.evaluate(sparseReplay);
  report.residualQDQ=await page.evaluate(quantizedResidualProbe);
  for(const cfg of [{nx:8,ny:8,instances:16},{nx:32,ny:16,instances:256}]){
    const out=await page.evaluate(physicalReplay,{...cfg,repeats:7,withFrame:cfg.instances===256,reflectance});
    report.runs.push(out);if(reportPath)await writeFile(reportPath,JSON.stringify(report,null,2));
    console.log(JSON.stringify({instances:cfg.instances,n:out.patches,wgsl:out.wgsl.p50,frame:out.cameraAlone?.p95,webnn:out.webnn.map(v=>[v.deviceType,v.variant,v.endToEnd?.p50,v.error?.nrmse,v.failure])}));
    assert.ok(out.wgsl.error.nrmse<1e-5);for(const m of out.webnn.filter(m=>m.error))m.accuracyPassed=m.error.nrmse<.01;
  }
  if(cdp){
    const done=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));
    await cdp.send('Tracing.end');await done;
    const histograms=(await cdp.send('Browser.getHistograms',{query:'WebNN'})).histograms;
    const names={};
    for(const e of traceEvents)if(/webnn|tflite|onnx|litert|directml|xnnpack|Frame transport/i.test(e.name+' '+e.cat)){
      names[e.name]=(names[e.name]||0)+1;
    }
    const internals=await browser.newPage();let diagnostics;
    try{await internals.goto('chrome://webnn-internals/');await internals.waitForTimeout(350);
      diagnostics=await internals.locator('body').innerText();
    }catch(e){diagnostics=String(e);}
    await writeFile(profilePath,JSON.stringify({browser:browser.version(),names,histograms,diagnostics,
      events:traceEvents.filter(e=>/tflite|onnx|litert|directml|xnnpack|Frame transport|DispatchImpl|OrtRunSync/i.test(e.name)).map(e=>({name:e.name,cat:e.cat,ts:e.ts,pid:e.pid,tid:e.tid,args:e.args}))},null,2));
  }
  if(reportPath)await writeFile(reportPath,JSON.stringify(report,null,2));
  if(report.runs.some(r=>r.webnn.some(m=>m.variant==='fp16'&&m.error&&!m.accuracyPassed)))process.exitCode=1;
}finally{await browser?.close();await server.close();}
