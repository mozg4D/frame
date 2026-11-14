import {launch,ready} from '../../../tools/browser.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const authored=n=>({hash:n.hash,type:n.type,parent:n.parent,params:n.params,matrix:n.matrix,tags:n.tags});
export async function pluginChecks(parent){
 const checks=[],timings=[],errors=[],consoleErrors=[];let context;
 const check=(name,pass,detail)=>{checks.push({name:'Optics: '+name,pass:!!pass,detail});if(!pass)throw Error(name+': '+JSON.stringify(detail));};
 const timed=async(name,limit,fn)=>{const start=performance.now(),value=await fn(),ms=performance.now()-start;timings.push({name,ms,limit});check(name+' latency',ms<limit,{ms,limit});return value;};
 try{
  context=await parent.context().browser().newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.stack));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
  await page.goto(parent.url());await ready(page);
  const hardware=await page.evaluate(()=>{const d=frameEngine.renderer.device;window.__opticsDevice=d;window.__opticsGPU=[];d.addEventListener('uncapturederror',e=>__opticsGPU.push(e.error.message));d.pushErrorScope('validation');return d.adapterInfo?Object.fromEntries(['vendor','architecture','device','description','isFallbackAdapter'].map(k=>[k,d.adapterInfo[k]])):null;});
  check('real hardware WebGPU without fallback',hardware&&hardware.isFallbackAdapter===false&&!!hardware.vendor&&!/swiftshader|llvmpipe|lavapipe|software|fallback/i.test([hardware.vendor,hardware.architecture,hardware.device,hardware.description].join(' ')),hardware);
  const call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]),rows=async()=>(await call('scene.inspect')).objects;
  const initial=await rows();if(initial.length)await call('scene.delete',{ids:initial.filter(n=>!n.parent).map(n=>n.hash)});
  check('lazy catalogue',(await call('plugins.list')).some(p=>p.id==='optics'&&!p.loaded));
  await page.locator('#tabPlugins').click();const button=page.locator('[data-plugin="optics"]');check('unfinished catalogue title',await button.getAttribute('title')==='Optics (unfinished)');
  const icon=await button.locator('img').evaluate(async img=>{await img.decode();const r=img.getBoundingClientRect();return [img.naturalWidth,img.naturalHeight,r.width,r.height];});check('native 32px artwork',equal(icon,[32,32,32,32]),icon);
  await timed('first native owner',10000,async()=>{await button.click();await call('scene.inspect');});const owner=(await rows()).find(n=>n.type==='optics');check('native owner selected',owner?.selected,owner);
  const cmd=(operation,args={},id=owner.hash)=>call('plugins.command',{id,operation,args});
  await page.locator('#tabAttributes').click();check('Unfinished disabled',await page.locator('[data-plugin-action-button="status"]').isDisabled());
  await timed('real Subject button',5000,async()=>{await page.locator('[data-plugin-group="Add plane"] button').filter({hasText:'Subject'}).click();await call('scene.inspect');});
  const subject=(await rows()).find(n=>n.type==='optics_subject');check('Subject separate selected owner-linked native plane',subject?.selected&&subject.parent===owner.hash&&subject.params.Optics===owner.hash,subject);
  const sensor=await timed('Sensor creation',3000,()=>cmd('create-sensor')),source=await timed('Source creation',3000,()=>cmd('create-source')),target=await timed('Target creation',3000,()=>cmd('create-target'));
  await timed('explicit typed links',1500,async()=>{await call('scene.update',{id:subject.hash,params:{Sensor:sensor.hash}});await call('scene.update',{id:source.hash,params:{Target:target.hash}});});
  const other=await call('plugins.create',{plugin:'optics'}),foreign=await cmd('create-sensor',{},other.hash);
  const rejects=async(name,args)=>page.evaluate(async([name,args])=>{try{await frameAI.call(name,args);return null;}catch(e){return e.code||e.message;}},[name,args]);
  const beforeInvalid=(await rows()).map(authored);check('cross-task links reject',!!await rejects('scene.update',{id:subject.hash,params:{Sensor:foreign.hash}}));check('invalid reference leaves authoring unchanged',equal(beforeInvalid,(await rows()).map(authored)));
  check('linked receiver cannot cross tasks',!!await rejects('scene.update',{id:sensor.hash,params:{Optics:other.hash}}));
  await call('scene.select',{ids:[subject.hash]});await page.locator('#tabAttributes').click();
  await timed('Subject Infinity authoring',1500,()=>call('scene.update',{id:subject.hash,params:{Distance:'Infinity'}}));check('Infinity hides finite Depth inputs',await page.locator('#attrContent [data-field="Depth min"]').count()===0&&await page.locator('#attrContent [data-field="Horizontal field"]').count()===1);
  await call('scene.update',{id:subject.hash,params:{Distance:'Finite','Depth min':-10,'Depth max':10}});check('finite range validates before mutation',!!await rejects('scene.update',{id:subject.hash,params:{'Depth min':20}}));
  await timed('native plane transform',1500,()=>call('transform.set',{channel:'position',axis:0,value:35,coordinates:'world'}));check('native plane independent translation',(await rows()).find(n=>n.hash===subject.hash).worldMatrix[12]===35);
  await call('edit.history',{action:'undo'});check('native transform Undo',(await rows()).find(n=>n.hash===subject.hash).worldMatrix[12]===0);await call('edit.history',{action:'redo'});
  const cube=await call('scene.create',{type:'cube'});await timed('native Blocker tag',1500,()=>call('tag.set',{ids:[cube.hash],kind:'optics_blocker',enabled:true}));
  await timed('native Optical tag',1500,()=>call('tag.set',{ids:[cube.hash],kind:'optics_optical',enabled:true,params:{Model:'Mirror surface'}}));
  const tags=(await call('tag.read',{ids:[cube.hash],kind:'optics_optical'})).objects[0].tags;check('native Optical categories retained',tags.length===1&&tags[0].params.Model==='Mirror surface'&&tags[0].params.Coating==='None',tags);
  await call('edit.history',{action:'undo'});check('tag native Undo removes new tag',(await call('tag.read',{ids:[cube.hash],kind:'optics_optical'})).objects[0].tags.length===0);await call('edit.history',{action:'redo'});
  check('unknown optical preset rejects',!!await rejects('tag.set',{ids:[cube.hash],kind:'optics_optical',enabled:true,params:{Model:'Magic glass'}}));
  const before=(await rows()).map(authored),saved=await timed('HASH export',5000,()=>call('scene.export',{includeData:true}));
  await timed('HASH reopen',10000,()=>call('scene.open',{name:'optics-authoring.hash',base64:saved.base64}));check('HASH preserves all roles links tags and transforms',equal(before,(await rows()).map(authored)));
  for(const mode of ['duplicate','clipboard','merge']){
   let copy;if(mode==='duplicate')copy=(await call('scene.duplicate',{ids:[owner.hash]})).objects.find(n=>n.type==='optics');
   else if(mode==='clipboard'){await call('scene.select',{ids:[owner.hash]});await call('edit.copy');copy=(await call('edit.paste')).objects.find(n=>n.type==='optics');}
   else{await page.route('**/optics-roundtrip.hash',r=>r.fulfill({body:Buffer.from(saved.base64,'base64'),contentType:'application/octet-stream'}));const existing=new Set((await rows()).map(n=>n.hash));await call('scene.merge',{url:new URL('/optics-roundtrip.hash',page.url()).href});const added=(await rows()).filter(n=>!existing.has(n.hash));copy=added.find(n=>n.type==='optics'&&added.some(q=>q.type==='optics_subject'&&q.parent===n.hash));}
   const children=(await rows()).filter(n=>n.parent===copy.hash),s=children.find(n=>n.type==='optics_subject'),r=children.find(n=>n.type==='optics_sensor');check(mode+' remaps all internal native links',s?.params.Optics===copy.hash&&s.params.Sensor===r?.hash&&copy.hash!==owner.hash,{copy,s,r});await call('scene.delete',{ids:[copy.hash]});
  }
  const state=await cmd('status');check('no scene calculation or invented output',state.state==='unfinished'&&!state.sceneSolverAvailable&&!state.optimizerAvailable&&state.measuredPower===null&&state.calculatedImage===null,state);
  const beforeUnavailable=(await rows()).map(authored);await timed('unavailable commands reject',2000,async()=>{for(const operation of ['solve','optimize','stop','create-result','to-mesh','results'])check(operation+' explicit rejection',await rejects('plugins.command',{id:owner.hash,operation,args:{}})==='OPTICS_AUTHORING_ONLY');});check('unavailable commands do not mutate',equal(beforeUnavailable,(await rows()).map(authored)));
  await call('scene.delete',{ids:[sensor.hash]});check('deleted receiver is diagnosed, not reconnected',(await cmd('inspect',{},subject.hash)).issues.some(i=>i.code==='INVALID_ARGUMENT'));await call('edit.history',{action:'undo'});
  await call('scene.select',{ids:[owner.hash]});await call('view.set',{index:0,single:true,focus:owner.hash});await call('diagnostics.frame',{frames:6});check('native gizmo uses shared bounds',await page.evaluate(()=>!!frameEngine.gizmoState?.handles.length));
  const frames=await timed('12 rendered frames',10000,()=>call('diagnostics.frame',{frames:12}));check('small scene frame budget',frames.frames.length===12&&frames.frames.every(f=>Number.isFinite(f.cpuMs)&&Number.isFinite(f.gpuMs)&&f.cpuMs<16.7&&f.gpuMs<16.7),frames);
  const gpu=await page.evaluate(async()=>{const d=frameEngine.renderer.device;await d.queue.onSubmittedWorkDone();return {sameDevice:d===__opticsDevice,validation:(await d.popErrorScope())?.message||null,errors:__opticsGPU};});check('shared device and no validation/page errors',gpu.sameDevice&&!gpu.validation&&!gpu.errors.length&&!errors.length&&!consoleErrors.length,{gpu,errors,consoleErrors});
  return {pass:true,checks,timings,hardwareVerified:true,evidence:{hardware,frames,gpu},scope:'Native authoring only; viewport edge picking, scene optical Solve, optimization and physical results are not qualified.'};
 }catch(error){return {pass:false,checks,timings,error:error.stack,hardwareVerified:false};}finally{await context?.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 let session,result;try{session=await launch({headless:process.argv.includes('--headless')});await ready(session.page);result=await pluginChecks(session.page);}catch(e){result={pass:false,checks:[],timings:[],error:e.stack,hardwareVerified:false};}finally{await session?.close();}
 result.sources={};for(const p of ['index.html','plugins/index.json','plugins/optics/plugin.js','plugins/optics/plugin.json','plugins/optics/tests/index.mjs'])result.sources[p]=createHash('sha256').update(await readFile(new URL('../../../'+p,import.meta.url))).digest('hex');
 await mkdir(new URL('../../../tests/results/',import.meta.url),{recursive:true});await writeFile(new URL('../../../tests/results/optics-authoring-preview.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));process.exitCode=result.pass?0:1;
}
