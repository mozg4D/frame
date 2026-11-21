import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../tools/browser.mjs';

export async function curvatureLibraryAnglesChecks(page){
 const errors=[],checks=[],onError=e=>errors.push(e.message);
 page.on('pageerror',onError);
 await ready(page);
 await page.evaluate(()=>{
  const d=frameEngine.renderer.device,errors=[],handler=e=>errors.push(e.error.message);
  window.__libraryCurvature={d,errors,handler};
  d.addEventListener('uncapturederror',handler);d.pushErrorScope('validation');
 });
 const call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]);
 const row=o=>page.locator('#row-'+o.id);
 const angle=page.locator('#attrContent input[data-field="crease angle"]');
 const modeButton=mode=>page.locator('#attrContent [data-field="mode"][data-value="'+mode+'"]');
 async function selectObject(o){await row(o).locator('.ob-name').click();await page.locator('#tabAttributes').click();}
 async function assumeAngle(value){await angle.waitFor({state:'visible'});assert.equal(Number(await angle.inputValue()),value);}
 async function commitAngle(value){await angle.fill(String(value));await angle.press('Enter');await assumeAngle(value);}
 async function nativeWait(o,value,{newAliases=false,newGeometry=false}={}){
  await page.waitForFunction(({hash,value,newAliases,newGeometry})=>{
   const m=frameEngine.scene.meshes.find(m=>m.hashId===hash&&!m.replicaMatrix);
   const remembered=window.__libraryCurvature.before, aliases=m?.parts?.[0]?.renderIndices??m?.renderIndices;
   return m?.creasePolicy===1&&m.creaseAngle===value&&
    (!newAliases||remembered.aliases!==aliases)&&(!newGeometry||remembered.positions!==m.positions);
  },{hash:o.hash,value,newAliases,newGeometry},{timeout:20000});
 }
 async function remember(o){
  return page.evaluate(hash=>{
   const m=frameEngine.scene.meshes.find(m=>m.hashId===hash&&!m.replicaMatrix);
   window.__libraryCurvature.before={positions:m.positions,indices:m.indices,aliases:m.parts?.[0]?.renderIndices??m.renderIndices,count:m.normalCount};
   return {normalCount:m.normalCount,triangles:m.triangleCount};
  },o.hash);
 }
 async function retained(o){
  return page.evaluate(hash=>{
   const m=frameEngine.scene.meshes.find(m=>m.hashId===hash&&!m.replicaMatrix), prior=window.__libraryCurvature.before;
   return {positions:m.positions===prior.positions,indices:m.indices===prior.indices,normalCount:m.normalCount};
  },o.hash);
 }
 async function status(o,name,metric){
  const until=performance.now()+30000;let r;
  do{r=await call('view.edgeAngles',{id:o.hash});
   if(r.enabled&&!r.pending&&r.mode===name&&Number.isFinite(r[metric]))return r;
   await page.waitForTimeout(70);
  }while(performance.now()<until);
  throw Error('Library Curvature '+name+' did not publish: '+JSON.stringify({type:o.type,status:r}));
 }
 async function probes(o){
  // Screen projection of points strictly inside the logical faces; a sample
  // may be occluded by another face, which is still a sound visible pixel.
  const raw=await call('mesh.inspect',{id:o.hash}),max=Math.min(55,raw.faces.length),list=[];
  for(let i=0;i<max;i++){
   const f=raw.faces[Math.floor((i+.5)*raw.faces.length/max)];
   list.push([0,1,2].map(axis=>f.vertices.reduce((sum,id)=>sum+raw.vertices[id].position[axis],0)/3));
  }
  const samples=await page.evaluate(async({id,list})=>Promise.all(list.map(async point=>(await frameAI.call('view.project',{id,point})).screen)),{id:o.hash,list});
  const b=await page.locator('#frame-engine-canvas').boundingBox();assert.ok(b);
  const visible=samples.filter(([x,y])=>x>b.x+3&&y>b.y+3&&x<b.x+b.width-3&&y<b.y+b.height-3);
  assert.ok(visible.length>=8,'Stock surface must be visible for the pixel check');
  return visible;
 }
 async function colors(points){
  await call('scene.select',{ids:[]});await call('diagnostics.frame',{frames:2});
  return (await call('diagnostics.pixels',{points})).colors;
 }
 const pxDiff=(a,b)=>a.reduce((n,c,i)=>n+(Math.max(...c.slice(0,3).map((x,k)=>Math.abs(x-b[i][k])))>=8?1:0),0);
 let gpu;
 try{
  await call('scene.new');
  const spline=await call('scene.create',{type:'spline_patch',name:'Analytic Spline Patch'});
  await selectObject(spline);assert.equal(await angle.count(),0);
  const plain=await call('scene.create',{type:'sphere',name:'Non-library generated sphere'});
  await selectObject(plain);assert.equal(await angle.count(),0);
  for(const [type,params,assetEdit] of [
   ['car',{},null],['human',{type:'man',pose:'stand'},{pose:'sit'}],
   ['tree',{type:'bush'},{height:2500}]
  ]){
   await call('scene.new');
   const o=await call('scene.create',{type,name:'Library '+type,params});
   assert.equal(o.type,type);
   await call('view.set',{index:0,single:true,mode:'object',shading:'solid',focus:o.hash});
   // Confirm overlays on all three still-parameterized stock objects.
   const p=await probes(o),base=await colors(p);
   if(type==='car'){
    await page.locator('#tabShaders').click();
    async function center(target){await target.scrollIntoViewIfNeeded();const b=await target.boundingBox();assert.ok(b);return [b.x+b.width/2,b.y+b.height/2];}
    const from=await center(page.locator('#shaderCurvature')),to=await center(row(o).locator('.ob-name'));
    await page.mouse.move(...from);await page.mouse.down();
    try{await page.mouse.move(...to,{steps:12});}finally{await page.mouse.up();}
   }else await call('view.edgeAngles',{id:o.hash,enabled:true});
   await status(o,'Angle','maxDegrees');const angular=await colors(p);
   await row(o).locator('.ob-tag.curvature').click();
   await modeButton('Surface Prediction').click();
   await status(o,'Surface Prediction','maxCurvature');const prediction=await colors(p);
   assert.ok(pxDiff(base,angular)>0&&pxDiff(base,prediction)>0,
    'Both shader modes color the native '+type+' before conversion');
   await selectObject(o);await assumeAngle(44);await nativeWait(o,44);
   const initial=await remember(o);
   if(type==='car')assert.equal(initial.triangles,1744);
   await commitAngle(0);await nativeWait(o,0,{newAliases:true});
   const faceted=await retained(o);assert.ok(faceted.positions&&faceted.indices,'Crease Angle must not reload '+type);
   await remember(o);await commitAngle(180);await nativeWait(o,180,{newAliases:true});
   const smooth=await retained(o);assert.ok(smooth.positions&&smooth.indices,'Crease Angle must not reload '+type);
   assert.ok(smooth.normalCount<faceted.normalCount,'Native shading must smooth at least one '+type+' fold');
   await call('edit.history',{action:'undo'});await expectAngle(o,0,nativeWait,selectObject,assumeAngle);
   await call('edit.history',{action:'redo'});await expectAngle(o,180,nativeWait,selectObject,assumeAngle);
   if(assetEdit){
    const replacement=type==='tree'&&o.params.height===assetEdit.height?{height:2600}:assetEdit;
    await remember(o);await call('scene.update',{id:o.hash,params:replacement});
    await nativeWait(o,180,{newGeometry:true});
    await selectObject(o);await assumeAngle(180);
   }
   const saved=await call('scene.export',{includeData:true,name:type+'-crease-roundtrip.hash'});
   await call('scene.open',{base64:saved.base64,name:type+'-crease-roundtrip.hash'});
   const restored=(await call('scene.inspect')).objects.find(item=>item.hash===o.hash);
   assert.equal(restored.type,type);
   assert.equal(restored.tags.find(t=>t.kind==='curvature')?.params.mode,'Surface Prediction');
   await expectAngle(restored,180,nativeWait,selectObject,assumeAngle);
   const baked=await call('scene.convert',{id:o.hash});
   assert.equal(baked.type,'mesh');assert.equal(baked.hash,o.hash);
   await expectAngle(baked,180,nativeWait,selectObject,assumeAngle);
   await remember(baked);await commitAngle(30);await nativeWait(baked,30,{newAliases:true});
   await call('edit.history',{action:'undo'});await expectAngle(baked,180,nativeWait,selectObject,assumeAngle);
   checks.push({type,initial,faceted:faceted.normalCount,smooth:smooth.normalCount,
    anglePixels:pxDiff(base,angular),predictionPixels:pxDiff(base,prediction)});
  }
 }finally{
  gpu=await page.evaluate(async()=>{
   const s=window.__libraryCurvature;delete window.__libraryCurvature;
   await s.d.queue.onSubmittedWorkDone();s.d.removeEventListener('uncapturederror',s.handler);
   return {validation:(await s.d.popErrorScope())?.message||null,uncaptured:s.errors};
  });
  page.off('pageerror',onError);
 }
 assert.deepEqual(gpu,{validation:null,uncaptured:[]});assert.deepEqual(errors,[]);
 return {pass:true,checks,gpu};
}
async function expectAngle(o,value,nativeWait,selectObject,assumeAngle){
 await selectObject(o);await assumeAngle(value);await nativeWait(o,value);
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const session=await launch({headless:process.argv.includes('--headless')});
 try{console.log(JSON.stringify(await curvatureLibraryAnglesChecks(session.page)));}
 finally{await session.close();}
}
