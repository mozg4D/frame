import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../../../tools/browser.mjs';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const hardwareOK=h=>!!h&&h.isFallbackAdapter===false&&Object.values(h).some(v=>typeof v==='string'&&v)&&!/swiftshader|llvmpipe|lavapipe|software/i.test(JSON.stringify(h));
export async function pluginChecks(parent){
 const checks=[],timings=[],requests=[],errors=[];
 const check=(name,pass,detail)=>{checks.push({name:'CFD preview: '+name,pass:!!pass,detail});if(!pass)throw Error(name+': '+JSON.stringify(detail));};
 const timed=async(name,limit,fn)=>{const started=performance.now(),value=await fn(),ms=performance.now()-started;timings.push({name,ms,limit});check(name+' completed latency',ms<limit,{ms,limit});return value;};
 let context,page;
 try{
  context=await parent.context().browser().newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});page=await context.newPage();page.on('pageerror',e=>errors.push(e.stack));page.on('request',r=>{if(r.url().includes('/plugins/cfd/'))requests.push(new URL(r.url()).pathname);});await page.goto(parent.url());await ready(page);
  const hardware=await page.evaluate(()=>{const d=frameEngine.renderer.device;window.__cfdErrors=[];window.__cfdLost=null;d.addEventListener('uncapturederror',e=>__cfdErrors.push(e.error.message));d.lost.then(e=>__cfdLost={reason:e.reason,message:e.message});d.pushErrorScope('validation');return d.adapterInfo?Object.fromEntries(['vendor','architecture','device','description','isFallbackAdapter'].map(k=>[k,d.adapterInfo[k]])):null;});
  check('identifiable nonsoftware hardware WebGPU',hardwareOK(hardware),hardware);
  const call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]),rows=async()=>(await call('scene.inspect')).objects,cmd=(id,operation,args={})=>call('plugins.command',{id,operation,args});
  const initial=await rows();if(initial.length)await call('scene.delete',{ids:initial.filter(n=>!n.parent).map(n=>n.hash)});
  check('catalogue discovers CFD without executing runtime',(await call('plugins.list')).some(p=>p.id==='cfd'&&!p.loaded));
  check('lazy module not fetched before first use',!requests.includes('/plugins/cfd/plugin.js'),requests);
  await page.locator('#tabPlugins').click();const icon=await page.locator('[data-plugin="cfd"] img').evaluate(async img=>{await img.decode();const r=img.getBoundingClientRect();return {w:r.width,h:r.height,nw:img.naturalWidth,nh:img.naturalHeight,transform:getComputedStyle(img).transform};});
  check('native icon decodes at true 32 pixel size without scaling',icon.w===32&&icon.h===32&&icon.nw===32&&icon.nh===32&&icon.transform==='none',icon);
  const owners=await timed('three independent real icon creations',10000,async()=>{const result=[];for(let i=0;i<3;i++){await page.locator('#tabPlugins').click();await page.locator('[data-plugin="cfd"]').click();result.push((await rows()).find(n=>n.type==='cfd'&&n.selected));}return result;});
  check('repeated clicks each create a separate CFD owner',owners.every(Boolean)&&new Set(owners.map(n=>n.hash)).size===3,owners);
  const A=owners[0].hash,B=owners[1].hash,C=owners[2].hash;await call('scene.select',{ids:[A]});await page.locator('#tabAttributes').click();
  const controls=await page.locator('#attrContent [data-plugin-action-button]:visible').evaluateAll(els=>els.map(e=>({id:e.dataset.pluginActionButton,label:e.textContent,disabled:e.disabled})));
  check('a new box offers the native Frame solve',same(controls,[{id:'solve-frame',label:'Frame',disabled:false}]),controls);
  const labels=await page.locator('#attrContent .attr-lab:visible').allTextContents();check('physical inputs appear before computed fields',labels.some(s=>s.startsWith('Speed'))&&labels.some(s=>s.startsWith('Altitude'))&&!labels.some(s=>/Force|Result|Flow lines/.test(s)),labels);
  const fields=await call('fields.list',{owner:A}),speedMeta=fields.fields.find(f=>f.field==='param:Speed');check('common field adapter uses canonical speed units/range/access',speedMeta?.unit==='m/s'&&speedMeta.minimum===0&&speedMeta.access==='read-write',speedMeta);
  const fieldState=await call('fields.read',{owner:A,field:'param:Speed'});await timed('common field CAS authoring write',1500,()=>call('fields.write',{writes:[{owner:A,field:'param:Speed',value:22,epoch:fieldState.epoch,revision:fieldState.revision}]}));check('common field write reaches native CFD parameter',(await rows()).find(n=>n.hash===A).params.Speed===22);await call('edit.history',{action:'undo'});check('common field write uses ordinary Undo',(await rows()).find(n=>n.hash===A).params.Speed===20);
  const speed=page.locator('#attrContent input[data-field="Speed"]');await timed('native speed input',1500,async()=>{await speed.fill('31');await speed.press('Enter');await rows();});check('Speed uses native field without affecting another owner',(await rows()).find(n=>n.hash===A).params.Speed===31&&(await rows()).find(n=>n.hash===B).params.Speed===20);
  await call('edit.history',{action:'undo'});check('parameter Undo restores default',(await rows()).find(n=>n.hash===A).params.Speed===20);await call('edit.history',{action:'redo'});check('parameter Redo restores edit',(await rows()).find(n=>n.hash===A).params.Speed===31);
  await speed.fill('99');await speed.press('Escape');await rows();check('Escape abandons an interrupted numeric edit',(await rows()).find(n=>n.hash===A).params.Speed===31);
  await page.locator('#attrContent [data-field="Ground"][data-value="Road"]').click();await rows();check('Ground native choice',(await rows()).find(n=>n.hash===A).params.Ground==='Road');
  await page.locator('#attrContent [data-field="Medium"][data-value="Water"]').click();await rows();check('water uses its own properties and hides air controls',(await rows()).find(n=>n.hash===A).params.Medium==='Water'&&await page.locator('#attrContent [data-field="Ground"]:visible,#attrContent [data-field="Altitude"]:visible').count()===0);
  await timed('canonical native input update',1500,()=>call('scene.update',{id:A,params:{Altitude:120}}));
  const beforeReject=await rows();for(const params of [{Speed:-1},{Medium:'Oil'},{Ground:'Moving'}]){const rejected=await page.evaluate(async({id,params})=>{try{await frameAI.call('scene.update',{id,params});return false;}catch{return true;}},{id:A,params});check('invalid native input rejects '+JSON.stringify(params),rejected);}
  check('all invalid writes preserve authored scene',same(await rows(),beforeReject));
  const desc=await call('plugins.describe',{plugin:'cfd'});check('native flow and surface operations registered',['status','wall-motion','solve-frame','stop','results','probe','drag-map','pressure-map','separation-map'].every(id=>desc.operations.some(o=>o.id===id)),desc.operations);
  const badBudget=await page.evaluate(async id=>{try{await frameAI.call('plugins.command',{id,operation:'solve-frame',args:{fidelityBudget:'invalid'}});return false;}catch{return true;}},A);
  check('invalid fidelity rejected before work',badBudget);
  check('rejected numerical calls do not mutate scene',same(await rows(),beforeReject));
  for(const id of [A,B,C]){const s=await timed('CFD capabilities',1500,()=>cmd(id,'status'));check('idle status has no simulation or geometry result',!s.authoringOnly&&s.state==='dirty'&&s.solverAvailable&&!s.resultsAvailable&&s.geometryDiagnosticAvailable&&!s.geometryEvaluated&&s.registeredTags.length===0&&!('force' in s)&&!('pressure' in s),s);}
  const beforeTransform=(await rows()).find(n=>n.hash===A),otherBefore=(await rows()).find(n=>n.hash===B);
  await timed('ordinary box transform',1500,()=>call('transform.set',{channel:'rotation',axis:2,value:30,coordinates:'object'}));const rotated=(await rows()).find(n=>n.hash===A);check('rotation edits only selected native box',!same(rotated.matrix,beforeTransform.matrix)&&same((await rows()).find(n=>n.hash===B).matrix,otherBefore.matrix));
  await call('edit.history',{action:'undo'});check('transform Undo restores exact frame',same((await rows()).find(n=>n.hash===A).matrix,beforeTransform.matrix));await call('edit.history',{action:'redo'});check('transform Redo restores exact frame',same((await rows()).find(n=>n.hash===A).matrix,rotated.matrix));
  await call('scene.update',{id:A,visible:false});check('native visibility stores authoring state',(await rows()).find(n=>n.hash===A).visible===false);await call('scene.update',{id:A,visible:true});
  const duplicate=await timed('native box duplicate',3000,()=>call('scene.duplicate',{ids:[A]}));const copy=duplicate.objects.find(n=>n.type==='cfd');check('duplicate preserves parameters without sharing identity',copy&&copy.hash!==A&&same(copy.params,(await rows()).find(n=>n.hash===A).params),copy);await call('scene.delete',{ids:[copy.hash]});
  await call('animation.key',{id:A,path:'param:Speed',frame:0,value:20,interpolation:'hard'});await call('animation.key',{id:A,path:'param:Speed',frame:10,value:40,interpolation:'hard'});await timed('native parameter animation seek',1500,()=>call('animation.seek',{frame:5}));check('Speed is evaluated by existing native animation',(await rows()).find(n=>n.hash===A).params.Speed===30);
  const savedRows=await rows(),saved=await timed('native CFD HASH export',3000,()=>call('scene.export',{includeData:true}));await timed('native CFD HASH reopen',10000,()=>call('scene.open',{name:'cfd-authoring-preview.hash',base64:saved.base64}));
  for(const before of savedRows){const after=(await rows()).find(n=>n.hash===before.hash);check('HASH preserves native CFD identity/parameters/frame',!!after&&same(after.params,before.params)&&same(after.matrix,before.matrix)&&after.parent===before.parent,{before,after});}
  await call('animation.seek',{frame:10});check('animation survives HASH and never starts a solve',(await rows()).find(n=>n.hash===A).params.Speed===40&&(await cmd(A,'status')).state==='dirty');
  await timed('native box deletion',1500,()=>call('scene.delete',{ids:[B]}));await call('edit.history',{action:'undo'});check('delete Undo restores same CFD identity',(await rows()).some(n=>n.hash===B&&n.type==='cfd'));await call('edit.history',{action:'redo'});check('delete Redo removes CFD owner',!(await rows()).some(n=>n.hash===B));await call('edit.history',{action:'undo'});
  await call('scene.select',{ids:[A]});await page.locator('#tabAttributes').click();await call('view.set',{index:0,single:true,focus:A});await call('diagnostics.frame',{frames:6});const frames=await call('diagnostics.frame',{frames:12});check('bounded native helper CPU/GPU render timings',frames.timestampQueries===true&&frames.frames.length===12&&frames.frames.every(f=>Number.isFinite(f.cpuMs)&&Number.isFinite(f.gpuMs)&&f.cpuMs<50&&f.gpuMs<50),frames);
  await mkdir(new URL('../../../tests/results/',import.meta.url),{recursive:true});await page.screenshot({path:fileURLToPath(new URL('../../../tests/results/cfd-authoring-preview.png',import.meta.url))});
  check('production plugin loads only its installed assets',requests.every(p=>['plugin.json','icon.svg','plugin.js'].some(n=>p==='/plugins/cfd/'+n)),requests);
  const live=await page.evaluate(async()=>{const m=await import('/plugins/cfd/tests/m0/live-solve-check.mjs');return m.verifyLiveSolve();});
  check('native flow, surface probes, mode switching, cancellation and invalidation',live.pass,live);
  await page.exposeFunction('moveCFDTestPointer',(x,y)=>page.mouse.move(x,y));
  const hover=await page.evaluate(async()=>{const m=await import('/plugins/cfd/tests/m0/live-solve-check.mjs');return m.verifyLiveHover(frameEngine.renderer.device,window.moveCFDTestPointer);});
  check('cursor samples the visible native triangle and the winning region on overlap',hover.pass,hover);
  const gpu=await page.evaluate(async()=>{await frameEngine.renderer.device.queue.onSubmittedWorkDone();return {validation:(await frameEngine.renderer.device.popErrorScope())?.message||null,uncaptured:__cfdErrors,lost:__cfdLost};});check('native solver and maps have no GPU or page errors',!gpu.validation&&!gpu.uncaptured.length&&!gpu.lost&&!errors.length,{gpu,errors});
  return {pass:true,checks,timings,hardwareVerified:true,evidence:{hardware,gpu,frames,requests},scope:'Native CFD authoring, wall motion, finite-volume solve and surface observations.'};
 }catch(error){if(page)await page.screenshot({path:fileURLToPath(new URL('../../../tests/results/cfd-authoring-failure.png',import.meta.url))}).catch(()=>{});return {pass:false,checks,timings,error:error.stack,hardwareVerified:false};}finally{await context?.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 let session,result;try{session=await launch({headless:process.argv.includes('--headless')});result=await pluginChecks(session.page);}catch(error){result={pass:false,checks:[],timings:[],hardwareVerified:false,error:error.stack};}finally{await session?.close();}
 result.sources={};for(const p of ['index.html','plugins/index.json','plugins/cfd/plugin.js','plugins/cfd/plugin.json','plugins/cfd/icon.svg','plugins/cfd/tests/browser.mjs','tools/browser.mjs'])result.sources[p]=createHash('sha256').update(await readFile(new URL('../../../'+p,import.meta.url))).digest('hex');await mkdir(new URL('../../../tests/results/',import.meta.url),{recursive:true});await writeFile(new URL('../../../tests/results/cfd-authoring-preview.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));process.exitCode=result.pass?0:1;
}
