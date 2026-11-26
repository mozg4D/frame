import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {serve,ready} from '../tools/browser.mjs';
import {sampleRasterViews,rasterLinks} from './camera-raster-transport.mjs';
import {applyRasterGraph} from './camera-raster-apply.mjs';

const reportPath=process.argv.find(x=>x.startsWith('--report='))?.slice(9);
const channel=process.argv.find(x=>x.startsWith('--channel='))?.slice(10)||'chromium';
const server=await serve();let browser;
try{
  browser=await chromium.launch({headless:true,channel,executablePath:process.env.FRAME_BROWSER||undefined,args:['--enable-unsafe-webgpu','--enable-features=WebMachineLearningNeuralNetwork']});
  const page=await browser.newPage({viewport:{width:1024,height:740},deviceScaleFactor:1});
  await page.goto(server.url+'/index.html');await ready(page);
  const call=(n,a={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[n,a]);
  await page.evaluate(()=>{if(frameEngine.renderer.device.adapterInfo.isFallbackAdapter)throw Error('Hardware required');
    const el=document.getElementById('frame-pathtracer');el.textContent=el.textContent.replace('return new FrameRenderer(container,changed);',
      'window.rasterSource=cameraIntegrationCore+cameraPatchKey;return window.rasterTracer=new FrameRenderer(container,changed);');});
  for(const f of [sampleRasterViews,rasterLinks,applyRasterGraph])await page.addScriptTag({content:'window.'+f.name+'='+f.toString()});
  await call('scene.new');
  const mat=(name,h,s,l,emm=0)=>call('material.create',{name,params:{h,s,l,emm,ior:1,rough:100}});
  const red=await mat('Red diffuse floor',0,100,50),white=await mat('White receiver',0,0,88),lamp=await mat('Area emission',0,0,100,300);
  const black=await mat('Dark absorber',0,0,0),cutout=await mat('Cutout card',0,0,15);
  const mask=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=32;const ctx=c.getContext('2d');ctx.fillStyle='black';ctx.fillRect(0,0,32,32);ctx.fillStyle='white';ctx.fillRect(0,0,16,32);return c.toDataURL().split(',')[1];});
  await call('material.texture',{material:cutout.uid,slot:'opacity',base64:mask,name:'cutout.png'});
  async function plate(name,x,z,extent,material){
    const m=await call('mesh.create',{name,vertices:[x-extent,-extent,z,x+extent,-extent,z,x+extent,extent,z,x-extent,extent,z],indices:[0,1,2,0,2,3]});
    await call('material.assign',{id:m.hash,material:material.uid});return m;
  }
  await plate('Red reflector outside the current view',0,0,170,red);await plate('Ceiling',0,100,170,white);
  const source=await plate('Small area light',85,100,26,lamp);
  await plate('Thin occluder',139,45,14,black);await plate('Alpha card',-82,42,22,cutout);
  await call('scene.create',{type:'render',params:{realtime:'off',environment:'off',quality:1,'resolution x':160,'resolution y':90}});
  await call('render.export',{kind:'image',download:false});await call('render.stop');
  await page.evaluate(()=>{window.rasterBase=rasterTracer.options;});
  const report={browser:browser.version(),units:'ms',scenarios:[]};
  async function scenario(name,ml,size){
    const run=await page.evaluate(async({name,ml,size})=>{
      const t=rasterTracer,native={position:[0,0,65],right:[1,0,0],up:[0,1,0],forward:[0,0,1],fov:45,aspect:16/9};
      const side={...native,forward:[.8,0,-.6],right:[-.6,0,-.8],fov:90,aspect:1.6};
      const base={...rasterBase,sceneKey:name,geometryKey:name,current:undefined,quality:40};
      await t.start({...base,camera:native,viewKey:name+'ref',outputSize:[160,90],renderer:'Path tracer',finish:true,previewPresentation:false});
      if(t.stats.phase!=='complete')throw Error(t.stats.errors.join('\n'));
      const points=Array.from({length:64},(_,i)=>[.495+(i%8)/800,.495+(i>>3)/800]);
      const ref=await t.readLinearPixels(points),reference=[0,1,2].map(k=>ref.reduce((s,p)=>s+p.color[k]/ref.length,0));
      const start=performance.now(),views=await sampleRasterViews({views:[side,native],grid:[48,27],size,base});
      const graph=rasterLinks(views),before=performance.now(),fixed=await applyRasterGraph(graph,views.grid,ml,start);
      return {name,size,reference,knownDonorMass:graph.knownDonorMass,observed:graph.represented,hidden:graph.hidden,slots:views.slots,
        counts:graph.counts,captureCosts:views.costs,captureCompileMs:views.compileMs,linkBuildMs:graph.buildMs,
        msUntilOperator:before-start,experimentWallIncludingBackendReplays:performance.now()-start, ...fixed};
    },{name,ml,size});
    report.scenarios.push(run);if(reportPath)await writeFile(reportPath,JSON.stringify(report,null,2));
    console.log(JSON.stringify({name,patches:run.patches,known:run.knownDonorMass,capture:run.msUntilOperator,center:run.center,pt:run.reference,
      wgsl:run.wgsl.p50,webnn:run.webnn.map(m=>[m.weights,m.runtime,m.endToEnd?.p50,m.failure])}));
    assert.ok(run.wgsl.nrmse<1e-5&&run.links>0);return run;
  }
  const lit=await scenario('Unique geometry with a partially hidden donor',true,[3840,2160]);
  assert.ok(lit.hidden>0&&lit.reference[0]>0&&lit.counts.raster>0&&lit.counts.secondaryHit>0);
  const wall=await plate('Intervening black wall',0,45,260,black);
  const blocked=await scenario('Complete occlusion',false,[640,360]);
  assert.ok(blocked.center.every(x=>x<.002));
  await call('scene.delete',{ids:[wall.hash,source.hash]});
  const off=await scenario('Source deleted',false,[640,360]);assert.ok(off.center.every(x=>x===0));
}finally{await browser?.close();await server.close();}
