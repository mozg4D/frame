import {pluginEnabled} from './test-policy.mjs';
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../tools/browser.mjs';
import {box,waitForSlice} from '../plugins/3d-printer/tests/slicer.mjs';

export async function removedVolumeSourceChecks(){
 const checks=[],check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name);};
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),worker=await readFile(new URL('../frame-sw.js',import.meta.url),'utf8'),printer=pluginEnabled('3d-printer')?await readFile(new URL('../plugins/3d-printer/plugin.js',import.meta.url),'utf8'):null;
 check('Removed polygon union has no runtime names, engine entry points or WASM loader',!(/\bunite\w*\b|prepareVolume|frame-volume|volumeBakeShader|volumeQueryShader|volumeJob|volumeBinary/i.test(html)));
 if(printer!==null)check('Printer owns only its direct LDI path',!(/prepareVolume|prepare-volume|normalizedVolume|volumeStatus|acquireVolume|disposeVolume/.test(printer)));
 check('Offline core no longer requests the removed WASM asset',!worker.includes('kernels/'));
 for(const path of ['tests/unite-fixtures.mjs','tests/unite-run.mjs','tools/build-volume.ps1','kernels/volume-0e3a6b442b66860e3000.wasm']){let exists=true;try{await access(new URL('../'+path,import.meta.url));}catch{exists=false;}check('Removed dependency is absent: '+path,!exists);}
 return {pass:true,checks};
}
export async function removedVolumeChecks(page){
 const checks=[],timings=[],call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]),check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});if(!pass)throw Error(name+': '+JSON.stringify(detail));};
 const measure=async(name,limit,fn)=>{const at=performance.now(),result=await fn(),ms=performance.now()-at;timings.push({name,ms,limit});check(name+' complete-operation latency',ms<limit,{ms,limit});return result;};
 const rejects=async(name,fn)=>{let error;try{await fn();}catch(e){error={code:e.code,message:e.message};}check(name,!!error,error);};
 try{
  const source=await removedVolumeSourceChecks();checks.push(...source.checks);
  await call('scene.new');const mesh=await call('mesh.create',{name:'Existing polygon output',...box(40,20,40)}),appearance=await call('material.create',{name:'Existing material',params:{h:20,s:70,l:50}});await call('material.assign',{id:mesh.hash,material:appearance.uid});
  const original=await call('diagnostics.mesh',{id:mesh.hash,geometry:true}),materials=await call('diagnostics.appearance',{id:mesh.hash});
  check('Removed tool is absent from discovery',!(await page.evaluate(()=>frameAI.listTools())).some(t=>t.name==='geometry.unite'));
  check('Removed engine and loader are absent',await page.evaluate(()=>typeof frameEngine.uniteMeshes==='undefined'&&typeof frameEngine.prepareVolume==='undefined'&&!document.querySelector('#frame-volume-module,#frame-volume-kernel')));
  await call('scene.select',{ids:[mesh.hash],mode:'object'});await page.locator('#row-'+mesh.id+' .ob-name').click({button:'right'});check('Object menu remains usable without Unite',await page.getByRole('menuitem').count()>0&&await page.getByRole('menuitem',{name:'Unite',exact:true}).count()===0);await page.keyboard.press('Escape');
  for(const mode of ['vertex','edge','polygon']){await call('scene.select',{ids:[mesh.hash],mode});await page.locator('#frame-engine-canvas').click({button:'right',position:{x:220,y:200}});check(mode+' menu retains native editing without Unite',await page.getByRole('menuitem',{name:'Line Cut',exact:true}).isVisible()&&await page.getByRole('menuitem',{name:'Unite',exact:true}).count()===0);await page.keyboard.press('Escape');}
  const before=JSON.stringify((await call('scene.inspect')).objects);await rejects('Removed geometry call rejects',()=>call('geometry.unite',{ids:[mesh.hash]}));check('Removed geometry call leaves scene unchanged',JSON.stringify((await call('scene.inspect')).objects)===before);
  const saved=await call('scene.export',{includeData:true});await measure('Existing polygon HASH round trip',2500,()=>call('scene.open',{name:'existing-polygon.hash',base64:saved.base64}));
  const restored=await call('diagnostics.mesh',{id:mesh.hash,geometry:true});check('Existing polygon geometry survives unchanged',original.positionsSHA256===restored.positionsSHA256&&original.indicesSHA256===restored.indicesSHA256);check('Existing polygon material survives unchanged',JSON.stringify(materials)===JSON.stringify(await call('diagnostics.appearance',{id:mesh.hash})));
  if(pluginEnabled('3d-printer')){const printer=await call('plugins.create',{plugin:'3d-printer'});await call('scene.update',{id:printer.hash,params:{'Line width':2,'Layer height':2,'Initial layer height':2}});const command=(operation,args={})=>call('plugins.command',{id:printer.hash,operation,args});
  const operations=(await call('plugins.describe',{plugin:'3d-printer'})).operations,slice=operations.find(o=>o.id==='slice');check('Printer discovers only direct Slice',!operations.some(o=>o.id==='prepare-volume')&&slice.inputSchema.additionalProperties===false&&Object.keys(slice.inputSchema.properties).length===0);
  const printerBefore=JSON.stringify((await call('scene.inspect')).objects);await rejects('Removed Printer operation rejects',()=>command('prepare-volume'));await rejects('Removed normalized Slice option rejects',()=>command('slice',{prepareVolume:true}));await rejects('Removed filling rule rejects',()=>command('slice',{fillRule:'union'}));check('Removed Printer arguments publish no job or scene mutation',(await command('status')).state==='idle'&&JSON.stringify((await call('scene.inspect')).objects)===printerBefore);
  const result=await measure('Direct Printer LDI Slice',3000,async()=>{await command('slice');return waitForSlice(call,printer.hash);});check('Direct Slice retains native LDI diagnostics',result.state==='complete'&&result.result.representation==='orthogonal-ldi'&&result.result.metadataReadBytes===56&&result.result.intervals>0&&!('preparation'in result)&&!('preparation'in result.result),result);
  const raw=await call('diagnostics.mesh',{id:mesh.hash,geometry:true});check('Direct Slice never rewrites source polygons',original.positionsSHA256===raw.positionsSHA256&&original.indicesSHA256===raw.indicesSHA256);
  }
  await call('scene.new');return {pass:true,checks,timings};
 }catch(error){return {pass:false,checks,timings,error:error.stack||error.message};}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 await mkdir(new URL('results/',import.meta.url),{recursive:true});
 if(process.argv.includes('--cpu'))console.log(JSON.stringify(await removedVolumeSourceChecks(),null,2));
 else{const session=await launch({headless:process.argv.includes('--headless')}),errors=[];try{await ready(session.page);session.page.on('pageerror',e=>errors.push(e.message));await session.page.evaluate(()=>{window.__removedGPU=[];window.__removedDevice=frameEngine.renderer.device;__removedDevice.addEventListener('uncapturederror',e=>__removedGPU.push(e.error.message));__removedDevice.pushErrorScope('validation');});const report=await removedVolumeChecks(session.page);report.gpu=await session.page.evaluate(async()=>({validation:(await __removedDevice.popErrorScope())?.message||null,uncaptured:__removedGPU,replaced:frameEngine.renderer.device!==__removedDevice}));report.errors=errors;report.pass&&=!errors.length&&!report.gpu.validation&&!report.gpu.uncaptured.length&&!report.gpu.replaced;report.indexSHA256=createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex');await writeFile(new URL('results/removed-volume.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,checks:report.checks.length,failed:report.checks.filter(c=>!c.pass),timings:report.timings,gpu:report.gpu,error:report.error,errors},null,2));process.exitCode=report.pass?0:1;}finally{await session.close();}}
}
