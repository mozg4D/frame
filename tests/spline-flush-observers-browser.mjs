// Native pending-evaluation observers, real edits and failure/history recovery.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {launch,ready} from '../tools/browser.mjs';

const sourceRef=process.argv.find(a=>a.startsWith('--source-ref='))?.slice('--source-ref='.length),source=sourceRef?execFileSync('git',['show',sourceRef+':index.html'],{cwd:new URL('../',import.meta.url),maxBuffer:32*1024*1024}):null;
const sourceHash=async()=>createHash('sha256').update(source||await readFile(new URL('../index.html',import.meta.url))).digest('hex');
const report={pass:false,checks:[],errors:[],timings:[],sourceRef:sourceRef||null,indexSHA256:await sourceHash()};let session;
const check=(name,pass,detail)=>{report.checks.push({name,pass:!!pass,detail});assert.ok(pass,name+': '+JSON.stringify(detail));console.log('PASS',name);};
try{
 session=await launch({headless:true});const {page}=session;if(source){await page.route('**/index.html',route=>route.fulfill({status:200,contentType:'text/html',body:source}));await page.reload();}page.on('pageerror',e=>report.errors.push(e.message));await ready(page);
 report.hardware=await page.evaluate(()=>({vendor:frameEngine.renderer.device.adapterInfo.vendor,fallback:frameEngine.renderer.device.adapterInfo.isFallbackAdapter,dpr:devicePixelRatio}));
 check('Native hardware WebGPU at DPR 1',!!report.hardware.vendor&&!report.hardware.fallback&&report.hardware.dpr===1,report.hardware);
 await page.evaluate(()=>{window.__flushGPU={device:frameEngine.renderer.device,errors:[]};__flushGPU.device.pushErrorScope('validation');__flushGPU.device.addEventListener('uncapturederror',e=>__flushGPU.errors.push(e.error.message));});
 const call=(name,args={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[name,args]);
 await call('scene.new');await call('view.set',{index:0,single:true,mode:'object'});const cube=await call('scene.create',{type:'cube',name:'Study'});await call('scene.select',{ids:[]});
 const baseline=await call('diagnostics.mesh',{id:cube.hash,geometry:true});
 await page.evaluate(()=>{
  window.__flushCounts={};const tree=renderTree,sync=frameEngine.syncObjects,install=frameEngine.installSplineSurface,visibility=frameEngine.updateSplineVisibility;
  renderTree=function(...a){__flushCounts.tree=(__flushCounts.tree||0)+1;return tree.apply(this,a);};
  frameEngine.syncObjects=function(...a){__flushCounts.sync=(__flushCounts.sync||0)+1;return sync.apply(this,a);};
  frameEngine.installSplineSurface=function(...a){__flushCounts.install=(__flushCounts.install||0)+1;return install.apply(this,a);};
  frameEngine.updateSplineVisibility=async function(...a){__flushCounts.passes=(__flushCounts.passes||0)+1;if(window.__flushHold){const h=__flushHold;window.__flushHold=null;h.entered=true;await h.wait;}return visibility.apply(this,a);};
 });
 for(const observers of [1,8]){
  const sample=await page.evaluate(async observers=>{__flushCounts={};const at=performance.now();FrameSpline.request();await Promise.all(Array.from({length:observers},()=>FrameSpline.flush()));return {observers,ms:performance.now()-at,...__flushCounts};},observers);
  report.timings.push(sample);check(observers+' pending observers share one unchanged evaluator pass',sample.passes===1&&sample.tree===1&&sample.sync===2&&!sample.install,sample);
 }
 await page.evaluate(()=>{__flushCounts={};window.__flushHold={entered:false};__flushHold.wait=new Promise(resolve=>__flushHold.release=resolve);window.__heldFlush=__flushHold;FrameSpline.request();window.__flushPending=FrameSpline.flush();});
 await page.waitForFunction(()=>__heldFlush.entered);
 const changed=await page.evaluate(async hash=>{const n=frameCore.resolveOwner(hash);frameCore.transaction(()=>{n.params['size x']=130;});__heldFlush.release();await Promise.all([__flushPending,...Array.from({length:8},()=>FrameSpline.flush())]);return {...__flushCounts};},cube.hash);
 const current=await call('diagnostics.mesh',{id:cube.hash,geometry:true});
 check('A real request during pending evaluation retains the second pass and new geometry',changed.passes===2&&changed.install===1&&current.positionsSHA256!==baseline.positionsSHA256&&Math.abs(current.bounds.max[0]-current.bounds.min[0]-130)<1e-5,{counts:changed,bounds:current.bounds});
 await call('scene.select',{ids:[cube.hash]});
 await page.evaluate(()=>{window.__healthyInstall=frameEngine.installSplineSurface;frameEngine.installSplineSurface=async()=>{throw Error('Injected asynchronous surface publication failure');};__flushCounts={};});
 let failed;try{failed=await call('scene.update',{id:cube.hash,params:{'size x':140}});}finally{await page.evaluate(()=>{frameEngine.installSplineSurface=__healthyInstall;delete window.__healthyInstall;});}
 const failureUI=await page.evaluate(hash=>({signal:JSON.parse(document.querySelector('#frame-engine-canvas').dataset.splineError),row:!!document.querySelector('[data-id="'+frameCore.resolveOwner(hash).id+'"]'),tree:__flushCounts.tree}),cube.hash);
 check('Asynchronous failure remains observable and refreshes the native browser',failed.buildError==='Injected asynchronous surface publication failure'&&failureUI.signal.hash===cube.hash&&failureUI.row&&failureUI.tree>=1,{error:failed.buildError,...failureUI});
 const repaired=await call('scene.update',{id:cube.hash,params:{'size x':150}}),scene=await call('scene.inspect');
 check('Repair publishes geometry and preserves object selection',!repaired.buildError&&scene.selection.objects.includes(cube.hash)&&Math.abs(repaired.bounds.max[0]-repaired.bounds.min[0]-150)<1e-5,repaired.bounds);
 await call('edit.history',{action:'undo'});let state=(await call('scene.inspect')).objects.find(o=>o.hash===cube.hash);
 check('Undo rebuilds the repaired transient-failure state',!state.buildError&&state.params['size x']===140&&state.selected,{hash:state.hash,params:state.params,selected:state.selected,bounds:state.bounds});
 await call('edit.history',{action:'undo'});await call('edit.history',{action:'undo'});state=(await call('scene.inspect')).objects.find(o=>o.hash===cube.hash);const restored=await call('diagnostics.mesh',{id:cube.hash,geometry:true});
 check('Undo restores exact original geometry and owner identity',state.hash===cube.hash&&!state.buildError&&state.params['size x']===100&&restored.positionsSHA256===baseline.positionsSHA256&&restored.indicesSHA256===baseline.indicesSHA256);
 report.gpu=await page.evaluate(async()=>{await __flushGPU.device.queue.onSubmittedWorkDone();return {validation:(await __flushGPU.device.popErrorScope())?.message||null,uncaptured:__flushGPU.errors};});
 report.plugins=await page.evaluate(()=>performance.getEntriesByType('resource').map(e=>e.name).filter(url=>/\/plugins\/.*\.(?:m?js|wasm)(?:\?|$)/.test(url)));
 check('No GPU/page errors or Frame plugin runtime',!report.gpu.validation&&!report.gpu.uncaptured.length&&!report.errors.length&&!report.plugins.length,{gpu:report.gpu,errors:report.errors,plugins:report.plugins});report.pass=true;
}catch(error){report.error=error.stack||String(error);}finally{
 await session?.close();report.indexSHA256After=await sourceHash();if(report.indexSHA256!==report.indexSHA256After){report.pass=false;report.sourceDrift=true;}
 await mkdir(new URL('./results/',import.meta.url),{recursive:true});await writeFile(new URL('./results/spline-flush-observers-browser.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));process.exitCode=report.pass?0:1;
}
