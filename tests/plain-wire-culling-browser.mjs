// Native equivalence: culled plain lines versus the original corner path.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../tools/browser.mjs';

export async function plainWireCullingBrowserChecks(page){
 const checks=[],timings=[],call=(n,a={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[n,a]);
 const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});assert.ok(pass,name+': '+JSON.stringify(detail));};
 const lazy=await page.evaluate(()=>!frameEngine.renderer.nativeSurfaceLines.cullingInit);
 const snapshot=()=>page.evaluate(async()=>{
  await frameEngine.draw(true);const r=frameEngine.renderer,d=r.device,hashes={};let blackPixels=0;
  for(const [name,texture]of [['color',r.cachedColor],['ids',r.triangleIds]]){
   const stride=Math.ceil(r.width*4/256)*256,read=d.createBuffer({size:stride*r.height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
   try{const e=d.createCommandEncoder();e.copyTextureToBuffer({texture},{buffer:read,bytesPerRow:stride},[r.width,r.height]);d.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);const raw=new Uint8Array(read.getMappedRange()),packed=new Uint8Array(r.width*r.height*4);for(let y=0;y<r.height;y++)packed.set(raw.subarray(y*stride,y*stride+r.width*4),y*r.width*4);if(name==='color')for(let i=0;i<packed.length;i+=4)if(packed[i]===0&&packed[i+1]===0&&packed[i+2]===0)blackPixels++;hashes[name]=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',packed)),v=>v.toString(16).padStart(2,'0')).join('');read.unmap();}finally{read.destroy();}
  }
  return {hashes,blackPixels,lines:JSON.parse(document.querySelector('#frame-engine-canvas').dataset.surfaceLines),surface:JSON.parse(document.querySelector('#frame-engine-canvas').dataset.surfaceCulling)};
 });
 try{
  check('Empty startup leaves plain-line compute pipelines lazy',lazy);
  await call('mesh.create',{vertices:[0,0,0,10,0,0,0,10,0],indices:[0,1,2]});await page.waitForFunction(()=>!!frameEngine.renderer.nativeSurfaceLines.cullPipeline,{},{timeout:10000});
  const capability=await page.evaluate(()=>{window.__testLineCulling=frameEngine.renderer.nativeSurfaceLines.cullPipeline;return !!__testLineCulling;});check('Native line culling pipeline is ready',capability);
  const vertices=[-80,-60,0,80,-60,0,80,60,0,-80,60,0,-80,-60,80,80,-60,80,80,60,80,-80,60,80],indices=[0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,3,7,6,3,6,2,0,4,7,0,7,3,1,2,6,1,6,5];
  for(const storage of ['auto','texture']){
   await call('scene.new');const mesh=await call('mesh.create',{storage,vertices,indices});await call('scene.select',{ids:[mesh.hash]});await call('transform.set',{channel:'rotation',axis:1,value:13,coordinates:'world'});await call('scene.select',{ids:[]});
   for(const index of [0,2])for(const shading of ['solid-wire','solid-isoparms'])for(const phase of [0,.25]){
    await call('view.set',{index,single:true,shading,focus:mesh.hash});if(index===0)await call('view.set',{camera:[.22,.16,1,phase,0,0,0,40,-85,64,-380,400]});
    await page.evaluate(()=>{frameEngine.renderer.nativeSurfaceLines.cullPipeline=__testLineCulling;});await call('diagnostics.frame',{frames:3});await page.waitForFunction(()=>frameEngine.renderer.compactedWireSurfaces?.size&&[...frameEngine.renderer.compactedWireSurfaces.values()].every(row=>row.pipeline),{},{timeout:10000});
    const start=performance.now(),culled=await snapshot();check(storage+' '+index+' '+shading+' culled lines are actually drawn at '+phase,culled.lines.culledDraws>0&&culled.surface.draws>0,culled);
    await page.evaluate(()=>{frameEngine.renderer.nativeSurfaceLines.cullPipeline=null;});const original=await snapshot();check(storage+' '+index+' '+shading+' original path is the control at '+phase,original.lines.culledDraws===0,original.lines);
    check(storage+' '+index+' '+shading+' exact color and triangle IDs at '+phase,JSON.stringify(culled.hashes)===JSON.stringify(original.hashes),{culled:culled.hashes,original:original.hashes});
    const ms=performance.now()-start;timings.push({name:storage+' '+index+' '+shading+' completed native comparison',ms,budgetMs:2000});check('Completed comparison fits two seconds',ms<2000,{ms});await page.evaluate(()=>{frameEngine.renderer.nativeSurfaceLines.cullPipeline=__testLineCulling;});
   }
  }
  // Reuse only unchanged projections/geometry; in-place edits and history must invalidate.
  for(const storage of ['auto','texture']){
   await call('scene.new');const mesh=await call('mesh.create',{storage,vertices,indices});await call('view.set',{index:0,single:true,mode:'object',shading:'solid-wire',focus:mesh.hash});await call('scene.select',{ids:[]});await call('diagnostics.frame',{frames:3});
   const revision=()=>page.evaluate(hash=>{const m=frameEngine.scene.meshes.find(m=>m.hashId===hash),row=(m.parts||[m])[0].nativeSurfaceLines;return {geometry:m.geometryRevision||0,cached:row.cachedGeometry,version:m.version||0,edgeStreams:m.buffers.filter(b=>b.label==='native visible edge stream').length,liveStreams:(m.parts||[m]).filter(p=>p.nativeSurfaceLines?.visibility).length};},mesh.hash);
   const before=await snapshot(),old=await revision();
   const repeated=await page.evaluate(async()=>{const original=GPUComputePassEncoder.prototype.setPipeline;let preparations=0;GPUComputePassEncoder.prototype.setPipeline=function(p){if(['native prepareTriangles','native cull','native cullTriangles'].includes(p.label))preparations++;return original.call(this,p);};try{await frameEngine.draw(true);return preparations;}finally{GPUComputePassEncoder.prototype.setPipeline=original;}});
   check(storage+' identical frame reuses derived streams',repeated===0,{preparations:repeated,revision:old});
   await call('scene.select',{ids:[mesh.hash],mode:'vertex',components:[0]});await call('transform.set',{channel:'position',axis:2,value:45,coordinates:'world'});await call('scene.select',{ids:[],mode:'object'});await page.waitForFunction(()=>JSON.parse(document.querySelector('#frame-engine-canvas').dataset.creases||'{}').state==='complete',{},{timeout:2500});const edited=await snapshot(),changed=await revision();
   check(storage+' shading publication retires superseded derived streams',changed.edgeStreams===changed.liveStreams,{old,changed});check(storage+' in-place vertex edit invalidates derived geometry',changed.geometry>old.geometry&&changed.cached===changed.geometry,{old,changed});check(storage+' vertex edit visibly changes the native surface',JSON.stringify(edited.hashes)!==JSON.stringify(before.hashes));
   await page.evaluate(()=>{frameEngine.renderer.nativeSurfaceLines.cullPipeline=null;});const control=await snapshot();check(storage+' native comparison retains one published shading revision',(await revision()).version===changed.version,{changed,after:await revision()});check(storage+' edited cached streams equal the unculled renderer',JSON.stringify(edited.hashes)===JSON.stringify(control.hashes),{edited:edited.hashes,control:control.hashes});await page.evaluate(()=>{frameEngine.renderer.nativeSurfaceLines.cullPipeline=__testLineCulling;});
   await call('edit.history',{action:'undo'});await call('scene.select',{ids:[],mode:'object'});const undone=await snapshot();check(storage+' Undo invalidates cached positions and restores exact pixels',JSON.stringify(undone.hashes)===JSON.stringify(before.hashes),{before:before.hashes,undone:undone.hashes});
   await call('edit.history',{action:'redo'});await call('scene.select',{ids:[],mode:'object'});const redone=await snapshot(),restoredRevision=await revision();check(storage+' history keeps only live derived streams',restoredRevision.edgeStreams===restoredRevision.liveStreams,restoredRevision);check(storage+' Redo invalidates cached positions and restores edited pixels',JSON.stringify(redone.hashes)===JSON.stringify(edited.hashes),{edited:edited.hashes,redone:redone.hashes});
  }
  let compactedCases=0,overflowCases=0;const tinyVertices=[],tinyIndices=[];for(let y=0;y<64;y++)for(let x=0;x<64;x++){const a=tinyVertices.length/3,px=x*4-126,py=y*4-126;tinyVertices.push(px,py,0,px+.08,py,0,px,py+.08,0);tinyIndices.push(a,a+1,a+2);}
  for(const storage of ['auto','texture'])for(const size of [.005,.08]){
   await call('scene.new');const vertices=tinyVertices.map((v,i)=>i%9===3||i%9===7?v-.08+size:v),mesh=await call('mesh.create',{storage,vertices,indices:tinyIndices});await call('scene.select',{ids:[]});
   for(const index of [0,2])for(const phase of [0,.125,.25,.5]){
    await call('view.set',{index,single:true,shading:'solid-wire',focus:mesh.hash});if(index===0)await call('view.set',{camera:[.22,.16,1,phase,0,0,0,0,-87,64,-390,400]});
    await page.evaluate(()=>{frameEngine.renderer.nativeSurfaceLines.cullPipeline=__testLineCulling;});await call('diagnostics.frame',{frames:3});await page.waitForFunction(()=>[...frameEngine.renderer.compactedWireSurfaces.values()].every(row=>row.pipeline),{},{timeout:10000});const culled=await snapshot();
    const visibility=await page.evaluate(async hash=>{const r=frameEngine.renderer,m=frameEngine.scene.meshes.find(m=>m.hashId===hash),p=(m.parts||[m])[0],edges=m.paged?p.edgeCount:m.edgeCounts[0],read=r.device.createBuffer({size:64,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{const e=r.device.createCommandEncoder();e.copyBufferToBuffer(p.nativeSurfaceLines.visibility,0,read,0,32);e.copyBufferToBuffer(p.nativeSurfaceLines.triangles,0,read,32,32);r.device.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);const header=Array.from(new Uint32Array(read.getMappedRange()));read.unmap();return {edges,visible:header[5],drawn:header[0]/2,instances:header[1],overflow:header[4],triangles:p.count/3,visibleTriangles:header[13],triangleOverflow:header[12],drawnTriangles:header[8]/3,bytes:64};}finally{read.destroy();}},mesh.hash);
    if(visibility.overflow)overflowCases++;else compactedCases++;check(storage+' '+index+' subpixel workload actually rejects edges at '+phase+' size '+size,visibility.drawn===(visibility.overflow?visibility.edges:visibility.visible)&&visibility.visible>0&&visibility.visible<visibility.edges*.9&&visibility.drawnTriangles===(visibility.triangleOverflow?visibility.triangles:visibility.visibleTriangles)&&visibility.visibleTriangles>0&&visibility.visibleTriangles<visibility.triangles*.9,visibility);
    await page.evaluate(()=>{frameEngine.renderer.nativeSurfaceLines.cullPipeline=null;});const original=await snapshot();check(storage+' '+index+' tiny strokes remain nonempty at '+phase,original.blackPixels>0,original.blackPixels);check(storage+' '+index+' subpixel color/IDs remain byte-exact at '+phase,JSON.stringify(culled.hashes)===JSON.stringify(original.hashes),{culled,original});await page.evaluate(()=>{frameEngine.renderer.nativeSurfaceLines.cullPipeline=__testLineCulling;});
   }
  }
  check('Both compacted and overflow-safe streams preserve native pixels',compactedCases>0&&overflowCases>0,{compactedCases,overflowCases});
  // Coplanar overlap crosses several compaction workgroups. The first authored
  // triangle must keep winning depth ties, including its exact picking ID.
  for(const storage of ['auto','texture'])for(const count of [513,4097]){
   await call('scene.new');const vertices=[],indices=[];for(let i=0;i<count;i++){const x=i*.0001;vertices.push(-80+x,-60,0,80+x,-60,0,x,60,0);indices.push(i*3,i*3+2,i*3+1);}const mesh=await call('mesh.create',{storage,vertices,indices});check(storage+' overlap fixture retains all '+count+' authored triangles',mesh.mesh.triangles===count,mesh.mesh);await call('scene.select',{ids:[]});
   for(const index of [0,2]){
    await call('view.set',{index,single:true,shading:'solid-wire',focus:mesh.hash});await page.evaluate(()=>{frameEngine.renderer.nativeSurfaceLines.cullPipeline=__testLineCulling;});await call('diagnostics.frame',{frames:3});const culled=await snapshot();const overflow=await page.evaluate(async hash=>{const r=frameEngine.renderer,m=frameEngine.scene.meshes.find(m=>m.hashId===hash),p=(m.parts||[m])[0],read=r.device.createBuffer({size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{const e=r.device.createCommandEncoder();e.copyBufferToBuffer(p.nativeSurfaceLines.triangles,16,read,0,16);r.device.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);const flag=new Uint32Array(read.getMappedRange())[0];read.unmap();return flag;}finally{read.destroy();}},mesh.hash);check(storage+' '+index+' triangle stream '+count+' uses the expected overflow route',overflow===+(count>1024),{count,overflow});await page.evaluate(()=>{frameEngine.renderer.nativeSurfaceLines.cullPipeline=null;});const original=await snapshot();check(storage+' '+index+' coplanar depth ties retain color and original triangle order',JSON.stringify(culled.hashes)===JSON.stringify(original.hashes),{culled,original});await page.evaluate(()=>{frameEngine.renderer.nativeSurfaceLines.cullPipeline=__testLineCulling;});
   }
  }
  await call('scene.new');return {pass:true,checks,timings};
 }catch(error){return {pass:false,checks,timings,error:error.stack};}
 finally{await page.evaluate(()=>{frameEngine.renderer.nativeSurfaceLines.cullPipeline=__testLineCulling;delete window.__testLineCulling;});}
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const session=await launch({headless:true}),report={pass:false,errors:[]};
 try{const {page}=session;page.on('pageerror',e=>report.errors.push(e.stack));await ready(page);report.adapter=await page.evaluate(()=>{const d=frameEngine.renderer.device;window.__culledErrors=[];d.addEventListener('uncapturederror',e=>__culledErrors.push(e.error.message));d.pushErrorScope('validation');return {vendor:d.adapterInfo.vendor,isFallbackAdapter:d.adapterInfo.isFallbackAdapter};});assert.equal(report.adapter.isFallbackAdapter,false);Object.assign(report,await plainWireCullingBrowserChecks(page));report.gpu=await page.evaluate(async()=>({validation:(await frameEngine.renderer.device.popErrorScope())?.message||null,uncaptured:__culledErrors}));report.pass&&=!report.errors.length&&!report.gpu.validation&&!report.gpu.uncaptured.length;}
 catch(error){report.error=error.stack;}
 finally{await session.close();report.indexSHA256=createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex');await mkdir(new URL('results/',import.meta.url),{recursive:true});await writeFile(new URL('results/plain-wire-culling-browser.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));process.exitCode=report.pass?0:1;}
}
