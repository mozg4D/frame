import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../tools/browser.mjs';

export async function cameraRealtimeFrameChecks(page){
const call=(n,a={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[n,a]);
const settled=(after=0)=>page.waitForFunction(n=>{
  const s=frameEngine.renderState();if(s.phase==='error')throw Error(s.errors.join('\n'));
  return s.phase==='complete'&&!s.running&&s.presentedFrames>n;
},after,{timeout:120000});
const samples=async()=> (await call('render.pixels',{linear:true,points:[[.5,.5],[.5,.4],[.02,.02]]})).colors;
const errors=[];
try{
  await page.setViewportSize({width:900,height:630});
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.evaluate(()=>{
    const d=frameEngine.renderer.device;if(d.adapterInfo.isFallbackAdapter)throw Error('Hardware adapter required');
    d.pushErrorScope('validation');
    const src=document.getElementById('frame-pathtracer');
    src.textContent=src.textContent.replace('return new FrameRenderer(container,changed);',`
      const t=new FrameRenderer(container,changed),update=t.onChange;let last=0;
      window.testCamera=t;window.traceEvents=[];
      t.onChange=()=>{if(t.hasImage&&t.stats.presentedFrames>last){last=t.stats.presentedFrames;traceEvents.push({phase:t.stats.phase,n:t.stats.samples,frame:last,eye:[...t.options.camera.position]});}update();};
      return t;`);
  });
  await call('scene.new');
  const cube=await call('scene.create',{type:'cube',params:{'size x':100,'size y':100,'size z':100}});
  await call('view.set',{index:0,single:true,focus:cube.hash});
  const camera=await call('scene.create',{type:'render',params:{quality:1,realtime:'on',environment:'default','resolution x':192,'resolution y':108}});
  await call('scene.select',{ids:[camera.hash]});await page.locator('#tabAttributes').click();
  const fields=await page.locator('#attrContent [data-field]').evaluateAll(nodes=>nodes.map(n=>n.dataset.field));
  assert.ok(fields.includes('quality'));for(const field of ['samples','rays per pixel','idle refinement'])assert.ok(!fields.includes(field));
  await assert.rejects(()=>call('scene.update',{id:camera.hash,params:{quality:101}}),/range/i);
  await settled();
  let s=await call('render.inspect');assert.equal(s.renderer,'Interactive GI');assert.equal(s.primaryVisibility,'raster');assert.equal(s.samples,4);
  const events=await page.evaluate(()=>traceEvents);
  assert.ok(events.some(e=>e.phase==='preview'&&e.n===0)&&events.some(e=>e.phase==='refining'&&e.n>0));
  const lit=await samples();assert.ok(lit[0].slice(0,3).every(x=>Number.isFinite(x)&&x>.01));assert.equal(lit[0][3],s.targetSamples);
  console.log('Numeric quality, native visibility, automatic refinement and linear readback passed');

  const rect=await page.locator('#frame-engine-canvas').boundingBox(),x=rect.x+rect.width*.64,y=rect.y+rect.height*.53;
  await page.evaluate(()=>traceEvents.length=0);
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+25,y+8,{steps:5});
  await page.waitForFunction(()=>traceEvents.at(-1)?.phase==='preview'&&frameEngine.renderState().visible);
  const eye=await page.evaluate(()=>traceEvents.at(-1).eye);
  await page.mouse.move(x+60,y+18,{steps:5});
  await page.waitForFunction(eye=>traceEvents.some(f=>f.eye.some((v,i)=>Math.abs(v-eye[i])>.001)),eye);
  await page.waitForTimeout(240);
  const held=await page.evaluate(()=>traceEvents.slice());
  assert.ok(held.length>=2&&held.every(f=>f.phase==='preview'&&f.n===0));
  await page.mouse.up();await settled(held.at(-1).frame);
  assert.deepEqual(await page.evaluate(()=>traceEvents.at(-1).eye),held.at(-1).eye);
  const toggle=page.locator('button[data-field="realtime during navigation"]');
  const last=(await call('render.inspect')).presentedFrames;await toggle.click();await settled(last);
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+35,y+9,{steps:6});
  await page.waitForFunction(()=>!frameEngine.renderState().visible&&!frameEngine.renderState().running);
  const paused=await call('render.inspect');await page.waitForTimeout(240);assert.equal((await call('render.inspect')).epoch,paused.epoch);
  await page.mouse.up();await settled(paused.presentedFrames);
  s=await call('render.inspect');
  console.log('Held orbit, final pose, and navigation setting passed');

  const before=s.presentedFrames;await call('scene.update',{id:camera.hash,params:{quality:65,environment:'off'}});
  await settled(before);s=await call('render.inspect');assert.equal(s.quality,65);assert.ok(s.samples>4);
  const off=await samples();assert.ok(off.every(p=>p.slice(0,3).every(x=>x===0)),'Previous sky disappeared from all lighting');
  const light=await call('scene.create',{type:'infinite',params:{intensity:200,'angular size':8}});
  const lightBefore=s.presentedFrames;await settled(lightBefore);
  await call('scene.delete',{ids:[light.hash]});await settled((await call('render.inspect')).presentedFrames-1);
  assert.ok((await samples()).every(p=>p.slice(0,3).every(x=>x===0)));
  console.log('Environment, source removal and cache invalidation passed');

  await call('scene.update',{id:camera.hash,params:{environment:'default',quality:100}});
  await page.waitForFunction(()=>{const s=frameEngine.renderState();return s.quality===100&&s.phase==='refining'&&s.samples>0&&s.samples<s.targetSamples;},null,{timeout:60000});
  await call('render.stop');const stopped=await call('render.inspect');await page.waitForTimeout(450);
  assert.equal((await call('render.inspect')).presentedFrames,stopped.presentedFrames);
  // Change the transport scene and exercise the generation boundary during a build.
  await call('scene.update',{id:camera.hash,params:{quality:1}});
  await call('scene.delete',{ids:[cube.hash]});
  await settled(stopped.presentedFrames);
  const empty=await call('render.inspect');assert.equal(empty.triangles,0);
  await call('edit.history',{action:'undo'});await settled(empty.presentedFrames);assert.ok((await call('render.inspect')).triangles>0);
  const restored=await call('render.inspect');await call('edit.history',{action:'redo'});await settled(restored.presentedFrames);assert.equal((await call('render.inspect')).triangles,0);
  console.log('Stop, deletion and Undo/Redo passed');

  const old=await call('render.inspect');await call('scene.update',{id:camera.hash,params:{renderer:'Path tracer'}});
  await settled(old.presentedFrames);assert.equal((await call('render.inspect')).primaryVisibility,'CWBVH8');
  const image=await call('render.export',{kind:'image',download:false});assert.equal(image.width,192);assert.equal(image.height,108);assert.ok(image.bytes>100);
  const video=await call('render.export',{kind:'video',start:0,end:1,download:false});
  assert.equal(video.frames,2);assert.equal(video.width,192);assert.equal(video.height,108);assert.ok(video.bytes>0);assert.equal(video.mime,'video/mp4');
  const saved=await call('scene.export',{format:'hash',includeData:true});
  assert.ok(saved.base64);await call('scene.open',{base64:saved.base64,name:'camera-quality.hash'});
  const reloaded=(await call('scene.inspect')).objects.find(n=>n.type==='render');assert.equal(reloaded.params.quality,1);assert.equal(reloaded.params.renderer,'Path tracer');
  await settled();await call('render.stop');
  // A superseded native snapshot may resolve after Stop.
  await page.evaluate(()=>{
    const tracer=testCamera,start=tracer.start.bind(tracer);
    tracer.start=options=>start({...options,getScene:async cancelled=>{
      await new Promise(resolve=>window.releaseSnapshot=resolve);
      if(cancelled())throw new DOMException('Stopped','AbortError');
      return options.getScene(cancelled);
    }});
  });
  await call('scene.create',{type:'sphere'});
  await page.waitForFunction(()=>typeof window.releaseSnapshot==='function');await call('render.stop');
  const stoppedEpoch=(await call('render.inspect')).epoch;await page.evaluate(()=>releaseSnapshot());await page.waitForTimeout(250);
  const stale=await call('render.inspect');assert.equal(stale.epoch,stoppedEpoch);assert.ok(!stale.running);
  assert.equal(await page.evaluate(async()=>(await frameEngine.renderer.device.popErrorScope())?.message||null),null);
  assert.deepEqual(errors,[]);console.log('Reference tracing, image and video export, and native HASH round trip passed');
  return {pass:true,orbitFrames:held.length,image,video};
}catch(error){return {pass:false,error:error.stack,errors,state:await call('render.inspect').catch(()=>null)};}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const {page,close}=await launch({headless:true});
  try{await ready(page);const result=await cameraRealtimeFrameChecks(page);console.log(JSON.stringify(result));if(!result.pass)process.exitCode=1;}
  finally{await close();}
}
