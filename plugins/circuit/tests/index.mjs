import {launch,ready} from '../../../tools/browser.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export async function pluginChecks(parent){
 const checks=[],timings=[],errors=[];let context;
 const check=(name,pass,detail)=>{checks.push({name:'Circuit preview: '+name,pass:!!pass,detail});if(!pass)throw Error(name+': '+JSON.stringify(detail));};
 const timed=async(name,limit,fn)=>{const start=performance.now(),value=await fn(),ms=performance.now()-start;timings.push({name,ms,limit});check(name+' latency',ms<limit,{ms,limit});return value;};
 try{
  context=await parent.context().browser().newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.stack));
  await page.goto(parent.url());await ready(page);
  const hardware=await page.evaluate(()=>{const d=frameEngine.renderer.device;window.__circuitGPU=[];d.addEventListener('uncapturederror',e=>__circuitGPU.push(e.error.message));d.pushErrorScope('validation');return d.adapterInfo?Object.fromEntries(['vendor','architecture','device','description','isFallbackAdapter'].map(k=>[k,d.adapterInfo[k]])):null;});
  check('identifiable hardware WebGPU',hardware&&hardware.isFallbackAdapter===false&&!!hardware.vendor&&!/swiftshader|llvmpipe|lavapipe|software|fallback/i.test([hardware.vendor,hardware.architecture,hardware.device,hardware.description].join(' ')),hardware);
  const call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]),rows=async()=>(await call('scene.inspect')).objects;
  const initial=await rows();if(initial.length)await call('scene.delete',{ids:initial.filter(n=>!n.parent).map(n=>n.hash)});
  check('catalogue starts with lazy Circuit runtime',(await call('plugins.list')).some(p=>p.id==='circuit'&&!p.loaded));
  await page.locator('#tabPlugins').click();const icon=await page.locator('[data-plugin="circuit"] img').evaluate(async img=>{await img.decode();const r=img.getBoundingClientRect();return [img.naturalWidth,img.naturalHeight,r.width,r.height];});check('icon uses native 32px artwork',equal(icon,[32,32,32,32]),icon);
  const circuit=await timed('owner creation',10000,()=>call('plugins.create',{plugin:'circuit'})),cmd=(operation,args={},id=circuit.hash)=>call('plugins.command',{id,operation,args});
  await page.locator('#tabAttributes').click();check('Under construction is disabled and not a fake solver',await page.locator('[data-plugin-action-button="status"]').isDisabled());
  await timed('real Resistor creation action',10000,async()=>{await page.locator('[data-plugin-group="Components"] [data-plugin-element="R"]').click();await call('scene.inspect');});
  const resistor=(await rows()).find(n=>n.type==='circuit_resistor');check('component is separate, selected and explicitly owned',resistor?.selected&&resistor.parent===circuit.hash&&resistor.params.Circuit===circuit.hash,resistor);
  let r=await cmd('inspect',{},resistor.hash);check('pins are stable and values are explicitly unavailable',r.pins.length===2&&r.pins.every(p=>p.net===null&&p.voltage===null&&p.availability==='solver-unavailable'),r);
  const capacitor=await cmd('create-capacitor');check('creating a component selects the new child',(await rows()).find(n=>n.hash===capacitor.hash)?.selected);
  await timed('native component transform',1500,()=>call('transform.set',{channel:'position',axis:0,value:40,coordinates:'world'}));check('new child transforms independently',(await rows()).find(n=>n.hash===capacitor.hash)?.worldMatrix[12]===40);
  await call('edit.history',{action:'undo'});await call('edit.history',{action:'redo'});await call('edit.history',{action:'undo'});
  await cmd('assign-net',{pin:r.pins[0].id,name:'GND'},r.hash);await cmd('assign-net',{pin:r.pins[1].id,name:'OUT'},r.hash);await cmd('assign-net',{pin:capacitor.pins[0].id,name:'OUT'},capacitor.hash);
  let state=await cmd('inspect'),ground=state.nets.find(n=>n.name==='GND'),out=state.nets.find(n=>n.name==='OUT');await cmd('set-ground',{net:ground.id});
  const original=await cmd('inspect',{},r.hash);await timed('network merge with native references',1500,()=>cmd('rename-net',{net:ground.id,name:'OUT'}));check('merge retargets Ground and component pins',(await cmd('inspect')).ground===out.id&&(await cmd('inspect',{},r.hash)).pins.every(p=>p.net===out.id));
  await call('edit.history',{action:'undo'});check('one native Undo restores merge',equal((await cmd('inspect',{},r.hash)).pins,original.pins)&&(await cmd('inspect')).ground===ground.id);
  const second=await call('plugins.create',{plugin:'circuit'}),other=await cmd('create-net',{name:'OUT'},second.hash);check('independent Circuit network namespace',other.id!==out.id);
  const topology=await timed('bounded native topology snapshot',1000,()=>cmd('topology'));
  check('topology preserves explicit Ground and disconnected pin identities',topology.numericalAvailable===false&&topology.nets.find(n=>n.id===ground.id)?.node==='0'&&topology.components.find(n=>n.hash===capacitor.hash)?.pins[1].node==='p_'+capacitor.hash+'_'+capacitor.pins[1].id,topology);
  const saved=await timed('native HASH export',3000,()=>call('scene.export',{includeData:true})),savedRows=await rows(),savedR=await cmd('inspect',{},r.hash),savedOwner=await cmd('inspect');
  await timed('native HASH reopen',10000,()=>call('scene.open',{name:'circuit-authoring.hash',base64:saved.base64}));
  check('HASH preserves pin/net IDs and explicit ownership',equal(await cmd('inspect',{},r.hash),savedR)&&equal(await cmd('inspect'),savedOwner));
  check('HASH preserves derived topology without stored solver data',equal(await cmd('topology'),topology));
  for(const n of savedRows){const q=(await rows()).find(q=>q.hash===n.hash);check('HASH preserves ordinary frame and parameters',q&&equal(q.matrix,n.matrix)&&equal(q.params,n.params)&&q.parent===n.parent,{before:n,after:q});}
  for(const mode of ['duplicate','clipboard','merge']){
   let copy,mergeRows;
   if(mode==='duplicate')copy=(await call('scene.duplicate',{ids:[circuit.hash]})).objects.find(n=>n.type==='circuit');
   else if(mode==='clipboard'){await call('scene.select',{ids:[circuit.hash]});await call('edit.copy');copy=(await call('edit.paste')).objects.find(n=>n.type==='circuit');}
   else{await page.route('**/circuit-roundtrip.hash',route=>route.fulfill({body:Buffer.from(saved.base64,'base64'),contentType:'application/octet-stream'}));const before=new Set((await rows()).map(n=>n.hash));await call('scene.merge',{url:new URL('/circuit-roundtrip.hash',page.url()).href});mergeRows=(await rows()).filter(n=>!before.has(n.hash));copy=mergeRows.find(n=>n.type==='circuit'&&mergeRows.some(q=>q.type==='circuit_resistor'&&q.parent===n.hash));}
   const child=(await rows()).find(n=>n.type==='circuit_resistor'&&n.parent===copy?.hash);check(mode+' remaps native Circuit references',copy&&child?.params.Circuit===copy.hash&&copy.hash!==circuit.hash,{copy,child,mergeRows});
   const copied=await cmd('inspect',{},child.hash);check(mode+' preserves owner-local pin/net identities',equal(copied.pins,savedR.pins));await call('scene.delete',{ids:[copy.hash]});
  }
  const before=await rows();for(const operation of ['solve','transient','ac','reset','scope','controller','results','export-netlist']){const rejection=await page.evaluate(async([id,operation])=>{try{await frameAI.call('plugins.command',{id,operation,args:{}});return null;}catch(e){return {code:e.code,message:e.message};}},[circuit.hash,operation]);check(operation+' rejects without invented output',rejection?.code==='CIRCUIT_AUTHORING_ONLY',rejection);}
  check('numerical rejection leaves authoring unchanged',equal(await rows(),before));
  await call('scene.select',{ids:[r.hash]});await call('view.set',{index:2,single:true,focus:r.hash});
  const frames=await timed('12 fresh rendering frames',10000,()=>call('diagnostics.frame',{frames:12}));
  check('small authoring scene stays within a 16.7 ms CPU/GPU frame budget',frames.frames.length===12&&frames.frames.every(f=>Number.isFinite(f.cpuMs)&&Number.isFinite(f.gpuMs)&&f.cpuMs<16.7&&f.gpuMs<16.7),frames);
  const gpu=await page.evaluate(async()=>{await frameEngine.renderer.device.queue.onSubmittedWorkDone();return {validation:(await frameEngine.renderer.device.popErrorScope())?.message||null,errors:__circuitGPU};});check('no WebGPU or page errors',!gpu.validation&&!gpu.errors.length&&!errors.length,{gpu,errors});
  await mkdir(new URL('../../../tests/results/',import.meta.url),{recursive:true});await page.screenshot({path:fileURLToPath(new URL('../../../tests/results/circuit-authoring-preview.png',import.meta.url))});
  return {pass:true,checks,timings,evidence:{hardware,frames,gpu},hardwareVerified:true,scope:'Native authoring preview only. No electrical, Scope, controller, standard/stress or 100M-scene qualification.'};
 }catch(error){return {pass:false,checks,timings,error:error.stack,hardwareVerified:false};}finally{await context?.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 let session,result;try{session=await launch({headless:process.argv.includes('--headless')});await ready(session.page);result=await pluginChecks(session.page);}catch(e){result={pass:false,checks:[],timings:[],error:e.stack,hardwareVerified:false};}finally{await session?.close();}
 result.sources={};for(const p of ['index.html','plugins/index.json','plugins/circuit/plugin.js','plugins/circuit/plugin.json','plugins/circuit/data.js','plugins/circuit/symbols.js','plugins/circuit/viewport.js','plugins/circuit/tests/index.mjs'])result.sources[p]=createHash('sha256').update(await readFile(new URL('../../../'+p,import.meta.url))).digest('hex');
 await mkdir(new URL('../../../tests/results/',import.meta.url),{recursive:true});await writeFile(new URL('../../../tests/results/circuit-authoring-preview.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));process.exitCode=result.pass?0:1;
}
