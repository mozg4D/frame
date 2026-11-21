import assert from 'node:assert/strict';
import {launch,ready} from '../tools/browser.mjs';

const field='crease angle', angles=[43,44,45], rad=a=>a*Math.PI/180;
const vertices=[],indices=[],cornerIds=[];
for(const [i,angle] of angles.entries()){
  const x=i*4,v=vertices.length/3,c=indices.length;
  // Equal-area faces sharing logical vertices v and v+1, with opposing winding
  // along the common edge. Their oriented normals differ by exactly angle.
  vertices.push(x,0,0,x+1,0,0,x,1,0,x,-Math.cos(rad(angle)),Math.sin(rad(angle)));
  indices.push(v,v+1,v+2,v+1,v,v+3);
  cornerIds.push(c,c+1,c+3,c+4);
}
const normal=a=>[0,Math.sin(rad(a)),Math.cos(rad(a))];
const near=(actual,expected,label)=>{
  assert.equal(actual?.length,3,label);
  assert.ok(Math.hypot(...actual.map((x,i)=>x-expected[i]))<.001,
    label+': '+JSON.stringify({actual,expected}));
};
const keyOf=g=>[g.positionsSHA256,g.indicesSHA256];
const session=await launch({headless:process.argv.includes('--headless')});
const {page}=session;
const pageErrors=[];
try{
  page.on('pageerror',error=>pageErrors.push(error.message));
  await ready(page);
  await page.evaluate(()=>{
    const device=frameEngine.renderer.device, errors=[];
    device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
    device.pushErrorScope('validation');
    window.polygonCreaseTestGPU={device,errors};
  });
  const call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]);
  const schema=async id=>(await call('fields.list',{owner:id})).fields.find(f=>f.field==='param:'+field);
  const get=async id=>(await call('fields.read',{owner:id,field:'param:'+field})).value;
  const inspect=id=>call('diagnostics.mesh',{id,geometry:true});
  async function checkNormals(id,threshold,label){
    const d=await call('diagnostics.normals',{id,corners:cornerIds});
    assert.equal(d.corners,indices.length,label);
    assert.equal(d.invalidAliases,0,label);
    assert.equal(d.logicalVertexMismatches,0,label);
    const got=new Map(d.samples.map(s=>[s.corner,s.normal]));
    assert.equal(got.size,cornerIds.length,label);
    for(const [i,angle]of angles.entries()){
      const c=i*6,smooth=angle<=threshold;
      for(const k of [c,c+1])near(got.get(k),normal(smooth?angle/2:0),label+' first face '+angle);
      for(const k of [c+3,c+4])near(got.get(k),normal(smooth?angle/2:angle),label+' second face '+angle);
    }
  }
  for(const storage of ['auto','texture']){
    await call('scene.new');
    // Creation without an override exercises the 44-degree default.
    const mesh=await call('mesh.create',{name:'Crease source',vertices,indices,storage});
    const id=mesh.hash,declared=await schema(id);
    assert.equal(declared?.access,'read-write','Crease Angle is missing from fields.list for '+storage);
    assert.equal(await get(id),44);
    const geometry=await inspect(id),canonical=keyOf(geometry);
    assert.equal(geometry.storage,storage==='auto'?'buffer':'texture');
    assert.equal(geometry.finite,true);
    assert.equal(geometry.indicesValid,true);
    assert.ok(canonical.every(h=>typeof h==='string'&&/^[a-f0-9]{64}$/.test(h)));
    const instances=[];
    for(let i=0;i<2;i++){
      const instance=await call('scene.create',{type:'instance',name:'Crease occurrence '+i,params:{object:id}});
      instances.push(instance.hash);
    }
    const checkAll=async(threshold,label)=>{
      assert.equal(await get(id),threshold,label);
      await checkNormals(id,threshold,label+' source');
      assert.deepEqual(keyOf(await inspect(id)),canonical,label+' canonical positions and indices');
      for(const occurrence of instances){
        const replicas=await call('diagnostics.replicas',{id:occurrence});
        assert.equal(replicas.count,1,label+' occurrence count');
        assert.equal(replicas.copies[0]?.source,id,label+' occurrence source');
        await checkNormals(occurrence,threshold,label+' occurrence');
      }
    };
    await checkAll(44,storage+' default 44');
    const update=(hash,value)=>call('scene.update',{id:hash,params:{[field]:value}});
    await update(id,40);
    await checkAll(40,storage+' edited 40');
    await call('scene.select',{ids:[id]});
    await page.locator('#tabAttributes').click();
    const input=page.locator('#attrContent input[data-field="crease angle"]');
    assert.equal(Number(await input.inputValue()),40);
    await input.fill('50');await input.press('Enter');
    await checkAll(50,storage+' Attributes 50');
    await call('edit.history',{action:'undo'});
    await checkAll(40,storage+' undo');
    await call('edit.history',{action:'redo'});
    await checkAll(50,storage+' redo');
    // Both explicit creation and the default path must shade correctly.
    const explicit=await call('mesh.create',{name:'Crease explicit',vertices,indices,storage,creaseAngle:40});
    assert.equal(await get(explicit.hash),40);
    await checkNormals(explicit.hash,40,storage+' explicit create angle');
    const copy=(await call('scene.duplicate',{ids:[id]})).objects[0];
    assert.notEqual(copy?.hash,id);
    assert.equal(await get(copy.hash),50);
    await checkNormals(copy.hash,50,storage+' duplicate inherited angle');
    assert.deepEqual(keyOf(await inspect(copy.hash)),canonical);
    await update(copy.hash,40);
    await checkNormals(copy.hash,40,storage+' duplicate independent angle');
    await checkAll(50,storage+' source independent of duplicate');
    const saved=await call('scene.export',{includeData:true});
    await call('scene.open',{name:'polygon-crease-'+storage+'.hash',base64:saved.base64});
    await checkAll(50,storage+' HASH open');
    assert.equal(await get(copy.hash),40);
    assert.deepEqual(keyOf(await inspect(copy.hash)),canonical);
    await checkNormals(copy.hash,40,storage+' duplicate HASH open');
    console.log('Polygon Crease Angle passes '+storage+' creation, edit, instances, Undo/Redo, duplicate and HASH.');
  }
  await call('scene.new');
  const cube=await call('scene.create',{type:'cube'});
  const patch=await call('scene.convert',{id:cube.hash});
  assert.equal(patch.type,'spline_patch');
  assert.equal(await schema(patch.hash),undefined,'Spline Patch must not advertise a polygon angle');
  await call('scene.select',{ids:[patch.hash]});
  await page.locator('#tabAttributes').click();
  assert.equal(await page.locator('#attrContent [data-field="crease angle"]').count(),0);
  await assert.rejects(()=>call('scene.update',{id:patch.hash,params:{[field]:50}}));
  const gpu=await page.evaluate(async()=>{
    const {device,errors}=polygonCreaseTestGPU;
    return {validation:(await device.popErrorScope())?.message??null,errors};
  });
  assert.deepEqual(gpu,{validation:null,errors:[]});
  assert.deepEqual(pageErrors,[]);
}finally{await session.close();}
