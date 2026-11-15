import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {launch,ready} from '../tools/browser.mjs';

const session=await launch({headless:true}),{page}=session,checks=[],timings=[],errors=[];
const call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]);
const check=(name,condition,detail)=>{assert.ok(condition,name+': '+JSON.stringify(detail));checks.push(name);console.log('PASS '+name);};
const clear=async()=>{await page.keyboard.press('Escape');const s=await call('scene.inspect');if(s.objects.length)await call('scene.delete',{ids:s.objects.filter(n=>!n.parent).map(n=>n.hash)});};
const project=async(point,id)=>(await call('view.project',{point,...id?{id}:{}})).screen;
const selected=async()=> (await call('scene.inspect')).selection.objects;
const pick=async(at,expected,name,{mouse=false}={})=>{const t=performance.now();if(mouse){await page.mouse.click(...at);await call('scene.inspect');}else await call('selection.pick',{x:at[0],y:at[1]});const ms=performance.now()-t,actual=await selected();timings.push({name,ms,budgetMs:1500});check(name,actual.length===(expected?1:0)&&(!expected||actual[0]===expected),{actual,expected});check(name+' completes within 1500 ms',ms<1500,{ms});};
const square=async(z,storage='auto')=>call('mesh.create',{vertices:[-60,-60,z,60,-60,z,60,60,z,-60,60,z],indices:[0,1,2,0,2,3],storage});
let result,adapter;
try{
 await ready(page);page.on('pageerror',e=>errors.push(e.stack));
 adapter=await page.evaluate(()=>{const a=frameEngine.renderer.device.adapterInfo;return a?{vendor:a.vendor,architecture:a.architecture,device:a.device,description:a.description,isFallbackAdapter:a.isFallbackAdapter}:null;});check('Native hardware WebGPU adapter',adapter?.isFallbackAdapter===false&&!/swiftshader|llvmpipe|software/i.test(JSON.stringify(adapter)),adapter);
 await page.evaluate(()=>{window.__objectPickGPU=[];frameEngine.renderer.device.addEventListener('uncapturederror',e=>__objectPickGPU.push(e.error.message));frameEngine.renderer.device.pushErrorScope('validation');});
 for(const storage of ['auto','texture']){
  await clear();const back=await square(-20,storage),middle=await square(0,storage),front=await square(20,storage),glass=await call('material.create',{name:'Glass',params:{opac:70}});
  await call('material.assign',{id:front.hash,material:glass.uid});await call('material.assign',{id:middle.hash,material:glass.uid});
  await call('view.set',{index:2,single:true,mode:'object',shading:'solid',focus:front.hash});await call('scene.select',{ids:[]});const at=await project([-24,-36,20]);
  await pick(at,front.hash,storage+' first click selects transparent front',{mouse:true});
  await pick([at[0]+3,at[1]-2],middle.hash,storage+' nearby repeat selects next transparent owner',{mouse:true});
  await pick([at[0]-2,at[1]+3],back.hash,storage+' third click reaches opaque back',{mouse:true});
  await pick(at,front.hash,storage+' stack wraps to front',{mouse:true});
  await pick([at[0]+20,at[1]],front.hash,storage+' larger movement restarts at front');
  await call('scene.select',{ids:[]});await pick(at,front.hash,storage+' clearing selection restarts at front');
  // A closed owner must be skipped as a whole, including its rear surface.
  await call('scene.update',{id:middle.hash,visible:false});const raw=await call('mesh.create',{vertices:[-60,-60,30,60,-60,30,60,60,30,-60,60,30,-60,-60,10,60,-60,10,60,60,10,-60,60,10],indices:[0,1,2,0,2,3,4,6,5,4,7,6],storage});
  await call('material.assign',{id:raw.hash,material:glass.uid});await call('scene.update',{id:front.hash,visible:false});await call('scene.select',{ids:[]});
  await pick(at,raw.hash,storage+' closed glass selects front surface');await pick(at,back.hash,storage+' repeated click skips same owner rear surface');
 }
 // A nearer invisible polygon must not steal the displayed edge behind it.
 for(const instance of [false,true]){
  await clear();const front=await square(20),source=await call('scene.create',{type:'spline'}),data=await page.evaluate(()=>{const K=FrameSpline.K(),d=K.createSplineData(),q=K.addSplineSequence(d),a=K.addSplineVertex(d,[-40,-25,0]),b=K.addSplineVertex(d,[40,-25,0]);K.addSplineSegment(d,q,a,b);return d;});await call('spline.replace',{id:source.hash,data});
  const curve=instance?await call('scene.create',{type:'instance',params:{object:source.hash}}):source;if(instance)await call('scene.update',{id:source.hash,visible:false});const glass=await call('material.create',{name:'Curve cover glass',params:{opac:70}});await call('material.assign',{id:front.hash,material:glass.uid});
  await call('view.set',{index:2,single:true,mode:'object',shading:'solid',focus:front.hash});await call('scene.select',{ids:[]});const at=await project([-12,-25,0],curve.hash);await pick(at,front.hash,(instance?'curve instance':'spline')+' behind glass first selects cover');await pick(at,curve.hash,(instance?'curve instance':'spline')+' behind glass is reached on repeat');
 }
 for(const instance of [false,true]){
  await clear();const front=await square(20),source=await call('mesh.create',{vertices:[-20,-40,0,20,-40,0,20,40,0,-20,40,0],indices:[0,1,2,0,2,3]}),back=instance?await call('scene.create',{type:'instance',params:{object:source.hash}}):source;if(instance)await call('scene.update',{id:source.hash,visible:false});
  for(const shading of ['wireframe','isoparms']){await call('view.set',{index:2,single:true,mode:'object',shading,focus:front.hash});await call('scene.select',{ids:[]});await pick(await project([20,12,0],back.hash),back.hash,(instance?'instance':'mesh')+' '+shading+' rear line wins over nearer invisible fill',{mouse:true});}
 }
 for(const storage of ['auto','texture'])for(const instance of [false,true]){
  await clear();const source=await square(0,storage),owner=instance?await call('scene.create',{type:'instance',params:{object:source.hash}}):source;if(instance)await call('scene.update',{id:source.hash,visible:false});
  for(const index of [1,2,3])for(const shading of ['wireframe','isoparms']){
   // Rotate the authored XY square into the requested projection plane.
   await call('scene.select',{ids:[owner.hash]});await call('transform.set',{channel:'rotation',axis:0,value:index===1?90:0});await call('transform.set',{channel:'rotation',axis:1,value:index===3?90:0});
   await call('view.set',{index,single:true,mode:'object',shading,focus:owner.hash});await call('scene.select',{ids:[]});const at=await project([60,18,0],owner.hash),inside=await project([-24,18,0],owner.hash);
   const label=storage+' '+(instance?'instance':'mesh')+' view '+index+' '+shading;
   await pick(at,owner.hash,label+' selects displayed edge',{mouse:true});await call('scene.select',{ids:[]});await pick(inside,null,label+' ignores undrawn interior',{mouse:true});
  }
 }
 // Native generated cages and their instances have the same line/surface policy.
 for(const instance of [false,true]){
  await clear();const source=await call('scene.create',{type:'cube',params:{'size x':120,'size y':120,'size z':120}}),owner=instance?await call('scene.create',{type:'instance',params:{object:source.hash}}):source;if(instance)await call('scene.update',{id:source.hash,visible:false});
  await call('view.set',{index:2,single:true,mode:'object',shading:'solid',focus:owner.hash});await call('scene.select',{ids:[]});
  const bounds=(await call('scene.inspect')).objects.find(n=>n.hash===owner.hash).bounds,point=bounds.min.map((v,k)=>v+(bounds.max[k]-v)*[.67,.21,1][k]),edge=point.map((v,k)=>k===0?bounds.max[0]:v),inside=await project(point);
  await pick(inside,owner.hash,(instance?'instance':'primitive')+' solid surface');
  for(const shading of ['wireframe','isoparms']){await call('view.set',{shading});await call('scene.select',{ids:[]});await pick(await project(edge),owner.hash,(instance?'instance':'primitive')+' '+shading+' cage edge');await call('scene.select',{ids:[]});await pick(inside,null,(instance?'instance':'primitive')+' '+shading+' ignores invisible face');}
  const inner=await call('scene.create',{type:'cube',params:{'size x':60,'size y':60,'size z':60}}),outerCenter=bounds.center;await call('scene.select',{ids:[inner.hash]});for(let axis=0;axis<3;axis++)await call('transform.set',{channel:'position',axis,value:outerCenter[axis]-30});
  const glass=await call('material.create',{name:'Generator glass',params:{opac:65}});await call('material.assign',{id:source.hash,material:glass.uid});
  for(const index of [2,0]){await call('view.set',{index,shading:'solid',focus:owner.hash});await call('scene.select',{ids:[]});const center=await project(outerCenter);await pick(center,owner.hash,(instance?'instance':'primitive')+' view '+index+' transparent front');await pick([center[0]+2,center[1]+2],inner.hash,(instance?'instance':'primitive')+' view '+index+' reaches interior object');}
 }
 const gpu=await page.evaluate(async()=>({validation:(await frameEngine.renderer.device.popErrorScope())?.message||null,uncaptured:__objectPickGPU}));check('No GPU or browser errors',!gpu.validation&&!gpu.uncaptured.length&&!errors.length,{gpu,errors});
 const frames=await call('diagnostics.frame',{frames:4});result={pass:true,checks,timings,gpu,errors,frames,adapter};
}catch(error){const diagnostic=await page.evaluate(async()=>({dataset:{...document.querySelector('#frame-engine-canvas').dataset},gpu:(await frameEngine.renderer.device.popErrorScope())?.message,uncaptured:window.__objectPickGPU,wire:!!frameEngine.renderer.wireRaster?.pick,meshes:frameEngine.scene.meshes.map(m=>({hash:m.hashId,visible:m.frameVisible,edges:m.edgeCounts,wire:(m.parts||[m]).map(p=>({edges:p.wireRaster?.edges,frame:p.wireRaster?.frame===m.objectFrame}))}))})).catch(e=>({error:e.message}));result={pass:false,checks,timings,errors,error:error.stack,diagnostic};console.error(error.stack,JSON.stringify(diagnostic));}
finally{await session.close();}
result.indexSHA256=createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex');await mkdir(new URL('./results/',import.meta.url),{recursive:true});await writeFile(new URL('./results/object-click-selection.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify({pass:result.pass,checks:checks.length,error:result.error}));process.exitCode=result.pass?0:1;
