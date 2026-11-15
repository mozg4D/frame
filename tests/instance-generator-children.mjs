import {launch,ready} from '../tools/browser.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export async function instanceGeneratorChildrenChecks(page){
 const checks=[],timings=[],call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]);
 const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});if(!pass)throw Error(name+': '+JSON.stringify(detail));};
 const replicas=id=>call('diagnostics.replicas',{id}),sources=r=>r.copies.map(c=>c.source).sort();
 const expect=async(name,id,hashes)=>{const r=await replicas(id);check(name,r.visible===hashes.length&&r.count===hashes.length&&JSON.stringify(sources(r))===JSON.stringify([...hashes].sort()),r);return r;};
 const timed=async(name,fn)=>{const start=performance.now(),value=await fn(),ms=performance.now()-start;timings.push({name,ms,limit:5000});check(name+' completed-operation budget',ms<5000,{ms});return value;};
 try{
  await call('scene.new');await call('view.set',{index:2,single:true,mode:'object',shading:'solid-isoparms'});
  const profile=await call('scene.create',{type:'square'}),extrude=await call('scene.create',{type:'extrude',inputs:[profile.hash],params:{offset:20}});
  const group=await call('scene.create',{type:'group',parent:extrude.hash}),cube=await call('scene.create',{type:'cube',parent:group.hash});
  const mesh=await call('mesh.create',{vertices:[0,0,0,20,0,0,0,20,0],indices:[0,1,2]});await call('scene.update',{id:mesh.hash,parent:extrude.hash});
  const nestedProfile=await call('scene.create',{type:'circle'}),nested=await call('scene.create',{type:'extrude',inputs:[nestedProfile.hash],parent:extrude.hash,params:{offset:7}});
  const copy=await timed('Instance mixed Extrude hierarchy',()=>call('scene.create',{type:'instance',params:{object:extrude.hash}}));
  await expect('Extrude Instance retains independent solid, mesh and nested generator without consumed profiles',copy.hash,[extrude.hash,cube.hash,mesh.hash,nested.hash]);
  const outer=await call('scene.create',{type:'instance',params:{object:copy.hash}});await expect('Nested Instance retains the complete mixed hierarchy',outer.hash,[extrude.hash,cube.hash,mesh.hash,nested.hash]);
  await call('scene.update',{id:group.hash,visible:false});await expect('Hiding an Extrude child Group removes its descendants from Instance',outer.hash,[extrude.hash,mesh.hash,nested.hash]);
  await call('edit.history',{action:'undo'});await expect('Undo restores Extrude child occurrences',outer.hash,[extrude.hash,cube.hash,mesh.hash,nested.hash]);

  await call('scene.new');const patch=await call('scene.create',{type:'cube'});await call('scene.convert',{id:patch.hash});
  const a=await call('scene.create',{type:'cube',params:{'size x':10,'size y':12,'size z':14}}),b=await call('scene.create',{type:'cube',params:{'size x':10,'size y':12,'size z':14}});
  await call('scene.select',{ids:[b.hash]});await call('transform.set',{channel:'position',axis:0,value:30});
  const boolean=await call('scene.create',{type:'boolean',inputs:[a.hash,b.hash],parent:patch.hash,params:{op:'union'}});
  check('Boolean child publishes a healthy surface',!boolean.buildError&&boolean.mesh?.triangles>0,boolean);
  const patchCopy=await timed('Instance Patch with Boolean child',()=>call('scene.create',{type:'instance',params:{object:patch.hash}}));
  await expect('Patch Instance retains independent Boolean output without its operands or patch cage',patchCopy.hash,[patch.hash,boolean.hash]);
  const booleanCopy=await call('scene.create',{type:'instance',parent:patch.hash,params:{object:boolean.hash}});
  await expect('Patch leaves an independent Boolean Instance child visible',booleanCopy.hash,[boolean.hash]);
  await expect('Instance of Patch includes its independent Boolean Instance child',patchCopy.hash,[patch.hash,boolean.hash,boolean.hash]);
  await call('scene.delete',{ids:[booleanCopy.hash]});
  const hidden=await call('scene.create',{type:'group',parent:patch.hash}),hiddenChild=await call('scene.create',{type:'group',parent:hidden.hash});
  const hiddenMesh=await call('mesh.create',{vertices:[0,0,0,10,0,0,0,10,0],indices:[0,1,2],storage:'texture'});await call('scene.update',{id:hiddenMesh.hash,parent:hiddenChild.hash});
  await expect('Visible nested Group contributes its polygon child',patchCopy.hash,[patch.hash,boolean.hash,hiddenMesh.hash]);
  await timed('Hide Patch child Group',()=>call('scene.update',{id:hidden.hash,visible:false}));
  await expect('Hidden Patch Group excludes its entire descendant hierarchy',patchCopy.hash,[patch.hash,boolean.hash]);
  await call('edit.history',{action:'undo'});await expect('Undo restores hidden Group contents',patchCopy.hash,[patch.hash,boolean.hash,hiddenMesh.hash]);
  await call('edit.history',{action:'redo'});await expect('Redo hides Group contents again',patchCopy.hash,[patch.hash,boolean.hash]);
  await call('scene.update',{id:patch.hash,visible:false});await expect('Hiding the referenced root preserves the independent Instance and descendant visibility',patchCopy.hash,[patch.hash,boolean.hash]);
  const saved=await call('scene.export',{includeData:true});await timed('Reopen Instance descendant visibility',()=>call('scene.open',{name:'instance-generator-children.hash',base64:saved.base64}));
  await expect('HASH restores Boolean child and hidden Group policy',patchCopy.hash,[patch.hash,boolean.hash]);
  const frames=await call('diagnostics.frame',{frames:4});check('Native CPU and GPU frames remain within budget',frames.timestampQueries&&frames.frames.every(f=>f.cpuMs<35&&f.gpuMs>0&&f.gpuMs<80),frames);
  await call('scene.new');return {pass:true,checks,timings,frames};
 }catch(error){return {pass:false,checks,timings,error:error.stack};}
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const session=await launch({headless:process.argv.includes('--headless')}),errors=[];
 try{await ready(session.page);session.page.on('pageerror',e=>errors.push(e.stack));session.page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await session.page.evaluate(()=>{window.__instanceChildrenGPU=[];frameEngine.renderer.device.addEventListener('uncapturederror',e=>__instanceChildrenGPU.push(e.error.message));frameEngine.renderer.device.pushErrorScope('validation');});
  const result=await instanceGeneratorChildrenChecks(session.page);result.errors=errors;result.gpu=await session.page.evaluate(async()=>({validation:(await frameEngine.renderer.device.popErrorScope())?.message||null,uncaptured:__instanceChildrenGPU}));result.pass&&=!errors.length&&!result.gpu.validation&&!result.gpu.uncaptured.length;
  result.indexSHA256=createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex');await mkdir(new URL('results/',import.meta.url),{recursive:true});await writeFile(new URL('results/instance-generator-children.json',import.meta.url),JSON.stringify(result,null,2));
  console.log(JSON.stringify({pass:result.pass,checks:result.checks.length,timings:result.timings,failed:result.checks.filter(c=>!c.pass),error:result.error,gpu:result.gpu,errors},null,2));process.exitCode=result.pass?0:1;
 }finally{await session.close();}
}
