import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../tools/browser.mjs';
import {polygonLineMask} from './polygon-line-mask.mjs';
import {readDiagnosticPixels} from './diagnostic-pixels.mjs';

export async function plainPolygonLinesBrowserChecks(page){
 const checks=[],call=(n,a={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[n,a]);
 const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});assert.ok(pass,name+': '+JSON.stringify(detail));};
 const warm=async()=>{await page.waitForFunction(()=>frameEngine.renderer.plainWireSurfaces?.get((!!frameEngine.pluginView().index)+':false')?.pipeline);await call('diagnostics.frame',{frames:2});};
 const hits=async(mask,points)=>{const screens=await page.evaluate(points=>points.map(p=>frameEngine.pluginProject(p)),points),set=new Set(mask.pixels);return screens.map(([x,y])=>[-1,0,1].some(dx=>[-1,0,1].some(dy=>set.has((Math.floor(y)+dy)*mask.width+Math.floor(x)+dx))));};
 try{
  for(const storage of ['auto','texture'])for(const index of [0,2]){
   const label=storage+' view '+index,rearZ=index===0?2:-2;
   await call('scene.new');const triangle=await call('mesh.create',{storage,vertices:[-70,7,rearZ,70,7,rearZ,0,67,rearZ],indices:[0,2,1]});await call('scene.select',{ids:[]});
   await call('view.set',{index,single:true,shading:'solid-wire',focus:triangle.hash});if(index===0)await call('view.set',{camera:[0,0,1,0,0,0,0,0,0,0,-400,400]});await warm();
   const probes=[[-10,7,rearZ],[10,7,rearZ]],visible=await polygonLineMask(page);check(label+' visible polygon edge is drawn',(await hits(visible,probes)).every(Boolean),{pixels:visible.pixels.length});
   await call('view.set',{shading:'solid-isoparms'});await warm();const isoparms=await polygonLineMask(page);check(label+' both Solid line modes retain identical polygon pixels',JSON.stringify(visible.pixels)===JSON.stringify(isoparms.pixels),{wire:visible.pixels.length,isoparms:isoparms.pixels.length});
   await call('mesh.create',{storage,vertices:[-80,-20,0,80,-20,0,80,20,0,-80,20,0],indices:[0,2,1,0,3,2]});await call('scene.select',{ids:[]});await warm();const hidden=await polygonLineMask(page);check(label+' foreground geometry hides rear edges',(await hits(hidden,probes)).every(v=>!v),{hits:await hits(hidden,probes)});
   const routing=await page.evaluate(()=>({lines:JSON.parse(document.querySelector('#frame-engine-canvas').dataset.surfaceLines),derived:frameEngine.scene.meshes.flatMap(m=>(m.parts||[m]).filter(p=>p.nativeSurfaceLines)),masks:frameEngine.scene.meshes.some(m=>(m.parts||[m]).some(p=>p.splineWireEdges))}));check(label+' plain polygons avoid cage classification and edge passes',routing.lines.draws===0&&!routing.derived.length&&!routing.masks,routing);
   // The occluder and rear edge must also agree when they share one owner.
   await call('scene.new');await call('mesh.create',{storage,vertices:[-70,7,rearZ,70,7,rearZ,0,67,rearZ,-80,-20,0,80,-20,0,80,20,0,-80,20,0],indices:[0,2,1,3,5,4,3,6,5]});await call('scene.select',{ids:[]});await call('view.set',{index,single:true,shading:'solid-wire'});if(index===0)await call('view.set',{camera:[0,0,1,0,0,0,0,0,0,0,-40,40]});await warm();const self=await polygonLineMask(page);check(label+' close surface hides its own rear edges',(await hits(self,probes)).every(v=>!v),{hits:await hits(self,probes)});
  }
  // Measure real pixel contrast across a shared edge, away from the grid and
  // other diagonals. A wide black/antialias skirt fails even when edge hits pass.
  for(const storage of ['auto','texture'])for(const index of [0,2]){
   await call('scene.new');const z=-17.11,x=5.37,panel=await call('mesh.create',{storage,vertices:[-81.13,7.12,z,x,7.12,z,80.83,7.12,z,-81.13,107.12,z,x,107.12,z,80.83,107.12,z],indices:[0,4,1,0,3,4,1,5,2,1,4,5]});await call('scene.select',{ids:[]});await call('view.set',{index,single:true,shading:'solid-wire',focus:panel.hash});if(index===0)await call('view.set',{camera:[0,0,1,0,0,0,0,0,0,0,-400,400],index,shading:'solid-wire'});
   const original=(await call('scene.inspect')).view.camera;
   for(const phase of [0,.25,.5,.75]){
    const camera=original.slice();if(index===0){camera[8]+=phase;camera[5]+=phase;}else camera[15]+=phase*camera[17]*2/(await page.locator('#frame-engine-canvas').boundingBox()).height;
    await call('view.set',{camera,index,single:true,shading:'solid-wire'});await warm();
    const points=await page.evaluate(({x,z})=>{const r=frameEngine.renderer,rect=document.querySelector('#frame-engine-canvas').getBoundingClientRect();return [32,57,82].flatMap(y=>{const p=frameEngine.pluginProject([x,y,z]),px=Math.floor((p[0]-rect.left)*r.width/rect.width),py=Math.floor((p[1]-rect.top)*r.height/rect.height);return [-3,-2,-1,0,1,2,3].map(dx=>[rect.left+(px+dx+.5)*rect.width/r.width,rect.top+(py+.5)*rect.height/r.height]);});},{x,z});
    const lines=(await readDiagnosticPixels(call,points)).colors;await call('view.set',{shading:'solid'});const solid=(await readDiagnosticPixels(call,points)).colors;await call('view.set',{shading:'solid-wire'});
    const profiles=[0,1,2].map(row=>{const coverage=lines.slice(row*7,row*7+7).map((c,j)=>{const base=solid[row*7+j].slice(0,3).reduce((a,b)=>a+b,0),value=c.slice(0,3).reduce((a,b)=>a+b,0);return Math.max(0,(base-value)/Math.max(1,base));});return {width:coverage.reduce((a,b)=>a+b,0),peak:Math.max(...coverage)};});
    check(storage+' view '+index+' thin contrasting polygon stroke at phase '+phase,profiles.every(p=>p.width>=1&&p.width<=1.75&&p.peak>=.5),profiles);
    const mask=await polygonLineMask(page);check(storage+' view '+index+' thin silhouette stays visible at phase '+phase,(await hits(mask,[[-81.13,47,z],[80.83,47,z],[-20,7.12,z],[-20,107.12,z]])).every(Boolean),{phase});
   }
  }
  await call('scene.new');const source=await call('mesh.create',{vertices:[-40,7,0,40,7,0,0,60,0],indices:[0,2,1]}),copies=await call('scene.create',{type:'cloner',inputs:[source.hash],params:{'count x':3,'count y':1,'count z':1,'spacing x':120}});await call('scene.select',{ids:[]});await call('view.set',{index:0,single:true,shading:'solid-wire',focus:copies.hash});
  await page.waitForFunction(()=>!!frameEngine.renderer.replicaPerspectiveWirePlain?.pipeline);await call('diagnostics.frame',{frames:2});const instances=await polygonLineMask(page),batch=await page.evaluate(()=>frameEngine.renderer.replicaDraws.get(0));check('Plain affine instances shade their edges without cage overlays',instances.pixels.length>100&&instances.draws.draws===0&&batch.instances===3&&batch.calls===1,{pixels:instances.pixels.length,lines:instances.draws,batch});
  await call('scene.new');return {pass:true,checks};
 }catch(error){await mkdir(new URL('results/',import.meta.url),{recursive:true});await page.screenshot({path:fileURLToPath(new URL('results/plain-polygon-lines-failure.png',import.meta.url))});return {pass:false,checks,error:error.stack,state:await call('view.set'),pipelines:await page.evaluate(()=>[...frameEngine.renderer.plainWireSurfaces||[]].map(([k,v])=>[k,!!v.pipeline]))};}
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const session=await launch({headless:true}),report={pass:false,errors:[]};
 try{const context=await session.browser.newContext({viewport:{width:1000,height:760},deviceScaleFactor:1,serviceWorkers:'block'}),page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.stack));await page.goto(session.url+'/index.html');await ready(page);report.adapter=await page.evaluate(()=>{const d=frameEngine.renderer.device;window.__plainErrors=[];d.addEventListener('uncapturederror',e=>__plainErrors.push(e.error.message));d.pushErrorScope('validation');return {vendor:d.adapterInfo.vendor,isFallbackAdapter:d.adapterInfo.isFallbackAdapter};});assert.equal(report.adapter.isFallbackAdapter,false);Object.assign(report,await plainPolygonLinesBrowserChecks(page));report.gpu=await page.evaluate(async()=>({scope:(await frameEngine.renderer.device.popErrorScope())?.message||null,uncaptured:__plainErrors}));report.pass&&=!report.errors.length&&!report.gpu.scope&&!report.gpu.uncaptured.length;
 }catch(error){report.error=error.stack;}
 finally{await session.close();report.indexSHA256=createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex');await mkdir(new URL('results/',import.meta.url),{recursive:true});await writeFile(new URL('results/plain-polygon-lines-browser.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,checks:report.checks?.length,error:report.error,state:report.state,pipelines:report.pipelines,gpu:report.gpu},null,2));process.exitCode=report.pass?0:1;}
}
