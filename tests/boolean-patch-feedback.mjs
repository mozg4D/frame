import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../tools/browser.mjs';

export async function booleanPatchFeedbackChecks(page){
 const checks=[],timings=[],call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]);
 const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});assert.ok(pass,name+': '+JSON.stringify(detail));};
 const measure=async(name,fn)=>{const start=performance.now(),result=await fn(),ms=performance.now()-start;timings.push({name,ms,limit:5000});check(name+' completes within 5 s',ms<5000,{ms});return result;};
 const current=()=>page.evaluate(()=>({busy:FrameSpline.busy,meshes:frameEngine.scene.meshes.map(m=>({hash:m.hashId,source:m.replicaSource?.hashId,triangles:m.triangleCount,version:m.version})),states:[...FrameSpline.states].map(([id,s])=>({id,report:s.report,signature:!!s.signature}))}));
 const closed=hash=>page.evaluate(async hash=>{const {indices}=await frameEngine.readGeometry(hash),edges=new Map();for(let i=0;i<indices.length;i+=3)for(let k=0;k<3;k++){const a=indices[i+k],b=indices[i+(k+1)%3],key=Math.min(a,b)+':'+Math.max(a,b),row=edges.get(key)||[0,0];row[0]++;row[1]+=a<b?1:-1;edges.set(key,row);}return {edges:edges.size,defects:[...edges.values()].filter(([count,sign])=>count!==2||sign).length};},hash);
 try{
  const adapter=await page.evaluate(()=>{const a=frameEngine.renderer.device.adapterInfo;return Object.fromEntries(['vendor','architecture','description','isFallbackAdapter'].map(k=>[k,a[k]]));});
  check('Uses native hardware WebGPU at DPR 1',adapter.isFallbackAdapter===false&&!/swiftshader|llvmpipe|software/i.test(JSON.stringify(adapter))&&await page.evaluate(()=>devicePixelRatio===1),adapter);
  const fixture=await readFile(new URL('scenes/boolean-meltus8.hash',import.meta.url)),opened=await measure('Open supplied meltus8',()=>call('scene.open',{base64:fixture.toString('base64'),name:'meltus8.hash'}));
  const boolean=opened.objects.find(o=>o.type==='boolean'),source=opened.objects.find(o=>o.hash==='adc2e59e31c93b41eac59158a1d3c12d'),tool=opened.objects.find(o=>o.hash===source.parent),cutterGroup=opened.objects.find(o=>o.hash===tool.parent);
  check('Supplied four-cutter Boolean builds a closed surface',!boolean.buildError&&boolean.evaluation.report.trusted&&boolean.evaluation.report.watertight,boolean.evaluation.report.postTransfer);
  await call('view.set',{index:0,single:true,mode:'object',shading:'solid-isoparms',focus:boolean.hash});
  // Read the first completed native frame without forcing a corrective repaint.
  const pixels=await page.evaluate(async()=>{const r=frameEngine.renderer,d=r.device,w=r.width,h=r.height,stride=Math.ceil(w*4/256)*256,b=d.createBuffer({size:stride*h,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{const e=d.createCommandEncoder();e.copyTextureToBuffer({texture:r.cachedColor},{buffer:b,bytesPerRow:stride},[w,h]);d.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);const bytes=new Uint8Array(b.getMappedRange());let black=0;for(let y=150;y<Math.min(810,h);y++)for(let x=270;x<Math.min(760,w);x++){const at=y*stride+x*4;if(bytes[at]<3&&bytes[at+1]<3&&bytes[at+2]<3)black++;}b.unmap();return {black};}finally{b.destroy();}});
  check('First Isoparms frame hides internal Boolean triangulation',pixels.black<50,pixels);
  await call('scene.update',{id:boolean.hash,parent:''});const whole=await call('scene.inspect');await call('scene.delete',{ids:whole.objects.filter(o=>!o.parent&&o.hash!==boolean.hash).map(o=>o.hash)});
  await call('scene.select',{ids:[source.hash],mode:'object'});await page.locator('#tabAttributes').click();const field=page.locator('#attrContent input[data-field="angle approximation"]'),before=await current(),version=before.meshes.find(m=>m.hash===tool.hash).version;
  await measure('Native approximation field commit',async()=>{await field.fill('20');await field.press('Tab');await page.waitForFunction(([hash,version])=>frameEngine.scene.meshes.find(m=>m.hashId===hash)?.version>version&&!FrameSpline.busy,[tool.hash,version],{timeout:5000});});
  const changed=await current(),mesh=changed.meshes.find(m=>m.hash===tool.hash),copies=changed.meshes.filter(m=>m.source===tool.hash),output=changed.meshes.find(m=>m.hash===boolean.hash),report=changed.states.find(s=>s.id===boolean.id)?.report;
  check('One UI edit refreshes every cutter before Boolean',mesh.triangles===156&&copies.length===3&&copies.every(m=>m.triangles===156)&&output.triangles===2500&&report.postTransfer.triangles===output.triangles,{mesh,copies,output,report:report.postTransfer});
  await call('scene.update',{id:source.hash,params:{'angle approximation':10}});const grouped=await call('diagnostics.mesh',{id:boolean.hash,geometry:true});
  const state=await call('scene.inspect'),cutters=state.objects.filter(o=>o.parent===cutterGroup.hash),remaining=await call('scene.create',{type:'group',name:'Remaining cuts'});
  for(const cutter of cutters.slice(1))await call('scene.update',{id:cutter.hash,parent:remaining.hash});
  const outer=await measure('Create nested second cut',()=>call('scene.create',{type:'boolean',name:'Second cut',inputs:[boolean.hash,remaining.hash],params:{op:'subtract'}}));
  check('Nested four-hole cut matches grouped cut volume',!outer.buildError&&outer.evaluation.report.trusted&&Math.abs(Math.abs((await call('diagnostics.mesh',{id:outer.hash,geometry:true})).signedVolume/grouped.signedVolume)-1)<1e-5,outer.evaluation.report.postTransfer);
  for(const angle of [30,7,5,10]){
   await measure('Nested cut approximation '+angle,()=>call('scene.update',{id:source.hash,params:{'angle approximation':angle}}));const s=await call('scene.inspect'),booleans=s.objects.filter(o=>o.type==='boolean');
   check('Both Boolean results publish current topology at '+angle,booleans.length===2&&booleans.every(o=>!o.buildError&&o.evaluation.report.trusted&&o.evaluation.report.watertight&&o.mesh.triangles===o.evaluation.report.postTransfer.triangles),booleans.map(o=>({name:o.name,error:o.buildError,triangles:o.mesh?.triangles,report:o.evaluation?.report?.postTransfer})));
   const topology=await closed(outer.hash);check('Nested result has no gaps or winding defects at '+angle,topology.defects===0,topology);
  }
  const final=await call('diagnostics.mesh',{id:outer.hash,geometry:true});await call('edit.history',{action:'undo'});const undone=await call('scene.inspect');check('Approximation Undo rebuilds both Boolean levels',undone.objects.find(o=>o.hash===source.hash).params['angle approximation']===5&&undone.objects.filter(o=>o.type==='boolean').every(o=>!o.buildError&&o.evaluation.report.trusted));await call('edit.history',{action:'redo'});const redone=await call('diagnostics.mesh',{id:outer.hash,geometry:true});check('Approximation Redo restores exact nested geometry',redone.positionsSHA256===final.positionsSHA256&&redone.indicesSHA256===final.indicesSHA256);
  const saved=await call('scene.export',{includeData:true}),reopened=await measure('Reopen nested Boolean HASH',()=>call('scene.open',{base64:saved.base64,name:'nested.hash'}));
  check('HASH rebuild preserves both nested Boolean results',reopened.objects.filter(o=>o.type==='boolean').every(o=>!o.buildError&&o.evaluation.report.trusted&&o.evaluation.report.watertight));
  const topology=await closed(outer.hash);check('Rebuilt nested surface retains closed topology',topology.defects===0,topology);
  return {pass:true,checks,timings,adapter,fixtureSHA256:createHash('sha256').update(fixture).digest('hex')};
 }catch(error){return {pass:false,checks,timings,error:error.stack};}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const s=await launch({headless:true}),errors=[];try{await ready(s.page);s.page.on('pageerror',e=>errors.push(e.stack));await s.page.evaluate(()=>{window.__booleanGPU=[];frameEngine.renderer.device.addEventListener('uncapturederror',e=>__booleanGPU.push(e.error.message));frameEngine.renderer.device.pushErrorScope('validation');});const report=await booleanPatchFeedbackChecks(s.page);report.errors=errors;report.gpu=await s.page.evaluate(async()=>({validation:(await frameEngine.renderer.device.popErrorScope())?.message||null,uncaptured:__booleanGPU}));report.pass&&=!errors.length&&!report.gpu.validation&&!report.gpu.uncaptured.length;report.indexSHA256=createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex');await mkdir(new URL('results/',import.meta.url),{recursive:true});await writeFile(new URL('results/boolean-patch-feedback.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));process.exitCode=report.pass?0:1;}finally{await s.close();}
}
