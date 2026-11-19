import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../tools/browser.mjs';

export async function cameraRealtimeFrameChecks(page){
const errors=[];
const call=(name,args={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[name,args]);
const settled=()=>page.waitForFunction(()=>frameEngine.renderState().phase==='complete',null,{timeout:60000});
try{
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.evaluate(()=>{
    const device=frameEngine.renderer.device;
    if(device.adapterInfo.isFallbackAdapter)throw Error('Hardware adapter required');
    device.pushErrorScope('validation');
    const script=document.querySelector('#frame-pathtracer');
    window.cameraTest={source:script.textContent,frames:[]};
    script.textContent=script.textContent.replace('return new FrameRenderer(container,changed);',`
      const tracer=new FrameRenderer(container,changed),publish=tracer.markPresented;
      tracer.markPresented=function(started){
        publish.call(this,started);
        cameraTest.frames.push({mode:this.stats.interactivePreview,eye:[...this.options.camera.position],
          epoch:this.epoch,builds:this.stats.sceneBuilds,ms:this.stats.firstImageMs,submissions:this.stats.performance.submissions});
      };
      cameraTest.tracer=tracer;return tracer;`);
  });
  await call('scene.new');
  const car=await call('scene.create',{type:'car'});
  await call('view.set',{index:0,single:true,focus:car.hash});
  const camera=await call('scene.create',{type:'render',params:{realtime:'on',samples:4,environment:'default'}});
  await settled();
  const before=await page.evaluate(()=>({frames:cameraTest.frames.splice(0),state:frameEngine.renderState()}));
  assert.ok(before.frames[0].mode&&before.frames[0].submissions===1,'cold camera displays interactive film first');
  assert.equal(before.state.samples,4);
  const rect=await page.locator('#frame-engine-canvas').boundingBox(),x=rect.x+rect.width*.64,y=rect.y+rect.height*.53;
  await page.mouse.move(x,y);await page.mouse.down();
  await page.mouse.move(x+25,y+8,{steps:5});
  await page.waitForFunction(()=>cameraTest.frames.some(f=>f.mode)&&frameEngine.renderState().visible);
  const firstEye=await page.evaluate(()=>cameraTest.frames.at(-1).eye);
  await page.mouse.move(x+60,y+18,{steps:5});
  await page.waitForFunction(eye=>{const f=cameraTest.frames.at(-1);return f?.mode&&f.eye.some((v,i)=>Math.abs(v-eye[i])>.001);},firstEye);
  await page.waitForTimeout(150);
  const held=await page.evaluate(()=>cameraTest.frames.slice());
  assert.ok(held.every(f=>f.mode),'only interactive previews during the held orbit');
  await page.mouse.up();await settled();
  assert.equal((await call('render.inspect')).samples,4);
  const orbitEye=await page.evaluate(()=>cameraTest.frames.at(-1).eye);
  assert.deepEqual(orbitEye,held.at(-1).eye,'refinement uses the final orbit pose');
  await page.evaluate(()=>cameraTest.frames.length=0);
  await page.mouse.wheel(0,-120);
  await page.waitForFunction(eye=>cameraTest.frames.some(f=>f.mode&&f.eye.some((v,i)=>Math.abs(v-eye[i])>.001)),orbitEye);
  await settled();
  await call('scene.select',{ids:[camera.hash]});
  await page.locator('#tabAttributes').click();
  const toggle=page.locator('button[data-field="realtime during navigation"]');
  assert.equal(await toggle.getAttribute('aria-pressed'),'true');
  await toggle.click();await settled();
  assert.equal(await toggle.getAttribute('aria-pressed'),'false');
  await page.mouse.move(x,y);await page.mouse.down();
  for(let i=1;i<=24;i++)await page.mouse.move(x+i*3,y+Math.sin(i*.15)*14);
  await page.waitForFunction(()=>!frameEngine.renderState().visible&&!frameEngine.renderState().running);
  const idleEpoch=await page.evaluate(()=>cameraTest.tracer.epoch);
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>cameraTest.tracer.epoch),idleEpoch,'held camera keeps the path tracer stopped');
  await page.mouse.up();await settled();
  const after=await call('render.inspect');
  assert.equal(after.samples,4);assert.equal(after.sceneBuilds,before.state.sceneBuilds);
  assert.equal(after.interactivePreview,false);
  // Hold an actual cold scene snapshot open across Stop. Resolving the old work
  // must not reveal the overlay or enqueue a refinement for the stopped camera.
  await page.evaluate(()=>{
    const tracer=cameraTest.tracer,start=tracer.start.bind(tracer),compile=tracer.initCameraPipelines.bind(tracer);
    tracer.initCameraPipelines=(mode,...args)=>{
      if(mode==='realtime')cameraTest.previewPipelineRequested=true;
      return compile(mode,...args);
    };
    tracer.start=opts=>start({...opts,getScene:async cancelled=>{
      await new Promise(resolve=>cameraTest.unblock=resolve);
      if(cancelled())throw new DOMException('Stopped','AbortError');
      return opts.getScene(cancelled);
    }});
    cameraTest.restore=()=>{tracer.start=start;tracer.initCameraPipelines=compile;};
  });
  const sphere=await call('scene.create',{type:'sphere',params:{diameter:100}});
  await page.waitForFunction(()=>!!cameraTest.unblock&&cameraTest.previewPipelineRequested,null,{timeout:5000});
  await call('render.stop');
  await page.evaluate(()=>{cameraTest.restore();cameraTest.unblock();});
  await page.waitForTimeout(150);
  const stopped=await call('render.inspect');
  assert.ok(!stopped.visible&&!stopped.running,'Stop wins over a superseded automatic snapshot');
  await call('scene.update',{id:camera.hash,params:{realtime:'off','resolution x':240,'resolution y':160}});
  const glass=await call('material.create',{params:{opac:60,rough:10,h:190,s:35,l:65}});
  await call('material.assign',{id:sphere.hash,material:glass.uid});
  await call('render.start');
  const comparison=await page.evaluate(async()=>{
    const original=cameraTest.tracer,device=original.device;
    const host=document.createElement('div'),factory=Function('return ('+cameraTest.source+')')();
    document.body.append(host);
    const tracer=factory(host,device,()=>{}),times=[];
    try{
      // Odd dimensions exercise both padded edges of the 8x8 dispatch.
      const options={...original.options,sceneKey:'film',outputSize:[225,177],sampleLimit:2,
        frameSeed:1234,lightingReuse:false,profileGPU:true};
      await tracer.start({...options,viewKey:'reference'});
      if(tracer.stats.phase!=='complete')throw Error(tracer.stats.errors.join('\n'));
      const reference=await tracer.readFilm();
      let maxRGBError=0,min=Infinity,max=-Infinity;
      for(let frame=0;frame<6;frame++){
        await tracer.start({...options,interactivePreview:true,viewKey:'realtime'+frame});
        if(tracer.stats.phase!=='preview'||tracer.stats.newCameraSamples!==225*177*2)throw Error('Incomplete interactive film');
        await tracer.profiler.flush();
        const stages=tracer.profiler.snapshot().stages;
        times.push({wallMs:tracer.stats.firstImageMs,cpuEncodeMs:tracer.stats.performance.encodeMs,
          gpuTraceMs:stages['Realtime camera paths']?.totalMs,measuredGpuMs:Object.values(stages).reduce((sum,s)=>sum+s.totalMs,0)});
      }
      const film=await tracer.readFilm();
      for(let p=0;p<film.data.length;p+=film.stride){
        if(film.data[p+3]!==2||reference.data[p+3]!==2)throw Error('Incorrect sample count');
        for(let k=0;k<3;k++){
          const v=film.data[p+k];min=Math.min(min,v);max=Math.max(max,v);
          maxRGBError=Math.max(maxRGBError,Math.abs(v-reference.data[p+k]));
        }
      }
      return {maxRGBError,min,max,times};
    }finally{tracer.dispose();host.remove();}
  });
  assert.ok(comparison.maxRGBError<.0001&&comparison.max-comparison.min>.1,JSON.stringify(comparison));
  assert.ok(comparison.times.every(t=>t.gpuTraceMs>0&&t.wallMs<300),'bounded completed hardware frames');
  const image=await call('render.export',{kind:'image',download:false});
  assert.ok(image.width===240&&image.height===160&&image.bytes>0&&image.mime.startsWith('image/'));
  const film=await call('render.pixels',{points:[[.5,.5]],linear:true});
  assert.equal(film.colors[0][3],4,'export renders all configured samples');
  const video=await call('render.export',{kind:'video',start:0,end:1,download:false});
  assert.ok(video.width===240&&video.height===160&&video.frames===2&&video.bytes>0&&video.mime==='video/mp4');
  await call('render.stop');
  const file=await call('scene.export',{includeData:true});
  await call('scene.open',{name:'camera-navigation.hash',base64:file.base64});
  const restored=(await call('scene.inspect')).objects.find(o=>o.hash===camera.hash);
  assert.equal(restored.params['realtime during navigation'],false,'per-camera navigation choice survives HASH');
  const validation=await page.evaluate(async()=>(await frameEngine.renderer.device.popErrorScope())?.message);
  assert.equal(validation,undefined);assert.deepEqual(errors,[]);
  return {pass:true,orbitFrames:held.length,firstPreviewMs:before.frames[0].ms,comparison,image,video};
}catch(error){
  return {pass:false,error:error.stack,errors,details:await page.evaluate(()=>({render:frameEngine.renderState(),frames:window.cameraTest?.frames.slice(-4)})).catch(()=>null)};
}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const session=await launch({headless:true});
  try{await ready(session.page);const result=await cameraRealtimeFrameChecks(session.page);console.log(JSON.stringify(result));process.exitCode=result.pass?0:1;}
  finally{await session.close();}
}
