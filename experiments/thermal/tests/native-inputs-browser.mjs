import {serve,ready} from '../../../tools/browser.mjs';
import {chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../../../',import.meta.url),paths=['index.html','plugins/index.json','plugins/thermal/plugin.js','plugins/thermal/plugin.json','plugins/thermal/native-frame.js','experiments/thermal/native-inputs.js','experiments/thermal/tests/native-inputs-browser.mjs'];
async function hashes(){return Object.fromEntries(await Promise.all(paths.map(async p=>[p,createHash('sha256').update(await readFile(new URL(p,root))).digest('hex')])));}
const before=await hashes(),original=await readFile(new URL('plugins/thermal/plugin.js',root),'utf8'),manifest=JSON.parse(await readFile(new URL('plugins/thermal/plugin.json',root),'utf8'));
const hook='export async function activate(context){';if(original.split(hook).length!==2)throw Error('Expected exact native plugin activation seam');
const instrumented=original.replace(hook,hook+'\n globalThis.__nativeThermalContext=context; // isolated test observation only\n');
const candidate={...manifest,tags:[{kind:'thermal_material',name:'Material',text:'M',fields:{Density:2700,'Specific heat':900,Conductivity:205}},{kind:'thermal_heater',name:'Heater',text:'H',fields:{Power:40}}]};
let server,browser,result;const checks=[],timings=[],errors=[],consoleErrors=[],gpuErrors=[],hardware=[];
const check=(name,ok)=>{if(!ok)throw Error(name);checks.push(name);};
try{
 server=await serve();browser=await chromium.launch({headless:true,channel:'chromium',args:['--enable-unsafe-webgpu','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
 for(const testSchema of [false,true]){
  const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});
  try{
   await context.route('**/plugins/thermal/plugin.js',route=>route.fulfill({body:instrumented,contentType:'text/javascript'}));
   if(testSchema)await context.route('**/plugins/thermal/plugin.json',route=>route.fulfill({body:JSON.stringify(candidate),contentType:'application/json'}));
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.stack));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});await page.goto(server.url);await ready(page);
   const info=await page.evaluate(()=>{const d=frameEngine.renderer.device;globalThis.__nativeGPU=[];globalThis.__nativeLost=null;globalThis.__thermalAllocations=[];d.addEventListener('uncapturederror',e=>__nativeGPU.push(e.error.message));d.lost.then(e=>__nativeLost={reason:e.reason,message:e.message});const create=d.createBuffer.bind(d);d.createBuffer=desc=>{if(/^Thermal\s/.test(desc.label||''))__thermalAllocations.push(desc.label);return create(desc);};return Object.fromEntries(['vendor','architecture','device','description','isFallbackAdapter'].map(k=>[k,d.adapterInfo?.[k]??null]));});
   hardware.push(info);check('identifiable native hardware '+testSchema,!info.isFallbackAdapter&&/nvidia|amd|intel|apple/i.test([info.vendor,info.description].join(' '))&&!/swiftshader|llvmpipe|software/i.test(JSON.stringify(info)));
   const call=(name,args={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[name,args]);
   const initial=(await call('scene.inspect')).objects;if(initial.length)await call('scene.delete',{ids:initial.filter(n=>!n.parent).map(n=>n.hash)});
   const owner=await call('plugins.create',{plugin:'thermal'}),cube=await call('scene.create',{type:'cube',name:'Native Thermal data fixture'});
   const start=performance.now();const observed=await page.evaluate(async({hash,testSchema})=>{
    const {captureNativeThermalInputs}=await import('/experiments/thermal/native-inputs.js');
    if(!testSchema){try{await captureNativeThermalInputs(__nativeThermalContext,hash);return {unexpected:true};}catch(e){return {code:e.code};}}
    return {ready:true};
   },{hash:owner.hash,testSchema});
   if(!testSchema)check('unchanged installed preview rejects missing physical tag authority',observed.code==='THERMAL_TAGS_UNAVAILABLE');
   else{
    await call('tag.set',{ids:[cube.hash],kind:'thermal_material',enabled:true,params:{Density:2700,'Specific heat':900,Conductivity:205}});await call('tag.set',{ids:[cube.hash],kind:'thermal_heater',enabled:true,params:{Power:40}});
    const acquire=()=>page.evaluate(async hash=>{const {captureNativeThermalInputs}=await import('/experiments/thermal/native-inputs.js');globalThis.__nativeObservation?.dispose();globalThis.__nativeObservation=await captureNativeThermalInputs(__nativeThermalContext,hash);return {snapshot:__nativeObservation.snapshot,comparison:await __nativeObservation.checkObservedInputs(),metrics:__nativeObservation.metrics};},owner.hash);
    const a=await acquire();check('actual native scalar tags pair with captured occurrence',a.snapshot.occurrences.length===1&&a.snapshot.occurrences[0].owner===cube.hash&&a.snapshot.occurrences[0].material.volumetricHeatCapacityJPerM3K===2430000&&a.snapshot.occurrences[0].heater.powerWatts===40);
    check('browser observation is expressly not solve/currentness/domain authority',!a.snapshot.solverReady&&!a.snapshot.currentnessCertified&&!a.snapshot.geometryClassified&&!a.snapshot.completePhysicalScene&&!a.comparison.currentnessCertified);
    check('adapter owns no GPU resources; inherited native settlement remains unmeasured',a.metrics.adapterOwnedGPUBytes===0&&a.metrics.adapterGeometryReadbackBytes===0&&a.metrics.inheritedNativeSettlement&&!a.metrics.wholeCallGPUWorkMeasured);
    const invalidated=()=>page.evaluate(async()=>{try{await __nativeObservation.checkObservedInputs();return false;}catch(e){return ['STALE_INPUT','INVALID_NATIVE_INPUT','INVALID_OWNER','UNCAPTURED_PHYSICAL_SOURCE','NOT_FOUND'].includes(e.code);}});
    await call('tag.set',{ids:[cube.hash],kind:'thermal_heater',enabled:true,params:{Power:-40}});check('actual native tag edit invalidates observed source',await invalidated());
    await acquire();await call('edit.history',{action:'undo'});check('actual native Undo invalidates same-hash ownership',await invalidated());
    await acquire();const state=await call('authorData.get',{owner:cube.hash});await call('authorData.replace',{owner:cube.hash,expected:{epoch:state.epoch,revision:state.data.revision},records:[{id:'c'.repeat(32),revision:0,name:'Native inert fixture',kind:'opaque',refs:[],payload:{format:'thermal-test-inert',version:1,data:{value:1}}}]});check('actual author-data CAS invalidates conservative observation',await invalidated());
    await acquire();const saved=await call('scene.export',{includeData:true});await call('scene.open',{name:'thermal-native-observation.hash',base64:saved.base64});check('native HASH replacement invalidates previous source owner',await invalidated());
    const reopened=await acquire();check('native HASH retains explicit scalar identities and properties',reopened.snapshot.occurrences[0].material.tagUID===a.snapshot.occurrences[0].material.tagUID&&reopened.snapshot.occurrences[0].heater.tagUID===a.snapshot.occurrences[0].heater.tagUID&&reopened.snapshot.occurrences[0].heater.powerWatts===40);
    await call('scene.update',{id:cube.hash,visible:false});check('hidden tagged source is rejected rather than treated as void',await invalidated());
    await call('scene.open',{name:'thermal-native-observation-valid.hash',base64:saved.base64});
    await page.evaluate(hash=>{const D=__nativeThermalContext.document,n=D.nodes.find(n=>n.nativeHash===hash);D.transaction(()=>{n.tags.find(t=>t.kind==='thermal_heater').uid=n.tags.find(t=>t.kind==='thermal_material').uid;});},cube.hash);
    const collision=await call('scene.export',{includeData:true});await call('scene.open',{name:'thermal-native-uid-collision.hash',base64:collision.base64});
    const collided=(await call('tag.read',{ids:[cube.hash],kind:'thermal_material'})).objects[0].tags[0].uid===(await call('tag.read',{ids:[cube.hash],kind:'thermal_heater'})).objects[0].tags[0].uid;check('actual HASH accepted and retained deliberate owner-local UID collision',collided);
    const rejection=()=>page.evaluate(async hash=>{const {captureNativeThermalInputs}=await import('/experiments/thermal/native-inputs.js');try{const observation=await captureNativeThermalInputs(__nativeThermalContext,hash);observation.dispose();return null;}catch(e){return e.code;}},owner.hash);
    check('adapter rejects actual HASH-restored UID ambiguity',await rejection()==='AMBIGUOUS_TAG_IDENTITY');
    await call('scene.open',{name:'thermal-native-observation-valid.hash',base64:saved.base64});
    for(const kind of ['thermal_material','thermal_heater'])await call('tag.set',{ids:[cube.hash],kind,enabled:false});
    const instance=await call('scene.create',{type:'instance',name:'Single native instance',params:{object:cube.hash}});
    await call('tag.set',{ids:[instance.hash],kind:'thermal_material',enabled:true,params:{Density:2700,'Specific heat':900,Conductivity:205}});await call('tag.set',{ids:[instance.hash],kind:'thermal_heater',enabled:true,params:{Power:40}});await call('scene.update',{id:cube.hash,visible:false});
    const actualReplica=await page.evaluate(hash=>{const s=__nativeThermalContext.scene.capture(hash);return s.meshes.map(m=>({hash:m.hash,triangleCount:m.triangleCount}));},owner.hash);check('actual native single-instance fixture has one visible evaluated occurrence',actualReplica.length===1&&actualReplica[0].hash===instance.hash&&actualReplica[0].triangleCount>0);check('adapter rejects one native instance without inferred canonical source ownership',await rejection()==='UNSUPPORTED_SOURCE_KIND');
    const cancellation=await page.evaluate(async hash=>{const {captureNativeThermalInputs}=await import('/experiments/thermal/native-inputs.js'),signal=AbortSignal.abort();try{await captureNativeThermalInputs(__nativeThermalContext,hash,{signal});return false;}catch(e){return e.code==='CANCELLED';}},owner.hash);check('pre-cancel rejects before native data capture',cancellation);
    const status=await call('plugins.command',{id:owner.hash,operation:'status',args:{}});check('ordinary Thermal remains authoring-only under test schema',status.authoringOnly&&!status.numericalAvailable);
    check('completed native data capture under 1500 ms',a.metrics.captureWallMs<1500&&reopened.metrics.captureWallMs<1500);timings.push({operation:'capture native candidate tags',wallMs:a.metrics.captureWallMs,budgetMs:1500},{operation:'capture after native HASH',wallMs:reopened.metrics.captureWallMs,budgetMs:1500});
   }
   timings.push({operation:testSchema?'native candidate data lifecycle fixture':'installed preview rejection',wallMs:performance.now()-start,budgetMs:60000});check('bounded fixture latency '+testSchema,timings.at(-1).wallMs<60000);
   const gpu=await page.evaluate(async()=>{globalThis.__nativeObservation?.dispose();await frameEngine.renderer.device.queue.onSubmittedWorkDone();return {errors:__nativeGPU,lost:__nativeLost,thermalAllocations:__thermalAllocations};});gpuErrors.push(...gpu.errors);check('native fixture no Thermal-labelled numerical buffers or GPU errors '+testSchema,!gpu.errors.length&&!gpu.lost&&!gpu.thermalAllocations.length);
  }finally{await context.close();}
 }
 result={pass:true,checks,timings,hardware};
}catch(e){result={pass:false,error:e.stack,checks,timings,hardware};}finally{await browser?.close();await server?.close();}
result.sourcesBefore=before;result.sourcesAfter=await hashes();result.sourcesUnchanged=JSON.stringify(before)===JSON.stringify(result.sourcesAfter);result.errors=errors;result.consoleErrors=consoleErrors;result.gpuErrors=gpuErrors;result.pass&&=result.sourcesUnchanged&&!errors.length&&!consoleErrors.length&&!gpuErrors.length;
result.nodeVersion=process.version;result.headless=true;result.nativeDataBrowserVerified=result.pass;result.numericalHardwareVerified=false;result.resourceEvidence={scope:'adapter-owned operations only',adapterOwnedGPUBytes:0,adapterGeometryReadbackBytes:0,thermalLabelMonitorOnly:true,inheritedNativeSettlement:true,wholeCallGPUWorkMeasured:false};result.scope='Native data observation only. Test-only scalar manifest and context-observer injection in isolated contexts; installed source unchanged. No geometry classification, authoritative currentness or numerical solve. Native tag.list settlement may evaluate geometry/plugins and do GPU work; whole-call allocation/readback is not measured.';
await mkdir(new URL('tests/results/',root),{recursive:true});await writeFile(new URL('tests/results/thermal-native-inputs-browser.json',root),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));process.exitCode=result.pass?0:1;
