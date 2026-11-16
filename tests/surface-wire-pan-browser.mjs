// Camera pan is split between view translation and viewport offset. With a fixed
// physical eye, changing that split must never expose a covered surface edge.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../tools/browser.mjs';

export async function surfaceWirePanBrowserChecks(page){
 const checks=[],frames=[],call=(n,a={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[n,a]);
 const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});assert.ok(pass,name+': '+JSON.stringify(detail));console.log('PASS '+name);};
 const samples=async()=>{
  const points=await page.evaluate(()=>[-45,-15,0,15,45].flatMap(y=>{const [x,z]=frameEngine.pluginProject([0,y,0]);return [-1,0,1].flatMap(dy=>[-1,0,1].map(dx=>[x+dx,z+dy]));}));
  const {colors}=await call('diagnostics.pixels',{points});
  return Array.from({length:5},(_,i)=>colors.slice(i*9,i*9+9).some(c=>[46,90,106].every((v,k)=>Math.abs(c[k]-v)<=2)));
 };
 try{
  for(const storage of ['auto','texture']){
   await call('scene.new');
   const mesh=await call('mesh.create',{storage,vertices:[-80,-60,0,0,-60,0,80,-60,0,80,60,0,0,60,0,-80,60,0],indices:[0,1,4,0,4,5,1,2,3,1,3,4]});
   await page.evaluate(async hash=>{
    const K=FrameSpline.K(),data=K.createSplineData(),seq=K.addSplineSequence(data,true),v=[[-80,-60,0],[0,-60,0],[80,-60,0],[80,60,0],[0,60,0],[-80,60,0]].map(p=>K.addSplineVertex(data,p));
    v.forEach((a,i)=>K.addSplineSegment(data,seq,a,v[(i+1)%v.length]));K.addSplineSegment(data,K.addSplineSequence(data,false),v[1],v[4]);await frameEngine.setSplineDisplay(hash,data,true);
   },mesh.hash);
   // A tilted foreground plane makes the omitted eye XY term change sign.
   const cover=await call('mesh.create',{storage,vertices:[-30,-25,-140,30,-25,100,30,25,100,-30,25,-140],indices:[0,2,1,0,3,2]});
   await call('scene.select',{ids:[]});await page.mouse.move(5,5);
   for(const shading of ['solid-isoparms','solid-wire'])for(const distance of [400,600,400])for(const pan of [0,200,-200,0]){
    await call('view.set',{index:0,single:true,shading,camera:[0,0,1,pan,pan*.25,0,0,0,0,0,-distance,distance]});
    await page.waitForFunction(()=>!!frameEngine.renderer.nativeSurfaceLines&&!!frameEngine.renderer.plainWireSurfaces?.get('false:false')?.pipeline);
    await call('diagnostics.frame',{frames:2});const visible=await samples(),label=storage+' '+shading+' distance '+distance+' pan '+pan;
    check(label+' hides covered edge and retains exposed stroke',visible[0]&&visible[4]&&visible.slice(1,4).every(v=>!v),visible);
   }
   await call('scene.update',{id:cover.hash,visible:false});await call('diagnostics.frame',{frames:2});check(storage+' removing cover exposes the rear edge',(await samples()).every(Boolean));
   const timing=await call('diagnostics.frame',{frames:6});frames.push({storage,...timing});check(storage+' native frame timing',timing.timestampQueries&&timing.frames.every(f=>f.cpuMs<50&&f.gpuMs<50),timing.frames);
  }
  return {pass:true,checks,frames};
 }catch(error){return {pass:false,checks,frames,error:error.stack};}
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const app=await launch({headless:true}),report={pass:false,errors:[]};
 try{
  app.page.on('pageerror',e=>report.errors.push(e.stack));await ready(app.page);
  report.adapter=await app.page.evaluate(()=>{const a=frameEngine.renderer.device.adapterInfo;window.panGPUError=[];frameEngine.renderer.device.addEventListener('uncapturederror',e=>panGPUError.push(e.error.message));return {vendor:a.vendor,architecture:a.architecture,isFallbackAdapter:a.isFallbackAdapter};});
  assert.equal(report.adapter.isFallbackAdapter,false);assert.ok(!/swiftshader|software|llvmpipe/i.test(JSON.stringify(report.adapter)));
  Object.assign(report,await surfaceWirePanBrowserChecks(app.page));report.gpuErrors=await app.page.evaluate(()=>panGPUError);report.pass&&=!report.errors.length&&!report.gpuErrors.length;
 }catch(error){report.error=error.stack;}finally{
  await app.close();report.indexSHA256=createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex');await mkdir(new URL('results/',import.meta.url),{recursive:true});await writeFile(new URL('results/surface-wire-pan-browser.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,checks:report.checks?.length,error:report.error,gpuErrors:report.gpuErrors}));process.exitCode=report.pass?0:1;
 }
}
