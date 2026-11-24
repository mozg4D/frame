import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../tools/browser.mjs';

export async function giStage3CacheBrowserChecks(page){
  const errors=[],checks=[];
  const call=(n,a={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[n,a]);
  try{
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.evaluate(()=>{
      Object.defineProperty(navigator,'ml',{configurable:true,value:undefined});
      const device=frameEngine.renderer.device;
      if(device.adapterInfo?.isFallbackAdapter)throw Error('Hardware adapter required');
      device.pushErrorScope('validation');
      const sc=document.querySelector('#frame-pathtracer');
      window.giS3={factory:Function('return ('+sc.textContent+')')()};
      sc.textContent=sc.textContent.replace('return new FrameRenderer(container,changed);','return giS3.tracer=new FrameRenderer(container,changed);');
    });

    await call('scene.new');
    const floor=await call('scene.create',{type:'cube',params:{'size x':400,'size y':10,'size z':400}});
    await call('transform.set',{ids:[floor.hash],channel:'position',axis:1,value:-5});
    const back=await call('scene.create',{type:'cube',params:{'size x':400,'size y':240,'size z':10}});
    await call('transform.set',{ids:[back.hash],channel:'position',axis:1,value:115});
    await call('transform.set',{ids:[back.hash],channel:'position',axis:2,value:-150});
    const side=await call('scene.create',{type:'cube',params:{'size x':10,'size y':240,'size z':320}});
    await call('transform.set',{ids:[side.hash],channel:'position',axis:0,value:-180});
    await call('transform.set',{ids:[side.hash],channel:'position',axis:1,value:115});
    const emCard=await call('scene.create',{type:'cube',params:{'size x':80,'size y':10,'size z':80}});
    await call('transform.set',{ids:[emCard.hash],channel:'position',axis:0,value:-100});
    await call('transform.set',{ids:[emCard.hash],channel:'position',axis:1,value:210});
    const blocker=await call('scene.create',{type:'cube',params:{'size x':60,'size y':90,'size z':60}});
    await call('transform.set',{ids:[blocker.hash],channel:'position',axis:0,value:40});
    await call('transform.set',{ids:[blocker.hash],channel:'position',axis:1,value:45});

    const whiteMat=await call('material.create',{params:{h:0,s:0,l:85,rough:90}});
    const orangeMat=await call('material.create',{params:{h:28,s:95,l:55,rough:90}});
    const emMat=await call('material.create',{params:{h:40,s:80,l:90,emm:400,rough:100}});
    await call('material.assign',{id:floor.hash,material:whiteMat.uid});
    await call('material.assign',{id:back.hash,material:whiteMat.uid});
    await call('material.assign',{id:blocker.hash,material:whiteMat.uid});
    await call('material.assign',{id:side.hash,material:orangeMat.uid});
    await call('material.assign',{id:emCard.hash,material:emMat.uid});

    await call('view.set',{index:0,single:true,focus:back.hash});
    const camera=await call('scene.create',{type:'render',params:{realtime:'on',samples:4,environment:'off'}});
    await page.waitForFunction(()=>!!giS3.tracer?.giBuffers&&frameEngine.renderState().hasImage,{timeout:45000});

    const staticRun=await page.evaluate(async()=>{
      const orig=giS3.tracer,dev=orig.device;
      const host=document.createElement('div');document.body.append(host);
      const t=giS3.factory(host,dev,()=>{},frameEngine.renderer.cameraShaders||{});
      window.giS3Custom={t,host};
      const cam={position:[20,110,260],right:[1,0,0],up:[0,1,0],forward:[0,0,-1],fov:45,aspect:240/160};
      const base={...orig.options,camera:cam,onSamples:()=>{},interactivePreview:true,lightingReuse:true,outputSize:[240,160],viewKey:'s3_static'};
      const history=[];
      for(let f=0;f<6;f++){
        await t.start(base);
        history.push({...t.stats.gi,faults:t.stats.filmFaults});
      }
      const lin=await t.readLinearPixels([[0.5,0.5],[0.25,0.65],[0.75,0.65]]);
      return {history,lin};
    });

    assert.ok(staticRun.history.every(h=>h.cacheSlots>0&&h.faults===0));
    assert.ok(staticRun.history.slice(1).some(h=>h.fbUsed>0),'SHaRC 50% ping-pong feedback queue must feed subsequent frames');
    assert.equal(staticRun.history[5].fbStaleRejected,0,'Stationary sequence must have 0 stale feedback rejections');
    for(const pt of staticRun.lin)assert.ok(pt.color.every(v=>Number.isFinite(v)&&v>=0));
    const maxBounce=Math.max(...staticRun.lin.map(p=>p.color[0]+p.color[1]+p.color[2]));
    assert.ok(maxBounce>0.01,'SHaRC multi-bounce indirect lighting illuminates room walls: '+maxBounce);
    checks.push({name:'SHaRC v3 converges across stationary Interactive GI frames with active feedback',pass:true});

    // Move blocker -> epoch increments without full table wipe
    const slotsBefore=staticRun.history[5].cacheSlots;
    const epochBefore=staticRun.history[5].transportEpoch;
    await call('transform.set',{ids:[blocker.hash],channel:'position',axis:0,value:-30});
    const moveRun=await page.evaluate(async()=>{
      const {t}=window.giS3Custom,orig=giS3.tracer;
      const cam={position:[20,110,260],right:[1,0,0],up:[0,1,0],forward:[0,0,-1],fov:45,aspect:240/160};
      const movedOpts={...orig.options,camera:cam,sceneKey:'moved_scene',getScene:orig.options.getScene,onSamples:()=>{},interactivePreview:true,lightingReuse:true,outputSize:[240,160],viewKey:'s3_moved'};
      await t.start(movedOpts);
      const h1={...t.stats.gi,faults:t.stats.filmFaults};
      await t.start(movedOpts);
      const h2={...t.stats.gi,faults:t.stats.filmFaults};
      const lin=await t.readLinearPixels([[0.5,0.5],[0.45,0.65]]);
      return {h1,h2,lin};
    });

    assert.equal(moveRun.h1.cacheSlots,slotsBefore);
    assert.ok(moveRun.h1.transportEpoch>epochBefore,'Moving object increments transportEpoch for per-cell replacement');
    assert.equal(moveRun.h1.faults,0);assert.equal(moveRun.h2.faults,0);
    for(const pt of moveRun.lin)assert.ok(pt.color.every(v=>Number.isFinite(v)&&v>=0));
    checks.push({name:'Per-cell transportEpoch replacement preserves cache slots and finite output',pass:true});

    await call('render.stop');
    await call('material.assign',{id:emCard.hash,material:whiteMat.uid});
    const afterOff=await page.evaluate(async()=>{
      const {t,host}=giS3Custom;
      try{
        await t.start({...t.options,sceneKey:'extinguished'});
        const grid=Array.from({length:32*20},(_,i)=>[((i%32)+.5)/32,(Math.floor(i/32)+.5)/20]);
        const pixels=await t.readLinearPixels(grid);
        const {giBuffers:gb,device}=t,count=3840*2160;
        const read=device.createBuffer({size:32,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
        try{
          for(const list of [gb.discList,gb.glassList])device.queue.writeBuffer(list,0,new Uint32Array([count,count]));
          const cmd=device.createCommandEncoder(),pass=cmd.beginComputePass();
          pass.setPipeline(t.giPrepareIndirect);pass.setBindGroup(0,gb.guidesGroup);pass.dispatchWorkgroups(1);pass.end();
          cmd.copyBufferToBuffer(gb.giIndirect,0,read,0,32);device.queue.submit([cmd.finish()]);
          await read.mapAsync(GPUMapMode.READ);
          return {peak:Math.max(...pixels.flatMap(p=>p.color)),epoch:t.stats.gi.transportEpoch,args:[...new Uint32Array(read.getMappedRange())]};
        }finally{if(read.mapState==='mapped')read.unmap();read.destroy();}
      }finally{t.dispose();host.remove();}
    });
    assert.ok(afterOff.epoch>moveRun.h2.transportEpoch);
    assert.equal(afterOff.peak,0,'The first frame after removing the only emitter must already be dark');
    assert.deepEqual(afterOff.args,[65535,2,1,8294400,65535,2,1,8294400]);
    checks.push({name:'Light removal rejects old radiance immediately and dense 4K glass and edges fit WebGPU dispatch limits',pass:true});

    await call('scene.update',{id:camera.hash,params:{renderer:'Cached GI',realtime:'off','resolution x':192,'resolution y':128}});
    await call('material.assign',{id:emCard.hash,material:emMat.uid});
    await call('render.stop');
    await page.evaluate(()=>{
      const t=giS3.tracer,original=t.markPresented;
      giS3.frames=[];
      t.markPresented=function(...args){
        original.apply(this,args);
        if(this.completed&&this.options.cachedOutput)giS3.frames.push({gi:{...this.stats.gi},position:[...this.options.camera.position]});
      };
    });
    const still=await call('render.export',{kind:'image',download:false});
    assert.equal(still.width,192);
    const objects=(await call('scene.inspect')).objects;
    const pos=id=>objects.find(o=>o.hash===id).worldMatrix.slice(12,15);
    const eye=pos(camera.hash),box=pos(blocker.hash);
    for(const [id,base,keys] of [[camera.hash,eye,[[0,0],[3,6]]],[blocker.hash,box,[[0,0],[1,0],[2,20],[3,20]]]]){
      for(const [frame,delta] of keys)await call('animation.key',{id,path:'position',frame,value:[base[0]+delta,base[1],base[2]],interpolation:'hard'});
    }
    const video=await call('render.export',{kind:'video',start:0,end:3,download:false});
    assert.equal(video.frames,4);assert.equal(video.mime,'video/mp4');
    const frames=await page.evaluate(()=>giS3.frames);
    assert.deepEqual(frames.map(f=>f.gi.passes),[32,32,4,32,4]);
    assert.ok(frames.every(f=>f.gi.mode==='cached'));
    assert.notDeepEqual(frames[1].position,frames[2].position);
    assert.equal(frames[1].gi.transportEpoch,frames[2].gi.transportEpoch);
    assert.ok(frames[3].gi.transportEpoch>frames[2].gi.transportEpoch);
    checks.push({name:'Cached GI exports a still and a moving-camera MP4 and rebuilds lighting after an animated blocker moves',pass:true});

    await call('render.stop');
    const val=await page.evaluate(async()=>(await frameEngine.renderer.device.popErrorScope())?.message);
    assert.equal(val,undefined);assert.deepEqual(errors,[]);
    return {pass:true,staticEnd:staticRun.history.at(-1),moveRun,checks};
  }catch(error){
    await page.evaluate(()=>{try{window.giS3Custom?.t?.dispose();window.giS3Custom?.host?.remove();}catch{}}).catch(()=>{});
    return {pass:false,error:error.stack||error.message,errors,checks};
  }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const s=await launch({headless:true});
  try{await ready(s.page);const r=await giStage3CacheBrowserChecks(s.page);console.log(JSON.stringify(r,null,2));process.exitCode=r.pass?0:1;}
  finally{await s.close();}
}
