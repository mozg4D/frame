import assert from 'node:assert/strict';
import {launch,ready} from '../tools/browser.mjs';

const session=await launch({headless:process.argv.includes('--headless')});
const {page}=session,errors=[];
page.on('pageerror',e=>errors.push(e.message));
const call=(name,args={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[name,args]);
const inspect=async hash=>(await call('scene.inspect')).objects.find(o=>o.hash===hash);
const settled=async(id,mode,n,fits)=>{
 const until=performance.now()+20000;let r;
 do{
  r=await call('view.edgeAngles',{id});
  if(r.enabled&&!r.pending&&r.mode===mode&&r.readyFitCount===fits){
   assert.equal(r.occurrenceCount,n);assert.equal(r.fitCount,fits);
   assert.equal(r.fits.reduce((sum,f)=>sum+f.count,0),n);
   assert.equal(r.reason,null);return r;
  }
  await page.waitForTimeout(70);
 }while(performance.now()<until);
 assert.fail('Derived Curvature did not publish: '+JSON.stringify({id,mode,n,fits,r}));
};
const changeMode=async(hash,mode)=>{
 const o=await inspect(hash);
 await page.locator('#row-'+o.id+' .ob-tag.curvature').click();
 const button=page.locator('#attrContent [data-field="mode"][data-value="'+mode+'"]');
 await button.click();assert.equal(await button.getAttribute('aria-pressed'),'true');
 await autoDeselect();
};
function autoDeselect(){return call('scene.select',{ids:[]});}

const vertices=[0,0,0,100,0,0,0,100,0,0,0,40];
const indices=[0,2,1,0,1,3,0,3,2,1,2,3];
const tetra=[0,1,2,3].flatMap(f=>[[.4,.3,.3],[.6,.22,.18],[.22,.6,.18],[.21,.24,.55]].map(weights=>[0,1,2].map(axis=>weights.reduce((sum,w,i)=>sum+vertices[3*indices[3*f+i]+axis]*w,0))));
const copies=id=>page.evaluate(hash=>frameEngine.scene.meshes.filter(m=>m.hashId===hash&&m.replicaMatrix&&m.frameVisible).map(m=>({
 matrix:Array.from(m.frameWorld),source:m.replicaSource.hashId,materialCount:m.materialTags?.length||0,triangles:m.triangleCount
})),id);
async function pixels(id,expected){
 const occurrences=await copies(id);assert.equal(occurrences.length,expected);
 return page.evaluate(async({occurrences,tetra})=>{
  const rect=document.getElementById('frame-engine-canvas').getBoundingClientRect();
  const points=[],ranges=[];
  for(const row of occurrences){
   const m=row.matrix,offset=points.length;
   for(const p of tetra){
    const point=[0,1,2].map(k=>m[12+k]+m[k]*p[0]+m[4+k]*p[1]+m[8+k]*p[2]);
    const {screen:q}=await frameAI.call('view.project',{point});
    if(q[0]>rect.left+3&&q[0]<rect.right-3&&q[1]>rect.top+3&&q[1]<rect.bottom-3)points.push(q);
   }
   ranges.push([offset,points.length]);
  }
  if(ranges.some(([a,b])=>b-a<4))throw Error('Occurrence has no in-frame projected probes: '+JSON.stringify({ranges}));
  const {colors}=await frameAI.call('diagnostics.pixels',{points});
  return ranges.map(([a,b])=>colors.slice(a,b));
 },{occurrences,tetra});
}
const different=(a,b)=>a.length===b.length&&a.some((p,i)=>p.slice(0,3).reduce((d,v,k)=>d+Math.abs(v-b[i][k]),0)>12);
const verifyPixels=(before,after,stage)=>after.forEach((part,i)=>assert.ok(different(before[i],part),JSON.stringify({stage,i,before:before[i],after:part})));
async function focus(ids){
 await call('scene.select',{ids});
 await call('view.set',{index:0,single:true,mode:'object',shading:'solid',focusSelection:true});
 await await autoDeselect();
}
async function sourceWithMaterial(){
 const o=await call('mesh.create',{name:'Canonical painted tetrahedron',vertices,indices});
 const mat=await call('material.create',{name:'Red translucent',params:{h:0,s:100,l:52,opac:45}});
 await call('material.assign',{id:o.hash,material:mat.uid});
 return o;
}

try{
 await ready(page);
 await page.evaluate(()=>{
  const device=frameEngine.renderer.device,uncaptured=[];
  device.addEventListener('uncapturederror',e=>uncaptured.push(e.error.message));
  device.pushErrorScope('validation');window.derivedCurvatureGPU={device,uncaptured};
 });
 await call('scene.new');
 const source=await sourceWithMaterial();
 const owner=await call('scene.create',{type:'cloner',name:'Three ordinary native copies',inputs:[source.hash],
  params:{type:'matrix','count x':3,'count y':1,'count z':1,'spacing x':260,'uniform scale':false,seed:7}});
 const sibling=await call('scene.create',{type:'instance',name:'Untagged sibling',params:{object:source.hash}});
 await call('transform.apply',{ids:[sibling.hash],position:[0,210,0]});
 await focus([owner.hash,sibling.hash]);
 assert.ok((await copies(owner.hash)).every(c=>c.materialCount>0&&c.triangles===4));
 const before=await pixels(owner.hash,3),siblingBefore=await pixels(sibling.hash,1);
 await call('view.edgeAngles',{id:owner.hash,enabled:true});
 const equal=await settled(owner.hash,'Angle',3,1);assert.equal(equal.fits[0].source,source.hash);
 verifyPixels(before,await pixels(owner.hash,3),'Cloner Angle on all translated copies');
 assert.deepEqual(await pixels(sibling.hash,1),siblingBefore,'Untagged sibling is visually unaffected');
 assert.equal((await call('view.edgeAngles',{id:source.hash})).enabled,false);
 assert.equal((await call('view.edgeAngles',{id:sibling.hash})).enabled,false);

 await call('scene.update',{id:owner.hash,params:{'random scale x':80,'random scale y':45}});
 const differentAngles=await settled(owner.hash,'Angle',3,3);
 assert.ok(new Set(differentAngles.fits.map(f=>f.maxDegrees.toPrecision(5))).size>1,JSON.stringify(differentAngles));
 await changeMode(owner.hash,'Surface Prediction');await await autoDeselect();
 const predicted=await settled(owner.hash,'Surface Prediction',3,3);
 assert.equal(predicted.prediction.policy,'polygon-angle');
 assert.ok(predicted.fits.every(f=>f.prediction?.policy==='polygon-angle'));
 const active=await pixels(owner.hash,3);
 await call('view.edgeAngles',{id:owner.hash,enabled:false});
 const material=await pixels(owner.hash,3);
 verifyPixels(material,active,'Cloner Prediction overrides materials on all copies');
 assert.deepEqual(await pixels(sibling.hash,1),siblingBefore,'Sibling material does not switch with the owner');

 await call('scene.new');
 const other=await sourceWithMaterial();
 await call('transform.apply',{ids:[other.hash],position:[200,0,0]});
 const mirror=await call('scene.create',{type:'symmetry',name:'Real mirrored native copies',inputs:[other.hash],params:{X:true,Y:false,Z:false,'Morph symmetry':false}});
 await focus([mirror.hash]);
 const reflected=await copies(mirror.hash);
 assert.equal(reflected.length,2);assert.ok(reflected[0].matrix[0]*reflected[1].matrix[0]<0);
 const ordinary=await pixels(mirror.hash,2);
 await call('view.edgeAngles',{id:mirror.hash,enabled:true});
 await settled(mirror.hash,'Angle',2,1);
 verifyPixels(ordinary,await pixels(mirror.hash,2),'Symmetry Angle actual both sides');
 await changeMode(mirror.hash,'Surface Prediction');await await autoDeselect();
 assert.equal((await settled(mirror.hash,'Surface Prediction',2,1)).prediction.policy,'polygon-angle');
 verifyPixels(ordinary,await pixels(mirror.hash,2),'Symmetry Prediction actual both sides');
 const saved=await call('scene.export',{includeData:true});
 await call('scene.open',{base64:saved.base64,name:'curvature-ordinary-groups.hash'});
 assert.equal((await inspect(mirror.hash)).type,'symmetry');
 await settled(mirror.hash,'Surface Prediction',2,1);
 assert.equal((await call('view.edgeAngles',{id:other.hash})).enabled,false);
 const gpu=await page.evaluate(async()=>{
  const {device,uncaptured}=derivedCurvatureGPU;
  await device.queue.onSubmittedWorkDone();
  return {validation:(await device.popErrorScope())?.message??null,uncaptured};
 });
 assert.deepEqual(gpu,{validation:null,uncaptured:[]});assert.deepEqual(errors,[]);
 console.log('Native Cloner and Symmetry own real Curvature pixels, share only equal physical fits, preserve material on siblings and survive HASH.');
}finally{await session.close();}
