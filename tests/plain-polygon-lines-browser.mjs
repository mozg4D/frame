import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../tools/browser.mjs';
import {polygonLineMask,projectMaskPoints} from './polygon-line-mask.mjs';
import {readDiagnosticPixels} from './diagnostic-pixels.mjs';

function lightness(rgb){
 const linear=rgb.slice(0,3).map(byte=>{const c=byte/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;});
 const y=.2126*linear[0]+.7152*linear[1]+.0722*linear[2];
 return y<=216/24389?(24389/27)*y:116*Math.cbrt(y)-16;
}

async function probePixels(page,world){
 return page.evaluate(world=>{
  const r=frameEngine.renderer,rect=frameEngine.pluginView().rect,sx=rect.width/r.width,sy=rect.height/r.height;
  return world.flatMap(p=>{
   const [x,y]=frameEngine.pluginProject(p),px=Math.floor((x-rect.left)/sx),py=Math.floor((y-rect.top)/sy);
   return [-1,0,1].flatMap(dy=>[-1,0,1].map(dx=>[rect.left+(px+dx+.5)*sx,rect.top+(py+dy+.5)*sy]));
  });
 },world);
}

async function adaptiveMaterialChecks(page,call,check){
 const z=-17.11,centers=[[-52,53,z],[52,53,z]];
 const vertices=[-92,13,z,-12,13,z,-12,93,z,-92,93,z,12,13,z,92,13,z,92,93,z,12,93,z];
 const settle=async shading=>{
  await call('view.set',{shading});await call('diagnostics.frame',{frames:2});
  await page.waitForFunction(()=>!frameEngine.renderer.materialState?.pending.size);await call('diagnostics.frame',{frames:1});
 };
 const compare=async(world,mode='solid-wire')=>{
  const points=await probePixels(page,world);await settle('solid');const solid=(await readDiagnosticPixels(call,points)).colors;
  await settle(mode);const wire=(await readDiagnosticPixels(call,points)).colors;
  return world.map((_,i)=>{
   const colors=wire.slice(i*9,i*9+9),delta=colors.map((c,j)=>lightness(c)-lightness(solid[i*9+j]));
   return {min:Math.min(...delta),max:Math.max(...delta),ink:colors[delta.indexOf(delta.reduce((a,b)=>Math.abs(a)>Math.abs(b)?a:b))]};
  });
 };
 await call('scene.new');const mesh=await call('mesh.create',{vertices,indices:[0,2,1,0,3,2,4,6,5,4,7,6]});
 const blue=await call('material.create',{params:{h:222,s:66,l:12,rough:12,metal:45}});
 const sand=await call('material.create',{params:{h:38,s:70,l:74}});
 await call('material.assign',{id:mesh.hash,material:blue.uid});await call('material.assign',{id:mesh.hash,material:sand.uid,faces:[2,3]});
 await call('scene.select',{ids:[]});await page.mouse.move(5,5);
 for(const classified of [false,true]){
  if(classified)await page.evaluate(hash=>{
   const K=FrameSpline.K(),d=K.createSplineData(),seq=K.addSplineSequence(d,true);
   const ids=[[-92,13],[-12,13],[-12,93],[-92,93]].map(([x,y])=>K.addSplineVertex(d,[x,y,-17.11]));
   ids.forEach((a,i)=>K.addSplineSegment(d,seq,a,ids[(i+1)%ids.length]));return frameEngine.setSplineDisplay(hash,d,true);
  },mesh.hash);
  for(const yaw of [0,.26]){
   const pitch=.12,d=400,eye=[-Math.cos(pitch)*Math.sin(yaw)*d,Math.sin(pitch)*d,-Math.cos(pitch)*Math.cos(yaw)*d];
   await call('view.set',{index:0,single:true,camera:[yaw,pitch,1,0,0,0,0,0,...eye,d]});
   const [dark,light]=await compare(centers),label=(classified?'Classified':'Plain')+' per-face materials at yaw '+yaw;
   check(label+' lighten dark blue and darken sand within bounded lightness',dark.max>=5&&dark.max<=13&&dark.min>=-.8&&light.min<=-5&&light.min>=-13&&light.max<=.8,{dark,light});
   check(label+' keep the material hues',dark.ink[2]>dark.ink[0]&&light.ink[0]>light.ink[2],{blue:dark.ink,sand:light.ink});
  }
  const iso=await compare(centers,'solid-isoparms');
  check((classified?'Classified':'Plain')+' triangle diagonals follow Isoparms visibility',classified?
   iso.every(p=>Math.abs(p.min)<1&&Math.abs(p.max)<1):iso[0].max>5&&iso[1].min< -5,iso);
 }
 const graphite=await call('material.create',{params:{h:0,s:0,l:0}});
 await call('material.assign',{id:mesh.hash,material:graphite.uid});await call('scene.select',{ids:[]});
 await settle('wireframe');await page.waitForFunction(()=>!!frameEngine.renderer.wireRaster?.pixels);
 const points=await probePixels(page,[centers[1]]),readWire=async()=> (await readDiagnosticPixels(call,points)).colors;
 const native=await readWire();
 try{
  await page.evaluate(()=>{const r=frameEngine.renderer;window.__savedWireRaster=r.wireRaster;r.wireRaster=null;});
  await call('diagnostics.frame',{frames:2});const fallback=await readWire();
  const expectedLuma=await page.evaluate(()=>255*(frameOrthoMajorGrid+.09));
  const isTint=c=>{const [r,g,b]=c,span=Math.max(r,g,b)-Math.min(r,g,b);return span>=32&&span<=40&&Math.abs(.2126*r+.7152*g+.0722*b-expectedLuma)<=3;};
  const sameTint=native.some(a=>isTint(a)&&fallback.some(b=>isTint(b)&&a.slice(0,3).every((v,k)=>Math.abs(v-b[k])<=1)));
  check('Black material retains the same muted visible wire tint in both raster paths',sameTint,{native,fallback,expectedLuma});
 }finally{await page.evaluate(()=>{frameEngine.renderer.wireRaster=window.__savedWireRaster;delete window.__savedWireRaster;});}

 await call('scene.new');
 // Identical flat material and lighting, with a coarse diagonal on the left and
 // subpixel strips on the right. Measure actual spacing in this viewport.
 const dense=vertices.slice(0,12),indices=[0,2,1,0,3,2],strips=700,step=80/strips;
 for(let i=0;i<=strips;i++){
  const x=12+i*step;dense.push(x,13,z,x,93,z);
  if(i){const a=4+(i-1)*2;indices.push(a,a+3,a+2,a,a+1,a+3);}
 }
 const fine=await call('mesh.create',{vertices:dense,indices});
 await call('scene.select',{ids:[]});await call('view.set',{index:2,single:true,focus:fine.hash});
 const [p,q]=await Promise.all([52,52+step].map(x=>call('view.project',{point:[x,53,z]})));
 const spacing=Math.hypot(p.screen[0]-q.screen[0],p.screen[1]-q.screen[1])*await page.evaluate(()=>frameEngine.renderer.width/frameEngine.pluginView().rect.width);
 const [coarse,subpixel]=await compare(centers);
 check('Subpixel mesh retains a softer visible stroke at the same view scale',spacing<1&&coarse.min< -5&&subpixel.min< -1&&Math.abs(subpixel.min/coarse.min)<.72,{spacing,coarse,subpixel});
}

export async function plainPolygonLinesBrowserChecks(page){
 const checks=[],call=(n,a={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[n,a]);
 const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});assert.ok(pass,name+': '+JSON.stringify(detail));};
 const warm=async()=>{await page.waitForFunction(()=>frameEngine.renderer.plainWireSurfaces?.get((!!frameEngine.pluginView().index)+':false')?.pipeline);await call('diagnostics.frame',{frames:2});};
 const hits=async(mask,points)=>{const screens=await projectMaskPoints(page,mask,points),set=new Set(mask.pixels);return screens.map(([x,y])=>[-1,0,1].some(dx=>[-1,0,1].some(dy=>set.has((Math.floor(y)+dy)*mask.width+Math.floor(x)+dx))));};
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
    const profiles=[0,1,2].map(row=>{
     const contrast=lines.slice(row*7,row*7+7).map((c,j)=>lightness(solid[row*7+j])-lightness(c));
     const peak=Math.max(...contrast);return {width:contrast.reduce((a,b)=>a+b,0)/peak,peak};
    });
    check(storage+' view '+index+' thin moderate-contrast polygon stroke at phase '+phase,profiles.every(p=>p.width>=1.4&&p.width<=2.3&&p.peak>=6&&p.peak<=12),profiles);
    const mask=await polygonLineMask(page);check(storage+' view '+index+' thin silhouette stays visible at phase '+phase,(await hits(mask,[[-81.13,47,z],[80.83,47,z],[-20,7.12,z],[-20,107.12,z]])).every(Boolean),{phase});
   }
  }
  await call('scene.new');const source=await call('mesh.create',{vertices:[-40,7,0,40,7,0,0,60,0],indices:[0,2,1]}),copies=await call('scene.create',{type:'cloner',inputs:[source.hash],params:{'count x':3,'count y':1,'count z':1,'spacing x':120}});await call('scene.select',{ids:[]});await call('view.set',{index:0,single:true,shading:'solid-wire',focus:copies.hash});
  await page.waitForFunction(()=>!!frameEngine.renderer.replicaPerspectiveWirePlain?.pipeline);await call('diagnostics.frame',{frames:2});const instances=await polygonLineMask(page),batch=await page.evaluate(()=>frameEngine.renderer.replicaDraws.get(0));check('Plain affine instances shade their edges without cage overlays',instances.pixels.length>100&&instances.draws.draws===0&&batch.instances===3&&batch.calls===1,{pixels:instances.pixels.length,lines:instances.draws,batch});
  await adaptiveMaterialChecks(page,call,check);
  await call('scene.new');return {pass:true,checks};
 }catch(error){await mkdir(new URL('results/',import.meta.url),{recursive:true});await page.screenshot({path:fileURLToPath(new URL('results/plain-polygon-lines-failure.png',import.meta.url))});return {pass:false,checks,error:error.stack,state:await call('view.set'),pipelines:await page.evaluate(()=>[...frameEngine.renderer.plainWireSurfaces||[]].map(([k,v])=>[k,!!v.pipeline]))};}
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const session=await launch({headless:true}),report={pass:false,errors:[]};
 try{const context=await session.browser.newContext({viewport:{width:1000,height:760},deviceScaleFactor:Number(process.env.FRAME_DPR||1),serviceWorkers:'block'}),page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.stack));await page.goto(session.url+'/index.html');await ready(page);report.adapter=await page.evaluate(()=>{const d=frameEngine.renderer.device;window.__plainErrors=[];d.addEventListener('uncapturederror',e=>__plainErrors.push(e.error.message));d.pushErrorScope('validation');return {vendor:d.adapterInfo.vendor,isFallbackAdapter:d.adapterInfo.isFallbackAdapter};});assert.equal(report.adapter.isFallbackAdapter,false);Object.assign(report,await plainPolygonLinesBrowserChecks(page));report.gpu=await page.evaluate(async()=>({scope:(await frameEngine.renderer.device.popErrorScope())?.message||null,uncaptured:__plainErrors}));report.pass&&=!report.errors.length&&!report.gpu.scope&&!report.gpu.uncaptured.length;
 }catch(error){report.error=error.stack;}
 finally{await session.close();report.indexSHA256=createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex');await mkdir(new URL('results/',import.meta.url),{recursive:true});await writeFile(new URL('results/plain-polygon-lines-browser.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,checks:report.checks?.length,error:report.error,state:report.state,pipelines:report.pipelines,gpu:report.gpu},null,2));process.exitCode=report.pass?0:1;}
}
