// Real native GPU pixels in an isolated browser/context. Never use a user tab.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {serve,ready} from '../tools/browser.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export async function splinePaletteBrowserChecks(page){
 const checks=[],timings=[],frames=[],call=(n,a={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[n,a]);
 const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});assert.ok(pass,name+': '+JSON.stringify(detail));};
 const measure=async(name,fn)=>{const start=performance.now(),out=await fn(),ms=performance.now()-start;timings.push({name,ms});check(name+' settles within 2500 ms',ms<2500,{ms});return out;};
 const pixelCheck=async(name,point,rgb)=>{const p=(await call('view.project',{id:windowId,point})).screen,step=await page.evaluate(()=>{const r=document.querySelector('#frame-engine-canvas').getBoundingClientRect();return [r.width/frameEngine.renderer.width,r.height/frameEngine.renderer.height];}),points=[];for(let y=-3;y<=3;y++)for(let x=-3;x<=3;x++)points.push([p[0]+x*step[0],p[1]+y*step[1]]);const r=await call('diagnostics.pixels',{points,presentation:true});check(name,r.colors.some(c=>rgb.every((v,k)=>Math.abs(c[k]-v)<=2)),{expected:rgb,colors:[...new Map(r.colors.map(c=>[c.join(),c])).values()]});return p;};
 let windowId;
 try{
  await call('scene.new');
  const data=await page.evaluate(()=>{const K=FrameSpline.K(),d=K.createSplineData(),q=K.addSplineSequence(d,true),vs=[[-100,-80,0],[100,-80,0],[100,80,0],[-100,80,0]].map(p=>K.addSplineVertex(d,p));vs.forEach((v,i)=>K.addSplineSegment(d,q,v,vs[(i+1)%4]));return d;});
  const spline=await call('scene.create',{type:'spline'});windowId=spline.hash;await call('spline.replace',{id:spline.hash,data});const edge=Object.keys(data.segments)[0],point=[0,-80,0],initial=JSON.stringify((await call('spline.inspect',{id:spline.hash})).data);
  for(const patch of [false,true]){
   let owner=spline;if(patch)owner=await measure('Create native patch',()=>call('scene.create',{type:'spline_patch',inputs:[spline.hash]}));
   for(const index of [2,0]){
    const label=(patch?'Patch':'Curve')+' view '+index;
    await measure(label+' focus',()=>call('view.set',{index,single:true,mode:'edge',shading:patch?'solid-isoparms':'isoparms',focus:owner.hash}));
    await call('scene.select',{ids:[spline.hash],mode:'edge',components:[]});await page.mouse.move(5,5);await call('diagnostics.frame',{frames:2});
    const p=await pixelCheck(label+' unselected cage uses dim cyan',point,[60,117,138]);
    await measure(label+' edge selection',()=>call('scene.select',{ids:[spline.hash],mode:'edge',components:[edge]}));await page.mouse.move(5,5);await call('diagnostics.frame',{frames:2});await pixelCheck(label+' selected edge stays green',point,[101,237,134]);
    await call('scene.select',{ids:[spline.hash],mode:'edge',components:[]});await page.mouse.move(...p);await call('diagnostics.frame',{frames:2});await pixelCheck(label+' hovered edge stays bright green',point,[138,255,171]);
    await page.mouse.move(5,5);await call('diagnostics.frame',{frames:2});await pixelCheck(label+' repeated deselection restores dim cyan',point,[60,117,138]);
    const r=await call('diagnostics.frame',{frames:5});frames.push({name:label,...r});check(label+' native CPU/GPU frame budgets',r.timestampQueries&&r.frames.every(f=>f.cpuMs<50&&f.gpuMs<100),r);
   }
  }
  check('Display and selection preserve authored spline geometry',JSON.stringify((await call('spline.inspect',{id:spline.hash})).data)===initial);
  return {pass:true,checks,timings,frames};
 }catch(error){return {pass:false,checks,timings,frames,error:error.stack};}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const report={pass:false,errors:[],consoleErrors:[]},server=await serve();let browser,page;
 try{
  report.indexSHA256=createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex');
  browser=await chromium.launch({headless:true,channel:'chromium',executablePath:process.env.FRAME_BROWSER,ignoreDefaultArgs:['--enable-unsafe-swiftshader'],args:['--enable-unsafe-webgpu','--disable-background-timer-throttling','--disable-renderer-backgrounding']});const context=await browser.newContext({viewport:{width:1000,height:760},deviceScaleFactor:Number(process.env.FRAME_DPR||1),serviceWorkers:'block'});context.on('page',p=>{p.on('pageerror',e=>report.errors.push(e.stack));p.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});});page=await context.newPage();await page.goto(server.url+'/index.html');await ready(page);
  report.adapter=await page.evaluate(()=>{const a=frameEngine.renderer.device.adapterInfo;return {vendor:a.vendor,architecture:a.architecture,description:a.description,isFallbackAdapter:a.isFallbackAdapter};});assert.equal(report.adapter.isFallbackAdapter,false);assert.ok(!/swiftshader|llvmpipe|software/i.test(JSON.stringify(report.adapter)));
  await page.evaluate(()=>{window.__paletteGPU=[];window.__paletteLost=null;const d=frameEngine.renderer.device;d.lost.then(i=>__paletteLost={reason:i.reason,message:i.message});d.addEventListener('uncapturederror',e=>__paletteGPU.push(e.error.message));d.pushErrorScope('validation');});Object.assign(report,await splinePaletteBrowserChecks(page));report.gpu=await page.evaluate(async()=>({validation:(await frameEngine.renderer.device.popErrorScope())?.message||null,uncaptured:__paletteGPU,lost:__paletteLost}));report.pass&&=!report.errors.length&&!report.consoleErrors.length&&!report.gpu.validation&&!report.gpu.uncaptured.length&&!report.gpu.lost;
 }catch(error){report.error=error.stack;report.pass=false;}
 finally{await mkdir(new URL('./results/',import.meta.url),{recursive:true});await page?.screenshot({path:fileURLToPath(new URL('./results/spline-palette'+(report.pass?'':'-failure')+'.png',import.meta.url))}).catch(()=>{});await browser?.close();await server.close();await writeFile(new URL('./results/spline-palette-browser.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));process.exitCode=report.pass?0:1;}
}