// Isolated native Camera View reproduction. Never attaches to existing user tabs.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {serve,ready} from '../tools/browser.mjs';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

// Default procedural studio lighting has positive neutral ambient (.035..26)
// plus white lobes. The emissive fixture is unit-radiance white. An off-world
// black-background oracle does not apply to the untouched toolbar Camera.
export function standardCameraFilmValid(pixels,samples=128){
 const colors=pixels?.colors;if(!Number.isInteger(samples)||samples<=0||!pixels?.width||!pixels?.height||!Array.isArray(colors)||colors.length!==2||colors.some(c=>!Array.isArray(c)||c.length!==4||!c.every(Number.isFinite)||c[3]!==samples))return false;
 const [foreground,background]=colors,neutral=background.slice(0,3);
 return foreground.slice(0,3).every((v,k)=>v>=.99&&v-background[k]>=.5)&&neutral.every(v=>v>=.034)&&Math.max(...neutral)-Math.min(...neutral)<1e-5;
}

export async function cameraViewChecks(page){
 const checks=[],timings=[],observations=[],call=(name,args={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[name,args]);
 const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});assert.ok(pass,name+': '+JSON.stringify(detail));};
 const inspect=()=>page.evaluate(()=>({render:frameEngine.renderState(),active:activeView,main:mainActiveView,single,visible:[...frameViewSections.keys()].filter(frameViewVisible),overlay:document.querySelector('#frame-render-canvas')?.outerHTML,error:document.querySelector('#frame-engine-canvas')?.dataset.operationError}));
 const clickView=async label=>{
  await page.locator('#tabAttributes').click();observations.push({label,before:await inspect()});const t=performance.now();await page.locator('#frameRenderToggle').click();
  await page.waitForFunction(()=>{const s=frameEngine.renderState();return s.phase==='complete'&&s.hasImage&&s.visible||s.phase==='error';},{},{timeout:20000});
  const actual=await inspect(),ms=performance.now()-t;observations.push({label,after:actual});timings.push({name:label,ms,budgetMs:20000});
  check(label+' completes a visible shared-device image',actual.render.phase==='complete'&&actual.render.hasImage&&actual.render.visible&&actual.render.sharedDevice&&!actual.render.errors?.length,actual);
  check(label+' latency',ms<20000,{ms,budgetMs:20000});
  const pixels=await call('render.pixels',{points:[[.5,.5],[.03,.03]],linear:true});check(label+' renders the emissive foreground and dark background',pixels.colors.length===2&&pixels.colors.flat().every(Number.isFinite)&&pixels.colors[0].slice(0,3).every(v=>v>.1)&&pixels.colors[1].slice(0,3).every(v=>v<.01),pixels);
  await page.locator('#frameRenderToggle').click();check(label+' second click stops and hides',!(await inspect()).render.visible);
 };
 try{
  await call('scene.new');const mesh=await call('mesh.create',{vertices:[-60,-60,0,60,-60,0,0,60,0,0,0,60],indices:[0,2,1,0,1,3,0,3,2,1,2,3]});
  const material=await call('material.create',{params:{h:0,s:0,l:100,emm:100}});await call('material.assign',{id:mesh.hash,material:material.uid});await call('view.set',{index:0,single:true,focus:mesh.hash});
  const camera=await call('scene.create',{type:'render',params:{realtime:'off',samples:1,environment:'off'}});await call('scene.select',{ids:[camera.hash]});
  for(const index of [0,1,2,3]){await call('view.set',{index,single:true});await clickView('Native View from single viewport '+index);check('Single View reveals main Perspective '+index,(await inspect()).main===0);}
  await call('view.set',{index:2,single:false});await clickView('Native View from quad orthographic');check('Quad View retains active orthographic',(await inspect()).active===2);
  const opened=await call('view.window',{action:'open',index:0}),extra=opened.opened;check('Additional Perspective opens',Number.isInteger(extra)&&extra>=4,opened);
  await call('view.set',{index:extra,single:true});await page.bringToFront();await clickView('Native View with additional Perspective active');await call('view.window',{action:'close',index:extra});
  await call('scene.delete',{ids:[camera.hash]});await call('edit.history',{action:'undo'});await call('scene.select',{ids:[camera.hash]});await clickView('Native View after camera delete/Undo');
  const saved=await call('scene.export',{includeData:true});await call('scene.new');check('New scene stops and hides preview',!(await inspect()).render.visible&&!(await inspect()).render.running);
  await call('scene.open',{name:'camera-view.hash',base64:saved.base64});await call('scene.select',{ids:[camera.hash]});await clickView('Native View after HASH reopen');
  const frame=await call('diagnostics.frame',{frames:5});check('Native CPU/GPU frames stay bounded',frame.timestampQueries&&frame.frames.every(f=>f.cpuMs<50&&f.gpuMs<100),frame);
  return {pass:true,checks,timings,observations,frame};
 }catch(error){observations.push({failure:await inspect().catch(()=>null)});return {pass:false,checks,timings,observations,error:error.stack};}
 finally{await call('render.stop').catch(()=>{});}
}

export async function cameraRealtimeChecks(page){
 const checks=[],observations=[],timings=[],call=(name,args={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[name,args]);
 const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});assert.ok(pass,name+': '+JSON.stringify(detail));};
 const state=()=>page.evaluate(()=>{const c=nodes.find(n=>n.type==='render'&&n.enabled),s=frameEngine.renderState();return {camera:c&&{hash:c.nativeHash,enabled:c.enabled,params:c.params},render:s,button:document.querySelector('#frameRenderToggle')?.outerHTML,actualVisible:!!document.querySelector('#frame-render-canvas')?.getClientRects().length,active:activeView,main:mainActiveView,single};});
 try{
  await call('scene.new');const mesh=await call('mesh.create',{vertices:[-60,-60,0,60,-60,0,0,60,0,0,0,60],indices:[0,2,1,0,1,3,0,3,2,1,2,3]});const m=await call('material.create',{params:{h:0,s:0,l:100,emm:100}});await call('material.assign',{id:mesh.hash,material:m.uid});await call('view.set',{index:0,single:true,focus:mesh.hash});await page.locator('#tabAttributes').click();
  await page.locator('#btnRender').click();await page.waitForFunction(()=>frameEngine.renderState().running||frameEngine.renderState().phase==='error',{},{timeout:20000});observations.push({label:'Native toolbar Camera, before first image',state:await state()});
  const defaults=(await state()).camera.params;check('Native toolbar Camera retains realtime on, default studio and 128 samples',defaults.realtime==='on'&&defaults.environment==='default'&&defaults.samples===128,defaults);
  const started=performance.now();await page.locator('#frameRenderToggle').click();observations.push({label:'First View click while automatic preparation is running',state:await state()});
  await page.waitForTimeout(250);observations.push({label:'250ms after first View click',state:await state()});
  const stopped=await state();check('First View promotes automatic preparation instead of leaving no image',stopped.render.running&&stopped.render.manual||stopped.render.hasImage&&stopped.render.visible,stopped);
  await page.waitForFunction(()=>{const s=frameEngine.renderState();return s.phase==='complete'&&s.hasImage&&s.visible||s.phase==='error';},{},{timeout:25000});const ms=performance.now()-started;timings.push({name:'First View completes standard realtime Camera',ms,budgetMs:25000});check('First View completed-operation latency',ms<25000,{ms,budgetMs:25000});
  observations.push({label:'Completed standard camera',state:await state()});let s=await state();check('Standard realtime camera produces a complete visible shared-device image',s.render.phase==='complete'&&!s.render.running&&s.render.hasImage&&s.render.visible&&s.actualVisible&&s.render.sharedDevice&&!s.render.errors?.length,s);
  const pixels=await call('render.pixels',{points:[[.5,.5],[.03,.03]],linear:true});check('Standard realtime View resolves full-sample emitter and positive neutral studio background',standardCameraFilmValid(pixels,defaults.samples),pixels);
  await page.locator('#frameRenderToggle').click();check('View stops completed realtime camera',!(await state()).render.visible);
  for(const index of [2,0]){await call('view.set',{index,single:true});await page.locator('#frameRenderToggle').click();await page.waitForFunction(()=>{const s=frameEngine.renderState();return s.phase==='complete'&&s.hasImage&&s.visible||s.phase==='error';},{},{timeout:25000});s=await state();observations.push({label:'View with realtime on from '+index,state:s});check('Realtime View from '+index+' completes',s.render.phase==='complete'&&s.render.visible,s);await page.locator('#frameRenderToggle').click();}
  return {pass:true,checks,observations,timings};
 }catch(error){observations.push({failure:await state().catch(()=>null)});return {pass:false,checks,observations,timings,error:error.stack};}
 finally{await call('render.stop').catch(()=>{});}
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const realtime=process.argv.includes('--realtime'),suffix=realtime?'-realtime':'',report={pass:false,errors:[],consoleErrors:[],sources:{}},server=await serve();let browser,page;
 try{
  for(const p of ['index.html','tests/camera-view.mjs'])report.sources[p]=createHash('sha256').update(await readFile(new URL('../'+p,import.meta.url))).digest('hex');
  browser=await chromium.launch({headless:true,channel:'chromium',executablePath:process.env.FRAME_BROWSER,ignoreDefaultArgs:['--enable-unsafe-swiftshader'],args:['--enable-unsafe-webgpu','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  const context=await browser.newContext({viewport:{width:1000,height:760},serviceWorkers:'block',deviceScaleFactor:Number(process.env.FRAME_DPR||1)});
  context.on('page',p=>{p.on('pageerror',e=>report.errors.push(e.stack));p.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});});page=await context.newPage();await page.goto(server.url+'/index.html');await ready(page);
  report.adapter=await page.evaluate(()=>{const a=frameEngine.renderer.device.adapterInfo;return {vendor:a.vendor,architecture:a.architecture,description:a.description,isFallbackAdapter:a.isFallbackAdapter};});assert.equal(report.adapter.isFallbackAdapter,false);assert.ok(!/swiftshader|llvmpipe|software/i.test(JSON.stringify(report.adapter)));
  await page.evaluate(()=>{window.__cameraViewDevice=frameEngine.renderer.device;window.__cameraViewErrors=[];window.__cameraViewLost=null;__cameraViewDevice.lost.then(i=>__cameraViewLost={reason:i.reason,message:i.message});__cameraViewDevice.addEventListener('uncapturederror',e=>__cameraViewErrors.push(e.error.message));__cameraViewDevice.pushErrorScope('validation');});
  Object.assign(report,await (realtime?cameraRealtimeChecks:cameraViewChecks)(page));report.gpu=await page.evaluate(async()=>({validation:(await __cameraViewDevice.popErrorScope())?.message||null,uncaptured:__cameraViewErrors,lost:__cameraViewLost,replaced:__cameraViewDevice!==frameEngine.renderer.device}));
  report.pass&&=!report.errors.length&&!report.consoleErrors.length&&!report.gpu.validation&&!report.gpu.uncaptured.length&&!report.gpu.lost&&!report.gpu.replaced;
 }catch(error){report.error=error.stack;}
 finally{await mkdir(new URL('./results/',import.meta.url),{recursive:true});if(!report.pass)await page?.screenshot({path:fileURLToPath(new URL('./results/camera-view'+suffix+'-failure.png',import.meta.url))}).catch(()=>{});await browser?.close();await server.close();await writeFile(new URL('./results/camera-view'+suffix+'.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,adapter:report.adapter,checks:report.checks?.length,failed:report.checks?.filter(c=>!c.pass),timings:report.timings,error:report.error,gpu:report.gpu,errors:report.errors,consoleErrors:report.consoleErrors},null,2));process.exitCode=report.pass?0:1;}
}
