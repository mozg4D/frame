import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../tools/browser.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const meltusPath=resolve(here,'scenes/boolean-meltus8.hash');
const forestPath=resolve(here,'scenes/forest-100m.hash');

export async function runForestMeltusBenchmark(page){
  const errors=[];
  const call=(n,a={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[n,a]);
  try{
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.evaluate(()=>{
      const device=frameEngine.renderer.device;
      if(device.adapterInfo?.isFallbackAdapter)throw Error('Hardware adapter required');
      device.pushErrorScope('validation');
      const sc=document.querySelector('#frame-pathtracer');
      window.giBM={factory:Function('return ('+sc.textContent+')')()};
      sc.textContent=sc.textContent.replace('return new FrameRenderer(container,changed);','return giBM.tracer=new FrameRenderer(container,changed);');
    });

    await stat(meltusPath);
    const results={adapter:'',webnn:null,meltus:null,forest:null};

    async function benchScene(name,filePath,configs,viewRes=[1280,720]){
      const bytes=await readFile(filePath);
      await call('scene.open',{name:name+'.hash',base64:bytes.toString('base64')});
      const objs=(await call('scene.inspect')).objects;
      let cam=objs.find(o=>o.type==='render');
      if(!cam)cam=await call('scene.create',{type:'render',params:{realtime:'on',samples:4,environment:'default'}});
      else await call('scene.update',{id:cam.hash,params:{realtime:'on'}});
      await page.waitForFunction(()=>!!giBM.tracer?.giBuffers&&frameEngine.renderState().hasImage,{timeout:180000});
      await call('render.stop');

      const out=await page.evaluate(async([configs,viewRes])=>{
        const orig=giBM.tracer,dev=orig.device;
        const host=document.createElement('div');document.body.append(host);
        const t=giBM.factory(host,dev,()=>{},frameEngine.renderer.cameraShaders||{});
        const runs=[];
        try{
          const base={...orig.options,onSamples:()=>{},interactivePreview:true,lightingReuse:true,profileGPU:true,outputSize:viewRes};
          await t.start({...base,viewKey:'warmup'});
          const sceneSummary={
            triangles:t.stats.triangles,storedTriangles:t.stats.storedTriangles,
            instances:t.stats.instances,bvhMs:t.stats.bvhMs,buildMs:t.stats.buildMs,
            bvhBytes:t.stats.bvhStorageBytes,triBytes:t.stats.triangleStorageBytes,
            primaryVisibility:t.stats.gi?.primaryVisibility,
          };
          for(const cfg of configs){
            t.profiler?.reset();
            const walls=[];
            for(let f=0;f<4;f++){
              const s=performance.now();
              await t.start({...base,...cfg.opts,viewKey:'bm_'+cfg.label,lightingKeyExtra:cfg.label});
              walls.push(performance.now()-s);
              if(t.stats.phase!=='preview'||t.stats.filmFaults!==0)throw Error('Bad GI frame in '+cfg.label+': '+JSON.stringify(t.stats.errors));
            }
            await t.profiler?.flush();
            const snap=t.profiler?.snapshot()||{stages:{},supported:false};
            const stages=Object.fromEntries(Object.entries(snap.stages||{}).map(([k,v])=>[k,+v.medianMs.toFixed(2)]));
            const totalGpuMs=+Object.values(stages).reduce((a,b)=>a+b,0).toFixed(2);
            const sorted=walls.slice(1).sort((a,b)=>a-b);
            const medWallMs=+sorted[Math.floor(sorted.length/2)].toFixed(2);
            const px=await t.readLinearPixels([[0.5,0.5],[0.3,0.6],[0.7,0.4]]);
            const lums=px.map(p=>p.color[0]+p.color[1]+p.color[2]);
            if(!lums.every(v=>Number.isFinite(v)&&v>=0))throw Error('Non-finite output in '+cfg.label);
            runs.push({label:cfg.label,medWallMs,totalGpuMs,gi:t.stats.gi,stages,maxSampleLum:+Math.max(...lums).toFixed(3)});
          }
          return {adapter:dev.adapterInfo?.description||dev.adapterInfo?.architecture||'',webnn:t.webnn.snapshot(),sceneSummary,runs};
        }finally{t.dispose();host.remove();}
      },[configs,viewRes]);
      return {file:filePath,...out};
    }

    results.meltus=await benchScene('boolean-meltus8',meltusPath,[
      {label:'default-hybrid-0.5x',opts:{foliageMode:'hybrid',giTraceScale:0.5,reflections:'hybrid',giNodes:512,giSubstrate:'auto'}},
      {label:'fast-0.25x-cubemap',opts:{foliageMode:'avg-card',giTraceScale:0.25,reflections:'cubemap',giNodes:256,giSubstrate:'auto'}},
      {label:'cwbvh-refl-wgsl',opts:{foliageMode:'hybrid',giTraceScale:0.5,reflections:'cwbvh',giNodes:512,giSubstrate:'wgsl'}},
    ],[1280,720]);

    try{
      await stat(forestPath);
      results.forest=await benchScene('forest-100m',forestPath,[
        {label:'hybrid-depth2-0.5x',opts:{foliageMode:'hybrid',alphaExactDepth:2,giTraceScale:0.5,reflections:'hybrid',giNodes:512,giSubstrate:'auto'}},
        {label:'avg-card-0.5x',opts:{foliageMode:'avg-card',giTraceScale:0.5,reflections:'hybrid',giNodes:512,giSubstrate:'auto'}},
        {label:'exact-0.5x',opts:{foliageMode:'exact',giTraceScale:0.5,reflections:'hybrid',giNodes:512,giSubstrate:'auto'}},
        {label:'fast-avg-0.25x-ssr',opts:{foliageMode:'avg-card',giTraceScale:0.25,reflections:'ssr',giNodes:256,giSubstrate:'auto'}},
      ],[1280,720]);
    }catch(e){
      results.forest={skipped:e.message};
    }

    results.adapter=results.meltus.adapter;
    results.webnn=results.meltus.webnn;
    const val=await page.evaluate(async()=>(await frameEngine.renderer.device.popErrorScope())?.message);
    assert.equal(val,undefined);assert.deepEqual(errors,[]);
    return {pass:true,...results};
  }catch(error){
    return {pass:false,error:error.stack||error.message,errors};
  }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const s=await launch({headless:true});
  try{await ready(s.page);const r=await runForestMeltusBenchmark(s.page);console.log(JSON.stringify(r,null,2));process.exitCode=r.pass?0:1;}
  finally{await s.close();}
}
