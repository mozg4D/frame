// Native events and production history in the suite's isolated browser scene.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../tools/browser.mjs';
export async function animationTransactionBrowserChecks(page){
 const checks=[],timings=[],call=(name,args={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[name,args]);
 const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,...detail?{detail}:{}});assert.ok(pass,name+': '+JSON.stringify(detail));};
 try{
  await call('render.stop');await call('scene.new');const object=await call('scene.create',{type:'cube',name:'Animation transaction'});
  for(const [frame,value]of [[0,[0,0,0]],[20,[100,60,20]],[40,[40,90,50]]])await call('animation.key',{id:object.hash,path:'position',frame,value,interpolation:'soft'});
  await call('animation.seek',{frame:0});await call('scene.select',{ids:[object.hash]});await call('view.set',{index:2,single:true,mode:'object',focus:object.hash});
  await page.locator('[data-curves-toggle="position"]').click();await page.waitForFunction(()=>frameCurves.open&&!frameCurves.raf&&frameCurves.channels.length===3);
  const tracks=async()=>JSON.stringify((await call('animation.inspect',{id:object.hash})).channels),before=await tracks();
  const point=await page.evaluate(()=>{const c=frameCurves,r=c.canvas.getBoundingClientRect();return {x:r.x+c.xy(7,0)[0],y:r.y+c.plot.bottom+4,depth:undoStack.length,revision:frameAnimationRevision};});
  const started=performance.now();await page.keyboard.down('Control');try{await page.mouse.click(point.x,point.y);}finally{await page.keyboard.up('Control');}
  const trajectory=await call('animation.trajectory',{id:object.hash}),after=await tracks(),ms=performance.now()-started;
  timings.push({operation:'Native Ctrl-click position insertion',ms,budgetMs:1500});check('Native Ctrl-click insertion completes within 1500 ms',ms<1500,{ms});
  check('Actual pointer event inserts the native position key',trajectory.keys.map(k=>k.frame).join(',')==='0,7,20,40',trajectory.keys);
  const ui=await page.evaluate(()=>({depth:undoStack.length,revision:frameAnimationRevision,selected:frameCurves.selection.map(x=>({...x}))}));
  check('Native insertion has one checkpoint, revision and XYZ selection',ui.depth===point.depth+1&&ui.revision===point.revision+1&&ui.selected.length===3&&ui.selected.every(s=>s.f===7),ui);
  await page.waitForFunction(()=>document.querySelector('.frame-motion[data-view="2"] [data-frame="7"]:not([data-side])'));
  check('Existing motion-path renderer displays the new key',await page.locator('.frame-motion[data-view="2"] [data-frame="7"]:not([data-side])').count()===1);
  await call('edit.history',{action:'undo'});check('Native Undo restores exact authored keys and tangents',await tracks()===before);
  await call('edit.history',{action:'redo'});check('Native Redo restores the inserted key and adjacent tangents',await tracks()===after);
  await call('edit.history',{action:'undo'});
  for(const mode of ['mutate','evaluate']){
   const failure=await page.evaluate(({hash,mode})=>{const n=nodes.find(n=>n.nativeHash===hash),track=frameGetTrack(n.id,'position'),before=JSON.stringify(frameSerializeChannels()),state=snapshot(),history=JSON.stringify([undoStack,redoStack,frameUIUndoSequence,frameUIRedoSequence]),epoch=FrameAuthorData.epoch,revision=frameAnimationRevision,original=frameEvaluateAnimation;let calls=0,error=null;
    if(mode==='evaluate')frameEvaluateAnimation=function(frame){original(frame);if(++calls===1)throw Error('native evaluation regression fault');};
    try{frameAnimationTransaction([{h:n.id,path:'position'}],()=>{frameInsertCurveKey(track,11,0);frameSetKeyComponent(track,track.keys.get(11),0,333);n.params['size x']=177;if(mode==='mutate')throw Error('native mutation regression fault');});}catch(e){error=e.message;}finally{frameEvaluateAnimation=original;}
    return {mode,error,before,after:JSON.stringify(frameSerializeChannels()),historySame:history===JSON.stringify([undoStack,redoStack,frameUIUndoSequence,frameUIRedoSequence]),size:nodes.find(q=>q.nativeHash===hash).params['size x'],expectedSize:JSON.parse(state).nodes.find(q=>q.nativeHash===hash).params['size x'],epochChanged:epoch!==FrameAuthorData.epoch,revisionChanged:revision<frameAnimationRevision,busy:frameUITransaction,calls};
   },{hash:object.hash,mode});
   await call('scene.inspect');check('Native '+mode+' failure restores keys, tangents, attributes and existing Redo',failure.error==='native '+(mode==='mutate'?'mutation':'evaluation')+' regression fault'&&failure.before===failure.after&&failure.historySame&&failure.size===failure.expectedSize&&failure.epochChanged&&failure.revisionChanged&&failure.busy===0&&(mode!=='evaluate'||failure.calls===1),failure);
  }
  await call('edit.history',{action:'redo'});check('Redo remains usable after both failed native edits',await tracks()===after);
  const material=await call('material.create',{name:'Rollback current material',params:{rough:20}});
  await call('animation.key',{id:object.hash,path:'param:size x',frame:0,value:100});await call('animation.key',{id:'mat:'+material.uid,path:'material:rough',frame:0,value:20});
  const current=await page.evaluate(({hash,uid})=>{const n=nodes.find(n=>n.nativeHash===hash),owner='mat:'+uid;frameWriteAttribute(n.id,'param:size x',999);frameWriteAttribute(owner,'material:rough',99);frameEngine.animationTransform(hash,'position',[9,8,7]);const affine=frameEngine.pluginLocal(hash);affine[4]+=.125;frameEngine.pluginSetLocal(hash,affine);const before={frame:JSON.stringify(frameEngine.uiFrames().find(f=>f.hash===hash)),size:n.params['size x'],rough:frameTarget(owner).rough,channels:JSON.stringify(frameSerializeChannels())};let error;try{frameAnimationTransaction([{h:n.id,path:'position'}],()=>{frameInsertCurveKey(frameGetTrack(n.id,'position'),13,0);n.params['size x']=123;throw Error('current-value regression fault');});}catch(e){error=e.message;}return {error,before,after:{frame:JSON.stringify(frameEngine.uiFrames().find(f=>f.hash===hash)),size:node(n.id).params['size x'],rough:frameTarget(owner).rough,channels:JSON.stringify(frameSerializeChannels())}};},{hash:object.hash,uid:material.uid});
  await call('scene.inspect');check('Native failed edit preserves exact unkeyed affine matrix, parameter and material instead of sampled values',current.error==='current-value regression fault'&&JSON.stringify(current.before)===JSON.stringify(current.after),current);
  const frame=await call('diagnostics.frame',{frames:6});timings.push({operation:'Native animation frame sample',frames:frame.frames});check('Native motion paths retain bounded CPU/GPU frame times',frame.timestampQueries&&frame.frames.every(f=>f.cpuMs<50&&f.gpuMs<100),frame);
  return {pass:true,checks,timings};
 }catch(error){return {pass:false,checks,timings,error:error.stack};}finally{await page.keyboard.up('Control');await page.mouse.up();}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const sources=async()=>Object.fromEntries(await Promise.all(['index.html','tests/animation-transaction-browser.mjs'].map(async path=>[path,createHash('sha256').update(await readFile(new URL('../'+path,import.meta.url))).digest('hex')]))),report={sources:await sources(),errors:[],consoleErrors:[]};let session;
 try{session=await launch({headless:process.argv.includes('--headless')});await ready(session.page);session.page.on('pageerror',e=>report.errors.push(e.message));session.page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});report.hardware=await session.page.evaluate(()=>{window.__animationDevice=frameEngine.renderer.device;window.__animationErrors=[];window.__animationLost=null;__animationDevice.pushErrorScope('validation');__animationDevice.addEventListener('uncapturederror',e=>__animationErrors.push(e.error.message));__animationDevice.lost.then(e=>__animationLost={reason:e.reason,message:e.message});return {vendor:__animationDevice.adapterInfo.vendor,architecture:__animationDevice.adapterInfo.architecture,isFallbackAdapter:__animationDevice.adapterInfo.isFallbackAdapter};});assert.equal(report.hardware.isFallbackAdapter,false);Object.assign(report,await animationTransactionBrowserChecks(session.page));report.gpu=await session.page.evaluate(async()=>{await __animationDevice.queue.onSubmittedWorkDone();return {validation:(await __animationDevice.popErrorScope())?.message||null,uncaptured:__animationErrors,lost:__animationLost,changed:__animationDevice!==frameEngine.renderer.device};});report.pass&&=!report.errors.length&&!report.consoleErrors.length&&!report.gpu.validation&&!report.gpu.uncaptured.length&&!report.gpu.lost&&!report.gpu.changed;
 }catch(error){report.pass=false;report.error=error.stack;}finally{await session?.close();report.sourcesAfter=await sources();report.pass&&=JSON.stringify(report.sources)===JSON.stringify(report.sourcesAfter);await mkdir(new URL('./results/',import.meta.url),{recursive:true});await writeFile(new URL('./results/animation-transaction-browser.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));process.exitCode=report.pass?0:1;}
}
