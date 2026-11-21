import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {launch,ready} from '../tools/browser.mjs';

const session=await launch({headless:true}),page=session.page,errors=[],checks=[],started=performance.now();let completed=false;
page.on('pageerror',e=>errors.push(e.message));
const call=(name,args={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[name,args]);
const state=()=>call('scene.inspect'),get=async hash=>(await state()).objects.find(o=>o.hash===hash);
const near=(a,b)=>a.length===b.length&&a.every((v,k)=>Math.abs(v-b[k])<1e-4);
function check(name,pass,detail){assert.ok(pass,name+': '+JSON.stringify(detail));checks.push(name);console.log('PASS',name);}
async function transferFile(result,keep=true){const chunks=[],digest=createHash('sha256');let offset=0;do{const chunk=await call('scene.export.read',{id:result.transfer.id,offset}),bytes=Buffer.from(chunk.base64,'base64');assert.equal(chunk.offset,offset);assert.equal(chunk.nextOffset,offset+bytes.length);digest.update(bytes);if(keep)chunks.push(bytes);offset=chunk.nextOffset;if(chunk.eof)break;}while(true);check('Transferred file matches byte length and SHA-256',offset===result.bytes&&digest.digest('hex')===result.sha256);await call('scene.export.release',{id:result.transfer.id});await assert.rejects(call('scene.export.read',{id:result.transfer.id}),/not found/);return keep?Buffer.concat(chunks,offset):null;}
try{
 await ready(page);await call('scene.new');await call('view.set',{index:2,single:true,pivot:false});
 const adapter=await page.evaluate(()=>{const a=frameEngine.renderer.device.adapterInfo;return {description:a.description,isFallbackAdapter:a.isFallbackAdapter};});check('Tests use a hardware GPU',adapter.isFallbackAdapter===false&&!/swiftshader|llvmpipe|software/i.test(adapter.description),adapter);
 const batch=await call('api.batch',{commands:[{name:'scene.create',args:{type:'group',name:'Parent'},as:'parent'},{name:'scene.create',args:{type:'cube',name:'Child',parent:{$ref:'parent.hash'}},as:'child'},{name:'transform.apply',args:{position:[200,30,40],rotation:[0,0,0],size:[80,60,40],coordinates:'object'}}]});
 check('Batch resolves created parents and runs the combined transform',batch.ok&&batch.completed===3,batch);
 const parent=batch.results[0].result.hash,child=batch.results[1].result.hash,pivot=(await get(parent)).pivot;
 await call('scene.update',{id:child,params:{'size x':200}});check('Child parameter resize preserves group pivot',near((await get(parent)).pivot,pivot));
 const before=(await get(child)).matrix;await call('scene.select',{ids:[child]});const transformed=await call('transform.apply',{position:[120,70,50],rotation:[15,25,35],size:[120,50,30],coordinates:'object'});
 check('Combined transform sets all vectors',near(transformed.position,[120,70,50])&&near(transformed.rotation,[15,25,35])&&near(transformed.size,[120,50,30]),transformed);
 check('Child affine resize preserves parent pivot',near((await get(parent)).pivot,pivot));await call('edit.history',{action:'undo'});check('One Undo restores the entire transform',near((await get(child)).matrix,before));await call('edit.history',{action:'redo'});check('One Redo restores the entire transform',near((await call('transform.apply',{coordinates:'object',position:[120,70,50]})).position,[120,70,50]));
 const unchanged=(await get(child)).matrix;await assert.rejects(call('transform.apply',{size:[-1,2,3]}),/Invalid size/);check('Invalid combined transform leaves geometry unchanged',near((await get(child)).matrix,unchanged));
 const saved=await call('scene.export',{includeData:true});await call('scene.open',{name:'pivots.hash',base64:saved.base64});check('Parent pivot survives HASH',near((await get(parent)).pivot,pivot));
 const profile=await call('scene.create',{type:'square'}),extrude=await call('scene.create',{type:'extrude',inputs:[profile.hash]});await call('scene.select',{ids:[profile.hash]});await call('transform.apply',{position:[40,30,0],coordinates:'world'});check('Transforming a generator child preserves its parent pivot',near((await get(extrude.hash)).pivot,extrude.pivot));
 const mesh=await call('mesh.create',{vertices:[0,0,0,10,0,0,0,10,0],indices:[0,1,2],storage:'texture'}),meshChild=await call('scene.create',{type:'cube',parent:mesh.hash}),meshPivot=(await get(mesh.hash)).pivot;await call('scene.update',{id:meshChild.hash,params:{'size x':300}});check('Resizing a child preserves a polygon parent pivot',near((await get(mesh.hash)).pivot,meshPivot));
 const count=(await state()).objects.length;await assert.rejects(call('api.batch',{commands:[{name:'scene.create',args:{type:'group'}},{name:'transform.set',args:{channel:'size',axis:5,value:20}}]}),/out of range/);check('Batch schema preflight rejects before the first mutation',(await state()).objects.length===count);
 const stopped=await call('api.batch',{commands:[{name:'scene.update',args:{id:child,name:'Completed'}},{name:'scene.update',args:{id:'missing',name:'Fail'}},{name:'scene.update',args:{id:child,name:'Skipped'}}]});check('Batch returns completed receipts and stops on runtime failure',!stopped.ok&&stopped.completed===1&&stopped.results.length===2&&(await get(child)).name==='Completed',stopped);
 const concurrent=await page.evaluate(async hash=>{const batch=frameAI.batch([{name:'scene.update',args:{id:hash,name:'FIFO one'}},{name:'scene.update',args:{id:hash,name:'FIFO two'}}]);const inspection=frameAI.call('scene.inspect');return {batch:await batch,state:await inspection};},child);check('Other FIFO calls cannot interleave batch commands',concurrent.batch.ok&&concurrent.state.objects.find(o=>o.hash===child).name==='FIFO two');
 await call('scene.new');const a=await call('scene.create',{type:'cube',params:{'size x':100,'size y':100,'size z':100}}),b=await call('scene.create',{type:'cube'});await call('transform.apply',{position:[125,0,0],coordinates:'world'});const selection=(await state()).selection.objects;
 const gap=await call('measure.gap',{from:a.hash,to:b.hash,direction:[5,0,0]});check('Directional GPU gap measures exact part projections',Math.abs(gap.gap-25)<1e-4&&!gap.from.conservative&&!gap.to.conservative,gap);check('Gap inspection preserves selection',JSON.stringify((await state()).selection.objects)===JSON.stringify(selection));
 const reverse=await call('measure.gap',{from:b.hash,to:a.hash,direction:[-1,0,0]});check('Reversing direction and owners preserves gap',Math.abs(reverse.gap-25)<1e-4);await assert.rejects(call('measure.gap',{from:a.hash,to:b.hash,direction:[0,0,0]}),/nonzero/);
 const texture=await call('mesh.create',{vertices:[200,0,0,210,0,0,200,10,0],indices:[0,1,2],storage:'texture'}),textureGap=await call('measure.gap',{from:a.hash,to:texture.hash,direction:[1,1,0]});check('Directional measurement supports texture-backed triangles',Math.abs(textureGap.to.max-210/Math.sqrt(2))<1e-4&&!textureGap.to.conservative,textureGap);
 await call('scene.select',{ids:[b.hash]});
 await call('transform.apply',{position:[80,0,0],coordinates:'world'});const overlap=await call('measure.gap',{from:a.hash,to:b.hash,direction:[1,0,0]});check('Projection overlap returns a signed negative gap',Math.abs(overlap.gap+20)<1e-4,overlap);
 const group=await call('scene.group',{ids:[a.hash]});await call('scene.select',{ids:[group.hash]});await call('transform.apply',{position:[300,20,10],rotation:[0,20,0],coordinates:'world'});const original=await get(a.hash),outside=await get(b.hash);
 const part=await call('scene.saveAs',{ids:[a.hash],name:'single-part.hash'}),partBytes=await transferFile(part);await call('scene.open',{name:part.name,base64:partBytes.toString('base64')});const opened=await state();check('Part HASH excludes its parent and unrelated geometry',opened.objects.length===1&&opened.objects[0].hash===a.hash&&!opened.objects.some(o=>o.hash===outside.hash));check('Part HASH preserves world placement',near(opened.objects[0].worldMatrix,original.worldMatrix));
 await call('scene.new');const source=await call('scene.create',{type:'cube'}),instance=await call('scene.create',{type:'instance',params:{object:source.hash}});const instanceFile=await call('scene.export',{ids:[instance.hash],includeData:true});await call('scene.open',{name:'instance.hash',base64:instanceFile.base64});check('Part HASH includes a native Instance source dependency',(await state()).objects.length===2&&(await get(instance.hash)).params.object===source.hash);
 for(const format of ['hash','stl','ply','vtk','3mf','glb']){
  const artifact=await call('scene.export',{format,name:'format-probe.'+format,transfer:true});
  check('Export receipt only for '+format,artifact.format===format&&artifact.bytes>0&&artifact.transfer.chunkBytes===1024*1024&&!Object.hasOwn(artifact,'base64'));
  await transferFile(artifact,false);
 }
 // A tiny PNG with incompressible ancillary bytes exercises real large-file codec/transport without a large mesh.
 const material=await call('material.create',{name:'Large file fixture'}),asset=await page.evaluate(async()=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const png=new Uint8Array(await (await new Promise(r=>canvas.toBlob(r,'image/png'))).arrayBuffer()),bytes=new Uint8Array(17*1024*1024+png.length);bytes.set(png);for(let i=png.length;i<bytes.length;i+=65536)crypto.getRandomValues(bytes.subarray(i,Math.min(i+65536,bytes.length)));return frameMaterialAsset(URL.createObjectURL(new Blob([bytes],{type:'image/png'})),bytes);});
 await call('material.texture',{material:material.uid,slot:'baseColor',asset});await call('material.assign',{id:source.hash,material:material.uid});
 const observed=await page.evaluate(async()=>{
  const nativeRead=Blob.prototype.arrayBuffer,nativeSlice=Blob.prototype.slice,MiB=1024*1024,largeHash=b=>b.type==='application/x-frame-hash'&&b.size>16*MiB;
  let slices=0,largest=0,denied=0;
  Blob.prototype.arrayBuffer=function(){
   if(largeHash(this)){denied++;throw Error('Whole HASH Blob read prohibited by test');}
   return nativeRead.call(this);
  };
  Blob.prototype.slice=function(start,end,type){
   if(largeHash(this)){slices++;largest=Math.max(largest,end-start);if(end-start>MiB)throw Error('Oversized HASH slice');}
   return nativeSlice.call(this,start,end,type);
  };
  try{return {result:await frameAI.call('scene.export',{transfer:true,name:'large.hash'}),slices,largest,denied};}
  finally{Blob.prototype.arrayBuffer=nativeRead;Blob.prototype.slice=nativeSlice;}
 });
 const large=observed.result;
 check('HASH export exceeds the former 16 MiB cap',large.bytes>16*1024*1024,large.bytes);
 check('Large export digests bounded slices without a whole Blob read',observed.denied===0&&observed.slices===Math.ceil(large.bytes/(1024*1024))&&observed.largest===1024*1024,{slices:observed.slices,largest:observed.largest});
 const bytes=await transferFile(large);await call('scene.open',{name:'large.hash',base64:bytes.toString('base64')});check('Inline HASH import accepts a file above 16 MiB',(await state()).objects.length===2);
 const inline=await page.evaluate(async()=>{const r=await frameAI.call('scene.export',{includeData:true});return {bytes:r.bytes,decodedBytes:atob(r.base64).length};});check('Inline export accepts a file above 16 MiB',inline.bytes>16*1024*1024&&inline.decodedBytes===inline.bytes,inline);
 check('No browser runtime errors',errors.length===0,errors);check('Focused completed workflows stay under 90 seconds',performance.now()-started<90000,performance.now()-started);
 completed=true;
}finally{
 const dir=new URL('./results/',import.meta.url);await mkdir(dir,{recursive:true});await writeFile(new URL('ai-workflows-acceptance.json',dir),JSON.stringify({pass:completed&&errors.length===0,checks,errors,elapsedMs:performance.now()-started,sourceSHA256:createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex')},null,2));await session.close();
}
