import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {serve,ready,root} from '../tools/browser.mjs';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

// Measure the actual text fragments. A fixed-height row alone cannot reveal a wrapped or clipped caption.
function attributeButtonLayout(){
 const host=document.getElementById('attrContent'),panel=host.getBoundingClientRect(),issues=[],buttons=[];
 for(const row of host.querySelectorAll('.attr-row')){
  const bounds=row.getBoundingClientRect(),label=row.querySelector('.attr-lab');
  const occupied=label?[label.getBoundingClientRect()]:[];
  for(const button of row.querySelectorAll('.attr-btn')){
   const box=button.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(button);
   const lines=[...range.getClientRects()],caption=button.textContent;
   if(lines.length!==1||lines[0].left<box.left-.1||lines[0].right>box.right+.1)issues.push('Caption: '+caption);
   if(box.left<bounds.left-.1||box.right>bounds.right+.1||box.top<bounds.top-.1||box.bottom>bounds.bottom+.1)issues.push('Outside row: '+caption);
   if(occupied.some(r=>r.left<box.right-.1&&box.left<r.right-.1&&r.top<box.bottom-.1&&box.top<r.bottom-.1))issues.push('Overlap: '+caption);
   occupied.push(box);
   buttons.push({caption,box:[box.left-panel.left,box.top-bounds.top,box.width,box.height,bounds.height]});
  }
 }
 return {issues,buttons};
}

async function checkCameraLayout(page,check,timings){
 const openCamera=async(target,touch)=>{
  const press=locator=>touch?locator.tap():locator.click(),start=performance.now();
  await press(target.getByRole('button',{name:'Add Camera',exact:true}));
  const viewport=target.getByRole('button',{name:'Viewport',exact:true});
  await viewport.waitFor();
  const name='Add Camera with '+(touch?'touch':'mouse'),ms=performance.now()-start;
  timings.push({name,ms,budget:2500});check(name+' opens Attributes within 2500 ms',ms<2500,{ms});
  await press(viewport);
  await press(target.locator('[data-field="realtime"][data-value="off"]'));
  await press(target.locator('[data-field="realtime during navigation"][data-value="false"]'));
  check(name+' shows the native Viewport',await viewport.getAttribute('aria-pressed')==='true');
 };
 await openCamera(page,false);
 const desktop=await page.evaluate(attributeButtonLayout);
 check('Desktop Camera buttons fit their rows',!desktop.issues.length&&desktop.buttons.some(b=>b.caption==='Viewport'),desktop.issues);
 const mobile=await page.context().browser().newContext({isMobile:true,hasTouch:true,deviceScaleFactor:1,viewport:{width:390,height:844}});
 try{
  const phone=await mobile.newPage();await phone.goto(page.url());await ready(phone);
  // Viewport emulation retains the host's fonts. Exercise the wider 0.6-em monospace advance found on phones.
  await phone.addStyleTag({content:'#attrContent,#attrContent *{font-family:"Courier New","Liberation Mono","DejaVu Sans Mono",monospace!important}'});
  await openCamera(phone,true);
  for(const [width,height] of [[390,844],[844,390],[844,286],[320,568],[768,1024]]){
   await phone.setViewportSize({width,height});
   const realtime=phone.locator('button[data-field="realtime"]');
   await realtime.tap({timeout:2500});check('Camera choice receives taps at '+width+'x'+height,await realtime.getAttribute('aria-pressed')==='true');
   await realtime.tap();
   const layout=await phone.evaluate(attributeButtonLayout);
   const same=layout.buttons.length===desktop.buttons.length&&layout.buttons.every((button,i)=>{
    const reference=desktop.buttons[i];return button.caption===reference.caption&&button.box.every((v,k)=>Math.abs(v-reference.box[k])<1);
   });
   check('Camera captions and bounds match desktop at '+width+'x'+height,!layout.issues.length&&same,same?layout.issues:{desktop,layout});
  }
  // Give an existing choice group captions that genuinely exceed the available line.
  await phone.locator('button[data-field="renderer"]').evaluateAll(buttons=>{
   buttons[0].textContent='First rendering method';buttons[1].textContent='Second rendering method';
  });
  const long=await phone.evaluate(attributeButtonLayout),choices=long.buttons.filter(b=>b.caption.endsWith('rendering method'));
  check('Oversized choices flow between intact buttons and expand their row',!long.issues.length&&choices.length===2&&choices[0].box[1]!==choices[1].box[1],{choices,issues:long.issues});
 }finally{await mobile.close();}
}

export async function panelLayoutBrowserChecks(page,{setZoom,reloadPage}={}){
 const checks=[],timings=[],call=(name,args={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[name,args]);
 const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});assert.ok(pass,name+': '+JSON.stringify(detail));};
 const reload=reloadPage||(async()=>{await page.reload();await ready(page);});
 const settle=()=>page.evaluate(()=>new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok))));
 const state=()=>page.evaluate(()=>{const rect=id=>document.getElementById(id).getBoundingClientRect(),tree=rect('obWrap'),strip=rect('tabstrip');return {top:strip.top,height:tree.height,width:rect('panel').width,saved:localStorage.getItem('frame-ui.obwrap.h'),innerHeight,innerWidth,dpr:devicePixelRatio};});
 const drag=async(delta)=>{const r=await page.locator('#tabstrip').boundingBox();await page.mouse.move(r.x+r.width-8,r.y+1);await page.mouse.down();await page.mouse.move(r.x+r.width-8,r.y+1+delta,{steps:4});await page.mouse.up();await settle();};
 const roundTrip=async(name,change,restore,base)=>{const at=performance.now();await change();await settle();const constrained=await state();check(name+' preserves the requested height and fixed panel width',constrained.saved===base.saved&&Math.abs(constrained.width-base.width)<.1,constrained);await restore();await settle();const after=await state(),ms=performance.now()-at;check(name+' returns to the exact divider position',Math.abs(after.top-base.top)<.1&&after.saved===base.saved,{base,constrained,after});timings.push({name,ms,budget:2500});check(name+' completes within 2500 ms',ms<2500,{ms});};
 try{
  await call('render.stop');await call('scene.new');await page.setViewportSize({width:1280,height:900});await settle();
  await drag(470-(await state()).height);let base=await state();check('Dragging stores the chosen tree height',Math.abs(base.height-470)<.1&&Math.abs(Number(base.saved)-470)<.1,base);
  for(let i=0;i<3;i++)await roundTrip('Window shrink/expand '+i,()=>page.setViewportSize({width:900,height:480}),()=>page.setViewportSize({width:1280,height:900}),base);
  await roundTrip('Window expansion/restoration',()=>page.setViewportSize({width:1400,height:1200}),()=>page.setViewportSize({width:1280,height:900}),base);
  await page.setViewportSize({width:900,height:480});await settle();const constrained=await state();check('Small window temporarily clamps the visible height',constrained.height<base.height&&constrained.saved===base.saved,constrained);
  await drag(0);check('A divider click while constrained preserves the preference',(await state()).saved===base.saved);
  await reload();await settle();check('Reload while constrained preserves the saved preference',(await state()).saved===base.saved);await page.setViewportSize({width:1280,height:900});await settle();check('Expanding after constrained reload restores the original height',Math.abs((await state()).top-base.top)<.1,await state());
  if(setZoom)for(const zoom of [1.5,.8,1.25,.67,1.5]){
   await roundTrip('Browser page zoom '+zoom,async()=>{await setZoom(zoom);await page.waitForFunction(expected=>Math.abs(devicePixelRatio-expected)<.02,base.dpr*zoom);},async()=>{await setZoom(1);await page.waitForFunction(expected=>Math.abs(devicePixelRatio-expected)<.02,base.dpr);},base);
  }
  await page.locator('#treeResize').press('ArrowDown');await settle();let keyed=await state();check('Keyboard adjustment is saved',Math.abs(keyed.height-base.height-8)<.1&&Math.abs(Number(keyed.saved)-keyed.height)<.1,keyed);await reload();await settle();check('Keyboard adjustment survives reload',Math.abs((await state()).top-keyed.top)<.1,await state());base=await state();
  const back=await page.locator('#tabstrip').boundingBox();await page.mouse.move(back.x+back.width-8,back.y+1);await page.mouse.down();await page.mouse.move(back.x+back.width-8,back.y-39);await page.mouse.move(back.x+back.width-8,back.y+1);await page.mouse.up();await settle();check('Dragging away and back restores the gesture start',Math.abs((await state()).top-base.top)<.1,await state());
  const before=await state();await page.evaluate(async()=>{for(let i=0;i<45;i++)await frameAI.call('scene.create',{type:'group',name:'Browser row '+i});});await settle();const full=await state();check('Object Browser content does not move the divider',Math.abs(full.top-before.top)<.1&&full.saved===before.saved,{before,full});
  await call('scene.new');await settle();check('Clearing the Object Browser does not move the divider',Math.abs((await state()).top-before.top)<.1,await state());
  const r=await page.locator('#tabstrip').boundingBox();await page.mouse.move(r.x+r.width-8,r.y+1);await page.mouse.down();await page.mouse.move(r.x+r.width-8,r.y-49);await page.locator('#tabstrip').dispatchEvent('pointercancel',{pointerId:1});await page.mouse.up();await settle();const cancelled=await state();check('Cancelled divider drag restores the preference and visible position',Math.abs(cancelled.top-before.top)<.1&&cancelled.saved===before.saved,cancelled);
  await checkCameraLayout(page,check,timings);
  return {pass:true,checks,timings,pageZoomTested:!!setZoom};
 }catch(error){return {pass:false,checks,timings,error:error.stack};}
 finally{if(setZoom)await setZoom(1);}
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const report={pass:false,errors:[]},server=await serve(),work=resolve(root,'work');await mkdir(work,{recursive:true});const temporary=await mkdtemp(resolve(work,'panel-layout-')),extension=resolve(temporary,'extension');let context,page;
 try{
  await mkdir(extension);await writeFile(resolve(extension,'manifest.json'),JSON.stringify({manifest_version:3,name:'Frame isolated page zoom test',version:'1.0',permissions:['tabs'],host_permissions:['http://127.0.0.1/*'],background:{service_worker:'worker.js'}}));await writeFile(resolve(extension,'worker.js'),'chrome.runtime.onInstalled.addListener(()=>{});');
  context=await chromium.launchPersistentContext(resolve(temporary,'profile'),{headless:true,channel:'chromium',executablePath:process.env.FRAME_BROWSER,viewport:{width:1280,height:900},deviceScaleFactor:1,serviceWorkers:'allow',ignoreDefaultArgs:['--enable-unsafe-swiftshader'],args:['--enable-unsafe-webgpu','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-extensions-except='+extension,'--load-extension='+extension]});
  context.on('page',p=>{p.on('pageerror',e=>report.errors.push(e.message));p.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});});page=await context.newPage();await page.goto(server.url+'/index.html');await ready(page);
  const worker=context.serviceWorkers().find(w=>w.url().startsWith('chrome-extension://'))||await context.waitForEvent('serviceworker',{predicate:w=>w.url().startsWith('chrome-extension://')});
  const setZoom=zoom=>worker.evaluate(async({url,zoom})=>{const tab=(await chrome.tabs.query({})).find(t=>t.url?.startsWith(url));if(!tab)throw Error('Isolated test tab missing');await chrome.tabs.setZoom(tab.id,zoom);if(Math.abs(await chrome.tabs.getZoom(tab.id)-zoom)>.001)throw Error('Browser zoom was not applied');},{url:server.url,zoom});
  report.adapter=await page.evaluate(()=>{const a=frameEngine.renderer.device.adapterInfo;return {vendor:a.vendor,description:a.description,isFallbackAdapter:a.isFallbackAdapter};});assert.equal(report.adapter.isFallbackAdapter,false);
  Object.assign(report,await panelLayoutBrowserChecks(page,{setZoom}));report.pass&&=!report.errors.length;report.indexSHA256=createHash('sha256').update(await readFile(resolve(root,'index.html'))).digest('hex');
 }catch(error){report.error=error.stack;report.pass=false;}
 finally{await mkdir(resolve(root,'tests/results'),{recursive:true});await page?.screenshot({path:resolve(root,'tests/results/panel-layout'+(report.pass?'':'-failure')+'.png')}).catch(()=>{});await context?.close();await server.close();if(temporary.startsWith(work+sep))await rm(temporary,{recursive:true,force:true});await writeFile(resolve(root,'tests/results/panel-layout-browser.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));process.exitCode=report.pass?0:1;}
}
