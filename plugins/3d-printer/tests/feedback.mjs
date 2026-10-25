import {box} from './slicer.mjs';
import {launch,ready} from '../../../tools/browser.mjs';
import {fileURLToPath} from 'node:url';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

export async function printerFeedbackChecks(page){
 const checks=[],timings=[],call=(n,a={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[n,a]);
 const check=(name,pass,detail)=>{checks.push({name:'Printer feedback: '+name,pass:!!pass,detail});if(!pass)throw Error(name+': '+JSON.stringify(detail));};
 const clear=async()=>{await call('render.stop');const s=await call('scene.inspect');if(s.objects.length)await call('scene.delete',{ids:s.objects.filter(n=>!n.parent).map(n=>n.hash)});await call('view.set',{mode:'object',coordinates:'world',pivot:false,snap:false,quantize:false});};
 const project=async(id,point)=>(await call('view.project',{...(id?{id}:{}),point})).screen;
 const pixels=async(id,p)=>{const q=await project(id,p);return(await call('diagnostics.pixels',{points:[q,...[[1,0],[-1,0],[0,1],[0,-1]].map(d=>q.map((v,k)=>v+d[k]))]})).colors;};
 const red=c=>c[0]>200&&c[1]<60&&c[2]<60,green=c=>c[0]>65&&c[0]<105&&c[1]>170&&c[2]>120&&c[2]<180,blue=c=>c[2]>150&&c[2]>c[0]*1.5&&c[2]>c[1]*1.2;
 const command=(id,operation,args={})=>call('plugins.command',{id,operation,args});
 const wait=async(id,predicate=s=>s.state!=='running')=>{const started=performance.now();while(performance.now()-started<5000){const s=await command(id,'status');if(predicate(s))return s;await page.waitForTimeout(10);}throw Error('Printer did not settle: '+JSON.stringify(await command(id,'status')));};
 const measure=async(name,limit,fn)=>{const t=performance.now(),r=await fn(),ms=performance.now()-t;timings.push({name,ms,limit});check(name+' latency',ms<limit,{ms,limit});return r;};
 try{
  await clear();const printer=await call('plugins.create',{plugin:'3d-printer'});
  await call('scene.update',{id:printer.hash,params:{'Layer height':1,'Initial layer height':1}});
  const mesh=await call('mesh.create',{...box()});
  await call('scene.update',{id:mesh.hash,parent:printer.hash});
  await call('scene.select',{ids:[printer.hash]});await call('view.set',{index:1,single:true,focus:mesh.hash,shading:'solid'});
  await measure('Real Slice button to rendered coverage',3000,async()=>{await page.locator('[data-plugin-action="slice"] button').click();const s=await wait(printer.hash);check('Slice publishes both cube LDIs',s.state==='complete'&&s.result.intervals>0&&s.result.lastLayer===30,s);await call('scene.update',{id:printer.hash,params:{'Finish layer':1}});check('Coverage reaches native GPU pixels',(await pixels(mesh.hash,[5,.5,5])).some(c=>c.slice(0,3).every(v=>v>250)));});
  const original=await command(printer.hash,'inspect',{layer:1});
  await measure('Transform complete printer assembly without reslicing',1000,async()=>{for(const [channel,axis,value]of [['rotation',2,25],['position',0,75]])await call('transform.set',{channel,axis,value});const moved=await command(printer.hash,'inspect',{layer:1});check('Rigid assembly transform retains exact job and local LDI intervals',moved.state==='complete'&&moved.id===original.id&&JSON.stringify(moved.layer)===JSON.stringify(original.layer),{before:original.id,after:moved.id,state:moved.state});await call('view.set',{focus:mesh.hash});check('Moved coverage remains visible',(await pixels(mesh.hash,[5,.5,5])).some(c=>c.slice(0,3).every(v=>v>250)));});
  await call('scene.update',{id:mesh.hash,parent:''});await call('scene.select',{ids:[printer.hash]});
  await measure('Independent printer transform refreshes LDIs',2000,async()=>{await call('transform.set',{channel:'position',axis:1,value:5});const fresh=await wait(printer.hash,s=>s.id!==original.id&&['complete','empty'].includes(s.state));check('Changed relative frame automatically replaces stale LDIs',fresh.id!==original.id&&fresh.state==='complete',fresh);});
  await call('view.set',{index:2,single:true,focus:printer.hash});await page.keyboard.press('KeyE');await call('diagnostics.frame',{frames:1});
  const g=await page.evaluate(()=>frameEngine.gizmoState),handle=g.handles.find(h=>h.part==='move0').suggested,samples=[];
  await page.mouse.move(...handle);await page.mouse.down();
  for(let i=1;i<=5;i++)await measure('Printer live transform step '+i,150,async()=>{await page.mouse.move(handle[0]+i*8,handle[1]);await page.evaluate(()=>new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok))));const p=await page.evaluate(()=>frameEngine.gizmoState.pivot);samples.push(p);check('Printer gizmo follows step '+i,p[0]>g.pivot[0]+i*g.unit*4,{initial:g.pivot,pivot:p});});
  await page.mouse.up();await page.waitForFunction(()=>!frameEngine.transforming);await call('scene.inspect');
  const result=await wait(printer.hash,s=>['complete','empty'].includes(s.state));check('Final transform publishes current LDIs',result.state==='complete',result);
  const frames=(await call('diagnostics.frame',{frames:4})).frames;
  for(const key of ['cpuMs','gpuMs']){const ms=Math.max(...frames.map(f=>f[key]));timings.push({name:'Printer feedback '+key,ms,limit:40});check('Fresh preview '+key+' budget',Number.isFinite(ms)&&ms<40,frames);}

  await clear();const first=await call('plugins.create',{plugin:'3d-printer'}),cube=await call('scene.create',{type:'cube'});await call('transform.set',{channel:'position',axis:1,value:300});
  const second=await call('plugins.create',{plugin:'3d-printer'});await call('transform.set',{channel:'rotation',axis:2,value:180});for(const [axis,value]of [[0,500],[1,1000]])await call('transform.set',{channel:'position',axis,value});const state=await call('scene.inspect');check('New printer immediately owns the native transform selection',Math.abs(state.objects.find(n=>n.hash===second.hash).worldMatrix[5]+1)<1e-8&&Math.abs(state.objects.find(n=>n.hash===cube.hash).worldMatrix[5]-1)<1e-8);
  await call('view.set',{index:1,single:true,shading:'solid',focus:cube.hash});
  check('Last active inverted printer highlights the cube top',(await pixels(null,[10,350,10])).some(red));
  await measure('Native browser selection switches warning printer',500,async()=>{const n=(await call('scene.inspect')).objects.find(n=>n.hash===first.hash);await page.locator('#row-'+n.id+' .ob-name').click();check('Upright printer clears inverted warning',!(await pixels(null,[10,350,10])).some(red));});
  await call('scene.select',{ids:[cube.hash]});check('Selecting a mesh retains last printer orientation',!(await pixels(null,[10,350,10])).some(red));
  await call('scene.select',{ids:[second.hash]});await call('scene.select',{ids:[]});check('Deselecting retains last active printer',(await pixels(null,[10,350,10])).some(red));
  await call('scene.update',{id:second.hash,enabled:false});check('Disabled printer falls back to the remaining printer',!(await pixels(null,[10,350,10])).some(red));
  await clear();const guide=await call('plugins.create',{plugin:'3d-printer'});await call('scene.select',{ids:[]});await call('view.set',{index:0,single:true,focus:guide.hash,shading:'solid'});
  check('Perspective blue guide points toward negative Z',(await pixels(null,[0,0,-650])).some(blue)&&!(await pixels(null,[0,0,650])).some(blue));
  check('Printer blue axis stays inside the box',(await pixels(guide.hash,[-500,0,100])).some(blue));
  return {pass:true,checks,timings};
 }catch(e){await page.mouse.up().catch(()=>{});return {pass:false,checks,timings,error:e.stack};}
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const session=await launch({headless:process.argv.includes('--headless')}),errors=[];try{await ready(session.page);session.page.on('pageerror',e=>errors.push(e.stack));session.page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await session.page.evaluate(()=>{window.__printerFeedbackGPU=[];frameEngine.renderer.device.addEventListener('uncapturederror',e=>__printerFeedbackGPU.push(e.error.message));frameEngine.renderer.device.pushErrorScope('validation');});const result=await printerFeedbackChecks(session.page);result.gpu=await session.page.evaluate(async()=>({validation:(await frameEngine.renderer.device.popErrorScope())?.message||null,uncaptured:__printerFeedbackGPU}));result.errors=errors;result.pass&&=!errors.length&&!result.gpu.validation&&!result.gpu.uncaptured.length;result.sources={};for(const path of ['index.html','plugins/3d-printer/plugin.js'])result.sources[path]=createHash('sha256').update(await readFile(new URL('../../../'+path,import.meta.url))).digest('hex');await writeFile(new URL('../../../tests/results/printer-feedback.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));process.exitCode=result.pass?0:1;}finally{await session.close();}
}
