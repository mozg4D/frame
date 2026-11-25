import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../tools/browser.mjs';

export async function giKernelsBrowserChecks(page){
  const errors=[],checks=[];
  const call=(n,a={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[n,a]);
  try{
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});

    const compileResult=await page.evaluate(async()=>{
      const device=frameEngine.renderer.device;
      if(device.adapterInfo?.isFallbackAdapter)throw Error('Hardware adapter required');
      device.pushErrorScope('validation');
      try{
        const src=document.querySelector('#frame-pathtracer').textContent;
        const factory=Function('return ('+src+')')();
        const programs=factory(null,device);
        const host=document.createElement('div');document.body.append(host);
        const tracer=factory(host,device,()=>{},frameEngine.renderer.cameraShaders||{});
        try{
          if(!programs.contracts?.planFilm||!tracer.contracts?.planFilm)throw Error('Missing giContracts on programs/tracer');
          programs.contracts.validateMRT(['rg32uint','rg16float','rgba8unorm','rgba8unorm','rg16float']);
          let threw33=false;
          try{programs.contracts.validateMRT(['rg32uint','rg16float','rgba8unorm','rgba8unorm','rgba16float']);}catch{threw33=true;}
          if(!threw33)throw Error('33+ B/sample MRT must throw');
          const pCommon=await programs.common.all();
          const pRT=await programs.universal('realtime').all();
          const pIndep=await programs.universal('independent').all();
          const pGI=await programs.universal('gi').all();
          const pMips=programs.getMipPipelines();
          return {
            counts:{
              common:Object.keys(pCommon).length,
              realtime:Object.keys(pRT).length,
              independent:Object.keys(pIndep).length,
              gi:Object.keys(pGI).length,
              mips:Object.keys(pMips).length,
            },
          };
        }finally{tracer.dispose();host.remove();}
      }finally{
        const v=(await device.popErrorScope())?.message;
        if(v)throw Error('WebGPU validation error: '+v);
      }
    });
    assert.deepEqual(compileResult.counts,{common:9,realtime:2,independent:3,gi:24,mips:5});
    checks.push({name:'All 43 WGSL pipelines compile and validate on RTX hardware',pass:true});

    await call('scene.new');
    const car=await call('scene.create',{type:'car'});
    await call('view.set',{index:0,single:true,focus:car.hash});
    await call('scene.create',{type:'render',params:{realtime:'off',samples:2,environment:'default'}});
    const pt=await call('render.start');
    assert.equal(pt.phase,'complete');
    assert.equal(pt.filmFaults,0);
    assert.ok(pt.newCameraSamples>0);

    await call('scene.update',{id:(await call('scene.inspect')).objects.find(o=>o.type==='render').hash,params:{realtime:'on',samples:2}});
    await page.waitForFunction(()=>frameEngine.renderState().gi?.nodes>0,{timeout:30000});
    const st=await call('render.inspect');
    assert.ok(st.gi.nodes>=256&&st.filmFaults===0,JSON.stringify(st.gi));
    assert.ok(['webnn','wgsl'].includes(st.gi.substrate),JSON.stringify(st.gi));
    assert.equal(typeof st.gi.webnn?.available,'boolean',JSON.stringify(st.gi));
    assert.equal(typeof st.gi.webnn?.active,'boolean',JSON.stringify(st.gi));
    assert.equal(typeof st.gi.webnn?.zeroCopy,'boolean',JSON.stringify(st.gi));
    assert.equal(typeof st.gi.webnn?.backend,'string',JSON.stringify(st.gi));
    assert.equal(typeof st.gi.webnn?.reason,'string',JSON.stringify(st.gi));
    assert.deepEqual(errors,[]);
    checks.push({name:'Host Interactive GI and Progressive PT execute with zero faults',pass:true});
    return {pass:true,counts:compileResult.counts,gi:st.gi,checks};
  }catch(error){
    return {pass:false,error:error.stack||error.message,errors,checks};
  }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const s=await launch({headless:true});
  try{await ready(s.page);const r=await giKernelsBrowserChecks(s.page);console.log(JSON.stringify(r,null,2));process.exitCode=r.pass?0:1;}
  finally{await s.close();}
}
