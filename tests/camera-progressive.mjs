import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../tools/browser.mjs';

export async function cameraProgressiveChecks(page){
  const errors=[],cases=[];
  const call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]);
  try{
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    await page.evaluate(()=>{
      const device=frameEngine.renderer.device;
      if(device.adapterInfo.isFallbackAdapter)throw Error('Hardware adapter required');
      device.pushErrorScope('validation');
      const script=document.querySelector('#frame-pathtracer');
      window.progressiveFixture={factory:Function('return ('+script.textContent+')')()};
      script.textContent=script.textContent.replace('return new FrameRenderer(container,changed);',
        'return progressiveFixture.camera=new FrameRenderer(container,changed);');
    });
    await call('scene.new');
    const car=await call('scene.create',{type:'car'});
    await call('view.set',{index:0,single:true,focus:car.hash});
    await call('scene.create',{type:'render',params:{realtime:'off',samples:1,environment:'default'}});
    for(const scene of ['opaque','transmission','unlit sky']){
      if(scene==='transmission'){
        const glass=await call('material.create',{params:{opac:60,rough:12,h:190,s:35,l:65}});
        await call('material.assign',{id:car.hash,material:glass.uid});
      }
      const initial=await call('render.start');
      assert.equal(initial.phase,'complete',JSON.stringify(initial.errors));
      await call('render.stop');
      const result=await page.evaluate(async scene=>{
        const cached=scene==='opaque',sky=scene==='unlit sky';
        const {factory,camera}=progressiveFixture;
        const options={...camera.options,outputSize:[157,101],sampleLimit:cached?19:sky?143:145,
          frameSeed:4231,sampler:cached?'sobol':'random',viewKey:'fixed',previewPresentation:false};
        if(sky){
          options.camera={...options.camera,forward:options.camera.forward.map(v=>-v)};
          options.environment={...options.environment,mode:'off',infiniteLights:[]};
        }
        async function render(serial,interrupt){
          const host=document.createElement('div');document.body.append(host);
          const tracer=factory(host,camera.device,()=>{});
          const started=performance.now();
          let checkpoint,meters=0;
          try{
            const meter=tracer.meterExposure.bind(tracer);
            tracer.meterExposure=encoder=>{meters++;meter(encoder);};
            if(!serial){
              // Exercise the row stride used when a full-image pass exceeds a GPU's X limit.
              const dispatch=tracer.dispatchPixels;
              tracer.dispatchPixels=function(pass,count){
                const limits={maxComputeWorkgroupsPerDimension:127};
                return dispatch.call(count===157*101?{device:{limits}}:this,pass,count);
              };
            }
            if(interrupt){
              // Force a split *inside* a later sample block, after the first presentation.
              Object.defineProperty(tracer,'progressiveBudget',{get:()=>8192,set(){}});
              const submit=tracer.submitCommands.bind(tracer);
              tracer.submitCommands=encoder=>{
                submit(encoder);
                if(encoder.label==='Progressive camera'&&tracer.progress?.sample>=4&&tracer.progress.offset>0){
                  checkpoint={sample:tracer.progress.sample,offset:tracer.progress.offset};
                  tracer.submitCommands=submit;tracer.stop(false);
                }
              };
            }
            const settings={...options,legacyScheduling:serial,previewPresentation:serial};
            await tracer.start(settings);
            if(interrupt){
              if(!checkpoint||tracer.completed)throw Error('Expected partial film');
              await tracer.start(settings);
            }
            const stats=tracer.stats;
            if(stats.phase!=='complete'||stats.lightingReuse!==cached||stats.samples!==options.sampleLimit)
              throw Error(JSON.stringify({phase:stats.phase,reuse:stats.lightingReuse,samples:stats.samples,errors:stats.errors}));
            const film=await tracer.readFilm(),image=await tracer.readImage();
            return {film,image,checkpoint,meters,ms:performance.now()-started,queueBuilds:stats.queueBuilds,
              submissions:stats.performance.submissions,samples:stats.newCameraSamples};
          }finally{tracer.dispose();host.remove();}
        }
        const reference=await render(true,false),packed=await render(false,false),resumed=await render(false,true);
        let min=Infinity,max=0,low=Infinity,high=-Infinity;
        for(let i=0;i<reference.film.data.length;i++){
          const value=reference.film.data[i];
          if(!Number.isFinite(value)||value!==packed.film.data[i]||value!==resumed.film.data[i])
            throw Error('Linear film mismatch at float '+i+' ('+[value,packed.film.data[i],resumed.film.data[i]]+')');
          const channel=i%reference.film.stride;
          if(channel===3){min=Math.min(min,value);max=Math.max(max,value);}
          if(channel<3){low=Math.min(low,value);high=Math.max(high,value);}
        }
        for(let i=0;i<reference.image.rgba.length;i++){
          if(reference.image.rgba[i]!==packed.image.rgba[i]||reference.image.rgba[i]!==resumed.image.rgba[i])
            throw Error('Display mismatch at byte '+i);
        }
        return {scene,min,max,range:high-low,queueBuilds:packed.queueBuilds,samples:packed.samples,
          meters:[reference.meters,packed.meters,resumed.meters],
          referenceSamples:reference.samples,resumedSamples:resumed.samples,checkpoint:resumed.checkpoint,
          serial:reference.submissions,packed:packed.submissions,ms:packed.ms};
      },scene);
      cases.push(result);
      assert.ok(result.ms<10000&&result.packed<result.serial,JSON.stringify(result));
      assert.ok(result.checkpoint.sample>=4&&result.checkpoint.offset>0);
      assert.equal(new Set(result.meters).size,1);
      assert.equal(result.samples,result.referenceSamples);assert.equal(result.samples,result.resumedSamples);
      if(scene==='unlit sky'){
        assert.equal(result.range,0);assert.equal(result.min,130);assert.equal(result.max,130);
        assert.equal(result.meters[0],21);assert.ok(result.queueBuilds>0);
      }else{
        assert.ok(result.range>.1);
        if(scene==='opaque'){assert.equal(result.min,19);assert.equal(result.max,19);}
        else{assert.ok(result.min>=128&&result.min<result.max&&result.max===145);assert.ok(result.queueBuilds>0);}
      }
    }
    const validation=await page.evaluate(async()=>(await frameEngine.renderer.device.popErrorScope())?.message);
    assert.equal(validation,undefined);assert.deepEqual(errors,[]);
    return {pass:true,cases};
  }catch(error){return {pass:false,error:error.stack,cases,errors};}
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const session=await launch({headless:true});
  try{await ready(session.page);const result=await cameraProgressiveChecks(session.page);console.log(JSON.stringify(result));process.exitCode=result.pass?0:1;}
  finally{await session.close();}
}
