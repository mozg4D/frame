import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../tools/browser.mjs';

export async function giStage2DirectBrowserChecks(page){
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
      window.giS2={factory:Function('return ('+sc.textContent+')')()};
      sc.textContent=sc.textContent.replace('return new FrameRenderer(container,changed);','return giS2.tracer=new FrameRenderer(container,changed);');
    });

    await call('scene.new');
    const floor=await call('scene.create',{type:'cube',params:{'size x':600,'size y':10,'size z':600}});
    await call('transform.set',{ids:[floor.hash],channel:'position',axis:1,value:-5});
    const pillar=await call('scene.create',{type:'cube',params:{'size x':60,'size y':240,'size z':60}});
    await call('transform.set',{ids:[pillar.hash],channel:'position',axis:1,value:120});
    const sphere=await call('scene.create',{type:'sphere',params:{diameter:90}});
    await call('transform.set',{ids:[sphere.hash],channel:'position',axis:0,value:-120});
    await call('transform.set',{ids:[sphere.hash],channel:'position',axis:1,value:45});
    const light=await call('scene.create',{type:'infinite'});
    await call('scene.update',{id:light.hash,params:{intensity:250,'temperature K':5800,'angular size':1.5}});
    await call('transform.set',{ids:[light.hash],channel:'rotation',axis:2,value:-40});
    await call('view.set',{index:0,single:true,focus:pillar.hash});
    await call('scene.create',{type:'render',params:{realtime:'on',samples:4,environment:'default'}});

    await page.waitForFunction(()=>!!giS2.tracer?.giBuffers&&frameEngine.renderState().hasImage,{timeout:45000});
    const res=await page.evaluate(async()=>{
      const orig=giS2.tracer,dev=orig.device;
      const host=document.createElement('div');document.body.append(host);
      const t=giS2.factory(host,dev,()=>{},frameEngine.renderer.cameraShaders||{});
      try{
        const w=320,h=180;
        const base={...orig.options,onSamples:()=>{},interactivePreview:true,lightingReuse:true,outputSize:[w,h],viewKey:'giS2_persp'};
        await t.start(base);
        const gb=t.giBuffers,st=t.stats.gi;
        const plan=t.contracts.gbufferPlan(w,h);
        const lin=await t.readLinearPixels([[0.5,0.5],[0.2,0.85],[0.5,0.88],[0.8,0.85]]);
        // Orthographic pass through G-Buffer + Direct
        await t.start({...base,camera:{...base.camera,ortho:t.scene.scale*1.1},viewKey:'giS2_ortho'});
        const orthoSt=t.stats.gi;
        const orthoLin=await t.readLinearPixels([[0.5,0.5],[0.25,0.8]]);
        return {
          planCost:plan.colorAttachmentCost,
          hizMips:gb.hizMips,
          hiZW:gb.hiZ.width,
          hiZH:gb.hiZ.height,
          gbufFormats:[gb.gbufId.format,gb.gbufNormal.format,gb.gbufAlbedo.format,gb.gbufMaterial.format,gb.gbufDepth.format],
          st,orthoSt,lin,orthoLin,faults:t.stats.filmFaults,errors:t.stats.errors,
        };
      }finally{t.dispose();host.remove();}
    });

    assert.equal(res.planCost,28);
    assert.deepEqual(res.gbufFormats,['rg32uint','rg16float','rgba8unorm','rgba8unorm','depth32float']);
    assert.ok(res.hizMips>1&&res.hiZW===160&&res.hiZH===90,JSON.stringify(res));
    assert.ok(res.st.discCount>0,'Discontinuity direct list must populate on lit silhouettes: '+res.st.discCount);
    assert.equal(res.faults,0);
    assert.deepEqual(res.errors,[]);
    for(const pt of [...res.lin,...res.orthoLin]){
      assert.ok(pt.color.every(v=>Number.isFinite(v)&&v>=0),'Finite non-negative direct output');
    }
    const maxLum=Math.max(...res.lin.map(p=>p.color[0]+p.color[1]+p.color[2]));
    const orthoLum=Math.max(...res.orthoLin.map(p=>p.color[0]+p.color[1]+p.color[2]));
    assert.ok(maxLum>0.01&&orthoLum>0.01,'Both perspective and orthographic G-buffer direct passes produce light');
    checks.push({name:'4-MRT reverse-Z G-Buffer, Hi-Z mips, giGuides and giDiscontinuityDirect verified',pass:true});

    await call('render.stop');
    const val=await page.evaluate(async()=>(await frameEngine.renderer.device.popErrorScope())?.message);
    assert.equal(val,undefined);assert.deepEqual(errors,[]);
    return {pass:true,res,checks};
  }catch(error){
    return {pass:false,error:error.stack||error.message,errors,checks};
  }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const s=await launch({headless:true});
  try{await ready(s.page);const r=await giStage2DirectBrowserChecks(s.page);console.log(JSON.stringify(r,null,2));process.exitCode=r.pass?0:1;}
  finally{await s.close();}
}
