import {fileURLToPath} from 'node:url';
import {box,combine,shifted,waitForSlice,runReport} from './slicer.mjs';

export async function sectionLifecycleChecks(page){
 const checks=[],call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]);let printer,gated=false;
 const check=(name,pass,detail)=>{checks.push({name:'Printer section/lifecycle: '+name,pass:!!pass,detail});if(!pass)throw Error(name+': '+JSON.stringify(detail));};
 const command=(operation,args={})=>call('plugins.command',{id:printer.hash,operation,args}),params=async()=>(await call('scene.inspect')).objects.find(n=>n.hash===printer.hash).params;
 const slice=async()=>{await command('slice');const s=await waitForSlice(call,printer.hash);check('explicit Slice completes',s.state==='complete'&&s.result.preview.state==='complete',s);return s;};
 const area=segments=>Math.abs(segments.reduce((n,s)=>n+s.a[0]*s.b[2]-s.b[0]*s.a[2],0))*.5;
 const setup=async()=>{await call('scene.new');printer=await call('plugins.create',{plugin:'3d-printer'});await call('scene.update',{id:printer.hash,params:{'Line width':2,'Initial layer height':1,'Layer height':1}});};
 try{
  await setup();const source=await call('mesh.create',{...box(40,6,40)}),outside=await call('mesh.create',{...shifted(box(20,60,20),600)});await call('scene.select',{ids:[printer.hash]});
  let s=await slice();check('geometry outside the printer volume does not raise Finish',s.total===6&&s.result.lastLayer===6&&(await params())['Finish layer']===6,s);
  const contour=(await command('inspect',{paths:true,layer:3,count:256})).paths;check('section perimeter has exact unshifted square corners',contour.total===4&&Math.abs(area(contour.segments)-1600)<.01&&contour.segments.every(p=>[p.a,p.b].every(a=>Math.abs(Math.abs(a[0])-20)<.0001&&Math.abs(Math.abs(a[2])-20)<.0001)),contour);
  const id=s.id;await call('transform.set',{ids:[outside.hash],channel:'position',axis:2,value:25});await call('diagnostics.frame',{frames:2});check('editing unrelated outside geometry retains the completed slice',(await command('status')).id===id&&(await command('status')).state==='complete');
  await call('scene.select',{ids:[printer.hash]});const layout=await page.locator('#attrContent').evaluate(el=>{const progress=el.querySelector('[data-plugin-action="slice"] [data-plugin-progress]'),row=progress.closest('.attr-row');return {last:el.lastElementChild.dataset.pluginAction,align:getComputedStyle(progress).textAlign,delta:progress.getBoundingClientRect().left-row.getBoundingClientRect().left,hidden:!el.querySelector('[data-field="Perimeters"]')};});check('progress is aligned left and Polyline is at the panel bottom',layout.last==='polyline'&&layout.align==='left'&&Math.abs(layout.delta)<2&&layout.hidden,layout);
  await page.evaluate(()=>{const original=GPUBuffer.prototype.mapAsync;window.__sectionGate={release:null,restore:()=>GPUBuffer.prototype.mapAsync=original};GPUBuffer.prototype.mapAsync=function(...args){const done=original.apply(this,args);return this.label==='Printer perimeter metadata'?done.then(()=>new Promise(resolve=>__sectionGate.release=resolve)):done;};});gated=true;
  await command('slice');await page.waitForFunction(()=>!!__sectionGate.release);s=await command('status');check('progress belongs to the current six-layer build',s.state==='running'&&s.completed===0&&s.total===6,s);
  await call('transform.set',{ids:[source.hash],channel:'position',axis:1,value:6});await call('scene.select',{ids:[printer.hash]});s=await command('status');check('touching geometry inside the volume immediately stops the job',s.state==='stale'&&!s.result&&s.completed===0&&s.total===0,{status:s,source:(await call('scene.inspect')).objects.find(n=>n.hash===source.hash)});const stopped=s.id;
  await page.evaluate(()=>{__sectionGate.restore();__sectionGate.release();delete window.__sectionGate;});gated=false;await page.waitForTimeout(100);s=await command('status');check('a stale job does not automatically restart',s.id===stopped&&s.state==='stale'&&await page.locator('[data-plugin-action="slice"] [data-plugin-progress]').textContent()==='',s);
  s=await slice();check('Finish follows the new geometry height after an explicit restart',s.total===9&&s.completed===9&&s.result.lastLayer===9&&(await params())['Finish layer']===9,s);
  await call('scene.update',{id:printer.hash,params:{'Finish layer':5}});await call('transform.set',{ids:[source.hash],channel:'position',axis:1,value:8});s=await slice();check('an explicitly limited Finish is preserved while total layers are recalculated',s.total===11&&s.completed===11&&(await params())['Finish layer']===5,s);
  const wedge=box(40,14,20);wedge.vertices=wedge.vertices.map((v,i,a)=>i%3===1&&v>0?10+(a[i-1]+20)*.1:v);await call('mesh.create',{...shifted(wedge,500),storage:'texture'});s=await slice();check('paged triangles are clipped to the build footprint before measuring Finish',s.total===12&&s.result.lastLayer===12,s.result);
  await setup();const hollow=await call('mesh.create',{...combine(box(40,2,40),box(20,2,20))});s=await slice();const holes=(await command('inspect',{paths:true,layer:2,count:256})).paths;check('unshifted outer and hole perimeters retain their closed areas',holes.total===8&&Math.abs(area(holes.segments)-1200)<.02&&s.result.perimeters.firstOffset===0&&s.result.perimeters.count===1,{paths:holes,summary:s.result.perimeters});
  await call('view.set',{single:true,index:1,shading:'solid',focus:hollow.hash});await call('scene.update',{id:hollow.hash,visible:false});await call('scene.select',{ids:[]});await call('diagnostics.frame',{frames:2});
  const points=await page.evaluate(()=>[20,20.55,20.93,21.3].map(x=>frameEngine.pluginProject([x,1.5,5]))),colors=(await call('diagnostics.pixels',{points})).colors;check('beads use a calm tint and a softer broad edge gradient',colors[0][0]>110&&colors[0][0]<150&&colors[1][0]>60&&colors[1][0]<colors[0][0]-5&&colors[2][0]>20&&colors[2][0]<100&&colors[3][0]<60,colors);
  await call('scene.delete',{ids:[hollow.hash]});
  const sheet=await call('mesh.create',{vertices:[-5,5,-5,5,5,-5,5,5,5],indices:[0,1,2]});
  await command('slice');s=await waitForSlice(call,printer.hash);
  const emptyRange=await params();check('a nonempty mesh between layer planes clears the previous build range and progress',s.state==='empty'&&s.stage==='empty'&&s.completed===0&&s.total===0&&emptyRange['Start layer']===1&&emptyRange['Finish layer']===1,s);
  await call('scene.delete',{ids:[sheet.hash]});await command('slice');s=await waitForSlice(call,printer.hash);check('an empty build clears progress and resets the layer range',s.state==='empty'&&s.total===0&&(await params())['Finish layer']===1&&(await params())['Start layer']===1,s);
  return {pass:true,checks,timings:[]};
 }catch(error){return {pass:false,checks,timings:[],error:error.stack};}
 finally{if(gated)await page.evaluate(()=>{__sectionGate.restore();__sectionGate.release?.();delete window.__sectionGate;}).catch(()=>{});}
}
if(process.argv[1]===fileURLToPath(import.meta.url))await runReport('printer-section-lifecycle',sectionLifecycleChecks);
