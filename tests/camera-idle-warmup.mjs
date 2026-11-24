import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../tools/browser.mjs';

function observeCameraPrograms(){
  const probe=window.cameraWarmTest={calls:[],frames:[],holds:new Set(['renderRealtime','gatherSkyTiles']),release:{},pipelines:new WeakMap()};
  for(const method of ['createComputePipelineAsync','createRenderPipelineAsync']){
    const native=GPUDevice.prototype[method];
    GPUDevice.prototype[method]=function(descriptor){
      const stage=descriptor.compute||descriptor.vertex,name=stage.module.label;
      if(!name?.startsWith('FRAME '))return native.call(this,descriptor);
      const entry=stage.entryPoint,record={name,entry,features:stage.constants?.variableSceneFeatures,start:performance.now()};
      probe.calls.push(record);
      return native.call(this,descriptor).then(async pipeline=>{
        probe.pipelines.set(pipeline,record);record.compiled=performance.now();
        if(probe.holds.delete(entry))await new Promise(resolve=>probe.release[entry]=resolve);
        record.end=performance.now();return pipeline;
      });
    };
  }
  document.addEventListener('click',event=>{
    if(event.target.closest?.('#btnRender')){probe.click=performance.now();probe.frames=[];}
  },true);
}

export async function cameraIdleWarmupChecks(page){
  const errors=[],cases=[];
  page.on('pageerror',error=>errors.push(error.message));
  const call=(name,args={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[name,args]);
  const wait=predicate=>page.waitForFunction(predicate,null,{timeout:60000});
  try{
    await page.addInitScript(observeCameraPrograms);await page.reload();await ready(page);
    await page.evaluate(()=>{
      const device=frameEngine.renderer.device;
      if(device.adapterInfo.isFallbackAdapter)throw Error('Hardware adapter required');
      device.pushErrorScope('validation');
      const script=document.getElementById('frame-pathtracer'),probe=cameraWarmTest;
      probe.factory=Function('return ('+script.textContent+')')();
      probe.watch=tracer=>{
        probe.tracer=tracer;
        const prepare=tracer.prepareCameraPrograms;
        tracer.prepareCameraPrograms=function(...args){
          if(this.options.interactivePreview)probe.prefetch=performance.now();
          return prepare.apply(this,args);
        };
        const present=tracer.markPresented;
        tracer.markPresented=function(started){
          const preview=!!this.options.interactivePreview;
          if(!probe.frames.some(frame=>frame.preview===preview)){
            const pipeline=preview?(this.reuseLighting()?this.giComposite:this.renderRealtime):this.integrate;
            const compiled=probe.pipelines.get(pipeline);
            probe.frames.push({preview,at:performance.now(),features:compiled?.features,entry:compiled?.entry});
          }
          return present.call(this,started);
        };
        return tracer;
      };
      script.textContent=script.textContent.replace('return new FrameRenderer(container,changed);','return cameraWarmTest.watch(new FrameRenderer(container,changed));');
    });
    const cube=await call('scene.create',{type:'cube'});
    await call('view.set',{index:0,single:true,focus:cube.hash});
    await call('scene.select',{ids:[]});
    await wait(()=>cameraWarmTest.release.renderRealtime);
    assert.equal((await call('render.inspect')).phase,'idle');
    assert.equal(await page.locator('#frame-render-canvas').count(),0);
    const box=await page.locator('#frame-engine-canvas').boundingBox(),x=box.x+box.width*.7,y=box.y+box.height*.65;
    await page.mouse.move(x,y);await page.mouse.down();
    const before=await page.evaluate(()=>({yaw:frameEngine.viewCamera(0).camera[0],count:cameraWarmTest.calls.length}));
    await page.evaluate(()=>cameraWarmTest.release.renderRealtime());
    await page.mouse.move(x+44,y+13,{steps:12});await page.waitForTimeout(200);
    assert.notEqual(await page.evaluate(()=>frameEngine.viewCamera(0).camera[0]),before.yaw);
    assert.equal(await page.evaluate(()=>cameraWarmTest.calls.length),before.count,'no new compilation during a held orbit');
    await page.mouse.up();
    await wait(()=>cameraWarmTest.release.gatherSkyTiles);
    const quiet=await page.evaluate(()=>cameraWarmTest.calls.every((c,i,list)=>!i||c.start>=list[i-1].end));
    assert.ok(quiet,'idle work admits one program at a time');
    await page.locator('#btnRender').click();
    await wait(()=>cameraWarmTest.frames.some(f=>f.preview));
    assert.ok(await page.evaluate(()=>cameraWarmTest.prefetch<=cameraWarmTest.frames[0].at),'stationary preview starts its refinement preparation before presentation');
    await wait(()=>cameraWarmTest.calls.some(c=>c.entry==='gatherSkyTiles'));
    assert.equal(await page.evaluate(()=>cameraWarmTest.frames.length),1,'preview is visible while progressive preparation is finishing');
    assert.equal(await page.evaluate(()=>cameraWarmTest.calls.filter(c=>c.entry==='gatherSkyTiles').length),1,'foreground joins the in-flight idle program');
    await page.evaluate(()=>cameraWarmTest.release.gatherSkyTiles());
    await wait(()=>cameraWarmTest.frames.some(f=>!f.preview));
    cases.push({name:'Camera added during warmup',frames:await page.evaluate(()=>cameraWarmTest.frames.map(f=>({preview:f.preview,uniformFlags:f.features,ms:f.at-cameraWarmTest.click})))});
    assert.equal(cases[0].frames[1].uniformFlags,15);
    await call('render.stop');
    const cameras=(await call('scene.inspect')).objects.filter(o=>o.type==='render');
    await call('scene.delete',{ids:cameras.map(o=>o.hash)});
    await wait(()=>frameEngine.renderer.cameraWarmup.done&&!document.querySelector('#frame-render-canvas'));
    assert.ok(await page.evaluate(()=>['realtime','gi','independent'].every(mode=>frameEngine.renderer.cameraShaders.programs.universal(mode).ready)));
    const instance=await call('scene.create',{type:'instance',params:{object:cube.hash}});
    await call('transform.set',{ids:[instance.hash],channel:'position',axis:0,value:120});
    await page.locator('#btnRender').click();
    await wait(()=>cameraWarmTest.frames.some(f=>!f.preview));
    const measurements=await page.evaluate(()=>{
      const p=cameraWarmTest,[preview,refined]=p.frames;
      return {previewMs:preview.at-p.click,transitionMs:refined.at-preview.at,refineFeatures:refined.features,
        newCompiles:p.calls.filter(c=>c.start>=p.click&&c.start<refined.at).length,instances:p.tracer.scene.instances};
    });
    assert.ok(measurements.instances>0,'shared geometry uses the instanced BVH');
    assert.equal(measurements.refineFeatures,15);assert.equal(measurements.newCompiles,0);
    assert.ok(measurements.previewMs<1000&&measurements.transitionMs<1000,JSON.stringify(measurements));
    cases.push({name:'Camera added after warmup on changed geometry',...measurements});
    await call('render.stop');
    // Compare complete, fixed-seed films to the specialized cold path, including short untiled output.
    const films=await page.evaluate(async()=>{
      const probe=cameraWarmTest,base=probe.tracer,device=frameEngine.renderer.device,results=[];
      for(const settings of [{sampleLimit:4},{sampleLimit:19},{sampleLimit:11,lightingReuse:false}]){
        const limits={...base.options,...settings,interactivePreview:false,frameSeed:41,outputSize:[73,57],previewPresentation:false};
        const render=async shared=>{
          const host=document.createElement('div'),tracer=probe.factory(host,device,()=>{},shared);
          let firstFeatures;
          const present=tracer.markPresented;
          tracer.markPresented=function(started){
            firstFeatures??=probe.pipelines.get(this.integrate).features;
            return present.call(this,started);
          };
          try{
            const startCalls=probe.calls.length;
            await tracer.start(limits);
            if(tracer.stats.phase!=='complete')throw Error(tracer.stats.errors.join('\n')||tracer.stats.phase);
            const compiles=probe.calls.slice(startCalls).filter(c=>c.entry==='integrate').length;
            return {data:(await tracer.readFilm()).data,firstFeatures,compiles};
          }finally{tracer.dispose();}
        };
        const cold=await render({}),warm=await render(frameEngine.renderer.cameraShaders);
        let error=0;for(let i=0;i<cold.data.length;i++)error=Math.max(error,Math.abs(cold.data[i]-warm.data[i]));
        results.push({...settings,coldFeatures:cold.firstFeatures,warmFeatures:warm.firstFeatures,warmCompiles:warm.compiles,maxFilmError:error});
      }
      return results;
    });
    for(const film of films){
      assert.notEqual(film.coldFeatures,15);assert.equal(film.warmCompiles,0,JSON.stringify(film));
      assert.ok(film.warmFeatures===15||film.warmFeatures===0,JSON.stringify(film));
      assert.ok(film.maxFilmError<.0001,JSON.stringify(film));
    }
    cases.push({name:'Warmed and specialized films',films});
    const active=(await call('scene.inspect')).objects.find(o=>o.type==='render'&&o.enabled);
    await call('scene.delete',{ids:[active.hash]});
    await wait(()=>!document.querySelector('#frame-render-canvas'));
    const glass=await call('material.create',{params:{opac:60,rough:12}});
    await call('material.assign',{id:cube.hash,material:glass.uid});
    await page.locator('#btnRender').click();
    await wait(()=>cameraWarmTest.frames.some(f=>!f.preview));
    const transparent=await page.evaluate(()=>{
      const p=cameraWarmTest,[preview,refined]=p.frames;
      return {entry:refined.entry,features:refined.features,transitionMs:refined.at-preview.at,
        compiles:p.calls.filter(c=>c.start>=p.click&&c.start<refined.at).length};
    });
    assert.equal(transparent.entry,'integrate');assert.equal(transparent.features,15);assert.equal(transparent.compiles,0);
    cases.push({name:'Transparent material added after warmup',...transparent});await call('render.stop');
    assert.equal(await page.evaluate(async()=>(await frameEngine.renderer.device.popErrorScope())?.message),undefined);
    assert.deepEqual(errors,[]);return {pass:true,cases};
  }catch(error){
    return {pass:false,error:error.stack,errors,cases,state:await page.evaluate(()=>({render:frameEngine.renderState(),calls:window.cameraWarmTest?.calls,frames:window.cameraWarmTest?.frames})).catch(()=>null)};
  }
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const run=await launch({headless:true});
  try{await ready(run.page);const result=await cameraIdleWarmupChecks(run.page);console.log(JSON.stringify(result));process.exitCode=result.pass?0:1;}
  finally{await run.close();}
}
