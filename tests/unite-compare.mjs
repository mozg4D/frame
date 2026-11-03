// Compare the current sampled two-axis Printer LDI with exact analytic input.
// LDI discrepancies are measurements of this alternative, not hidden skips.
import {uniteFixtures,seeded} from './unite-fixtures.mjs';
import {waitForSlice} from '../plugins/3d-printer/tests/slicer.mjs';
import {launch,ready} from '../tools/browser.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';

export async function uniteLDIComparison(page){
 const call=(n,a={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[n,a]),results=[];
 for(const fixture of uniteFixtures()){
  await call('scene.new');await call('render.stop');const printer=await call('plugins.create',{plugin:'3d-printer'});await call('scene.update',{id:printer.hash,params:{'Line width':.5,'Layer height':.5,'Initial layer height':.5,Perimeters:1}});
  const yShift=10-fixture.bounds.min[1];for(const m of fixture.meshes)await call('mesh.create',{name:fixture.name,vertices:m.vertices.map((v,i)=>v+(i%3===1?yShift:0)),indices:m.indices});
  const command=(operation,args={})=>call('plugins.command',{id:printer.hash,operation,args}),started=performance.now();await command('slice');const status=await waitForSlice(call,printer.hash),ms=performance.now()-started,result={name:fixture.name,operationMs:ms,state:status.state,error:status.error,checked:0,mismatches:0,examples:[],result:status.result};results.push(result);
  if(status.state!=='complete')continue;
  const grid=status.result.grid,last=status.result.lastLayer,layers=[...new Set([Math.max(1,Math.floor(last*.3)),Math.max(1,Math.floor(last*.6)),Math.max(1,Math.floor(last*.9))])],random=seeded(9513);
  for(const layer of layers)for(const axis of ['X','Z']){
   const count=axis==='X'?grid.depth:grid.width,offsets=[...new Set(Array.from({length:Math.min(32,count)},(_,i)=>Math.floor(i*(count-1)/Math.max(1,Math.min(32,count)-1))))];
   for(const offset of offsets){const data=await command('inspect',{axis,layer,offset,count:1}),ray=data.layer.rays[0],y=data.layer.y-yShift,depthAxis=axis==='X'?0:2,min=fixture.bounds.min[depthAxis],max=fixture.bounds.max[depthAxis];
    for(let i=0;i<12;i++){const depth=min+(max-min)*(random()*1.2-.1),point=axis==='X'?[depth,y,ray.position]:[ray.position,y,depth],expected=fixture.inside(point),actual=ray.intervals.some(([a,b])=>depth>a&&depth<b);result.checked++;if(expected!==actual){result.mismatches++;if(result.examples.length<8)result.examples.push({axis,layer,point,expected,actual,ambiguous:ray.ambiguous});}}
   }
  }
  const warm=performance.now();await command('slice');const warmed=await waitForSlice(call,printer.hash);result.warmOperationMs=performance.now()-warm;result.warmState=warmed.state;
 }
 return{method:'Existing Printer all-layer X/Z sampled LDI with native selected-layer perimeter work included in completion. Line width0.5/pitch0.1/layer0.5. Analytic occupancy probes use inspected exact ray depths at deterministic positions. Representation remains sampled and does not produce a 3D polygon union boundary.',results,pass:results.every(r=>r.state==='complete'&&r.warmState==='complete')};
}

if(process.argv[1]&&new URL('file:///'+process.argv[1].replaceAll('\\','/')).href===import.meta.url){
 const paths=['index.html','plugins/3d-printer/plugin.js'],sources=Object.fromEntries(await Promise.all(paths.map(async p=>[p,await readFile(new URL('../'+p,import.meta.url))]))),session=await launch({headless:process.argv.includes('--headless')}),errors=[];
 try{for(const path of paths)await session.page.route(url=>url.pathname==='/'+path,route=>route.fulfill({status:200,contentType:path.endsWith('.html')?'text/html':'text/javascript',body:sources[path]}));await session.page.reload();await ready(session.page);session.page.on('pageerror',e=>errors.push(e.message));session.page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await session.page.evaluate(()=>{window.__compareGPU=[];window.__compareDevice=frameEngine.renderer.device;window.__compareLost=null;__compareDevice.lost.then(e=>__compareLost={reason:e.reason,message:e.message});__compareDevice.addEventListener('uncapturederror',e=>__compareGPU.push(e.error.message));__compareDevice.pushErrorScope('validation');});const result=await uniteLDIComparison(session.page);result.errors=errors;result.gpu=await session.page.evaluate(async()=>({validation:(await __compareDevice.popErrorScope())?.message||null,uncaptured:__compareGPU,lost:__compareLost,replaced:frameEngine.renderer.device!==__compareDevice}));result.sources=Object.fromEntries(paths.map(path=>[path,createHash('sha256').update(sources[path]).digest('hex')]));result.pass&&=!errors.length&&!result.gpu.validation&&!result.gpu.uncaptured.length&&!result.gpu.lost&&!result.gpu.replaced;await mkdir(new URL('results/',import.meta.url),{recursive:true});await writeFile(new URL('results/unite-ldi-comparison.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify({pass:result.pass,results:result.results.map(r=>({name:r.name,state:r.state,error:r.error,operationMs:r.operationMs,warmOperationMs:r.warmOperationMs,checked:r.checked,mismatches:r.mismatches,peakGPUBytes:r.result?.peakGPUBytes,grid:r.result?.grid})),errors:result.errors,gpu:result.gpu},null,2));process.exitCode=result.pass?0:1;}finally{await session.close();}
}
