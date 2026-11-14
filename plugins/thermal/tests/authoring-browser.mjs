import {helperNavigationChecks} from './navigation-browser.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../../../tools/browser.mjs';
import {nativeProbeBrowserChecks} from './native-probe-browser.mjs';
import {isHardwareAdapter,isDecodedNativeIcon,hasBoundedFrameTimings,restoresAuthoringRows,captureAuthoringRejection} from './browser-gates.mjs';

const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fanFrame=[.3,0,0,0,.3,0,0,0,.1,-25,-12.5,-12.5];
const forbidden=['solve-grid','solve-scene','measure','inspect','inspect-velocity'];
export async function authoringBrowserChecks(parent,check,timed){
 const context=await parent.context().browser().newContext({viewport:{width:1280,height:900},deviceScaleFactor:Number(process.env.FRAME_DPR||1),serviceWorkers:'block'}),page=await context.newPage(),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.stack));page.on('request',r=>{if(r.url().includes('/plugins/thermal/'))requests.push(new URL(r.url()).pathname);});
 try{
  await page.goto(parent.url());await ready(page);
  const hardware=await page.evaluate(()=>{const d=frameEngine.renderer.device;window.__thermalPreviewGPU=[];window.__thermalPreviewLost=null;window.__thermalPreviewBuffers=[];d.addEventListener('uncapturederror',e=>__thermalPreviewGPU.push(e.error.message));d.lost.then(e=>__thermalPreviewLost={reason:e.reason,message:e.message});const create=d.createBuffer.bind(d);d.createBuffer=descriptor=>{__thermalPreviewBuffers.push(descriptor.label||'');return create(descriptor);};d.pushErrorScope('validation');return d.adapterInfo?Object.fromEntries(['vendor','architecture','device','description','isFallbackAdapter'].map(k=>[k,d.adapterInfo[k]])):null;});
  check('preview uses identifiable hardware WebGPU',isHardwareAdapter(hardware),hardware);
  const call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]),inspect=async()=>(await call('scene.inspect')).objects;
  const initial=await inspect();if(initial.length)await call('scene.delete',{ids:initial.filter(n=>!n.parent).map(n=>n.hash)});
  const catalogue=await call('plugins.list');check('catalogue contains lazy Thermal preview',catalogue.some(p=>p.id==='thermal'&&!p.loaded),catalogue);
  await page.locator('#tabPlugins').click();
  const icon=await page.locator('[data-plugin="thermal"] img').evaluate(async img=>{await img.decode();const rect=img.getBoundingClientRect();return {decoded:true,complete:img.complete,width:img.width,height:img.height,naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,rect:{width:rect.width,height:rect.height}};});
  check('native Thermal icon is displayed at 32 by 32',equal({width:icon.width,height:icon.height},{width:32,height:32}));
  check('native Thermal icon decodes at its genuine displayed dimensions',isDecodedNativeIcon(icon),icon);
  const owner=await timed('preview owner creation',10000,()=>call('plugins.create',{plugin:'thermal'}));
  const cmd=(operation,args={},id=owner.hash)=>call('plugins.command',{id,operation,args});
  const description=await call('plugins.describe',{plugin:'thermal'});
  check('numerical operation names are explicit rejection-only contracts',forbidden.every(id=>description.operations.some(o=>o.id===id&&o.readOnly&&!o.interruptible&&o.description.includes('Always rejects'))),description);
  const checkUI=async hash=>{await call('scene.select',{ids:[hash]});await page.locator('#tabAttributes').click();const state=await page.locator('#attrContent [data-plugin-action-button]').evaluateAll(els=>els.map(e=>({id:e.dataset.pluginActionButton,label:e.textContent,disabled:e.disabled})));check('native status is disabled and numerical actions are absent',state.some(a=>a.id==='status'&&a.disabled&&a.label==='Under construction')&&state.every(a=>!forbidden.includes(a.id)),state);};
  await checkUI(owner.hash);
  await timed('native Fan action',10000,async()=>{await page.locator('[data-plugin-action-button="create-fan"]').click();await call('scene.inspect');});
  const fan=(await inspect()).find(n=>n.type==='thermal_fan'),fanHash=fan?.hash;
  check('Fan action preserves 30 by 30 by 10 mm native default, reference and selection',fan?.selected&&fan.parent===owner.hash&&fan.params.Thermal===owner.hash&&equal(fan.matrix,fanFrame),fan);
  await checkUI(fanHash);
  const fanUI=await page.locator('#attrContent').evaluate(el=>({hidden:[...el.querySelectorAll('[data-field="Thermal"],[data-field="Direction"]')].length,pressure:el.querySelector('[data-field="Shutoff pressure"]')?.closest('.attr-row')?.querySelector('.attr-lab')?.textContent,freeFlow:!!el.querySelector('[data-field="Free flow"]')}));
  check('Fan UI hides internal owner and legacy direction while retaining native Pressure input',fanUI.hidden===0&&fanUI.pressure==='Pressure (Pa)'&&fanUI.freeFlow,fanUI);
  await page.locator('#attrContent [data-field="Shutoff pressure"]').fill('12.5');await page.locator('#attrContent [data-field="Shutoff pressure"]').press('Enter');await call('scene.inspect');
  check('Pressure label retains native field update and Undo binding',(await inspect()).find(n=>n.hash===fanHash).params['Shutoff pressure']===12.5);await call('edit.history',{action:'undo'});
  check('Pressure native Undo restores original value',(await inspect()).find(n=>n.hash===fanHash).params['Shutoff pressure']===0);
  const originalOwner=(await inspect()).find(n=>n.hash===owner.hash);
  await timed('immediate Fan transform targets only child',1500,()=>call('transform.set',{channel:'position',axis:0,value:-20,coordinates:'world'}));
  const moved=(await inspect()).find(n=>n.hash===fanHash),movedFrame=[...fanFrame];movedFrame[9]=-20;
  check('immediate Fan transform edits child rather than owner',equal(moved.matrix,movedFrame)&&equal((await inspect()).find(n=>n.hash===owner.hash).worldMatrix,originalOwner.worldMatrix),moved);
  await call('edit.history',{action:'undo'});check('Fan transform Undo',equal((await inspect()).find(n=>n.hash===fanHash).matrix,fanFrame));
  await call('edit.history',{action:'redo'});check('Fan transform Redo',equal((await inspect()).find(n=>n.hash===fanHash).matrix,movedFrame));await call('edit.history',{action:'undo'});
  let metadata=await cmd('fan-inputs',{},fanHash);check('Fan points along positive local X and is never solver eligible',equal(metadata.fan.directionLocal,[1,0,0])&&equal(metadata.fan.mapping.sizeMM,[30,30,10])&&!metadata.solverEligible&&!metadata.solverCoupled,metadata);
  await call('scene.update',{id:fanHash,params:{Direction:'Reverse'}});metadata=await cmd('fan-inputs',{},fanHash);check('Reverse points along negative local X',equal(metadata.fan.directionLocal,[-1,0,0]));
  await call('edit.history',{action:'undo'});await call('scene.select',{ids:[fanHash]});await call('transform.set',{channel:'rotation',axis:2,value:30,coordinates:'object'});metadata=await cmd('fan-inputs',{},fanHash);
  check('rotated Fan is ordinary authoring without claiming physical eligibility',metadata.fan.mapping.status==='unsupported-frame'&&Math.abs(Math.hypot(...metadata.fan.normalizedWorldAxis)-1)<1e-12&&!metadata.solverEligible,metadata);await call('edit.history',{action:'undo'});
  const probe=await cmd('create-probe');for(const hash of [owner.hash,fanHash,probe.hash])await checkUI(hash);
  const before=await inspect();
  await timed('all numerical calls reject without authoring mutation',1500,async()=>{
   for(const operation of forbidden){
    const result=await page.evaluate(captureAuthoringRejection,{id:operation==='measure'?probe.hash:owner.hash,operation,args:{deliberatelyUnsupported:true}});
    check(operation+' explicitly rejects',result.resolved===false&&result.code==='THERMAL_AUTHORING_ONLY',result);
   }
  });
  check('numerical rejections preserve native scene',equal(await inspect(),before));
  for(const hash of [owner.hash,fanHash,probe.hash]){const s=await cmd('status',{},hash);check('status exposes no field or measurement',s.authoringOnly&&s.state==='under-construction'&&!s.numericalAvailable&&!s.measurementAvailable&&!('temperature' in s),s);}

  const other=await call('plugins.create',{plugin:'thermal'}),wrong=await call('scene.create',{type:'group'});
  // Internal ownership no longer has an editable drop row. Keep its typed
  // native storage contract through API, Undo, HASH and owner remapping.
  for(const hash of [fanHash,probe.hash]){
   await checkUI(hash);check('Thermal helper hides internal owner from Attributes',await page.locator('#attrContent [data-field="Thermal"]').count()===0);
   await call('scene.update',{id:hash,params:{Thermal:other.hash}});let n=(await inspect()).find(n=>n.hash===hash);check('hidden reference stores canonical native hash independently from parent',n.params.Thermal===other.hash&&n.parent===owner.hash,n);
   const valid=JSON.stringify(n.params);let rejected=false;try{await call('scene.update',{id:hash,params:{Thermal:wrong.hash}});}catch{rejected=true;}
   n=(await inspect()).find(n=>n.hash===hash);check('hidden wrong-type reference rejects before mutation',rejected&&JSON.stringify(n.params)===valid,n);
   await call('scene.update',{id:hash,params:{Thermal:''}});check('internal reference clear remains unassigned',(await inspect()).find(n=>n.hash===hash).params.Thermal==='');
   await call('scene.update',{id:hash,params:{Thermal:owner.hash}});
  }
  await call('scene.delete',{ids:[other.hash,wrong.hash]});
  const beforeQueued=(await inspect()).map(n=>({hash:n.hash,matrix:n.matrix,worldMatrix:n.worldMatrix}));
  const queued=await timed('queued Fan creation and immediate transform',11500,()=>page.evaluate(async owner=>{const creation=frameAI.call('plugins.command',{id:owner,operation:'create-fan',args:{}});const move=frameAI.call('transform.set',{channel:'position',axis:1,value:2,coordinates:'world'});const [fan]=await Promise.all([creation,move]);return fan;},owner.hash));
  const queuedRow=(await inspect()).find(n=>n.hash===queued.hash),queuedFrame=[...fanFrame];queuedFrame[10]=2;
  check('queued Fan creation selects and transforms only its new child',queuedRow?.selected&&equal(queuedRow.matrix,queuedFrame),queuedRow);
  const afterQueued=await inspect();check('queued Fan transformation leaves earlier frames unchanged',beforeQueued.every(old=>{const n=afterQueued.find(n=>n.hash===old.hash);return equal(n?.matrix,old.matrix)&&equal(n?.worldMatrix,old.worldMatrix);}));
  await call('edit.history',{action:'undo'});check('queued Fan transform Undo restores exact default',equal((await inspect()).find(n=>n.hash===queued.hash).matrix,fanFrame));
  await call('edit.history',{action:'undo'});check('Fan creation takes one Undo checkpoint',!(await inspect()).some(n=>n.hash===queued.hash));
  await call('edit.history',{action:'redo'});check('Fan creation Redo restores explicit reference',(await inspect()).some(n=>n.hash===queued.hash&&n.params.Thermal===owner.hash));await call('scene.delete',{ids:[queued.hash]});
  const standalone=await call('plugins.create',{plugin:'thermal',type:'thermal_fan'});check('standalone Fan has native default with no inferred reference',equal((await inspect()).find(n=>n.hash===standalone.hash).matrix,fanFrame)&&standalone.params.Thermal==='');await call('scene.delete',{ids:[standalone.hash]});
  const savedRows=await inspect(),saved=await timed('preview native HASH export',3000,()=>call('scene.export',{includeData:true}));
  await timed('preview native HASH open',10000,()=>call('scene.open',{name:'thermal-authoring-preview.hash',base64:saved.base64}));
  for(const n of savedRows){const q=(await inspect()).find(q=>q.hash===n.hash);check('HASH preserves exact native frame/reference/parameters',q&&equal(q.matrix,n.matrix)&&equal(q.params,n.params)&&q.parent===n.parent,{before:n,after:q});}
  for(const kind of ['duplicate','clipboard','merge']){
   let copy;if(kind==='duplicate')copy=(await call('scene.duplicate',{ids:[owner.hash]})).objects.find(n=>n.type==='thermal');
   else if(kind==='clipboard'){await call('scene.select',{ids:[owner.hash]});await call('edit.copy');copy=(await call('edit.paste')).objects.find(n=>n.type==='thermal');}
   else{await page.route('**/thermal-preview-roundtrip.hash',route=>route.fulfill({body:Buffer.from(saved.base64,'base64'),contentType:'application/octet-stream'}));copy=(await call('scene.merge',{url:new URL('/thermal-preview-roundtrip.hash',page.url()).href})).objects.find(n=>n.type==='thermal');}
   const rows=await inspect();for(const type of ['thermal_fan','thermal_probe']){const child=rows.find(n=>n.type===type&&n.parent===copy?.hash);check(kind+' remaps native child reference to copied owner',!!copy&&copy.hash!==owner.hash&&child?.params.Thermal===copy.hash,{copy,child});const original=savedRows.find(n=>n.type===type);check(kind+' preserves child native frame and non-reference parameters',equal(child?.matrix,original.matrix)&&equal({...child.params,Thermal:original.params.Thermal},original.params),{original,child});}
   await call('scene.delete',{ids:[copy.hash]});
  }
  await call('scene.delete',{ids:[owner.hash]});await call('edit.history',{action:'undo'});const restoredRows=await inspect();check('delete Undo restores native helper identities and references',restoresAuthoringRows(restoredRows,savedRows,[owner.hash,fanHash,probe.hash]),{restoredRows,savedRows,expectedHashes:[owner.hash,fanHash,probe.hash]});
  const beforeFrames=await call('diagnostics.frame',{frames:6});await call('view.set',{index:0,single:true,focus:owner.hash});const afterFrames=await call('diagnostics.frame',{frames:12});
  check('native authoring helper CPU/GPU frame budget',hasBoundedFrameTimings(afterFrames),{beforeFrames,afterFrames});
  const gpu=await page.evaluate(async()=>{await frameEngine.renderer.device.queue.onSubmittedWorkDone();return {validation:(await frameEngine.renderer.device.popErrorScope())?.message||null,errors:__thermalPreviewGPU,lost:__thermalPreviewLost,numericalBuffers:__thermalPreviewBuffers.filter(s=>/^Thermal\s/.test(s))};});
  check('no numerical GPU allocations or error',!gpu.numericalBuffers.length&&!gpu.validation&&!gpu.errors.length&&!gpu.lost&&!errors.length,{gpu,errors});
  check('no numerical solver modules requested',requests.every(p=>['plugin.json','icon.svg','plugin.js'].some(n=>p==='/plugins/thermal/'+n)),requests);
  return {hardware,gpu,beforeFrames,afterFrames,requests,scope:'Current-core authoring preview only. No numerical qualification; full standard/stress/large-scene gates are not run by this harness.'};
 }finally{await context.close();}
}
export async function pluginChecks(page){
 const checks=[],timings=[],check=(name,pass,detail)=>{checks.push({name:'Thermal preview: '+name,pass:!!pass,detail});if(!pass)throw Error(name+': '+JSON.stringify(detail));};
 const timed=async(name,limit,fn)=>{const started=performance.now(),value=await fn(),ms=performance.now()-started;timings.push({name,ms,limit});check(name+' latency',ms<limit,{ms,limit});return value;};
 try{const preview=await authoringBrowserChecks(page,check,timed),probe=await nativeProbeBrowserChecks(page,check,timed),navigation=await helperNavigationChecks(page,check,timed);return {pass:true,checks,timings,evidence:{preview,probe,navigation},hardwareVerified:true};}catch(error){return {pass:false,checks,timings,error:error.stack,hardwareVerified:false};}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 let session,result;try{session=await launch({headless:process.argv.includes('--headless')});result=await pluginChecks(session.page);}catch(error){result={pass:false,checks:[],timings:[],hardwareVerified:false,error:error.stack};}finally{await session?.close();}
 result.sources={};for(const p of ['index.html','plugins/index.json','plugins/thermal/plugin.js','plugins/thermal/plugin.json','plugins/thermal/tests/authoring-browser.mjs','plugins/thermal/tests/native-probe-browser.mjs','plugins/thermal/tests/browser-gates.mjs','plugins/thermal/tests/navigation-browser.mjs','tools/browser.mjs'])result.sources[p]=createHash('sha256').update(await readFile(new URL('../../../'+p,import.meta.url))).digest('hex');
 await mkdir(new URL('../../../tests/results/',import.meta.url),{recursive:true});await writeFile(new URL('../../../tests/results/thermal-authoring-preview.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));process.exitCode=result.pass?0:1;
}
