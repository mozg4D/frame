import {ready} from '../../../tools/browser.mjs';
import {fileURLToPath} from 'node:url';
import {mkdir} from 'node:fs/promises';
// Each run owns its scene/browser context; no user or parent fixture is edited.
export async function pluginChecks(parent){
 const context=await parent.context().browser().newContext({viewport:{width:1280,height:900},serviceWorkers:'block'}),page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const checks=[],timings=[];
 const check=(name,pass,detail)=>{checks.push({name:'Cut: '+name,pass:!!pass,detail});if(!pass)throw Error(name+': '+JSON.stringify(detail));};
 const call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]);
 const timed=async(name,fn)=>{const t=performance.now(),value=await fn(),ms=performance.now()-t;timings.push({name,ms,limit:5000});check(name+' latency',ms<5000,{ms});return value;};
 const command=(id,operation)=>call('plugins.command',{id,operation});
 try{
  await page.goto(parent.url());await ready(page);
  const hardware=await page.evaluate(()=>{const d=frameEngine.renderer.device;window.__cutErrors=[];d.addEventListener('uncapturederror',e=>__cutErrors.push(e.error.message));d.pushErrorScope('validation');const h=d.adapterInfo;return h?Object.fromEntries(['vendor','architecture','device','description','isFallbackAdapter'].map(k=>[k,h[k]])):null;});
  check('real hardware WebGPU',hardware&&hardware.isFallbackAdapter===false&&!/swiftshader|llvmpipe|lavapipe|software/i.test(JSON.stringify(hardware)),hardware);
  await call('scene.new');await page.evaluate(()=>localStorage.removeItem('frame.cut.settings'));
  await page.locator('#tabPlugins').click();const icon=page.locator('[data-plugin="cut"] img');
  check('native 32px icon',await icon.evaluate(async e=>{await e.decode();const r=e.getBoundingClientRect();return e.naturalWidth===32&&e.naturalHeight===32&&r.width===32&&r.height===32;}));
  await timed('native icon create',()=>page.locator('[data-plugin="cut"]').click());
  const rows=async()=>(await call('scene.inspect')).objects;
  const a=(await rows()).find(n=>n.type==='cut'),id=a.hash;
  const s=await command(id,'status');check('explicit authoring status',s.authoringOnly&&!s.generationAvailable&&!s.resultAvailable&&s.job===null,s);
  check('native initial identity frame',a.matrix&&a.matrix.every((v,i)=>v===([1,0,0,0,1,0,0,0,1,0,0,0][i])),a);
  check('native origin pivot',JSON.stringify(a.pivot)===JSON.stringify([1,0,0,0,1,0,0,0,1,0,0,0]),a.pivot);
  await page.locator('#tabAttributes').click();
  check('Generate disabled',await page.locator('[data-plugin-action-button="generate"]').isDisabled());
  check('no Save or position',await page.locator('#attrContent').getByText('Save G-code',{exact:true}).count()===0&&await page.locator('[data-field="G-code position"]').count()===0);
  const text='G21\n; café 日本語\n\nM8\n';
  const input=page.locator('textarea[data-field="Start G-code"]');await input.fill(text);await input.blur();
  check('native multiline editing',(await rows()).find(n=>n.hash===id).params['Start G-code']===text);
  await call('edit.history',{action:'undo'});check('text Undo',(await rows()).find(n=>n.hash===id).params['Start G-code']==='');await call('edit.history',{action:'redo'});
  const field=await call('fields.read',{owner:id,field:'param:Tool on G-code'});
  await timed('native text CAS',()=>call('fields.write',{writes:[{owner:id,field:'param:Tool on G-code',value:text,epoch:field.epoch,revision:field.revision}]}));
  for(const params of [{Passes:1.2},{Passes:0},{Speed:0}]){const rejected=await page.evaluate(async({id,params})=>{try{await frameAI.call('scene.update',{id,params});return false;}catch{return true;}},{id,params});check('invalid parameter rejected',rejected,params);}
  await call('scene.update',{id,params:{Passes:3,Mode:'Mark',Speed:321}});
  await call('scene.select',{ids:[id]});const original=(await rows()).find(n=>n.hash===id);
  await timed('native Cut rotation',()=>call('transform.set',{channel:'rotation',axis:1,value:35,coordinates:'object'}));const rotated=(await rows()).find(n=>n.hash===id);check('rotation changes native frame',JSON.stringify(rotated.matrix)!==JSON.stringify(original.matrix));
  await call('edit.history',{action:'undo'});check('rotation Undo',JSON.stringify((await rows()).find(n=>n.hash===id).matrix)===JSON.stringify(original.matrix));await call('edit.history',{action:'redo'});
  const duplicate=await call('scene.duplicate',{ids:[id]});const copy=duplicate.objects.find(n=>n.type==='cut');check('duplicate retains independent settings',copy.hash!==id&&JSON.stringify(copy.params)===JSON.stringify(rotated.params));await call('scene.delete',{ids:[copy.hash]});
  const b=await call('plugins.create',{plugin:'cut'});const all=await rows(),second=all.find(n=>n.type==='cut'&&n.hash!==id);check('new owner inherits last applied settings',second.params.Speed===321&&second.params['Start G-code']===text,second);
  const explicit=await call('scene.create',{type:'cut',params:{Speed:456}});check('explicit create params override local defaults',(await rows()).find(n=>n.hash===explicit.hash).params.Speed===456);await call('scene.delete',{ids:[explicit.hash]});
  await call('scene.update',{id:second.hash,params:{Speed:654}});await call('scene.select',{ids:[id]});
  const cube=await call('scene.create',{type:'cube'});for(const kind of ['cut_avoid','cut_no_cut']){await call('tag.set',{ids:[cube.hash],kind,enabled:true});const tags=await call('tag.read',{ids:[cube.hash],kind});check('native '+kind+' tag',tags.objects[0].tags.length===1,tags);}
  await call('tag.set',{ids:[cube.hash],kind:'cut_avoid',enabled:false});
  await call('scene.select',{ids:[id]});const before=await rows(),saved=await timed('HASH export',()=>call('scene.export',{includeData:true}));await timed('HASH reopen',()=>call('scene.open',{name:'cut-authoring.hash',base64:saved.base64}));
  for(const n of before.filter(n=>n.type==='cut'))check('HASH exact strings/settings',JSON.stringify((await rows()).find(x=>x.hash===n.hash).params)===JSON.stringify(n.params));
  check('removed Avoid stays absent after HASH',(await call('tag.read',{ids:[cube.hash],kind:'cut_avoid'})).objects[0].tags.length===0);
  const inherited=await call('plugins.create',{plugin:'cut'});check('selected HASH Cut determines subsequent defaults',(await rows()).find(n=>n.hash===inherited.hash).params.Speed===321);await call('scene.delete',{ids:[inherited.hash]});
  for(const operation of ['generate','sources','result','save'])check(operation+' explicitly unavailable',await page.evaluate(async({id,operation})=>{try{await frameAI.call('plugins.command',{id,operation});return false;}catch(e){return e.code==='CUT_AUTHORING_ONLY';}},{id,operation}));
  check('cancel no phantom job',(await command(id,'cancel')).job===null);
  await call('scene.select',{ids:[id]});await call('transform.set',{channel:'rotation',axis:1,value:0,coordinates:'object'});
  for(const n of await rows())if(n.hash!==id)await call('scene.update',{id:n.hash,visible:false});
  await call('view.set',{index:1,single:true,focus:id});await call('diagnostics.frame',{frames:4});const frames=await call('diagnostics.frame',{frames:8});
  check('bounded native helper CPU/GPU frames',frames.timestampQueries===true&&frames.frames.every(f=>f.cpuMs<50&&f.gpuMs<50),frames);
  check('axis pipeline ready',(await command(id,'status')).viewport.ready);
  const projected=[];for(const point of [[0,0,0],[500,0,0],[0,0,500]])projected.push((await call('view.project',{id,point})).screen);
  check('Top local positive X right and Z up',projected[1][0]>projected[0][0]&&projected[2][1]<projected[0][1],projected);
  for(const [i,name] of [[1,'red X'],[2,'blue Z']]){const p=projected[i],points=[];for(let x=-2;x<=2;x++)for(let y=-2;y<=2;y++)points.push([p[0]+x,p[1]+y]);const colors=(await call('diagnostics.pixels',{points})).colors;check('actual '+name+' axis pixels',colors.some(c=>i===1?c[0]>c[1]*1.5&&c[0]>c[2]*1.5:c[2]>c[0]*1.5&&c[2]>c[1]*1.2),colors);}
  await mkdir(new URL('../../../tests/results/',import.meta.url),{recursive:true});await page.screenshot({path:fileURLToPath(new URL('../../../tests/results/cut-authoring.png',import.meta.url))});
  const gpu=await page.evaluate(async()=>{await frameEngine.renderer.device.queue.onSubmittedWorkDone();return {validation:(await frameEngine.renderer.device.popErrorScope())?.message||null,uncaptured:__cutErrors};});check('no GPU/page errors',!gpu.validation&&!gpu.uncaptured.length&&!errors.length,{gpu,errors});
  await call('scene.new');return {pass:true,checks,timings,evidence:{hardware,gpu,frames}};
 }catch(e){return {pass:false,checks,timings,error:e.stack};}finally{await context.close();}
}
