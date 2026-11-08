import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../../../tools/browser.mjs';
import {isHardwareAdapter,isDecodedNativeIcon,hasBoundedFrameTimings} from './browser-gates.mjs';
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const unavailable=['show-voxels','solve-frame','solve-animation','optimize-frame','optimize-animation','result-object'];
const authoring=n=>({hash:n.hash,type:n.type,parent:n.parent,params:n.params,matrix:n.matrix,tags:n.tags});
export async function pluginChecks(parent){
 const checks=[],timings=[],errors=[],consoleErrors=[],requests=[];
 const check=(name,pass,detail)=>{checks.push({name:'Structural preview: '+name,pass:!!pass,detail});if(!pass)throw Error(name+': '+JSON.stringify(detail));};
 const timed=async(name,limit,fn)=>{const start=performance.now(),r=await fn(),ms=performance.now()-start;timings.push({name,ms,limit});check(name+' completed latency',ms<limit,{ms,limit});return r;};
 const context=await parent.context().browser().newContext({viewport:{width:1280,height:900},serviceWorkers:'block'}),page=await context.newPage();
 let evidence={};
 page.on('pageerror',e=>errors.push(e.stack));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});page.on('request',r=>{if(r.url().includes('/plugins/structural/'))requests.push(new URL(r.url()).pathname);});
 try{
  await page.goto(parent.url());await ready(page);
  const hardware=await page.evaluate(()=>{const d=frameEngine.renderer.device;window.__structuralErrors=[];window.__structuralLost=null;d.addEventListener('uncapturederror',e=>__structuralErrors.push(e.error.message));d.lost.then(e=>__structuralLost={reason:e.reason,message:e.message});d.pushErrorScope('validation');return d.adapterInfo?Object.fromEntries(['vendor','architecture','device','description','isFallbackAdapter'].map(k=>[k,d.adapterInfo[k]])):null;});
  check('requires identifiable real hardware without fallback',isHardwareAdapter(hardware),hardware);
  const call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]),inspect=async()=>(await call('scene.inspect')).objects;
  const rows=await inspect();if(rows.length)await call('scene.delete',{ids:rows.filter(n=>!n.parent).map(n=>n.hash)});
  const plugins=await call('plugins.list');check('installed catalogue remains lazy',plugins.some(p=>p.id==='structural'&&!p.loaded),plugins);
  const tags=await call('tag.list');check('only fieldless Fixture and Preserve markers are registered',equal(tags.filter(t=>t.plugin==='structural').map(t=>t.kind),['structural_fixture','structural_preserve']),tags);
  await page.locator('#tabPlugins').click();
  const icon=await page.locator('[data-plugin="structural"] img').evaluate(async img=>{await img.decode();const r=img.getBoundingClientRect();return {decoded:true,complete:img.complete,width:img.width,height:img.height,naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,rect:{width:r.width,height:r.height}};});
  check('icon decodes at genuine native 32 px dimensions',isDecodedNativeIcon(icon),icon);
  await timed('first native icon creation',10000,async()=>{await page.locator('[data-plugin="structural"]').click();await call('scene.inspect');});
  let owner=(await inspect()).find(n=>n.type==='structural');check('first native owner is selected',owner?.selected,owner);
  await timed('second native icon creation',3000,async()=>{await page.locator('#tabPlugins').click();await page.locator('[data-plugin="structural"]').click();await call('scene.inspect');});
  const owners=(await inspect()).filter(n=>n.type==='structural');check('repeated icons create independent owners',owners.length===2&&owners[0].hash!==owners[1].hash,owners);
  owner=owners[1];const other=owners[0],cmd=(operation,args={},id=owner.hash)=>call('plugins.command',{id,operation,args});
  await call('scene.select',{ids:[owner.hash]});await page.locator('#tabAttributes').click();
  const actions=await page.locator('#attrContent [data-plugin-action-button]').evaluateAll(es=>es.map(e=>({id:e.dataset.pluginActionButton,label:e.textContent,disabled:e.disabled})));
  check('only disabled Under construction action is exposed',equal(actions,[{id:'status',label:'Under construction',disabled:true}]),actions);
  const materialLabel=(await page.locator('#attrContent .attr-lab').allTextContents()).filter(t=>t.includes('Material')).join('');check('percentage label has no duplicated unit',materialLabel==='Material (%)',materialLabel);
  const description=await call('plugins.describe',{plugin:'structural'});check('numerical APIs are explicit read-only rejection contracts',unavailable.every(id=>description.operations.some(o=>o.id===id&&o.readOnly&&!o.interruptible&&o.description.includes('Rejects before'))),description);
  await timed('native authoring field edit',1500,async()=>{await page.locator('#attrContent input[data-field="Voxel size"]').fill('2.5');await page.locator('#attrContent input[data-field="Voxel size"]').press('Enter');await call('scene.inspect');});
  check('native Attributes update authoring only',(await inspect()).find(n=>n.hash===owner.hash).params['Voxel size']===2.5);
  const prior=(await inspect()).find(n=>n.hash===owner.hash).params;
  await call('scene.update',{id:owner.hash,params:{'Material (%)':42,Displacement:0}});check('native settings edit',equal((await inspect()).find(n=>n.hash===owner.hash).params,{...prior,'Material (%)':42,Displacement:0}));
  await call('edit.history',{action:'undo'});check('native parameter Undo',equal((await inspect()).find(n=>n.hash===owner.hash).params,prior));await call('edit.history',{action:'redo'});
  for(const params of [{'Voxel size':0},{'Material (%)':101},{Displacement:-1}]){
   const before=(await inspect()).map(authoring);let rejected=false;try{await call('scene.update',{id:owner.hash,params});}catch{rejected=true;}check('invalid native scalar rejects atomically',rejected&&equal((await inspect()).map(authoring),before),params);
  }
  await timed('native box transform',1500,()=>call('transform.set',{channel:'size',axis:0,value:200,coordinates:'object'}));
  let transformed=(await inspect()).find(n=>n.hash===owner.hash);check('native scale changes box frame without duplicate Size params',transformed.matrix[0]===2&&!Object.keys(transformed.params).some(k=>k.startsWith('Size')),transformed);
  check('other Structural owner stays unchanged',equal((await inspect()).find(n=>n.hash===other.hash).matrix,other.matrix));
  await call('edit.history',{action:'undo'});check('native transform Undo',equal((await inspect()).find(n=>n.hash===owner.hash).matrix,owner.matrix));await call('edit.history',{action:'redo'});
  const group=await call('scene.create',{type:'group'});
  await timed('native marker assignment',1500,async()=>{for(const kind of ['structural_fixture','structural_preserve'])await call('tag.set',{ids:[group.hash],kind,enabled:true});});
  let tagged=(await inspect()).find(n=>n.hash===group.hash);check('markers coexist with stable UIDs and no pretend parameters',tagged.tags.length===2&&tagged.tags.every(t=>t.uid&&equal(t.params,{})),tagged.tags);
  const markerUID=tagged.tags.find(t=>t.kind==='structural_preserve').uid;
  await timed('native marker removal',1500,()=>call('tag.set',{ids:[group.hash],kind:'structural_preserve',enabled:false}));check('remove affects only its marker',(await inspect()).find(n=>n.hash===group.hash).tags.length===1);
  await call('edit.history',{action:'undo'});check('marker Undo restores identity',(await inspect()).find(n=>n.hash===group.hash).tags.some(t=>t.uid===markerUID));
  const copy=await timed('native marker duplicate',1500,()=>call('scene.duplicate',{ids:[group.hash]}));
  const duplicated=copy.objects.find(n=>n.type==='group');check('duplicate preserves native marker payload in its separate owner namespace',duplicated&&duplicated.hash!==group.hash&&equal(duplicated.tags,tagged.tags),duplicated);await call('tag.set',{ids:[duplicated.hash],kind:'structural_preserve',enabled:false});check('duplicate marker mutation leaves original owner unchanged',equal((await inspect()).find(n=>n.hash===group.hash).tags,tagged.tags)&&(await inspect()).find(n=>n.hash===duplicated.hash).tags.length===1);await call('edit.history',{action:'undo'});check('duplicate marker Undo restores its own payload',equal((await inspect()).find(n=>n.hash===duplicated.hash).tags,tagged.tags));
  const beforeReject=(await inspect()).map(authoring);
  await timed('all numerical APIs reject',1500,async()=>{for(const operation of unavailable){const rejected=await page.evaluate(async({id,operation})=>{try{await frameAI.call('plugins.command',{id,operation,args:{deliberatelyUnsupported:true}});return {resolved:true};}catch(e){return {resolved:false,code:e.code};}},{id:owner.hash,operation});check(operation+' cannot publish a pretend calculation',!rejected.resolved&&rejected.code==='STRUCTURAL_AUTHORING_ONLY',rejected);}});
  check('numerical rejections do not mutate authoring',equal((await inspect()).map(authoring),beforeReject));
  await timed('independent native status reads',1500,async()=>{for(const id of [owner.hash,other.hash]){const s=await cmd('status',{},id);check('independent owners explicitly report no numerical result',s.authoringOnly&&!s.numericalAvailable&&!s.sceneSolved&&!s.voxelizationAvailable&&!s.resultAvailable&&!s.parameterTagsAvailable,s);}});
  const savedRows=(await inspect()).map(authoring),saved=await timed('native preview HASH export',3000,()=>call('scene.export',{includeData:true}));
  await timed('native preview HASH reopen',10000,()=>call('scene.open',{name:'structural-authoring-preview.hash',base64:saved.base64}));
  check('HASH retains exact native owners, frames, settings and marker instances',equal((await inspect()).map(authoring),savedRows),{before:savedRows,after:(await inspect()).map(authoring)});
  const target=owner.hash;await call('scene.delete',{ids:[target]});await call('edit.history',{action:'undo'});check('delete Undo restores owner authoring',equal(authoring((await inspect()).find(n=>n.hash===target)),savedRows.find(n=>n.hash===target)));
  await call('scene.select',{ids:[owner.hash]});await page.locator('#tabAttributes').click();await call('view.set',{index:0,single:true,focus:owner.hash});await call('diagnostics.frame',{frames:6});
  const frames=await call('diagnostics.frame',{frames:12});check('native helper CPU/GPU frame budget',hasBoundedFrameTimings(frames),frames);
  const gpu=await page.evaluate(async()=>{await frameEngine.renderer.device.queue.onSubmittedWorkDone();return {validation:(await frameEngine.renderer.device.popErrorScope())?.message||null,uncaptured:__structuralErrors,lost:__structuralLost};});
  check('no native GPU, JavaScript or console errors',!gpu.validation&&!gpu.uncaptured.length&&!gpu.lost&&!errors.length&&!consoleErrors.length,{gpu,errors,consoleErrors});
  check('no numerical prototype module is requested',requests.every(p=>['plugin.json','icon.svg','plugin.js'].some(n=>p==='/plugins/structural/'+n)),requests);
  await mkdir(new URL('../../../tests/results/',import.meta.url),{recursive:true});await page.screenshot({path:fileURLToPath(new URL('../../../tests/results/structural-authoring-preview.png',import.meta.url))});
  evidence={hardware,gpu,frames,requests,scope:'Current-core authoring only. No voxelizer, FEM, contact, topology optimization, standard/stress or 100M-scene qualification.'};
  return {pass:true,checks,timings,evidence,hardwareVerified:true};
 }catch(e){return {pass:false,checks,timings,evidence,errors,consoleErrors,error:e.stack,hardwareVerified:false};}finally{await context.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 let session,result;try{session=await launch({headless:process.argv.includes('--headless')});result=await pluginChecks(session.page);}catch(e){result={pass:false,checks:[],timings:[],hardwareVerified:false,error:e.stack};}finally{await session?.close();}
 result.sources={};for(const p of ['index.html','plugins/index.json','plugins/structural/plugin.json','plugins/structural/plugin.js','plugins/structural/icon.svg','plugins/structural/tests/authoring-browser.mjs','plugins/structural/tests/browser-gates.mjs','tools/browser.mjs'])result.sources[p]=createHash('sha256').update(await readFile(new URL('../../../'+p,import.meta.url))).digest('hex');
 await mkdir(new URL('../../../tests/results/',import.meta.url),{recursive:true});await writeFile(new URL('../../../tests/results/structural-authoring-preview.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));process.exitCode=result.pass?0:1;
}
