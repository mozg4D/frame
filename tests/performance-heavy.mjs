import {ensureHeavyScene} from './scenes/generate-heavy.mjs';
import {launch,ready} from '../tools/browser.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export async function heavyPerformanceChecks(page,state){
 const call=(n,a={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[n,a]),checks=[],modes={};
 const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});if(!pass)throw Error(name+': '+JSON.stringify(detail));};
 const stats=values=>{const v=values.toSorted((a,b)=>a-b);return {median:v[v.length>>1],p95:v[Math.floor(v.length*.95)],max:v.at(-1)};};
 try{
  check('Heavy fixture contains exactly 100548288 triangles',state.stats.triangles===100548288,state.stats.triangles);
  const roots=state.objects.filter(n=>!n.parent).map(n=>n.hash);await call('view.set',{index:0,single:true,mode:'object'});await call('scene.select',{ids:roots});await page.evaluate(()=>frameEngine.focusSelection());await call('scene.select',{ids:[]});const camera=(await call('scene.inspect')).view.camera,rect=await page.locator('#frame-engine-canvas').boundingBox(),centers=await page.evaluate(async points=>{const out=[];for(const point of points)out.push((await frameAI.call('view.project',{point})).screen);return out;},state.objects.filter(n=>n.mesh&&n.bounds).map(n=>n.bounds.center));check('100M benchmark frames the centers of every independent mesh',centers.length===64&&centers.every(p=>p[0]>=rect.x&&p[0]<=rect.x+rect.width&&p[1]>=rect.y&&p[1]<=rect.y+rect.height),{objects:centers.length,rect});
  for(const shading of ['solid','solid-wire','isoparms','solid-isoparms']){
   await call('view.set',{camera,index:0,single:true,mode:'object',shading});await call('diagnostics.frame',{frames:6});const frames=await call('diagnostics.frame',{frames:32}),gpu=stats(frames.frames.map(f=>f.gpuMs)),cpu=stats(frames.frames.map(f=>f.cpuMs));modes[shading]={...frames,gpu,cpu,camera:(await call('scene.inspect')).view.camera};
   check(shading+' 100M steady frame p95 avoids sporadic stalls',gpu.p95<gpu.median*1.6+5&&cpu.p95<50,{gpu,cpu});
   const original=(await call('scene.inspect')).view.camera,changed=[...original];changed[0]+=.27;changed[1]-=.12;await call('view.set',{camera:changed});const navigation=await call('diagnostics.frame',{frames:8});modes[shading].navigation=navigation;const navigationGPU=stats(navigation.frames.map(f=>f.gpuMs));check(shading+' remains stable after camera rotation',navigationGPU.p95<navigationGPU.median*1.6+5,navigationGPU);
   const rect=await page.locator('#frame-engine-canvas').boundingBox();await page.mouse.move(rect.x+rect.width*.7,rect.y+rect.height*.3);await page.waitForTimeout(100);const before=await page.locator('#frame-engine-canvas').getAttribute('data-hover');await page.mouse.move(rect.x+rect.width*.7+15,rect.y+rect.height*.3+10);await page.waitForTimeout(50);const after=JSON.parse(await page.locator('#frame-engine-canvas').getAttribute('data-hover'));check(shading+' idle hover reuses geometry cache',after.geometryFrames===JSON.parse(before).geometryFrames,{before:JSON.parse(before),after});
   const started=performance.now();await call('view.set',{mode:'vertex'});const elapsedMs=performance.now()-started,components=await call('diagnostics.frame',{frames:8}),componentGPU=stats(components.frames.map(f=>f.gpuMs));modes[shading].components={...components,elapsedMs,gpu:componentGPU};check(shading+' 100M component maps settle within 1 s and stay stable',elapsedMs<1000&&componentGPU.p95<componentGPU.median*1.6+5,{elapsedMs,gpu:componentGPU});
  }
  check('Polygon Solid Isoparms costs the same as Solid Wire without an extra edge pass',modes['solid-isoparms'].gpu.median<modes['solid-wire'].gpu.median*1.12+1,{solidWire:modes['solid-wire'].gpu,solidIsoparms:modes['solid-isoparms'].gpu});
  // Exercise the new marker pass on every logical vertex in the real 100M scene.
  for(const shading of ['solid-isoparms','isoparms']){
   await call('view.set',{camera,index:0,single:true,mode:'object',shading});await call('scene.select',{ids:roots});const started=performance.now();await call('view.set',{mode:'vertex'});const elapsedMs=performance.now()-started;await call('diagnostics.frame',{frames:4});const frames=await call('diagnostics.frame',{frames:12}),gpu=stats(frames.frames.map(f=>f.gpuMs)),cpu=stats(frames.frames.map(f=>f.cpuMs));modes['vertices-'+shading]={...frames,gpu,cpu,elapsedMs};
   check(shading+' all selected polygon vertices have bounded completed/frame latency',elapsedMs<2500&&gpu.p95<500&&cpu.p95<50,{elapsedMs,gpu,cpu,vertices:state.stats.vertices});
  }
  await call('view.set',{mode:'object'});await call('scene.select',{ids:[]});
  return {pass:true,checks,modes};
 }catch(e){return {pass:false,checks,modes,error:e.stack};}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 await ensureHeavyScene();const session=await launch({headless:false}),errors=[];try{const {page}=session;await ready(page);page.on('pageerror',e=>errors.push(e.stack));await page.evaluate(()=>{window.__performanceGPU=[];frameEngine.renderer.device.addEventListener('uncapturederror',e=>__performanceGPU.push(e.error.message));frameEngine.renderer.device.pushErrorScope('validation');});await page.evaluate(()=>frameAI.call('scene.open',{url:'tests/scenes/stress-mesh-100m.hash'}));const state=await page.evaluate(()=>frameAI.call('scene.inspect')),report=await heavyPerformanceChecks(page,state);report.gpu=await page.evaluate(async()=>({validation:(await frameEngine.renderer.device.popErrorScope())?.message||null,uncaptured:__performanceGPU}));report.errors=errors;report.pass&&=!errors.length&&!report.gpu.validation&&!report.gpu.uncaptured.length;report.indexSHA256=createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex');await writeFile(new URL('./results/performance-100m.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,checks:report.checks,error:report.error,gpu:report.gpu,modes:Object.fromEntries(Object.entries(report.modes).map(([k,v])=>[k,{gpu:v.gpu,cpu:v.cpu}]))}));process.exitCode=report.pass?0:1;}finally{await session.close();}
}
