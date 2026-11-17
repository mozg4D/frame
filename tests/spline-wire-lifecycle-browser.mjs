import {launch,ready} from '../tools/browser.mjs';
import {gridCage} from './scenes/generate-zoo-10k.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export async function splineWireLifecycleChecks(page){
 const report={pass:false,checks:[],steps:[],invalidUploads:[]},call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]),check=(name,pass,detail)=>{report.checks.push({name,pass:!!pass,detail});if(!pass)throw Error(name+': '+JSON.stringify(detail));};
 const step=async(name,fn)=>{report.steps.push(name);await page.evaluate(name=>window.__wireLifecycleStep=name,name);console.log('[wire lifecycle] '+name);return fn();};
 try{
  await page.evaluate(()=>{
   window.__wireLifecycleInvalid=[];window.__wireLifecycleOriginalWrite=GPUQueue.prototype.writeBuffer;
   GPUQueue.prototype.writeBuffer=function(buffer,...args){
    if(!(buffer instanceof GPUBuffer)){
     const describes=d=>d?{hash:d.hash,wireVersion:d.wireVersion,wireToken:d.wireToken,lineFlags:d.lineFlags?{label:d.lineFlags.label,size:d.lineFlags.size}:null,lineStates:d.lineStates?.length,lineValues:d.lineValues?.length,wireTable:d.wireTable?.length,buffers:d.buffers?.map(b=>({label:b?.label,size:b?.size})).slice(0,24)}:null;
     const meshes=[];for(const mesh of frameEngine.scene.meshes)for(const [index,part]of (mesh.parts||[mesh]).entries())if(part.splineHighlightOffset&&!part.splineWireEdges)meshes.push({hash:mesh.hashId,replica:!!mesh.replicaMatrix,generated:mesh.splineGenerated,visible:mesh.frameVisible,part:index,offset:part.splineHighlightOffset,wireDisplay:mesh.wireDisplay,wireHighlightTable:!!mesh.wireHighlightTable,tableMatchesDisplay:mesh.wireHighlightTable===mesh.wireHighlightDisplay?.wireTable,display:describes(mesh.wireHighlightDisplay),buffers:mesh.buffers?.map(b=>({label:b?.label,size:b?.size})).slice(0,24)});
     __wireLifecycleInvalid.push({step:window.__wireLifecycleStep,offset:args[0],meshes:meshes.slice(0,20),offendingCount:meshes.length});
    }
    return __wireLifecycleOriginalWrite.call(this,buffer,...args);
   };
  });
  for(const type of ['instance','cloner']){
   await call('scene.new');await call('view.set',{index:2,single:true,mode:'object',shading:'solid-isoparms'});
   const source=await call('scene.create',{type:'spline',name:'Editable grid source'});await call('spline.replace',{id:source.hash,data:gridCage(2,2,20)});const patch=await call('scene.create',{type:'spline_patch',name:'Classified patch',inputs:[source.hash]});let generator;
   if(type==='instance')generator=await call('scene.create',{type,name:'Patch instance',params:{object:patch.hash}});
   else{const input=await call('scene.create',{type:'instance',name:'Cloner input Instance',params:{object:patch.hash}});generator=await call('scene.create',{type:'cloner',name:'Patch cloner',inputs:[input.hash],params:{type:'matrix','count x':3,'count y':1,'count z':1,'spacing x':70}});}
   await call('transform.apply',{ids:[generator.hash],position:[120,0,0]});report.owners??={};report.owners[type]={source:source.hash,patch:patch.hash,generator:generator.hash};await call('view.set',{focus:patch.hash});await call('diagnostics.frame',{frames:3});
   await step(type+': Convert into editable evaluated group',()=>call('scene.convert',{id:generator.hash}));
   await step(type+': Select original source cell after conversion',()=>call('scene.select',{ids:[source.hash],mode:'polygon',components:['cell:0']}));
   check(type+': original cell selection completes after conversion',true);
   await step(type+': Undo conversion',()=>call('edit.history',{action:'undo'}));
   await step(type+': Select original source cell after Undo',()=>call('scene.select',{ids:[source.hash],mode:'polygon',components:['cell:0']}));
   check(type+': original cell selection completes after conversion Undo',true);
   await step(type+': Redo conversion',()=>call('edit.history',{action:'redo'}));
   await step(type+': Select original source cell after Redo',()=>call('scene.select',{ids:[source.hash],mode:'polygon',components:['cell:0']}));
   check(type+': original cell selection completes after conversion Redo',true);await call('scene.select',{ids:[],mode:'object'});
   const objects=(await call('scene.inspect')).objects,descendants=new Set([generator.hash]);for(let previous=-1;previous!==descendants.size;){previous=descendants.size;for(const n of objects)if(descendants.has(n.parent))descendants.add(n.hash);}const baked=objects.filter(o=>descendants.has(o.hash)&&o.type==='mesh');check(type+': evaluated copies are editable polygon owners',baked.length===(type==='cloner'?3:1),objects.filter(n=>descendants.has(n.hash)).map(n=>({hash:n.hash,parent:n.parent,type:n.type})));
   const derived=await page.evaluate(hashes=>frameEngine.scene.meshes.filter(m=>hashes.includes(m.hashId)).map(m=>({hash:m.hashId,wireDisplay:m.wireDisplay,wireHighlightDisplay:!!m.wireHighlightDisplay,wireHighlightTable:!!m.wireHighlightTable,active:!!m.splineHighlightActive,parts:(m.parts||[m]).map(p=>({offset:p.splineHighlightOffset||0,wireBuffer:!!p.splineWireEdges}))})),baked.map(n=>n.hash));check(type+': baked owners retain no source wire-highlight metadata',derived.every(m=>!m.wireDisplay&&!m.wireHighlightDisplay&&!m.wireHighlightTable&&!m.active&&m.parts.every(p=>!p.offset&&!p.wireBuffer)),derived);
   const digest=async id=>(await call('diagnostics.mesh',{id,geometry:true})).positionsSHA256,originalDigest=await digest(patch.hash),bakedBefore=new Map();for(const n of baked)bakedBefore.set(n.hash,await digest(n.hash));
   const first=baked[0];await call('view.set',{index:2,single:true,mode:'vertex',shading:'solid-isoparms',focus:first.hash});await call('scene.select',{ids:[first.hash],mode:'vertex',components:[]});const boundsProjection=await call('view.project',{point:first.bounds.center}),localProjection=await call('view.project',{id:first.hash,point:[20,20,0]}),center=boundsProjection.screen;report.connectedInputs??={};report.connectedInputs[type]={first,selection:(await call('scene.inspect')).selection,boundsProjection,localProjection,native:await page.evaluate(hash=>{const m=frameEngine.scene.meshes.find(m=>m.hashId===hash);return {editingHash:FrameSpline.editingHash,frameWorld:Array.from(m.frameWorld),boundsMin:m.boundsMin,boundsMax:m.boundsMax};},first.hash)};
   await step(type+': Select connected component on baked copy',()=>call('selection.pick',{x:center[0],y:center[1],connected:true}));const selected=await call('scene.inspect');report.checks.push({name:type+': connected selection stays on the chosen copy',pass:selected.selection.objects.length===1&&selected.selection.objects.includes(first.hash)&&selected.selection.counts.reduce((a,b)=>a+b,0)===first.mesh.vertices,detail:{selection:selected.selection,expected:first.mesh.vertices}});
   await call('scene.select',{ids:[first.hash],mode:'vertex',components:[0]});await step(type+': Edit one copied vertex',()=>call('transform.set',{channel:'position',axis:0,value:first.bounds.min[0]-.5,coordinates:'world'}));check(type+': copied geometry changes independently',await digest(first.hash)!==bakedBefore.get(first.hash));check(type+': copied edit preserves source geometry',await digest(patch.hash)===originalDigest);for(const n of baked.slice(1))check(type+': copied edit preserves other occurrence '+n.hash,await digest(n.hash)===bakedBefore.get(n.hash));await call('edit.history',{action:'undo'});check(type+': copied edit Undo restores exact copy',await digest(first.hash)===bakedBefore.get(first.hash));
   await call('scene.select',{ids:[source.hash],mode:'vertex',components:['v0']});await step(type+': Edit original source control',()=>call('transform.set',{channel:'position',axis:0,value:-.5,coordinates:'object'}));check(type+': source control edit rebuilds its own geometry',await digest(patch.hash)!==originalDigest);for(const n of baked)check(type+': source edit preserves independent baked copy '+n.hash,await digest(n.hash)===bakedBefore.get(n.hash));await call('edit.history',{action:'undo'});check(type+': source edit Undo restores exact source',await digest(patch.hash)===originalDigest);
   await call('scene.select',{ids:[source.hash],mode:'polygon',components:['cell:0']});await call('scene.select',{ids:[],mode:'object'});await call('diagnostics.frame',{frames:3});
  }
  check('No wire-highlight upload addresses missing native buffers',(await page.evaluate(()=>__wireLifecycleInvalid)).length===0);
  report.pass=report.checks.every(c=>c.pass);
 }catch(error){report.error=error.stack;}
 finally{report.invalidUploads=await page.evaluate(()=>{GPUQueue.prototype.writeBuffer=__wireLifecycleOriginalWrite;return __wireLifecycleInvalid;}).catch(()=>[]);}
 return report;
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const option=(name,fallback)=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3)??fallback,label=option('label','latest'),sourcePath=resolve(option('source',fileURLToPath(new URL('../index.html',import.meta.url)))),source=await readFile(sourcePath),app=await launch({headless:true}),errors=[];
 try{await app.page.route('**/index.html',r=>r.fulfill({body:source,contentType:'text/html; charset=utf-8'}));await app.page.reload();await ready(app.page);app.page.on('pageerror',e=>errors.push(e.stack));await app.page.evaluate(()=>{window.__wireLifecycleGPU=[];frameEngine.renderer.device.addEventListener('uncapturederror',e=>__wireLifecycleGPU.push(e.error.message));frameEngine.renderer.device.pushErrorScope('validation');});const report=await splineWireLifecycleChecks(app.page);report.gpu=await app.page.evaluate(async()=>({validation:(await frameEngine.renderer.device.popErrorScope())?.message||null,uncaptured:__wireLifecycleGPU}));report.errors=errors;report.pass&&=!errors.length&&!report.gpu.validation&&!report.gpu.uncaptured.length;report.sourceSHA256=createHash('sha256').update(source).digest('hex');await mkdir(new URL('./results/',import.meta.url),{recursive:true});await writeFile(new URL('./results/spline-wire-lifecycle-'+label+'.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));process.exitCode=report.pass?0:1;}finally{await app.close();}
}
