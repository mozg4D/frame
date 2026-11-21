import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../tools/browser.mjs';
import {cylinder,icosphere} from './curvature-prediction-fixtures.mjs';

export async function curvaturePredictionChecks(page){
 const errors=[],checks=[];
 page.on('pageerror',e=>errors.push(e.message));
 await ready(page);
 await page.evaluate(()=>{
  const d=frameEngine.renderer.device;window.__curvatureErrors=[];
  d.addEventListener('uncapturederror',e=>window.__curvatureErrors.push(e.error.message));
  d.pushErrorScope('validation');
 });
 const call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]);
 const checkpoint=(name,detail)=>checks.push({name,detail});
 async function status(owner,mode,field,predicate){
  let value;const until=performance.now()+20000;
  do{
   value=await call('view.edgeAngles',{id:owner.hash});
   if(value.enabled&&!value.pending&&value.mode===mode&&typeof value[field]==='number'&&predicate(value[field]))return value;
   await page.waitForTimeout(70);
  }while(performance.now()<until);
  throw Error('Curvature did not publish '+JSON.stringify({name:owner.name,mode,field,actual:value}));
 }
 const field=(mode)=>page.locator('#attrContent [data-field="mode"][data-value="'+mode+'"]');
 async function changeMode(owner,mode){
  await page.locator('#row-'+owner.id+' .ob-tag.curvature').click();
  await field(mode).click();
  await field(mode).waitFor({state:'visible'});
  assert.equal(await field(mode).getAttribute('aria-pressed'),'true');
 }
 async function build(name,[vertices,indices]){
  await call('scene.new');
  const object=await call('mesh.create',{name,vertices,indices});
  await call('view.set',{index:0,single:true,mode:'object',shading:'solid',focus:object.hash});
  await call('view.edgeAngles',{id:object.hash,enabled:true});
  return object;
 }
 async function colorsInView(index,object,points){
  await call('scene.select',{ids:[]});
  await call('view.set',{index,single:true,mode:'object',shading:'solid',focus:object.hash});
  const viewport=await page.locator('#frame-engine-canvas').boundingBox();
  const coords=await Promise.all(points.map(async point=>(await call('view.project',{point,id:object.hash})).screen));
  assert.ok(coords.every(p=>p[0]>viewport.x+3&&p[0]<viewport.x+viewport.width-3&&p[1]>viewport.y+3&&p[1]<viewport.y+viewport.height-3));
  return (await call('diagnostics.pixels',{points:coords})).colors;
 }
 const diameterTolerance=.000003;
 for(const [sides,flip,uneven] of [[12,false,false],[24,true,false],[24,false,true]]){
  const o=await build('Cylinder '+sides+(uneven?' irregular':''),cylinder(sides,100,true,flip,undefined,uneven,false));
  await status(o,'Angle','maxDegrees',x=>x>80);
  await changeMode(o,'Surface Prediction');
  const v=await status(o,'Surface Prediction','maxCurvature',x=>Math.abs(x-.01)<diameterTolerance);
  assert.ok(v.minCurvature<diameterTolerance,'Flat cap is separate from curved side: '+JSON.stringify(v));
  checkpoint(o.name+' unnormalized radius and flat cap',v);
  // The orthographic +X view sees the side; -Z sees the cap. Project inside
  // the silhouette and read actual shader output, not computed test labels.
  const side=await colorsInView(3,o,[[0,-43,19],[0,-27,82],[0,-9,59],[0,17,32],[0,38,71]]);
  const cap=await colorsInView(2,o,[[-47,2,100],[13,-31,100],[29,28,100]]);
  const colorDistance=(a,b)=>Math.max(...a.slice(0,3).map((v,i)=>Math.abs(v-b[i])));
  assert.ok(side.every(c=>c[0]>1.6*c[1]&&c[1]>c[2]+12&&colorDistance(c,side[0])<=3),'Uniform rendered cylinder side: '+JSON.stringify(side));
  assert.ok(cap.every(c=>c[2]>c[0]+20&&c[2]>c[1]+10&&colorDistance(c,cap[0])<=3),'Uncolored flat cap: '+JSON.stringify(cap));
  checkpoint(o.name+' hardware colors: uniform side, separate flat cap',{side,cap});
  if(sides===12){
   await call('scene.update',{id:o.hash,params:{'crease angle':29}});
   const cut=await status(o,'Surface Prediction','maxCurvature',x=>x<diameterTolerance);
   checkpoint('Lower owner crease threshold stops cross-facet fitting',cut);
   await call('edit.history',{action:'undo'});
   await status(o,'Surface Prediction','maxCurvature',x=>Math.abs(x-.01)<diameterTolerance);
   const restored=await call('scene.export',{includeData:true,name:'curvature-mode.hash'});
   await call('scene.open',{base64:restored.base64,name:'curvature-mode.hash'});
   await status(o,'Surface Prediction','maxCurvature',x=>Math.abs(x-.01)<diameterTolerance);
   const obj=(await call('scene.inspect')).objects.find(n=>n.hash===o.hash);
   assert.equal(obj?.tags.find(t=>t.kind==='curvature')?.params.mode,'Surface Prediction');
   await changeMode(obj,'Angle');
   await status(obj,'Angle','maxDegrees',x=>x>80);
   checkpoint('Mode survives HASH and Angle remains available');
  }
 }
 for(const level of [0,1,2,3]){
  const data=icosphere(level,100),name='Sphere '+data[1].length/3;
  const o=await build(name,data);
  await changeMode(o,'Surface Prediction');
  const v=await status(o,'Surface Prediction','maxCurvature',x=>Math.abs(x-.01)<.00023);
  assert.ok(v.minCurvature>.00965,'Uniform lower curvature bound: '+JSON.stringify(v));
  checkpoint(name+' unnormalized curvature range',v);
 }
 {
  const stations=[0,50,100,126,152,178,204,230,256,282,308,334],n=stations.length,p=[],f=[];
  for(const z of [0,30,60,90])for(const a of stations)p.push(100*Math.cos(a*Math.PI/180),100*Math.sin(a*Math.PI/180),z);
  for(let row=0;row<3;row++)for(let i=0;i<n;i++){const a=row*n+i,b=row*n+(i+1)%n,c=b+n,d=a+n;f.push(a,b,c,a,c,d);}
  const o=await build('Cylinder with one 50° seam',[p,f]);
  await changeMode(o,'Surface Prediction');
  const cut=await status(o,'Surface Prediction','minCurvature',x=>x>.0037&&x<.004);
  assert.ok(cut.maxCurvature>.011&&cut.maxCurvature<.0116);
  await call('scene.update',{id:o.hash,params:{'crease angle':55}});
  const uncut=await status(o,'Surface Prediction','maxCurvature',x=>Math.abs(x-.01)<diameterTolerance);
  assert.ok(Math.abs(uncut.minCurvature-.01)<diameterTolerance);
  checkpoint('An isolated 50° seam blocks the shared fit at 44° but smooths at 55°',{cut,uncut});
 }
 // Native threshold fixture: a regular open grid with exactly 150,001
 // triangles, just beyond the overlay's per-mesh admission limit.
 await call('scene.new');
 const vertices=[],indices=[],nx=275,ny=273;
 for(let y=0;y<=ny;y++)for(let x=0;x<=nx;x++)vertices.push(x,y,0);
 for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){const a=y*(nx+1)+x;indices.push(a,a+1,a+nx+1,a+1,a+nx+2,a+nx+1);}
 indices.length=150001*3;
 const dense=await call('mesh.create',{name:'Curvature admission limit',vertices,indices});
 const limited=()=>call('view.edgeAngles',{id:dense.hash});
 const pre=await limited();
 assert.equal(pre.enabled,false);assert.equal(pre.pending,false);assert.equal(pre.reason,'triangle-limit');assert.equal(pre.triangleCount,150001);
 await assert.rejects(call('view.edgeAngles',{id:dense.hash,enabled:true}),/150,000 triangles/);
 // Real Object Browser drop, testing the previously silent pointer route.
 await page.locator('#tabShaders').click();
 const center=async locator=>{await locator.scrollIntoViewIfNeeded();const b=await locator.boundingBox();assert.ok(b);return [b.x+b.width/2,b.y+b.height/2];};
 const from=await center(page.locator('#shaderCurvature')),to=await center(page.locator('#row-'+dense.id+' .ob-name'));
 await page.mouse.move(...from);await page.mouse.down();
 try{await page.mouse.move(...to,{steps:12});}finally{await page.mouse.up();}
 const toast=page.locator('.frame-view-notice').filter({hasText:'Limit: 150,000 triangles'});
 await toast.waitFor({state:'visible',timeout:3000});
 assert.equal((await limited()).enabled,false);
 // Seed an authored tag as a fixture (normal admission intentionally rejects
 // a fresh one), then exercise actual HASH serialization and restoration.
 await page.evaluate(hash=>commit(()=>frameNodeByHash(hash).tags.push({kind:'curvature',uid:FrameHash.newId(),params:{mode:'Surface Prediction'}})),dense.hash);
 const saved=await call('scene.export',{includeData:true,name:'curvature-limit.hash'});
 await call('scene.open',{base64:saved.base64,name:'curvature-limit.hash'});
 const restored=(await call('scene.inspect')).objects.find(n=>n.hash===dense.hash);
 const over=await limited();
 assert.equal(over.enabled,true);assert.equal(over.pending,false);assert.equal(over.mode,'Surface Prediction');assert.equal(over.reason,'triangle-limit');assert.equal(over.maxCurvature,null);
 await page.locator('#row-'+restored.id+' .ob-tag.curvature').click();
 const notice=page.locator('#attrContent [data-curvature-limit]');
 await notice.waitFor({state:'visible'});
 assert.equal(await notice.textContent(),'Limit: 150,000 triangles');
 assert.equal(await page.locator('#attrContent [data-field="mode"]').count(),2);
 checkpoint('150,001-triangle limit is explicit on direct drop and restored tag',{pre,over});
 await call('diagnostics.frame',{frames:2});
 const gpu=await page.evaluate(async()=>({validation:(await frameEngine.renderer.device.popErrorScope())?.message||null,uncaptured:__curvatureErrors}));
 assert.deepEqual(gpu,{validation:null,uncaptured:[]});assert.deepEqual(errors,[]);
 return {pass:true,checks,gpu};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const session=await launch({headless:process.argv.includes('--headless')});
 try{console.log(JSON.stringify(await curvaturePredictionChecks(session.page)));}
 finally{await session.close();}
}
