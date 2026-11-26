import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../tools/browser.mjs';

export async function cameraProgressiveChecks(page){
  const call=(name,args={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[name,args]);
  const adapter=await page.evaluate(()=>{
    const device=frameEngine.renderer.device;device.pushErrorScope('validation');
    const script=document.querySelector('#frame-pathtracer');
    script.textContent=script.textContent.replace('return new FrameRenderer(container,changed);','return window.progressCamera=new FrameRenderer(container,changed);');
    return device.adapterInfo.isFallbackAdapter;
  });assert.equal(adapter,false);
  await call('scene.new');const car=await call('scene.create',{type:'car'});await call('view.set',{index:0,single:true,focus:car.hash});
  await call('scene.create',{type:'render',params:{realtime:'off',quality:12,'resolution x':157,'resolution y':101}});
  await call('render.export',{kind:'image',download:false});await call('render.stop');
  const cases=await page.evaluate(async()=>{
    const t=progressCamera,base=t.options,points=Array.from({length:157*101},(_,i)=>[((i%157)+.5)/157,((i/157|0)+.5)/101]),results=[];
    for(const denoiser of ['on','off']){
      let key=denoiser;
      const settings={...base,quality:12,denoiser,outputSize:[157,101],previewPresentation:false,current:undefined};
      await t.start({...settings,viewKey:key,finish:true});if(t.stats.phase!=='complete')throw Error(JSON.stringify(t.stats));
      const passes=t.stats.samples,reference=await t.readLinearPixels(points),display=await t.readImage();
      key+=' resumed';
      for(let i=0;i<passes;i++){
        await t.start({...settings,viewKey:key,finish:false,refine:true});
        if(t.stats.samples!==i+1)throw Error('A refinement step must publish exactly one complete pass');
        if(i===0)t.stop(false);
      }
      const actual=await t.readLinearPixels(points),next=await t.readImage();
      let maxError=0,low=Infinity,high=0;
      for(let i=0;i<actual.length;i++)for(let c=0;c<3;c++){
        const v=actual[i].color[c];maxError=Math.max(maxError,Math.abs(v-reference[i].color[c]));low=Math.min(low,v);high=Math.max(high,v);
      }
      results.push({denoiser,passes,maxError,range:high-low,identicalDisplay:next.rgba.every((v,i)=>v===display.rgba[i])});
    }return results;
  });
  for(const row of cases){assert.ok(row.passes>1&&row.range>.1&&row.maxError===0&&row.identicalDisplay,JSON.stringify(row));}
  const validation=await page.evaluate(async()=>(await frameEngine.renderer.device.popErrorScope())?.message);
  assert.equal(validation,undefined);return {pass:true,cases};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const session=await launch({headless:true});
  try{await ready(session.page);const result=await cameraProgressiveChecks(session.page);console.log(JSON.stringify(result));process.exitCode=result.pass?0:1;}
  finally{await session.close();}
}
