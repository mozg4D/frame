import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../tools/browser.mjs';

export async function giStage1ProgressiveBrowserChecks(page){
  const errors=[],checks=[];
  const call=(n,a={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[n,a]);
  try{
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.evaluate(()=>{
      const device=frameEngine.renderer.device;
      if(device.adapterInfo?.isFallbackAdapter)throw Error('Hardware adapter required');
      device.pushErrorScope('validation');
      const sc=document.querySelector('#frame-pathtracer');
      window.giS1={factory:Function('return ('+sc.textContent+')')()};
      sc.textContent=sc.textContent.replace('return new FrameRenderer(container,changed);','return giS1.tracer=new FrameRenderer(container,changed);');
    });

    await call('scene.new');
    const box=await call('scene.create',{type:'cube',params:{'size x':220,'size y':10,'size z':220}});
    await call('transform.set',{ids:[box.hash],channel:'position',axis:1,value:-5});
    const wall=await call('scene.create',{type:'cube',params:{'size x':220,'size y':180,'size z':10}});
    await call('transform.set',{ids:[wall.hash],channel:'position',axis:2,value:-80});
    const panel=await call('scene.create',{type:'cube',params:{'size x':90,'size y':90,'size z':10}});
    await call('transform.set',{ids:[panel.hash],channel:'position',axis:0,value:-120});
    await call('transform.set',{ids:[panel.hash],channel:'position',axis:1,value:70});
    const em=await call('material.create',{params:{h:35,s:90,l:90,emm:500,rough:100}});
    await call('material.assign',{id:panel.hash,material:em.uid});
    const glossy=await call('material.create',{params:{h:0,s:0,l:92,rough:18,metal:0}});
    await call('material.assign',{id:box.hash,material:glossy.uid});
    await call('material.assign',{id:wall.hash,material:glossy.uid});
    await call('view.set',{index:0,single:true,focus:wall.hash});
    await call('scene.create',{type:'render',params:{realtime:'off',samples:4,environment:'off','resolution x':128,'resolution y':96}});
    const initial=await call('render.export',{kind:'image',download:false});
    assert.ok(initial.bytes>0);

    const stage1=await page.evaluate(async()=>{
      const orig=giS1.tracer,dev=orig.device,baseOpts={...orig.options,onSamples:()=>{},previewPresentation:false,frameSeed:9101};
      const w=128,h=96;

      // 1. Compact 20B/px & Denoiser progression 3 -> 2 -> 1 -> 0
      const host1=document.createElement('div');document.body.append(host1);
      const t1=giS1.factory(host1,dev,()=>{},frameEngine.renderer.cameraShaders||{});
      const iters=[],sampleReads=[];
      try{
        for(const s of [1,4,16,64]){
          await t1.start({...baseOpts,sampleLimit:s,outputSize:[w,h],viewKey:'den'+s});
          if(t1.stats.phase!=='complete'||t1.stats.filmFaults!==0)throw Error('Bad PT phase/faults');
          iters.push(t1.contracts.atrousIterations(s));
          sampleReads.push({s,filmBytes:t1.filmPages[0].filmBuf.size,m2Bytes:t1.filmPages[0].m2Buf.size});
        }
        const singleFilm=(await t1.readFilm()).data.slice();

        // 2. Forced Multi-Page Split Parity (2 MiB storage binding limit at 512x512 -> 3 pages)
        const mw=512,mh=512;
        await t1.start({...baseOpts,sampleLimit:4,outputSize:[mw,mh],viewKey:'sp512'});
        const singleSplitRef=(await t1.readFilm()).data.slice();
        const tightLimits={};
        for(const k of Object.getOwnPropertyNames(Object.getPrototypeOf(dev.limits)))if(k!=='constructor')tightLimits[k]=dev.limits[k];
        tightLimits.maxStorageBufferBindingSize=2*1024*1024;
        const host2=document.createElement('div');document.body.append(host2);
        const t2=giS1.factory(host2,dev,()=>{});
        let splitPages=0,splitErr=0,multiLinear=0;
        Object.defineProperty(dev,'limits',{configurable:true,value:tightLimits});
        try{
          await t2.start({...baseOpts,sampleLimit:4,outputSize:[mw,mh],viewKey:'sp512'});
          splitPages=t2.filmPages.length;
          const multiFilm=(await t2.readFilm()).data;
          for(let i=0;i<singleSplitRef.length;i++)splitErr=Math.max(splitErr,Math.abs(singleSplitRef[i]-multiFilm[i]));
          const linPts=await t2.readLinearPixels([[0.5,0.5]]);
          multiLinear=linPts[0].color.reduce((a,b)=>a+b,0);
        }finally{delete dev.limits;t2.dispose();host2.remove();}

        // 3. Zero indirect clamp check on bright bounce
        await t1.start({...baseOpts,sampleLimit:32,outputSize:[128,96],maxBounces:4,viewKey:'hdrBounce'});
        const fullFilm=await t1.readFilm();
        let maxIndirectLum=0;
        for(let i=0;i<fullFilm.data.length;i+=4){
          const r=fullFilm.data[i],g=fullFilm.data[i+1],b=fullFilm.data[i+2];
          if(!Number.isFinite(r)||!Number.isFinite(g)||!Number.isFinite(b))throw Error('Non-finite pixel');
          maxIndirectLum=Math.max(maxIndirectLum,r*0.2126+g*0.7152+b*0.0722);
        }
        return {iters,sampleReads,splitPages,splitErr,multiLinear,maxIndirectLum,pixels:w*h};
      }finally{t1.dispose();host1.remove();}
    });

    assert.deepEqual(stage1.iters,[3,2,1,0]);
    for(const r of stage1.sampleReads){
      assert.equal(r.filmBytes,stage1.pixels*16);
      assert.equal(r.m2Bytes,stage1.pixels*4);
    }
    checks.push({name:'Compact 20B/px film and 3->2->1->0 atrous progression verified',pass:true});

    assert.ok(stage1.splitPages>1,'Forced multi-page film split must produce >1 page');
    assert.ok(stage1.splitErr<1e-4,'Multi-page film must match single-page film: '+stage1.splitErr);
    assert.ok(stage1.maxIndirectLum>1.0,'Unbiased indirect energy preserves bright HDR > 1.0: '+stage1.maxIndirectLum);
    checks.push({name:'Multi-page planFilm parity and zero indirect clamp verified',pass:true});

    const aiPix=await call('render.pixels',{points:[[0.5,0.5],[0.25,0.75]],linear:true});
    assert.equal(aiPix.colors.length,2);
    for(const c of aiPix.colors)assert.ok(c.length===4&&c.every(Number.isFinite)&&c[3]>0);
    checks.push({name:'frameAI render.pixels linear readout uses readLinearPixels cleanly',pass:true});

    const val=await page.evaluate(async()=>(await frameEngine.renderer.device.popErrorScope())?.message);
    assert.equal(val,undefined);assert.deepEqual(errors,[]);
    return {pass:true,stage1,checks};
  }catch(error){
    return {pass:false,error:error.stack||error.message,errors,checks};
  }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const s=await launch({headless:true});
  try{await ready(s.page);const r=await giStage1ProgressiveBrowserChecks(s.page);console.log(JSON.stringify(r,null,2));process.exitCode=r.pass?0:1;}
  finally{await s.close();}
}
