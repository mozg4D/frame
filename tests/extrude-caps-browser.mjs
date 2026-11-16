import {launch,ready} from '../tools/browser.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export async function extrudeCapsBrowserChecks(page){
 const checks=[],timings=[],call=(name,args={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[name,args]);
 const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});if(!pass)throw Error(name+': '+JSON.stringify(detail));};
 const state=async id=>(await call('scene.inspect')).objects.find(n=>n.hash===id);
 const caps=async(id,offset)=>{
  await call('diagnostics.mesh',{id,geometry:true});
  return page.evaluate(async({id,offset})=>{
   const {vertices,indices}=await frameEngine.readGeometry(id),edges=new Map();let start=0,end=0,walls=0;
   for(let i=0;i<indices.length;i+=3){const z=[0,1,2].map(j=>vertices[indices[i+j]*3+2]);if(z.every(v=>Math.abs(v)<1e-5))start++;else if(z.every(v=>Math.abs(v-offset)<1e-5))end++;else walls++;
    for(let j=0;j<3;j++){const a=indices[i+j],b=indices[i+(j+1)%3],key=Math.min(a,b)+':'+Math.max(a,b);edges.set(key,(edges.get(key)||0)+1);}}
   return {start,end,walls,boundary:[...edges.values()].filter(n=>n===1).length,nonManifold:[...edges.values()].some(n=>n>2)};
  },{id,offset});
 };
 try{
  await call('scene.new');await call('view.set',{single:true,index:2,mode:'object',shading:'solid-isoparms'});
  const profile=await call('scene.create',{type:'spline'}),data=await page.evaluate(()=>FrameSpline.K().primitive('square',{'side 1':40,'side 2':30}));
  await call('spline.replace',{id:profile.hash,data});
  const owner=await call('scene.create',{type:'extrude',inputs:[profile.hash],params:{offset:20}});
  check('New Extrude enables both caps',owner.params['start cap']===true&&owner.params['end cap']===true,owner.params);
  await call('scene.select',{ids:[owner.hash]});await page.locator('#tabAttributes').click();
  const buttons=page.locator('#attrContent [aria-label="Extrude caps"] button');
  check('Caps occupy one row with two independent buttons',await buttons.count()===2&&await buttons.nth(0).textContent()==='Start'&&await buttons.nth(1).textContent()==='End');
  await call('scene.update',{id:owner.hash,params:{'start fillet':2,'end fillet':2,'start fillet type':'round','end fillet type':'flat'}});
  const field=key=>page.locator('#attrContent [data-field="'+key+'"]');
  await field('start cap').click();let s=await state(owner.hash),geometry=await caps(owner.hash,20);
  check('Start click removes only its cap and Fillet controls',s.params['start cap']===false&&s.params['end cap']===true&&s.params['start fillet']===2&&await field('start fillet').count()===0&&await field('start fillet type').count()===0&&await field('end fillet').count()===1&&geometry.start===0&&geometry.end>0,{params:s.params,geometry});
  await field('end cap').click();s=await state(owner.hash);geometry=await caps(owner.hash,20);
  check('Both disabled caps ignore retained fillets and use direct walls',await field('end fillet').count()===0&&await field('end fillet type').count()===0&&s.params['end fillet']===2&&s.evaluation.report.backend==='planar-extrude'&&geometry.start===0&&geometry.end===0&&geometry.walls===8,{params:s.params,geometry});
  await call('edit.history',{action:'undo'});s=await state(owner.hash);
  check('Undo restores End cap and its Fillet row',s.params['end cap']===true&&await field('end fillet').count()===1&&await field('start fillet').count()===0,s.params);
  await call('edit.history',{action:'redo'});s=await state(owner.hash);
  check('Redo hides End Fillet again',s.params['end cap']===false&&await field('end fillet').count()===0,s.params);
  const saved=await call('scene.export',{includeData:true});await call('scene.open',{name:'extrude-caps.hash',base64:saved.base64});s=await state(owner.hash);geometry=await caps(owner.hash,20);
  check('Binary HASH preserves cap states and hidden Fillet values',s.params['start cap']===false&&s.params['end cap']===false&&s.params['start fillet']===2&&s.params['end fillet']===2&&geometry.start===0&&geometry.end===0,{params:s.params,geometry});
  await call('scene.select',{ids:[owner.hash]});await field('start cap').click();s=await state(owner.hash);
  check('Re-enabling Start restores its saved Fillet controls',s.params['start fillet']===2&&s.params['start fillet type']==='round'&&await field('start fillet').count()===1&&await field('start fillet type').count()===2,s.params);
  // Native builds, independent editable-cage resolution and negative offsets.
  for(const fillet of [0,2])for(const kind of fillet?['flat','round']:['flat'])for(const offset of [20,-20])for(const start of [true,false])for(const end of [true,false]){
   const params={offset,'start cap':start,'end cap':end,'start fillet':fillet,'end fillet':fillet,'start fillet type':kind,'end fillet type':kind},label=`${offset} ${kind} ${fillet} caps ${start}/${end}`,at=performance.now();
   await call('scene.update',{id:owner.hash,params});const before=await caps(owner.hash,offset),ms=performance.now()-at;timings.push({name:label,ms,budget:2500});
   check(label+' native caps and open boundaries',ms<2500&&(before.start>0)===start&&(before.end>0)===end&&before.walls>0&&!before.nonManifold&&(before.boundary===0)===(start&&end),before);
   await call('scene.convert',{id:owner.hash});const after=await caps(owner.hash,offset);
   check(label+' Make Editable preserves caps',JSON.stringify(after)===JSON.stringify(before),{before,after});
   await call('edit.history',{action:'undo'});
  }
  // A profile with a hole must retain the hole walls with either cap open.
  const hole=await page.evaluate(()=>{const K=FrameSpline.K(),outer=K.primitive('square',{'side 1':40,'side 2':30}),inner=K.primitive('square',{'side 1':10,'side 2':10});for(const p of Object.values(inner.vertices)){p[0]+=10;p[1]+=10;}return K.merge([outer,inner]);});
  await call('spline.replace',{id:profile.hash,data:hole});
  for(const start of [true,false])for(const end of [true,false]){
   await call('scene.update',{id:owner.hash,params:{offset:20,'start cap':start,'end cap':end,'start fillet':0,'end fillet':0}});const before=await caps(owner.hash,20);
   check('Hole walls survive caps '+start+'/'+end,(before.start>0)===start&&(before.end>0)===end&&before.walls===16&&!before.nonManifold,before);
   await call('scene.convert',{id:owner.hash});const after=await caps(owner.hash,20);
   check('Editable hole preserves caps '+start+'/'+end,JSON.stringify(after)===JSON.stringify(before),{before,after});await call('edit.history',{action:'undo'});
  }
  await call('scene.new');return {pass:true,checks,timings};
 }catch(error){return {pass:false,checks,timings,error:error.stack};}
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const session=await launch({headless:true}),errors=[];
 try{
  await ready(session.page);session.page.on('pageerror',e=>errors.push(e.stack));
  await session.page.evaluate(()=>{window.__capsGPU=[];frameEngine.renderer.device.addEventListener('uncapturederror',e=>__capsGPU.push(e.error.message));frameEngine.renderer.device.pushErrorScope('validation');});
  const result=await extrudeCapsBrowserChecks(session.page);result.errors=errors;result.gpu=await session.page.evaluate(async()=>({validation:(await frameEngine.renderer.device.popErrorScope())?.message||null,uncaptured:__capsGPU}));
  result.pass&&=!errors.length&&!result.gpu.validation&&!result.gpu.uncaptured.length;result.indexSHA256=createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex');
  await mkdir(new URL('results/',import.meta.url),{recursive:true});await writeFile(new URL('results/extrude-caps.json',import.meta.url),JSON.stringify(result,null,2));
  console.log(JSON.stringify({pass:result.pass,checks:result.checks.length,error:result.error,failed:result.checks.filter(c=>!c.pass),gpu:result.gpu,errors},null,2));process.exitCode=result.pass?0:1;
 }finally{await session.close();}
}
