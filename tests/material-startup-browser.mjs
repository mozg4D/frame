import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../tools/browser.mjs';

export async function materialStartupChecks(page){
  const checks=[],timings=[],call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]);
  const check=(name,value)=>{assert.ok(value,name);checks.push({name,pass:true});};
  const settle=()=>page.evaluate(async()=>{
    const r=frameEngine.renderer;await frameEngine.draw(true);await r.materialState.assetsReady;
    await Promise.all(r.materialState.pending.values());await frameEngine.draw(true);await r.device.queue.onSubmittedWorkDone();
  });
  const measure=async(name,limit,operation)=>{
    const start=performance.now(),result=await operation();await settle();
    const ms=performance.now()-start;timings.push({name,ms,limit});check(name+' completes within budget',ms<limit);return result;
  };
  await call('scene.new');await call('view.set',{index:0,single:true,shading:'solid'});
  const car=await measure('Stock car material frame',2000,()=>call('scene.create',{type:'car'}));
  const paint=(await call('scene.inspect')).materials.find(m=>/paint/i.test(m.name));
  check('Stock paint uses the colour-only pipeline and a single white texel',await page.evaluate(hash=>{
    const r=frameEngine.renderer,m=frameEngine.scene.meshes.find(m=>m.hashId===hash);
    window.materialStartupProgram=r.materialProgram;
    return !m.materialBindings.mapped&&r.materialState.layers.size===0&&r.materialState.atlas.width===1;
  },car.hash));
  const png=await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=257;c.height=99;
    const ctx=c.getContext('2d'),data=ctx.createImageData(c.width,c.height);
    for(let i=0;i<data.data.length;i+=4)data.data.set([i%251,(i>>2)%255,117,i%20?255:73],i);
    ctx.putImageData(data,0,0);return c.toDataURL().split(',')[1];
  });
  await page.evaluate(()=>{window.materialTestWorker=window.Worker;window.materialWorkerCalls=0;window.Worker=class extends Worker{
    constructor(url,options){if(options?.name==='Frame material image'){window.materialWorkerCalls++;if(window.materialWorkerUnavailable)throw Error('Worker unavailable');}super(url,options);}
  };});
  try{
    for(const unavailable of [false,true]){
      await page.evaluate(flag=>window.materialWorkerUnavailable=flag,unavailable);
      await call('material.texture',{material:paint.uid,slot:'roughness',base64:png});await settle();
      const result=await page.evaluate(async hash=>{
        const r=frameEngine.renderer,state=r.materialState,d=r.device,mesh=frameEngine.scene.meshes.find(m=>m.hashId===hash);
        const [uid,layer]=[...state.layers][0],asset=frameMaterialState().assets.find(a=>a.uid===uid);
        const image=new Image();image.src=asset.url;await image.decode();
        const side=state.atlas.width,c=document.createElement('canvas');c.width=c.height=side;
        c.getContext('2d',{willReadFrequently:true}).drawImage(image,0,0,side,side);
        const reference=d.createTexture({size:[side,side],format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC});
        const pitch=Math.ceil(side*4/256)*256,size=pitch*side,read=d.createBuffer({size:size*2,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
        try{
          d.queue.copyExternalImageToTexture({source:c},{texture:reference},[side,side]);
          const e=d.createCommandEncoder();
          e.copyTextureToBuffer({texture:reference},{buffer:read,bytesPerRow:pitch},[side,side]);
          e.copyTextureToBuffer({texture:state.atlas,origin:[0,0,layer]},{buffer:read,offset:size,bytesPerRow:pitch},[side,side]);
          d.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);const bytes=new Uint8Array(read.getMappedRange());
          return {same:bytes.subarray(0,size).every((v,i)=>v===bytes[size+i]),alpha:state.alphaAssets.get(uid),mapped:mesh.materialBindings.mapped,workers:materialWorkerCalls};
        }finally{read.destroy();reference.destroy();}
      },car.hash);
      check((unavailable?'Fallback':'Worker')+' preserves every scaled RGBA texel and detects transparency',result.workers>Number(unavailable)&&result.same&&result.alpha&&result.mapped);
      await call('material.texture',{material:paint.uid,slot:'roughness',remove:true});await settle();
      check('Removing the final map restores colour-only shading',await page.evaluate(h=>!frameEngine.scene.meshes.find(m=>m.hashId===h).materialBindings.mapped,car.hash));
    }
  }finally{await page.evaluate(()=>{window.Worker=window.materialTestWorker;});}
  await call('scene.merge',{url:'tests/scenes/DamagedHelmet/DamagedHelmet.gltf'});await settle();
  check('Merging the helmet keeps both mapped and colour-only draws in the same view',await page.evaluate(h=>{
    const meshes=frameEngine.scene.meshes;return meshes.some(m=>m.hashId===h&&!m.materialBindings.mapped)&&meshes.some(m=>m.hashId!==h&&m.materialBindings?.mapped);
  },car.hash));
  await measure('Helmet material frame',3000,()=>call('scene.open',{url:'tests/scenes/DamagedHelmet/DamagedHelmet.gltf'}));
  check('Opening the helmet reuses the device program and binds all five maps',await page.evaluate(()=>{
    const r=frameEngine.renderer;return r.materialProgram===window.materialStartupProgram&&r.materialState.layers.size===5&&frameEngine.scene.meshes[0].materialBindings.mapped;
  }));
  check('An undecodable glTF image leaves the displayed document and its atlas intact',await page.evaluate(async()=>{
    const url=new URL('tests/scenes/DamagedHelmet/DamagedHelmet.gltf',location),doc=await (await fetch(url)).json();
    doc.images[0].uri='data:image/png;base64,eA==';
    const before=frameEngine.scene,atlas=frameEngine.renderer.materialState.atlas;
    try{await frameEngine.loadFile(new File([JSON.stringify(doc)],'broken.gltf'),{baseURL:url.href});return false;}
    catch{return frameEngine.scene===before&&frameEngine.renderer.materialState.atlas===atlas;}
  }));
  return {pass:true,checks,timings};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const s=await launch({headless:true});
  try{await ready(s.page);console.log(JSON.stringify(await materialStartupChecks(s.page),null,2));}finally{await s.close();}
}
