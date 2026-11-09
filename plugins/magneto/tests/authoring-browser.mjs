import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../../../tools/browser.mjs';
import {tagFieldBrowserChecks} from '../../../tests/plugin-tag-fields-browser.mjs';
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const authored=n=>({hash:n.hash,type:n.type,parent:n.parent,params:n.params,matrix:n.matrix,tags:n.tags});
export async function pluginChecks(parent){
 const checks=[],timings=[],errors=[],consoleErrors=[],requests=[];
 const check=(name,pass,detail)=>{checks.push({name:'Magneto: '+name,pass:!!pass,detail});if(!pass)throw Error(name+': '+JSON.stringify(detail));};
 const timed=async(name,limit,fn)=>{const start=performance.now(),r=await fn(),ms=performance.now()-start;timings.push({name,ms,limit});check(name+' completed latency',ms<limit,{ms,limit});return r;};
 const requestedDPR=Number(process.env.FRAME_DPR||await parent.evaluate(()=>devicePixelRatio));
 if(![1,2].includes(requestedDPR))throw Error('Magneto focused gate supports FRAME_DPR=1 or 2.');
 const context=await parent.context().browser().newContext({viewport:{width:1280,height:900},deviceScaleFactor:requestedDPR,serviceWorkers:'block'}),page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.stack));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});page.on('request',r=>{if(r.url().includes('/plugins/magneto/'))requests.push(new URL(r.url()).pathname);});
 let hardware,actualDPR=null;
 try{
  await page.goto(parent.url());await ready(page);
  actualDPR=await page.evaluate(()=>devicePixelRatio);check('actual device pixel ratio matches requested gate',actualDPR===requestedDPR,{requestedDPR,actualDPR});
  hardware=await page.evaluate(()=>{const d=frameEngine.renderer.device;window.__magnetoDevice=d;window.__magnetoErrors=[];window.__magnetoLost=null;d.addEventListener('uncapturederror',e=>__magnetoErrors.push(e.error.message));d.lost.then(e=>__magnetoLost={reason:e.reason,message:e.message});d.pushErrorScope('validation');return d.adapterInfo?Object.fromEntries(['vendor','architecture','device','description','isFallbackAdapter'].map(k=>[k,d.adapterInfo[k]])):null;});
  check('real LAB NVIDIA Ampere hardware, no fallback',hardware&&hardware.isFallbackAdapter===false&&/nvidia/i.test(JSON.stringify(hardware))&&/ampere/i.test(JSON.stringify(hardware))&&!/swiftshader|llvmpipe|lavapipe|software/i.test(JSON.stringify(hardware)),hardware);
  const call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]),inspect=async()=>(await call('scene.inspect')).objects;
  const initial=await inspect();if(initial.length)await call('scene.delete',{ids:initial.filter(n=>!n.parent).map(n=>n.hash)});
  check('lazy catalogue',(await call('plugins.list')).some(p=>p.id==='magneto'&&!p.loaded));
  await page.locator('#tabPlugins').click();
  check('visible unfinished catalogue',await page.locator('[data-plugin="magneto"]').getAttribute('title')==='Magneto (unfinished)');
  await timed('first native plane',10000,async()=>{await page.locator('[data-plugin="magneto"]').click();await call('scene.inspect');});
  const first=(await inspect()).find(n=>n.type==='magneto');
  await timed('second native plane',3000,()=>call('plugins.create',{plugin:'magneto'}));
  const owners=(await inspect()).filter(n=>n.type==='magneto'),owner=owners.find(n=>n.hash!==first.hash);
  check('independent native owners',owners.length===2&&owner.selected,owners);
  const cmd=operation=>call('plugins.command',{id:owner.hash,operation,args:{}});
  const action=id=>page.locator('[data-plugin-action-button="'+id+'"]');
  await call('scene.select',{ids:[owner.hash]});await page.locator('#tabAttributes').click();
  check('visible unfinished notice',await action('status').isDisabled()&&await action('status').textContent()==='Unfinished');
  check('solve disabled',await action('solve-frame').isDisabled()&&await action('solve-animation').isDisabled());
  check('Mode is first native plugin row',(await page.locator('#attrContent [data-plugin-action-row]').first().getAttribute('data-plugin-action-row'))==='Mode');
  await timed('native Current Density mode',1500,async()=>{await action('mode-current-density').click();await call('scene.inspect');});
  const input=page.locator('#attrContent input[data-field="Current Density"]');
  await timed('signed density edit',1500,async()=>{await input.fill('-12');await input.press('Enter');await call('scene.inspect');});
  check('negative signed density persisted',(await inspect()).find(n=>n.hash===owner.hash).params['Current Density']===-12);
  check('other owner unchanged',(await inspect()).find(n=>n.hash===first.hash).params['Current Density']===0);
  await call('edit.history',{action:'undo'});check('native scalar Undo',(await inspect()).find(n=>n.hash===owner.hash).params['Current Density']===0);await call('edit.history',{action:'redo'});
  await call('animation.key',{id:owner.hash,path:'param:Current Density',frame:0,value:-12,interpolation:'hard'});
  await call('animation.key',{id:owner.hash,path:'param:Current Density',frame:20,value:12,interpolation:'hard'});
  await call('animation.seek',{frame:10});check('signed native animation crosses zero',Math.abs((await inspect()).find(n=>n.hash===owner.hash).params['Current Density'])<1e-6);
  await call('animation.seek',{frame:0});await action('mode-solve').click();await call('scene.inspect');
  await timed('native visualization choice',1500,async()=>{await action('view-saturation-section').click();await call('scene.inspect');});
  check('exactly one view pressed',await page.locator('[data-plugin-action-button^="view-"][aria-pressed="true"]').count()===1);
  check('selected combination stored',(await inspect()).find(n=>n.hash===owner.hash).params.Quantity==='Saturation');
  await timed('repeated native mode and view actions',5000,async()=>{for(let i=0;i<3;i++){await action('mode-current-density').click();await call('scene.inspect');await action('mode-solve').click();await call('scene.inspect');for(const id of ['view-b-strokes','view-h-section','view-magnetization-strokes','view-saturation-section']){await action(id).click();await call('scene.inspect');}}});
  const beforeReject=(await inspect()).map(authored);
  await timed('all numerical actions reject',1500,async()=>{for(const operation of ['solve-frame','solve-animation','force','torque','reset-magnetization']){const code=await page.evaluate(async({id,operation})=>{try{await frameAI.call('plugins.command',{id,operation,args:{}});return null;}catch(e){return e.code;}},{id:owner.hash,operation});check(operation+' unavailable',code==='MAGNETO_AUTHORING_ONLY',code);}});
  check('rejection does not mutate',equal(beforeReject,(await inspect()).map(authored)));
  const invalidArgs=await page.evaluate(async id=>{try{await frameAI.call('plugins.command',{id,operation:'mode-current-density',args:{unexpected:true}});return false;}catch{return true;}},owner.hash);
  check('invalid operation arguments reject atomically',invalidArgs&&equal(beforeReject,(await inspect()).map(authored)));
  const status=await cmd('status');check('no physics or results',status.state==='unfinished'&&!status.physicsAvailable&&!status.resultAvailable&&!status.curvesAvailable,status);
  const cube=await call('scene.create',{type:'cube'});await timed('native Material tag assignment',1500,()=>call('tag.set',{ids:[cube.hash],kind:'magneto',enabled:true}));
  const tagged=(await inspect()).find(n=>n.hash===cube.hash),tag=tagged.tags.find(t=>t.kind==='magneto');
  check('shared tag bridge retains Material',tag?.params.Material==='Electrical Steel M19'&&Object.keys(tag.params).length===1,tag);
  await page.locator('.ob-tag.magneto').first().click();await page.locator('#tabAttributes').click();
  check('tag has exactly one Material row',equal(await page.locator('#attrContent [data-field]').evaluateAll(es=>es.map(e=>e.dataset.field)),['Material']));
  await timed('native tag Material UI',1500,async()=>{await page.locator('#attrContent [data-field="Material"]').press('ArrowRight');await call('scene.inspect');});
  check('native tag choice changes Material',(await inspect()).find(n=>n.hash===cube.hash).tags.find(t=>t.kind==='magneto').params.Material==='Electrical Steel M27');
  await call('edit.history',{action:'undo'});check('tag choice Undo',(await inspect()).find(n=>n.hash===cube.hash).tags.find(t=>t.kind==='magneto').params.Material==='Electrical Steel M19');await call('edit.history',{action:'redo'});
  const material=await call('material.create',{name:'Magneto preservation fixture',params:{h:30,s:60,l:50}});
  const materialGroup=await call('scene.create',{type:'group'});await call('material.assign',{id:materialGroup.hash,material:material.uid});
  const inherited=await call('scene.create',{type:'cube'});await call('scene.update',{id:inherited.hash,parent:materialGroup.hash});
  await call('material.assign',{id:cube.hash,material:material.uid});
  const explicitBefore=(await inspect()).find(n=>n.hash===cube.hash).tags.filter(t=>t.kind==='material'),parentBefore=(await inspect()).find(n=>n.hash===materialGroup.hash).tags;
  await call('tag.set',{ids:[inherited.hash],kind:'magneto',enabled:true});await call('diagnostics.frame',{frames:3});
  check('explicit material remains unchanged',equal(explicitBefore,(await inspect()).find(n=>n.hash===cube.hash).tags.filter(t=>t.kind==='material')));
  check('inherited material remains on parent without child material mutation',equal(parentBefore,(await inspect()).find(n=>n.hash===materialGroup.hash).tags)&&!(await inspect()).find(n=>n.hash===inherited.hash).tags.some(t=>t.kind==='material'));
  const polygonIds=[];
  for(let i=0;i<2;i++){
    let polygon=await call('scene.create',{type:'cube'});
    for(let step=0;step<3&&polygon.type!=='mesh';step++)polygon=await call('scene.convert',{id:polygon.hash});
    check('generic bridge fixture is editable polygons',polygon.type==='mesh',polygon.type);
    await call('scene.update',{id:polygon.hash,parent:materialGroup.hash});polygonIds.push(polygon.hash);
  }
  await call('material.assign',{id:polygonIds[0],material:material.uid});
  const tagGate=await tagFieldBrowserChecks(page,polygonIds);
  checks.push(...tagGate.checks.map(name=>({name:'Generic tag bridge: '+name,pass:true})));timings.push(...tagGate.timings);
  await call('animation.seek',{frame:0});
  await call('scene.select',{ids:[owner.hash]});await timed('native plane transform',1500,()=>call('transform.set',{channel:'size',axis:0,value:200,coordinates:'object'}));
  check('plane size uses native frame',(await inspect()).find(n=>n.hash===owner.hash).matrix[0]===2);
  const group=await call('scene.create',{type:'group'});await call('scene.update',{id:owner.hash,parent:group.hash});
  const before=(await inspect()).map(authored),saved=await timed('native HASH export',5000,()=>call('scene.export',{includeData:true}));
  await timed('native HASH reopen',10000,()=>call('scene.open',{name:'magneto-preview.hash',base64:saved.base64}));
  check('HASH preserves native planes hierarchy tags values frames',equal(before,(await inspect()).map(authored)));
  await call('scene.delete',{ids:[owner.hash]});await call('edit.history',{action:'undo'});check('delete Undo restores owner',equal(authored((await inspect()).find(n=>n.hash===owner.hash)),before.find(n=>n.hash===owner.hash)));
  await call('scene.select',{ids:[owner.hash]});await call('view.set',{index:0,single:true,focus:owner.hash});await call('diagnostics.frame',{frames:6});
  check('native plane gizmo available',await page.evaluate(()=>!!frameEngine.gizmoState?.handles.length));
  const projected=await call('view.project',{id:owner.hash,point:[0,-50,0]});
  await page.mouse.move(...projected.screen);await page.mouse.wheel(0,80);await call('scene.inspect');
  await call('scene.select',{ids:[]});check('deselection clears native gizmo',await page.evaluate(()=>!frameEngine.gizmoState?.handles.length));
  // Use the enlarged owner's right edge, outside the first plane and cube fixtures.
  const helper=await call('view.project',{id:owner.hash,point:[50,25,0]});
  const hit=await page.evaluate(p=>({element:document.elementFromPoint(p[0],p[1])?.outerHTML,paths:[...document.querySelectorAll('.frame-plugin-hit')].map(el=>({hash:el.dataset.hash,d:el.getAttribute('d')}))}),helper.screen);
  await timed('native helper stroke selection',1500,async()=>{await page.mouse.click(helper.screen[0],helper.screen[1]);await call('scene.inspect');});
  check('helper stroke selects same native owner',(await inspect()).find(n=>n.hash===owner.hash).selected,{expected:owner.hash,helper,hit,selected:(await inspect()).filter(n=>n.selected).map(n=>({hash:n.hash,type:n.type}))});
  const frames=await call('diagnostics.frame',{frames:12});check('CPU/GPU native helper frame budgets',frames.timestampQueries===true&&frames.frames.length===12&&frames.frames.every(f=>Number.isFinite(f.cpuMs)&&Number.isFinite(f.gpuMs)&&f.cpuMs<50&&f.gpuMs<50),frames);
  const gpu=await page.evaluate(async()=>{await __magnetoDevice.queue.onSubmittedWorkDone();return {validation:(await __magnetoDevice.popErrorScope())?.message||null,uncaptured:__magnetoErrors,lost:__magnetoLost,replaced:__magnetoDevice!==frameEngine.renderer.device};});
  check('no JS, console, GPU errors, loss or replacement',!errors.length&&!consoleErrors.length&&!gpu.validation&&!gpu.uncaptured.length&&!gpu.lost&&!gpu.replaced,{errors,consoleErrors,gpu});
  check('no numerical code requested',requests.every(p=>['plugin.json','icon.svg','plugin.js'].some(n=>p==='/plugins/magneto/'+n)),requests);
  return {pass:true,checks,timings,hardware,gpu,requestedDPR,actualDPR,scope:'Native authoring only; no physics or aggregate/stress qualification.'};
 }catch(e){return {pass:false,checks,timings,hardware,requestedDPR,actualDPR,error:e.stack};}finally{await context.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const sources=async()=>{const hashes={};for(const p of ['index.html','plugins/index.json','plugins/magneto/plugin.json','plugins/magneto/plugin.js','plugins/magneto/icon.svg','plugins/magneto/tests/authoring-browser.mjs','plugins/magneto/tests/authoring.test.mjs','tests/plugin-tag-fields.mjs','tests/plugin-tag-fields-browser.mjs','tools/browser.mjs'])hashes[p]=createHash('sha256').update(await readFile(new URL('../../../'+p,import.meta.url))).digest('hex');return hashes;};
 const before=await sources();
 const expectedIndex='207009dfc3d8b34b0966c1a9345ddaceba5502a5782c588506afa4fcfa4ef0d9';
 const requestedDPR=Number(process.env.FRAME_DPR||1);
 let session,result;try{if(![1,2].includes(requestedDPR))throw Error('Magneto focused gate supports FRAME_DPR=1 or 2.');if(before['index.html']!==expectedIndex)throw Error('Candidate index changed from reviewed tag-bridge source; update freeze only after review.');if(!process.argv.includes('--headless'))throw Error('This LAB gate requires --headless and a coordinated GPU slot.');session=await launch({headless:true});result=await pluginChecks(session.page);}catch(e){result={pass:false,requestedDPR,actualDPR:null,error:e.stack};}finally{await session?.close();}
 result.sourcesBefore=before;result.sourcesAfter=await sources();if(!equal(result.sourcesBefore,result.sourcesAfter)){result.pass=false;result.error='Source changed during run';}
 const report='magneto-authoring-preview-dpr'+([1,2].includes(requestedDPR)?requestedDPR:'invalid')+'.json';
 await mkdir(new URL('../../../tests/results/',import.meta.url),{recursive:true});await writeFile(new URL('../../../tests/results/'+report,import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));process.exitCode=result.pass?0:1;
}
