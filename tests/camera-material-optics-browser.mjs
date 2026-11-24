import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../tools/browser.mjs';

export async function cameraMaterialOpticsChecks(page){
  const call=(name,args={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[name,args]);
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await call('scene.new');
  await page.evaluate(()=>{
    const device=frameEngine.renderer.device;
    if(device.adapterInfo?.isFallbackAdapter)throw Error('Hardware WebGPU required');
    device.pushErrorScope('validation');
    const script=document.querySelector('#frame-pathtracer');
    script.textContent=script.textContent.replace('return new FrameRenderer(container,changed);','return window.opticsTracer=new FrameRenderer(container,changed);');
  });
  for(const params of [{ior:.99},{sss:101},{translucency:-1},{sssRadius:0}]){
    await assert.rejects(call('material.create',{params}),/Invalid material parameter/);
  }
  const wax=await call('material.create',{name:'Wax',params:{l:86,rough:80,ior:1.33,sss:60,sssRadius:12}});
  await page.locator('#tabMaterialMgr').click();
  const edit=async(id,value)=>{const input=page.locator(id);await input.fill(String(value));await input.press('Enter');};
  await edit('#inpIor',1.417);
  await edit('#inpTranslucency',14);
  await edit('#inpSss',78);
  await edit('#inpSssRadius',8.5);
  const props=async()=>{const m=(await call('scene.inspect')).materials.find(m=>m.uid===wax.uid);return [m.ior,m.translucency,m.sss,m.sssRadius];};
  assert.deepEqual(await props(),[1.417,14,78,8.5]);
  await call('edit.history',{action:'undo'});assert.deepEqual(await props(),[1.417,14,78,12]);
  await call('edit.history',{action:'redo'});assert.deepEqual(await props(),[1.417,14,78,8.5]);

  const slab=await call('mesh.create',{name:'Closed slab',vertices:[-32,-15,-4,-2,-15,-4,-2,15,-4,-32,15,-4,-32,-15,0,-2,-15,0,-2,15,0,-32,15,0],indices:[0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7]});
  const sheet=await call('mesh.create',{name:'Open sheet',vertices:[2,-15,0,32,-15,0,32,15,0,2,15,0],indices:[0,1,2,0,2,3]});
  await call('material.assign',{id:slab.hash,material:wax.uid});await call('material.assign',{id:sheet.hash,material:wax.uid});
  const saved=await call('scene.export',{includeData:true});
  await call('scene.open',{name:'optics.hash',base64:saved.base64});
  assert.deepEqual(await props(),[1.417,14,78,8.5]);
  await call('scene.create',{type:'render',params:{realtime:'off',samples:1,'resolution x':96,'resolution y':64}});
  await call('render.export',{kind:'image',download:false});
  const measurements=await page.evaluate(async()=>{
    const t=window.opticsTracer,base=t.options,getScene=base.getScene;
    const camera={position:[0,0,80],right:[1,0,0],up:[0,1,0],forward:[0,0,-1],fov:38,aspect:1.5};
    const points=Array.from({length:18},(_,i)=>[(i<9?.28:.72)+((i%3)-1)*.02,.5+(Math.floor(i%9/3)-1)*.03]);
    let serial=0;
    async function frame(material,front=false,primary=null,ortho=0){
      const key='optics-'+(++serial);
      const environment={...base.environment,mode:'off',infiniteLights:[{direction:[0,0,front?1:-1],angle:0,intensity:1,color:[1,1,1]}]};
      if(primary)t.useRayGBuffer=()=>primary==='bvh';
      await t.start({...base,camera:{...camera,ortho},environment,onSamples:()=>{},getScene:async cancelled=>{
        const s=await getScene(cancelled);const wax=s.materials.filter(m=>m.name==='Wax');
        if(wax.length!==2||wax.some(m=>m.ior!==1.417||m.sss!==.78||m.sssRadius!==8.5||m.translucency!==.14))throw Error('Native optical snapshot lost authored values');
        for(const m of wax)Object.assign(m,{ior:1,sss:0,translucency:0},material);
        return s;
      },sceneKey:key,viewKey:key,outputSize:[96,64],frameSeed:7,sampleLimit:32,maxBounces:3,adaptive:false,interactivePreview:!!primary,lightingReuse:!!primary});
      if(t.stats.errors.length||t.stats.filmFaults||t.stats.phase!==(primary?'preview':'complete'))throw Error(JSON.stringify(t.stats));
      const pixels=await t.readLinearPixels(points);
      if(pixels.some(p=>p.color.some(c=>!Number.isFinite(c))))throw Error('Non-finite linear pixel');
      const mean=p=>p.reduce((v,s)=>v+s.color[0],0)/p.length;
      return {slab:mean(pixels.slice(0,9)),sheet:mean(pixels.slice(9)),primary:t.stats.gi?.primaryVisibility};
    }
    try{
      const off=await frame({}),translucent=await frame({translucency:1});
      const short=await frame({sss:1,sssRadius:.1}),long=await frame({sss:1,sssRadius:20});
      const glass={color:[0,0,0],rough:.5};
      const low=await frame({...glass,ior:1.1},true),high=await frame({...glass,ior:2.4},true);
      const raster=await frame({translucency:1},false,'raster'),bvh=await frame({translucency:1},false,'bvh');
      const coverage=[];
      for(const factor of [.25,.75]){
        const mat={translucency:1,alphaMode:'BLEND',alphaModeCode:3,coverageFactor:factor};
        coverage.push({factor,raster:await frame(mat,false,'raster'),bvh:await frame(mat,false,'bvh')});
      }
      const orthoRaster=await frame({translucency:1},false,'raster',55),orthoBVH=await frame({translucency:1},false,'bvh',55);
      return {off,translucent,short,long,low,high,raster,bvh,coverage,orthoRaster,orthoBVH};
    }finally{delete t.useRayGBuffer;}
  });
  const {off,translucent,short,long,low,high,raster,bvh,orthoRaster,orthoBVH}=measurements;
  assert.ok(translucent.sheet>off.sheet+.1,JSON.stringify(measurements));
  assert.ok(long.slab>short.slab+.08&&long.slab>off.slab+.08,JSON.stringify(measurements));
  assert.ok(high.sheet>3*low.sheet&&high.sheet>.05,JSON.stringify(measurements));
  for(const [r,b] of [[raster,bvh],[orthoRaster,orthoBVH]]){
    assert.equal(b.primary,'bvh');assert.equal(r.primary,'raster');
    assert.ok(r.sheet>.1&&Math.abs(b.sheet-r.sheet)<.015&&Math.abs(b.slab-r.slab)<.015,JSON.stringify(measurements));
  }
  for(const {factor,raster:r,bvh:b} of measurements.coverage){
    assert.equal(r.sheet>.1,factor>.5);assert.ok(Math.abs(r.sheet-b.sheet)<.015);
  }
  const large=await page.evaluate(async()=>{
    const t=window.opticsTracer,base=t.options;
    const getScene=async cancelled=>{
      const s=await base.getScene(cancelled),source=s.meshes.find(m=>m.indices.length===36);
      s.meshes=Array.from({length:100000},(_,i)=>{
        const matrix=Array.from(source.matrix);
        matrix[12]+=(i%400)*48;matrix[13]+=Math.floor(i/400)*48;
        return {...source,matrix,prevMatrix:matrix,surfaceId:i+1,stableId:i+1};
      });
      return s;
    };
    await t.start({...base,getScene,sceneKey:'100k-copies',viewKey:'100k-copies',interactivePreview:true,lightingReuse:true});
    const s=t.stats;
    const primary4K=t.useRayGBuffer.call({scene:{triangleCount:100632046}},3840,2160);
    return {phase:s.phase,primary:s.gi.primaryVisibility,primary4K,instances:s.instances,triangles:s.triangles,stored:s.storedTriangles,workerMs:s.buildMs,errors:s.errors};
  });
  assert.equal(large.phase,'preview',JSON.stringify(large));assert.equal(large.primary,'bvh');
  assert.equal(large.instances,100000);assert.equal(large.triangles,1200000);assert.equal(large.stored,12);
  assert.equal(large.primary4K,true);assert.ok(Number.isFinite(large.workerMs));assert.deepEqual(large.errors,[]);
  const validation=await page.evaluate(async()=>(await frameEngine.renderer.device.popErrorScope())?.message);
  assert.equal(validation,undefined);assert.deepEqual(errors,[]);
  return {pass:true,measurements,large};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const session=await launch({headless:true});
  try{await ready(session.page);console.log(JSON.stringify(await cameraMaterialOpticsChecks(session.page),null,2));}
  finally{await session.close();}
}
