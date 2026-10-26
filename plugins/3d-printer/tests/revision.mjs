import {box,combine,shifted,openTop,waitForSlice,runReport} from './slicer.mjs';
import {fileURLToPath} from 'node:url';

export async function printerRevisionChecks(page){
 const checks=[],timings=[],call=(n,a={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[n,a]),check=(name,pass,detail)=>{checks.push({name:'Printer revision: '+name,pass:!!pass,detail});if(!pass)throw Error(name+': '+JSON.stringify(detail));};
 const clear=async()=>{await call('render.stop');const s=await call('scene.inspect');if(s.objects.length)await call('scene.delete',{ids:s.objects.filter(n=>!n.parent).map(n=>n.hash)});await call('view.set',{mode:'object',single:true,index:1,shading:'solid'});};
 const pixel=async point=>{const {screen}=await call('view.project',{point});return (await call('diagnostics.pixels',{points:[screen]})).colors[0];};
 const white=c=>c.slice(0,3).every(v=>v>250),command=(id,operation,args={})=>call('plugins.command',{id,operation,args});
 try{
  await clear();let printer=await call('plugins.create',{plugin:'3d-printer'});await call('scene.update',{id:printer.hash,params:{'Initial layer height':1,'Layer height':1}});const mesh=await call('mesh.create',{...combine(openTop(box()),shifted(box(10,10,10),5,100,5))});await call('scene.select',{ids:[printer.hash]});await call('view.set',{focus:mesh.hash});
  // Hold a real asynchronous GPU completion point so the UI test does not
  // depend on a fast build lasting longer than Playwright's click scheduling.
  await page.evaluate(()=>{const queue=frameEngine.renderer.device.queue,original=queue.onSubmittedWorkDone.bind(queue);window.__sliceGate={release:null,restore:()=>delete queue.onSubmittedWorkDone};queue.onSubmittedWorkDone=async()=>{await original();await new Promise(ok=>__sliceGate.release=ok);};});
  const began=performance.now();await page.locator('[data-plugin-action="slice"] button').click();await page.waitForFunction(()=>!!window.__sliceGate.release);const button=page.locator('[data-plugin-action="slice"] button');check('Slice becomes an enabled Stop button',await button.textContent()==='Stop'&&await button.isEnabled()&&await button.getAttribute('aria-busy')==='true');
  await button.click();await page.evaluate(()=>{__sliceGate.restore();__sliceGate.release();delete window.__sliceGate;});let s=await waitForSlice(call,printer.hash);timings.push({name:'Native Slice/Stop cancellation',ms:performance.now()-began,limit:2000});check('Stop cancels without publishing partial coverage',s.state==='cancelled'&&!s.result,s);check('cancelled action returns to enabled Slice',await button.textContent()==='Slice'&&await button.isEnabled()&&await button.getAttribute('aria-busy')==='false');
  const before=await pixel([5,100,5]);await command(printer.hash,'slice');s=await waitForSlice(call,printer.hash);check('Slice can restart after Stop',s.state==='complete',s);await call('scene.update',{id:printer.hash,params:{'Finish layer':1}});await call('scene.select',{ids:[]});
  check('filled map remains white in unobstructed viewport pixels',white(await pixel([-5,.5,5])));const after=await pixel([5,100,5]);check('foreground geometry occludes the map',JSON.stringify(before)===JSON.stringify(after)&&!white(after),{before,after});
  await call('scene.update',{id:printer.hash,params:{'Finish layer':105}});const transparent=await pixel([-5,104.5,5]);check('empty map texels leave underlying scene visible',!white(transparent),transparent);
  const frames=(await call('diagnostics.frame',{frames:5})).frames;for(const key of ['cpuMs','gpuMs'])timings.push({name:'Depth-tested transparent preview '+key,ms:Math.max(...frames.map(f=>f[key])),limit:40});
  // Delete the sliced owner through its actual browser row and keyboard path.
  await call('scene.update',{id:printer.hash,params:{'Finish layer':1}});check('Delete starts with a visible sliced map',white(await pixel([-5,.5,5])));
  await call('scene.select',{ids:[printer.hash]});const row=(await call('scene.inspect')).objects.find(n=>n.hash===printer.hash);await page.locator('#row-'+row.id+' .ob-name').click();const del=performance.now();await page.keyboard.press('Delete');await call('scene.inspect');await call('diagnostics.frame',{frames:2});timings.push({name:'Native printer Delete to clean viewport',ms:performance.now()-del,limit:500});
  check('Delete removes the native owner and helper hit paths',!(await call('scene.inspect')).objects.some(n=>n.hash===printer.hash)&&await page.locator('.frame-plugin-hit[data-hash="'+printer.hash+'"]').count()===0);
  const rows=await page.evaluate(()=>[...frameEngine.renderer.pluginViewports.values()].flatMap(s=>[...s.nodes.keys()]));check('Delete retires plugin GPU frame resources',!rows.includes(printer.hash),rows);check('Delete removes the layer map from native pixels',!white(await pixel([-5,.5,5])));
  await call('edit.history',{action:'undo'});check('Undo restores the ordinary printer owner',(await call('scene.inspect')).objects.some(n=>n.hash===printer.hash));await call('diagnostics.frame',{frames:2});check('Undo does not resurrect retired slice resources',(await command(printer.hash,'status')).state==='idle');await call('edit.history',{action:'redo'});await call('diagnostics.frame',{frames:2});check('Redo removes restored printer helpers',(await page.evaluate(()=>[...frameEngine.renderer.pluginViewports.values()].flatMap(s=>[...s.nodes.keys()]))).length===0);
  await clear();printer=await call('plugins.create',{plugin:'3d-printer'});await call('scene.update',{id:printer.hash,params:{'Initial layer height':1,'Layer height':1}});
  // Three distinct boundaries within the former depth-weld epsilon must
  // remain three crossings; otherwise parity inverts across the whole ray.
  const thin=combine(box(40,2,40),shifted(box(8,2,8),10,0,10),shifted(box(8.000008,2,8.000008),10,0,10));await call('mesh.create',{...thin});await command(printer.hash,'slice');s=await waitForSlice(call,printer.hash);check('near-coincident self intersections retain balanced rays',s.state==='complete'&&s.result.ambiguousRays===0,s);
  for(const axis of ['X','Z']){const {layer}=await command(printer.hash,'inspect',{axis,layer:1,count:100});const bad=layer.rays.filter(r=>r.intervals.some(([a,b])=>a>20||b>20||a< -20));check(axis+' near crossings do not invent distant filled spans',bad.length===0,bad);}
  check('focused UI operations and GPU frames meet budgets',timings.every(t=>Number.isFinite(t.ms)&&t.ms<t.limit),timings);return {pass:true,checks,timings};
 }catch(e){await page.evaluate(()=>{if(window.__sliceGate){__sliceGate.restore();__sliceGate.release?.();delete window.__sliceGate;}}).catch(()=>{});return {pass:false,checks,timings,error:e.stack};}
}
if(process.argv[1]===fileURLToPath(import.meta.url))await runReport('printer-revision',printerRevisionChecks);
