import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {serve,ready,root} from '../tools/browser.mjs';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export async function panelLayoutBrowserChecks(page,{setZoom}={}){
 const checks=[],timings=[],call=(name,args={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[name,args]);
 const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});assert.ok(pass,name+': '+JSON.stringify(detail));};
 const settle=()=>page.evaluate(()=>new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok))));
 const state=()=>page.evaluate(()=>{const rect=id=>document.getElementById(id).getBoundingClientRect(),tree=rect('obWrap'),strip=rect('tabstrip');return {top:strip.top,height:tree.height,width:rect('panel').width,saved:localStorage.getItem('frame-ui.obwrap.h'),innerHeight,innerWidth,dpr:devicePixelRatio};});
 const drag=async(delta)=>{const r=await page.locator('#tabstrip').boundingBox();await page.mouse.move(r.x+r.width-8,r.y+1);await page.mouse.down();await page.mouse.move(r.x+r.width-8,r.y+1+delta,{steps:4});await page.mouse.up();await settle();};
 const roundTrip=async(name,change,restore,base)=>{const at=performance.now();await change();await settle();const constrained=await state();check(name+' preserves the requested height and fixed panel width',constrained.saved===base.saved&&Math.abs(constrained.width-base.width)<.1,constrained);await restore();await settle();const after=await state(),ms=performance.now()-at;check(name+' returns to the exact divider position',Math.abs(after.top-base.top)<.1&&after.saved===base.saved,{base,constrained,after});timings.push({name,ms,budget:2500});check(name+' completes within 2500 ms',ms<2500,{ms});};
 try{
  await call('render.stop');await call('scene.new');await page.setViewportSize({width:1280,height:900});await settle();
  await drag(470-(await state()).height);let base=await state();check('Dragging stores the chosen tree height',Math.abs(base.height-470)<.1&&Math.abs(Number(base.saved)-470)<.1,base);
  for(let i=0;i<3;i++)await roundTrip('Window shrink/expand '+i,()=>page.setViewportSize({width:900,height:480}),()=>page.setViewportSize({width:1280,height:900}),base);
  await roundTrip('Window expansion/restoration',()=>page.setViewportSize({width:1400,height:1200}),()=>page.setViewportSize({width:1280,height:900}),base);
  await page.setViewportSize({width:900,height:480});await settle();const constrained=await state();check('Small window temporarily clamps the visible height',constrained.height<base.height&&constrained.saved===base.saved,constrained);
  await drag(0);check('A divider click while constrained preserves the preference',(await state()).saved===base.saved);
  await page.reload();await ready(page);await settle();check('Reload while constrained preserves the saved preference',(await state()).saved===base.saved);await page.setViewportSize({width:1280,height:900});await settle();check('Expanding after constrained reload restores the original height',Math.abs((await state()).top-base.top)<.1,await state());
  if(setZoom)for(const zoom of [1.5,.8,1.25,.67,1.5]){
   await roundTrip('Browser page zoom '+zoom,async()=>{await setZoom(zoom);await page.waitForFunction(expected=>Math.abs(devicePixelRatio-expected)<.02,base.dpr*zoom);},async()=>{await setZoom(1);await page.waitForFunction(expected=>Math.abs(devicePixelRatio-expected)<.02,base.dpr);},base);
  }
  await page.locator('#treeResize').press('ArrowDown');await settle();let keyed=await state();check('Keyboard adjustment is saved',Math.abs(keyed.height-base.height-8)<.1&&Math.abs(Number(keyed.saved)-keyed.height)<.1,keyed);await page.reload();await ready(page);await settle();check('Keyboard adjustment survives reload',Math.abs((await state()).top-keyed.top)<.1,await state());base=await state();
  const back=await page.locator('#tabstrip').boundingBox();await page.mouse.move(back.x+back.width-8,back.y+1);await page.mouse.down();await page.mouse.move(back.x+back.width-8,back.y-39);await page.mouse.move(back.x+back.width-8,back.y+1);await page.mouse.up();await settle();check('Dragging away and back restores the gesture start',Math.abs((await state()).top-base.top)<.1,await state());
  const before=await state();await page.evaluate(async()=>{for(let i=0;i<45;i++)await frameAI.call('scene.create',{type:'group',name:'Browser row '+i});});await settle();const full=await state();check('Object Browser content does not move the divider',Math.abs(full.top-before.top)<.1&&full.saved===before.saved,{before,full});
  await call('scene.new');await settle();check('Clearing the Object Browser does not move the divider',Math.abs((await state()).top-before.top)<.1,await state());
  const r=await page.locator('#tabstrip').boundingBox();await page.mouse.move(r.x+r.width-8,r.y+1);await page.mouse.down();await page.mouse.move(r.x+r.width-8,r.y-49);await page.locator('#tabstrip').dispatchEvent('pointercancel',{pointerId:1});await page.mouse.up();await settle();const cancelled=await state();check('Cancelled divider drag restores the preference and visible position',Math.abs(cancelled.top-before.top)<.1&&cancelled.saved===before.saved,cancelled);
  return {pass:true,checks,timings,pageZoomTested:!!setZoom};
 }catch(error){return {pass:false,checks,timings,error:error.stack};}
 finally{if(setZoom)await setZoom(1);}
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const report={pass:false,errors:[]},server=await serve(),work=resolve(root,'work');await mkdir(work,{recursive:true});const temporary=await mkdtemp(resolve(work,'panel-layout-')),extension=resolve(temporary,'extension');let context,page;
 try{
  await mkdir(extension);await writeFile(resolve(extension,'manifest.json'),JSON.stringify({manifest_version:3,name:'Frame isolated page zoom test',version:'1.0',permissions:['tabs'],host_permissions:['http://127.0.0.1/*'],background:{service_worker:'worker.js'}}));await writeFile(resolve(extension,'worker.js'),'chrome.runtime.onInstalled.addListener(()=>{});');
  context=await chromium.launchPersistentContext(resolve(temporary,'profile'),{headless:true,channel:'chromium',executablePath:process.env.FRAME_BROWSER,viewport:{width:1280,height:900},deviceScaleFactor:1,serviceWorkers:'allow',ignoreDefaultArgs:['--enable-unsafe-swiftshader'],args:['--enable-unsafe-webgpu','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-extensions-except='+extension,'--load-extension='+extension]});
  context.on('page',p=>{p.on('pageerror',e=>report.errors.push(e.message));p.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});});page=await context.newPage();await page.goto(server.url+'/index.html');await ready(page);
  const worker=context.serviceWorkers().find(w=>w.url().startsWith('chrome-extension://'))||await context.waitForEvent('serviceworker',{predicate:w=>w.url().startsWith('chrome-extension://')});
  const setZoom=zoom=>worker.evaluate(async({url,zoom})=>{const tab=(await chrome.tabs.query({})).find(t=>t.url?.startsWith(url));if(!tab)throw Error('Isolated test tab missing');await chrome.tabs.setZoom(tab.id,zoom);if(Math.abs(await chrome.tabs.getZoom(tab.id)-zoom)>.001)throw Error('Browser zoom was not applied');},{url:server.url,zoom});
  report.adapter=await page.evaluate(()=>{const a=frameEngine.renderer.device.adapterInfo;return {vendor:a.vendor,description:a.description,isFallbackAdapter:a.isFallbackAdapter};});assert.equal(report.adapter.isFallbackAdapter,false);
  Object.assign(report,await panelLayoutBrowserChecks(page,{setZoom}));report.pass&&=!report.errors.length;report.indexSHA256=createHash('sha256').update(await readFile(resolve(root,'index.html'))).digest('hex');
 }catch(error){report.error=error.stack;report.pass=false;}
 finally{await mkdir(resolve(root,'tests/results'),{recursive:true});await page?.screenshot({path:resolve(root,'tests/results/panel-layout'+(report.pass?'':'-failure')+'.png')}).catch(()=>{});await context?.close();await server.close();if(temporary.startsWith(work+sep))await rm(temporary,{recursive:true,force:true});await writeFile(resolve(root,'tests/results/panel-layout-browser.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));process.exitCode=report.pass?0:1;}
}
