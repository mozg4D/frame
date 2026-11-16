import {box,combine,shifted,waitForSlice,runReport} from './slicer.mjs';
import {fileURLToPath} from 'node:url';

export async function layerRangeChecks(page){
 const checks=[],timings=[],call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]);
 const check=(name,pass,detail)=>{checks.push({name:'Printer layer range: '+name,pass:!!pass,detail});if(!pass)throw Error(name+': '+JSON.stringify(detail));};
 try{
  const old=await call('scene.inspect');if(old.objects.length)await call('scene.delete',{ids:old.objects.filter(n=>!n.parent).map(n=>n.hash)});
  const printer=await call('plugins.create',{plugin:'3d-printer'}),command=(operation,args={})=>call('plugins.command',{id:printer.hash,operation,args}),params=async()=>(await call('scene.inspect')).objects.find(n=>n.hash===printer.hash).params;
  await call('scene.update',{id:printer.hash,params:{'Line width':2,'Initial layer height':1,'Layer height':1,'Start layer':4,'Finish layer':5}});
  const mesh=await call('mesh.create',{...combine(box(40,6,40),shifted(box(20,6,20),0,6,0)),name:'Two distinct six-layer sections'});
  await call('scene.select',{ids:[printer.hash]});const slice=async()=>{const start=performance.now();await page.locator('[data-plugin-action="slice"] button').click();const s=await waitForSlice(call,printer.hash);timings.push({name:'Complete all-layer preview',ms:performance.now()-start,limit:3000});check('Slice completes the entire preview',s.state==='complete'&&s.result.preview.state==='complete',s);return s;};
  let s=await slice(),p=await params();check('first success replaces a preset range with all twelve layers',p['Start layer']===1&&p['Finish layer']===12&&s.result.preview.startLayer===1&&s.result.preview.finishLayer===12&&s.result.preview.segments===48,s.result.preview);
  check('only bit-identical adjacent sections reuse a path build',s.result.preview.sections===2&&s.result.preview.builds===2,s.result.preview);
  for(const layer of [1,6,7,12]){const a=(await command('inspect',{paths:true,layer,count:256})).paths,edge=layer<=6?19:9;check('draw buffer contains the correct closed contour at layer '+layer,a.total===4&&a.segments.every(s=>s.a[1]===layer-.5&&s.b[1]===layer-.5&&Math.abs(Math.max(Math.abs(s.a[0]),Math.abs(s.a[2]))-edge)<.0001),a);}
  await call('view.set',{single:true,index:2,shading:'solid',focus:mesh.hash});await call('scene.select',{ids:[]});await call('diagnostics.frame',{frames:2});
  const visible=async layer=>{const {screen}=await call('view.project',{point:[5,layer-.5,layer<=6?19:9]}),points=[];for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++)points.push([screen[0]+x,screen[1]+y]);return (await call('diagnostics.pixels',{points})).colors.some(c=>c.slice(0,3).every(v=>v>240));};
  for(let layer=1;layer<=12;layer++)check('first Slice visibly draws layer '+layer,await visible(layer));
  await call('scene.select',{ids:[printer.hash]});await call('scene.update',{id:printer.hash,params:{'Start layer':3,'Finish layer':7}});s=await slice();p=await params();check('second Slice preserves the authored Start and Finish',p['Start layer']===3&&p['Finish layer']===7&&s.result.preview.visibleLayers===5&&s.result.preview.segments===20,{params:p,preview:s.result.preview});
  await call('scene.select',{ids:[]});await call('diagnostics.frame',{frames:2});for(const layer of [1,2,3,5,6,7,8,12])check('second Slice '+(layer>=3&&layer<=7?'shows ':'hides ')+'layer '+layer,await visible(layer)===(layer>=3&&layer<=7));
  const id=s.id,builds=s.result.preview.builds;await call('scene.update',{id:printer.hash,params:{'Start layer':4,'Finish layer':6}});await call('diagnostics.frame',{frames:2});s=await command('status');check('editing the displayed range reuses the complete GPU preview',s.id===id&&s.result.preview.startLayer===4&&s.result.preview.finishLayer===6&&s.result.preview.segments===12&&s.result.preview.builds===builds,s.result.preview);
  await call('edit.history',{action:'undo'});await call('diagnostics.frame',{frames:2});s=await command('status');check('Undo restores the full authored range without slicing',s.id===id&&s.result.preview.startLayer===3&&s.result.preview.finishLayer===7,s.result.preview);
  await call('scene.update',{id:printer.hash,params:{Perimeters:2}});const updated=(await command('inspect',{paths:true,layer:3,count:256})).paths;check('count changes rebuild compact paths for every section',updated.total===8&&(await command('status')).id===id,updated);
  let rejected=false;try{await command('inspect',{paths:true,layer:2});}catch(e){rejected=/displayed layer/.test(e.message);}check('compact inspection rejects a layer outside the visible range',rejected);
  await call('scene.select',{ids:[printer.hash]});check('the area left of Slice stays empty after completion',(await page.locator('[data-plugin-action="slice"] [data-plugin-progress]').textContent())==='');
  const frames=await call('diagnostics.frame',{frames:8});for(const key of ['cpuMs','gpuMs']){const ms=Math.max(...frames.frames.map(f=>f[key]));timings.push({name:'All-layer preview '+key,ms,limit:40});check('actual '+key+' frame time stays below 40 ms',Number.isFinite(ms)&&ms<40,ms);}
  return {pass:true,checks,timings};
 }catch(error){return {pass:false,checks,timings,error:error.stack};}
}
if(process.argv[1]===fileURLToPath(import.meta.url))await runReport('printer-layer-range',layerRangeChecks);
