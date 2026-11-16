// Compare actual native pixels, including silhouettes, occlusion and shared instances.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {serve,ready} from '../tools/browser.mjs';
import {polygonLineMask,projectMaskPoints} from './polygon-line-mask.mjs';
export async function surfaceWireStabilityBrowserChecks(page){
 const checks=[],raster=[],frames=[],call=(n,a={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[n,a]);
 const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});assert.ok(pass,name+': '+JSON.stringify(detail));};
 const warm=async()=>{await call('diagnostics.frame',{frames:3});await page.waitForFunction(()=>!frameEngine.renderer.materialState?.pending.size&&frameEngine.scene.meshes.filter(m=>!(m.parts||[m]).some(p=>p.splineWireEdges)).every(m=>frameEngine.renderer.plainWireSurfaces?.get((!!frameEngine.pluginView().index)+':'+!!m.posed)?.pipeline),{},{timeout:10000});await call('diagnostics.frame',{frames:2});};
 const capture=async(color=[46,90,106])=>color.every(v=>v===0)?polygonLineMask(page):page.evaluate(async color=>{
  await frameEngine.draw(true);const r=frameEngine.renderer,d=r.device,width=r.width,height=r.height,stride=Math.ceil(width*4/256)*256,read=d.createBuffer({size:stride*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  try{const e=d.createCommandEncoder();e.copyTextureToBuffer({texture:r.cachedColor},{buffer:read,bytesPerRow:stride},[width,height]);d.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);const bytes=new Uint8Array(read.getMappedRange()),bgra=r.format.startsWith('bgra'),pixels=[];for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*stride+x*4;if(Math.abs(bytes[i+(bgra?2:0)]-color[0])<=2&&Math.abs(bytes[i+1]-color[1])<=2&&Math.abs(bytes[i+(bgra?0:2)]-color[2])<=2)pixels.push(y*width+x);}read.unmap();return {width,height,pixels,draws:JSON.parse(document.querySelector('#frame-engine-canvas').dataset.surfaceLines||'null')};}finally{read.destroy();}
 },color);
 const difference=(a,b)=>{const aa=new Set(a.pixels),bb=new Set(b.pixels);return [...a.pixels.filter(p=>!bb.has(p)),...b.pixels.filter(p=>!aa.has(p))];};
 // Source and canonical frames can choose adjacent pixels at diamond ties; long gaps and thinning still fail.
 const sameStroke=(a,b)=>{const near=(p,set,w)=>{const x=p%w,y=Math.floor(p/w);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(set.has((y+dy)*w+x+dx))return true;return false;},aa=new Set(a.pixels),bb=new Set(b.pixels);return a.pixels.length>=b.pixels.length*.99&&a.pixels.length<=b.pixels.length*1.01&&a.pixels.every(p=>near(p,bb,b.width))&&b.pixels.every(p=>near(p,aa,a.width));};
 const hits=async(mask,points)=>{const screens=await projectMaskPoints(page,mask,points),set=new Set(mask.pixels);return screens.map(([x,y])=>{x=Math.floor(x);y=Math.floor(y);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(set.has((y+dy)*mask.width+x+dx))return true;return false;});};
 const camera=[0,0,1,0,0,0,0,0,0,0,-400,400];
 try{
  await call('scene.new');await call('view.set',{index:2,single:true,mode:'object',shading:'isoparms'});
  const data=await page.evaluate(()=>{const K=FrameSpline.K(),d=K.createSplineData(),q=K.addSplineSequence(d,true),v=[[-80,-60,0],[80,-60,0],[80,60,0],[-80,60,0]].map(p=>K.addSplineVertex(d,p));v.forEach((id,i)=>K.addSplineSegment(d,q,id,v[(i+1)%4]));return d;});
  const source=await call('scene.create',{type:'spline'});await call('spline.replace',{id:source.hash,data});const panel=await call('scene.create',{type:'spline_patch',inputs:[source.hash]});await call('scene.select',{ids:[]});await page.mouse.move(5,5);const initial=JSON.stringify((await call('spline.inspect',{id:panel.hash})).data);
  for(const phase of [0,.25,.5]){
   const yaw=.22,pitch=.16,distance=400,eye=[-Math.cos(pitch)*Math.sin(yaw)*distance+phase,Math.sin(pitch)*distance,-Math.cos(pitch)*Math.cos(yaw)*distance];await call('view.set',{index:0,single:true,shading:'solid-isoparms',camera:[yaw,pitch,1,0,0,0,0,0,...eye,distance]});await warm();const solid=await capture();await call('view.set',{shading:'isoparms'});await warm();const wire=await capture(),diff=difference(solid,wire),detail={phase,solid:solid.pixels.length,wire:wire.pixels.length,different:diff.length,samples:diff.slice(0,8)};raster.push(detail);check('Solid preserves the native one-pixel cage raster at phase '+phase,wire.pixels.length>500&&sameStroke(solid,wire),detail);
  }
  const material=await call('material.create',{params:{h:35,s:40,l:50}});await call('material.assign',{id:panel.hash,material:material.uid});
  for(const index of [0,2]){await call('view.set',{index,single:true,shading:'solid-isoparms',focus:panel.hash});await warm();const solid=await capture();await call('view.set',{shading:'isoparms'});await warm();const wire=await capture(),diff=difference(solid,wire);check('Material view '+index+' retains the native cage',solid.pixels.length>300&&sameStroke(solid,wire),{solid:solid.pixels.length,wire:wire.pixels.length,different:diff.length,draws:solid.draws});}
  await call('view.set',{index:0,single:true,shading:'solid-isoparms',camera});await warm();const exposed=await capture(),cover=await call('mesh.create',{vertices:[-90,-25,-2,-70,-25,-2,-70,25,-2,-90,25,-2],indices:[0,2,1,0,3,2]});await call('scene.select',{ids:[]});await warm();const covered=await capture(),hidden=await hits(covered,[[-80,-15,0],[-80,0,0],[-80,15,0]]),visible=await hits(covered,[[-80,-45,0],[-80,45,0]]);check('Independent opaque cover hides rear cyan',hidden.every(v=>!v),hidden);check('Uncovered cyan remains visible',visible.every(Boolean),visible);
  await call('scene.update',{id:cover.hash,visible:false});await warm();const restored=await capture();check('Removing cover restores exact raster',difference(exposed,restored).length===0,{different:difference(exposed,restored).length});check('Rendering preserves authored spline data',JSON.stringify((await call('spline.inspect',{id:panel.hash})).data)===initial);
  // Closed-solid negative control: rear edges are well inside the projected front face.
  await call('scene.new');await call('view.set',{index:2,single:true});const cube=await call('scene.create',{type:'cube'});await call('scene.select',{ids:[cube.hash]});for(const [axis,value]of [-50,-50,0].entries())await call('transform.set',{channel:'position',axis,value,coordinates:'world'});await call('scene.select',{ids:[]});await call('view.set',{index:0,single:true,shading:'solid-isoparms',camera});await warm();const solidCube=await capture(),back=[];for(const t of [-30,-10,10,30])back.push([-50,t,100],[50,t,100],[t,-50,100],[t,50,100]);const hiddenBack=await hits(solidCube,back);check('A solid hides its own rear edges',hiddenBack.every(v=>!v),hiddenBack);await call('view.set',{shading:'isoparms'});await warm();const wireCube=await capture(),shownBack=await hits(wireCube,back);check('Wire-only negative control exposes rear edges',shownBack.filter(Boolean).length>=14,shownBack);
  for(const storage of ['auto','texture']){await call('scene.new');await call('mesh.create',{storage,vertices:[-80,-60,0,80,-60,0,80,60,0,-80,60,0],indices:[0,2,1,0,3,2]});await call('scene.select',{ids:[]});await call('view.set',{index:0,single:true,shading:'solid-wire',camera});await warm();const solid=await capture([0,0,0]);await call('view.set',{shading:'wireframe'});await warm();const wire=await capture([128,128,128]),diff=difference(solid,wire);check(storage+' analytic surface shader retains all polygon edges',solid.pixels.length>500&&(await hits(solid,[[-80,15,0],[80,15,0],[20,-60,0],[20,60,0],[20,15,0]])).every(Boolean),{solid:solid.pixels.length,wire:wire.pixels.length,different:diff.length});}
  // Two independent touching panels share a supporting plane. Alternating native
  // depth winners must not cut the seam, including a long edge partially in the eye.
  for(const storage of ['generated','auto','texture']){
   await call('scene.new');await call('view.set',{index:2,single:true});
   const box=async(min,size)=>{
    if(storage==='generated'){
     const n=await call('scene.create',{type:'cube',params:Object.fromEntries(['size x','size y','size z'].map((k,i)=>[k,size[i]]))});await call('scene.select',{ids:[n.hash]});for(let axis=0;axis<3;axis++)await call('transform.set',{channel:'position',axis,value:min[axis],coordinates:'world'});return n;
    }
    const vertices=[0,0,0,1,0,0,1,1,0,0,1,0,0,0,1,1,0,1,1,1,1,0,1,1].map((v,i)=>min[i%3]+v*size[i%3]);
    return call('mesh.create',{storage,vertices,indices:[0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,3,7,6,3,6,2,0,4,7,0,7,3,1,2,6,1,6,5]});
   };
   await box([1679,212,0],[21,1230,70]);await box([1700,315,33],[21,1024,606]);await call('scene.select',{ids:[]});
   const original=[5.57460183660255,.15559877559829843,58.80904697185207,290.7148767844235,1178.8838821661027,1701.8684935608999,1232.0110831198144,33.0000010726283,1779.1305318693046,1249.8008891464247,-46.010674731029,111.69526338473868];
   for(const phase of [0,.25,.5]){
    const moved=original.slice();moved[3]+=phase;await call('view.set',{index:0,single:true,shading:storage==='generated'?'solid-isoparms':'solid-wire',camera:moved});await warm();
    const mask=await capture(storage==='generated'?[46,90,106]:[0,0,0]),ends=await projectMaskPoints(page,mask,[[1700,315,33],[1700,1339,33]]),set=new Set(mask.pixels),missing=[];let rows=0;
    for(let y=20;y<mask.height-20;y++){
     const [a,b]=ends;if(y<Math.min(a[1],b[1])+2||y>Math.max(a[1],b[1])-2)continue;const x=Math.floor(a[0]+(b[0]-a[0])*(y+.5-a[1])/(b[1]-a[1]));if(x<2||x>=mask.width-2)continue;
     rows++;if(![-1,0,1].some(dx=>set.has(y*mask.width+x+dx)))missing.push(y);
    }
    check(storage+' touching seam stays continuous at phase '+phase,rows>500&&missing.length===0,{rows,missing:missing.slice(0,30)});
   }
   // A separate front plane must still hide the same seam.
   await call('mesh.create',{vertices:[1700.5,500,-100,1700.5,1400,-100,1700.5,1400,100,1700.5,500,100],indices:[0,2,1,0,3,2]});await call('scene.select',{ids:[]});await warm();
   const hidden=await hits(await capture(storage==='generated'?[46,90,106]:[0,0,0]),[1220,1230,1240].map(y=>[1700,y,33]));check(storage+' independent cover hides the contact seam',hidden.every(v=>!v),hidden);
  }
  // A long cylinder leaves both triangles incident to its front generator without
  // raster samples. An isolated quad cannot reproduce this: background exposes it.
  await call('scene.new');await call('view.set',{index:2,single:true});
  const rod=await call('scene.create',{type:'cylinder',params:{diameter:10,height:1463,'angle approximation':10}});
  await call('scene.select',{ids:[rod.hash]});
  for(const [axis,value]of [52,190,93].entries())await call('transform.set',{channel:'position',axis,value,coordinates:'world'});
  await call('scene.select',{ids:[]});
  for(const phase of [0,.25,.5]){
   const yaw=12.006601836602544,pitch=.1395987755982983,distance=238.07672003716232;
   const forward=[Math.cos(pitch)*Math.sin(yaw),-Math.sin(pitch),Math.cos(pitch)*Math.cos(yaw)],target=[52+phase,1400,88],eye=target.map((v,k)=>v-forward[k]*distance);
   await call('view.set',{index:0,single:true,shading:'solid-isoparms',camera:[yaw,pitch,1,0,0,...target,...eye,distance]});await warm();const solid=await capture();
   await call('view.set',{shading:'isoparms'});await warm();const wire=await capture();
   const ends=await projectMaskPoints(page,solid,[[52,190,88],[52,1653,88]]);
   const coverage=mask=>{
    const set=new Set(mask.pixels),[a,b]=ends,missing=[];let rows=0;
    for(let y=20;y<Math.min(mask.height-20,700);y++){
     if(y<Math.min(a[1],b[1])||y>Math.max(a[1],b[1]))continue;
     const x=Math.floor(a[0]+(b[0]-a[0])*(y+.5-a[1])/(b[1]-a[1]));if(x<2||x>=mask.width-2)continue;
     rows++;if(![-1,0,1].some(dx=>set.has(y*mask.width+x+dx)))missing.push(y);
    }return {rows,missing};
   },visible=coverage(solid),control=coverage(wire);
   check('Narrow facet preserves the complete stroke at phase '+phase,visible.rows>500&&control.missing.length===0&&visible.missing.length===0,{solid:visible,wire:control});
   await call('view.set',{shading:'solid-isoparms'});await warm();const rear=await hits(await capture(),[1100,1200,1300].map(y=>[52,y,98]));
   check('Narrow facet does not expose rear generator at phase '+phase,rear.every(v=>!v),rear);
  }
  await call('scene.new');const template=await call('scene.create',{type:'cube'}),copies=await call('scene.create',{type:'cloner',inputs:[template.hash],params:{'count x':8,'count y':1,'count z':1,'spacing x':160}});await call('scene.select',{ids:[]});await call('view.set',{index:0,single:true,shading:'solid-isoparms',focus:copies.hash});await warm();const batch=await capture();check('Lines retain shared instance draw calls',batch.pixels.length>500&&batch.draws.draws<=2&&batch.draws.instances===8,batch.draws);
  await call('view.set',{index:2,single:true,shading:'solid-isoparms',focus:copies.hash});await warm();await call('view.set',{index:0,single:false,shading:'solid-isoparms'});await warm();const resources=await page.evaluate(()=>frameEngine.viewResources());check('Passive solid view owns its visible triangle map',resources.passiveContexts>0&&resources.passiveWireIDBytes>0&&resources.passiveWirePlaneBytes===resources.passiveWireIDBytes*4,resources);await call('view.set',{index:0,single:true});await warm();const measured=await call('diagnostics.frame',{frames:5});frames.push(measured);check('Native CPU/GPU frame budgets',measured.timestampQueries&&measured.frames.every(f=>f.cpuMs<50&&f.gpuMs<50),measured.frames);
  // Hardware clipping must produce strokes even when a source triangle crosses the eye.
  await call('scene.new');await call('mesh.create',{vertices:[-1,-1,-1,1,-1,1,0,1,1],indices:[0,1,2]});await call('scene.select',{ids:[]});await call('view.set',{index:0,single:true,shading:'solid-wire',camera:[0,0,1,0,0,0,0,1,0,0,0,1]});await warm();const crossing=await capture([0,0,0]);check('Eye-crossing triangle produces bounded line pixels',crossing.pixels.length>0&&crossing.pixels.length<crossing.width*crossing.height*.02,{pixels:crossing.pixels.length,width:crossing.width,height:crossing.height});
  return {pass:true,checks,raster,frames};
 }catch(error){return {pass:false,checks,raster,frames,error:error.stack};}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const server=await serve(),report={pass:false,errors:[]};let browser;
 try{browser=await chromium.launch({headless:true,channel:'chromium',executablePath:process.env.FRAME_BROWSER,ignoreDefaultArgs:['--enable-unsafe-swiftshader'],args:['--enable-unsafe-webgpu','--disable-background-timer-throttling','--disable-renderer-backgrounding']});const context=await browser.newContext({viewport:{width:1000,height:760},deviceScaleFactor:Number(process.env.FRAME_DPR||1),serviceWorkers:'block'}),page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.stack));await page.goto(server.url+(process.argv.includes('--no-primitive-index')?'/?no-primitive-index':''));await ready(page);report.primitiveIndex=await page.evaluate(()=>frameEngine.renderer.primitiveIndex);report.adapter=await page.evaluate(()=>{const a=frameEngine.renderer.device.adapterInfo;return {vendor:a.vendor,architecture:a.architecture,isFallbackAdapter:a.isFallbackAdapter};});assert.equal(report.adapter.isFallbackAdapter,false);assert.ok(!/swiftshader|software|llvmpipe/i.test(JSON.stringify(report.adapter)));await page.evaluate(()=>{window.__wireErrors=[];const d=frameEngine.renderer.device;d.addEventListener('uncapturederror',e=>__wireErrors.push(e.error.message));d.pushErrorScope('validation');});Object.assign(report,await surfaceWireStabilityBrowserChecks(page));report.validation=await page.evaluate(async()=>({scope:(await frameEngine.renderer.device.popErrorScope())?.message||null,uncaptured:__wireErrors}));report.pass&&=!report.validation.scope&&!report.validation.uncaptured.length&&!report.errors.length;if(!report.pass)await page.screenshot({path:fileURLToPath(new URL('./results/surface-wire-stability-failure.png',import.meta.url))});}catch(error){report.pass=false;report.error=error.stack;}finally{await browser?.close();await server.close();report.indexSHA256=createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex');await mkdir(new URL('./results/',import.meta.url),{recursive:true});await writeFile(new URL('./results/surface-wire-stability-browser.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));process.exitCode=report.pass?0:1;}
}
