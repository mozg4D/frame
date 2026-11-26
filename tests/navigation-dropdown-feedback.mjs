// Isolated native input regressions for Camera navigation, dropdown release and mobile view opening.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {launch,ready} from '../tools/browser.mjs';

const session=await launch({headless:true}),{page,context}=session;
const report={pass:false,checks:[],errors:[],timings:[]};
const call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]);
const check=(name,pass,detail)=>{report.checks.push({name,pass:!!pass,detail});console.log((pass?'PASS ':'FAIL ')+name);};
const near=(a,b)=>a.length===b.length&&a.every((v,i)=>Math.abs(v-b[i])<1e-9*Math.max(1,Math.abs(v),Math.abs(b[i])));
const frame=()=>page.evaluate(()=>new Promise(requestAnimationFrame));
try{
 await ready(page);page.on('pageerror',e=>report.errors.push(e.message));
 await page.evaluate(()=>{window.__feedbackGPU=[];frameEngine.renderer.device.addEventListener('uncapturederror',e=>__feedbackGPU.push(e.error.message));frameEngine.renderer.device.pushErrorScope('validation');});
 const adapter=await page.evaluate(()=>({description:frameEngine.renderer.device.adapterInfo.description,vendor:frameEngine.renderer.device.adapterInfo.vendor}));
 assert.ok(!/swiftshader|llvmpipe|software/i.test(adapter.description),'Hardware WebGPU required');report.adapter=adapter;
 async function navigate(camera){
  await call('scene.new');const cube=await call('scene.create',{type:'cube'});
  await call('view.set',{index:0,single:false,focus:cube.hash,coordinates:'world'});
  const record=(await call('scene.inspect')).view.camera;record[0]=.37;record[1]=1.45;await call('view.set',{camera:record,index:0,single:false});
  let cameraNode;
  if(camera){cameraNode=await call('scene.create',{type:'render',params:{realtime:'on',environment:'default'}});await call('scene.select',{ids:[cameraNode.hash]});}
  else await call('scene.select',{ids:[]});
  if(camera)await call('diagnostics.frame',{frames:1});
  await call('view.set',{camera:record,index:0,single:false});await frame();const initial=await page.evaluate(()=>frameEngine.viewCamera(0).camera);
  const box=await page.locator('#frame-engine-canvas').boundingBox(),x=box.x+box.width*.76,y=box.y+box.height*.45,samples=[];
  for(const [dx,dy]of [[0,0],[10,20],[25,40],[40,55]]){
   if(!dx&&!dy){await page.evaluate(()=>{delete document.querySelector('#frame-engine-canvas').dataset.orbitStartScreen;});await page.mouse.move(x,y);await page.mouse.down();await page.waitForFunction(()=>document.querySelector('#frame-engine-canvas').dataset.orbitStartScreen);}
   else await page.mouse.move(x+dx,y+dy);
   await frame();samples.push(await page.evaluate(()=>frameEngine.viewCamera(0).camera));
  }
  await page.mouse.up();await frame();samples.push(await page.evaluate(()=>frameEngine.viewCamera(0).camera));
  await page.evaluate(()=>{delete document.querySelector('#frame-engine-canvas').dataset.orbitStartScreen;});await page.mouse.move(x+40,y+55);await page.mouse.down();await page.waitForFunction(()=>document.querySelector('#frame-engine-canvas').dataset.orbitStartScreen);await page.mouse.move(x+50,y+65);await page.mouse.up();await frame();
  samples.push(await page.evaluate(()=>frameEngine.viewCamera(0).camera));
  if(camera){
   check('Selected enabled Camera retains gizmos in all orthographic views',await page.locator('.frame-gizmo[data-view="1"]:visible,.frame-gizmo[data-view="2"]:visible,.frame-gizmo[data-view="3"]:visible').count()===3);report.render=await page.evaluate(()=>frameEngine.renderState());
   const placement=await page.evaluate(()=>frameEngine.cameraPlacement().matrix),authored=(await call('scene.inspect')).objects.find(o=>o.hash===cameraNode.hash).matrix;
   check('Authored Camera keeps the same up direction as the navigated viewport beyond the pole',near(placement,authored),{placement,authored});
   await call('scene.update',{id:cameraNode.hash,enabled:false});await call('scene.update',{id:cameraNode.hash,enabled:true});
   const restored=await page.evaluate(()=>frameEngine.viewCamera(0).camera);
   check('Reactivating Camera decodes the same upside-down view without a half-turn',near(restored.slice(0,3),samples.at(-1).slice(0,3)),{restored,before:samples.at(-1)});
  }
  await page.evaluate(()=>frameEngine.renderStop());return {initial,samples};
 }
 const baseline=await navigate(false),camera=await navigate(true);
 check('Enabled Camera begins at the same navigation pose',near(baseline.initial,camera.initial),{baseline:baseline.initial,camera:camera.initial});
 check('Realtime Camera crosses the upper pole and releases exactly like navigation without Camera',baseline.samples.every((v,i)=>near(v,camera.samples[i])),{baseline:baseline.samples,camera:camera.samples});
 check('Orbit remains beyond the upper pole after release',camera.samples.at(-1)[1]>Math.PI/2,camera.samples.at(-1));

 await call('scene.new');await call('scene.create',{type:'cube'});
 await page.evaluate(()=>{window.__feedbackSaves=[];window.showSaveFilePicker=async options=>{__feedbackSaves.push({name:options.suggestedName,active:navigator.userActivation.isActive,closed:false});const save=__feedbackSaves.at(-1);return {name:options.suggestedName,createWritable:async()=>({write:async()=>{},close:async()=>{save.closed=true;}})};};});
 const save=page.locator('#btnSave');await save.hover();await page.mouse.down();const stl=await page.getByRole('menuitem',{name:'STL mesh (.stl)',exact:true}).boundingBox();await page.mouse.move(stl.x+stl.width/2,stl.y+stl.height/2,{steps:6});await page.mouse.up();await frame();
 const saves=await page.evaluate(()=>__feedbackSaves);check('Press Save and release over STL invokes the file picker once with user activation',saves.length===1&&saves[0].name.endsWith('.stl')&&saves[0].active,saves);
 if(saves.length)await page.waitForFunction(()=>__feedbackSaves.at(-1).closed);
 await page.mouse.move(500,500);await save.hover();await page.getByRole('menuitem',{name:'Frame scene (.hash)',exact:true}).click();await page.waitForFunction(()=>__feedbackSaves.at(-1)?.closed);
 check('Ordinary dropdown clicks still invoke one picker',await page.evaluate(()=>__feedbackSaves.length===2&&__feedbackSaves[1].name.endsWith('.hash')));
 // Same shared menu, with a different opener and action: release selection is a menu contract.
 await page.evaluate(()=>{window.__feedbackChoice=0;const b=document.querySelector('#btnOpen');b.onpointerdown=()=>{const r=b.getBoundingClientRect();showMenu(r.left,r.bottom,[['Release choice',()=>__feedbackChoice++]]);};});
 await page.locator('#btnOpen').hover();const open=await page.locator('#btnOpen').boundingBox();await page.mouse.down();const choice=await page.getByRole('menuitem',{name:'Release choice',exact:true}).boundingBox();await page.mouse.move(open.x+open.width/2,choice.y+choice.height/2,{steps:3});await page.mouse.move(choice.x+choice.width/2,choice.y+choice.height/2,{steps:3});await page.mouse.up();await frame();check('Shared dropdown release selects another opener action exactly once',await page.evaluate(()=>__feedbackChoice===1),await page.evaluate(()=>({count:__feedbackChoice,menu:document.querySelector('#menu').hidden})));

 // Real Chromium touch synthesis: the view icon must keep its trusted click and never capture viewport navigation.
 const mobile=await context.browser().newContext({viewport:{width:430,height:850},isMobile:true,hasTouch:true,deviceScaleFactor:1,serviceWorkers:'block'});
 try{
  const mp=await mobile.newPage();mp.on('pageerror',e=>report.errors.push(e.message));await mp.goto(page.url());await ready(mp);
  await mp.evaluate(()=>frameAI.call('view.set',{index:0,single:true}));const button=mp.locator('.frame-view-open[data-open-view="0"]'),b=await button.boundingBox(),cdp=await mobile.newCDPSession(mp);
  const touch=async(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([x,y])=>({x,y,id:0,radiusX:3,radiusY:3,force:1}))});
  const popupPromise=mobile.waitForEvent('page',{timeout:5000}).catch(()=>null),started=performance.now();await touch('touchStart',[[b.x+b.width/2,b.y+b.height/2]]);await touch('touchEnd',[]);const popup=await popupPromise;
  check('Mobile New view opens through its trusted touch click',!!popup);
  if(popup){await popup.waitForFunction(()=>document.querySelector('.view[data-view]'),{},{timeout:15000});const state=await mp.evaluate(()=>({views:FrameViewWindows.inspect(),notice:[...document.querySelectorAll('.frame-view-notice')].filter(e=>!e.hidden).map(e=>e.textContent),canDetach:frameEngine.canDetachView()}));check('Mobile view creates without stuck viewport gesture or error notice',state.canDetach&&state.notice.length===0&&state.views.views.some(v=>v.separate),state);await popup.close();await mp.bringToFront();}
  else check('Mobile failed open leaves no stuck gesture',await mp.evaluate(()=>frameEngine.canDetachView()));
  report.timings.push({name:'Mobile touch open',ms:performance.now()-started});
  await mp.evaluate(()=>{window.__touchSaves=[];window.showSaveFilePicker=async options=>{__touchSaves.push({name:options.suggestedName,active:navigator.userActivation.isActive});throw new DOMException('Cancelled test picker','AbortError');};});
  const sb=await mp.locator('#btnSave').boundingBox();await touch('touchStart',[[sb.x+sb.width/2,sb.y+sb.height/2]]);const item=await mp.getByRole('menuitem',{name:'STL mesh (.stl)',exact:true}).boundingBox();await touch('touchMove',[[item.x+item.width/2,item.y+item.height/2]]);await touch('touchEnd',[]);await mp.evaluate(()=>new Promise(requestAnimationFrame));
  const touchSaves=await mp.evaluate(()=>__touchSaves);check('Touch dropdown release invokes STL picker once despite implicit pointer capture',touchSaves.length===1&&touchSaves[0].name.endsWith('.stl')&&touchSaves[0].active,touchSaves);await cdp.detach();
 }finally{await mobile.close();}
 report.gpu=await page.evaluate(async()=>({validation:(await frameEngine.renderer.device.popErrorScope())?.message||null,uncaptured:__feedbackGPU}));
 check('Focused flow has no page or GPU errors',!report.errors.length&&!report.gpu.validation&&!report.gpu.uncaptured.length,{errors:report.errors,gpu:report.gpu});
 report.pass=report.checks.every(c=>c.pass);
}catch(error){report.error=error.stack;console.error(error.stack);}finally{
 report.indexSHA256=createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex');await writeFile(new URL('./results/navigation-dropdown-feedback.json',import.meta.url),JSON.stringify(report,null,2));await session.close();
}
console.log(JSON.stringify({pass:report.pass,checks:report.checks.map(({name,pass})=>({name,pass})),error:report.error,timings:report.timings},null,2));process.exitCode=report.pass?0:1;
