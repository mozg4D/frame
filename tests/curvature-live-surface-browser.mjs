import assert from 'node:assert/strict';
import {launch,ready} from '../tools/browser.mjs';
import {cylinder} from './curvature-prediction-fixtures.mjs';

const session=await launch({headless:process.argv.includes('--headless')});
const {page}=session,errors=[];
page.on('pageerror',e=>errors.push(e.message));
try{
 await ready(page);
 await page.evaluate(()=>{
  const device=frameEngine.renderer.device,uncaptured=[];
  device.addEventListener('uncapturederror',e=>uncaptured.push(e.error.message));
  device.pushErrorScope('validation');window.surfaceCurvatureGPU={device,uncaptured};
 });
 const call=(n,a={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[n,a]);
 const inspect=async hash=>(await call('scene.inspect')).objects.find(n=>n.hash===hash);
 const geometry=async id=>{const g=await call('diagnostics.mesh',{id,geometry:true});assert.ok(g.finite&&g.indicesValid);return [g.positionsSHA256,g.indicesSHA256];};
 const status=async(id,mode,prediction=false)=>{
  const until=Date.now()+15000;let r;
  do{
   r=await call('view.edgeAngles',{id});
   if(r.enabled&&!r.pending&&r.mode===mode&&(prediction?r.prediction:typeof r.maxDegrees==='number'))return r;
   await new Promise(resolve=>setTimeout(resolve,25));
  }while(Date.now()<until);
  throw Error('Curvature '+mode+' did not settle: '+JSON.stringify(r));
 };
 const changeMode=async(owner,mode)=>{
  await page.locator('#row-'+owner.id+' .ob-tag.curvature').click();
  const button=page.locator('#attrContent [data-field="mode"][data-value="'+mode+'"]');
  await button.click();
  assert.equal(await button.getAttribute('aria-pressed'),'true');
 };
 const pixels=async (id,points)=>{
  await call('scene.select',{ids:[]});
  const screens=await Promise.all(points.map(point=>call('view.project',{id,point}).then(r=>r.screen)));
  await call('diagnostics.frame',{frames:2});
  return (await call('diagnostics.pixels',{points:screens})).colors;
 };
 const different=(a,b)=>a.some((c,i)=>c.slice(0,3).reduce((s,x,k)=>s+Math.abs(x-b[i][k]),0)>10);
 async function openRoundTrip(id,type,expected,key){
  const saved=await call('scene.export',{includeData:true});
  await call('scene.open',{base64:saved.base64,name:'surface-curvature-roundtrip.hash'});
  const owner=await inspect(id);
  assert.equal(owner.type,type);
  assert.equal(owner.tags.find(t=>t.kind==='curvature')?.params.mode,'Surface Prediction');
  assert.deepEqual(await geometry(id),expected);
  const result=await status(id,'Surface Prediction',true);
  assert.equal(result.prediction.policy,key);
  return result;
 }
 for(const kind of ['shallow','ribbon']){
  await call('scene.new');
  const o=await call('scene.create',{type:'spline_patch',name:'Curvature '+kind});
  const cage=await page.evaluate(kind=>{
   const K=FrameSpline.K(),d=K.createSplineData({angle:kind==='ribbon'?32:10}),z=kind==='ribbon'?0:1;
   const v=[[0,0,0],[100,0,0],[0,70,0],[0,-70,z],[100,70,0],[100,-70,z]].map(p=>K.addSplineVertex(d,p));
   const add=(a,b)=>K.addSplineSegment(d,K.addSplineSequence(d),v[a],v[b]);
   const seam=add(0,1),a=[add(1,4),add(4,2),add(2,0)],b=[add(0,3),add(3,5),add(5,1)];
   if(kind==='ribbon')for(const [id,dir]of [[seam,1],[a[1],-1],[b[1],1]])Object.assign(d.segments[id],{ha:[30*dir,0,26],hb:[-30*dir,0,26],soft:true});
   return d;
  },kind);
  await call('spline.replace',{id:o.hash,data:cage});
  assert.equal((await inspect(o.hash)).evaluation?.report?.cells,2);
  await call('view.set',{index:2,single:true,mode:'object',shading:'solid',focus:o.hash});
  const before=await geometry(o.hash),probes=[[25,25,0],[55,40,0],[35,-30,0],[70,-20,0]],ordinary=await pixels(o.hash,probes);
  await call('view.edgeAngles',{id:o.hash,enabled:true});
  const report=await status(o.hash,'Angle');
  if(kind==='shallow')assert.ok(report.maxDegrees>0&&report.maxDegrees<44,JSON.stringify(report));
  const angle=await pixels(o.hash,probes);
  assert.ok(different(ordinary,angle),JSON.stringify({kind,ordinary,angle}));
  await changeMode(o,'Surface Prediction');
  const predicted=await status(o.hash,'Surface Prediction',true);
  assert.equal(predicted.prediction.policy,'analytic-seams');
  assert.equal(predicted.prediction.invalid,0);
  if(kind==='shallow')assert.ok(predicted.prediction.hard>=1,JSON.stringify(predicted));
  else assert.equal(predicted.prediction.hard,0);
  assert.equal(predicted.prediction.hard,predicted.prediction.hardPairs);
  const heat=await pixels(o.hash,probes);
  assert.ok(different(angle,heat),JSON.stringify({kind,angle,heat}));
  assert.equal((await inspect(o.hash)).type,'spline_patch');
  assert.deepEqual(await geometry(o.hash),before);
  if(kind==='shallow'){
   const flat=structuredClone(cage);for(const v of Object.values(flat.vertices))v[2]=0;
   await call('spline.replace',{id:o.hash,data:flat});
   const changed=await status(o.hash,'Surface Prediction',true);
   assert.equal(changed.prediction.hard,0,'Re-evaluated flat Spline Patch must discard old hard pairs');
   await call('edit.history',{action:'undo'});
   assert.deepEqual(await geometry(o.hash),before);
  }
  const reopened=await openRoundTrip(o.hash,'spline_patch',before,'analytic-seams');
  assert.equal(reopened.prediction.hard,predicted.prediction.hard);
 }
 await call('scene.new');
 const [vertices,indices]=cylinder(12);
 const o=await call('mesh.create',{name:'Paged Curvature',storage:'texture',vertices,indices});
 assert.equal((await inspect(o.hash)).mesh.storage,'texture');
 await call('view.set',{index:3,single:true,mode:'object',shading:'solid',focus:o.hash});
 const probes=[[0,-43,19],[0,-27,82],[0,-9,59],[0,17,32],[0,38,71]],ordinary=await pixels(o.hash,probes);
 assert.ok(ordinary.every(c=>c.some((v,i)=>i<3&&Math.abs(v-33)>4)),JSON.stringify({ordinary}));
 await call('view.edgeAngles',{id:o.hash,enabled:true});const angular=await status(o.hash,'Angle');
 assert.ok(angular.maxDegrees>80);
 const angle=await pixels(o.hash,probes);
 await changeMode(o,'Surface Prediction');
 const predicted=await status(o.hash,'Surface Prediction',true);
 assert.equal(predicted.prediction.policy,'polygon-angle');
 assert.ok(Math.abs(predicted.maxCurvature-.01)<.000003);
 const heat=await pixels(o.hash,probes);
 console.log('Paged cylinder ordinary/Angle/Prediction:',JSON.stringify({ordinary,angle,heat}));
 assert.ok(different(ordinary,angle),JSON.stringify({ordinary,angle}));
 assert.ok(different(ordinary,heat),JSON.stringify({ordinary,heat}));
 assert.ok(different(angle,heat),JSON.stringify({angle,heat}));
 await call('view.set',{shading:'solid-wire'});await call('diagnostics.frame',{frames:2});
 const gpu=await page.evaluate(async()=>{const {device,uncaptured}=surfaceCurvatureGPU;await device.queue.onSubmittedWorkDone();return {validation:(await device.popErrorScope())?.message??null,uncaptured};});
 assert.deepEqual(gpu,{validation:null,uncaptured:[]});assert.deepEqual(errors,[]);
 console.log('Curvature modes render on live native Spline Patches and a paged polygon; analytic seams survive rebuild and HASH.');
}finally{await session.close();}
