import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {serve} from '../tools/browser.mjs';

// A round trip through an actual shader, WebNN graph and WebGPU readback.
// A returned handle alone does not demonstrate shared physical memory.
async function probe(){
  const result={available:!!navigator.ml,contexts:[]};
  if(!navigator.ml)return result;
  const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
  if(!adapter||adapter.info.isFallbackAdapter)throw Error('Hardware adapter required');
  const device=await adapter.requestDevice();
  try{
    for(const mode of ['gpu','same-device','npu']){
      const row={mode};result.contexts.push(row);let ctx,x,y,graph,read;
      device.pushErrorScope('validation');
      try{
        ctx=await navigator.ml.createContext(mode==='same-device'?device:{deviceType:mode});
        row.contextCreated=true;ctx.lost?.then(info=>{row.contextLoss=info.message;},()=>{});
        const d={dataType:'float32',shape:[4]};
        row.stage='build';
        const builder=new MLGraphBuilder(ctx),a=builder.input('a',d);
        graph=await builder.build({y:builder.add(a,a)});
        row.graphDevices=graph.devices?Array.from(graph.devices):null;
        row.stage='allocate';x=await ctx.createExportableTensor({...d,writable:true},device);
        y=await ctx.createExportableTensor({...d,readable:true},device);
        const shader=device.createShaderModule({code:`@group(0) @binding(0) var<storage,read_write> x:array<f32>;
          @compute @workgroup_size(4) fn main(@builtin(local_invocation_index) i:u32){x[i]=f32(i+1u);}`});
        const pipe=await device.createComputePipelineAsync({layout:'auto',compute:{module:shader,entryPoint:'main'}});
        row.stage='write GPU input';const input=ctx.exportToGPU(x),enc=device.createCommandEncoder(),pass=enc.beginComputePass();
        pass.setPipeline(pipe);pass.setBindGroup(0,device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:input}}]}));
        pass.dispatchWorkgroups(1);pass.end();device.queue.submit([enc.finish()]);input.destroy();
        row.stage='dispatch and export';ctx.dispatch(graph,{a:x},{y});
        const output=ctx.exportToGPU(y),copy=device.createCommandEncoder();
        read=device.createBuffer({size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
        copy.copyBufferToBuffer(output,0,read,0,16);device.queue.submit([copy.finish()]);output.destroy();
        row.stage='read GPU result';await read.mapAsync(GPUMapMode.READ);row.values=Array.from(new Float32Array(read.getMappedRange()));read.unmap();
        row.verified=row.values.every((v,i)=>v===2*(i+1));
      }catch(e){row.failure=String(e);}
      finally{
        for(const resource of [read,graph,x,y,ctx])try{resource?.destroy();}catch{}
        try{row.validation=(await device.popErrorScope())?.message||null;}catch(e){row.deviceFailure=String(e);}
      }
      if(row.deviceFailure)break;
    }
  }finally{device.destroy();}
  return result;
}

const args=process.argv.slice(2),channels=(args.find(a=>a.startsWith('--channels='))?.slice(11)||'chromium').split(',');
const report=args.find(a=>a.startsWith('--report='))?.slice(9),server=await serve(),results=[];
const flag='WebMachineLearningNeuralNetwork',experimental='ExperimentalWebMachineLearningNeuralNetwork';
const profiles={default:[],webnn:['--enable-features='+flag],
  onnx:['--enable-features='+[flag,experimental,'WebNNOnnxRuntime'].join(',')],
  directml:['--enable-features='+[flag,experimental,'WebNNDirectML'].join(','),'--disable-features=WebNNOnnxRuntime'],
  literender:['--enable-features='+[flag,experimental,'WebNNLiteRTGpuInRenderer'].join(',')]};
try{
  for(const channel of channels)for(const [profile,flags] of Object.entries(profiles)){
    const row={channel,profile,flags};results.push(row);let browser;
    try{
      browser=await chromium.launch({headless:true,channel,args:['--enable-unsafe-webgpu',...flags]});
      row.version=browser.version();const page=await browser.newPage();await page.goto(server.url+'/frame-icon.svg');
      Object.assign(row,await page.evaluate(probe));
      assert.ok(row.contexts.every(r=>!r.validation&&(!r.values||r.verified)));
    }catch(error){row.failure=String(error);}
    finally{await browser?.close();}
    console.log(channel,profile,row.contexts?.filter(c=>c.verified).map(c=>c.mode)||row.failure);
    if(report)await writeFile(report,JSON.stringify(results,null,2));
  }
}finally{await server.close();}
if(results.every(r=>r.failure)||results.some(r=>r.contexts?.some(c=>c.validation||c.values&&!c.verified)))process.exitCode=1;
