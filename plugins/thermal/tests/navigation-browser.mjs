// Isolated native interaction regression. No synthetic dispatch or scene pointer overrides.
import {ready} from '../../../tools/browser.mjs';
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export async function helperNavigationChecks(parent,check,timed){
 const context=await parent.context().browser().newContext({viewport:{width:1280,height:900},deviceScaleFactor:Number(process.env.FRAME_DPR||1),serviceWorkers:'block'}),page=await context.newPage(),errors=[];let permissionSession;
 context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));page.on('pageerror',e=>errors.push(e.message));
 try{
  // Match viewport-copies: this navigation fixture uses the ordinary popup fallback.
  // Deny optional screen enumeration only in this owned temporary context, so an
  // extended Home desktop cannot leave the real click waiting on a native prompt.
  permissionSession=await parent.context().browser().newBrowserCDPSession();const permissionPage=await context.newCDPSession(page);
  try{const {targetInfo}=await permissionPage.send('Target.getTargetInfo');await permissionSession.send('Browser.setPermission',{permission:{name:'window-management'},setting:'denied',origin:new URL(parent.url()).origin,browserContextId:targetInfo.browserContextId});}finally{await permissionPage.detach();}
  await page.goto(parent.url());await ready(page);
  check('navigation fixture explicitly uses denied screen enumeration fallback',await page.evaluate(async()=>(await navigator.permissions.query({name:'window-management'})).state)==='denied');
  const call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]),inspect=async()=>(await call('scene.inspect')).objects;
  const rows=await inspect();if(rows.length)await call('scene.delete',{ids:rows.filter(n=>!n.parent).map(n=>n.hash)});
  const owner=await call('plugins.create',{plugin:'thermal'}),fan=await call('plugins.command',{id:owner.hash,operation:'create-fan',args:{}}),probe=await call('plugins.command',{id:owner.hash,operation:'create-probe',args:{}});
  const hardware=await page.evaluate(()=>{const d=frameEngine.renderer.device;window.__thermalNavDevice=d;window.__thermalNavErrors=[];window.__thermalNavLost=null;d.addEventListener('uncapturederror',e=>__thermalNavErrors.push(e.error.message));d.lost.then(e=>__thermalNavLost=e.reason);d.pushErrorScope('validation');return {vendor:d.adapterInfo?.vendor,architecture:d.adapterInfo?.architecture,isFallbackAdapter:d.adapterInfo?.isFallbackAdapter};});
  check('helper navigation uses actual nonfallback GPU',hardware.isFallbackAdapter===false&&!!hardware.vendor&&!/swiftshader|software/i.test(JSON.stringify(hardware)),hardware);
  const camera=async index=>(await call('view.windows')).views.find(v=>v.id===index||v.index===index)?.camera;
  const frames=async()=>(await inspect()).map(n=>({hash:n.hash,matrix:n.matrix,worldMatrix:n.worldMatrix}));
  const pointFor=async(surface,hash,index)=>surface.evaluate(({hash,index})=>{
   const svg=document.querySelector('.frame-light-helpers[data-view="'+index+'"]'),path=svg?.querySelector('.frame-plugin-hit[data-hash="'+hash+'"]');if(!path)throw Error('Missing projected helper path');
   const rect=svg.getBoundingClientRect(),length=path.getTotalLength();
   for(let i=1;i<100;i++){const p=path.getPointAtLength(length*i/100),x=rect.left+p.x,y=rect.top+p.y;if(x<rect.left+2||y<rect.top+2||x>=rect.right-2||y>=rect.bottom-2)continue;const el=document.elementFromPoint(x,y);if(el?.tagName==='CANVAS')return {x,y,pointerEvents:getComputedStyle(path).pointerEvents,under:el.tagName};}
   throw Error('No helper stroke reaches ordinary canvas; overlay/gizmo may intercept');
  },{hash,index});
  async function gesture(surface,hash,index,button,selected){
   await call('view.set',{index,single:true,mode:'object',focus:hash});await call('scene.select',{ids:selected?[hash]:[]});await call('diagnostics.frame',{frames:2});
   const at=await pointFor(surface,hash,index),before=await camera(index),sceneBefore=await frames();
   check('helper stroke forwards ordinary pointer target to canvas',at.pointerEvents==='none'&&at.under==='CANVAS',at);
   // A short middle gesture is the native single/quad toggle (<=72px), not pan.
   const dx=button==='middle'?110:32,dy=button==='middle'?70:24;await surface.mouse.move(at.x,at.y);await surface.mouse.down({button});await surface.mouse.move(at.x+dx,at.y+dy,{steps:8});await surface.mouse.up({button});await call('scene.inspect');
   const after=await camera(index);
   check('native '+button+' navigation from '+(selected?'selected':'unselected')+' helper changes camera',!equal(after,before),{before,after});
   check('native navigation does not transform helper authoring',equal(await frames(),sceneBefore));
  }
  for(const [name,item]of [['Thermal',owner],['Fan',fan],['Probe',probe]]){
   for(const selected of [false,true])await timed(name+' left-drag native navigation '+selected,3000,()=>gesture(page,item.hash,0,'left',selected));
  }
  for(const button of ['middle','right'])await timed('Fan '+button+' native navigation',3000,()=>gesture(page,fan.hash,0,button,true));
  await call('view.set',{index:0,single:true,mode:'object',focus:fan.hash});await call('scene.select',{ids:[fan.hash]});await call('diagnostics.frame',{frames:2});
  let at=await pointFor(page,fan.hash,0),before=(await call('view.set',{})).camera;await page.mouse.move(at.x,at.y);await page.mouse.wheel(0,160);await call('diagnostics.frame',{frames:3});await call('scene.inspect');
  check('wheel over Fan stroke uses ordinary viewport zoom',!equal((await call('view.set',{})).camera,before));
  const selected=async()=>(await inspect()).filter(n=>n.selected).map(n=>n.hash).sort();
  await call('view.set',{index:0,single:true,mode:'object',focus:owner.hash});await call('scene.select',{ids:[owner.hash]});await call('diagnostics.frame',{frames:2});
  const empty=await page.evaluate(hash=>{const svg=document.querySelector('.frame-light-helpers[data-view="0"]'),paths=[...svg.querySelectorAll('.frame-plugin-hit')],r=svg.getBoundingClientRect(),owner=paths.find(p=>p.dataset.hash===hash),b=owner.getBBox(),observed={};for(let y=1;y<20;y++)for(let x=1;x<20;x++){const point={x:b.x+b.width*x/20,y:b.y+b.height*y/20},cx=r.left+point.x,cy=r.top+point.y,target=document.elementFromPoint(cx,cy),stroke=paths.some(p=>p.isPointInStroke(point));const key=(target?.tagName||'none')+':'+stroke;observed[key]=(observed[key]||0)+1;if(!stroke&&target?.tagName==='CANVAS'&&cx>=r.left&&cx<r.right&&cy>=r.top&&cy<r.bottom)return {x:cx,y:cy};}throw Error('No empty helper interior sample: '+JSON.stringify({owner:hash,paths:paths.map(p=>p.dataset.hash),bounds:{x:b.x,y:b.y,width:b.width,height:b.height},rect:{x:r.x,y:r.y,width:r.width,height:r.height},observed}));},owner.hash);
  await page.mouse.click(empty.x,empty.y);await call('scene.inspect');check('empty helper box interior does not replace stroke picking with an invisible solid',equal(await selected(),[]));
  await call('view.set',{index:0,single:true,mode:'object',focus:owner.hash});await call('scene.select',{ids:[]});await call('diagnostics.frame',{frames:2});
  at=await pointFor(page,owner.hash,0);await page.mouse.click(at.x,at.y);await call('scene.inspect');check('helper click uses ordinary native object selection',equal(await selected(),[owner.hash]));
  await call('view.set',{focus:fan.hash});await call('diagnostics.frame',{frames:2});at=await pointFor(page,fan.hash,0);await page.keyboard.down('Shift');try{await page.mouse.click(at.x,at.y);}finally{await page.keyboard.up('Shift');}await call('scene.inspect');
  check('Shift helper click adds through native modifier selection',equal(await selected(),[owner.hash,fan.hash].sort()));
  await page.waitForTimeout(350);await page.keyboard.down('Control');try{await page.mouse.click(at.x,at.y);}finally{await page.keyboard.up('Control');}await call('scene.inspect');
  check('Ctrl helper click toggles through native modifier selection',equal(await selected(),[owner.hash]));
  await call('scene.select',{ids:[fan.hash]});await page.mouse.click(at.x,at.y,{button:'right'});check('helper object mode preserves native no-menu behavior',!(await page.locator('#menu').isVisible()));
  await call('view.set',{index:0,mode:'vertex'});await call('diagnostics.frame',{frames:2});at=await pointFor(page,fan.hash,0);await page.mouse.click(at.x,at.y,{button:'right'});check('helper component mode exposes ordinary native object menu',await page.locator('#menu').isVisible());await page.keyboard.press('Escape');await call('view.set',{mode:'object'});
  const mainBefore=(await call('view.windows')).views.find(v=>v.index===0||v.id===0)?.camera;
  const popupPromise=page.waitForEvent('popup');await page.locator('[data-open-view="0"]').click();const popup=await popupPromise;await popup.waitForSelector('.view[data-view]');
  const popupIndex=Number(await popup.locator('.view[data-view]').getAttribute('data-view'));await call('view.set',{index:popupIndex,mode:'object',focus:fan.hash});
  await timed('additional viewport helper navigation',3000,()=>gesture(popup,fan.hash,popupIndex,'left',true));
  const mainAfter=(await call('view.windows')).views.find(v=>v.index===0||v.id===0)?.camera;check('additional view helper navigation leaves main camera unchanged',equal(mainBefore,mainAfter)&&Array.isArray(mainBefore),{mainBefore,mainAfter});
  await popup.close({runBeforeUnload:true});await page.waitForFunction(i=>!FrameViewWindows.detached(i),popupIndex);
  const gpu=await page.evaluate(async()=>({validation:(await __thermalNavDevice.popErrorScope())?.message||null,uncaptured:__thermalNavErrors,lost:__thermalNavLost,sameDevice:__thermalNavDevice===frameEngine.renderer.device}));
  check('native helper interaction preserves GPU and emits no error',!gpu.validation&&!gpu.uncaptured.length&&!gpu.lost&&gpu.sameDevice&&!errors.length,{gpu,errors});
  return {hardware,gpu,errors,scope:'Native helper interaction only; no numerical physics.'};
 }finally{await context.close();await permissionSession?.detach();}
}
