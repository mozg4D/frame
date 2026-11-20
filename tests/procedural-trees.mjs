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
  const grid=['grass','tall-grass','daisy','poppy','lavender','iris'].includes(type);
  let upward=0,sideways=0,sky=0,bent=0,total=0;
  for(let i=wood*3;i<raw.indices.length;i+=3){
    const [a,b,c]=raw.indices.subarray(i,i+3).map(v=>v*3);
    const x=verts[b]-verts[a],y=verts[b+1]-verts[a+1],z=verts[b+2]-verts[a+2];
    const u=verts[c]-verts[a],v=verts[c+1]-verts[a+1],w=verts[c+2]-verts[a+2];
    const ny=z*u-x*w,mag=Math.hypot(y*w-z*v,ny,x*v-y*u);
    assert.ok(mag>0);
    if(ny/mag>Math.cos(Math.PI/4))upward++;
    if(ny/mag>=0&&ny/mag<.45)sideways++;
    if(ny>0)sky++;
    total++;
  }
  let cards=0;
  for(let start=wood*3;!grid&&start<raw.indices.length;){
    const root=raw.indices[start];let last=root,end=start;
    do{last=Math.max(last,...raw.indices.subarray(end,end+3));end+=3;}
    while(end<raw.indices.length&&raw.indices[end]<=last);
    const spans=(last-root+1)/2;
    assert.ok([2,4,6].includes(spans));
    assert.equal((end-start)/3,2*spans-2);
    if(type==='fern')assert.equal(spans,6,'Five interior bends run across each fern frond');
    const point=id=>Array.from(verts.subarray(3*id,3*id+3)),centers=[point(root)];
    for(let j=root+1;j<last;j+=2)centers.push(point(j).map((x,k)=>(x+verts[(j+1)*3+k])/2));
    centers.push(point(last));
    const distance=(a,b)=>Math.hypot(...a.map((x,k)=>x-b[k]));
    const arc=centers.slice(1).reduce((s,p,i)=>s+distance(p,centers[i]),0);
    if(arc>1.002*distance(centers[0],centers.at(-1)))bent++;
    cards++;start=end;
  }
  if(wood&&type!=='palm'&&p.habit===0&&total){
    assert.ok(sky/total>.8&&upward/total>.20&&sideways/total>.07,'Deciduous sprays cover elevated and oblique views');
    assert.ok(bent>cards*.67,'Most deciduous cards have a curved spine');
  }
  if(type==='pine'&&!Object.keys(overrides).length){
    const diameter=2*Math.hypot(verts[0],verts[2]);
    assert.ok(Math.abs(diameter-600)<25,'Mature basal diameter in mm: '+diameter);
  }
  if(grid){
    assert.equal(raw.triangleCount,4*Math.ceil((type==='grass'?16:9)*p.density/100),'Density sets the crossed clump count');
    const ground=new Set();
    for(let i=0;i<verts.length;i+=12)ground.add(verts.slice(i,i+6).join(','));
    assert.equal(ground.size,raw.triangleCount/2);
  }
  if(plants.isGround(type))assert.equal(wood,0);
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
  assert.ok(m.colorAsset&&!m.normalAsset,'Foliage uses one linked color and coverage image');
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
  assert.equal(sun.materials[1].triangles,plants.makePlant(plants.settings(tree.params)).ranges[1].count);
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
  assert.ok(await page.evaluate(uid=>frameEngine.renderer.materialState.layers.has(uid),winter.colorAsset),'Seasonal binding is published with its GPU layer ready');
  assert.equal(leaf(await object(twin.hash)).materialUID,original.uid);
  assert.equal((await digest(id)).positionsSHA256,summerMesh.positionsSHA256);assert.equal((await appearance(id)).uv.sha256,sun.uv.sha256);
  assert.ok(await page.evaluate(id=>{const m=frameEngine.scene.meshes.find(m=>m.hashId===id);return m.positions===window.treePositions&&m.version===window.treeVersion;},id));
  const coverage=await page.evaluate(async ids=>Promise.all(ids.map(async uid=>{
    const a=window.frameMaterialState().assets.find(a=>a.uid===uid);
    const img=await createImageBitmap(new Blob([a.bytes])),canvas=new OffscreenCanvas(img.width,img.height),ctx=canvas.getContext('2d');
    if(img.width!==384||img.height!==384)throw Error('Expected a single foliage image');
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
  assert.ok(document.materials.some(m=>m.alphaMode==='MASK'&&m.doubleSided&&m.pbrMetallicRoughness.baseColorTexture));
  assert.ok(document.materials.some(m=>m.name==='Bark'&&m.normalTexture));
  assert.ok(document.meshes.some(m=>m.primitives.some(p=>p.attributes.TEXCOORD_0!==undefined)));
  const animated=twin.hash;
  for(const [frame,value] of [[0,1],[10,4]])await call('animation.key',{id:animated,path:'param:trunks',frame,value});
  await call('animation.seek',{frame:5});const mid=await object(animated);assert.ok(Number.isInteger(mid.params.trunks)&&mid.params.trunks>1&&mid.params.trunks<4);
  await call('animation.seek',{frame:10});assert.equal((await object(animated)).params.trunks,4);
  for(const [frame,value] of [[0,2],[10,1]])await call('animation.key',{id:animated,path:'param:type',frame,value});
  await call('animation.seek',{frame:0});await call('animation.seek',{frame:10});let keyed=await object(animated);
  assert.equal(keyed.params.type,'spruce');assert.equal(keyed.params.height,plants.presets.spruce.height);assert.equal(keyed.params.trunks,4);
  const custom=leaf(keyed).materialUID;
  const normalImage=await page.evaluate(()=>textureFiles.find(name=>!name.includes('/')));
  await call('material.texture',{material:custom,slot:'normal',url:'textures/'+normalImage});
  keyed=await call('scene.update',{id:animated,params:{'day of year':136}});
  assert.equal(leaf(keyed).materialUID,custom);assert.ok((await inspect()).materials.find(m=>m.uid===custom).normalAsset);
  const still=await call('scene.create',{type:'tree',params:{growth:0}});
  assert.equal((await call('scene.convert',{id:still.hash})).type,'mesh');
  const fern=await call('scene.create',{type:'tree',params:{type:'fern'}});
  assert.equal(fern.mesh.triangles,10*Math.ceil(14*fern.params['leaf density']/100));
  assert.deepEqual(fern.tags.filter(t=>t.kind==='material').map(t=>t.libraryIndex),[1]);
  assertMaps(await inspect(),fern);
  for(const type of ['shrub','fern','grass','tall-grass','daisy','poppy','lavender','iris']){
    let p=plants.settings({...plants.fields,...plants.presets[type],type}),sparse=plants.makePlant({...p,density:20}),dense=plants.makePlant(p);
    assert.equal(dense.ranges[0].count,0);
    assert.ok(dense.triangleCount>sparse.triangleCount);
    assert.equal(plants.makePlant({...p,density:0}).triangleCount,0);
  }
  const shrub=await call('scene.update',{id:fern.hash,params:{type:'shrub'}});
  assert.deepEqual(shrub.tags.filter(t=>t.kind==='material').map(t=>t.libraryIndex),[1]);
  const flower=await call('scene.update',{id:fern.hash,params:{type:'poppy',growth:18}});
  const young=await appearance(flower.hash),flowerAsset=assertMaps(await inspect(),flower).colorAsset;
  const start=performance.now();
  const grown=await call('scene.update',{id:flower.hash,params:{growth:100}});
  assert.ok(performance.now()-start<500,'Completed flower Growth update under 500 ms');
  assert.equal(assertMaps(await inspect(),grown).colorAsset,flowerAsset);
  assert.notEqual((await appearance(grown.hash)).uv.sha256,young.uv.sha256,'Rosettes and open flowers select different atlas regions');
  assert.equal((await call('scene.update',{id:grown.hash,params:{'leaf density':0}})).mesh,null);
  await call('edit.history',{action:'undo'});
  assert.equal((await object(grown.hash)).mesh.triangles,grown.mesh.triangles);
  assert.deepEqual(errors,[]);
  console.log('Native Tree toolbar, presets, undo, shared foliage images, seasons, compact HASH and editable geometry passed.');
}finally{await session.close();}
