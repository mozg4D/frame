import {launch,ready} from '../tools/browser.mjs';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

export async function filePlaybackChecks(page){
 const checks=[],timings=[],check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});if(!pass)throw Error(name+': '+JSON.stringify(detail));},call=(name,args={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[name,args]),timed=async(name,budget,fn)=>{const start=performance.now();await fn();const ms=performance.now()-start;timings.push({name,ms,budget});check(name+' latency',ms<budget,{ms,budget});},menu=async()=>{await page.mouse.move(400,500);await page.locator('#btnSave').hover();};
 try{
  await call('scene.new');
  check('Incremental toolbar icon is removed',await page.locator('#btnSaveInc').count()===0);
  await menu();const labels=await page.locator('#menu button').allTextContents();
  check('Incremental Save is the second dropdown row',labels.length===7&&labels[0]==='Frame scene (.hash)'&&labels[1]==='Save incremental (+1)',labels);
  const current=page.locator('#menu button[aria-current=true]');
  check('Save hover highlights its actual HASH format',await current.count()===1&&await current.textContent()==='Frame scene (.hash)'&&await current.evaluate(e=>getComputedStyle(e).backgroundColor==='rgb(58, 58, 58)'));
  await page.keyboard.press('Escape');await page.locator('#btnSave').focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');
  check('Incremental menu remains keyboard accessible',await page.evaluate(()=>document.activeElement.textContent==='Save incremental (+1)'));await page.keyboard.press('Escape');
  await page.evaluate(()=>{window.__fileSaves=[];window.__filePickers=[];window.__cancelSave=false;window.showSaveFilePicker=async options=>{__filePickers.push(options);if(__cancelSave)throw new DOMException('Cancelled','AbortError');return {name:options.suggestedName,createWritable:async()=>{const record={name:options.suggestedName};__fileSaves.push(record);return {write:async()=>{},close:async()=>{record.closed=true;}};}};};});
  await timed('First HASH Save to completed write',1500,async()=>{await page.locator('#btnSave').click();await page.waitForFunction(()=>__fileSaves.length===1&&__fileSaves[0].closed);});
  for(let i=0;i<2;i++)await timed('Explicit HASH Save As '+(i+1),1500,async()=>{await menu();await page.getByRole('menuitem',{name:'Frame scene (.hash)',exact:true}).click();await page.waitForFunction(n=>__fileSaves.length===n&&__fileSaves.at(-1).closed,i+2);});
  check('Every explicit HASH selection opens a fresh chooser',await page.evaluate(()=>__filePickers.length===3));
  await timed('Plain Save reuses HASH handle',1000,async()=>{await page.locator('#btnSave').click();await page.waitForFunction(()=>__fileSaves.length===4&&__fileSaves.at(-1).closed);});check('Plain Save does not reopen the chooser',await page.evaluate(()=>__filePickers.length===3));
  await timed('Dropdown incremental HASH Save',1500,async()=>{await menu();await page.getByRole('menuitem',{name:'Save incremental (+1)',exact:true}).click();await page.waitForFunction(()=>__fileSaves.length===5&&__fileSaves.at(-1).closed);});
  check('Incremental dropdown advances native filename',await page.evaluate(()=>sceneFileName==='scene_001.hash'&&__filePickers.length===4));
  await call('mesh.create',{vertices:[0,0,0,10,0,0,0,10,0],indices:[0,1,2]});await menu();await page.getByRole('menuitem',{name:'STL mesh (.stl)',exact:true}).click();await page.waitForFunction(()=>__fileSaves.length===6&&__fileSaves.at(-1).closed);await menu();
  check('Save still highlights HASH after an STL export',await page.locator('#menu button[aria-current=true]').textContent()==='Frame scene (.hash)');
  await timed('Dropdown incremental STL Save',1500,async()=>{await page.getByRole('menuitem',{name:'Save incremental (+1)',exact:true}).click();await page.waitForFunction(()=>__fileSaves.length===7&&__fileSaves.at(-1).closed);});
  check('Incremental retains the last completed export format',await page.evaluate(()=>sceneFileName==='scene_002.stl'&&lastSavedFormat==='stl'));
  await page.evaluate(()=>__cancelSave=true);await menu();await page.getByRole('menuitem',{name:'Frame scene (.hash)',exact:true}).click();await page.waitForFunction(()=>__filePickers.length===7);
  check('Cancelled Save As retains the target and format',await page.evaluate(()=>sceneFileName==='scene_002.stl'&&lastSavedFormat==='stl'&&__fileSaves.length===7));
  await call('scene.new');
  for(const populated of [false,true]){
   if(populated)await call('scene.create',{type:'group'});
   await page.locator('#tlTotal').fill('2');await page.locator('#tlTotal').press('Enter');await call('animation.seek',{frame:0});await call('animation.loop',{enabled:false});
   await timed((populated?'Object scene':'Empty scene')+' stops with Loop off',1000,async()=>{await page.locator('#tlPlay').click();await page.waitForFunction(()=>document.querySelector('#tlPlay').getAttribute('aria-pressed')==='false');});
   let status=await call('animation.inspect');check('Loop off holds the final frame '+populated,!status.playing&&status.frame===2&&await page.locator('#tlSpeed').textContent()==='frame',status);
   await call('animation.seek',{frame:0});await call('animation.loop',{enabled:true});await page.locator('#tlPlay').click();await page.waitForTimeout(180);status=await call('animation.inspect');check('Loop on keeps playing '+populated,status.playing&&status.loop,status);await call('animation.pause');
  }
  await call('scene.new');return {pass:true,checks,timings};
 }catch(error){return {pass:false,checks,timings,error:error.stack};}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const s=await launch({headless:process.argv.includes('--headless')}),errors=[];try{await ready(s.page);s.page.on('pageerror',e=>errors.push(e.message));const result=await filePlaybackChecks(s.page);result.errors=errors;result.pass&&=!errors.length;await writeFile(new URL('./results/file-playback.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));process.exitCode=result.pass?0:1;}finally{await s.close();}}
