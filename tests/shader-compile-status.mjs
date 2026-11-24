import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {launch,ready} from '../tools/browser.mjs';

function hookShaderCompile(){
  const gate={pending:{},seenSlow:false,seenReject:false,seenBg:false};
  window.__shaderStatusTest=gate;
  for(const method of ['createComputePipelineAsync','createRenderPipelineAsync']){
    const native=GPUDevice.prototype[method];
    GPUDevice.prototype[method]=function(descriptor){
      const label=descriptor?.label||'';
      const base=native.call(this,descriptor);
      if(label.startsWith('TEST_HOLD:')){
        const key=label.slice('TEST_HOLD:'.length);
        return base.then(async pipe=>{
          await new Promise((resolve,reject)=>{gate.pending[key]={resolve,reject};});
          return pipe;
        });
      }
      return base;
    };
  }
}

export async function shaderCompileStatusChecks(page){
  const checks=[],timings=[],errors=[];
  const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});if(!pass)throw Error(name+': '+JSON.stringify(detail));};
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(hookShaderCompile);
  await page.reload();
  await ready(page);

  await page.evaluate(()=>{
    if(frameEngine.renderer.device.adapterInfo.isFallbackAdapter)throw Error('Hardware WebGPU adapter required');
    window.__scGpuErrs=[];
    frameEngine.renderer.device.addEventListener('uncapturederror',e=>__scGpuErrs.push(e.error.message));
    window.__scObserved=[];
    const host=document.getElementById('frame-engine-host');
    window.__scObs=new MutationObserver(()=>{
      const el=document.getElementById('frame-shader-progress');
      if(el)window.__scObserved.push({text:el.textContent,connected:el.isConnected,top:el.style.top});
    });
    window.__scObs.observe(host,{childList:true,subtree:true,attributes:true});
  });

  // 1. Trigger scene draw so background idle warmup runs to completion, and assert indicator stayed hidden during idle warmup.
  await page.evaluate(()=>frameAI.call('scene.create',{type:'cube'}));
  await page.waitForFunction(()=>frameEngine.renderer.cameraWarmup?.done,null,{timeout:60000});
  const idleObs=await page.evaluate(()=>({observed:window.__scObserved.length,state:frameEngine.shaderCompileState()}));
  check('Silent camera idle warmup never shows shader progress notice',idleObs.observed===0&&!idleObs.state.visible&&idleObs.state.active===0,idleObs);

  // 2. Fast compile (<100ms) never triggers notice.
  await page.evaluate(async()=>{
    const d=frameEngine.renderer.device;
    const mod=d.createShaderModule({code:'@compute @workgroup_size(1) fn main(){}'});
    await d.createComputePipelineAsync({label:'TEST_FAST',layout:'auto',compute:{module:mod,entryPoint:'main'}});
  });
  await page.waitForTimeout(60);
  const fastState=await page.evaluate(()=>({observed:window.__scObserved.length,state:frameEngine.shaderCompileState()}));
  check('Fast shader compilation under 350ms keeps notice hidden',fastState.observed===0&&!fastState.state.visible,fastState);

  // 3. Delayed foreground compile (>=350ms): hidden before 350ms, visible after 350ms at top-left, shifts to top:28px when file progress present, hides on resolve.
  const t0=performance.now();
  await page.evaluate(()=>{
    const d=frameEngine.renderer.device;
    const mod=d.createShaderModule({code:'@compute @workgroup_size(1) fn main(){}'});
    window.__slowP=d.createComputePipelineAsync({label:'TEST_HOLD:fgSlow',layout:'auto',compute:{module:mod,entryPoint:'main'}});
  });
  await page.waitForTimeout(120);
  const early=await page.evaluate(()=>frameEngine.shaderCompileState());
  check('Foreground compile under 350ms does not flash early',early.active===1&&!early.visible,early);

  await page.waitForFunction(()=>frameEngine.shaderCompileState().visible,null,{timeout:5000});
  const elapsedMs=performance.now()-t0;
  timings.push({name:'Shader compile notice appearance latency',ms:elapsedMs});
  const shown=await page.evaluate(()=>{
    const el=document.getElementById('frame-shader-progress'),host=document.getElementById('frame-engine-host');
    const er=el.getBoundingClientRect(),hr=host.getBoundingClientRect(),css=getComputedStyle(el);
    return {text:el.textContent,left:Math.round(er.left-hr.left),top:Math.round(er.top-hr.top),zIndex:Number(css.zIndex),role:el.getAttribute('role')};
  });
  check('Notice shows Compiling shaders... at top-left after delay',shown.text==='Compiling shaders...'&&shown.left===8&&shown.top===8&&shown.zIndex===6&&elapsedMs>=320,shown);

  // Overlap stacking with #frame-file-progress and z-index above #frame-render-canvas.
  const shifted=await page.evaluate(()=>{
    const host=document.getElementById('frame-engine-host');
    const fp=Object.assign(document.createElement('div'),{id:'frame-file-progress',textContent:'Saving HASH...'});
    const rc=Object.assign(document.createElement('canvas'),{id:'frame-render-canvas'});
    host.append(fp,rc);
    return new Promise(r=>requestAnimationFrame(()=>{
      const el=document.getElementById('frame-shader-progress');
      const er=el.getBoundingClientRect(),hr=host.getBoundingClientRect();
      const sZ=Number(getComputedStyle(el).zIndex),rZ=Number(getComputedStyle(rc).zIndex)||0;
      fp.remove();rc.remove();
      requestAnimationFrame(()=>{
        const restored=Math.round(el.getBoundingClientRect().top-hr.top);
        r({shiftedTop:Math.round(er.top-hr.top),restoredTop:restored,aboveCanvas:sZ>rZ,sZ,rZ});
      });
    }));
  });
  check('Notice shifts to 28px below other status row and renders above render canvas',shifted.shiftedTop===28&&shifted.restoredTop===8&&shifted.aboveCanvas,shifted);

  await page.evaluate(async()=>{window.__shaderStatusTest.pending.fgSlow.resolve();await window.__slowP;});
  const afterResolve=await page.evaluate(()=>frameEngine.shaderCompileState());
  check('Notice clears cleanly on resolve',afterResolve.active===0&&!afterResolve.visible,afterResolve);

  // 4. Slow foreground compile that rejects also clears cleanly.
  await page.evaluate(()=>{
    const d=frameEngine.renderer.device;
    const mod=d.createShaderModule({code:'@compute @workgroup_size(1) fn main(){}'});
    window.__rejP=d.createComputePipelineAsync({label:'TEST_HOLD:fgRej',layout:'auto',compute:{module:mod,entryPoint:'main'}}).catch(e=>e);
  });
  await page.waitForFunction(()=>frameEngine.shaderCompileState().visible,null,{timeout:5000});
  const resRej=await page.evaluate(async()=>{window.__shaderStatusTest.pending.fgRej.reject(Error('simulated failure'));const err=await window.__rejP;return {msg:err.message,state:frameEngine.shaderCompileState()};});
  check('Notice clears cleanly on rejection',resRej.msg==='simulated failure'&&resRej.state.active===0&&!resRej.state.visible,resRej);

  // 5. Explicit background warmup stays silent even when slow (>450ms); foreground joining triggers notice.
  await page.evaluate(()=>{
    const d=frameEngine.renderer.device;
    const mod=d.createShaderModule({code:'@compute @workgroup_size(1) fn main(){}'});
    window.__bgP=window.frameWithBackgroundShaderWarmup(()=>d.createComputePipelineAsync({label:'TEST_HOLD:bgSlow',layout:'auto',compute:{module:mod,entryPoint:'main'}}));
  });
  await page.waitForTimeout(450);
  const bgHeld=await page.evaluate(()=>frameEngine.shaderCompileState());
  check('Background warmup held over 450ms stays silent',!bgHeld.visible&&bgHeld.active===0,bgHeld);

  await page.evaluate(()=>{
    const d=frameEngine.renderer.device;
    const mod=d.createShaderModule({code:'@compute @workgroup_size(1) fn main(){}'});
    window.__fgJoin=d.createComputePipelineAsync({label:'TEST_HOLD:fgJoin',layout:'auto',compute:{module:mod,entryPoint:'main'}});
  });
  await page.waitForFunction(()=>frameEngine.shaderCompileState().visible,null,{timeout:5000});
  await page.evaluate(async()=>{
    window.__shaderStatusTest.pending.bgSlow.resolve();
    window.__shaderStatusTest.pending.fgJoin.resolve();
    await Promise.all([window.__bgP,window.__fgJoin]);
    window.__scObs.disconnect();
  });
  const finalState=await page.evaluate(()=>({state:frameEngine.shaderCompileState(),gpuErrors:window.__scGpuErrs}));
  check('Foreground compile shows notice while background warmup runs, then clears',finalState.state.active===0&&!finalState.state.visible&&!finalState.gpuErrors.length&&!errors.length,{finalState,errors});

  return {pass:true,checks,timings};
}

if(fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  const session=await launch({headless:process.argv.includes('--headless')});
  try{
    await ready(session.page);
    const res=await shaderCompileStatusChecks(session.page);
    console.log(JSON.stringify(res,null,2));
  }finally{await session.close();}
}
