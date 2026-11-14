import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {launch,ready} from '../tools/browser.mjs';

const reference=JSON.parse(await readFile(new URL('./fixtures/automatic-normal-reference.json',import.meta.url),'utf8'));
const session=await launch({headless:true}),checks=[],errors=[];
try{
  await ready(session.page);const page=session.page,call=(n,a={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[n,a]);
  page.on('pageerror',e=>errors.push(e.message));
  await page.evaluate(()=>{window.normalErrors=[];frameEngine.renderer.device.addEventListener('uncapturederror',e=>normalErrors.push(e.error.message));frameEngine.renderer.device.pushErrorScope('validation');});
  const check=(name,pass,detail)=>{assert.ok(pass,name+': '+JSON.stringify(detail));checks.push(name);console.log('PASS '+name);};
  const plane={vertices:[-50,-50,0,50,-50,0,50,50,0,-50,50,0],indices:[0,1,2,0,2,3]};
  await call('render.stop');const owner=await call('mesh.create',plane),material=await call('material.create',{name:'Automatic normal smoke',params:{l:100,rough:75,bump:100,normalY:-1}});
  await call('material.assign',{id:owner.hash,material:material.uid});await call('view.set',{index:0,single:true,mode:'object',shading:'solid',focus:owner.hash});
  const state=()=>call('scene.inspect'),select=async()=>{const i=(await state()).materials.findIndex(m=>m.uid===material.uid);await page.locator('#tabMaterials').click();await page.locator(`[data-material="${i}"] canvas`).click();await page.locator('#tabMaterialMgr').click();};
  await select();check('Normal intensity is editable before connecting any texture',await page.locator('#inpBump').isVisible()&&await page.locator('#inpBump').isEnabled());
  const samples=async points=>page.evaluate(async points=>{
    const s=frameEngine.renderer.materialState,d=frameEngine.renderer.device,layer=s.layers.get('normal:'+frameMaterialState().library.find(m=>m.name==='Automatic normal smoke').colorAsset),side=s.atlas.width,stride=Math.ceil(side*4/256)*256;
    const b=d.createBuffer({size:stride*side,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    try{const e=d.createCommandEncoder();e.copyTextureToBuffer({texture:s.atlas,origin:[0,0,layer]},{buffer:b,bytesPerRow:stride},[side,side]);d.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);const bytes=new Uint8Array(b.getMappedRange());return points.map(([x,y])=>Array.from(bytes.slice(y*stride+x*4,y*stride+x*4+4)));}finally{b.destroy();}
  },points);
  for(const fixture of reference.materials){
    await call('material.texture',{material:material.uid,slot:'baseColor',url:fixture.source});
    const pixels=await samples(fixture.points),delta=Math.max(...pixels.flatMap((p,i)=>p.map((v,c)=>Math.abs(v-fixture.normals[i][c]))));
    check('Matches reviewed '+fixture.source.slice(9,15),delta<=2,{maxByteDelta:delta});
  }
  await select();check('Normal strength is available without a normal map; Bump row is removed',await page.locator('#inpBump').isVisible()&&await page.locator('#inpHeight').count()===0&&await page.locator('#heightLab').count()===0);
  check('Automatic convention is OpenGL and cannot be toggled',await page.locator('#btnNormalY').textContent()==='+Y'&&await page.locator('#btnNormalY').isDisabled());
  const before=await page.evaluate(()=>{const s=frameEngine.renderer.materialState;window.normalAtlasBefore=s.atlas;return {ticket:s.assetTicket,generations:s.normalGenerations};});
  await page.locator('#inpBump').fill('250');await page.locator('#inpBump').press('Enter');await state();
  const after=await page.evaluate(async uid=>{
    const s=frameEngine.renderer.materialState,d=frameEngine.renderer.device,b=d.createBuffer({size:s.data.size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    try{const e=d.createCommandEncoder();e.copyBufferToBuffer(s.data,0,b,0,s.data.size);d.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);const f=new Float32Array(b.getMappedRange()),index=frameMaterialState().library.findIndex(m=>m.uid===uid),at=(index+1)*28;return {sameAtlas:s.atlas===normalAtlasBefore,ticket:s.assetTicket,generations:s.normalGenerations,strength:f[at+7],normalY:f[at+24]};}finally{b.destroy();}
  },material.uid);
  check('Strength edit reuses GPU atlas and generated normals',after.sameAtlas&&after.ticket===before.ticket&&after.generations===before.generations&&after.strength===2.5&&after.normalY===1,after);
  await call('edit.history',{action:'undo'});check('Normal intensity supports Undo',(await state()).materials.find(m=>m.uid===material.uid).bump===100);await call('edit.history',{action:'redo'});
  const normal=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=4;const x=c.getContext('2d');x.fillStyle='rgb(128,230,204)';x.fillRect(0,0,4,4);return c.toDataURL().split(',')[1];});
  await call('material.texture',{material:material.uid,slot:'normal',base64:normal});await select();
  check('Explicit normal overrides generated image and retains DirectX setting',await page.locator('#btnNormalY').isEnabled()&&await page.locator('#btnNormalY').textContent()==='−Y'&&await page.evaluate(()=>![...frameEngine.renderer.materialState.layers.keys()].some(k=>k.startsWith('normal:'))));
  await call('material.texture',{material:material.uid,slot:'normal',remove:true});await select();
  check('Removing explicit normal restores OpenGL generation and intensity',await page.locator('#btnNormalY').isDisabled()&&await page.locator('#btnNormalY').textContent()==='+Y'&&(await state()).materials.find(m=>m.uid===material.uid).bump===250);
  const hash=await call('scene.export',{includeData:true});await call('scene.open',{base64:hash.base64,name:'automatic-normal.hash'});
  const loaded=(await state()).materials.find(m=>m.uid===material.uid);
  check('HASH preserves authoring and regenerates normals without adding a normal asset',loaded.bump===250&&loaded.normalY===-1&&!loaded.normalAsset&&await page.evaluate(()=>frameEngine.renderer.materialState.autoNormalIds.size===1));
  const fixture=reference.materials.at(-1),pixels=await samples(fixture.points);
  check('HASH regeneration preserves reviewed pixels',Math.max(...pixels.flatMap((p,i)=>p.map((v,c)=>Math.abs(v-fixture.normals[i][c]))))<=2);
  const glb=await call('scene.export',{format:'glb',includeData:true}),bytes=Buffer.from(glb.base64,'base64'),doc=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12))),exported=doc.materials.find(m=>m.name==='Automatic normal smoke');
  check('GLB exports generated normal texture with current strength',exported.normalTexture?.scale===2.5&&!!doc.images[doc.textures[exported.normalTexture.index].source]);
  await call('scene.create',{type:'render',params:{realtime:'off',samples:1,'resolution x':96,'resolution y':96}});const rendered=await call('render.start');
  check('Path tracer renders generated normal on the shared device',rendered.phase==='complete'&&rendered.hasImage&&rendered.sharedDevice&&!rendered.errors.length,rendered);await call('render.stop');
  const validation=await page.evaluate(async()=>({validation:(await frameEngine.renderer.device.popErrorScope())?.message??null,uncaptured:normalErrors}));
  check('No JavaScript or GPU validation errors',!errors.length&&!validation.validation&&!validation.uncaptured.length,{errors,...validation});
  const report={pass:true,checks,validation,indexSHA256:createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex')};
  await mkdir(new URL('./results/',import.meta.url),{recursive:true});await writeFile(new URL('./results/automatic-normal-browser.json',import.meta.url),JSON.stringify(report,null,2));
  console.log(`${checks.length} focused checks passed.`);
}finally{await session.close();}
