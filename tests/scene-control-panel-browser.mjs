import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {launch,ready} from '../tools/browser.mjs';
const report={pass:false,checks:[],errors:[]},check=(name,value)=>{assert.ok(value,name);report.checks.push(name);};
const sources=async()=>Object.fromEntries(await Promise.all(['index.html','frame-sw.js','scenes/crystals.hash'].map(async p=>[p,createHash('sha256').update(await readFile(new URL('../'+p,import.meta.url))).digest('hex')])));
const before=await sources();let session;
try{
 session=await launch({headless:true});const {page}=session;await ready(page);page.on('pageerror',e=>report.errors.push(e.message));
 check('Control icon always visible; Help toolbar button removed',await page.locator('#btnControl').isVisible()&&await page.locator('#btnHelp').count()===0);
 check('Application title has no year',await page.title()==='Frame');
 await page.evaluate(async()=>{
  const a=await frameAI.call('authorData.get',{owner:'scene'}),source='d1'.repeat(16),program='d2'.repeat(16);
  await frameAI.call('authorData.replace',{owner:'scene',expected:{epoch:a.epoch,revision:a.data.revision},records:[{id:source,revision:0,name:'Background code',kind:'source',refs:[],payload:{language:'javascript',text:'globalThis.__controlBackground={dom:!!document.body,core:frameCore.engine===frameEngine,internals:typeof definitions==="object"};'}},{id:program,revision:0,name:'Background program',kind:'opaque',refs:[{kind:'record',owner:'scene',id:source}],payload:{format:'frame.scene-control',version:1,data:{source:0,start:'ready',context:'main'}}}]});
 });
 await page.waitForFunction(()=>window.__controlBackground);check('Arbitrary source can directly access DOM and application internals',await page.evaluate(()=>Object.values(__controlBackground).every(Boolean)));
 const popupPromise=page.waitForEvent('popup');await page.locator('#btnControl').click();let popup=await popupPromise;await popup.waitForLoadState();
 check('Blank Control explains Scene Control and Codex',await popup.locator('#frame-control-empty').isVisible()&&(await popup.locator('#frame-control-empty').textContent()).includes('Tell Codex'));
 check('Programs without panel content retain the instruction',await page.evaluate(()=>framePrograms.status().instances.some(i=>i.state==='running')&&frameControl.inspect().panels===0));
 await page.evaluate(()=>{window.__unregisterControl=frameControl.register(({root,document})=>{const p=document.createElement('p');p.id='custom-panel';p.textContent='Arbitrary DOM';root.append(p);return ()=>window.__panelCleaned=(window.__panelCleaned||0)+1;});});
 check('Ordinary main JS can register arbitrary DOM',await popup.locator('#custom-panel').textContent()==='Arbitrary DOM');
 check('Registered content hides instructions',await popup.locator('#frame-control-empty').isHidden());
 await page.evaluate(()=>__unregisterControl());
 check('Unregister cleans content and restores instructions',await popup.locator('#custom-panel').count()===0&&await popup.locator('#frame-control-empty').isVisible()&&await page.evaluate(()=>__panelCleaned===1));
 await popup.close();
 check('Window size preferences are saved',await page.evaluate(()=>!!JSON.parse(localStorage.getItem('frame-control-window-v1'))?.width));
 // Open actual on-disk HASH through native startup, including scene code autostart.
 await page.goto(session.url+'/index.html?scene=scenes/crystals.hash');await ready(page);
 await page.evaluate(()=>{window.__controlGPU={device:frameEngine.renderer.device,errors:[],lost:null};__controlGPU.device.pushErrorScope('validation');__controlGPU.device.addEventListener('uncapturederror',e=>__controlGPU.errors.push(e.error.message));__controlGPU.device.lost.then(e=>__controlGPU.lost=e.message);});
 await page.waitForFunction(()=>framePrograms.status().instances.some(i=>i.state==='running')&&frameControl.inspect().panels===1);
 check('HASH restores executable program without opening a popup',await page.evaluate(()=>frameControl.inspect().panels===1&&!frameControl.inspect().open));
 const [crystalPopup]=await Promise.all([page.waitForEvent('popup'),page.locator('#btnControl').click()]);popup=crystalPopup;await popup.waitForLoadState();
 check('Crystal panel restored from HASH',await popup.locator('h1').textContent()==='Crystal studio'&&await popup.locator('[data-crystal]').count()===4);
 check('AI API can inspect the actual Control window',await page.evaluate(async()=>{const p=await frameAI.call('programs.panel',{action:'inspect'});return p.open&&p.panels===1;}));
 const initial=await page.evaluate(()=>frameAI.call('scene.inspect'));check('Fixture contains a real Diamond Atomic object',initial.objects.some(o=>o.name==='Diamond'&&o.type==='atomic'));
 await popup.locator('[data-crystal-cells]').fill('2');
 for(const [name,count]of [['Silicon',64],['Copper',32],['Iron',16]]){
  await popup.locator('[data-crystal="'+name+'"]').click();await popup.getByRole('status').filter({hasText:name+' · '+count+' atoms'}).waitFor();
  const objects=await page.evaluate(()=>frameAI.call('scene.inspect')),object=objects.objects.find(o=>o.name===name);check(name+' button creates native Atomic object',!!object);
  const state=await page.evaluate(id=>frameAI.call('plugins.command',{id,operation:'status'}),object.hash);check(name+' has expected lattice atom count',state.atoms===count||state.count===count);
 }
 await popup.reload();await popup.waitForLoadState();await popup.locator('h1').waitFor();check('Control popup Reload remounts saved interface',await popup.locator('[data-crystal]').count()===4);
 await popup.screenshot({path:new URL('../work/scene-control/crystals-panel.png',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')});
 await page.screenshot({path:new URL('../work/scene-control/crystals-scene.png',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')});
 const saved=await page.evaluate(()=>frameAI.call('scene.export',{includeData:true}));await page.evaluate(s=>frameAI.call('scene.open',{name:'crystals-roundtrip.hash',base64:s.base64}),saved);
 await popup.locator('h1').waitFor();check('Save/Open remounts one panel in the same open window',await popup.locator('[data-crystal]').count()===4&&await page.evaluate(()=>frameControl.inspect().panels===1));
 await page.evaluate(()=>{frameControl.register(({root})=>{root.textContent='Unmanaged panel';});});
 await page.evaluate(()=>frameAI.call('scene.new'));await popup.locator('#frame-control-empty').waitFor();check('New scene removes managed and directly registered panels and restores instructions',await popup.locator('[data-crystal]').count()===0&&await page.evaluate(()=>frameControl.inspect().panels===0));
 const gpu=await page.evaluate(async()=>{const d=__controlGPU.device;await d.queue.onSubmittedWorkDone();return {hardware:Object.fromEntries(['vendor','architecture','isFallbackAdapter'].map(k=>[k,d.adapterInfo[k]])),validation:(await d.popErrorScope())?.message||null,uncaptured:__controlGPU.errors,lost:__controlGPU.lost,replaced:d!==frameEngine.renderer.device};});report.gpu=gpu;check('Hardware WebGPU',gpu.hardware.vendor==='nvidia'&&!gpu.hardware.isFallbackAdapter);check('No GPU errors or device replacement',!gpu.validation&&!gpu.uncaptured.length&&!gpu.lost&&!gpu.replaced);check('No uncaught browser errors',report.errors.length===0);
 await page.goto(session.url+'/progress.html');await page.locator('#scene-catalogue a').first().waitFor();
 const link=page.getByRole('link',{name:'Scene Control — Crystal studio',exact:true});check('Local progress reads the scenes catalogue',await link.count()===1&&new URL(await link.getAttribute('href')).searchParams.get('scene')==='scenes/crystals.hash');
 check('Progress scene download is served from scenes',await page.evaluate(async()=>{const a=document.querySelector('a[download="crystals.hash"]');return !!a&&(await fetch(a.href)).ok;}));
 await page.screenshot({path:new URL('../work/scene-control/progress.png',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')});
 report.pass=true;
}catch(error){report.error=error.stack;}finally{
 await session?.close();report.sources=before;report.sourceUnchanged=JSON.stringify(before)===JSON.stringify(await sources());if(!report.sourceUnchanged)report.pass=false;
 await mkdir(new URL('./results/',import.meta.url),{recursive:true});await writeFile(new URL('./results/scene-control-panel-browser.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(!report.pass)process.exitCode=1;
}
