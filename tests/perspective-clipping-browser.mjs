// Native GPU regression. Owns an isolated browser/context; never touches a user tab.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {serve,ready} from '../tools/browser.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export async function perspectiveClippingBrowserChecks(page){
 const checks=[],timings=[],frames=[],call=(n,a={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[n,a]);
 const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});assert.ok(pass,name+': '+JSON.stringify(detail));};
 const measure=async(name,fn,budgetMs=2500)=>{const t=performance.now(),r=await fn(),ms=performance.now()-t;timings.push({name,ms,budgetMs});check(name+' latency',ms<budgetMs,{ms,budgetMs});return r;};
 const observed=()=>page.evaluate(()=>{const c=FrameViewWindows.find('frame-engine-canvas'),s=frameEngine.scene;return {clip:JSON.parse(c.dataset.clip),camera:JSON.parse(c.dataset.camera),min:s.boundsMin,max:s.boundsMax,scale:s.scale,center:s.center};});
 // Independent double-precision camera-depth oracle for the authored mesh bbox.
 const bboxCheck=async name=>{const s=await observed(),{yaw:a,pitch:b,offset}=s.camera;let front=0,back=.001;for(let mask=0;mask<8;mask++){const p=s.min.map((v,i)=>(((mask>>i)&1?s.max[i]:v)-s.center[i])*s.scale);p[2]*=-1;const z=-Math.cos(b)*Math.sin(a)*p[0]+Math.sin(b)*p[1]+Math.cos(b)*Math.cos(a)*p[2],depth=3.2-z-offset[2];front=Math.min(front,depth);back=Math.max(back,depth);}const expected=back+Math.max(.0001,(back-front)*.01);check(name+' far follows scene bbox',Math.abs(s.clip[1]-expected)<1e-10*Math.max(1,expected),{...s,expected});check(name+' exact perspective ratio',s.clip[0]===s.clip[1]/10000,s.clip);return s;};
 const frameCheck=async name=>{const r=await call('diagnostics.frame',{frames:5});frames.push({name,...r});check(name+' CPU/GPU frame budgets',r.timestampQueries&&r.frames.every(f=>f.cpuMs<50&&f.gpuMs<100),r);};
 try{
  await call('scene.new');await call('view.set',{index:0,single:true});let s=await observed();check('Empty scene has finite ordered positive clipping planes',s.clip.every(Number.isFinite)&&s.clip[0]>0&&s.clip[1]>s.clip[0]&&s.clip[0]===s.clip[1]/10000,s);
  const mesh=await measure('Create 0.02 mm detail',()=>call('mesh.create',{vertices:[-.01,-.01,0,.01,-.01,0,0,.01,0],indices:[0,2,1]}));const mat=await call('material.create',{params:{h:0,s:100,l:50,emm:100}});await call('material.assign',{id:mesh.hash,material:mat.uid});
  await call('view.set',{index:0,single:true,mode:'object',shading:'solid',camera:[0,0,1,0,0,0,0,0,0,0,-.05,.05]});await call('scene.select',{ids:[]});await bboxCheck('Close-up mesh');
  const point=(await call('view.project',{point:[0,0,0]})).screen;await page.mouse.move(5,5);
  for(const shading of ['solid','solid-wire','solid-isoparms']){await call('view.set',{shading});const pixels=await call('diagnostics.pixels',{points:[point]});check('Close detail survives near clipping in '+shading,pixels.colors[0][0]>80&&pixels.colors[0][0]>pixels.colors[0][1]*2,pixels);}
  await measure('Native close-up wheel navigation',async()=>{await page.mouse.move(...point);await page.mouse.wheel(0,-100);await call('scene.inspect');});await bboxCheck('After native zoom');await frameCheck('Close-up mesh');
  await call('scene.select',{ids:[mesh.hash]});await measure('Native numeric depth edit',()=>call('transform.set',{channel:'position',axis:2,value:.025}));await bboxCheck('After depth edit');await call('edit.history',{action:'undo'});await bboxCheck('After depth Undo');
  await call('view.set',{index:0,single:true,camera:[0,0,1,0,0,0,0,0,0,0,-.05,.05]});const saved=await call('scene.export',{includeData:true});await measure('HASH reopen with bbox clipping',()=>call('scene.open',{name:'perspective-clipping.hash',base64:saved.base64}),10000);await bboxCheck('After HASH reopen');
  const opened=await call('view.window',{action:'open',index:0});await call('view.set',{index:opened.opened,single:true});await bboxCheck('Additional Perspective');await call('view.window',{action:'close',index:opened.opened});await call('view.set',{index:0,single:true});
  const camera=await call('scene.create',{type:'render',params:{realtime:'off',samples:1,environment:'off'}});await call('scene.select',{ids:[camera.hash]});await page.locator('#tabAttributes').click();await measure('Native Camera View at close distance',async()=>{await page.locator('#frameRenderToggle').click();await page.waitForFunction(()=>['complete','error'].includes(frameEngine.renderState().phase),{},{timeout:20000});},20000);const state=await call('render.inspect');check('Path tracer remains complete on the shared GPU',state.phase==='complete'&&state.hasImage&&state.sharedDevice,state);const film=await call('render.pixels',{points:[[.5,.5]],linear:true});check('Path tracer still sees close emissive geometry',film.colors[0][0]>.8&&film.colors[0].every(Number.isFinite),film);await call('render.stop');await bboxCheck('Enabled Camera viewport');
  await call('scene.new');const spline=await call('scene.create',{type:'square'});await call('view.set',{index:0,single:true,focus:spline.hash,shading:'isoparms'});s=await observed();check('Pure spline scene retains finite exact-ratio clipping',s.clip.every(Number.isFinite)&&s.clip[0]>0&&s.clip[0]===s.clip[1]/10000,s);await frameCheck('Pure spline');
  await call('scene.new');await call('view.set',{index:0,single:true});s=await observed();check('New after geometry and Camera resets to valid empty clipping',s.clip.every(Number.isFinite)&&s.clip[0]>0&&s.clip[0]===s.clip[1]/10000,s);
  return {pass:true,checks,timings,frames};
 }catch(error){return {pass:false,checks,timings,frames,error:error.stack};}
 finally{await call('render.stop').catch(()=>{});}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const report={pass:false,errors:[],consoleErrors:[]},server=await serve();let browser,page;
 try{
  report.indexSHA256=createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex');
  browser=await chromium.launch({headless:true,channel:'chromium',executablePath:process.env.FRAME_BROWSER,ignoreDefaultArgs:['--enable-unsafe-swiftshader'],args:['--enable-unsafe-webgpu','--disable-background-timer-throttling','--disable-renderer-backgrounding']});const context=await browser.newContext({viewport:{width:1000,height:760},deviceScaleFactor:Number(process.env.FRAME_DPR||1),serviceWorkers:'block'});context.on('page',p=>{p.on('pageerror',e=>report.errors.push(e.stack));p.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});});page=await context.newPage();await page.goto(server.url+'/index.html');await ready(page);
  report.adapter=await page.evaluate(()=>{const a=frameEngine.renderer.device.adapterInfo;return {vendor:a.vendor,architecture:a.architecture,description:a.description,isFallbackAdapter:a.isFallbackAdapter};});assert.equal(report.adapter.isFallbackAdapter,false);assert.ok(!/swiftshader|llvmpipe|software/i.test(JSON.stringify(report.adapter)));
  await page.evaluate(()=>{window.__clipGPU=[];window.__clipLost=null;const d=frameEngine.renderer.device;d.lost.then(i=>__clipLost={reason:i.reason,message:i.message});d.addEventListener('uncapturederror',e=>__clipGPU.push(e.error.message));d.pushErrorScope('validation');});Object.assign(report,await perspectiveClippingBrowserChecks(page));report.gpu=await page.evaluate(async()=>({validation:(await frameEngine.renderer.device.popErrorScope())?.message||null,uncaptured:__clipGPU,lost:__clipLost}));report.pass&&=!report.errors.length&&!report.consoleErrors.length&&!report.gpu.validation&&!report.gpu.uncaptured.length&&!report.gpu.lost;
 }catch(error){report.error=error.stack;report.pass=false;}
 finally{await mkdir(new URL('./results/',import.meta.url),{recursive:true});if(!report.pass)await page?.screenshot({path:fileURLToPath(new URL('./results/perspective-clipping-failure.png',import.meta.url))}).catch(()=>{});await browser?.close();await server.close();await writeFile(new URL('./results/perspective-clipping-browser.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));process.exitCode=report.pass?0:1;}
}
