import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {serve,ready} from '../../../tools/browser.mjs';

export async function lineOcclusionChecks(page,{capture=null}={}){
 const checks=[],cases=[],timings=[],call=(n,a={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[n,a]);
 const check=(name,pass,detail)=>{checks.push({name:'Atomic lines: '+name,pass:!!pass,detail});assert.ok(pass,name+': '+JSON.stringify(detail));};
 const colors=async point=>{const p=(await call('view.project',{point})).screen,points=[];for(let y=-3;y<=3;y++)for(let x=-3;x<=3;x++)points.push([p[0]+x,p[1]+y]);const r=await call('diagnostics.pixels',{points});return {point,screen:p,cyan:r.colors.filter(c=>[60,117,138].every((v,k)=>Math.abs(c[k]-v)<=2)).length,colors:[...new Map(r.colors.map(c=>[c.join(),c])).values()]};};
 const observe=async index=>({front:await colors(index===0?[0,.1,-2]:[0,-.1,2]),rear:await colors(index===0?[0,-.1,2]:[0,.1,-2])});
 const start=performance.now();
 try{
  await call('scene.new');await call('view.set',{index:2,single:true,mode:'object',shading:'solid-isoparms'});
  const atom=await call('plugins.create',{plugin:'atomic'});
  await call('plugins.command',{id:atom.hash,operation:'create-atoms',args:{atoms:[{species:6,position:[0,0,0]}]}});
  const spline=await call('scene.create',{type:'spline'}),data=await page.evaluate(()=>{const K=FrameSpline.K(),d=K.createSplineData();for(const [y,z]of [[.1,-2],[-.1,2]]){const q=K.addSplineSequence(d,false),a=K.addSplineVertex(d,[-1.2,y,z]),b=K.addSplineVertex(d,[1.2,y,z]);K.addSplineSegment(d,q,a,b);}return d;});
  await call('spline.replace',{id:spline.hash,data});await call('scene.select',{ids:[]});await page.mouse.move(5,5);
  for(const index of [0,2])for(const shading of ['solid-isoparms','solid-wire','solid']){
   const label=(index===0?'Perspective':'Right')+' '+shading;
   await call('view.set',{index,single:true,mode:'object',shading,focus:atom.hash});
   if(index===0)await call('view.set',{camera:[0,0,1,0,0,0,0,0,0,0,-8,8]});
   await call('diagnostics.frame',{frames:2});const row={label,withAtom:await observe(index)};cases.push(row);
   if(capture&&shading==='solid-isoparms')await capture(index===0?'perspective':'right');
   await call('scene.update',{id:atom.hash,visible:false});row.withoutAtom=await observe(index);
   check(label+' both probes are visible without atom',row.withoutAtom.front.cyan>0&&row.withoutAtom.rear.cyan>0,row.withoutAtom);
   await call('scene.update',{id:spline.hash,visible:false});row.empty=await observe(index);
   await call('scene.update',{id:atom.hash,visible:true});row.atomOnly=await observe(index);
   check(label+' atom covers both probe locations', ['front','rear'].every(k=>row.atomOnly[k].cyan===0&&row.atomOnly[k].colors.every(c=>!row.empty[k].colors.some(b=>c.join()===b.join()))),row.atomOnly);
   await call('scene.update',{id:spline.hash,visible:true});row.repeat=await observe(index);
   check(label+' front line stays visible',row.withAtom.front.cyan>0&&row.repeat.front.cyan>0,{first:row.withAtom.front,repeat:row.repeat.front});
   check(label+' rear line stays hidden',row.withAtom.rear.cyan===0&&row.repeat.rear.cyan===0,{first:row.withAtom.rear,repeat:row.repeat.rear});
  }
  const frames=await call('diagnostics.frame',{frames:5});check('CPU/GPU frame budgets',frames.timestampQueries&&frames.frames.every(f=>f.cpuMs<50&&f.gpuMs<100),frames);
  const ms=performance.now()-start;timings.push({name:'Atomic six line-occlusion cases',ms,limit:20000});check('completed fixture latency',ms<20000,{ms});
  await call('scene.new');return {pass:true,checks,cases,timings};
 }catch(error){return {pass:false,checks,cases,timings,error:error.stack};}
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const paths=['index.html','frame-sw.js','plugins/atomic/plugin.js','plugins/atomic/tests/line-occlusion.mjs'],hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,createHash('sha256').update(await readFile(new URL('../../../'+p,import.meta.url))).digest('hex')])));
 const report={pass:false,sourcesBefore:await hashes(),errors:[]},server=await serve();let browser,page;
 try{
  browser=await chromium.launch({headless:true,channel:'chromium',executablePath:process.env.FRAME_BROWSER||undefined,ignoreDefaultArgs:['--enable-unsafe-swiftshader'],args:['--enable-unsafe-webgpu','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  const context=await browser.newContext({viewport:{width:1100,height:800},deviceScaleFactor:1,serviceWorkers:'block'});page=await context.newPage();page.setDefaultTimeout(20000);
  page.on('pageerror',e=>report.errors.push(e.stack));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});await page.goto(server.url+'/index.html');await ready(page);
  report.adapter=await page.evaluate(()=>{const a=frameEngine.renderer.device.adapterInfo;return {vendor:a.vendor,architecture:a.architecture,isFallbackAdapter:a.isFallbackAdapter};});assert.equal(report.adapter.isFallbackAdapter,false);assert.ok(!/swiftshader|llvmpipe|software/i.test(JSON.stringify(report.adapter)));
  await page.evaluate(()=>{window.__atomicLineGPU=[];window.__atomicLineLost=null;const d=frameEngine.renderer.device;d.addEventListener('uncapturederror',e=>__atomicLineGPU.push(e.error.message));d.lost.then(i=>__atomicLineLost={reason:i.reason,message:i.message});d.pushErrorScope('validation');});
  await mkdir(new URL('../../../tests/results/',import.meta.url),{recursive:true});
  Object.assign(report,await lineOcclusionChecks(page,{capture:name=>page.locator('#frame-engine-canvas').screenshot({path:fileURLToPath(new URL('../../../tests/results/atomic-lines-'+name+'.png',import.meta.url))})}));
  report.gpu=await page.evaluate(async()=>({validation:(await frameEngine.renderer.device.popErrorScope())?.message||null,uncaptured:__atomicLineGPU,lost:__atomicLineLost}));report.pass&&=!report.errors.length&&!report.gpu.validation&&!report.gpu.uncaptured.length&&!report.gpu.lost;
 }catch(error){report.error=error.stack;report.pass=false;}
 finally{await browser?.close();await server.close();report.sourcesAfter=await hashes();report.pass&&=JSON.stringify(report.sourcesBefore)===JSON.stringify(report.sourcesAfter);await mkdir(new URL('../../../tests/results/',import.meta.url),{recursive:true});await writeFile(new URL('../../../tests/results/atomic-line-occlusion.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,cases:report.cases?.length,checks:report.checks?.length,timings:report.timings,failed:report.checks?.filter(c=>!c.pass),error:report.error,gpu:report.gpu,errors:report.errors},null,2));process.exitCode=report.pass?0:1;}
}
