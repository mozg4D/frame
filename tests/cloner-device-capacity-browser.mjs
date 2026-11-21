import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {launch,ready} from '../tools/browser.mjs';
const session=await launch({headless:true}),{page}=session;
const call=(name,args={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[name,args]);
const capture=()=>page.evaluate(async()=>{
 const r=frameEngine.renderer,d=r.device,w=r.width,h=r.height,stride=Math.ceil(w*4/256)*256,b=d.createBuffer({size:stride*h,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
 try{const e=d.createCommandEncoder();e.copyTextureToBuffer({texture:r.cachedColor},{buffer:b,bytesPerRow:stride},[w,h]);d.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b.getMappedRange()))).join(',');
 }finally{if(b.mapState==='mapped')b.unmap();b.destroy();}
});
try{
 const source=await readFile(new URL('../index.html',import.meta.url),'utf8'),anchor='    function orderedReplicaFrameBytes(instances,limits){';
 assert.equal(source.split(anchor).length,2);
 await page.route('**/index.html',r=>r.fulfill({contentType:'text/html',body:source.replace(anchor,anchor+'if(globalThis.qaLimits)limits=globalThis.qaLimits;')}));
 await page.goto(session.url+'/index.html');await ready(page);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.evaluate(()=>{const d=frameEngine.renderer.device;window.qaCapacityGPU={d,errors:[]};d.pushErrorScope('validation');d.addEventListener('uncapturederror',e=>qaCapacityGPU.errors.push(e.error.message));});
 await call('scene.new');
 const sourceMesh=await call('mesh.create',{name:'Capacity source',vertices:[-3,-3,0,3,-3,0,0,3,0,-2,-2,2],indices:[0,2,1,0,1,3,1,2,3,2,0,3]});
 const owner=await call('scene.create',{type:'cloner',name:'Capacity owner',inputs:[sourceMesh.hash],params:{type:'matrix','count x':20,'count y':20,'count z':1,'spacing x':8,'spacing y':8}});
 await call('view.set',{index:2,single:true,shading:'solid',mode:'object',focus:owner.hash});await call('scene.select',{ids:[]});
 await call('diagnostics.frame',{frames:3});
 for(const key of ['maxBufferSize','maxStorageBufferBindingSize']){
   const stable=await capture();
   const old=await page.evaluate(()=>{const r=frameEngine.renderer;window.qaPriorFrames=r.orderedReplicas.buffer;return {bytes:r.orderedReplicas.buffer.size,instances:r.orderedReplicas.instances};});
   assert.deepEqual(old,{bytes:51200,instances:400});
   await page.evaluate(key=>{window.qaLimits={maxBufferSize:1e8,maxStorageBufferBindingSize:1e8,[key]:51200};},key);
   await call('scene.update',{id:owner.hash,params:{'count x':21}});
   const notice=page.locator('.frame-view-notice:visible').filter({hasText:'GPU replica frames'});
   await page.waitForFunction(()=>document.getElementById('frame-engine-canvas').dataset.replicaDrawError,undefined,{timeout:5000});
   assert.equal(await notice.isVisible(),false,'Capacity refusal must not show a viewport banner');
   assert.match(await page.locator('#frame-engine-canvas').getAttribute('data-replica-draw-error'),/53,760 bytes.*51,200 bytes/);
   assert.equal(await capture(),stable,key+' must retain previous complete frame');
   const guard=await page.evaluate(()=>{const r=frameEngine.renderer;return {same:r.orderedReplicas.buffer===qaPriorFrames,frames:r.orderedReplicas.instances,origins:frameEngine.scene.meshes.filter(m=>m.replicaMatrix&&m.objectFrame).length};});
   assert.deepEqual(guard,{same:true,frames:400,origins:1},'No fallback creates per-occurrence bindings or swaps the ordered table');
   const box=await page.locator('#frame-engine-canvas').boundingBox(),point={x:box.x+box.width*.53,y:box.y+box.height*.53};
   await assert.rejects(call('selection.pick',point),/viewport retains its previous frame/);
   assert.deepEqual(await call('view.pick',point),{point:null});
   assert.equal((await call('diagnostics.replicas',{id:owner.hash,limit:0})).count,420,'Current authoring can retain attempted placements when only the renderer rejects');
   await call('scene.update',{id:owner.hash,params:{'count x':20}});
   await page.waitForFunction(()=>!document.getElementById('frame-engine-canvas').dataset.replicaDrawError,undefined,{timeout:5000});
   const row=page.locator('#row-'+owner.id);
   await row.locator('.ob-name').click();await page.locator('#tabAttributes').click();
   const input=page.locator('#attrContent input[data-field="count x"]');
   await input.fill('21');await input.press('Enter');
   assert.equal(await input.inputValue(),'20','Known device failure leaves the last authored value intact');
   const after=await call('diagnostics.replicas',{id:owner.hash,limit:0});
   assert.equal(after.count,400);assert.equal(await notice.isVisible(),false);
   assert.equal(await page.locator('#dialog').isVisible(),false);
   await page.evaluate(()=>{delete window.qaLimits;});
   await call('scene.select',{ids:[]});
   await call('diagnostics.frame',{frames:2});
   console.log(key+' silently retains the last cached image/buffer; diagnostic bytes remain and Attributes rejects without creating rows.');
 }
 const errorsGPU=await page.evaluate(async()=>({scope:(await qaCapacityGPU.d.popErrorScope())?.message??null,errors:qaCapacityGPU.errors}));
 assert.deepEqual(errorsGPU,{scope:null,errors:[]});assert.deepEqual(errors,[]);
}finally{await session.close();}
