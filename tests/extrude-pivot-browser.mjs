import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../tools/browser.mjs';

export async function extrudePivotBrowserChecks(page){
 const checks=[],call=(name,args={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[name,args]);
 const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});assert.ok(pass,name+': '+JSON.stringify(detail));};
 const near=(a,b)=>a.length===b.length&&a.every((v,i)=>Math.abs(v-b[i])<1e-5);
 const inspect=async hash=>(await call('scene.inspect')).objects.find(n=>n.hash===hash);
 const localMin=hash=>page.evaluate(async h=>{const {vertices}=await frameEngine.readGeometry(h),min=[Infinity,Infinity,Infinity];for(let i=0;i<vertices.length;i++)min[i%3]=Math.min(min[i%3],vertices[i]);return min;},hash);
 try{
  await call('scene.new');await call('view.set',{index:2,single:true,mode:'object'});
  await page.locator('#btnExtrude').click();let owner=(await call('scene.inspect')).objects.find(n=>n.type==='extrude');
  check('Toolbar creates an empty Extrude at the origin',owner&&!owner.mesh&&near(owner.pivot.slice(9),[0,0,0]),owner);
  const spline=await call('scene.create',{type:'spline',parent:owner.hash});
  const data=await page.evaluate(()=>{const K=FrameSpline.K(),d=K.createSplineData(),q=K.addSplineSequence(d,true),v=[[10,20,0],[40,20,0],[40,60,0],[10,60,0]].map(p=>K.addSplineVertex(d,p));v.forEach((id,i)=>K.addSplineSegment(d,q,id,v[(i+1)%v.length]));return d;});
  const started=performance.now();await call('spline.replace',{id:spline.hash,data});owner=await inspect(owner.hash);
  check('First Extrude surface settles within 2500 ms',performance.now()-started<2500,{ms:performance.now()-started});
  check('Adding a profile sets the lower near left local corner',owner.mesh?.triangles>0&&near(owner.pivot.slice(9),[10,20,0]),owner.pivot);
  const square=await call('scene.create',{type:'square'});
  const colors=await page.evaluate(([s,q])=>[s,q].map(id=>getComputedStyle(document.querySelector(`[data-id="${id}"] .ob-name`)).getPropertyValue('--object-color').trim()),[spline.id,square.id]);
  check('Editable and parametric spline rows share cyan',colors.every(c=>c==='#7ebdd7'),colors);
  owner=await call('scene.update',{id:owner.hash,params:{offset:-15}});
  check('Negative Extrude uses the actual minimum depth',near(owner.pivot.slice(9),await localMin(owner.hash))&&near(owner.pivot.slice(9),[10,20,-15]),owner.pivot);
  await call('scene.select',{ids:[owner.hash]});
  const geometryBefore=await call('diagnostics.mesh',{id:owner.hash,geometry:true});
  await call('view.set',{pivot:true});await call('transform.set',{channel:'position',axis:0,value:17});await call('view.set',{pivot:false});
  owner=await inspect(owner.hash);const geometryAfter=await call('diagnostics.mesh',{id:owner.hash,geometry:true}),explicit=owner.pivot;
  check('Editing the corner pivot leaves geometry and world frame in place',geometryBefore.positionsSHA256===geometryAfter.positionsSHA256&&near(owner.worldMatrix.slice(12,15),[0,0,0]),{before:geometryBefore.positionsSHA256,after:geometryAfter.positionsSHA256,world:owner.worldMatrix});
  owner=await call('scene.update',{id:owner.hash,params:{offset:-25}});
  check('Parameter changes preserve an explicitly edited pivot',near(owner.pivot,explicit),owner.pivot);
  const saved=await call('scene.export',{includeData:true});await call('scene.open',{name:'extrude-pivot.hash',base64:saved.base64});owner=await inspect(owner.hash);
  check('HASH preserves the explicit Extrude pivot',near(owner.pivot,explicit),owner.pivot);
  const freshSpline=await call('scene.create',{type:'spline'});await call('spline.replace',{id:freshSpline.hash,data});
  const fresh=await call('scene.create',{type:'extrude',inputs:[freshSpline.hash],params:{offset:12}}),corner=fresh.pivot;
  check('API creation sets the local corner',near(corner.slice(9),await localMin(fresh.hash))&&near(corner.slice(9),[10,20,0]),corner);
  const editable=await call('scene.convert',{id:fresh.hash});
  check('Make Editable retains the default Extrude corner',editable.type==='spline_patch'&&near(editable.pivot,corner),editable.pivot);
  await call('edit.history',{action:'undo'});const undone=await inspect(fresh.hash);
  check('Undo restores Extrude with its corner',undone.type==='extrude'&&near(undone.pivot,corner),undone.pivot);
  await call('edit.history',{action:'redo'});const redone=await inspect(fresh.hash);
  check('Redo retains the editable corner',redone.type==='spline_patch'&&near(redone.pivot,corner),redone.pivot);
  await call('scene.new');return {pass:true,checks};
 }catch(error){return {pass:false,checks,error:error.stack};}
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const session=await launch({headless:true}),errors=[];
 try{
  await ready(session.page);session.page.on('pageerror',e=>errors.push(e.message));
  const adapter=await session.page.evaluate(()=>{const a=frameEngine.renderer.device.adapterInfo;return {description:a.description,isFallbackAdapter:a.isFallbackAdapter};});assert.equal(adapter.isFallbackAdapter,false);assert.ok(!/swiftshader|llvmpipe|software/i.test(adapter.description));
  await session.page.evaluate(()=>{window.__extrudePivotGPU=[];frameEngine.renderer.device.addEventListener('uncapturederror',e=>__extrudePivotGPU.push(e.error.message));frameEngine.renderer.device.pushErrorScope('validation');});
  const result=await extrudePivotBrowserChecks(session.page);result.adapter=adapter;result.errors=errors;result.gpu=await session.page.evaluate(async()=>({validation:(await frameEngine.renderer.device.popErrorScope())?.message||null,uncaptured:__extrudePivotGPU}));result.pass&&=!errors.length&&!result.gpu.validation&&!result.gpu.uncaptured.length;
  result.indexSHA256=createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex');await mkdir(new URL('./results/',import.meta.url),{recursive:true});await writeFile(new URL('./results/extrude-pivot-browser.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));process.exitCode=result.pass?0:1;
 }finally{await session.close();}
}
