import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../tools/browser.mjs';

// Pause the real camera readback so cancellation can be exercised even on fast GPUs.
export async function holdCameraReadback(page){
  await page.evaluate(()=>{
    const original=GPUBuffer.prototype.mapAsync;
    let release;const gate=new Promise(resolve=>release=resolve);
    GPUBuffer.prototype.mapAsync=async function(...args){
      if(this.label==='Camera output readback')await gate;
      return original.apply(this,args);
    };
    window.releaseCameraReadback=()=>{GPUBuffer.prototype.mapAsync=original;delete window.releaseCameraReadback;release();};
  });
}

export async function cameraViewChecks(page){
  const call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]);
  await call('scene.new');
  const object=await call('scene.create',{type:'cube'});
  await call('view.set',{index:0,single:true,focus:object.hash,shading:'solid'});
  const camera=await call('scene.create',{type:'render',params:{'resolution x':160,'resolution y':96}});
  await call('scene.select',{ids:[camera.hash]});await page.locator('#tabAttributes').click();
  const labels=await page.locator('#attrContent .attr-lab').allTextContents();
  assert.equal(labels[labels.indexOf('resolution')+1]?.toLowerCase(),'quality');
  assert.equal(await page.locator('#attrContent [data-field="denoiser"]').count(),0);
  const rows=await page.locator('.ob-row[data-id]').count();assert.ok(rows>=2);
  await page.locator('.ob-row[data-id="'+camera.id+'"] .ob-name').click({button:'right'});
  assert.ok(await page.getByRole('menuitem',{name:'Group',exact:true}).isVisible());
  assert.equal(await page.getByRole('menuitem',{name:/denoiser/i}).count(),0);
  await page.keyboard.press('Escape');
  const params=async()=>(await call('scene.inspect')).objects.find(n=>n.hash===camera.hash).params;
  assert.equal((await params()).renderer,'Viewport');
  await call('scene.update',{id:camera.hash,params:{quality:71}});assert.equal((await params()).quality,71);
  await call('edit.history',{action:'undo'});assert.equal((await params()).quality,50);
  await call('edit.history',{action:'redo'});assert.equal((await params()).quality,71);
  const saved=await call('scene.export',{includeData:true});
  await call('scene.open',{name:'camera-output.hash',base64:saved.base64});
  assert.equal((await params()).quality,71);
  await call('scene.select',{ids:[camera.hash]});await page.locator('#tabAttributes').click();
  const output=await call('render.export',{kind:'image',download:false});
  assert.equal(output.width,160);assert.equal(output.height,96);assert.ok(output.bytes>0);
  const pixels=await call('render.pixels',{points:[[.5,.5],[0,0]]});
  assert.ok(pixels.colors.every(c=>c.length===4&&c[3]===255));assert.notDeepEqual(pixels.colors[0],pixels.colors[1]);
  await assert.rejects(call('render.pixels',{points:[[.5,.5]],linear:true}),/display RGBA/);
  for(const single of [false,true]){
    await call('view.set',{index:0,single});
    const capture=page.waitForEvent('download');
    await page.locator('#frameRenderToggle').click();
    const file=await capture;assert.equal(file.suggestedFilename(),'frame-view.png');
    const stream=await file.createReadStream(),chunks=[];for await(const c of stream)chunks.push(c);
    const png=Buffer.concat(chunks);
    const dimensions=await page.locator('#frame-engine-canvas').evaluate(c=>[c.width,c.height]);
    assert.deepEqual([png.readUInt32BE(16),png.readUInt32BE(20)],dimensions);
  }
  await holdCameraReadback(page);
  const download=file=>{throw Error('Cancelled export downloaded '+file.suggestedFilename());};
  page.on('download',download);
  try{
    await page.locator('#frameRenderImage').click();
    await page.getByRole('button',{name:'Stop image render',exact:true}).click();
  }finally{await page.evaluate(()=>releaseCameraReadback());}
  await page.waitForFunction(()=>!frameEngine.renderState().exportKind);page.off('download',download);
  assert.ok((await call('render.start')).visible);assert.equal((await call('render.stop')).visible,false);
  await call('scene.new');assert.equal((await call('render.inspect')).hasImage,false);
  return {pass:true,width:output.width,height:output.height};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const session=await launch({headless:true});
  try{await ready(session.page);console.log(await cameraViewChecks(session.page));}finally{await session.close();}
}
