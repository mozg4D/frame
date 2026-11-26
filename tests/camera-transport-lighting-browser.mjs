import assert from 'node:assert/strict';
import {launch,ready} from '../tools/browser.mjs';

import {fileURLToPath} from 'node:url';

export async function cameraTransportLightingChecks(page){
  const call=(n,a={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[n,a]);
  await call('scene.new');
  await page.evaluate(()=>{
    const el=document.getElementById('frame-pathtracer');el.textContent=el.textContent.replace('return new FrameRenderer(container,changed);','window.rasterQuerySource=cameraMaterialCode+cameraRasterRay;return window.fixtureTracer=new FrameRenderer(container,changed);');
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
  async function energy(key,denoiser='on'){
    const result=await page.evaluate(async([key,denoiser])=>{
      const t=fixtureTracer,base=snapshotOptions;
      await t.start({...base,denoiser,sceneKey:key,geometryKey:key,viewKey:key+denoiser,quality:40,finish:true,previewPresentation:false,current:undefined,
        camera:{position:[0,0,65],right:[1,0,0],up:[0,1,0],forward:[0,0,1],fov:45,aspect:1.5},outputSize:[96,64]});
      if(t.stats.phase!=='complete')throw Error(t.stats.errors.join('\n'));
      const pts=Array.from({length:256},(_,i)=>[.25+.5*((i%16)+.5)/16,.25+.5*(Math.floor(i/16)+.5)/16]);
      const colors=await t.readLinearPixels(pts);
      let ripple=0;for(let y=0;y<16;y++)for(let x=1;x<15;x++){
        const i=y*16+x;ripple+=Math.abs(2*colors[i].color[0]-colors[i-1].color[0]-colors[i+1].color[0]);
      }
      return {rgb:[0,1,2].map(c=>colors.reduce((a,p)=>a+p.color[c],0)/colors.length),ripple:ripple/(16*14)};
    },[key,denoiser]);
    return result;
  }
  const lit=await energy('red'),raw=await energy('red','off');
  assert.ok(lit.rgb[0]>.001&&lit.rgb[0]>lit.rgb[1]*5,JSON.stringify(lit));
  assert.ok(raw.rgb[0]>0&&Math.abs(lit.rgb[0]-raw.rgb[0])/raw.rgb[0]<.25&&lit.ripple<raw.ripple,JSON.stringify({lit,raw}));
  const wall=await plate('Opaque intervening plate',45,260);await call('material.assign',{id:wall.hash,material:black.uid});
  const blocked=await energy('blocked');assert.ok(blocked.rgb[0]<lit.rgb[0]*.05,JSON.stringify({blocked,lit}));
  await call('scene.delete',{ids:[wall.hash]});const reopened=await energy('reopened');assert.ok(reopened.rgb[0]>lit.rgb[0]*.9);
  const floorBlack=await material('Black floor',0,0,0);
  await call('material.assign',{id:donor.hash,material:floorBlack.uid});const absorbed=await energy('black');assert.ok(absorbed.rgb[0]<lit.rgb[0]*.05);
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
  await call('scene.new');
  const faces=[[[1,0,0],[0,0,-1],[0,1,0]],[[-1,0,0],[0,0,1],[0,1,0]],[[0,1,0],[1,0,0],[0,0,-1]],[[0,-1,0],[1,0,0],[0,0,1]],[[0,0,1],[1,0,0],[0,1,0]],[[0,0,-1],[-1,0,0],[0,1,0]]];
  const vertex=(face,x,y)=>face[0].map((f,i)=>50*(f+x*face[1][i]+y*face[2][i]));
  const vertices=faces.flatMap(f=>[[.10,.04],[.62,.08],[.30,.55]].flatMap(([x,y])=>vertex(f,x,y)));
  await call('mesh.create',{name:'Six off-axis targets',vertices,indices:Array.from({length:18},(_,i)=>i)});
  await call('scene.create',{type:'render',params:{realtime:'off',quality:1,'resolution x':96,'resolution y':64}});
  await call('render.export',{kind:'image',download:false});await call('render.stop');
  const probe=await page.evaluate(async({targets,faces})=>{
    const t=fixtureTracer,dev=t.device,base=t.options,camera={position:[0,0,0],right:[1,0,0],up:[0,1,0],forward:[0,0,1],fov:45,aspect:1.5};
    await t.start({...base,camera,viewKey:'six-face-readback',current:undefined,previewPresentation:false,finish:true});
    const local=p=>p.map((v,i)=>(v-t.scene.center[i])/t.scene.scale);
    const input=new Float32Array(6*8);
    for(let i=0;i<6;i++){input.set(local(faces[i][1].map(v=>v*2)),8*i);input.set(local(targets[i]),8*i+4);}
    const shader=rasterQuerySource+`
      @group(1) @binding(0) var hits:texture_2d<u32>;
      @group(1) @binding(1) var<storage,read> endpoints:array<vec4f>;
      @group(1) @binding(2) var<storage,read_write> results:array<vec4u>;
      @compute @workgroup_size(1) fn probe(@builtin(global_invocation_id) id:vec3u){
        let o=endpoints[2u*id.x].xyz;let p=endpoints[2u*id.x+1u].xyz;
        let dir=normalize(p-o);let word=rasterWord(p,true);let main=rasterWord(p,false);
        let h=rasterHit(o,dir,length(p-o)+.02,EMPTY_SLOT);
        let shortRay=rasterHit(o,dir,length(p-o)*.8,EMPTY_SLOT);
        results[id.x]=vec4u(word.x,main.x,h.triangle+1u,shortRay.triangle+1u);
      }`;
    const cs=GPUShaderStage.COMPUTE,layout=dev.createBindGroupLayout({entries:[{binding:0,visibility:cs,texture:{sampleType:'uint'}},{binding:1,visibility:cs,buffer:{type:'read-only-storage'}},{binding:2,visibility:cs,buffer:{type:'storage'}}]});
    const pipe=await dev.createComputePipelineAsync({layout:dev.createPipelineLayout({bindGroupLayouts:[t.programs.sceneLayout,layout]}),compute:{module:dev.createShaderModule({code:shader}),entryPoint:'probe',constants:{sceneFeatures:0,variableSceneFeatures:15}}});
    const from=t.buffer(input),out=t.buffer(new Uint32Array(24)),read=dev.createBuffer({size:96,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    try{
      const group=t.group(layout,[t.cameraImage.hits[t.cameraImage.front],from,out]);
      const e=dev.createCommandEncoder(),pass=e.beginComputePass();pass.setPipeline(pipe);pass.setBindGroup(0,t.sceneBindGroup);pass.setBindGroup(1,group);pass.dispatchWorkgroups(6);pass.end();
      e.copyBufferToBuffer(out,0,read,0,96);dev.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);
      const words=Array.from(new Uint32Array(read.getMappedRange()));read.unmap();return Array.from({length:6},(_,i)=>words.slice(i*4,i*4+4));
    }finally{from.destroy();out.destroy();read.destroy();}
  },{targets:faces.map(f=>vertex(f,.32,.22)),faces});
  assert.equal(new Set(probe.map(r=>r[0])).size,6);
  for(const [i,[cube,screen,hit,short]] of probe.entries()){assert.ok(cube>0);assert.equal(screen,i===4?cube:0);assert.equal(hit,cube);assert.equal(short,0);}
  return {pass:true,hiddenRed:lit,raw,blocked,reopened,absorbed,angularFlux:angular,cubeQueries:probe};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const {page,close}=await launch({headless:true});
  try{await ready(page);console.log(JSON.stringify(await cameraTransportLightingChecks(page)));}finally{await close();}
}
