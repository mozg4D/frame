import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {launch,ready} from '../tools/browser.mjs';

const session=await launch({headless:true}),{page}=session,checks=[],timings=[],errors=[];
const call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]);
const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});assert.ok(pass,name+': '+JSON.stringify(detail));console.log('PASS '+name);};
const timed=async(name,fn,limit=1500)=>{const start=performance.now(),result=await fn(),ms=performance.now()-start;timings.push({name,ms,limit});check(name+' latency',ms<limit,{ms,limit});return result;};
const inspect=()=>call('scene.inspect'),project=async point=>(await call('view.project',{point})).screen;
const pick=async(id,point,name)=>{await call('scene.select',{ids:[]});const at=await project(point);await timed(name,async()=>{await page.mouse.click(...at);const s=await inspect();check(name,s.selection.objects.length===1&&s.selection.objects[0]===id,s.selection);});};
let report;
try{
 await ready(page);page.on('pageerror',e=>errors.push(e.stack));
 const adapter=await page.evaluate(()=>{const a=frameEngine.renderer.device.adapterInfo;return {vendor:a.vendor,description:a.description,isFallbackAdapter:a.isFallbackAdapter};});
 check('Native hardware WebGPU at DPR 1',adapter.isFallbackAdapter===false&&!/swiftshader|software|llvmpipe/i.test(JSON.stringify(adapter))&&await page.evaluate(()=>devicePixelRatio===1),adapter);
 await page.evaluate(()=>{window.__rodGPU=[];frameEngine.renderer.device.addEventListener('uncapturederror',e=>__rodGPU.push(e.error.message));frameEngine.renderer.device.pushErrorScope('validation');});
 const fixture=await readFile(new URL('./scenes/meltus8-rod.hash',import.meta.url));
 const opened=await timed('Open supplied meltus8',()=>call('scene.open',{base64:fixture.toString('base64'),name:'meltus8.hash'}),5000);
 const nema=opened.objects.find(o=>o.name==='NEMA23'),rod=opened.objects.find(o=>o.name==='M10 Rod'),bolts=opened.objects.filter(o=>o.parent===nema.hash&&o.type==='instance'&&o.name.startsWith('M5 Bolt')),cage=opened.objects.find(o=>o.name==='pN23');
 check('Patch evaluates only its actual cage',nema.sources.length===1&&nema.sources[0]===cage.hash&&nema.mesh.triangles===1532,{sources:nema.sources,triangles:nema.mesh.triangles});
 check('HASH preserves authored hidden rod and group',!rod.visible&&!opened.objects.find(o=>o.hash===nema.parent).visible);
 // The saved file hides Old internals and the rod; expose them and hide the enclosing panels for direct surface clicks.
 for(const root of opened.objects.filter(o=>!o.parent))await call('scene.update',{id:root.hash,visible:root.hash===nema.parent});
 for(const copy of opened.objects.filter(o=>o.type==='instance'&&o.params.object===nema.hash))await call('scene.update',{id:copy.hash,visible:false});
 await call('view.set',{index:2,single:true,mode:'object',shading:'solid',focus:rod.hash,snap:false,quantize:false});
 await call('scene.select',{ids:[]});const hiddenAt=await project([52,1000,98]);await page.mouse.click(...hiddenAt);check('Hidden child leaves no parent-owned rod surface',!(await inspect()).selection.objects.length);
 await call('scene.update',{id:rod.hash,visible:true});
 await pick(rod.hash,[52,1000,98],'Native click selects rod');
 await call('scene.select',{ids:[]});await call('diagnostics.frame',{frames:2});
 const pixel=(await call('diagnostics.pixels',{points:[await project([52,1000,98])]})).colors[0];
 check('Rod renders its reddish material',pixel[0]>pixel[1]+6&&pixel[0]>pixel[2]+6,{pixel});
 for(const bolt of bolts){await call('view.set',{focus:bolt.hash});await pick(bolt.hash,[bolt.bounds.center[0]+2,bolt.bounds.center[1],bolt.bounds.max[2]],'Native click selects '+bolt.name);}
 const bindings=await page.evaluate(ids=>frameEngine.scene.meshes.filter(m=>ids.includes(m.hashId)).map(m=>({id:m.hashId,tags:m.materialTags})),[rod.hash,...bolts.map(b=>b.hash)]);
 const library=await page.evaluate(()=>frameMaterialState().library.map(m=>({name:m.name,uid:m.uid}))),black=library.find(m=>m.name==='Black').uid,red=library.find(m=>m.name==='Rod').uid;
 check('Child occurrences retain source material ahead of parent inheritance',bindings.length===4&&bindings.every(m=>m.tags.some(t=>t.materialUID===(m.id===rod.hash?red:black))),bindings);
 await call('material.assign',{id:bolts[0].hash,material:red});const override=await page.evaluate(h=>frameEngine.scene.meshes.find(m=>m.hashId===h).materialTags,bolts[0].hash);check('Explicit Instance material still overrides its source',override.length===1&&override[0].materialUID===red,override);await call('edit.history',{action:'undo'});
 await call('scene.select',{ids:[rod.hash]});await call('view.set',{index:2,focus:rod.hash});await call('diagnostics.frame',{frames:2});
 await page.evaluate(()=>{window.__rodBefore=frameEngine.scene.meshes.filter(m=>!m.replicaSource).map(m=>({m,positions:m.positions,indices:m.indices}));window.__rodBuilds=[];const install=frameEngine.installSplineSurface;frameEngine.installSplineSurface=function(n,...args){__rodBuilds.push(n.nativeHash);return install.call(this,n,...args);};});
 const before=(await inspect()).objects.find(o=>o.hash===rod.hash),at=await page.evaluate(()=>frameEngine.gizmoState.handles.find(h=>h.part==='move0').suggested),frames=[];
 await timed('Native rod drag and completed evaluation',async()=>{await page.mouse.move(...at);await page.mouse.down();for(let i=1;i<=8;i++){await page.mouse.move(at[0]+i*6,at[1]);frames.push(await call('diagnostics.frame',{frames:1}));}await page.mouse.up();await page.waitForFunction(()=>!frameEngine.transforming);await inspect();},2500);
 const moved=(await inspect()).objects.find(o=>o.hash===rod.hash),work=await page.evaluate(()=>({builds:__rodBuilds,shared:__rodBefore.every(({m,positions,indices})=>frameEngine.scene.meshes.includes(m)&&m.positions===positions&&m.indices===indices)}));
 check('Rod drag changes only affine placement and reuses surface buffers',Math.abs(moved.worldMatrix[12]-before.worldMatrix[12])>1&&work.shared&&!work.builds.length,{work,before:before.worldMatrix.slice(12,15),after:moved.worldMatrix.slice(12,15)});
 check('Native drag CPU and GPU frames stay bounded',frames.every(s=>s.timestampQueries&&s.frames.every(f=>f.cpuMs<35&&f.gpuMs>0&&f.gpuMs<80)),frames);
 await call('edit.history',{action:'undo'});check('Undo restores rod placement',JSON.stringify((await inspect()).objects.find(o=>o.hash===rod.hash).matrix)===JSON.stringify(before.matrix));
 await call('edit.history',{action:'redo'});check('Redo restores moved rod',JSON.stringify((await inspect()).objects.find(o=>o.hash===rod.hash).matrix)===JSON.stringify(moved.matrix));
 const saved=await call('scene.export',{includeData:true}),restored=await timed('Reopen corrected hierarchy',()=>call('scene.open',{base64:saved.base64,name:'rod-roundtrip.hash'}),5000);
 check('HASH retains child material and placement',JSON.stringify(restored.objects.find(o=>o.hash===rod.hash).matrix)===JSON.stringify(moved.matrix)&&restored.objects.find(o=>o.hash===rod.hash).tags.some(t=>t.materialUID===red));
 await call('view.set',{index:2,single:true,mode:'object',shading:'solid',focus:rod.hash});await pick(rod.hash,moved.bounds.center,'Rod remains independently pickable after HASH');
 await call('scene.convert',{id:nema.hash});const converted=await inspect();check('Baking Patch preserves independent children',converted.objects.find(o=>o.hash===nema.hash).type==='mesh'&&[rod.hash,...bolts.map(b=>b.hash)].every(h=>converted.objects.find(o=>o.hash===h)?.parent===nema.hash)&&!converted.objects.some(o=>o.hash===cage.hash));
 const gpu=await page.evaluate(async()=>({validation:(await frameEngine.renderer.device.popErrorScope())?.message||null,uncaptured:__rodGPU}));check('No GPU or browser errors',!gpu.validation&&!gpu.uncaptured.length&&!errors.length,{gpu,errors});
 report={pass:true,checks,timings,frames,adapter,gpu,errors,fixtureSHA256:createHash('sha256').update(fixture).digest('hex')};
}catch(error){report={pass:false,checks,timings,errors,error:error.stack};console.error(error.stack);}
finally{await session.close();}
report.indexSHA256=createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex');await mkdir(new URL('./results/',import.meta.url),{recursive:true});await writeFile(new URL('./results/meltus8-rod.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,checks:checks.length,timings,error:report.error}));process.exitCode=report.pass?0:1;
