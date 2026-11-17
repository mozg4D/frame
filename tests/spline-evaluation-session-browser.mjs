// This isolated test retires only its own native device while a real spline
// edit is paused at the owning install function. Hooks exist in routed HTML.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {launch,ready} from '../tools/browser.mjs';
import {gridCage} from './scenes/generate-zoo-10k.mjs';

export function instrumentSplineEvaluationSession(source){
 const markers={install:'    async function installSplineSurface(n,result,current=()=>true){\n      const space=scene;if(!space)return false;',renderer:'    async function getRenderer() {',batch:'    let splineRecordBatch=null;',visibility:'    function updateSplineVisibility(){',sync:'function frameSyncEngineVisibility(){'};
 for(const marker of Object.values(markers))assert.equal(source.split(marker).length,2,marker);
 return source.replace(markers.install,markers.install+`\n      const testGate=window.__evaluationGate;if(testGate?.armed&&testGate.hash===n.nativeHash){testGate.armed=false;testGate.space=space;testGate.gpu=space.gpu;testGate.reached=true;await testGate.wait;}`)
  .replace(markers.renderer,markers.renderer+'window.__evaluationRendererCalls=(window.__evaluationRendererCalls||0)+1;')
  .replace(markers.batch,markers.batch+'window.__evaluationRecordBatch=()=>splineRecordBatch?{depth:splineRecordBatch.depth,spaceCurrent:splineRecordBatch.space===scene}:null;')
  .replace(markers.visibility,markers.visibility+'if(window.__evaluationGate?.released)window.__evaluationStaleVisibility=(window.__evaluationStaleVisibility||0)+1;')
  .replace(markers.sync,markers.sync+'if(window.__evaluationGate?.released)window.__evaluationStaleSync=(window.__evaluationStaleSync||0)+1;');
}

export async function splineEvaluationSessionBrowserChecks(page){
 const checks=[],events=[],check=(name,pass,detail)=>{checks.push({name,pass:!!pass,...detail===undefined?{}:{detail}});assert.ok(pass,name+': '+JSON.stringify(detail));console.log('[spline session] '+name);},call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]);
 try{
  const adapter=await page.evaluate(()=>{const a=frameEngine.renderer.device.adapterInfo;return {vendor:a.vendor,architecture:a.architecture,description:a.description,isFallbackAdapter:a.isFallbackAdapter};});check('Native adapter belongs to the isolated test session',adapter.isFallbackAdapter===false&&!/software|swiftshader|llvmpipe/i.test(JSON.stringify(adapter)),adapter);
  await page.evaluate(()=>{window.__evaluationErrors=[];window.addEventListener('error',e=>__evaluationErrors.push({kind:'error',name:e.error?.name,message:e.message,stack:e.error?.stack}));window.addEventListener('unhandledrejection',e=>__evaluationErrors.push({kind:'unhandledrejection',name:e.reason?.name,message:String(e.reason?.message||e.reason),stack:e.reason?.stack}));});
  const parent=await call('scene.create',{type:'group',name:'Owned asynchronous session test'}),cage=await call('scene.create',{type:'spline',parent:parent.hash,name:'Session child cage'});await call('spline.replace',{id:cage.hash,data:gridCage(2,2,20)});const patch=await call('scene.create',{type:'spline_patch',parent:parent.hash,name:'Session patch',inputs:[cage.hash]});check('Child spline builds a real native patch before retirement',await page.evaluate(hash=>frameEngine.scene.meshes.some(m=>m.hashId===hash&&m.triangleCount>0),patch.hash));
  await page.evaluate(({hash,cage,data})=>{let release;const wait=new Promise(resolve=>release=resolve);window.__evaluationGate={hash,wait,release,armed:true,reached:false,released:false};window.__evaluationEdit=frameAI.call('spline.replace',{id:cage,data}).then(value=>({resolved:true,value}),error=>{const causes=[];for(let e=error;e&&causes.length<8;e=e.cause)causes.push({name:e.name,message:e.message,code:e.code,stack:e.stack});return {resolved:false,causes};});},{hash:patch.hash,cage:cage.hash,data:gridCage(2,2,20,5)});
  await page.waitForFunction(()=>window.__evaluationGate?.reached,{},{timeout:30000});const blocked=await page.evaluate(()=>({batch:__evaluationRecordBatch(),sameSpace:__evaluationGate.space===frameEngine.scene,dead:!!__evaluationGate.gpu.dead}));check('Real API edit reaches install with a live captured scene and open record scope',blocked.sameSpace&&!blocked.dead&&blocked.batch?.depth>0,blocked);
  const loss=await page.evaluate(async()=>{const g=__evaluationGate,device=g.gpu.device;device.destroy();const info=await device.lost;await Promise.resolve();return {reason:info.reason,message:info.message};});events.push({kind:'ownedDeviceLost',...loss});
  await page.waitForFunction(()=>frameEngine.renderer===null&&__evaluationGate.gpu.dead,{},{timeout:10000});const retired=await page.evaluate(()=>({sceneNull:frameEngine.scene===null,rendererNull:frameEngine.renderer===null,loss:__evaluationGate.gpu.loss,rendererCalls:__evaluationRendererCalls||0}));check('Owning device-loss handler records the primary loss and retires its scene',retired.sceneNull&&retired.rendererNull&&retired.loss?.reason===loss.reason&&retired.loss?.message===loss.message,retired);
  await page.evaluate(()=>{__evaluationGate.callsAtRelease=__evaluationRendererCalls||0;__evaluationGate.released=true;__evaluationGate.release();});
  const result=await page.evaluate(()=>Promise.race([__evaluationEdit,new Promise((_,reject)=>setTimeout(()=>reject(Error('Retired spline operation did not settle')),10000))]));const expected=loss.message||'GPU device was lost: '+loss.reason;check('Pending native edit rejects with the captured primary AbortError cause',!result.resolved&&result.causes.some(e=>e.name==='AbortError'&&e.message===expected),result);
  const after=await page.evaluate(()=>({sceneNull:frameEngine.scene===null,rendererNull:frameEngine.renderer===null,rendererCalls:__evaluationRendererCalls||0,callsAtRelease:__evaluationGate.callsAtRelease,batch:__evaluationRecordBatch(),visibility:window.__evaluationStaleVisibility||0,sync:window.__evaluationStaleSync||0,errors:__evaluationErrors}));check('Retired publication acquires no replacement renderer and publishes no old visibility',after.sceneNull&&after.rendererNull&&after.rendererCalls===after.callsAtRelease&&after.visibility===0&&after.sync===0,after);check('The old record scope closes after the rejected operation',after.batch===null,after.batch);check('No secondary null-scene TypeError or unhandled script failure masks the primary loss',!after.errors.length&&!result.causes.some(e=>e.name==='TypeError'||/reading ['"]meshes['"]/.test(e.message)),{errors:after.errors,causes:result.causes});
  return {pass:true,native:true,checks,events,result,after};
 }catch(error){return {pass:false,native:true,checks,events,error:error.stack};}
 finally{await page.evaluate(()=>window.__evaluationGate?.release?.()).catch(()=>{});}
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const option=(name,fallback)=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3)??fallback,label=option('label','latest'),source=await readFile(resolve(option('source',fileURLToPath(new URL('../index.html',import.meta.url)))),'utf8'),injected=instrumentSplineEvaluationSession(source),session=await launch({headless:true});let report;
 try{await session.page.route('**/index.html',route=>route.fulfill({contentType:'text/html',body:injected}));await session.page.reload();await ready(session.page);report=await splineEvaluationSessionBrowserChecks(session.page);}catch(error){report={pass:false,native:true,error:error.stack};}finally{await session.close();}
 report.sourceSHA256=createHash('sha256').update(source).digest('hex');report.executedScriptSHA256=createHash('sha256').update(injected).digest('hex');report.testInstrumentation='Deferred install publication; renderer/publication counts and current record-scope getter; intentionally destroyed isolated owned device';await mkdir(new URL('./results/',import.meta.url),{recursive:true});await writeFile(new URL('./results/spline-evaluation-session-'+label+'.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));process.exitCode=report.pass?0:1;
}
