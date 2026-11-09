import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export async function splineDisplaySampleChecks(page,{expectReuse=false}={}){
  const checks=[],check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});if(!pass)throw Object.assign(Error(name),{checks});};
  const call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]);
  await page.evaluate(()=>{window.__sampleDevice=frameEngine.renderer.device;window.__sampleGPU=[];__sampleDevice.addEventListener('uncapturederror',e=>__sampleGPU.push(e.error.message));__sampleDevice.pushErrorScope('validation');});
  await call('scene.open',{url:'tests/scenes/unique-patches.hash'});
  const patch=(await call('scene.inspect')).objects.find(n=>n.type==='spline_patch'),source=patch.sources[0];
  const before=await call('diagnostics.mesh',{id:patch.hash,geometry:true,cells:[0,2303]});
  await call('view.set',{index:2,single:true,mode:'vertex',shading:'solid-isoparms',coordinates:'world',focus:patch.hash});
  const cage=await call('spline.inspect',{id:patch.hash});
  await call('scene.select',{ids:[source],mode:'vertex',components:[Object.keys(cage.data.vertices)[1200]]});
  const started=performance.now();
  await call('scene.update',{id:source,params:{'angle approximation':15}});
  const angleMs=performance.now()-started,updated=await call('spline.inspect',{id:patch.hash}),after=await call('diagnostics.mesh',{id:patch.hash,geometry:true,cells:[0,2303]});
  const threads=await page.evaluate(()=>Math.max(1,(navigator.hardwareConcurrency||2)-1));
  // Preserve failures as observations while still running independent correctness controls.
  checks.push({name:'2304-cell completed global approximation stays below unchanged 5 s',pass:angleMs<5000&&updated.report.workers===Math.min(threads,2304)&&updated.report.affectedCells===2304,detail:{angleMs,report:updated.report}});
  check('display samples are reused only on the optimized source',expectReuse?updated.report.displaySamplesReused===Object.keys(updated.data.segments).length:!updated.report.displaySamplesReused,{count:updated.report.displaySamplesReused||0,edges:Object.keys(updated.data.segments).length});
  const accuracy=JSON.stringify(updated.report.sourceAccuracy);
  let invalidated=false;
  try{
    invalidated=await page.evaluate(source=>{const sourceDisplay=frameEngine.splineDisplays.get(source);if(!sourceDisplay)return false;const rows=[];for(const d of frameEngine.splineDisplays.values()){if(d.data!==sourceDisplay.data||!d.edgeKeys?.size)continue;const id=d.edgeKeys.keys().next().value;rows.push({display:d,id,value:d.edgeKeys.get(id)});d.edgeKeys.set(id,'test-stale-fingerprint');}window.__sampleReuseRestore=rows;return !!rows.length;},source);
    check('stale fingerprint control uses the native source display',invalidated);
    await call('spline.rebuild',{id:patch.hash});
    const fresh=await call('diagnostics.mesh',{id:patch.hash,geometry:true,cells:[0,2303]}),oracle=await call('spline.inspect',{id:patch.hash});
    check('fresh worker sampling is an exact geometry oracle',fresh.positionsSHA256===after.positionsSHA256&&fresh.indicesSHA256===after.indicesSHA256&&fresh.cells.every((c,i)=>c.positionsSHA256===after.cells[i].positionsSHA256),{after,fresh});
    check('fresh worker sampling preserves exact source accuracy',JSON.stringify(oracle.report.sourceAccuracy)===accuracy,{cached:updated.report.sourceAccuracy,fresh:oracle.report.sourceAccuracy});
    check('stale fingerprint rejects sample reuse',!oracle.report.displaySamplesReused,{count:oracle.report.displaySamplesReused||0});
  }finally{
    if(invalidated)await page.evaluate(()=>{for(const r of window.__sampleReuseRestore||[])r.display.edgeKeys.set(r.id,r.value);delete window.__sampleReuseRestore;});
  }
  await call('edit.history',{action:'undo'});
  const undo=await call('diagnostics.mesh',{id:patch.hash,geometry:true,cells:[0,2303]});
  check('approximation remains one exact Undo',undo.positionsSHA256===before.positionsSHA256&&undo.indicesSHA256===before.indicesSHA256,{before,undo});
  const gpu=await page.evaluate(async()=>({validation:(await __sampleDevice.popErrorScope())?.message||null,uncaptured:__sampleGPU,changed:__sampleDevice!==frameEngine.renderer.device}));
  check('sample reuse and fresh oracle have no WebGPU validation error',!gpu.validation&&!gpu.uncaptured.length&&!gpu.changed,gpu);
  return {pass:checks.every(c=>c.pass),checks,angleMs,geometry:{positions:after.positionsSHA256,indices:after.indicesSHA256},sourceAccuracy:updated.report.sourceAccuracy,report:updated.report};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {launch,ready}=await import('../tools/browser.mjs');
  const {mkdir,writeFile,readFile}=await import('node:fs/promises');const {createHash}=await import('node:crypto');
  let session;const report={started:new Date().toISOString(),indexSHA256:createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex'),errors:[],consoleErrors:[]};
  try{session=await launch({headless:process.argv.includes('--headless')});session.page.on('pageerror',e=>report.errors.push(e.stack));session.page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});await ready(session.page);Object.assign(report,await splineDisplaySampleChecks(session.page,{expectReuse:true}));if(report.errors.length||report.consoleErrors.length)report.pass=false;}
  catch(error){report.pass=false;report.error=error.stack;if(error.checks)report.checks=error.checks;}
  finally{await session?.close();report.finished=new Date().toISOString();await mkdir(new URL('./results/',import.meta.url),{recursive:true});await writeFile(new URL('./results/spline-display-samples.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));process.exitCode=report.pass?0:1;}
}
