import assert from 'node:assert/strict';
import {launch,ready} from '../tools/browser.mjs';

const errors=[];
const {page,close}=await launch({headless:true});
const call=(name,args={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[name,args]);
const settled=()=>page.waitForFunction(()=>frameEngine.renderState().phase==='complete'||frameEngine.renderState().phase==='error',null,{timeout:15000}).then(async()=>{const s=await page.evaluate(()=>frameEngine.renderState());if(s.phase!=='complete')throw Error('Render failed: '+JSON.stringify(s));});

try{
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await ready(page);

  await page.evaluate(()=>{
    const device=frameEngine.renderer.device;
    if(device.adapterInfo.isFallbackAdapter)throw Error('Hardware adapter required');
    device.pushErrorScope('validation');
  });

  await call('scene.new');
  const cube=await call('scene.create',{type:'cube',params:{'size x':100,'size y':100,'size z':100}});
  await call('view.set',{index:0,single:true,focus:cube.hash});
  const camera=await call('scene.create',{type:'render',params:{realtime:'on',samples:999,environment:'default','rays per pixel':1}});

  // 1. Verify Camera attributes UI
  await call('scene.select',{ids:[camera.hash]});
  await page.locator('#tabAttributes').click();
  const ui=await page.evaluate(()=>{
    const rows=[...document.querySelectorAll('#attrContent .attr-row')].map(r=>({
      label:r.querySelector('.attr-lab')?.textContent?.trim()||'',
      fields:[...r.querySelectorAll('[data-field]')].map(el=>el.dataset.field),
      values:[...r.querySelectorAll('[data-value]')].map(el=>el.dataset.value)
    }));
    const rendererBtns=[...document.querySelectorAll('#attrContent [data-field="renderer"]')].map(el=>el.dataset.value);
    return {rows,rendererBtns};
  });
  assert.deepEqual(ui.rendererBtns,['Path tracer','Viewport'],'renderer options exclude Cached GI');
  const allFields=ui.rows.flatMap(r=>r.fields);
  assert.ok(!allFields.includes('foliage mode'),'foliage mode removed');
  assert.ok(!allFields.includes('gi rays')&&!allFields.includes('gi bounces')&&!allFields.includes('cubemap size'),'GI fields removed');
  assert.ok(!ui.rows.some(r=>r.label==='WebNN'),'WebNN status row removed');
  const envRowIdx=ui.rows.findIndex(r=>r.fields.includes('environment'));
  assert.ok(envRowIdx>=0,'environment row exists');
  assert.deepEqual(ui.rows[envRowIdx+1].fields,['rays per pixel'],'exactly one parameter under environment: rays per pixel');

  // 2. Fixed single-shot render completes without progressive refinement (samples ignored)
  await settled();
  const st1=await call('render.inspect');
  assert.equal(st1.phase,'complete');
  assert.equal(st1.raysPerPixel,1);
  assert.equal(st1.samples,1);
  assert.equal(st1.presentedFrames,1,'single fixed render presentation');
  assert.ok(st1.visible&&st1.hasImage);

  const px1=await call('render.pixels',{points:[[0.5,0.5],[0.05,0.05]],linear:true});
  assert.equal(px1.colors.length,2);
  for(const c of px1.colors){
    assert.ok(c.slice(0,3).every(v=>Number.isFinite(v)&&v>=0),'finite linear HDR pixel');
    assert.equal(c[3],1,'linear pixel reports raysPerPixel=1');
  }
  assert.ok(px1.colors[0].slice(0,3).some(v=>v>0.01),'center cube pixel is lit');

  const rgba1=await call('render.pixels',{points:[[0.5,0.5]],linear:false});
  assert.ok(rgba1.colors[0].slice(0,3).some(v=>v>5),'display RGBA is non-black');

  // 3. Changing rays per pixel updates fixed render
  await call('scene.update',{id:camera.hash,params:{'rays per pixel':4}});
  await page.waitForFunction(()=>frameEngine.renderState().phase==='complete'&&frameEngine.renderState().raysPerPixel===4,null,{timeout:60000});
  const st4=await call('render.inspect');
  assert.equal(st4.raysPerPixel,4);
  assert.equal(st4.presentedFrames,2,'exactly one extra presentation for new rays per pixel');
  const px4=await call('render.pixels',{points:[[0.5,0.5]],linear:true});
  assert.equal(px4.colors[0][3],4);

  // 4. Environment off + Infinite light + shadow
  const light=await call('scene.create',{type:'infinite',params:{intensity:200,'angular size':5}});
  const beforeOff=(await call('render.inspect')).presentedFrames;
  await call('scene.update',{id:camera.hash,params:{environment:'off'}});
  await page.waitForFunction(n=>frameEngine.renderState().phase==='complete'&&frameEngine.renderState().presentedFrames>n,beforeOff,{timeout:15000});
  const pxLight=await call('render.pixels',{points:[[0.5,0.35],[0.05,0.05]],linear:true});
  assert.ok(pxLight.colors[1].slice(0,3).every(v=>v===0),'sky is black with environment off');
  assert.ok(pxLight.colors[0].slice(0,3).some(v=>v>0.01),'cube top face lit by infinite light');

  // 5. Instanced geometry (Cloner) renders via TLAS+BLAS CWBVH8
  await call('scene.update',{id:camera.hash,params:{environment:'default'}});
  const cloner=await call('scene.create',{type:'cloner',params:{type:'radial',count:4,radius:180}});
  await call('scene.update',{id:cube.hash,parent:cloner.hash});
  await page.waitForFunction(()=>frameEngine.renderState().phase==='complete'&&frameEngine.renderState().instances>=4,null,{timeout:15000});

  // 6. Export image at configured resolution
  await call('scene.update',{id:camera.hash,params:{'resolution x':320,'resolution y':180}});
  const exp=await call('render.export',{kind:'image',download:false});
  assert.equal(exp.width,320);
  assert.equal(exp.height,180);
  assert.ok(exp.bytes>100);

  // 7. Navigation with realtime during navigation ON and OFF
  await call('view.set',{index:0,single:true,focus:cloner.hash});
  await settled();
  const rect=await page.locator('#frame-engine-canvas').boundingBox(),x=rect.x+rect.width*.6,y=rect.y+rect.height*.5;
  await page.mouse.move(x,y);await page.mouse.down();
  await page.mouse.move(x+30,y+10,{steps:4});
  await page.mouse.up();
  await settled();

  await call('scene.select',{ids:[camera.hash]});
  const toggle=page.locator('button[data-field="realtime during navigation"]');
  const beforeToggle=(await call('render.inspect')).presentedFrames;
  await toggle.click();
  await page.waitForFunction(n=>frameEngine.renderState().phase==='complete'&&frameEngine.renderState().presentedFrames>n,beforeToggle,{timeout:10000});
  assert.equal(await toggle.getAttribute('aria-pressed'),'false');
  await page.mouse.move(x,y);await page.mouse.down();
  for(let i=1;i<=10;i++)await page.mouse.move(x-i*4,y-i*2);
  await page.waitForFunction(()=>!frameEngine.renderState().visible&&!frameEngine.renderState().running,null,{timeout:5000});
  await page.mouse.up();
  await settled();
  assert.ok((await call('render.inspect')).visible);

  // Check zero WebGPU validation errors
  const gpuErr=await page.evaluate(()=>frameEngine.renderer.device.popErrorScope());
  assert.equal(gpuErr,null,'no WebGPU validation errors');
  assert.deepEqual(errors,[],'no page or console errors');
  console.log('ALL FIXED RESTIR+CWBVH8 CHECKS PASSED');
}catch(err){
  console.error('TEST FAILURE:',err);
  try{console.error('renderState:',await page.evaluate(()=>frameEngine?.renderState?.()));}catch{}
  try{console.error('errors:',errors);}catch{}
  throw err;
}finally{
  await close();
}
