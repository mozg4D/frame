import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {launch,ready} from '../tools/browser.mjs';

const source=await readFile(new URL('../index.html',import.meta.url),'utf8');
const plants=new Function(source.slice(source.indexOf('const FramePlants='),source.indexOf('const definitions = {'))+'return FramePlants;')();
const classify=new Function(source.slice(source.indexOf('function polygonCreaseData('),source.indexOf('function prepareBooleanRender('))+'return polygonCreaseData;')();
function geometry(type,overrides={}){
  const p=plants.settings({...plants.fields,...plants.presets[type],type,...overrides});
  const raw=plants.makePlant(p),wood=raw.ranges[0].count,verts=raw.vertices;
  assert.ok(verts.every(Number.isFinite)&&raw.uv.every(Number.isFinite));
  assert.equal(raw.uv.length,raw.indices.length*2);
  const y=verts.filter((_,i)=>i%3===1);
  assert.ok(Math.abs(Math.min(...y))<0.0001&&Math.abs(Math.max(...y)-p.height*10*p.growth)<0.02);
  const stemIndices=raw.indices.subarray(0,wood*3),stemVerts=wood?Math.max(...stemIndices)+1:0;
  if(wood){
    const smooth=classify(verts.subarray(0,stemVerts*3),stemIndices,Math.cos(44*Math.PI/180));
    if(!Object.keys(overrides).length)assert.equal(smooth.positions.length,stemVerts*3,'Default presets have smooth woody sleeves');
    const edgeCount=new Map();
    for(let i=0;i<stemIndices.length;i+=3)for(let k=0;k<3;k++){
      const a=stemIndices[i+k],b=stemIndices[i+(k+1)%3],key=Math.min(a,b)+':'+Math.max(a,b);
      edgeCount.set(key,(edgeCount.get(key)||0)+1);
    }
    const grounded=[...edgeCount].filter(([key,count])=>count===1&&key.split(':').every(id=>verts[id*3+1]===0));
    assert.ok(grounded.length>=6*p.trunks,'Each trunk starts with an open planar ring at zero');
  }
  let upward=0,bent=0,total=0;
  for(let i=wood*3;i<raw.indices.length;i+=3){
    const [a,b,c]=raw.indices.subarray(i,i+3).map(v=>v*3);
    const x=verts[b]-verts[a],y=verts[b+1]-verts[a+1],z=verts[b+2]-verts[a+2];
    const u=verts[c]-verts[a],v=verts[c+1]-verts[a+1],w=verts[c+2]-verts[a+2];
    const ny=z*u-x*w,mag=Math.hypot(y*w-z*v,ny,x*v-y*u);
    assert.ok(mag>0);if(ny/mag>Math.cos(Math.PI/4))upward++;total++;
  }
  for(let i=stemVerts;i<verts.length/3;i+=6){
    const distance=(a,b)=>Math.hypot(...[0,1,2].map(k=>verts[(i+a)*3+k]-verts[(i+b)*3+k]));
    if(distance(0,1)+distance(1,2)+distance(2,3)>1.002*distance(0,3))bent++;
    const face=wood*3+(i-stemVerts)*3;
    assert.deepEqual(Array.from(raw.indices.subarray(face,face+18),id=>id-i),[0,4,1,1,4,2,2,4,3,0,1,5,1,2,5,2,3,5]);
  }
  if(wood&&type!=='palm'&&p.habit===0&&total){
    assert.ok(upward/total>0.65,'Most deciduous card triangles must face the sky');
    assert.ok(bent>total/6*0.80,'Most deciduous cards must have a curved diagonal');
  }
  if(Object.keys(plants.presets).indexOf(type)>=8)assert.equal(wood,0);
  return {triangles:raw.triangleCount,upward:total?Math.round(100*upward/total):0};
}
for(const type of Object.keys(plants.presets)){
  console.log(type,geometry(type));
  for(const options of [{seed:0,trunks:8,crookedness:100},{seed:99999,growth:1},{spread:0,'conifer shape':51},{spread:100,height:100}])geometry(type,options);
}

const session=await launch({headless:true}),page=session.page,errors=[];
const call=(name,args={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[name,args]);
const inspect=()=>call('scene.inspect');
const object=async id=>(await inspect()).objects.find(n=>n.hash===id);
const digest=id=>call('diagnostics.mesh',{id,geometry:true});
const appearance=id=>call('diagnostics.appearance',{id,corners:[0,1,2],faces:[0]});
const saved=()=>call('scene.export',{includeData:true});
async function mergePart(name,data){
  const route='**/'+name;
  await page.route(route,r=>r.fulfill({body:Buffer.from(data.base64,'base64'),contentType:'application/octet-stream'}));
  try{return await call('scene.merge',{url:name});}finally{await page.unroute(route);}
}
const leaf=n=>n.tags.find(t=>t.kind==='material'&&t.libraryIndex===1);
function assertMaps(a,n){
  const m=a.materials.find(m=>m.uid===leaf(n).materialUID);
  assert.ok(m.colorAsset&&m.normalAsset&&m.normalAsset!==m.colorAsset);
  assert.equal(m.opacityAsset,m.colorAsset);assert.equal(m.alphaMode,2);
  assert.equal(m.translucency,50);
  return m;
}
try{
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
  await ready(page);
  await page.evaluate(()=>{frameEngine.renderer.device.addEventListener('uncapturederror',e=>console.error(e.error.message));});
  const stockRequests=[];page.on('request',r=>{if(r.url().includes('/models/'))stockRequests.push(r.url());});
  await page.getByRole('button',{name:'Add Tree',exact:true}).click();
  let state=await inspect(),tree=state.objects.find(n=>n.type==='tree'),id=tree.hash;
  assert.equal(tree.params.detail,'procedural');assert.equal(tree.name,'Oak');
  const original=assertMaps(state,tree),sun=await appearance(id),summerMesh=await digest(id);
  assert.equal(sun.uv.corners,tree.mesh.triangles*3);assert.equal(tree.tags.filter(t=>t.kind==='uv').length,1);
  assert.ok(sun.materials[1].triangles>0&&sun.materials[1].triangles%6===0);
  const presets=await page.locator('#attrContent .plant-presets').evaluateAll(rows=>rows.map(row=>[...row.children].map(button=>[button.offsetWidth,button.offsetHeight])));
  assert.deepEqual(presets,Array.from({length:2},()=>Array.from({length:8},()=>[32,32])));
  assert.deepEqual(await page.locator('#attrContent .plant-presets').evaluateAll(rows=>rows.map(row=>new Set([...row.children].map(button=>button.offsetTop)).size)),[1,1]);
  const fields=await page.locator('#attrContent input[data-field]').evaluateAll(inputs=>inputs.map(input=>input.dataset.field));
  assert.deepEqual(fields,['seed','day of year','growth','leaf density']);
  await page.locator('#attrContent [data-field="type"][data-value="bush"]').click();
  tree=await object(id);assert.equal(tree.name,'Large Bush');assert.equal(tree.params.trunks,plants.presets.bush.trunks);assert.equal(tree.params.height,plants.presets.bush.height);
  await call('edit.history',{action:'undo'});tree=await object(id);assert.equal(tree.params.type,'oak');
  assert.equal((await digest(id)).positionsSHA256,summerMesh.positionsSHA256);
  const copy=(await call('scene.duplicate',{ids:[id]})).objects[0];
  assert.equal(copy.tags.filter(t=>t.kind==='uv').length,1);assert.notEqual(copy.tags.find(t=>t.kind==='uv').uid,tree.tags.find(t=>t.kind==='uv').uid);
  assert.equal(assertMaps(await inspect(),copy).uid,original.uid);
  const twin=await call('scene.update',{id:copy.hash,params:{seed:812,branching:88,crookedness:69,height:6300}});
  assert.equal(leaf(twin).materialUID,original.uid);assert.notEqual((await digest(twin.hash)).positionsSHA256,summerMesh.positionsSHA256);
  await page.evaluate(id=>{const mesh=frameEngine.scene.meshes.find(m=>m.hashId===id);window.treePositions=mesh.positions;window.treeVersion=mesh.version;},id);
  tree=await call('scene.update',{id,params:{'day of year':16}});state=await inspect();
  const winter=assertMaps(state,tree);assert.notEqual(winter.colorAsset,original.colorAsset);
  assert.equal(leaf(await object(twin.hash)).materialUID,original.uid);
  assert.equal((await digest(id)).positionsSHA256,summerMesh.positionsSHA256);assert.equal((await appearance(id)).uv.sha256,sun.uv.sha256);
  assert.ok(await page.evaluate(id=>{const m=frameEngine.scene.meshes.find(m=>m.hashId===id);return m.positions===window.treePositions&&m.version===window.treeVersion;},id));
  const coverage=await page.evaluate(async ids=>Promise.all(ids.map(async uid=>{
    const a=window.frameMaterialState().assets.find(a=>a.uid===uid);
    const img=await createImageBitmap(new Blob([a.bytes])),canvas=new OffscreenCanvas(img.width,img.height),ctx=canvas.getContext('2d');
    ctx.drawImage(img,0,0);img.close();const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    let pixels=0;for(let i=3;i<rgba.length;i+=4)if(rgba[i]>96)pixels++;return pixels;
  })),[original.colorAsset,winter.colorAsset]);
  assert.ok(coverage[1]<0.45*coverage[0],JSON.stringify(coverage));
  await assert.rejects(call('scene.update',{id,params:{trunks:9}}));assert.equal((await object(id)).params.trunks,1);
  const compact=await saved(),stored=await page.evaluate(async({id,data})=>{
    const file=new Blob([Uint8Array.from(atob(data),v=>v.charCodeAt(0))]),records=await FrameHash.index(file);
    const get=async field=>{const row=records.get(FrameHash.address(id,field));return row?FrameHash.read(file,row):null;};
    return {geometry:!!records.get(FrameHash.address(id,'positions')),tags:await get('tags'),library:(await get('parameters')).library};
  },{id,data:compact.base64});
  assert.equal(stored.geometry,false);assert.equal(stored.tags?.length||0,0);assert.equal(stored.library.slots.length,2);
  await call('scene.open',{name:'trees.hash',base64:compact.base64});tree=await object(id);
  assert.equal(tree.params['day of year'],16);assert.equal(assertMaps(await inspect(),tree).uid,winter.uid);assert.equal((await appearance(id)).uv.sha256,sun.uv.sha256);
  const partial=await call('scene.export',{ids:[id],includeData:true});
  const merged=await mergePart('tree-part.hash',partial);
  const mergedTree=(await inspect()).objects.find(n=>n.hash!==id&&n.hash!==twin.hash&&n.type==='tree');
  assert.ok(merged&&mergedTree);assert.equal(leaf(mergedTree).materialUID,winter.uid);
  assert.equal((await appearance(mergedTree.hash)).uv.sha256,sun.uv.sha256);
  await call('scene.update',{id,params:{growth:0}});assert.equal((await object(id)).mesh,null);
  const dormant=await call('scene.export',{ids:[id],includeData:true});
  await mergePart('dormant.hash',dormant);
  tree=await call('scene.update',{id,params:{type:'spruce',height:8300,growth:100}});assert.equal(tree.params.height,8300);
  assert.equal(tree.params['conifer shape'],100);assert.equal(tree.params['day of year'],16);
  const built=await digest(id),mapped=await appearance(id);
  assert.equal(stockRequests.length,0,'Procedural geometry and textures are local');
  const editable=await call('scene.convert',{id});assert.equal(editable.type,'mesh');assert.ok(editable.tags.every(t=>!t.librarySlot));
  const baked=await saved();await call('scene.open',{name:'editable-tree.hash',base64:baked.base64});
  assert.equal((await digest(id)).positionsSHA256,built.positionsSHA256);assert.equal((await appearance(id)).uv.sha256,mapped.uv.sha256);
  const glb=Buffer.from((await call('scene.export',{format:'glb',includeData:true})).base64,'base64');
  const document=JSON.parse(glb.toString('utf8',20,20+glb.readUInt32LE(12)));
  assert.ok(document.materials.some(m=>m.alphaMode==='MASK'&&m.doubleSided&&m.normalTexture&&m.pbrMetallicRoughness.baseColorTexture));
  assert.ok(document.meshes.some(m=>m.primitives.some(p=>p.attributes.TEXCOORD_0!==undefined)));
  const animated=twin.hash;
  for(const [frame,value] of [[0,1],[10,4]])await call('animation.key',{id:animated,path:'param:trunks',frame,value});
  await call('animation.seek',{frame:5});const mid=await object(animated);assert.ok(Number.isInteger(mid.params.trunks)&&mid.params.trunks>1&&mid.params.trunks<4);
  await call('animation.seek',{frame:10});assert.equal((await object(animated)).params.trunks,4);
  for(const [frame,value] of [[0,2],[10,1]])await call('animation.key',{id:animated,path:'param:type',frame,value});
  await call('animation.seek',{frame:0});await call('animation.seek',{frame:10});let keyed=await object(animated);
  assert.equal(keyed.params.type,'spruce');assert.equal(keyed.params.height,plants.presets.spruce.height);assert.equal(keyed.params.trunks,4);
  const custom=leaf(keyed).materialUID;
  await call('material.texture',{material:custom,slot:'normal',remove:true});
  keyed=await call('scene.update',{id:animated,params:{'day of year':136}});
  assert.equal(leaf(keyed).materialUID,custom);assert.ok(!(await inspect()).materials.find(m=>m.uid===custom).normalAsset);
  const still=await call('scene.create',{type:'tree',params:{growth:0}});
  assert.equal((await call('scene.convert',{id:still.hash})).type,'mesh');
  const fern=await call('scene.create',{type:'tree',params:{type:'fern'}});
  assert.equal(fern.mesh.triangles,60);
  assert.deepEqual(fern.tags.filter(t=>t.kind==='material').map(t=>t.libraryIndex),[1]);
  assertMaps(await inspect(),fern);
  assert.deepEqual(errors,[]);
  console.log('Native Tree toolbar, presets, undo, shared atlases, seasons, compact HASH and editable geometry passed.');
}finally{await session.close();}
