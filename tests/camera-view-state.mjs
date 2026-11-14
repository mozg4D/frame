import {standardCameraFilmValid} from './camera-view.mjs';
// Execute the shipped View handler and manual-render lifetime without a GPU.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

function fixture(html){
 const camera={id:'camera',type:'render',enabled:true,params:{renderer:'Path tracer'}},button={},device={},actions=[];
 const e={nodes:[camera],camera,button,actions,renderer:{device},renderManual:false,renderExportJob:null,pathtracer:{stats:{phase:'preparing'},running:true,hasImage:false,canvas:{style:{display:'none'}},device},lastViewportOutput:null,viewportPreview:false,single:false,viewIndex:0,renderBlocked:'',
  current:()=>camera,$:id=>id==='frameRenderToggle'?button:null,drawLightHelpers:()=>{},drawMotionPaths:()=>{},commit:fn=>fn(),fileOperationError:error=>{throw error;},syncCameraView:()=>{},renderViews:()=>{},activateFrameView:()=>{},FramePlugins:{flush:async()=>{}},draw:async()=>{},window:{frameEngine:null}};
 vm.createContext(e);
 const names=['frameEnableCamera','toggleCameraRender','cameraConfig','renderState','renderStatus','renderStart'];
 for(const name of names){const start=html.indexOf((name==='renderStart'?'async ':'')+'function '+name+'(');assert.ok(start>=0,name);vm.runInContext(html.slice(start,html.indexOf('\n',start)),e);}
 e.window.frameEngine={renderState:e.renderState,renderStop:()=>actions.push('stop'),renderStart:()=>{actions.push('start');return Promise.resolve();}};
 return e;
}

export async function cameraViewStateChecks(html){
 html??=await readFile(new URL('../index.html',import.meta.url),'utf8');
 const checks=[],test=async(name,fn)=>{try{await fn();checks.push({name,pass:true});}catch(error){checks.push({name,pass:false,error:error.stack});}};
 await test('First View promotes unseen automatic preparation instead of stopping it',()=>{const e=fixture(html);e.renderStatus();assert.equal(e.button.ariaLabel,'Render');e.toggleCameraRender(e.camera);assert.deepEqual(e.actions,['start']);});
 await test('View still stops explicit manual preparation before the first image',()=>{const e=fixture(html);e.renderManual=true;assert.equal(e.renderState().manual,true);e.renderStatus();assert.equal(e.button.ariaLabel,'Stop render');e.toggleCameraRender(e.camera);assert.deepEqual(e.actions,['stop']);});
 await test('View stops an already visible automatic image',()=>{const e=fixture(html);e.pathtracer.canvas.style.display='block';e.pathtracer.hasImage=true;e.renderStatus();assert.equal(e.button.ariaLabel,'Stop render');e.toggleCameraRender(e.camera);assert.deepEqual(e.actions,['stop']);});
 await test('View restarts a stopped hidden image',()=>{const e=fixture(html);e.pathtracer.running=false;e.pathtracer.hasImage=true;e.toggleCameraRender(e.camera);assert.deepEqual(e.actions,['start']);});
 await test('View enables the selected disabled camera and starts it',()=>{const e=fixture(html),selected={id:'other',type:'render',enabled:false,params:{renderer:'Path tracer'}};e.nodes.push(selected);e.toggleCameraRender(selected);assert.equal(e.camera.enabled,false);assert.equal(selected.enabled,true);assert.deepEqual(e.actions,['start']);});
 await test('Idle and Viewport diagnostics expose the native manual flag',()=>{const e=fixture(html);e.pathtracer=null;assert.equal(e.renderState().manual,false);e.renderManual=true;assert.equal(e.renderState().manual,true);e.camera.params.renderer='Viewport';assert.equal(e.renderState().manual,true);});
 await test('Native renderStart owns the complete awaited operation and releases on success',async()=>{const e=fixture(html);let finish;e.renderTick=async manual=>{assert.equal(manual,true);assert.equal(e.renderManual,true);await new Promise(resolve=>finish=resolve);};const pending=e.renderStart();assert.equal(e.renderManual,true);finish();await pending;assert.equal(e.renderManual,false);});
 await test('Native renderStart releases manual ownership on failure',async()=>{const e=fixture(html);e.renderTick=async()=>{throw Error('test render failure');};await assert.rejects(e.renderStart(),/test render failure/);assert.equal(e.renderManual,false);});
 // The old native predicate must fail the exact regression, independently of GPU timing.
 await test('Negative control restores the first-click cancellation bug',()=>{const old=html.replace('if(n.enabled&&(state.running&&state.manual||state.visible))','if(n.enabled&&(state.running||state.visible))');assert.notEqual(old,html);const e=fixture(old);e.toggleCameraRender(e.camera);assert.deepEqual(e.actions,['stop']);});

 const film=(foreground=[1.5,1.5,1.5,128],background=[.13,.13,.13,128])=>({width:744,height:760,colors:[foreground,background]});
 await test('Default studio and unit emissive foreground have resolved physical contrast',()=>assert.equal(standardCameraFilmValid(film()),true));
 await test('Black background cannot substitute for the enabled default environment',()=>assert.equal(standardCameraFilmValid(film(undefined,[0,0,0,128])),false));
 await test('Environment-only image cannot substitute for the emissive fixture',()=>assert.equal(standardCameraFilmValid(film([.13,.13,.13,128])),false));
 await test('Partially accumulated image cannot substitute for 128 completed samples',()=>assert.equal(standardCameraFilmValid(film([1.5,1.5,1.5,127])),false));
 await test('Nonfinite, colored or malformed camera background is rejected',()=>{for(const p of [film(undefined,[NaN,.13,.13,128]),film(undefined,[.13,.14,.13,128]),{width:1,height:1,colors:[[1,1,1,128]]}])assert.equal(standardCameraFilmValid(p),false);});
 return {pass:checks.every(c=>c.pass),checks};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),report=await cameraViewStateChecks(html);report.indexSHA256=createHash('sha256').update(html).digest('hex');await mkdir(new URL('./results/',import.meta.url),{recursive:true});await writeFile(new URL('./results/camera-view-state.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));process.exitCode=report.pass?0:1;}
