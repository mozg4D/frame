import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {basename} from 'node:path';
import {launch,ready} from '../tools/browser.mjs';

const args=process.argv.slice(2),option=key=>args.find(v=>v.startsWith('--'+key+'='))?.split('=').slice(1).join('=');
const files=args.filter(v=>!v.startsWith('--')),repeats=Number(option('frames')||10),report=option('report'),images=option('images');
assert.ok(files.length,'Pass one or more HASH scene paths');
const results={units:'ms',quality:50,dpr:1,runs:[]};
async function orbit(page,call,camera){
  await call('view.set',{index:0,single:true});
  const canvas=page.locator('#frame-engine-canvas');
  for(let i=0;i<2;i++){
    const [w,h]=await canvas.evaluate(c=>[c.width,c.height]),size=page.viewportSize();
    if(w===3840&&h===2160)break;
    await page.setViewportSize({width:size.width+3840-w,height:size.height+2160-h});
    await page.waitForTimeout(100);
  }
  await call('scene.update',{id:camera.hash,params:{realtime:'on','realtime during navigation':true}});
  await page.waitForFunction(()=>{const t=benchmarkCamera;return t.canvas.style.display==='block'&&t.lastImage?.viewport&&t.lastImage.width===3840&&t.lastImage.height===2160&&!String(t.lastImage.viewKey).startsWith('benchmark-');},null,{timeout:120000});
  await page.evaluate(()=>{
    const t=benchmarkCamera,requests=new WeakMap(),old=t.start,changed=t.onChange;
    const events=[],frames=[],model=window.cameraOrbit={events,frames};let previous=t.stats.presentedFrames;
    const input=e=>{if(e.buttons&1)events.push(e.timeStamp);};
    window.addEventListener('pointermove',input,true);
    t.start=function(options){requests.set(options,events.at(-1));return old.call(this,options);};
    t.onChange=function(){
      changed();const seq=this.stats.presentedFrames;
      if(seq<=previous)return;previous=seq;
      const event=requests.get(this.options);
      if(event===undefined||this.stats.phase!=='preview')return;
      const at=performance.now(),row={at,input:event,inputToOverlayMs:at-event,eye:[...this.options.camera.position]};frames.push(row);
      requestAnimationFrame(()=>{row.rafMs=performance.now()-event;row.visibleAtRaf=t.canvas.style.display==='block'&&!t.canvas.hidden;});
    };
    model.restore=()=>{window.removeEventListener('pointermove',input,true);t.start=old;t.onChange=changed;};
  });
  const rect=await canvas.boundingBox(),x=rect.x+rect.width*.6,y=rect.y+rect.height*.52;
  await page.mouse.move(x,y);await page.mouse.down();
  const begin=performance.now();
  for(let i=1;i<=100;i++){
    const delay=begin+i*16-performance.now();if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));
    await page.mouse.move(x+i*1.4,y+20*Math.sin(i*.035));
  }
  await page.waitForTimeout(150);await page.mouse.up();
  const observation=await page.evaluate(()=>{
    const {events,frames,restore}=cameraOrbit;restore();
    const times=events.length?frames.filter(f=>f.at>=events[0]&&f.at<=events.at(-1)):[];
    const percentile=(a,q)=>a.length?a.toSorted((a,b)=>a-b)[Math.ceil(q*a.length)-1]:null;
    const intervals=times.slice(1).map((f,i)=>f.at-times[i].at);
    return {size:[benchmarkCamera.canvas.width,benchmarkCamera.canvas.height],inputEvents:events.length,framesDuringInput:times.length,
      inputStreamMs:events.at(-1)-events[0],inputToOverlayP95:percentile(times.map(f=>f.inputToOverlayMs),.95),
      overlayIntervalP50:percentile(intervals,.5),overlayIntervalP95:percentile(intervals,.95),
      inputToNextRafP95:percentile(times.filter(f=>f.visibleAtRaf).map(f=>f.rafMs),.95),
      longIntervals:intervals.filter(v=>v>1000/60+1).length,frames};
  });
  await call('render.stop');assert.ok(observation.framesDuringInput>=2,JSON.stringify(observation));
  return observation;
}
for(const path of files){
  const session=await launch({headless:true}),{page}=session;
  const call=(n,a={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[n,a]);
  const run={scene:basename(path),errors:[]};results.runs.push(run);
  try{
    await ready(page);page.on('pageerror',e=>run.errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')run.errors.push(m.text());});
    await page.evaluate(()=>{
      const source=document.getElementById('frame-pathtracer');
      source.textContent=source.textContent.replace('return new FrameRenderer(container,changed);','return window.benchmarkCamera=new FrameRenderer(container,changed);');
      if(frameEngine.renderer.device.adapterInfo.isFallbackAdapter)throw Error('Hardware adapter required');
    });
    await call('scene.open',{name:run.scene,base64:(await readFile(path)).toString('base64')});
    const {objects}=await call('scene.inspect');run.objects=objects.length;
    let camera=objects.find(n=>n.type==='render'&&n.enabled)||objects.find(n=>n.type==='render');
    const opts={realtime:'off',quality:50,renderer:'Interactive GI','resolution x':640,'resolution y':360};
    if(camera){run.camera=camera.name;await call('scene.update',{id:camera.hash,enabled:true,params:opts});}
    else{run.camera='Camera created at the saved perspective';camera=await call('scene.create',{type:'render',params:{...opts,environment:'default'}});}
    await call('render.stop');
    const begin=performance.now();const exported=await call('render.export',{kind:'image',download:false});run.coldExportMs=performance.now()-begin;
    assert.equal(exported.width,640);assert.equal(exported.height,360);
    run.triangles=(await call('render.inspect')).triangles;
    console.log(run.scene,'opened',run.objects,'objects,',run.triangles,'triangles');
    if(images){
      const png=await page.evaluate(async()=>{
        const {width,height,rgba}=await benchmarkCamera.readImage(),c=document.createElement('canvas');
        c.width=width;c.height=height;c.getContext('2d').putImageData(new ImageData(rgba,width,height),0,0);return c.toDataURL('image/png').split(',')[1];
      });
      await writeFile(images+'/'+run.scene.replace(/\.hash$/i,'')+'.png',Buffer.from(png,'base64'));
    }
    run.views=[];
    for(const size of [[1280,720],[3840,2160]]){
      const v=await page.evaluate(async({size,repeats})=>{
        const t=benchmarkCamera,base=t.options,dev=t.device;
        const rows=[],gpu=dev.adapterInfo,original=base.camera;
        const cameraFor=i=>{
          const a=.012*i,c=Math.cos(a),s=Math.sin(a),r=original.right,f=original.forward;
          return {...original,aspect:size[0]/size[1],right:r.map((v,j)=>c*v-s*f[j]),forward:f.map((v,j)=>s*r[j]+c*v)};
        };
        for(let i=0;i<=repeats;i++){
          const camera=cameraFor(i),o={...base,rect:{x:0,y:0,w:size[0],h:size[1]},outputSize:size,quality:50,camera,motion:true,
            renderer:'Interactive GI',previewPresentation:true,finish:false,refine:false,current:undefined,viewKey:'benchmark-'+size+'-'+i};
          const at=performance.now();await t.start(o);const wall=performance.now()-at;
          if(t.stats.phase!=='preview')throw Error(JSON.stringify(t.stats));
          if(i)rows.push({wall,...t.stats.previewGpuMs,grid:t.stats.lightingGrid});
        }
        const times=rows.map(r=>r.wall).sort((a,b)=>a-b),p=q=>times[Math.ceil(times.length*q)-1];
        return {size,primary:t.stats.primaryVisibility,adapter:gpu.description||gpu.architecture,p50:p(.5),p95:p(.95),p99:p(.99),over16_67:times.filter(t=>t>1000/60).length,rows};
      },{size,repeats});
      run.views.push(v);console.log(run.scene,size.join('x'),v.primary,'p50',v.p50,'p95',v.p95);
    }
    if(args.includes('--orbit')){
      run.orbit=await orbit(page,call,camera);
      console.log(run.scene,'4K pointer stream',run.orbit.framesDuringInput,'frames, interval p95',run.orbit.overlayIntervalP95,'ms, input to ready p95',run.orbit.inputToOverlayP95);
    }
    assert.deepEqual(run.errors,[]);
  }catch(error){run.failure=error.stack;console.error(run.failure);}
  finally{await session.close();if(report)await writeFile(report,JSON.stringify(results,null,2));}
}
if(results.runs.some(r=>r.failure))process.exitCode=1;
