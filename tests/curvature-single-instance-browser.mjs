import assert from 'node:assert/strict';
import {launch,ready} from '../tools/browser.mjs';

const session=await launch({headless:process.argv.includes('--headless')});
const {page}=session,pageErrors=[];
page.on('pageerror',e=>pageErrors.push(e.message));
const call=(name,args={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[name,args]);
const inspect=async hash=>(await call('scene.inspect')).objects.find(o=>o.hash===hash);
const status=async(id,mode)=>{
 const deadline=performance.now()+15000;let r;
 do{
  r=await call('view.edgeAngles',{id});
  if(r.enabled&&!r.pending&&r.mode===mode&&(mode==='Angle'?Number.isFinite(r.maxDegrees):r.prediction))return r;
  await page.waitForTimeout(70);
 }while(performance.now()<deadline);
 assert.fail('Native Instance Curvature did not publish: '+JSON.stringify({id,mode,r}));
};
const getOccurrence=async id=>page.evaluate(hash=>{
 const copies=frameEngine.scene.meshes.filter(m=>m.hashId===hash&&m.replicaMatrix);
 return copies.map(m=>({matrix:Array.from(m.frameWorld),source:m.replicaSource.hashId,triangles:m.triangleCount,paged:!!m.paged}));
},id);

try{
 await ready(page);
 await page.evaluate(()=>{
  const device=frameEngine.renderer.device;
  const uncaptured=[];
  device.addEventListener('uncapturederror',e=>uncaptured.push(e.error.message));
  device.pushErrorScope('validation');window.instanceCurvatureGPU={device,uncaptured};
 });
 await call('scene.new');
 const vertices=[0,0,0,100,0,0,0,100,0,0,0,40];
 const indices=[0,2,1,0,1,3,0,3,2,1,2,3];
 const source=await call('mesh.create',{name:'Editable source',vertices,indices});
 const copy=await call('scene.create',{type:'instance',name:'Native Instance',params:{object:source.hash}});
 const tetra=[0,1,2,3].flatMap(f=>[[.4,.3,.3],[.6,.22,.18],[.22,.6,.18],[.21,.24,.55]].map(weights=>[0,1,2].map(axis=>weights.reduce((sum,w,i)=>sum+vertices[3*indices[3*f+i]+axis]*w,0))));
 const pixels=async()=>{
  const [occurrence]=await getOccurrence(copy.hash);assert.equal(occurrence.source,source.hash);assert.equal(occurrence.triangles,4);
  const m=occurrence.matrix;
  const points=await Promise.all(tetra.map(p=>call('view.project',{point:[0,1,2].map(k=>m[12+k]+m[k]*p[0]+m[4+k]*p[1]+m[8+k]*p[2])}).then(r=>r.screen)));
  return (await call('diagnostics.pixels',{points})).colors;
 };
 const differs=(a,b)=>a.some((p,i)=>p.slice(0,3).reduce((d,v,k)=>d+Math.abs(v-b[i][k]),0)>10);
 await call('scene.update',{id:source.hash,visible:false});
 await call('view.set',{index:0,single:true,shading:'solid',mode:'object',focus:copy.hash});
 await call('scene.select',{ids:[]});
 const ordinary=await pixels();
 await call('view.edgeAngles',{id:copy.hash,enabled:true});
 const angle=await status(copy.hash,'Angle'),degreePixels=await pixels();
 assert.ok(differs(ordinary,degreePixels),JSON.stringify({ordinary,degreePixels}));
 assert.equal((await call('view.edgeAngles',{id:source.hash})).enabled,false,'The source must stay untagged');

 const row=page.locator('#row-'+copy.id+' .ob-tag.curvature');
 await row.click();
 await page.locator('#attrContent [data-field="mode"][data-value="Surface Prediction"]').click();
 assert.equal((await status(copy.hash,'Surface Prediction')).prediction.policy,'polygon-angle');
 await call('scene.select',{ids:[]});
 const fitPixels=await pixels();
 assert.ok(differs(ordinary,fitPixels),JSON.stringify({ordinary,fitPixels}));
 const result=await inspect(copy.hash);assert.equal(result.type,'instance');
 assert.equal(result.tags.find(t=>t.kind==='curvature')?.params.mode,'Surface Prediction');
 const saved=await call('scene.export',{includeData:true});
 await call('scene.open',{base64:saved.base64,name:'curvature-single-instance.hash'});
 const restored=await inspect(copy.hash);
 assert.equal(restored.type,'instance');assert.equal((await status(copy.hash,'Surface Prediction')).prediction.policy,'polygon-angle');
 console.log('HASH restored Instance row '+copy.id+' -> '+restored.id+'.');
 assert.equal((await call('view.edgeAngles',{id:source.hash})).enabled,false);

 await page.locator('#row-'+restored.id+' .ob-tag.curvature').click();
 await page.locator('#attrContent [data-field="mode"][data-value="Angle"]').click();
 const before=(await status(copy.hash,'Angle')).maxDegrees;
 assert.ok(Math.abs(before-angle.maxDegrees)<1e-4);
 await call('transform.apply',{ids:[copy.hash],coordinates:'object',size:[100,100,100]});
 const after=(await status(copy.hash,'Angle')).maxDegrees;
 assert.ok(Math.abs(after-before)>1e-2,JSON.stringify({before,after}));
 await call('edit.history',{action:'undo'});
 assert.ok(Math.abs((await status(copy.hash,'Angle')).maxDegrees-before)<1e-4,'Undo restores the occurrence metric');
 const errors=await page.evaluate(async()=>{
  const {device,uncaptured}=instanceCurvatureGPU;
  await device.queue.onSubmittedWorkDone();
  return {validation:(await device.popErrorScope())?.message??null,uncaptured};
 });
 assert.deepEqual(errors,{validation:null,uncaptured:[]});
 assert.deepEqual(pageErrors,[]);
 console.log(JSON.stringify({pass:true,ordinary,degreePixels,fitPixels,angleBefore:before,angleAfter:after,validation:errors}));
}finally{await session.close();}
