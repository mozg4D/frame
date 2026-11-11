import {launch,ready} from '../tools/browser.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export async function sceneCreateNameBrowserChecks(page){
 const checks=[],timings=[],call=(name,args={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[name,args]);
 const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});if(!pass)throw Error(name+': '+JSON.stringify(detail));};
 const measure=async(name,fn,budget=2500)=>{const at=performance.now(),value=await fn(),ms=performance.now()-at;timings.push({name,ms,budget});check(name+' latency',ms<budget,{ms,budget});return value;};
 const inspect=()=>call('scene.inspect'),object=async hash=>(await inspect()).objects.find(n=>n.hash===hash);
 const unchangedState=()=>page.evaluate(async()=>{const s=await frameAI.call('scene.inspect');return {objects:s.objects,selection:s.selection,snapshot:snapshot(),history:{undo:[...undoStack],redo:[...redoStack],undoSequence:[...frameUIUndoSequence],redoSequence:[...frameUIRedoSequence]},document:{token:FrameAuthorData.documentToken,epoch:FrameAuthorData.epoch,generation:FrameAuthorData.generation,ready:FrameAuthorData.ready}};});
 const validHash=hash=>typeof hash==='string'&&/^[a-f0-9]{32}$/.test(hash);
 try{
  await call('render.stop');await call('scene.new');await call('view.set',{single:true,mode:'object'});
  const cases=[
   {type:'nut',params:{type:'high',size:'M10'},name:'Nut',auto:'high M10'},
   {type:'washer',params:{type:'DIN 9021',size:'M10'},name:'Washer',auto:'DIN 9021 M10'},
   {type:'bolt',params:{type:'DIN 912',size:'M10',length:40},name:'Bolt',auto:'DIN 912 M10*40'},
   {type:'tree',params:{type:'oak',detail:'low'},name:'Tree',auto:'Oak'}
  ];
  for(const c of cases){
   await call('scene.new');
   const n=await measure(c.type+' explicit label complete creation',()=>call('scene.create',{type:c.type,name:c.name,params:c.params}));
   check(c.type+' returns requested name and final parameters',n.name===c.name&&Object.entries(c.params).every(([k,v])=>n.params[k]===v),n);
   check(c.type+' has a completed native surface',!n.buildError&&n.mesh?.triangles>0,{buildError:n.buildError,mesh:n.mesh});
   check(c.type+' Object Browser displays the requested name',await page.locator('[data-id="'+n.id+'"] .ob-namebox').innerText()===c.name);
   await measure(c.type+' creation Undo',()=>call('edit.history',{action:'undo'}));check(c.type+' creation is one Undo',(await inspect()).objects.length===0);
   await measure(c.type+' creation Redo',()=>call('edit.history',{action:'redo'}));const redone=await object(n.hash);check(c.type+' Redo restores exact name and parameters',redone?.name===c.name&&Object.entries(c.params).every(([k,v])=>redone.params[k]===v));
   const saved=await measure(c.type+' named HASH save',()=>call('scene.export',{includeData:true}));await measure(c.type+' named HASH open',()=>call('scene.open',{name:'explicit-create-name.hash',base64:saved.base64}));
   const reopened=await object(n.hash);check(c.type+' HASH preserves exact name and parameters',reopened?.name===c.name&&Object.entries(c.params).every(([k,v])=>reopened.params[k]===v));
   const automatic=await measure(c.type+' omitted name complete creation',()=>call('scene.create',{type:c.type,params:c.params}));check(c.type+' omitted name follows final parameters',automatic.name===c.auto,automatic.name);
  }
  await call('scene.new');
  const nuts=[];for(let i=0;i<3;i++)nuts.push(await measure('Repeated named Nut '+i,()=>call('scene.create',{type:'nut',name:'Nut',params:{type:'high',size:'M10'}})));
  check('Repeated names remain exact and identify distinct native objects',nuts.every(n=>n.name==='Nut'&&validHash(n.hash))&&new Set(nuts.map(n=>n.hash)).size===3,nuts.map(({name,hash})=>({name,hash})));
  await measure('Named Nut parameter update',()=>call('scene.update',{id:nuts[0].hash,params:{size:'M12'}}));const updated=await object(nuts[0].hash);check('Parameter update reaches high M12 and retains explicit Nut name',updated.name==='Nut'&&updated.params.type==='high'&&updated.params.size==='M12',updated);
  await call('scene.select',{ids:[nuts[0].hash]});await page.locator('#tabAttributes').click();
  const size=page.locator('#attrContent [data-field="size"][data-cycle]');check('Native size control starts at M12',await size.innerText()==='M12');const historyBeforeSize=await page.evaluate(()=>undoStack.length);
  await measure('Named Nut native size edit',async()=>{await size.press('ArrowUp');await inspect();});const edited=await object(nuts[0].hash);check('Native ArrowUp reaches high M16 and retains explicit Nut name',edited.name==='Nut'&&edited.params.type==='high'&&edited.params.size==='M16'&&await size.innerText()==='M16',edited);
  check('Native size edit adds exactly one Undo record',await page.evaluate(()=>undoStack.length)===historyBeforeSize+1);
  await measure('Named Nut native size Undo',()=>call('edit.history',{action:'undo'}));const sizeUndone=await object(nuts[0].hash);check('One Undo restores high M12 and its exact explicit name',sizeUndone.name==='Nut'&&sizeUndone.params.type==='high'&&sizeUndone.params.size==='M12'&&await size.innerText()==='M12',sizeUndone);
  await measure('Named Nut native size Redo',()=>call('edit.history',{action:'redo'}));const sizeRedone=await object(nuts[0].hash);check('One Redo restores high M16 and its exact explicit name',sizeRedone.name==='Nut'&&sizeRedone.params.type==='high'&&sizeRedone.params.size==='M16'&&await size.innerText()==='M16',sizeRedone);
  const auto=await call('scene.create',{type:'nut',params:{type:'high',size:'M10'}});await call('scene.update',{id:auto.hash,params:{size:'M12'}});check('Automatic hardware name continues to follow size edits',(await object(auto.hash)).name==='high M12');
  for(const name of ['Custom Nut','', 'гайка 🔩']){
   const count=(await inspect()).objects.length,n=await measure('Exact custom name '+JSON.stringify(name),()=>call('scene.create',{type:'nut',name,params:{type:'high',size:'M10'}}));check('Exact custom name preserved '+JSON.stringify(name),n.name===name&&validHash(n.hash));
   await measure('Custom name creation Undo '+JSON.stringify(name),()=>call('edit.history',{action:'undo'}));const undone=await inspect();check('One Undo removes only the custom-named creation '+JSON.stringify(name),undone.objects.length===count&&!undone.objects.some(o=>o.hash===n.hash));
   await measure('Custom name creation Redo '+JSON.stringify(name),()=>call('edit.history',{action:'redo'}));const redone=await object(n.hash);check('Redo restores exact custom name and parameters '+JSON.stringify(name),redone?.name===name&&redone.params.type==='high'&&redone.params.size==='M10'&&(await inspect()).objects.length===count+1,redone);
   const saved=await measure('Custom name HASH save '+JSON.stringify(name),()=>call('scene.export',{includeData:true}));await measure('Custom name HASH open '+JSON.stringify(name),()=>call('scene.open',{name:'custom-create-name.hash',base64:saved.base64}));const reopened=await object(n.hash);check('HASH preserves exact custom name and parameters '+JSON.stringify(name),reopened?.name===name&&reopened.params.type==='high'&&reopened.params.size==='M10',reopened);
  }
  for(const args of [{type:'nut',name:7},{type:'nut',name:null},{type:'nut',name:'Nut',params:{type:'high',size:'M999'}}]){
   const before=await unchangedState(),result=await page.evaluate(async args=>{try{return {ok:true,result:await frameAI.call('scene.create',args)};}catch(e){return {ok:false,code:e.code,message:e.message,completed:e.completed};}},args),after=await unchangedState();
   check('Invalid name or parameters return exact rejection '+JSON.stringify(args),!result.ok&&result.code==='INVALID_ARGUMENT'&&!result.completed,result);
   check('Invalid name or parameters leave semantic objects, selection, history and document unchanged '+JSON.stringify(args),JSON.stringify(after)===JSON.stringify(before));
  }
  await call('scene.new');await page.locator('#tabObjects').click();check('Native Nut menu starts with an empty scene',(await inspect()).objects.length===0);await measure('Native Nut menu creation',async()=>{await page.locator('#objectsPanel [data-type="nut"]').click();await inspect();});const menuState=await inspect(),menuNut=menuState.objects[0];check('Native menu creates one completed default Nut',menuState.objects.length===1&&validHash(menuNut?.hash)&&menuNut.type==='nut'&&menuNut.name==='regular M6'&&menuNut.params.type==='regular'&&menuNut.params.size==='M6'&&!menuNut.buildError&&menuNut.mesh?.triangles>0,menuNut);
  await call('scene.new');return {pass:true,checks,timings};
 }catch(e){return {pass:false,checks,timings,error:e.stack};}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const s=await launch({headless:process.argv.includes('--headless')}),errors=[];
 try{
  await ready(s.page);s.page.on('pageerror',e=>errors.push(e.message));s.page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await s.page.evaluate(()=>{window.__nameGPU=[];frameEngine.renderer.device.addEventListener('uncapturederror',e=>__nameGPU.push(e.error.message));frameEngine.renderer.device.pushErrorScope('validation');});
  const r=await sceneCreateNameBrowserChecks(s.page);r.gpu=await s.page.evaluate(async()=>({adapter:(()=>{const a=frameEngine.renderer.device.adapterInfo;return a?{vendor:a.vendor,architecture:a.architecture,device:a.device,description:a.description}:null})(),validation:(await frameEngine.renderer.device.popErrorScope())?.message||null,uncaptured:__nameGPU}));r.errors=errors;r.pass&&=!errors.length&&!r.gpu.validation&&!r.gpu.uncaptured.length;r.indexSHA256=createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex');await mkdir(new URL('results/',import.meta.url),{recursive:true});await writeFile(new URL('results/scene-create-name-browser.json',import.meta.url),JSON.stringify(r,null,2));console.log(JSON.stringify(r,null,2));process.exitCode=r.pass?0:1;
 }finally{await s.close();}
}
