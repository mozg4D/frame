import {launch,ready} from '../tools/browser.mjs';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';

// Standalone hardware benchmark: --count=1000|10000, or --scene=...hash with
// sibling JSON metadata (--metadata=... overrides it). --phase=frames,
// operations, additional or all. --profile records native main-thread CPU
// profiles; --compare=...json compares identical fixture bytes only. Every run
// snapshots its HTML source. --save-scene=...hash exports a framed native scene.
// --verify-saved-scene reopens exported bytes after normal timing and replaces
// the output only after exact owner/material/geometry/camera checks pass.
// To stop one owned run safely, write a reason to its report's ".stop" file.
//
// Run from the checkout root. Default DPR is 1; --source=...html selects an
// immutable application snapshot, otherwise this checkout's index.html is used.
// A final engineering workload can be run with:
// node tests/performance-zoo-10k.mjs --headless
//   --scene=tests/scenes/engineering-zoo-10k.hash --phase=all --frames=16 --rounds=1
//   --profile --initial-renderer-control --renderer-compare=<original-renderer.json>
//   --live-coverage --gizmo-target=sceneRoot,primitive --allocation-profile
//   --gc-diagnostic --label=engineering-final --save-scene=<framed-authoring.hash>
// Renderer control reports use the initial HASH camera and never call mutating
// editor APIs; the main ALL report uses its separately recorded framed camera.
// --phase=renderer measures those camera-matched frames/navigation on its own.
// --phase=capture performs only readiness/final frames for diagnostic runs.
// --phase=targeted measures framed Solid/Iso frames, one unchanged flush,
// one dense-child numeric Move/Undo and one physical Move/Undo. A recorded
// --renderer-camera=<factorial-report.json> makes the initial framing exact.
// --allocation-profile reports actual tracked GPU labels and history ownership.
// Forced GC runs only after normal workflow timing/export and is marked diagnostic.
// --geometry-digests reads all canonical GPU meshes after normal timing;
// --geometry-ids=a,b narrows this to explicit hashes; --geometry-raw also saves
// temporary-readback binaries and authoring cages. --worker-parity adds lossless
// test-only worker snapshots for those hashes. These captures are not gain tests.
const resultDirectory=new URL('./results/',import.meta.url);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function distribution(values){
 const sorted=values.filter(Number.isFinite).toSorted((a,b)=>a-b);
 return {samples:sorted.length,median:sorted.length?sorted[sorted.length>>1]:null,p95:sorted.length?sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))]:null,max:sorted.at(-1)??null};
}
const near=(a,b,tolerance=1e-7)=>!!a&&!!b&&a.length===b.length&&a.every((x,i)=>Math.abs(x-b[i])<=tolerance*Math.max(1,Math.abs(x),Math.abs(b[i])));
function compareReports(before,after){
 if(before.fixtureSHA256!==after.fixtureSHA256)return {comparable:false,reason:'Fixture SHA-256 differs',beforeFixtureSHA256:before.fixtureSHA256,afterFixtureSHA256:after.fixtureSHA256};
 if((before.phase==='renderer'||after.phase==='renderer')&&(before.phase!==after.phase||!near(before.camera,after.camera)||!near(before.rendererOnly?.initialNativeCamera,after.rendererOnly?.initialNativeCamera)))return {comparable:false,reason:'Renderer-only comparison requires matching phases and normalized/native initial cameras',beforeCamera:before.camera,afterCamera:after.camera,beforeNativeCamera:before.rendererOnly?.initialNativeCamera,afterNativeCamera:after.rendererOnly?.initialNativeCamera};
 const ratio=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&b>0?{beforeMs:b,afterMs:a,speedup:b/a}:null;
 const groups={};
 for(const row of after.operations.filter(x=>x.completed!==false)){const old=before.operations.filter(x=>x.name===row.name&&x.completed!==false);if(!old.length||groups[row.name])continue;groups[row.name]=ratio(distribution(after.operations.filter(x=>x.name===row.name&&x.completed!==false).map(x=>x.ms)).median,distribution(old.map(x=>x.ms)).median);}
 return {comparable:true,sourceSHA256:before.sourceSHA256,operations:groups,frames:Object.fromEntries(Object.entries(after.frames).flatMap(([name,row])=>before.frames?.[name]?[[name,{cpu:ratio(row.cpu.median,before.frames[name].cpu.median),gpu:ratio(row.gpu.median,before.frames[name].gpu.median)}]]:[]))};
}

/** Measures completed native operations. GPU frame timers alone omit input/editor/evaluator work. */
export async function zooPerformanceChecks(page,metadata,{phase='all',frames=16,rounds=3,compareBundles=false,transformTargets=null,gizmoTarget='primitive',liveCoverage=false,codecCopyControl=false,rendererCamera=null,rendererNativeCamera=null,onProgress=async()=>{},profileSection=async(name,fn)=>fn()}={}){
 const renderOnly=phase==='renderer'||phase==='capture';
 const report={pass:false,phase,count:metadata.count??metadata.objects?.length,checks:[],operations:[],frames:{},navigation:{},stages:[],errors:[]};
 const call=(name,args={})=>{if(renderOnly&&name!=='diagnostics.frame')throw Error('Renderer-only benchmark cannot call editor API '+name);return page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]);};
 const check=(name,pass,detail)=>{report.checks.push({name,pass:!!pass,...detail===undefined?{}:{detail}});if(!pass)throw Error(name+': '+JSON.stringify(detail));};
 const stage=async name=>{report.stages.push({name,at:new Date().toISOString()});console.log('[zoo] '+name);await onProgress(report);};
 const measure=async(name,fn)=>{const started=performance.now();let completed=false;try{const value=await fn();completed=true;return value;}finally{const ms=performance.now()-started;report.operations.push({name,ms,completed});if(ms>=1000)console.log('[zoo] '+name+' '+(completed?'completed':'interrupted')+' '+Math.round(ms)+' ms');await onProgress(report);}};
 const state=()=>call('scene.inspect');
 const get=async hash=>(await state()).objects.find(n=>n.hash===hash);
 const captureAffineResources=(label,hash)=>page.evaluate(({label,hash})=>{const refs=new Map();for(const m of frameEngine.scene.meshes)if(label==='sceneRoot'||m.hashId===hash){let row=refs.get(m.hashId);if(!row)refs.set(m.hashId,row=[]);row.push([m.positions,m.indices]);}window.__zooAffineResources=refs;},{label,hash});
 const verifyAffineResources=async name=>{const resources=await page.evaluate(()=>{const refs=window.__zooAffineResources,current=new Map();for(const m of frameEngine.scene.meshes)if(refs.has(m.hashId)){let row=current.get(m.hashId);if(!row)current.set(m.hashId,row=[]);row.push(m);}const changed=[];for(const [hash,rows]of refs)if(rows.length!==(current.get(hash)?.length||0)||rows.some(([positions,indices])=>!current.get(hash)?.some(m=>m.positions===positions&&m.indices===indices)))changed.push(hash);window.__zooAffineResources=null;return {owners:refs.size,changed:changed.slice(0,20),changedCount:changed.length};});check(name+' preserves canonical geometry resources',resources.owners>0&&!resources.changedCount,resources);};
 const history=action=>measure('history.'+action,()=>call('edit.history',{action}));
 const settleGPU=()=>page.evaluate(()=>frameEngine.renderer.device.queue.onSubmittedWorkDone());
 const frameSample=async(name,count=frames)=>{
  const readinessStarted=performance.now();
  for(let i=0;i<3;i++){
   await page.evaluate(async()=>{const r=frameEngine.renderer,m=r.materialState;await m?.assetsReady;await Promise.all(m?.pending.values()||[]);await Promise.all([r.nativeSurfaceLinesInit,r.wireRasterInit].filter(Boolean));});
   await call('diagnostics.frame',{frames:2});
   await page.waitForFunction(()=>{const r=frameEngine.renderer,m=r.materialState;return !(m?.pending?.size||m?.replicaPending?.size)&&[...(r.plainWireSurfaces?.values()||[])].every(row=>!!row.pipeline);},{},{timeout:30000});
  }
  const readinessMs=performance.now()-readinessStarted,data=await measure('frames.'+name,()=>call('diagnostics.frame',{frames:count}));report.frames[name]={...data,readinessMs,materialsReady:true,pipelinesReady:true,cpu:distribution(data.frames.map(f=>f.cpuMs)),gpu:distribution(data.frames.map(f=>f.gpuMs))};check(name+' collects real GPU timestamps',data.timestampQueries&&data.frames.every(f=>Number.isFinite(f.cpuMs)&&f.gpuMs>0),{timestampQueries:data.timestampQueries,samples:data.frames.length});await onProgress(report);return data;
 };
 const handles=metadata.handles||{};
 const recordStart=()=>page.evaluate(()=>{window.__zooRecording={active:true,samples:[],seen:new Set([frameEngine.renderer.lastFrameRaw?.id]),start:performance.now()};const sample=()=>{const r=window.__zooRecording;if(!r?.active)return;const f=frameEngine.renderer.lastFrameRaw;if(f&&!r.seen.has(f.id)){r.seen.add(f.id);r.samples.push({...f,wallMs:performance.now()-r.start});}requestAnimationFrame(sample);};requestAnimationFrame(sample);});
 const recordStop=()=>page.evaluate(()=>{const r=window.__zooRecording;r.active=false;return {elapsedMs:performance.now()-r.start,frames:r.samples};});
 let originalCamera;
 try{
  await stage(renderOnly?'Renderer-only native fixture readiness':'Inspecting native fixture');
  const initial=renderOnly?await page.evaluate(()=>({objects:nodes.map(n=>({hash:n.nativeHash,type:n.type,buildError:n.splineError})),materials:materials.map(m=>({uid:m.uid})),stats:{meshes:frameEngine.scene.meshes.length,triangles:frameEngine.scene.meshes.reduce((sum,m)=>sum+(m.triangleCount||0),0)}})):await profileSection('inspect',()=>measure('scene.inspect',state));report.initial={stats:initial.stats,objects:initial.objects.length,materials:initial.materials.length,types:Object.fromEntries([...new Set(initial.objects.map(n=>n.type))].map(t=>[t,initial.objects.filter(n=>n.type===t).length]))};
  check('Every authored fixture object is present',initial.objects.length===(metadata.count??metadata.objects?.length),{actual:initial.objects.length,expected:metadata.count??metadata.objects?.length});
  check('Native generators completed without build errors',!initial.objects.some(n=>n.buildError),initial.objects.filter(n=>n.buildError).map(({hash,type,buildError})=>({hash,type,buildError})));
  if(renderOnly){if(rendererCamera)await page.waitForFunction(camera=>frameEngine.restoreViewState(camera),rendererCamera,{timeout:30000});originalCamera=await page.evaluate(()=>frameEngine.viewCamera(0).camera);report.rendererOnly={editorAPIs:false,cameraSpace:'normalized-renderer',initialNativeCamera:await page.evaluate(()=>Array.from(frameEngine.viewState))};if(rendererCamera)check('Renderer framing matches requested normalized and native cameras',near(originalCamera,rendererCamera)&&near(report.rendererOnly.initialNativeCamera.slice(0,12),rendererNativeCamera?.slice(0,12)),{normalized:originalCamera,native:report.rendererOnly.initialNativeCamera});}
  else if(phase==='targeted'&&rendererCamera){await page.waitForFunction(camera=>frameEngine.restoreViewState(camera),rendererCamera,{timeout:30000});originalCamera=await page.evaluate(()=>Array.from(frameEngine.viewState));report.normalizedCamera=await page.evaluate(()=>Array.from(frameEngine.viewCamera(0).camera));check('Targeted framing matches recorded normalized and native cameras',near(report.normalizedCamera,rendererCamera)&&near(originalCamera,rendererNativeCamera),{normalized:report.normalizedCamera,native:originalCamera});}
  else{const roots=initial.objects.filter(n=>!n.parent).map(n=>n.hash);await call('view.set',{index:0,single:true,mode:'object',shading:'solid',snap:false,quantize:false,pivot:false});await call('scene.select',{ids:roots});originalCamera=(await call('view.set',{focusSelection:true})).camera;await call('scene.select',{ids:[]});}
  report.camera=originalCamera;
  const restoreNavigationCamera=()=>renderOnly?page.waitForFunction(camera=>frameEngine.restoreViewState(camera),originalCamera,{timeout:30000}):call('view.set',{camera:originalCamera});
  if(phase==='tail')await profileSection('engineeringTail',async()=>{
   const {zooLiveCoverageChecks}=await import('./performance-engineering-workflows.mjs');report.liveCoverage=await zooLiveCoverageChecks(page,metadata,{call,check,stage,measure,history,state,get,originalCamera,tailOnly:true});check('Engineering tail coverage completes',report.liveCoverage.pass,{error:report.liveCoverage.error,activeCase:report.liveCoverage.activeCase});
   await stage('Tail native HASH serialization and reload');await call('scene.select',{ids:[]});await call('view.set',{mode:'object',camera:originalCamera});
   const before=await state(),initialTypes=new Map(initial.objects.map(n=>[n.hash,n.type]));check('Tail restores every frozen authored owner and type before export',before.objects.length===initial.objects.length&&before.objects.every(n=>initialTypes.get(n.hash)===n.type));
   const exported=await measure('scene.export',()=>call('scene.export',{includeData:true}));report.serializedBytes=exported.bytes;check('Tail HASH export produces native data',exported.bytes>0&&!!exported.base64);
   await measure('scene.reopen',()=>call('scene.open',{base64:exported.base64,name:'engineering-tail-roundtrip.hash'}));const after=await state();check('Tail HASH retains every authored owner and type',after.objects.length===before.objects.length&&after.objects.every(n=>initialTypes.get(n.hash)===n.type));check('Tail HASH retains material count',before.materials.length===after.materials.length);check('Tail HASH rebuilds without generator errors',!after.objects.some(n=>n.buildError));
  });
  if(phase==='targeted'){
   report.scope='Matched framed renderer samples, unchanged flush, dense-child numeric Move and physical Move, each restored; not a full application run.';
   const evaluationSnapshot=(label,baseline=false)=>page.evaluate(({label,baseline,hash})=>{
    const owner=nodes.find(n=>n.nativeHash===hash),state=owner&&FrameSpline.states.get(owner.id),meshes=frameEngine.scene.meshes;
    const small=(value,depth=0)=>{if(value===null||typeof value!=='object')return value;if(Array.isArray(value)||ArrayBuffer.isView(value))return {omittedArrayLength:value.length};if(depth>=5)return {omittedObjectKeys:Object.keys(value).length};return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,small(item,depth+1)]));};
    const previous=window.__zooEvaluationReference;if(baseline)window.__zooEvaluationReference=new Map(meshes.map(m=>[m,[m.positions,m.indices,m.version,m.replicaVersion]]));
    const counts={rows:meshes.length,canonical:0,added:0,removed:0,positionsChanged:0,indicesChanged:0,versionChanged:0,replicaVersionChanged:0,unchanged:0};const current=new Set(meshes);
    for(const m of meshes){if(!m.replicaMatrix)counts.canonical++;if(baseline||!previous)continue;const old=previous.get(m);if(!old){counts.added++;continue;}const p=old[0]!==m.positions,i=old[1]!==m.indices,v=old[2]!==m.version,r=old[3]!==m.replicaVersion;counts.positionsChanged+=+p;counts.indicesChanged+=+i;counts.versionChanged+=+v;counts.replicaVersionChanged+=+r;if(!p&&!i&&!v&&!r)counts.unchanged++;}if(!baseline&&previous)for(const m of previous.keys())if(!current.has(m))counts.removed++;
    const result={label,hash,type:owner?.type,report:small(state?.report??null),geometry:counts,patchMeshes:meshes.filter(m=>m.hashId===hash).map(m=>({version:m.version,replicaVersion:m.replicaVersion,vertices:m.vertexCount,triangles:m.triangleCount,replica:!!m.replicaMatrix}))};if(!baseline)delete window.__zooEvaluationReference;return result;
   },{label,baseline,hash:handles.densePatch});
   await profileSection('targetedFrames',async()=>{for(const shading of ['solid','solid-isoparms']){await stage('Targeted framed '+shading);await page.evaluate(shading=>frameEngine.setViewerMode('shading',shading),shading);await frameSample(shading);}});
   await profileSection('targetedUnchanged',async()=>{await stage('Targeted unchanged evaluator flush');await measure('evaluation.unchanged',()=>page.evaluate(async()=>{FrameSpline.request();await FrameSpline.flush();}));});
   await profileSection('targetedNumeric',async()=>{
    await stage('Targeted dense-child numeric Move and Undo');const hash=handles.denseChildSpline;check('Targeted fixture exposes dense child source',!!hash);
    await call('scene.select',{ids:[]});await call('view.set',{mode:'object',coordinates:'world',snap:false,quantize:false,pivot:false});
    const before=await get(hash),sourceBefore=(await call('spline.inspect',{id:hash})).data,parentBefore=before.parent?await get(before.parent):null,pivot=before.pivot.slice(9,12),world=before.worldMatrix,worldX=world[12]+world[0]*pivot[0]+world[4]*pivot[1]+world[8]*pivot[2],step=Math.max(.1,Math.min(5,(before.bounds.max[0]-before.bounds.min[0])*.05));
    const evaluationBefore=await evaluationSnapshot('numeric.before',true);await measure('transform.denseChildSpline',()=>call('transform.set',{ids:[hash],channel:'position',axis:0,value:worldX+step,coordinates:'world'}));report.targetedDiagnostics={numeric:{before:evaluationBefore,after:await evaluationSnapshot('numeric.after')}};const after=await get(hash);check('Targeted numeric Move changes its authored frame',!near(before.matrix,after.matrix),{before:before.matrix,after:after.matrix});if(parentBefore)check('Targeted numeric Move preserves parent pivot',near(parentBefore.pivot,(await get(parentBefore.hash)).pivot));
    await history('undo');check('Targeted numeric Undo restores exact affine frame',JSON.stringify(before.matrix)===JSON.stringify((await get(hash)).matrix));check('Targeted numeric Undo restores exact source controls',JSON.stringify(sourceBefore)===JSON.stringify((await call('spline.inspect',{id:hash})).data));
   });
   await profileSection('targetedLive',async()=>{const {zooLiveCoverageChecks}=await import('./performance-engineering-workflows.mjs');report.liveCoverage=await zooLiveCoverageChecks(page,metadata,{call,check,stage,measure,history,state,get,originalCamera,gestureOnly:true,evaluationSnapshot});check('One dense-child live Move and Undo completes',report.liveCoverage.pass,{error:report.liveCoverage.error,activeCase:report.liveCoverage.activeCase});});
   const final=await state(),initialTypes=new Map(initial.objects.map(n=>[n.hash,n.type]));check('Targeted operations preserve every original authored owner and type',final.objects.length===initial.objects.length&&final.objects.every(n=>initialTypes.get(n.hash)===n.type));check('Targeted operations leave every native generator healthy',!final.objects.some(n=>n.buildError),final.objects.filter(n=>n.buildError).map(({hash,type,buildError})=>({hash,type,buildError})));
  }
  if(codecCopyControl)await profileSection('codecCopyControl',async()=>{const {splineCodecCopyChecks}=await import('./spline-codec-copy-browser.mjs');report.codecCopyControl=await splineCodecCopyChecks(page,metadata,{call,check,stage,measure,history,state});check('Native spline codec copy control completes',report.codecCopyControl.pass,{error:report.codecCopyControl.error});});
  if(phase==='codec'&&liveCoverage)await profileSection('liveCoverage',async()=>{const {zooLiveCoverageChecks}=await import('./performance-engineering-workflows.mjs');report.liveCoverage=await zooLiveCoverageChecks(page,metadata,{call,check,stage,measure,history,state,get,originalCamera});check('Targeted engineering workflow coverage completes',report.liveCoverage.pass,{error:report.liveCoverage.error,activeCase:report.liveCoverage.activeCase});});
  if(phase==='all'||phase==='frames'||phase==='renderer')await profileSection('navigation',async()=>{
   for(const shading of ['solid','solid-isoparms']){
    await stage(shading+' warmup and native navigation');
    if(phase==='renderer'){await restoreNavigationCamera();await page.evaluate(shading=>frameEngine.setViewerMode('shading',shading),shading);}else await call('view.set',{camera:originalCamera,index:0,single:true,mode:'object',shading});await call('diagnostics.frame',{frames:8});await frameSample(shading);
    const rect=await page.locator('#frame-engine-canvas').boundingBox(),at=[rect.x+rect.width*.58,rect.y+rect.height*.46];
    for(const operation of ['orbit','pan','zoom']){
     await restoreNavigationCamera();const samples=[],historyBefore=await page.evaluate(()=>({undo:undoStack.length,redo:redoStack.length,uiUndo:frameUIUndoSequence.length,uiRedo:frameUIRedoSequence.length}));
     for(let round=0;round<rounds;round++){
      await page.mouse.move(...at);await recordStart();
      await measure('navigation.'+shading+'.'+operation,async()=>{
       if(operation==='zoom'){for(let i=0;i<8;i++)await page.mouse.wheel(0,i<4?-35:35);}
       else{const button=operation==='pan'?'middle':'left';await page.mouse.down({button});await page.mouse.move(at[0]+55,at[1]+32,{steps:16});await page.mouse.up({button});}
       await call('diagnostics.frame',{frames:1});await settleGPU();
      });
      const recording=await recordStop();samples.push({...recording,cpu:distribution(recording.frames.map(f=>f.cpuMs)),gpu:distribution(recording.frames.map(f=>f.gpuMs))});
     }
     report.navigation[shading+'.'+operation]=samples;
     const after=phase==='renderer'?await page.evaluate(()=>frameEngine.viewCamera(0).camera):(await call('view.set',{})).camera,historyAfter=await page.evaluate(()=>({undo:undoStack.length,redo:redoStack.length,uiUndo:frameUIUndoSequence.length,uiRedo:frameUIRedoSequence.length}));
     check(shading+' '+operation+' changes the native camera',!near(originalCamera,after));
     check(shading+' '+operation+' creates no history',JSON.stringify(historyBefore)===JSON.stringify(historyAfter),{before:historyBefore,after:historyAfter});
    }
    await restoreNavigationCamera();
   }
  });
  if(compareBundles)await profileSection('bundleComparison',async()=>{
   await stage('Same-source ordinary and cached command comparison');
   report.bundleComparison={};
   await page.evaluate(()=>{window.__zooBundleExecute=GPURenderPassEncoder.prototype.executeBundles;GPURenderPassEncoder.prototype.executeBundles=function(...args){window.__zooBundleExecutions=(window.__zooBundleExecutions||0)+1;return __zooBundleExecute.apply(this,args);};});
   try{for(const shading of ['solid','solid-isoparms']){
    await call('view.set',{index:0,single:true,mode:'object',camera:originalCamera,shading});
    const row={};for(const ordinary of [true,false]){await page.evaluate(ordinary=>{window.__bundleOrdinary=ordinary;window.__zooBundleExecutions=0;},ordinary);await frameSample('bundle.'+shading+'.'+(ordinary?'ordinary':'cached'),16);row[ordinary?'ordinary':'cached']={executions:await page.evaluate(()=>__zooBundleExecutions),frame:report.frames['bundle.'+shading+'.'+(ordinary?'ordinary':'cached')]};}
    check(shading+' comparison executes real cached commands and ordinary control',row.ordinary.executions===0&&row.cached.executions>0,{ordinary:row.ordinary.executions,cached:row.cached.executions});report.bundleComparison[shading]=row;
   }}finally{await page.evaluate(()=>{window.__bundleOrdinary=false;GPURenderPassEncoder.prototype.executeBundles=__zooBundleExecute;});}
  });
  if(phase==='all'||phase==='operations'||phase==='transforms')await profileSection('operations',async()=>{
   await stage('Selection and hierarchy transforms');
   await call('view.set',{camera:originalCamera,shading:'solid',mode:'object'});
   const transformHandles={sceneRoot:handles.root,group:handles.group,primitive:handles.primitive,deepChild:handles.deepChild,childSpline:handles.childSpline,denseChildSpline:handles.denseChildSpline,instance:handles.instance,instanceSource:handles.instanceSource,booleanOperand:handles.booleanOperand,clonerSource:handles.clonerSource},selectTargets=(phase==='transforms'?Object.entries(transformHandles).filter(([key])=>!transformTargets||transformTargets.includes(key)).map(([,hash])=>hash):[handles.primitive,handles.patch,handles.densePatch,handles.instance,handles.group]).filter(Boolean);
   for(let i=0;i<rounds;i++)for(const hash of selectTargets)await measure('selection.'+(initial.objects.find(n=>n.hash===hash)?.type||'object'),()=>call('scene.select',{ids:[hash]}));
   if(phase!=='transforms')await measure('selection.all',()=>call('scene.select',{ids:initial.objects.map(n=>n.hash)}));
   await measure('selection.clear',()=>call('scene.select',{ids:[]}));
   for(const [label,hash]of Object.entries(transformHandles).filter(([label,hash])=>hash&&(!transformTargets||transformTargets.includes(label)))){
    await stage('Transform '+label);
    const before=await get(hash),parentBefore=before.parent?await get(before.parent):null,pivot=before.pivot.slice(9,12),world=before.worldMatrix,worldX=world[12]+world[0]*pivot[0]+world[4]*pivot[1]+world[8]*pivot[2],step=Math.max(.1,Math.min(5,(before.bounds.max[0]-before.bounds.min[0])*.05));let movedState;
    for(let round=0;round<rounds;round++){
     if(['sceneRoot','primitive','instance'].includes(label))await captureAffineResources(label,hash);
     movedState=await measure('transform.'+label,()=>call('transform.set',{ids:[hash],channel:'position',axis:0,value:worldX+step*(round+1),coordinates:'world'}));
     const after=await get(hash);check(label+' changes its affine frame',!near(before.matrix,after.matrix),{before:before.matrix,after:after.matrix});
     if(['sceneRoot','primitive','instance'].includes(label))await verifyAffineResources(label+' affine move');
     if(parentBefore)check(label+' preserves its parent pivot',near(parentBefore.pivot,(await get(parentBefore.hash)).pivot));
     await history('undo');check(label+' Undo restores its affine frame',near(before.matrix,(await get(hash)).matrix));
    }
    if(['sceneRoot','primitive','instance'].includes(label))await captureAffineResources(label,hash);
    await measure('rotate.'+label,()=>call('transform.set',{ids:[hash],channel:'rotation',axis:1,value:movedState.rotation[1]+17,coordinates:'world'}));if(['sceneRoot','primitive','instance'].includes(label))await verifyAffineResources(label+' affine rotation');await history('undo');
    if(['sceneRoot','primitive','instance'].includes(label)){await captureAffineResources(label,hash);const transformed=await measure('scale.'+label,()=>call('transform.set',{ids:[hash],channel:'size',axis:0,value:Math.max(movedState.size[0],.1)*1.01,coordinates:'object'}));check(label+' scaling completes',Number.isFinite(transformed.size?.[0]),transformed);await verifyAffineResources(label+' affine scale');await history('undo');}
   }
   for(const gizmoName of gizmoTarget.split(',')){const gizmoHash=gizmoName==='sceneRoot'?handles.root:handles[gizmoName];if(!gizmoHash)continue;
    await stage('Native gizmo input'+(gizmoTarget.includes(',')?' '+gizmoName:''));
    await call('view.set',{focus:gizmoHash,mode:'object',index:0});await call('scene.select',{ids:[gizmoHash]});await call('diagnostics.frame',{frames:1});
    const before=await get(gizmoHash),at=await page.evaluate(()=>frameEngine.gizmoState?.handles.find(h=>h.part==='move0')?.suggested);if(gizmoName==='sceneRoot')await captureAffineResources('sceneRoot',gizmoHash);
    check('Native transform exposes a usable gizmo',Array.isArray(at),at);await recordStart();
    await measure('transform.nativeGizmo'+(gizmoTarget.includes(',')?'.'+gizmoName:''),async()=>{await page.mouse.move(...at);await page.mouse.down();await page.mouse.move(at[0]+48,at[1]+8,{steps:20});await page.mouse.up();await page.waitForFunction(()=>!frameEngine.transforming);await call('diagnostics.frame',{frames:1});});
    report.navigation[gizmoTarget.includes(',')?'nativeGizmo.'+gizmoName:'nativeGizmo']=await recordStop();check('Native gizmo changes the authored frame',!near(before.matrix,(await get(gizmoHash)).matrix));if(gizmoName==='sceneRoot')await verifyAffineResources('Whole-root live gizmo');await history('undo');check('Native gizmo Undo restores the authored frame',near(before.matrix,(await get(gizmoHash)).matrix));
    await call('view.set',{camera:originalCamera});
   }
   if(phase==='transforms'){if(liveCoverage){const {zooLiveCoverageChecks}=await import('./performance-engineering-workflows.mjs');report.liveCoverage=await zooLiveCoverageChecks(page,metadata,{call,check,stage,measure,history,state,get,originalCamera});check('Targeted engineering workflow coverage completes',report.liveCoverage.pass,{error:report.liveCoverage.error,activeCase:report.liveCoverage.activeCase});}return;}
   await stage('Generator parameter rebuilds');
   for(const [label,hash]of Object.entries({primitive:handles.primitive,extrude:handles.extrude,lathe:handles.lathe,sweep:handles.sweep,cloner:handles.cloner,symmetry:handles.symmetry,boolean:handles.boolean}).filter(([,hash])=>hash)){
    await stage('Parameter rebuild '+label);
    const before=await get(hash),preferred={extrude:'offset',lathe:'angle',cloner:before.params.type==='matrix'?'count x':'count',boolean:'op',sweep:'movement',symmetry:'X'}[label],key=preferred&&Object.hasOwn(before.params,preferred)?preferred:Object.keys(before.params).find(k=>typeof before.params[k]==='number'&&!/approximation|axis|segments|seed|count/.test(k));
    check(label+' exposes an editable generator parameter',!!key);
    const value=before.params[key];let next;
    if(typeof value==='number')next=key==='angle'?(value>=359?value-1:value+1):/count|segments|copies|resolution/.test(key)?Math.max(1,Math.round(value)+1):value===0?1:value*1.01;
    else if(typeof value==='boolean')next=!value;
    else{const catalogue=await call('scene.catalogue',{type:before.type,params:before.params});next=catalogue.choices[key]?.find(v=>v!==value);check(label+' exposes an alternative parameter choice',next!==undefined,{key,choices:catalogue.choices[key]});}
    await measure('parameter.'+label,()=>call('scene.update',{id:hash,params:{[key]:next}}));const changed=await get(hash);check(label+' parameter rebuild settles',!changed.buildError&&changed.params[key]===next,{key,before:value,after:changed.params[key],buildError:changed.buildError});await history('undo');check(label+' parameter Undo restores authored value',(await get(hash)).params[key]===value);
   }
   if(handles.denseChildSpline||handles.childSpline){
    await stage('Spline control edits and component selection');
    const hash=handles.denseChildSpline||handles.childSpline,before=await call('spline.inspect',{id:hash}),data=structuredClone(before.data),vertex=Object.keys(data.vertices)[0];data.vertices[vertex][1]+=.25;
    await measure('spline.replace.child',()=>call('spline.replace',{id:hash,data}));check('Spline cage edit reaches the authored source',Math.abs((await call('spline.inspect',{id:hash})).data.vertices[vertex][1]-data.vertices[vertex][1])<1e-10);await history('undo');check('Spline cage Undo restores the exact controls',JSON.stringify((await call('spline.inspect',{id:hash})).data)===JSON.stringify(before.data));
    for(const mode of ['vertex','edge','polygon']){const components=mode==='vertex'?[vertex]:mode==='edge'?[Object.keys(data.segments)[0]]:[];await measure('components.'+mode,()=>call('scene.select',{ids:[hash],mode,components}));await frameSample('components.'+mode,4);}
    await call('view.set',{mode:'object'});
   }
   if(handles.primitive){
    await stage('Copy, deletion, visibility, reparent and history');const hash=handles.primitive,before=await get(hash),count=initial.objects.length;
    const copied=await measure('scene.duplicate',()=>call('scene.duplicate',{ids:[hash]}));check('Independent native copy creates new owners',copied.objects.length>0&&copied.objects.every(n=>n.hash!==hash));await history('undo');check('Duplicate Undo restores exact author count',(await state()).objects.length===count);await history('redo');check('Duplicate Redo restores its owners',(await state()).objects.length>count);await history('undo');
    await measure('scene.delete',()=>call('scene.delete',{ids:[hash]}));check('Deletion removes native owner',!(await get(hash)));await history('undo');check('Deletion Undo restores world placement',near(before.worldMatrix,(await get(hash)).worldMatrix));
    await measure('visibility.hide',()=>call('scene.update',{id:hash,visible:false}));check('Visibility is authored as hidden',!(await get(hash)).visible);await history('undo');
    if(before.parent){await measure('hierarchy.reparentRoot',()=>call('scene.update',{id:hash,parent:''}));const after=await get(hash);check('Reparent keeps full world affine frame',!after.parent&&near(before.worldMatrix,after.worldMatrix));await history('undo');}
   }
   if(handles.deepGroup||handles.extrude){
    const hash=handles.deepGroup||handles.extrude,before=await state(),copied=await measure('scene.duplicate.hierarchy',()=>call('scene.duplicate',{ids:[hash]}));
    check('Hierarchy copy creates distinct independent owners',copied.objects.length>0&&copied.objects.every(n=>!before.objects.some(old=>old.hash===n.hash)));await history('undo');check('Hierarchy copy Undo restores every original owner',(await state()).objects.length===before.objects.length);
   }
   await stage('To Editable for generated and instanced objects');
   for(const [label,hash]of Object.entries({primitive:handles.primitive,extrude:handles.extrude,instance:handles.instance,cloner:handles.cloner}).filter(([,hash])=>hash)){
    const before=await get(hash),converted=await measure('scene.convert.'+label,()=>call('scene.convert',{id:hash}));
    check(label+' To Editable keeps its owner and world frame',converted.hash===hash&&near(before.worldMatrix,converted.worldMatrix),{before:before.type,after:converted.type});check(label+' To Editable changes native authoring type',converted.type!==before.type,{before:before.type,after:converted.type});await history('undo');const restored=await get(hash);check(label+' To Editable Undo restores native authoring',restored.type===before.type&&near(restored.worldMatrix,before.worldMatrix));
   }
   if(handles.material&&handles.primitive){
    await stage('Material assignment and texture changes');const before=await get(handles.primitive);
    await measure('material.assign',()=>call('material.assign',{id:handles.primitive,material:handles.texturedMaterial||handles.material}));await history('undo');check('Material Undo restores owner tags',JSON.stringify((await get(handles.primitive)).tags)===JSON.stringify(before.tags));
    const current=(await state()).materials.find(m=>m.uid===(handles.texturedMaterial||handles.material)),asset=current?.colorAsset;
    if(asset){await measure('texture.reuse',()=>call('material.texture',{material:current.uid,slot:'emissive',asset}));await history('undo');}
    if(handles.denseChildSpline){
     const hash=handles.denseChildSpline,patchBefore=await get(handles.densePatch),cage=await call('spline.inspect',{id:hash,cells:true});
     check('Dense source exposes native editable cells',cage.cells?.length>0,{cells:cage.cells?.length});
     await measure('components.cell',()=>call('scene.select',{ids:[hash],mode:'polygon',components:['cell:0']}));
     await measure('material.assign.cell',()=>call('material.assign',{id:hash,material:handles.texturedMaterial||handles.material,selection:true}));
     const patchAfter=await get(handles.densePatch);check('Cell assignment retains the complete dense source hierarchy',patchAfter.sources.length===patchBefore.sources.length);await history('undo');check('Cell material Undo restores original tags',JSON.stringify((await get(handles.densePatch)).tags)===JSON.stringify(patchBefore.tags));await call('view.set',{mode:'object'});
    }
   }
   const {zooAdditionalOperationChecks}=await import('./performance-zoo-10k-operations.mjs');await zooAdditionalOperationChecks(page,metadata,{call,check,stage,measure,history,state,get,frameSample,originalCamera});
   if(liveCoverage){const {zooLiveCoverageChecks}=await import('./performance-engineering-workflows.mjs');report.liveCoverage=await zooLiveCoverageChecks(page,metadata,{call,check,stage,measure,history,state,get,originalCamera});check('Targeted engineering workflow coverage completes',report.liveCoverage.pass,{error:report.liveCoverage.error,activeCase:report.liveCoverage.activeCase});}
   await stage('Native HASH serialization and reload');
   await call('scene.select',{ids:[]});await call('view.set',{mode:'object',camera:originalCamera});
   const before=await state(),exported=await measure('scene.export',()=>call('scene.export',{includeData:true}));report.serializedBytes=exported.bytes;
   check('HASH export produces native data',exported.bytes>0&&!!exported.base64);
   await measure('scene.reopen',()=>call('scene.open',{base64:exported.base64,name:'zoo-roundtrip.hash'}));const after=await state(),typesBefore=new Map(before.objects.map(n=>[n.hash,n.type]));check('HASH retains all authored owners and types',after.objects.length===before.objects.length&&after.objects.every(n=>typesBefore.get(n.hash)===n.type));check('HASH retains material count',before.materials.length===after.materials.length);check('HASH reload rebuilds without generator errors',!after.objects.some(n=>n.buildError));
  });
  if(phase==='additional')await profileSection('additionalOperations',async()=>{const {zooAdditionalOperationChecks}=await import('./performance-zoo-10k-operations.mjs');await zooAdditionalOperationChecks(page,metadata,{call,check,stage,measure,history,state,get,frameSample,originalCamera});});
  if(phase==='copy')await profileSection('copyReproduction',async()=>{
   await stage('Fresh hierarchy copy, Undo and Redo reproduction');const hash=handles.deepGroup||handles.extrude,before=await state();report.copyMemory=[];
   for(let i=0;i<rounds;i++){
    const copied=await measure('scene.duplicate.hierarchy',()=>call('scene.duplicate',{ids:[hash]})),copiedCount=(await state()).objects.length;check('Hierarchy copy '+i+' creates distinct native owners',copied.objects.length>0&&copiedCount>before.objects.length&&copied.objects.every(n=>!before.objects.some(old=>old.hash===n.hash)),{selectedRoots:copied.objects.length,authoredOwners:copiedCount-before.objects.length});
    await history('undo');check('Hierarchy copy '+i+' Undo restores authored count',(await state()).objects.length===before.objects.length);await history('redo');check('Hierarchy copy '+i+' Redo restores copied owners',(await state()).objects.length===copiedCount);await history('undo');
    report.copyMemory.push(await page.evaluate(()=>({at:new Date().toISOString(),resources:frameEngine.viewResources(),heap:performance.memory?.usedJSHeapSize,meshes:frameEngine.scene?.meshes.length,historyMeshes:(()=>{const owners=new Set(nodes.map(n=>n.nativeHash));return frameEngine.scene?.meshes.filter(m=>!m.replicaMatrix&&!owners.has(m.hashId)).length;})(),bindings:window.__zooBindingCounts?{...__zooBindingCounts}:null,allocations:window.__zooAllocationSnapshot?.()})));await onProgress(report);
   }
  });

  await stage('Final completed frame');if(renderOnly){await restoreNavigationCamera();await page.evaluate(()=>frameEngine.setViewerMode('shading','solid-isoparms'));report.rendererOnly.finalNativeCamera=await page.evaluate(()=>Array.from(frameEngine.viewState));}else{await call('scene.select',{ids:[]});await call('view.set',{mode:'object',camera:originalCamera,shading:'solid-isoparms'});}await frameSample('final',4);
  report.final={stats:['frames','renderer','capture'].includes(phase)?report.initial.stats:(await state()).stats};report.pass=report.checks.every(c=>c.pass);return report;
 }catch(error){report.error=error.stack;return report;}finally{await page.mouse.up().catch(()=>{});await page.mouse.up({button:'middle'}).catch(()=>{});await page.mouse.up({button:'right'}).catch(()=>{});await onProgress(report);}
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const option=(name,fallback)=>process.argv.find(x=>x.startsWith('--'+name+'='))?.slice(name.length+3)??fallback;
 const label=option('label','latest'),phase=option('phase','all'),frames=Number(option('frames',16)),rounds=Number(option('rounds',3)),directory=resolve(option('output',fileURLToPath(resultDirectory))),reportPath=resolve(directory,'zoo-'+label+'.json');let count=Number(option('count',10000)),fixture,metadata;
 await mkdir(directory,{recursive:true});
 if(option('scene')){const output=resolve(option('scene')),metadataPath=resolve(option('metadata',output.replace(/\.hash$/i,'.json')));metadata=JSON.parse(await readFile(metadataPath,'utf8'));fixture={output,metadataPath,metadata};if(option('count')&&count!==(metadata.count??metadata.objects?.length))throw Error('Explicit --count does not match the supplied scene metadata');count=metadata.count??metadata.objects?.length;}
 else{const generator=await import('./scenes/generate-zoo-10k.mjs');fixture=await generator.ensureZooScene({count});metadata=option('metadata')?JSON.parse(await readFile(resolve(option('metadata')),'utf8')):fixture.metadata??(fixture.handles?fixture:JSON.parse(await readFile(fixture.metadataPath??new URL('./scenes/stress-zoo-10k.json',import.meta.url),'utf8')));}
 const scenePath=resolve(option('scene',fixture.output??fileURLToPath(new URL('./scenes/stress-zoo-10k.hash',import.meta.url)))),bytes=await readFile(scenePath),sourcePath=option('source')?resolve(option('source')):fileURLToPath(new URL('../index.html',import.meta.url)),source=await readFile(sourcePath),sourceSnapshotPath=resolve(directory,'zoo-'+label+'-source.html');await writeFile(sourceSnapshotPath,source);
 const compareBundles=process.argv.includes('--compare-bundles'),anchor='function tryRenderGeometryBundles(r,pass,batched){';let servedSource=source;if(compareBundles){const text=source.toString('utf8');if(text.split(anchor).length!==2)throw Error('Production bundle helper required for same-source comparison');servedSource=Buffer.from(text.replace(anchor,anchor+'if(window.__bundleOrdinary)return null;'));}
 const workerProfile=process.argv.includes('--worker-profile');if(workerProfile){const {instrumentSplineWorkerBatches}=await import('./worker-batch-profiling.mjs');servedSource=Buffer.from(instrumentSplineWorkerBatches(servedSource.toString('utf8')));}
 const codecCopyControl=process.argv.includes('--codec-copy-control');if(codecCopyControl){const anchor='function splineTextBytes(value){',text=servedSource.toString('utf8');if(text.split(anchor).length!==2)throw Error('One native UTF-8 helper required');servedSource=Buffer.from(text.replace(anchor,anchor+'if(window.__zooSplineTextOrdinary)return utf8.encode(value);'));}
 const bindingProfile=process.argv.includes('--binding-profile');if(bindingProfile){const anchor='function meshRenderGroups(gpu,mesh){',text=servedSource.toString('utf8');if(text.split(anchor).length!==2)throw Error('One native mesh render group helper required');const wrapper='function meshRenderGroups(gpu,mesh){const c=window.__zooBindingCounts??={bindGroupCalls:0,bindGroupEntries:0,meshRenderCalls:0,meshRenderGroupCalls:0,meshRenderReused:0};c.meshRenderCalls++;const before=c.bindGroupCalls;try{return meshRenderGroupsNative(gpu,mesh);}finally{const calls=c.bindGroupCalls-before;c.meshRenderGroupCalls+=calls;if(!calls)c.meshRenderReused++;}}\n';servedSource=Buffer.from(text.replace(anchor,wrapper+'function meshRenderGroupsNative(gpu,mesh){'));}
 const allocationProfile=process.argv.includes('--allocation-profile');if(allocationProfile){const anchor='function allocatedBufferBytes(){return allocatedBytes;}',text=servedSource.toString('utf8');if(text.split(anchor).length!==2)throw Error('One native GPU allocation accounting helper required');const getter=`window.__zooAllocationSnapshot=()=>{const labels={};for(const [resource,bytes]of gpuAllocations){const key=resource.label||'(unlabelled)',row=labels[key]??={count:0,bytes:0,leased:0,retired:0};row.count++;row.bytes+=bytes;const lease=gpuLeases.get(resource);if(lease?.count)row.leased++;if(lease?.retired)row.retired++;}const actions=rows=>({count:rows.length,heldMeshes:rows.reduce((sum,row)=>sum+(row.held?.length||0),0),archiveBytes:rows.reduce((sum,row)=>sum+(row.archiveBytes||0),0)});return {allocatedBytes,labels,polygonResources:polygonResources.size,uvResources:uvResources.size,metaUndo:actions(metaUndo),metaRedo:actions(metaRedo)};};`;servedSource=Buffer.from(text.replace(anchor,anchor+getter));}
 const workerParity=process.argv.includes('--worker-parity');if(workerParity){const {instrumentColdWorkerParity}=await import('./cold-worker-parity-capture.mjs');servedSource=Buffer.from(instrumentColdWorkerParity(servedSource.toString('utf8'),{hashes:option('geometry-ids','ed95f5f37b594b5aa0b18fd9d2c35893,81f39d3c1c82d79ee173ff5d2a3088ae,328b0657cece6b8a36277d117f0d9d42,09f01d9e3cfef45f405e8ac2471b1e24').split(',')}));}
 const testInstrumentation=[compareBundles?'ordinary-command control guard':null,workerProfile?'native worker buildBatch timing':null,bindingProfile?'mesh render group allocation counters':null,codecCopyControl?'splineTextBytes cache control':null,allocationProfile?'read-only native GPU allocation labels':null,workerParity?'binary worker prepare/init parity capture':null].filter(Boolean);if(testInstrumentation.length)await writeFile(resolve(directory,'zoo-'+label+'-served-source.html'),servedSource);
 const expectedScriptSHA256=digest([...servedSource.toString('utf8').matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1].replace(/\r\n?/g,'\n')).join('\n\0\n'));
 const session=await launch({headless:process.argv.includes('--headless')}),errors=[],profiles=[],startedAt=Date.now(),stopFile=resolve(option('stop-file',reportPath+'.stop'));let report,cdp,stopWatcher,lastProgress,interruption,actualScriptSHA256;
 const runtimeSnapshot=()=>session.page.evaluate(()=>({events:window.__zooRuntimeEvents||[],gpuErrors:window.__zooGPUErrors||[],bindings:window.__zooBindingCounts||null,canvas:{...document.querySelector('#frame-engine-canvas')?.dataset},status:document.querySelector('#frame-engine-status')?.textContent||null,sceneAlive:!!window.frameEngine?.scene,rendererAlive:!!window.frameEngine?.renderer}));
 try{
  await session.page.route('**/index.html',route=>route.fulfill({body:servedSource,contentType:'text/html; charset=utf-8'}));await session.page.reload();
  actualScriptSHA256=await session.page.evaluate(async()=>{const scripts=[...document.scripts].map(s=>s.textContent.replace(/\r\n?/g,'\n')).join('\n\0\n'),hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(scripts)));return [...hash].map(v=>v.toString(16).padStart(2,'0')).join('');});if(actualScriptSHA256!==expectedScriptSHA256)throw Error('Browser script bytes do not match the captured application source');
  await ready(session.page);session.page.on('pageerror',e=>errors.push(e.stack));
  await session.page.evaluate(bindingProfile=>{window.__zooGPUErrors=[];window.__zooRuntimeEvents=[];if(bindingProfile){window.__zooBindingCounts={bindGroupCalls:0,bindGroupEntries:0,meshRenderCalls:0,meshRenderGroupCalls:0,meshRenderReused:0};const original=GPUDevice.prototype.createBindGroup;GPUDevice.prototype.createBindGroup=function(descriptor){__zooBindingCounts.bindGroupCalls++;__zooBindingCounts.bindGroupEntries+=descriptor.entries.length;return original.call(this,descriptor);};}const device=window.__zooGPUDevice=frameEngine.renderer.device,record=(kind,detail)=>__zooRuntimeEvents.push({kind,at:new Date().toISOString(),...detail});device.addEventListener('uncapturederror',e=>{__zooGPUErrors.push(e.error.message);record('gpuError',{message:e.error.message});});device.lost.then(info=>record('deviceLost',{reason:info.reason,message:info.message,operationError:document.querySelector('#frame-engine-canvas').dataset.operationError}));window.addEventListener('error',e=>record('windowError',{message:e.message,stack:e.error?.stack}));window.addEventListener('unhandledrejection',e=>record('unhandledRejection',{message:String(e.reason),stack:e.reason?.stack}));device.pushErrorScope('validation');},bindingProfile);
  const memorySnapshot=()=>session.page.evaluate(()=>{const meshes=frameEngine.scene?.meshes||[],positions=new Set(meshes.map(m=>m.positions).filter(Boolean)),indices=new Set(meshes.map(m=>m.indices).filter(Boolean));return {resources:frameEngine.viewResources(),allocations:window.__zooAllocationSnapshot?.(),javascript:performance.memory?{usedJSHeapSize:performance.memory.usedJSHeapSize,totalJSHeapSize:performance.memory.totalJSHeapSize,jsHeapSizeLimit:performance.memory.jsHeapSizeLimit}:null,geometry:{meshes:meshes.length,replicas:meshes.filter(m=>m.replicaMatrix).length,residentPositions:positions.size,residentIndices:indices.size,positionBufferBytes:[...positions].reduce((sum,b)=>sum+(typeof b.size==='number'?b.size:0),0),indexBufferBytes:[...indices].reduce((sum,b)=>sum+(typeof b.size==='number'?b.size:0),0)}};});
  const memory={beforeLoad:await memorySnapshot()};
  const profiling=process.argv.includes('--profile'),gcDiagnostic=process.argv.includes('--gc-diagnostic');let activeProfile=null,profileStage=null;if(profiling||gcDiagnostic){cdp=await session.context.newCDPSession(session.page);if(profiling){await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:1000});}}
  const saveProfile=async name=>{const {profile}=await cdp.send('Profiler.stop'),path=resolve(directory,'zoo-'+label+'-'+name.replace(/[^\w.-]+/g,'-')+'.cpuprofile');await writeFile(path,JSON.stringify(profile));const hitCounts=new Map(),functions=new Map();for(const id of profile.samples||[])hitCounts.set(id,(hitCounts.get(id)||0)+1);for(const n of profile.nodes){const f=n.callFrame,key=JSON.stringify([f.functionName,f.url,f.lineNumber,f.columnNumber]);let row=functions.get(key);if(!row)functions.set(key,row={function:f.functionName,url:f.url,line:f.lineNumber+1,column:f.columnNumber+1,samples:0});row.samples+=hitCounts.get(n.id)||0;}const top=[...functions.values()].sort((a,b)=>b.samples-a.samples).slice(0,35);profiles.push({name,path,top});};
  const profileSection=async(name,fn)=>{if(!profiling)return fn();await cdp.send('Profiler.start');activeProfile=name;profileStage=null;try{return await fn();}finally{if(activeProfile)await saveProfile(profileStage?name+'-'+profileStage:name);activeProfile=null;profileStage=null;}};
  let checkingStop=false;stopWatcher=setInterval(async()=>{if(checkingStop||interruption)return;checkingStop=true;try{if((await stat(stopFile)).mtimeMs<startedAt)return;interruption={at:new Date().toISOString(),reason:(await readFile(stopFile,'utf8')).trim()||'Benchmark interruption requested',lastStage:lastProgress?.stages?.at(-1)?.name};if(activeProfile){await saveProfile(activeProfile+'-interrupted');activeProfile=null;}if(lastProgress)await writeFile(reportPath,JSON.stringify({...lastProgress,pass:false,profiles,interrupted:interruption},null,2));console.log('[zoo] Stopping isolated benchmark: '+interruption.reason);await session.page.close({runBeforeUnload:false});}catch(error){if(error.code!=='ENOENT')console.error('[zoo] Stop control: '+error.message);}finally{checkingStop=false;}},1000);
  const started=performance.now();console.log('[zoo] Loading '+count+' authored objects');await profileSection('load',()=>session.page.evaluate(args=>frameAI.call('scene.open',args).then(r=>({objects:r.objects.length})),{base64:bytes.toString('base64'),name:'stress-zoo-'+count+'.hash'}));const openMs=performance.now()-started;
  const loadDiagnostics=await session.page.evaluate(()=>{
   const owners=new Map(nodes.map(n=>[n.id,n])),hashOwners=new Map(nodes.map(n=>[n.nativeHash,n])),types={},slowest=[],meshProfiles={};
   for(const [id,state]of FrameSpline.states){const owner=owners.get(id),type=owner?.type||'unknown',row=types[type]??={states:0,reported:0,buildMs:[],reportPhases:{},workerBudgets:{},cells:0,triangles:0};row.states++;if(!state.report)continue;row.reported++;for(const [key,value]of Object.entries(state.report))if(key!=='buildMs'&&/Ms$|Milliseconds$|^cpuBatch(?:Count|Cells)$/i.test(key)&&Number.isFinite(value))(row.reportPhases[key]??=[]).push(value);row.cells+=state.report.cells||0;row.triangles+=state.report.triangles||0;for(const [key,value]of Object.entries(state.report.workerBudget||{}))if(Number.isFinite(value))(row.workerBudgets[key]??=[]).push(value);if(Number.isFinite(state.report.buildMs)){row.buildMs.push(state.report.buildMs);slowest.push({hash:owner?.nativeHash,type,name:owner?.name,buildMs:state.report.buildMs,cells:state.report.cells,triangles:state.report.triangles});}}
   for(const row of Object.values(types)){const values=row.buildMs.sort((a,b)=>a-b);row.buildMs={count:values.length,total:values.reduce((a,b)=>a+b,0),median:values[values.length>>1]??null,p95:values[Math.min(values.length-1,Math.floor(values.length*.95))]??null,max:values.at(-1)??null};for(const [key,values]of Object.entries(row.reportPhases)){values.sort((a,b)=>a-b);row.reportPhases[key]={count:values.length,total:values.reduce((a,b)=>a+b,0),median:values[values.length>>1]??null,p95:values[Math.min(values.length-1,Math.floor(values.length*.95))]??null,max:values.at(-1)??null};}for(const [key,values]of Object.entries(row.workerBudgets)){values.sort((a,b)=>a-b);row.workerBudgets[key]={count:values.length,total:values.reduce((a,b)=>a+b,0),median:values[values.length>>1]??null,p95:values[Math.min(values.length-1,Math.floor(values.length*.95))]??null,max:values.at(-1)??null};}}
   for(const mesh of frameEngine.scene.meshes){if(mesh.replicaMatrix||!mesh.profile)continue;const type=hashOwners.get(mesh.hashId)?.type||'runtime',row=meshProfiles[type]??={sources:0,phases:{}};row.sources++;for(const [key,value]of Object.entries(mesh.profile))if(Number.isFinite(value))(row.phases[key]??=[]).push(value);}
   for(const row of Object.values(meshProfiles))for(const [key,values]of Object.entries(row.phases)){values.sort((a,b)=>a-b);row.phases[key]={count:values.length,total:values.reduce((a,b)=>a+b,0),median:values[values.length>>1]??null,p95:values[Math.min(values.length-1,Math.floor(values.length*.95))]??null,max:values.at(-1)??null};}
   return {hashLoad:JSON.parse(document.querySelector('#frame-engine-canvas').dataset.hashLoad||'null'),types,sourceMeshProfiles:meshProfiles,slowest:slowest.sort((a,b)=>b.buildMs-a.buildMs).slice(0,20)};
  });
  memory.afterLoad=await memorySnapshot();const bindingsAfterLoad=bindingProfile?await session.page.evaluate(()=>({...__zooBindingCounts})):null;
  let rendererFraming;if(option('renderer-camera')){rendererFraming=JSON.parse(await readFile(resolve(option('renderer-camera')),'utf8'));if(!rendererFraming.normalizedCamera||!rendererFraming.observedNativeCamera)throw Error('Renderer camera report must contain actual normalizedCamera and observedNativeCamera');}
  let rendererControl;
  if(process.argv.includes('--initial-renderer-control')){
   if(phase!=='all')throw Error('Initial renderer control is intended for phase=all');
   const path=resolve(directory,'zoo-'+label+'-renderer-control.json'),receipt={loadMs:openMs,loadDiagnostics,sourceSHA256:digest(source),executedScriptSHA256:actualScriptSHA256,sourceVerified:actualScriptSHA256===expectedScriptSHA256,testInstrumentation,servedSourceSHA256:digest(servedSource),fixtureSHA256:digest(bytes),sourcePath,sourceSnapshotPath,scenePath};
   const rendererReport=await zooPerformanceChecks(session.page,metadata,{phase:'renderer',frames,rounds:1,profileSection:(name,fn)=>profileSection('renderer-control-'+name,fn),onProgress:async r=>{lastProgress={...r,...receipt};await writeFile(path,JSON.stringify(lastProgress,null,2));}});
   Object.assign(rendererReport,receipt,{createdAt:new Date().toISOString(),dpr:Number(process.env.FRAME_DPR||1),runtime:await runtimeSnapshot(),errors:errors.slice()});rendererReport.pass&&=!errors.length&&!rendererReport.runtime.gpuErrors.length&&!rendererReport.runtime.events.some(e=>e.kind==='deviceLost');
   const baseline=option('renderer-compare');if(baseline){rendererReport.comparison=compareReports(JSON.parse(await readFile(resolve(baseline),'utf8')),rendererReport);if(!rendererReport.comparison.comparable)rendererReport.pass=false;}
   await writeFile(path,JSON.stringify(rendererReport,null,2));rendererControl={path,pass:rendererReport.pass,camera:rendererReport.camera,comparison:rendererReport.comparison};console.log('[zoo] Initial renderer control '+(rendererReport.pass?'PASS':'FAIL')+' '+path);
   if(!rendererReport.pass)throw Error('Initial renderer control failed: '+(rendererReport.error||rendererReport.comparison?.reason||'native correctness check'));
  }
  report=await zooPerformanceChecks(session.page,metadata,{phase,frames,rounds,compareBundles,codecCopyControl,rendererCamera:rendererFraming?.normalizedCamera,rendererNativeCamera:rendererFraming?.observedNativeCamera,transformTargets:option('targets')?.split(','),gizmoTarget:option('gizmo-target','primitive'),liveCoverage:process.argv.includes('--live-coverage'),profileSection,onProgress:async r=>{const next=r.stages.at(-1)?.name;if(activeProfile&&activeProfile!=='navigation'&&next!==profileStage){if(profileStage){await saveProfile(activeProfile+'-'+profileStage);await cdp.send('Profiler.start');}profileStage=next;}lastProgress={...r,loadMs:openMs,loadDiagnostics,memory,profiles,sourceSHA256:digest(source),executedScriptSHA256:actualScriptSHA256,sourceVerified:actualScriptSHA256===expectedScriptSHA256,testInstrumentation,servedSourceSHA256:digest(servedSource),fixtureSHA256:digest(bytes),sourcePath,sourceSnapshotPath,scenePath,stopFile,...interruption?{interrupted:interruption,pass:false}:{}};await writeFile(reportPath,JSON.stringify(lastProgress,null,2));}});
  report.rendererControl=rendererControl;
  report.loadDiagnostics=loadDiagnostics;
  report.runtime=await runtimeSnapshot();report.bindingDiagnostics=bindingProfile?{afterLoad:bindingsAfterLoad,final:report.runtime.bindings}:null;memory.final=await memorySnapshot();report.memory=memory;
  report.loadMs=openMs;report.profiles=profiles;report.gpu=await session.page.evaluate(async()=>({validation:(await __zooGPUDevice.popErrorScope())?.message||null,uncaptured:__zooGPUErrors}));report.errors=errors;report.pass&&=!errors.length&&!report.gpu.validation&&!report.gpu.uncaptured.length&&!report.runtime.events.some(e=>e.kind==='deviceLost');
  report.sourceSHA256=digest(source);report.sourcePath=sourcePath;report.sourceSnapshotPath=sourceSnapshotPath;report.executedScriptSHA256=actualScriptSHA256;report.sourceVerified=actualScriptSHA256===expectedScriptSHA256;report.testInstrumentation=testInstrumentation;report.servedSourceSHA256=digest(servedSource);report.fixtureSHA256=digest(bytes);report.scenePath=scenePath;report.createdAt=new Date().toISOString();report.dpr=Number(process.env.FRAME_DPR||1);
  report.screenshot=resolve(directory,'zoo-'+label+'.png');await session.page.screenshot({path:report.screenshot});
  if(option('save-scene')&&report.pass){
   const path=resolve(option('save-scene')),started=performance.now();await mkdir(dirname(path),{recursive:true});const transfer=await session.page.evaluate(name=>frameAI.call('scene.export',{transfer:true,name}),basename(path)),chunks=[];
   try{let offset=0;for(;;){const chunk=await session.page.evaluate(args=>frameAI.call('scene.export.read',args),{id:transfer.transfer.id,offset,length:1024*1024});chunks.push(Buffer.from(chunk.base64,'base64'));offset=chunk.nextOffset;if(chunk.eof)break;}const data=Buffer.concat(chunks);
    if(process.argv.includes('--verify-saved-scene')){
     console.log('[zoo] Verifying exported native scene after normal timings');const started=performance.now();
     const before=await session.page.evaluate(()=>{const meshes=frameEngine.scene.meshes,compiled={meshes:meshes.length,vertices:meshes.reduce((n,m)=>n+(m.vertexCount||0),0),triangles:meshes.reduce((n,m)=>n+(m.triangleCount||0),0),residentPositions:new Set(meshes.map(m=>m.positions).filter(Boolean)).size,residentIndices:new Set(meshes.map(m=>m.indices).filter(Boolean)).size};window.__zooSavedSceneExpected={owners:new Map(nodes.map(n=>[n.nativeHash,n.type])),materials:materials.map(m=>m.uid).sort(),compiled,camera:Array.from(frameEngine.viewState)};return {owners:nodes.length,materials:materials.length,compiled,camera:Array.from(frameEngine.viewState)};});
     await session.page.evaluate(()=>__zooGPUDevice.pushErrorScope('validation'));let verification;
     try{
      await session.page.evaluate(args=>frameAI.call('scene.open',args).then(result=>({objects:result.objects.length})),{base64:data.toString('base64'),name:basename(path)});
      for(let i=0;i<3;i++){await session.page.evaluate(async()=>{const r=frameEngine.renderer;await r.materialState?.assetsReady;await Promise.all(r.materialState?.pending.values()||[]);await Promise.all([r.nativeSurfaceLinesInit,r.wireRasterInit].filter(Boolean));});await session.page.evaluate(()=>frameAI.call('diagnostics.frame',{frames:2}));}
      await session.page.evaluate(()=>frameEngine.renderer.device.queue.onSubmittedWorkDone());
      verification=await session.page.evaluate(()=>{const expected=window.__zooSavedSceneExpected,meshes=frameEngine.scene.meshes,compiled={meshes:meshes.length,vertices:meshes.reduce((n,m)=>n+(m.vertexCount||0),0),triangles:meshes.reduce((n,m)=>n+(m.triangleCount||0),0),residentPositions:new Set(meshes.map(m=>m.positions).filter(Boolean)).size,residentIndices:new Set(meshes.map(m=>m.indices).filter(Boolean)).size},camera=Array.from(frameEngine.viewState),buildErrors=nodes.filter(n=>n.splineError).map(n=>({hash:n.nativeHash,type:n.type,error:n.splineError})),ownersMatch=nodes.length===expected.owners.size&&nodes.every(n=>expected.owners.get(n.nativeHash)===n.type),materialsMatch=JSON.stringify(materials.map(m=>m.uid).sort())===JSON.stringify(expected.materials),compiledMatch=Object.keys(compiled).every(k=>compiled[k]===expected.compiled[k]),cameraMatch=camera.every((v,i)=>Math.abs(v-expected.camera[i])<=1e-7*Math.max(1,Math.abs(v),Math.abs(expected.camera[i])));return {owners:nodes.length,materials:materials.length,compiled,camera,ownersMatch,materialsMatch,compiledMatch,cameraMatch,buildErrors,sameDevice:frameEngine.renderer.device===__zooGPUDevice};});
     }finally{const validation=await session.page.evaluate(async()=>(await __zooGPUDevice.popErrorScope())?.message||null);if(verification)verification.validation=validation;}
     const runtime=await runtimeSnapshot();report.exportVerification={diagnosticOnly:true,afterNormalTimingsAndProfiles:true,ms:performance.now()-started,before,...verification,runtime};report.exportVerification.pass=!!verification&&verification.owners===count&&verification.ownersMatch&&verification.materialsMatch&&verification.compiledMatch&&verification.cameraMatch&&!verification.buildErrors.length&&verification.sameDevice&&!verification.validation&&!runtime.gpuErrors.length&&!runtime.events.some(e=>e.kind==='deviceLost');
     if(!report.exportVerification.pass)throw Error('Saved native scene verification failed: '+JSON.stringify(report.exportVerification));
     await session.page.evaluate(()=>delete window.__zooSavedSceneExpected);
    }
    await writeFile(path,data);report.deliverable={path,bytes:data.length,sha256:digest(data),camera:(await session.page.evaluate(()=>frameAI.call('view.set',{}))).camera};report.operations.push({name:'scene.deliver',ms:performance.now()-started-(report.exportVerification?.ms||0)});}
   finally{await session.page.evaluate(id=>frameAI.call('scene.export.release',{id}),transfer.transfer.id);}
  }
  if((process.argv.includes('--geometry-digests')||option('geometry-ids'))&&report.pass){
   const started=performance.now(),owners=await session.page.evaluate(ids=>{const selected=ids&&new Set(ids),seen=new Set(),byHash=new Map(nodes.map(n=>[n.nativeHash,n]));return frameEngine.scene.meshes.filter(m=>!m.replicaMatrix&&m.hashId&&(!selected||selected.has(m.hashId))&&!seen.has(m.hashId)&&seen.add(m.hashId)).map(m=>({hash:m.hashId,type:byHash.get(m.hashId)?.type,name:byHash.get(m.hashId)?.name,vertices:m.vertexCount,triangles:m.triangleCount}));},option('geometry-ids')?.split(',')),rows=[];
   for(const owner of owners){const geometry=await session.page.evaluate(id=>frameAI.call('diagnostics.mesh',{id,geometry:true}),owner.hash);rows.push({...owner,positionsSHA256:geometry.positionsSHA256,indicesSHA256:geometry.indicesSHA256,finite:geometry.finite,indicesValid:geometry.indicesValid});if(rows.length%50===0)console.log('[zoo] Canonical geometry digests '+rows.length+'/'+owners.length);}
   report.geometryDiagnostics={diagnosticOnly:true,afterNormalTimings:true,ms:performance.now()-started,owners:rows};report.pass&&=rows.every(row=>row.finite&&row.indicesValid);
   if(process.argv.includes('--geometry-raw')){
    const cages=[];for(const owner of owners){const capture=await session.page.evaluate(async hash=>{
     const mesh=frameEngine.scene.meshes.find(m=>!m.replicaMatrix&&m.hashId===hash),owner=nodes.find(n=>n.nativeHash===hash),state=FrameSpline.states.get(owner.id),device=__zooGPUDevice;
     async function read(buffer,size){const staging=device.createBuffer({label:'zoo diagnostic raw geometry',size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{const encoder=device.createCommandEncoder();encoder.copyBufferToBuffer(buffer,0,staging,0,size);device.queue.submit([encoder.finish()]);await staging.mapAsync(GPUMapMode.READ);return Array.from(new Uint8Array(staging.getMappedRange()));}finally{staging.unmap();staging.destroy();}}
     const sources=FrameSpline.generatorSources(owner),inputs=sources.map(row=>frameEngine.splineOccurrenceInFrame(FrameSpline.states.get(row.node.id)?.data||row.node.splineData,row.node.nativeHash,owner.nativeHash,row.instances)),inputPivots=sources.map(row=>frameEngine.splineOccurrencePivot(row.node.nativeHash,owner.nativeHash,row.instances));
     return {hash,type:owner.type,name:owner.name,shape:FrameSpline.shape(owner),data:state?.data,report:state?.report,inputs,inputPivots,positions:await read(mesh.positions,mesh.vertexCount*12),indices:await read(mesh.indices,mesh.triangleCount*12)};
    },owner.hash);const positionsPath=resolve(directory,'zoo-'+label+'-'+owner.hash+'-positions.bin'),indicesPath=resolve(directory,'zoo-'+label+'-'+owner.hash+'-indices.bin');await writeFile(positionsPath,Buffer.from(capture.positions));await writeFile(indicesPath,Buffer.from(capture.indices));delete capture.positions;delete capture.indices;cages.push(capture);Object.assign(rows.find(row=>row.hash===owner.hash),{positionsPath,indicesPath});}
    const cagesPath=resolve(directory,'zoo-'+label+'-cages.json');await writeFile(cagesPath,JSON.stringify(cages,null,2));report.geometryDiagnostics.cagesPath=cagesPath;
   }
  }
  if(gcDiagnostic&&report.pass){
   const startedAt=new Date().toISOString(),started=performance.now(),before=await memorySnapshot();await cdp.send('HeapProfiler.collectGarbage');await session.page.evaluate(()=>__zooGPUDevice.queue.onSubmittedWorkDone());await cdp.send('HeapProfiler.collectGarbage');const after=await memorySnapshot();
   report.gcDiagnostic={forced:true,diagnosticOnly:true,afterNormalTimingsAndExport:true,startedAt,endedAt:new Date().toISOString(),ms:performance.now()-started,before,after};
  }
  if(workerParity&&report.pass){const {collectColdWorkerParity}=await import('./cold-worker-parity-capture.mjs'),captured=await collectColdWorkerParity(session.page),path=resolve(directory,'zoo-'+label+'-worker-parity.value');await writeFile(path,Buffer.from(captured.base64,'base64'));report.workerParity={diagnosticOnly:true,afterNormalTimings:true,path,bytes:captured.bytes,records:captured.records,owners:captured.owners};}
  if(report.pass&&(option('save-overview')||option('save-detail'))){
   report.visuals={diagnosticOnly:true,afterNormalTimingsAndExport:true};const camera=await session.page.evaluate(()=>Array.from(frameEngine.viewState));
   if(option('save-overview')){const path=resolve(option('save-overview'));await mkdir(dirname(path),{recursive:true});await session.page.locator('#frame-engine-canvas').screenshot({path});report.visuals.overview={path,camera};}
   if(option('save-detail')){const path=resolve(option('save-detail'));await mkdir(dirname(path),{recursive:true});await session.page.evaluate(hash=>frameAI.call('view.set',{index:0,single:true,mode:'object',shading:'solid-isoparms',focus:hash}),metadata.handles.densePatch);await session.page.evaluate(async()=>{const r=frameEngine.renderer;await r.materialState?.assetsReady;await Promise.all(r.materialState?.pending.values()||[]);await Promise.all([r.nativeSurfaceLinesInit,r.wireRasterInit].filter(Boolean));});await session.page.evaluate(()=>frameAI.call('diagnostics.frame',{frames:4}));await session.page.locator('#frame-engine-canvas').screenshot({path});report.visuals.detail={path,hash:metadata.handles.densePatch,camera:await session.page.evaluate(()=>Array.from(frameEngine.viewState))};await session.page.evaluate(camera=>frameAI.call('view.set',{camera}),camera);}
   report.runtimeAfterVisuals=await runtimeSnapshot();report.pass&&=!report.runtimeAfterVisuals.gpuErrors.length&&!report.runtimeAfterVisuals.events.some(e=>e.kind==='deviceLost');
  }
  const comparison=option('compare');if(comparison)report.comparison=compareReports(JSON.parse(await readFile(comparison,'utf8')),report);
  await writeFile(reportPath,JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,reportPath,loadMs:openMs,checks:report.checks.length,error:report.error,frames:Object.fromEntries(Object.entries(report.frames).map(([name,row])=>[name,{cpu:row.cpu,gpu:row.gpu}])),operations:report.operations,gpu:report.gpu,errors,comparison:report.comparison},null,2));process.exitCode=report.pass?0:1;
 }catch(error){report={...lastProgress,...report,runtime:await runtimeSnapshot().catch(()=>null),pass:false,phase,count,error:report?.error||error.stack,sourceSHA256:digest(source),executedScriptSHA256:actualScriptSHA256,sourceVerified:actualScriptSHA256===expectedScriptSHA256,fixtureSHA256:digest(bytes),sourcePath,sourceSnapshotPath,scenePath,profiles,stopFile,...interruption?{interrupted:interruption}:{}};await writeFile(reportPath,JSON.stringify(report,null,2));console.error(JSON.stringify({pass:false,reportPath,error:report.error,interrupted:report.interrupted}));process.exitCode=1;}
 finally{clearInterval(stopWatcher);await cdp?.detach().catch(()=>{});await session.close();}
}
