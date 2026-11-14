// Native pixel regression: projected wire coverage must not depend on vertex depth.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {serve,ready} from '../tools/browser.mjs';

export async function surfaceWireStabilityBrowserChecks(page){
 const result=await page.evaluate(async()=>{
  const r=frameEngine.renderer,d=r.device,width=256,height=256,resources=[],own=value=>(resources.push(value),value);
  const texture=own(d.createTexture({size:[width,height],format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC}));
  const depth=own(d.createTexture({size:[width,height],format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT}));
  const read=own(d.createBuffer({size:width*height*4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}));
  const vertices=own(d.createBuffer({size:48,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}));
  const uniform=own(d.createBuffer({size:144,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}));
  const params=new Float32Array(36);params.set([width,height,.5,1],28);params.set([3,3,0,0],32);d.queue.writeBuffer(uniform,0,params);
  // Exercise the shipped Output interpolation and surfaceWireColor, not a copied implementation.
  const extra=`
@group(2) @binding(0) var<storage,read> fixture:array<vec4f>;
@vertex fn fixtureVS(@builtin(vertex_index) v:u32)->Output{
 var out:Output;let p=fixture[v];out.position=vec4f(p.xy*p.z,.999*p.z-.01,p.z);
 out.bary=vec3f(select(0.,1.,v==0u),select(0.,1.,v==1u),select(0.,1.,v==2u));out.wireEdges=15u;return out;
}
@vertex fn coverVS(@builtin(vertex_index) v:u32)->@builtin(position) vec4f{
 return vec4f(f32((v<<1u)&2u)*2.-1.,f32(v&2u)*2.-1.,.1,1);
}
@fragment fn fixtureFS(input:Output)->@location(0) vec4f{return vec4f(surfaceWireColor(vec3f(0),input.bary,input.wireEdges),1);}
@fragment fn coverFS()->@location(0) vec4f{return vec4f(0,0,0,1);}`;
  const legacy=r.shaderSource.replace('@interpolate(linear) bary','@interpolate(perspective) bary');
  if(legacy===r.shaderSource)throw Error('Missing screen-linear wire interpolator');
  const pipelines=[];
  try{
   for(const [name,source]of [['legacy',legacy],['current',r.shaderSource]]){
    const module=d.createShaderModule({label:'actual surface wire '+name,code:source+extra}),info=await module.getCompilationInfo();
    if(info.messages.some(m=>m.type==='error'))throw Error(info.messages.map(m=>m.message).join('\n'));
    const descriptor={layout:'auto',vertex:{module,entryPoint:'fixtureVS'},fragment:{module,entryPoint:'fixtureFS',targets:[{format:'rgba8unorm'}]},primitive:{topology:'triangle-list'},depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'}};
    const pipeline=await d.createRenderPipelineAsync(descriptor),global=d.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uniform}}]}),local=d.createBindGroup({layout:pipeline.getBindGroupLayout(2),entries:[{binding:0,resource:{buffer:vertices}}]});
    const cover=await d.createRenderPipelineAsync({...descriptor,vertex:{module,entryPoint:'coverVS'},fragment:{module,entryPoint:'coverFS',targets:[{format:'rgba8unorm'}]}});
    const timed=await d.createRenderPipelineAsync({...descriptor,depthStencil:{format:'depth24plus',depthWriteEnabled:false,depthCompare:'always'}}),timedGlobal=d.createBindGroup({layout:timed.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uniform}}]}),timedLocal=d.createBindGroup({layout:timed.getBindGroupLayout(2),entries:[{binding:0,resource:{buffer:vertices}}]});
    pipelines.push({name,pipeline,global,local,cover,timed,timedGlobal,timedLocal});
   }
   const encode=(state,{covered=false}={})=>{
    const encoder=d.createCommandEncoder(),pass=encoder.beginRenderPass({colorAttachments:[{view:texture.createView(),clearValue:[0,0,0,1],loadOp:'clear',storeOp:'store'}],depthStencilAttachment:{view:depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'discard'}});
    if(covered){pass.setPipeline(state.cover);pass.draw(3);}
    pass.setPipeline(state.pipeline);pass.setBindGroup(0,state.global);pass.setBindGroup(2,state.local);pass.draw(3);pass.end();
    return encoder;
   };
   const setVertices=(weights,phase)=>{const values=new Float32Array(12);for(const [i,[x,y]]of [[14.2,20.3],[241.1,119.8],[168.9,236.7]].entries())values.set([(x+phase)/width*2-1,1-y/height*2,weights[i],0],i*4);d.queue.writeBuffer(vertices,0,values);};
   const render=async(state,weights,phase,covered=false)=>{setVertices(weights,phase);const encoder=encode(state,{covered});encoder.copyTextureToBuffer({texture},{buffer:read,bytesPerRow:width*4},[width,height]);d.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);const data=new Uint8Array(read.getMappedRange()).slice();read.unmap();return data;};
   const cases=[];
   for(const state of pipelines){
    for(const phase of [0,.125,.25,.375,.5,.625,.75,.875]){
     const flat=await render(state,[1,1,1],phase),tilted=await render(state,[.02,5,5],phase);let changed=0,maxDelta=0,referenceMass=0,tiltedMass=0;
     for(let i=2;i<flat.length;i+=4){const delta=Math.abs(flat[i]-tilted[i]);if(delta>2)changed++;maxDelta=Math.max(maxDelta,delta);referenceMass+=flat[i];tiltedMass+=tilted[i];}
     cases.push({variant:state.name,phase,changed,maxDelta,referenceMass,tiltedMass});
    }
   }
   const covered=await render(pipelines[1],[.02,5,5],.375,true);let leaked=0;for(let i=0;i<covered.length;i+=4)if(covered[i]||covered[i+1]||covered[i+2])leaked++;
   // Paired GPU timestamps: same surface helper and work, only interpolation changes.
   const timing={supported:d.features.has('timestamp-query'),legacy:[],current:[]};
   if(timing.supported){
    const queries=own(d.createQuerySet({type:'timestamp',count:2})),resolve=own(d.createBuffer({size:256,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC})),times=own(d.createBuffer({size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}));
    setVertices([.02,5,5],.375);
    for(let n=0;n<13;n++)for(const state of n%2?pipelines:[...pipelines].reverse()){
     // Repeated independent triangles in one pass, with always-depth so all fragments execute.
     const encoder=d.createCommandEncoder(),pass=encoder.beginRenderPass({timestampWrites:{querySet:queries,beginningOfPassWriteIndex:0,endOfPassWriteIndex:1},colorAttachments:[{view:texture.createView(),clearValue:[0,0,0,1],loadOp:'clear',storeOp:'store'}],depthStencilAttachment:{view:depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'discard'}});
     pass.setPipeline(state.timed);pass.setBindGroup(0,state.timedGlobal);pass.setBindGroup(2,state.timedLocal);for(let i=0;i<128;i++)pass.draw(3);pass.end();encoder.resolveQuerySet(queries,0,2,resolve,0);encoder.copyBufferToBuffer(resolve,0,times,0,16);d.queue.submit([encoder.finish()]);await times.mapAsync(GPUMapMode.READ);const t=new BigUint64Array(times.getMappedRange()),ms=Number(t[1]-t[0])/1e6;times.unmap();if(n>=4)timing[state.name].push(ms);
    }
   }
   return {cases,occludedPixelsLeaked:leaked,timing};
  }finally{for(const resource of resources)resource.destroy();}
 });
 const checks=[],check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});assert.ok(pass,name+': '+JSON.stringify(detail));};
 check('Legacy negative control reproduces depth-dependent cyan disappearance',result.cases.filter(c=>c.variant==='legacy').every(c=>c.changed>50&&c.maxDelta>50),result.cases.filter(c=>c.variant==='legacy'));
 check('Screen-identical triangles keep cyan coverage through eight subpixel phases',result.cases.filter(c=>c.variant==='current').every(c=>c.changed===0&&c.maxDelta<=2&&c.referenceMass>40000),result.cases.filter(c=>c.variant==='current'));
 check('Nearer opaque surface fully hides cyan without a depth offset',result.occludedPixelsLeaked===0,result.occludedPixelsLeaked);
 const median=a=>[...a].sort((x,y)=>x-y)[a.length>>1],timing=result.timing;
 if(timing.supported){timing.legacyMedianMs=median(timing.legacy);timing.currentMedianMs=median(timing.current);check('Paired GPU timing has no material regression',timing.currentMedianMs<=timing.legacyMedianMs*1.15+.1,timing);}
 const call=(n,a={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[n,a]),frames=[];
 await call('scene.new');const source=await call('scene.create',{type:'sphere'}),copies=await call('scene.create',{type:'cloner',inputs:[source.hash],params:{'count x':3,'count y':1,'count z':1,'spacing x':250}});
 await call('scene.select',{ids:[]});
 let owner=copies,instancePaths;
 for(const material of [false,true]){
  if(material){instancePaths=await page.evaluate(()=>({perspective:!!frameEngine.renderer.replicaPerspectiveWire,orthographic:!!frameEngine.renderer.replicaOrthoWire}));await call('scene.new');owner=await call('scene.create',{type:'sphere'});const m=await call('material.create',{params:{h:35,s:40,l:50}});await call('material.assign',{id:owner.hash,material:m.uid});await call('scene.select',{ids:[]});}
  for(const index of [0,2]){
   await call('view.set',{index,single:true,mode:'object',shading:'solid-isoparms',focus:owner.hash});
   await page.waitForFunction(({material,index})=>{const r=frameEngine.renderer;return material?[...r.materialState?.pipelines.keys()||[]].some(k=>k.startsWith(String(index!==0)+':')):!!r[index?'replicaOrthoWire':'replicaPerspectiveWire'];},{material,index},{timeout:10000});
   const measured=await call('diagnostics.frame',{frames:3});frames.push({material,index,...measured});
   check('Native '+(material?'material':'batched instance')+' view '+index+' frame budget',measured.timestampQueries&&measured.frames.every(f=>f.cpuMs<50&&f.gpuMs<50),measured.frames);
  }
 }
 const paths={...instancePaths,...await page.evaluate(()=>{const r=frameEngine.renderer;return {materialScreenLinear:r.materialState?.source.includes('@interpolate(linear) bary'),materialPipelines:r.materialState?.pipelines.size};})};
 check('Actual perspective/orthographic instance and material paths compile',paths.perspective&&paths.orthographic&&paths.materialScreenLinear&&paths.materialPipelines>=2,paths);
 return {pass:true,checks,...result,frames};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const server=await serve(),report={pass:false,errors:[]};let browser;
 try{
  browser=await chromium.launch({headless:true,channel:'chromium',executablePath:process.env.FRAME_BROWSER,ignoreDefaultArgs:['--enable-unsafe-swiftshader'],args:['--enable-unsafe-webgpu','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  const context=await browser.newContext({viewport:{width:1000,height:760},deviceScaleFactor:1,serviceWorkers:'block'}),page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.stack));await page.goto(server.url);await ready(page);
  report.adapter=await page.evaluate(()=>{const a=frameEngine.renderer.device.adapterInfo;return {vendor:a.vendor,architecture:a.architecture,isFallbackAdapter:a.isFallbackAdapter};});assert.equal(report.adapter.isFallbackAdapter,false);assert.ok(!/swiftshader|software|llvmpipe/i.test(JSON.stringify(report.adapter)));
  await page.evaluate(()=>{window.__wireErrors=[];const d=frameEngine.renderer.device;d.addEventListener('uncapturederror',e=>__wireErrors.push(e.error.message));d.pushErrorScope('validation');});
  Object.assign(report,await surfaceWireStabilityBrowserChecks(page));report.validation=await page.evaluate(async()=>({scope:(await frameEngine.renderer.device.popErrorScope())?.message||null,uncaptured:__wireErrors}));assert.equal(report.validation.scope,null);assert.deepEqual(report.validation.uncaptured,[]);assert.deepEqual(report.errors,[]);
 }catch(error){report.pass=false;report.error=error.stack;}
 finally{await browser?.close();await server.close();report.indexSHA256=createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex');await mkdir(new URL('./results/',import.meta.url),{recursive:true});await writeFile(new URL('./results/surface-wire-stability-browser.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));process.exitCode=report.pass?0:1;}
}
