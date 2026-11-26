import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../tools/browser.mjs';

export async function cameraIdleWarmupChecks(page){
  await page.addInitScript(()=>{
    const probe=window.warmProbe={calls:[]};let hold='raster';
    for(const method of ['createComputePipelineAsync','createRenderPipelineAsync']){
      const native=GPUDevice.prototype[method];
      GPUDevice.prototype[method]=function(desc){
        const promise=native.call(this,desc);if(!desc.label?.startsWith('Camera '))return promise;
        const name=desc.label.slice(7);probe.calls.push(name);
        if(name===hold){hold=null;return promise.then(async pipeline=>{await new Promise(resolve=>probe.release=resolve);return pipeline;});}
        return promise;
      };
    }
  });
  await page.reload();await ready(page);
  const call=(n,a={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[n,a]);
  await call('scene.new');const cube=await call('scene.create',{type:'cube'});await call('view.set',{index:0,single:true,focus:cube.hash});
  await page.waitForFunction(()=>warmProbe.release,null,{timeout:60000});
  assert.equal((await call('render.inspect')).phase,'idle');assert.equal(await page.locator('#frame-render-canvas').count(),0);
  const camera=await call('scene.create',{type:'render',params:{realtime:'on',quality:1}});
  await page.waitForFunction(()=>frameEngine.renderState().running);
  assert.equal(await page.evaluate(()=>warmProbe.calls.filter(x=>x==='raster').length),1);
  await page.evaluate(()=>warmProbe.release());
  await page.waitForFunction(()=>frameEngine.renderState().phase==='complete',null,{timeout:90000});
  const before=await page.evaluate(()=>warmProbe.calls.slice());assert.ok(before.includes('opaqueGather')&&before.includes('resolve'));
  await call('scene.update',{id:camera.hash,params:{quality:5}});
  await page.waitForFunction(()=>{const s=frameEngine.renderState();return s.phase==='complete'&&s.quality===5;},null,{timeout:30000});
  const calls=await page.evaluate(()=>warmProbe.calls.slice());
  for(const entry of ['raster','opaqueGather','resolve','meter'])assert.equal(calls.filter(k=>k===entry).length,1);
  return {pass:true,calls};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const run=await launch({headless:true});
  try{await ready(run.page);const result=await cameraIdleWarmupChecks(run.page);console.log(JSON.stringify(result));process.exitCode=result.pass?0:1;}
  finally{await run.close();}
}
