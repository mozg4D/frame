import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../tools/browser.mjs';

export async function symmetrySelectionChecks(page){
 const checks=[],timings=[],call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]);
 const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});assert.ok(pass,name+': '+JSON.stringify(detail));console.log('PASS '+name);};
 const measure=async(name,fn)=>{const at=performance.now(),result=await fn(),ms=performance.now()-at;timings.push({name,ms,budgetMs:1500});check(name+' completes within 1500 ms',ms<1500,{ms});return result;};
 const inspect=()=>call('scene.inspect'),project=async point=>(await call('view.project',{point})).screen;
 const pick=async(point,hash,name,{clear=true}={})=>{if(clear)await call('scene.select',{ids:[]});await measure(name,async()=>{await page.mouse.click(...await project(point));await inspect();});const s=(await inspect()).selection;check(name+' selects authored owner',s.objects.length===(hash?1:0)&&(!hash||s.objects[0]===hash&&s.nativeObjects[0]===hash),s);};
 const mesh=async(storage='auto',z=0)=>call('mesh.create',{vertices:[-12,-10,z,12,-10,z,12,10,z,-12,10,z],indices:[0,1,2,0,2,3],storage});
 const place=(id,position)=>call('transform.apply',{ids:[id],position});
 const sym=inputs=>call('scene.create',{type:'symmetry',inputs,params:{X:true,Y:false,Z:false}});
 const view=hash=>call('view.set',{index:2,single:true,mode:'object',shading:'solid',focus:hash});
 const world=(s,hash)=>s.objects.find(n=>n.hash===hash).worldMatrix;
 try{
  const adapter=await page.evaluate(()=>{const a=frameEngine.renderer.device.adapterInfo;return {vendor:a.vendor,architecture:a.architecture,isFallbackAdapter:a.isFallbackAdapter,dpr:devicePixelRatio};});
  check('Hardware WebGPU at requested DPR',adapter.isFallbackAdapter===false&&!/software|swiftshader|llvmpipe/i.test(JSON.stringify(adapter))&&adapter.dpr===Number(process.env.FRAME_DPR||1),adapter);
  for(const storage of ['auto','texture']){
   await call('scene.new');const source=await mesh(storage),sibling=await mesh(storage);await place(source.hash,[70,0,0]);await place(sibling.hash,[70,40,0]);const group=await call('scene.group',{ids:[source.hash,sibling.hash]}),owner=await sym([group.hash]);await view(owner.hash);
   await pick([73,-5,0],source.hash,storage+' original mesh');await pick([-73,-5,0],source.hash,storage+' reflected mesh');
   const before=await inspect(),copiesBefore=await call('diagnostics.replicas',{id:owner.hash});
   await page.evaluate(hash=>{const m=frameEngine.scene.meshes.find(m=>m.hashId===hash&&!m.replicaMatrix);window.__symmetrySource={hash,positions:m.positions,indices:m.indices};},source.hash);
   const handle=await page.evaluate(()=>frameEngine.gizmoState?.handles.find(h=>h.part==='move0')?.suggested);check(storage+' source gizmo available after viewport pick',!!handle,handle);
   await measure(storage+' native source drag',async()=>{await page.mouse.move(...handle);await page.mouse.down();await page.mouse.move(handle[0]+30,handle[1],{steps:4});await page.mouse.up();await inspect();});
   const after=await inspect(),copiesAfter=await call('diagnostics.replicas',{id:owner.hash}),x=world(after,source.hash)[12];
   check(storage+' drag moves only source within Symmetry',x>world(before,source.hash)[12]&&JSON.stringify(world(before,sibling.hash))===JSON.stringify(world(after,sibling.hash))&&JSON.stringify(world(before,owner.hash))===JSON.stringify(world(after,owner.hash)),{before:world(before,source.hash),after:world(after,source.hash)});
   check(storage+' original and reflection follow source motion',copiesAfter.copies.filter(c=>c.source===source.hash).every(c=>Math.abs(c.worldMatrix[12]-(c.worldMatrix[0]<0?-x:x))<1e-9)&&copiesAfter.count===copiesBefore.count,copiesAfter);
   check(storage+' drag preserves shared canonical GPU geometry',await page.evaluate(()=>{const s=__symmetrySource,m=frameEngine.scene.meshes.find(m=>m.hashId===s.hash&&!m.replicaMatrix);delete window.__symmetrySource;return m.positions===s.positions&&m.indices===s.indices&&frameEngine.scene.meshes.filter(c=>c.replicaSource===m).every(c=>c.positions===m.positions&&c.indices===m.indices);}));
   await call('edit.history',{action:'undo'});check(storage+' source drag Undo',JSON.stringify(world(await inspect(),source.hash))===JSON.stringify(world(before,source.hash)));
   await call('edit.history',{action:'redo'});check(storage+' source drag Redo',JSON.stringify(world(await inspect(),source.hash))===JSON.stringify(world(after,source.hash)));
   const saved=await call('scene.export',{includeData:true});await measure(storage+' Symmetry HASH reopen',()=>call('scene.open',{base64:saved.base64,name:'symmetry-selection.hash'}));await view(owner.hash);await pick([-x-3,-5,0],source.hash,storage+' reflected mesh after HASH');
   const row=(await inspect()).objects.find(n=>n.hash===owner.hash).id;await page.locator('#row-'+row+' .ob-name').click();await inspect();check(storage+' tree still selects whole Symmetry',(await inspect()).selection.objects[0]===owner.hash);
   await call('scene.update',{id:owner.hash,enabled:false});await pick([x+3,-5,0],source.hash,storage+' disabled Symmetry exposes source');await pick([-x-3,-5,0],null,storage+' disabled Symmetry removes reflection');
  }
  await call('scene.new');const cube=await call('scene.create',{type:'cube',params:{'size x':30,'size y':25,'size z':20}});await place(cube.hash,[70,0,0]);const cubeSym=await sym([cube.hash]);await view(cubeSym.hash);
  for(const shading of ['solid','solid-wire','solid-isoparms','wireframe','isoparms']){await call('view.set',{shading});const x=['wireframe','isoparms'].includes(shading)?100:82;for(const sign of [1,-1])await pick([sign*x,10,20],cube.hash,shading+' primitive '+(sign>0?'original':'reflection'));}
  const frames=await call('diagnostics.frame',{frames:5});check('Symmetry CPU/GPU frame budgets',frames.timestampQueries&&frames.frames.every(f=>f.cpuMs<50&&f.gpuMs<50),frames.frames);
  await call('scene.new');await call('view.set',{index:2,single:true,mode:'object'});const curve=await call('scene.create',{type:'spline'}),data=await page.evaluate(()=>{const K=FrameSpline.K(),d=K.createSplineData(),q=K.addSplineSequence(d),a=K.addSplineVertex(d,[55,-20,0]),b=K.addSplineVertex(d,[90,-20,0]);K.addSplineSegment(d,q,a,b);return d;});await call('spline.replace',{id:curve.hash,data});const curveSym=await sym([curve.hash]);await view(curveSym.hash);
  for(const shading of ['solid','wireframe','isoparms']){await call('view.set',{shading});for(const sign of [1,-1])await pick([sign*75,-20,0],curve.hash,shading+' spline '+(sign>0?'original':'reflection'));}
  await call('scene.new');const nestedSource=await mesh();await place(nestedSource.hash,[70,35,0]);const inner=await call('scene.create',{type:'symmetry',inputs:[nestedSource.hash],params:{X:false,Y:true,Z:false}}),outer=await sym([inner.hash]);await view(outer.hash);await pick([-73,-40,0],nestedSource.hash,'Nested XY reflection');
  await call('scene.new');const reference=await mesh();await call('scene.update',{id:reference.hash,visible:false});const instance=await call('scene.create',{type:'instance',params:{object:reference.hash}});await place(instance.hash,[70,0,0]);const instanceSym=await sym([instance.hash]);await view(instanceSym.hash);await pick([-73,-5,0],instance.hash,'Symmetry preserves Instance owner');
  await call('scene.new');const cloned=await mesh(),cloner=await call('scene.create',{type:'cloner',inputs:[cloned.hash],params:{type:'matrix','count x':1,'count y':1,'count z':1}});await place(cloner.hash,[70,0,0]);const clonerSym=await sym([cloner.hash]);await view(clonerSym.hash);await pick([-73,-5,0],cloner.hash,'Symmetry preserves Cloner owner');
  await call('scene.new');const back=await mesh(),front=await mesh();await place(back.hash,[70,0,0]);await place(front.hash,[70,0,20]);const glass=await call('material.create',{name:'Glass',params:{opac:70}});await call('material.assign',{id:front.hash,material:glass.uid});const transparentSym=await sym([back.hash,front.hash]);await view(transparentSym.hash);
  await pick([-73,-5,20],front.hash,'Reflected transparent front');await pick([-73,-5,20],back.hash,'Repeat reaches separate child behind glass',{clear:false});await pick([-73,-5,20],front.hash,'Reflected transparent stack wraps',{clear:false});
  await call('scene.new');return {pass:true,checks,timings,frames,adapter};
 }catch(error){return {pass:false,checks,timings,error:error.stack};}
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const session=await launch({headless:true}),report={pass:false,errors:[]},source=()=>readFile(new URL('../index.html',import.meta.url));report.indexSHA256=createHash('sha256').update(await source()).digest('hex');
 try{session.page.on('pageerror',e=>report.errors.push(e.stack));await ready(session.page);await session.page.evaluate(()=>{window.__symmetryGPU=[];const d=frameEngine.renderer.device;d.addEventListener('uncapturederror',e=>__symmetryGPU.push(e.error.message));d.pushErrorScope('validation');});Object.assign(report,await symmetrySelectionChecks(session.page));report.gpu=await session.page.evaluate(async()=>({validation:(await frameEngine.renderer.device.popErrorScope())?.message||null,uncaptured:__symmetryGPU}));report.pass&&=!report.errors.length&&!report.gpu.validation&&!report.gpu.uncaptured.length&&report.indexSHA256===createHash('sha256').update(await source()).digest('hex');}catch(error){report.error=error.stack;report.pass=false;}finally{await session.close();await mkdir(new URL('results/',import.meta.url),{recursive:true});await writeFile(new URL('results/symmetry-selection.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,checks:report.checks?.length,error:report.error,gpu:report.gpu}));process.exitCode=report.pass?0:1;}
}
