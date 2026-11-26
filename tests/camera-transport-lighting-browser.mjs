import assert from 'node:assert/strict';
import {launch,ready} from '../tools/browser.mjs';

import {fileURLToPath} from 'node:url';

export async function cameraTransportLightingChecks(page){
  const call=(n,a={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[n,a]);
  await call('scene.new');
  await page.evaluate(()=>{
    const el=document.getElementById('frame-pathtracer');el.textContent=el.textContent.replace('return new FrameRenderer(container,changed);','return window.fixtureTracer=new FrameRenderer(container,changed);');
    if(frameEngine.renderer.device.adapterInfo.isFallbackAdapter)throw Error('Hardware adapter required');
  });
  async function plate(name,z,extent,x=0){
    return call('mesh.create',{name,vertices:[x-extent,-extent,z,x+extent,-extent,z,x+extent,extent,z,x-extent,extent,z],indices:[0,1,2,0,2,3]});
  }
  const donor=await plate('Hidden red floor',0,170),ceiling=await plate('White receiver',100,170),lamp=await plate('Coplanar area emitter',100,26,85);
  const material=(name,h,s,l,emm=0)=>call('material.create',{name,params:{h,s,l,emm,ior:1,rough:100}});
  const red=await material('Red diffuser',0,100,50),white=await material('White matte',0,0,88),black=await material('Absorber',0,0,0),source=await material('Emitter',0,0,100,300);
  await call('material.assign',{id:ceiling.hash,material:white.uid});await call('material.assign',{id:donor.hash,material:red.uid});await call('material.assign',{id:lamp.hash,material:source.uid});
  await call('scene.create',{type:'render',params:{quality:1,realtime:'off',environment:'off','resolution x':96,'resolution y':64}});
  await call('render.export',{kind:'image',download:false});await call('render.stop');
  await page.evaluate(()=>{window.snapshotOptions=fixtureTracer.options;});
  async function energy(key,renderer){
    const result=await page.evaluate(async([key,renderer])=>{
      const t=fixtureTracer,base=snapshotOptions;
      await t.start({...base,renderer,sceneKey:key,geometryKey:key,viewKey:key+renderer,quality:40,finish:true,previewPresentation:false,current:undefined,
        camera:{position:[0,0,65],right:[1,0,0],up:[0,1,0],forward:[0,0,1],fov:45,aspect:1.5},outputSize:[96,64]});
      if(t.stats.phase!=='complete')throw Error(t.stats.errors.join('\n'));
      const pts=Array.from({length:256},(_,i)=>[.25+.5*((i%16)+.5)/16,.25+.5*(Math.floor(i/16)+.5)/16]);
      const colors=await t.readLinearPixels(pts);
      return [0,1,2].map(c=>colors.reduce((a,p)=>a+p.color[c],0)/colors.length);
    },[key,renderer]);
    return result;
  }
  const lit=await energy('red','Interactive GI'),pt=await energy('red','Path tracer');
  assert.ok(lit[0]>.001&&lit[0]>lit[1]*5,JSON.stringify(lit));assert.ok(Math.abs(lit[0]-pt[0])/pt[0]<.12,JSON.stringify({lit,pt}));
  const wall=await plate('Opaque intervening plate',45,260);await call('material.assign',{id:wall.hash,material:black.uid});
  const blocked=await energy('blocked','Interactive GI');assert.ok(blocked[0]<lit[0]*.05,JSON.stringify({blocked,lit}));
  await call('scene.delete',{ids:[wall.hash]});const reopened=await energy('reopened','Interactive GI');assert.ok(reopened[0]>lit[0]*.9);
  const floorBlack=await material('Black floor',0,0,0);
  await call('material.assign',{id:donor.hash,material:floorBlack.uid});const absorbed=await energy('black','Interactive GI');assert.ok(absorbed[0]<lit[0]*.05);
  const angular=await page.evaluate(async()=>{
    const t=fixtureTracer,base=t.options,results=[];
    const camera={position:[0,0,1000],right:[1,0,0],up:[0,1,0],forward:[0,0,1],fov:45,aspect:1.5};
    for(const angle of [0,1e-7,.04]){
      await t.start({...base,quality:1,finish:true,previewPresentation:false,viewKey:'angular'+angle,camera,outputSize:[96,64],
        environment:{mode:'off',lobes:[],infiniteLights:[{direction:[0,0,1],angle,intensity:.03,color:[1,1,1]}]}});
      if(t.stats.phase!=='complete')throw Error(t.stats.errors.join('\n'));
      const points=Array.from({length:24*24},(_,i)=>[(36+(i%24)+.5)/96,(20+(i/24|0)+.5)/64]);
      const pixels=await t.readLinearPixels(points),omega=4*Math.tan(Math.PI/8)**2*1.5/(96*64);
      results.push(pixels.reduce((s,p)=>s+p.color[0]*omega,0));
    }return results;
  });
  assert.ok(angular.every(v=>v>.045&&v<.075),JSON.stringify(angular));assert.ok(Math.abs(angular[0]-angular[1])<1e-4);
  return {pass:true,hiddenRed:lit,reference:pt,blocked,reopened,absorbed,angularFlux:angular};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const {page,close}=await launch({headless:true});
  try{await ready(page);console.log(JSON.stringify(await cameraTransportLightingChecks(page)));}finally{await close();}
}
