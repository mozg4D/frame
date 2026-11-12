import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export async function viewportConnectedBrowserChecks(page){
 const checks=[],timings=[],call=(n,a={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[n,a]),state=()=>call('scene.inspect'),check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});if(!pass)throw Error(name+': '+JSON.stringify(detail));};
 const total=s=>s.selection.counts.reduce((a,b)=>a+b,0),history=()=>page.evaluate(()=>({undo:undoStack.length,redo:redoStack.length}));
 try{
  await page.keyboard.press('Escape');await call('render.stop');let s=await state();if(s.objects.length)await call('scene.delete',{ids:s.objects.filter(n=>!n.parent).map(n=>n.hash)});
  for(const storage of ['auto','texture']){
   const mesh=await call('mesh.create',{vertices:[-100,-100,0,100,-100,0,100,100,0,-100,100,0,140,0,0,160,0,0,140,20,0],indices:[0,1,2,0,2,3,4,5,6],storage});
   await call('view.set',{index:2,single:true,focus:mesh.hash,shading:'solid-wire',coordinates:'world',pivot:false,snap:false,quantize:false});
   const before=await call('diagnostics.mesh',{id:mesh.hash,geometry:true});
   for(const [mode,expected]of [['polygon',2],['vertex',4],['edge',5]]){
    await call('view.set',{mode});await page.locator('#tabObjects').click();await page.locator('#row-'+mesh.id+' .ob-name').click();
    s=await state();check(storage+' '+mode+' actual Objects row sets object scope',s.selection.scope==='objects'&&s.selection.objects.includes(mesh.hash),s.selection);
    await call('diagnostics.frame',{frames:1});
    const quad=await Promise.all([[-100,-100,0],[100,-100,0],[100,100,0],[-100,100,0]].map(point=>call('view.project',{id:mesh.hash,point}).then(r=>r.screen)));
    const hit=await page.locator('#frame-gizmo [data-part="move01"]').evaluate((path,quad)=>{
     const svg=path.ownerSVGElement,doc=path.ownerDocument,matrix=path.getScreenCTM();
     if(svg.parentNode!==doc.body||!matrix||getComputedStyle(path).fill==='none')return null;
     const inside=(p,t)=>{const signs=t.map((a,i)=>{const b=t[(i+1)%t.length];return (b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);});return signs.every(x=>x>1e-5)||signs.every(x=>x< -1e-5);};
     // The shipped shape writer emits one closed M/L/L/Z subpath per triangle.
     for(const subpath of path.getAttribute('d').match(/M[^Z]+Z/g)||[]){
      const values=(subpath.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/ig)||[]).map(Number);if(values.length!==6)continue;
      const local=new DOMPoint((values[0]+values[2]+values[4])/3,(values[1]+values[3]+values[5])/3),screen=local.matrixTransform(matrix),point=[screen.x,screen.y];
      const top=doc.elementFromPoint(...point);
      if(path.isPointInFill(local)&&top===path&&inside(point,quad))return {point,part:path.dataset.part,bodyLevel:true,painted:true,topmost:true,overConnectedIsland:true};
     }return null;
    },quad);
    check('Painted topmost body-level XY plane over connected island',!!hit,hit);
    const point=hit.point,h=await history(),start=performance.now();await page.mouse.dblclick(...point);s=await state();const ms=performance.now()-start;timings.push({name:storage+' '+mode+' Objects row then gizmo double click',ms,budgetMs:1500});check('Completed connected selection budget',ms<1500,{ms});
    check(storage+' '+mode+' selects connected island, not disconnected triangle',total(s)===expected&&s.selection.objects.includes(mesh.hash),s.selection);
    await page.mouse.dblclick(...point);s=await state();check(storage+' '+mode+' repeated double click remains connected',total(s)===expected,s.selection);check('Stationary double click adds no UI Undo transaction',JSON.stringify(await history())===JSON.stringify(h),await history());
   }
   const after=await call('diagnostics.mesh',{id:mesh.hash,geometry:true});check(storage+' selection leaves authored geometry unchanged',before.positionsSHA256===after.positionsSHA256&&before.indicesSHA256===after.indicesSHA256,{before,after});
   await call('view.set',{mode:'polygon'});await page.locator('#tabObjects').click();await page.locator('#row-'+mesh.id+' .ob-name').click();await state();
   const at=(await call('view.project',{id:mesh.hash,point:[-50,-40,0]})).screen;await page.mouse.dblclick(...at);s=await state();check(storage+' direct polygon surface double click still selects connected faces',total(s)===2,s.selection);
   const rect=await page.locator('#frame-engine-canvas').boundingBox();await page.mouse.dblclick(rect.x+3,rect.y+3);s=await state();check(storage+' empty double click retains editable owner',s.selection.objects.includes(mesh.hash),s.selection);
   await call('scene.delete',{ids:[mesh.hash]});
  }
  return {pass:true,checks,timings};
 }catch(e){await page.mouse.up().catch(()=>{});return {pass:false,checks,timings,error:e.stack};}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const {serve,ready}=await import('../tools/browser.mjs'),{chromium}=await import('playwright');let browser,server;const report={pass:false,errors:[],consoleErrors:[]};
 try{server=await serve();browser=await chromium.launch({headless:process.argv.includes('--headless'),channel:'chromium',executablePath:process.env.FRAME_BROWSER,ignoreDefaultArgs:['--enable-unsafe-swiftshader'],args:['--enable-unsafe-webgpu','--disable-background-timer-throttling','--disable-renderer-backgrounding']});const context=await browser.newContext({viewport:{width:1280,height:900},deviceScaleFactor:Number(process.env.FRAME_DPR||1),serviceWorkers:'block'}),page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.stack));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});await page.goto(server.url+'/index.html');await ready(page);
  report.adapter=await page.evaluate(()=>{const a=frameEngine.renderer.device.adapterInfo;return a?{vendor:a.vendor,architecture:a.architecture,device:a.device,description:a.description,isFallbackAdapter:a.isFallbackAdapter}:null;});if(!report.adapter||report.adapter.isFallbackAdapter!==false||!['vendor','architecture','device','description'].some(k=>typeof report.adapter[k]==='string'&&report.adapter[k].trim())||/swiftshader|llvmpipe|software/i.test(JSON.stringify(report.adapter)))throw Error('Hardware WebGPU required');
  await page.evaluate(()=>{window.__connectedGPU=[];window.__connectedLost=null;frameEngine.renderer.device.lost.then(i=>__connectedLost={reason:i.reason,message:i.message});frameEngine.renderer.device.addEventListener('uncapturederror',e=>__connectedGPU.push(e.error.message));frameEngine.renderer.device.pushErrorScope('validation');});Object.assign(report,await viewportConnectedBrowserChecks(page));report.gpu=await page.evaluate(async()=>({validation:(await frameEngine.renderer.device.popErrorScope())?.message||null,uncaptured:__connectedGPU,lost:__connectedLost}));report.pass&&=!report.errors.length&&!report.consoleErrors.length&&!report.gpu.validation&&!report.gpu.uncaptured.length&&!report.gpu.lost;
 }catch(e){report.error=e.stack;report.pass=false;}finally{report.indexSHA256=createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex');await mkdir(new URL('results/',import.meta.url),{recursive:true});await writeFile(new URL('results/viewport-connected-browser.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser?.close();await server?.close();process.exitCode=report.pass?0:1;}
}
