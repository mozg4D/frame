// Native same-document witness. The route changes only key selection and
// exposes owning closures; no product debug flag or alternate shader exists.
import assert from 'node:assert/strict';
import {launch,ready} from '../tools/browser.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
assert.equal(html.split(',materialWireOverlay].join').length-1,2);
const routed=html.replaceAll(',materialWireOverlay].join',',...(window.__wireLegacy?[]:[materialWireOverlay])].join').replace('function materialPipeline(r,mesh,transparent=false){','function materialPipeline(r,mesh,transparent=false){window.__wireProbe={materialPipeline,filteredSurfacePipeline,materialTransparent,materialMeshGPU};');
const report={pass:false,native:true,sourceSHA256:createHash('sha256').update(html).digest('hex'),testInjection:'Same-document legacy cache-key omission and owning-closure exposure; shader constants and native rendering unchanged.',checks:[],rows:[],errors:[],consoleErrors:[]};
const session=await launch({headless:true}),page=session.page;
const call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]);
const check=(name,pass,detail)=>{report.checks.push({name,pass:!!pass,detail});assert.ok(pass,name+': '+JSON.stringify(detail));console.log('PASS '+name);};
page.on('pageerror',e=>report.errors.push(e.stack));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
const warm=async()=>{for(let i=0;i<3;i++){await call('diagnostics.frame',{frames:2});await page.waitForFunction(()=>!frameEngine.renderer.materialState?.pending?.size,{},{timeout:30000});}await call('diagnostics.frame',{frames:2});};
const capture=()=>page.evaluate(async()=>{const r=frameEngine.renderer,d=r.device,w=r.width,h=r.height,stride=Math.ceil(w*4/256)*256,b=d.createBuffer({size:stride*h,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{const e=d.createCommandEncoder();e.copyTextureToBuffer({texture:r.cachedColor},{buffer:b,bytesPerRow:stride},[w,h]);d.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);const a=new Uint8Array(b.getMappedRange()),out=new Uint8Array(w*h*4);for(let y=0;y<h;y++)out.set(a.subarray(y*stride,y*stride+w*4),y*w*4);b.unmap();let raw='';for(let i=0;i<out.length;i+=16384)raw+=String.fromCharCode(...out.subarray(i,i+16384));return btoa(raw);}finally{b.destroy();}});
async function selectKey(legacy){await warm();await page.evaluate(value=>{window.__wireLegacy=value;const r=frameEngine.renderer,state=r.materialState;state.pipelines.clear();r.surfaceFilters=new WeakMap();r.geometryBundles=null;frameEngine.draw(true);},legacy);await warm();}
try{
 await page.route('**/index.html',route=>route.fulfill({contentType:'text/html',body:routed}));await page.reload();await ready(page);
 report.adapter=await page.evaluate(()=>{const a=frameEngine.renderer.device.adapterInfo;return {vendor:a.vendor,architecture:a.architecture,description:a.description,isFallbackAdapter:a.isFallbackAdapter};});
 check('Native WebGPU uses the hardware adapter',report.adapter.isFallbackAdapter===false&&!/swiftshader|llvmpipe|software/i.test(JSON.stringify(report.adapter)),report.adapter);
 await page.evaluate(()=>{window.__wireLegacy=false;window.__wireGPU=[];window.__wireDescriptors=new WeakMap();const d=frameEngine.renderer.device,create=d.createRenderPipelineAsync;d.createRenderPipelineAsync=function(descriptor){return create.call(this,descriptor).then(p=>{__wireDescriptors.set(p,{label:descriptor.label,constants:descriptor.fragment?.constants||{}});return p;});};d.addEventListener('uncapturederror',e=>__wireGPU.push(e.error.message));});
 await call('scene.new');
 const base=await call('material.create',{name:'Opaque base',params:{h:30,s:12,l:85,rough:75}}),opaque=await call('material.create',{name:'Opaque cage mask',params:{h:205,s:65,l:60}}),mixed=await call('material.create',{name:'Transparent cage mask',params:{h:15,s:65,l:60,opac:55}}),patches=[];
 for(let i=0;i<2;i++){
  const cube=await call('scene.create',{type:'cube',params:{'size x':80,'size y':80,'size z':80}});await call('scene.convert',{id:cube.hash});
  const patch=(await call('scene.inspect')).objects.find(n=>n.type==='spline_patch'&&!patches.includes(n.hash));assert(patch);patches.push(patch.hash);
  await call('material.assign',{id:patch.hash,material:base.uid});await call('material.assign',{id:patch.hash,material:i?mixed.uid:opaque.uid,faces:[0,2,4,6,8,10]});
  await call('transform.set',{ids:[patch.hash],channel:'position',axis:0,value:i?65:-65,coordinates:'world'});
 }
 await call('scene.select',{ids:patches});await call('view.set',{index:0,single:true,mode:'object',shading:'solid-wire',focusSelection:true});await call('scene.select',{ids:[]});await page.mouse.move(5,5);await warm();
 const status=()=>page.evaluate(ids=>ids.map(hash=>{const m=frameEngine.scene.meshes.find(m=>m.hashId===hash),r=frameEngine.renderer,p=__wireProbe.materialPipeline(r,m);return {hash,posed:m.posed,grouped:m.materialBindings.grouped,classified:!!m.splineWireEdges,transparent:__wireProbe.materialTransparent(m),pipeline:__wireDescriptors.get(p)};}),patches);
 for(const mode of ['solid-wire','solid-isoparms']){
  await call('view.set',{index:0,single:true,mode:'object',shading:mode});await selectKey(false);const fixed=await capture(),fixedStatus=await status();
  check(mode+' compiles the correct distinct opaque and transparent constants',fixedStatus.every(m=>m.pipeline?.constants.materialWireOverlay===!m.transparent)&&fixedStatus[0].pipeline.label!==fixedStatus[1].pipeline.label,fixedStatus);
  await selectKey(true);const legacy=await capture(),legacyStatus=await status(),a=Buffer.from(fixed,'base64'),b=Buffer.from(legacy,'base64');let changedChannels=0,maxDelta=0;for(let i=0;i<a.length;i++){const delta=Math.abs(a[i]-b[i]);if(delta)changedChannels++;maxDelta=Math.max(maxDelta,delta);}
  check(mode+' legacy key demonstrably chooses an incompatible native pipeline',legacyStatus.some(m=>m.pipeline?.constants.materialWireOverlay!==!m.transparent),legacyStatus);
  check(mode+' incompatible specialization changes real native pixels',changedChannels>0,{changedChannels,maxDelta});
  await selectKey(false);const restored=Buffer.from(await capture(),'base64');check(mode+' restoring the exact key restores every captured pixel',a.equals(restored));
  report.rows.push({mode,fixedStatus,legacyStatus,changedChannels,maxDelta});
 }
 report.gpu=await page.evaluate(()=>__wireGPU);check('No JavaScript or WebGPU errors',!report.errors.length&&!report.consoleErrors.length&&!report.gpu.length,{errors:report.errors,console:report.consoleErrors,gpu:report.gpu});report.pass=true;
}catch(error){report.error=error.stack;console.error(error.stack);process.exitCode=1;}
finally{await mkdir(new URL('results/',import.meta.url),{recursive:true});await page.screenshot({path:fileURLToPath(new URL('results/material-wire-specialization'+(report.pass?'':'-failure')+'.png',import.meta.url))}).catch(()=>{});await session.close();await writeFile(new URL('results/material-wire-specialization-browser.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
