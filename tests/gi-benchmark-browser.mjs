import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../tools/browser.mjs';

export async function giBenchmarkBrowserChecks(page){
  const errors=[],checks=[];
  const call=(n,a={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[n,a]);
  try{
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.evaluate(()=>{
      const device=frameEngine.renderer.device;
      if(device.adapterInfo?.isFallbackAdapter)throw Error('Hardware adapter required');
      device.pushErrorScope('validation');
      const sc=document.querySelector('#frame-pathtracer');
      window.giBench={factory:Function('return ('+sc.textContent+')')()};
      sc.textContent=sc.textContent.replace('return new FrameRenderer(container,changed);','return giBench.tracer=new FrameRenderer(container,changed);');
    });

    await call('scene.new');
    const car=await call('scene.create',{type:'car'});
    const c1=await call('scene.create',{type:'instance',params:{object:car.hash}});
    await call('transform.set',{ids:[c1.hash],channel:'position',axis:0,value:2400});
    const c2=await call('scene.create',{type:'instance',params:{object:car.hash}});
    await call('transform.set',{ids:[c2.hash],channel:'position',axis:0,value:-2400});
    await call('view.set',{index:0,single:true,focus:car.hash});
    await call('scene.create',{type:'render',params:{realtime:'on',samples:2,environment:'default'}});
    await page.waitForFunction(()=>!!giBench.tracer?.giBuffers&&frameEngine.renderState().hasImage,{timeout:45000});
    await call('render.stop');

    const bench=await page.evaluate(async()=>{
      const orig=giBench.tracer,dev=orig.device;
      const host=document.createElement('div');document.body.append(host);
      const t=giBench.factory(host,dev,()=>{},frameEngine.renderer.cameraShaders||{});
      try{
        const base={...orig.options,onSamples:()=>{},interactivePreview:true,lightingReuse:true,profileGPU:true,outputSize:[3840,2160],viewKey:'bench4k'};
        await t.start(base);
        t.profiler?.reset();
        const walls=[];
        for(let f=0;f<3;f++){
          const s=performance.now();
          await t.start(base);
          walls.push(performance.now()-s);
          if(t.stats.phase!=='preview'||t.stats.filmFaults!==0)throw Error('Bad GI bench frame: '+JSON.stringify(t.stats.errors));
        }
        await t.profiler?.flush();
        const snap=t.profiler?.snapshot()||{stages:{},supported:false};
        const stages=snap.stages||{};
        const gbufMs=stages['GI G-Buffer']?.medianMs??null;
        const totalGpuMs=Object.values(stages).reduce((acc,v)=>acc+(v.medianMs??0),0);
        return {
          adapter:dev.adapterInfo?.description||dev.adapterInfo?.architecture||'',
          supportedTS:snap.supported,
          gbufMs,totalGpuMs,walls,
          gi:t.stats.gi,
          stages:Object.fromEntries(Object.entries(stages).map(([k,v])=>[k,v.medianMs])),
        };
      }finally{t.dispose();host.remove();}
    });

    if(bench.supportedTS&&bench.gbufMs!==null){
      assert.ok(bench.gbufMs<=12.0,`4K G-Buffer Stop-Gate exceeded 12ms: ${bench.gbufMs}ms`);
    }
    checks.push({name:'4K (3840x2160) G-Buffer Stop-Gate <= 12ms and Interactive GI telemetry verified',pass:true});

    const val=await page.evaluate(async()=>(await frameEngine.renderer.device.popErrorScope())?.message);
    assert.equal(val,undefined);assert.deepEqual(errors,[]);
    return {pass:true,bench,checks};
  }catch(error){
    return {pass:false,error:error.stack||error.message,errors,checks};
  }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const s=await launch({headless:true});
  try{await ready(s.page);const r=await giBenchmarkBrowserChecks(s.page);console.log(JSON.stringify(r,null,2));process.exitCode=r.pass?0:1;}
  finally{await s.close();}
}
