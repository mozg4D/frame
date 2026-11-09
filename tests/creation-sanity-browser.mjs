import {launch,ready} from '../tools/browser.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export async function creationSanityBrowserChecks(page){
 const checks=[],timings=[],call=(name,args={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[name,args]);
 const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});if(!pass)throw Error(name+': '+JSON.stringify(detail));};
 const near=(a,b)=>a?.length===b.length&&a.every((v,k)=>Number.isFinite(v)&&Math.abs(v-b[k])<1e-7);
 const observe=()=>page.evaluate(()=>({native:frameEngine.transformState&&{position:frameEngine.transformState.position,rotation:frameEngine.transformState.rotation,size:frameEngine.transformState.size},position:['px','py','pz'].map(id=>Number(document.getElementById(id).value)),rotation:['rx','ry','rz'].map(id=>Number(document.getElementById(id).value)),size:['sx','sy','sz'].map(id=>Number(document.getElementById(id).value))}));
 const measure=async(name,fn,budget=2500)=>{const at=performance.now(),v=await fn(),ms=performance.now()-at;timings.push({name,ms,budget});check(name+' bounded latency',ms<budget);return v;};
 const splines=['spline','square','circle','polyhedron','text','helix','gear','pulley'],solids=['cube','cylinder','tube','sphere','capsule','nut','washer','bolt'];
 try{
  await call('scene.new');await call('view.set',{single:true,mode:'object',coordinates:'world',pivot:false});
  for(const view of [0,1,2,3])for(const type of [...splines,...solids]){
   await call('scene.new');await call('view.set',{index:view,single:true,mode:'object'});
   const n=await measure('API '+type+' in view '+view,()=>call('scene.create',{type,params:type==='polyhedron'?{faces:5}:type==='text'?{text:'Hg\nH'}:{}}));
   const o=await observe(),rotation=splines.includes(type)&&view===1?[90,0,0]:splines.includes(type)&&view===3?[0,90,0]:[0,0,0];
   check(type+' view '+view+' native and displayed Position start at zero',near(o.position,[0,0,0])&&(!o.native||near(o.native.position,[0,0,0])),o);
   check(type+' view '+view+' keeps expected initial rotation',near(o.rotation,rotation)&&(!o.native||near(o.native.rotation,rotation)),o);
   check(type+' view '+view+' has finite nonnegative displayed Size',o.size.every(v=>Number.isFinite(v)&&v>=0),o);
   if(splines.includes(type)&&type!=='spline'){
    const p=[17,29,0],world=view===2?p:view===3?[0,29,-17]:[17,0,29];
    check(type+' view '+view+' keeps visible authored plane',near((await call('view.project',{id:n.hash,point:p})).screen,(await call('view.project',{point:world})).screen));
   }
  }
  // Exercise native library clicks as well as the API path, on each creation view.
  for(const view of [0,1,2,3])for(const type of ['text','polyhedron','cylinder']){
   await call('scene.new');await call('view.set',{index:view,single:true,mode:'object'});await page.locator('#tabObjects').click();
   await measure('UI '+type+' in view '+view,async()=>{await page.locator('#objectsPanel [data-type="'+type+'"]').click();await call('scene.inspect');});
   const o=await observe();check('UI '+type+' view '+view+' displays zero Position',near(o.position,[0,0,0]),o);if(view===0)check('UI '+type+' Perspective displays zero Rotation',near(o.rotation,[0,0,0]),o);
  }
  for(const [type,params]of [['polyhedron',{faces:3}],['polyhedron',{faces:7}],['text',{text:'Wide\nglyphs'}],['helix',{'start diameter':24,'end diameter':40,pitch:12,turns:2.5}],['cylinder',{'angle approximation':17,height:137}]]){
   await call('scene.new');await call('view.set',{index:0,single:true,mode:'object'});const n=await call('scene.create',{type});await call('scene.update',{id:n.hash,params});const o=await observe();check(type+' parameter edits retain zero origin and axis',near(o.position,[0,0,0])&&near(o.rotation,[0,0,0]),o);
  }
  for(const view of [0,1,2,3]){
   await call('scene.new');await call('view.set',{index:view,single:true,mode:'object'});await page.locator('#btnSpline').click();const r=await page.locator('#frame-engine-canvas').boundingBox();await page.mouse.click(r.x+r.width*.4,r.y+r.height*.4);await page.mouse.click(r.x+r.width*.6,r.y+r.height*.6);await page.keyboard.press('Escape');const s=await call('scene.inspect'),n=s.objects.find(n=>n.type==='spline');check('Freehand view '+view+' creates a native source',!!n);await call('scene.select',{ids:[n.hash],mode:'object'});const o=await observe();check('Freehand view '+view+' retains zero object origin',near(o.position,[0,0,0]),o);if(view===0)check('Freehand Perspective uses neutral rotation',near(o.rotation,[0,0,0]),o);
  }
  for(const type of ['text','polyhedron','helix','cylinder']){
   await call('scene.new');await call('view.set',{index:0,single:true,mode:'object',coordinates:'world'});const n=await call('scene.create',{type});
   await measure(type+' native numeric move',()=>call('transform.set',{channel:'position',axis:0,value:17}));
   await measure(type+' native numeric rotation',()=>call('transform.set',{channel:'rotation',axis:0,value:23}));
   let o=await observe();check(type+' numeric transform uses the visible axis',near(o.position,[17,0,0])&&near(o.rotation,[23,0,0]),o);
   await call('edit.history',{action:'undo'});await call('edit.history',{action:'undo'});o=await observe();check(type+' Undo restores neutral creation',near(o.position,[0,0,0])&&near(o.rotation,[0,0,0]),o);
   await call('edit.history',{action:'redo'});await call('edit.history',{action:'redo'});o=await observe();check(type+' Redo restores axis transform',near(o.position,[17,0,0])&&near(o.rotation,[23,0,0]),o);
   await measure(type+' Make Editable retains axis',()=>call('scene.convert',{id:n.hash}));o=await observe();check(type+' editable retains visible transform',near(o.position,[17,0,0])&&near(o.rotation,[23,0,0]),o);
   const saved=await call('scene.export',{includeData:true});await call('scene.open',{name:'creation-origin.hash',base64:saved.base64});await call('scene.select',{ids:[n.hash],mode:'object'});o=await observe();check(type+' HASH retains visible transform',near(o.position,[17,0,0])&&near(o.rotation,[23,0,0]),o);
  }
  const frames=await call('diagnostics.frame',{frames:8});timings.push({name:'Creation changes CPU/GPU frames',...frames});check('Frame timings are finite and bounded',frames.frames.every(f=>Number.isFinite(f.cpuMs)&&Number.isFinite(f.gpuMs)&&f.cpuMs<100&&f.gpuMs<100),frames);
  await call('scene.new');return {pass:true,checks,timings};
 }catch(error){return {pass:false,checks,timings,error:error.stack};}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const session=await launch({headless:true}),errors=[];try{await ready(session.page);session.page.on('pageerror',e=>errors.push(e.message));session.page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await session.page.evaluate(()=>{window.__creationGPU=[];frameEngine.renderer.device.addEventListener('uncapturederror',e=>__creationGPU.push(e.error.message));frameEngine.renderer.device.pushErrorScope('validation');});const r=await creationSanityBrowserChecks(session.page);r.gpu=await session.page.evaluate(async()=>({validation:(await frameEngine.renderer.device.popErrorScope())?.message||null,uncaptured:__creationGPU}));r.errors=errors;r.pass&&=!errors.length&&!r.gpu.validation&&!r.gpu.uncaptured.length;r.indexSHA256=createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex');await mkdir(new URL('results/',import.meta.url),{recursive:true});await writeFile(new URL('results/creation-sanity-browser.json',import.meta.url),JSON.stringify(r,null,2));console.log(JSON.stringify({pass:r.pass,checks:r.checks.length,failed:r.checks.filter(c=>!c.pass),error:r.error,gpu:r.gpu,errors},null,2));process.exitCode=r.pass?0:1;}finally{await session.close();}
}
