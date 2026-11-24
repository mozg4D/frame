import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../tools/browser.mjs';

export async function giStage4InteractiveBrowserChecks(page){
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
      window.giS4={factory:Function('return ('+sc.textContent+')')(),events:[]};
      sc.textContent=sc.textContent.replace('return new FrameRenderer(container,changed);',`
        const tr=new FrameRenderer(container,changed),mp=tr.markPresented;
        tr.markPresented=function(started){
          mp.call(this,started);
          giS4.events.push({at:performance.now(),interactive:!!this.stats.interactivePreview,
            mode:this.stats.gi?.mode,frozen:this.hasFrozenPreview,samples:this.stats.samples,
            submissions:this.stats.performance?.submissions});
        };
        return giS4.tracer=tr;`);
    });

    await call('scene.new');
    const car=await call('scene.create',{type:'car'});
    const floor=await call('scene.create',{type:'cube',params:{'size x':500,'size y':10,'size z':500}});
    await call('transform.set',{ids:[floor.hash],channel:'position',axis:1,value:-5});
    const metalMat=await call('material.create',{params:{h:210,s:15,l:80,rough:10,metal:100}});
    await call('material.assign',{id:floor.hash,material:metalMat.uid});
    await call('view.set',{index:0,single:true,focus:car.hash});
    await call('scene.create',{type:'render',params:{realtime:'on',samples:4,environment:'default'}});

    // 1. Verify Interactive GI first frame and warm RevisionGate 250ms settle handoff on host
    await page.waitForFunction(()=>frameEngine.renderState().phase==='complete',{timeout:60000});
    const coldSeq=await page.evaluate(()=>({events:giS4.events.slice(),state:frameEngine.renderState()}));
    assert.ok(coldSeq.events.some(e=>e.interactive&&e.mode==='interactive'&&e.frozen&&e.submissions===1),'Expected cold single-submission Interactive GI');
    assert.equal(coldSeq.state.samples,4);

    await page.evaluate(()=>{giS4.events.length=0;});
    await call('transform.set',{ids:[floor.hash],channel:'position',axis:1,value:-8});
    await page.waitForFunction(()=>frameEngine.renderState().phase==='complete'&&giS4.events.some(e=>!e.interactive),{timeout:30000});
    const hostSeq=await page.evaluate(()=>({events:giS4.events.slice(),state:frameEngine.renderState()}));
    const firstInteractive=hostSeq.events.find(e=>e.interactive);
    const firstProgressive=hostSeq.events.find(e=>!e.interactive);
    assert.ok(firstInteractive,'Expected warm Interactive GI preview event');
    assert.equal(firstInteractive.mode,'interactive');
    assert.equal(firstInteractive.frozen,true);
    assert.equal(firstInteractive.submissions,1,'Interactive GI must execute in 1 submission');
    assert.ok(firstProgressive,'Expected settled Progressive PT refinement event');
    assert.equal(hostSeq.state.samples,4);
    assert.ok(firstProgressive.at-firstInteractive.at>=200,'RevisionGate settle delay before Progressive PT: '+(firstProgressive.at-firstInteractive.at));
    checks.push({name:'Single-submission Interactive GI and 250ms RevisionGate handoff verified',pass:true});

    // 2. Stationary stability vs instant specular reset when reflective floor material changes
    await call('render.stop');
    const temporal=await page.evaluate(async()=>{
      const orig=giS4.tracer,dev=orig.device;
      const host=document.createElement('div');document.body.append(host);
      const t=giS4.factory(host,dev,()=>{},frameEngine.renderer.cameraShaders||{});
      window.giS4Custom={t,host};
      const base={...orig.options,onSamples:()=>{},interactivePreview:true,lightingReuse:true,outputSize:[200,140],viewKey:'s4_t'};
      for(let i=0;i<3;i++)await t.start(base);
      const p3=await t.readLinearPixels([[0.5,0.5],[0.3,0.75],[0.7,0.75]]);
      await t.start(base);
      const p4=await t.readLinearPixels([[0.5,0.5],[0.3,0.75],[0.7,0.75]]);
      let maxDiff=0;
      for(let i=0;i<p3.length;i++)for(let c=0;c<3;c++)maxDiff=Math.max(maxDiff,Math.abs(p3[i].color[c]-p4[i].color[c]));
      return {p4,maxDiff,subs:t.stats.performance.submissions};
    });
    assert.equal(temporal.subs,1);
    assert.ok(temporal.maxDiff<0.25,'Stationary interactive temporal stability bounded: '+temporal.maxDiff);

    // Move car + darken floor albedo/roughness -> instant reset on changed reflection without stale ghosting
    await call('transform.set',{ids:[car.hash],channel:'position',axis:0,value:200});
    const matteMat=await call('material.create',{params:{h:10,s:90,l:30,rough:85,metal:0}});
    await call('material.assign',{id:floor.hash,material:matteMat.uid});
    const resetCheck=await page.evaluate(async()=>{
      const {t,host}=window.giS4Custom,orig=giS4.tracer;
      try{
        await t.start({...orig.options,sceneKey:'s4_changed',onSamples:()=>{},interactivePreview:true,lightingReuse:true,outputSize:[200,140],viewKey:'s4_changed'});
        const lin=await t.readLinearPixels([[0.5,0.5],[0.3,0.75]]);
        return {epoch:t.stats.gi.transportEpoch,faults:t.stats.filmFaults,lin};
      }finally{t.dispose();host.remove();}
    });
    assert.ok(resetCheck.epoch>=2&&resetCheck.faults===0);
    for(const pt of resetCheck.lin)assert.ok(pt.color.every(Number.isFinite));
    checks.push({name:'Stationary temporal convergence and instant specular reset on edit verified',pass:true});

    const val=await page.evaluate(async()=>(await frameEngine.renderer.device.popErrorScope())?.message);
    assert.equal(val,undefined);assert.deepEqual(errors,[]);
    return {pass:true,handoffMs:firstProgressive.at-firstInteractive.at,maxDiff:temporal.maxDiff,checks};
  }catch(error){
    await page.evaluate(()=>{try{window.giS4Custom?.t?.dispose();window.giS4Custom?.host?.remove();}catch{}}).catch(()=>{});
    return {pass:false,error:error.stack||error.message,errors,checks};
  }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const s=await launch({headless:true});
  try{await ready(s.page);const r=await giStage4InteractiveBrowserChecks(s.page);console.log(JSON.stringify(r,null,2));process.exitCode=r.pass?0:1;}
  finally{await s.close();}
}
