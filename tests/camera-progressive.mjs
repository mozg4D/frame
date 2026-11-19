import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../tools/browser.mjs';

export async function cameraProgressiveChecks(page){
  const errors=[],cases=[];
  const call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]);
  try{
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    await page.evaluate(()=>{
      const device=frameEngine.renderer.device;
      if(device.adapterInfo.isFallbackAdapter)throw Error('Hardware adapter required');
      device.pushErrorScope('validation');
      const script=document.querySelector('#frame-pathtracer');
      window.progressiveFixture={factory:Function('return ('+script.textContent+')')(),startup:[]};
      script.textContent=script.textContent.replace('return new FrameRenderer(container,changed);',`
        progressiveFixture.distribution=environmentDistribution;
        const camera=progressiveFixture.camera=new FrameRenderer(container,changed);
        const build=camera.buildScene.bind(camera),compile=camera.initCameraPipelines.bind(camera);
        camera.buildScene=async(...args)=>{await build(...args);progressiveFixture.startup.push('scene ready');};
        camera.initCameraPipelines=(...args)=>{progressiveFixture.startup.push('compile');return compile(...args);};
        return camera;`);
    });
    await call('scene.new');
    const car=await call('scene.create',{type:'car'});
    await call('view.set',{index:0,single:true,focus:car.hash});
    const cameraNode=await call('scene.create',{type:'render',params:{realtime:'off',samples:1,environment:'default'}});
    for(const scene of ['opaque','orthographic','inside bounds','sky and sun','transmission','unlit sky']){
      if(scene==='transmission'){
        const glass=await call('material.create',{params:{opac:60,rough:12,h:190,s:35,l:65}});
        await call('material.assign',{id:car.hash,material:glass.uid});
      }
      const initial=await call('render.start');
      assert.equal(initial.phase,'complete',JSON.stringify(initial.errors));
      if(scene==='opaque'){
        assert.deepEqual(await page.evaluate(()=>progressiveFixture.startup),['compile','scene ready']);
        assert.ok(initial.snapshot.bufferBatches>0,'Camera reads the stock mesh and its material masks in a single batch');
      }
      await call('render.stop');
      const result=await page.evaluate(async scene=>{
        const sky=scene==='unlit sky',cached=!sky&&scene!=='transmission';
        const {factory,camera}=progressiveFixture;
        const options={...camera.options,outputSize:[157,101],sampleLimit:cached?19:sky?143:145,
          frameSeed:4231,sampler:cached?'sobol':'random',viewKey:'fixed',previewPresentation:false};
        if(scene==='orthographic')options.camera={...options.camera,ortho:camera.scene.scale*1.1};
        if(scene==='inside bounds'){
          // Stay inside the root BVH but outside the stock car's enclosed cabin.
          const {center,scale,meshStates}=camera.scene,direction=options.camera.position.map((v,i)=>v-center[i]);
          const entry=Math.min(...direction.map((d,i)=>{
            if(!d)return Infinity;
            const faces=meshStates.map(m=>m.bounds[d>0?i+3:i]);
            return (d>0?Math.max(...faces):Math.min(...faces))*scale/d;
          }));
          options.camera={...options.camera,position:center.map((v,i)=>v+.98*entry*direction[i])};
        }
        if(sky||scene==='sky and sun'){
          options.camera={...options.camera,forward:options.camera.forward.map(v=>-v)};
          const sun={direction:options.camera.forward,angle:.16,color:[.4,.7,1],intensity:1};
          options.environment={...options.environment,mode:'off',infiniteLights:sky?[]:[sun]};
        }
        async function render(serial,interrupt){
          const host=document.createElement('div');document.body.append(host);
          const tracer=factory(host,camera.device,()=>{});
          const started=performance.now();
          let checkpoint,meters=0;
          try{
            const meter=tracer.meterExposure.bind(tracer);
            tracer.meterExposure=encoder=>{meters++;meter(encoder);};
            if(!serial){
              // Exercise the row stride used when a full-image pass exceeds a GPU's X limit.
              const dispatch=tracer.dispatchPixels;
              tracer.dispatchPixels=function(pass,count){
                const limits={maxComputeWorkgroupsPerDimension:127};
                return dispatch.call(count===157*101?{device:{limits}}:this,pass,count);
              };
            }
            if(interrupt){
              // Force a split *inside* a later sample block, after the first presentation.
              Object.defineProperty(tracer,'progressiveBudget',{get:()=>8192,set(){}});
              const submit=tracer.submitCommands.bind(tracer);
              tracer.submitCommands=encoder=>{
                submit(encoder);
                if(encoder.label==='Progressive camera'&&tracer.progress?.sample>=4&&tracer.progress.offset>0){
                  checkpoint={sample:tracer.progress.sample,offset:tracer.progress.offset};
                  tracer.submitCommands=submit;tracer.stop(false);
                }
              };
            }
            const settings={...options,optimize:!serial,legacyScheduling:serial,previewPresentation:serial};
            await tracer.start(settings);
            if(interrupt){
              if(!checkpoint||tracer.completed)throw Error('Expected partial film');
              await tracer.start(settings);
            }
            const stats=tracer.stats;
            if(stats.phase!=='complete'||stats.lightingReuse!==cached||stats.samples!==options.sampleLimit)
              throw Error(JSON.stringify({phase:stats.phase,reuse:stats.lightingReuse,samples:stats.samples,errors:stats.errors}));
            const film=await tracer.readFilm(),image=await tracer.readImage();
            return {film,image,checkpoint,meters,ms:performance.now()-started,queueBuilds:stats.queueBuilds,
              tiles:cached?[tracer.surfaceTileCount,tracer.skyTileCount]:null,
              submissions:stats.performance.submissions,samples:stats.newCameraSamples};
          }finally{tracer.dispose();host.remove();}
        }
        const reference=await render(true,false),packed=await render(false,false),resumed=await render(false,true);
        let min=Infinity,max=0,low=Infinity,high=-Infinity;
        for(let i=0;i<reference.film.data.length;i++){
          const value=reference.film.data[i];
          if(!Number.isFinite(value)||value!==packed.film.data[i]||value!==resumed.film.data[i])
            throw Error('Linear film mismatch at float '+i+' ('+[value,packed.film.data[i],resumed.film.data[i]]+')');
          const channel=i%reference.film.stride;
          if(channel===3){min=Math.min(min,value);max=Math.max(max,value);}
          if(channel<3){low=Math.min(low,value);high=Math.max(high,value);}
        }
        for(let i=0;i<reference.image.rgba.length;i++){
          if(reference.image.rgba[i]!==packed.image.rgba[i]||reference.image.rgba[i]!==resumed.image.rgba[i])
            throw Error('Display mismatch at byte '+i);
        }
        return {scene,min,max,range:high-low,tiles:packed.tiles,queueBuilds:packed.queueBuilds,samples:packed.samples,
          meters:[reference.meters,packed.meters,resumed.meters],
          referenceSamples:reference.samples,resumedSamples:resumed.samples,checkpoint:resumed.checkpoint,
          serial:reference.submissions,packed:packed.submissions,ms:packed.ms};
      },scene);
      cases.push(result);
      assert.ok(result.ms<10000&&result.packed<result.serial,JSON.stringify(result));
      assert.ok(result.checkpoint.sample>=4&&result.checkpoint.offset>0);
      assert.equal(new Set(result.meters).size,1);
      assert.equal(result.samples,result.referenceSamples);assert.equal(result.samples,result.resumedSamples);
      if(scene==='unlit sky'){
        assert.equal(result.range,0);assert.equal(result.min,130);assert.equal(result.max,130);
        assert.equal(result.meters[0],21);assert.ok(result.queueBuilds>0);
      }else{
        assert.ok(result.range>.1);
        if(result.tiles){
          assert.equal(result.min,19);assert.equal(result.max,19);
          const [surface,sky]=result.tiles;
          assert.equal(surface+sky,Math.ceil(157/16)*Math.ceil(101/16));
          if(scene==='opaque')assert.ok(surface>0&&sky>0);
          if(scene==='sky and sun')assert.equal(surface,0);
        }
        else{assert.ok(result.min>=128&&result.min<result.max&&result.max===145);assert.ok(result.queueBuilds>0);}
      }
    }
    const distribution=await page.evaluate(async()=>{
      const width=64,height=32,cells=width*height,data=new Float32Array(cells*4);
      data.fill(1);data.set([1e12,1e12,1e12],(cells>>1)*4);
      const table=await progressiveFixture.distribution({width,height,data});
      function sample(value,low,high){
        while(low<high){const mid=(low+high)>>>1;if(table[mid*4]<value)low=mid+1;else high=mid;}
        return low;
      }
      const f=new Float32Array(1),bits=new Uint32Array(f.buffer);
      let duplicates=0,narrow=0,probes=0;
      for(let k=0;k<cells;k++){
        const cdf=table[k*4];
        if(k&&cdf===table[(k-1)*4])duplicates++;
        if(table[k*4+3]-table[k*4+2]<2)narrow++;
        f[0]=cdf;bits[0]--;const below=f[0];bits[0]+=2;
        for(const value of [below,cdf,f[0],k/cells,(k+.5)/cells]){
          if(!(value>=0&&value<=1))continue;
          const at=Math.min(cells-1,Math.floor(value*cells))*4;
          if(sample(value,0,cells-1)!==sample(value,table[at+2],table[at+3]))
            throw Error('Environment CDF mismatch at '+value);
          probes++;
        }
      }
      return {duplicates,narrow,probes};
    });
    assert.ok(distribution.duplicates>0&&distribution.narrow>1000&&distribution.probes>8000);
    const material=await call('material.create',{params:{h:24,s:65,l:48}});
    await call('material.assign',{id:car.hash,material:material.uid});
    const normalMap=await page.evaluate(()=>{
      const canvas=document.createElement('canvas');canvas.width=canvas.height=4;
      const context=canvas.getContext('2d');context.fillStyle='rgb(128,230,204)';context.fillRect(0,0,4,4);
      return canvas.toDataURL().split(',')[1];
    });
    for(const samples of [1,12]){
      await call('scene.update',{id:cameraNode.hash,params:{samples}});
      await page.evaluate(()=>{delete progressiveFixture.untexturedPipeline;});
      const variants=[];
      for(const edit of [null,{base64:normalMap},{remove:true}]){
        if(edit)await call('material.texture',{material:material.uid,slot:'normal',...edit});
        await page.evaluate(()=>{progressiveFixture.startup.length=0;});
        const frame=await call('render.start');
        assert.equal(frame.phase,'complete',JSON.stringify(frame.errors));
        if(edit)assert.deepEqual(await page.evaluate(()=>progressiveFixture.startup),['compile','scene ready'],
          'Material specialization starts before geometry and texture uploads finish at '+samples+' samples');
        variants.push(await page.evaluate(()=>{
          const {camera}=progressiveFixture;
          progressiveFixture.untexturedPipeline??=camera.gatherIrradiance;
          return [camera.scene.materialMaps,camera.gatherIrradiance===progressiveFixture.untexturedPipeline];
        }));
        await call('render.stop');
      }
      assert.deepEqual(variants,[[false,true],[true,false],[false,true]]);
    }
    const validation=await page.evaluate(async()=>(await frameEngine.renderer.device.popErrorScope())?.message);
    assert.equal(validation,undefined);assert.deepEqual(errors,[]);
    return {pass:true,cases,distribution};
  }catch(error){return {pass:false,error:error.stack,cases,errors};}
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const session=await launch({headless:true});
  try{await ready(session.page);const result=await cameraProgressiveChecks(session.page);console.log(JSON.stringify(result));process.exitCode=result.pass?0:1;}
  finally{await session.close();}
}
