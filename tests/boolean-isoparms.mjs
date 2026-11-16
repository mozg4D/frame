import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../tools/browser.mjs';
import {physicalPixelNeighborhoods} from './diagnostic-pixels.mjs';

export async function booleanIsoparmsChecks(page){
 const checks=[],timings=[],call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]);
 const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});assert.ok(pass,name+': '+JSON.stringify(detail));console.log('PASS '+name);};
 const measure=async(name,fn)=>{const start=performance.now(),result=await fn(),ms=performance.now()-start;timings.push({name,ms,limit:5000});check(name+' completes within 5 s',ms<5000,{ms});return result;};
 const display=async(hash,label,length)=>{
  const stats=await page.evaluate(async hash=>{
   const mesh=frameEngine.scene.meshes.find(m=>m.hashId===hash),d=frameEngine.splineDisplays.get(hash),{vertices:p,indices:ix}=await frameEngine.readGeometry(hash),key=(a,b)=>[a.join(','),b.join(',')].sort().join('|'),edges=new Set();
   for(let i=0;i<ix.length;i+=3)for(let k=0;k<3;k++)edges.add(key(Array.from(p.subarray(ix[i+k]*3,ix[i+k]*3+3)),Array.from(p.subarray(ix[i+(k+1)%3]*3,ix[i+(k+1)%3]*3+3))));
   let missing=0,diagonals=0,length=0;const values=d?.lineValues||[];
   for(let i=0;i<values.length;i+=6){const a=Array.from(values.slice(i,i+3)),b=Array.from(values.slice(i+3,i+6));if(!edges.has(key(a,b)))missing++;if(a.filter((v,k)=>v!==b[k]).length!==1)diagonals++;length+=Math.hypot(...a.map((v,k)=>v-b[k]));}
   return {segments:values.length/6,missing,diagonals,length,storage:mesh.paged?'texture':'buffer'};
  },hash);
  check(label+' preserves the complete canonical cage without triangulation',stats.segments>0&&stats.missing===0&&stats.diagonals===0&&Math.abs(stats.length-length)<1e-5,stats);return stats;
 };
 const pixels=async(hash,label)=>{
  await call('scene.select',{ids:[]});await page.mouse.move(5,5);await call('view.set',{index:2,single:true,mode:'object',shading:'solid-isoparms',focus:hash});await call('diagnostics.frame',{frames:2});
  const observed=await page.evaluate(()=>{const r=frameEngine.renderer,rect=frameEngine.pluginView().rect;return {screens:[[40,65,20],[100,65,20],[70,30,20],[70,100,20]].map(p=>frameEngine.pluginProject(p)),rect:{width:rect.width,height:rect.height},backing:{width:r.width,height:r.height}};}),points=physicalPixelNeighborhoods(observed.screens,observed.rect,observed.backing),{colors}=await call('diagnostics.pixels',{points}),visible=Array.from({length:4},(_,i)=>colors.slice(i*9,i*9+9).some(c=>[46,90,106].every((v,k)=>Math.abs(c[k]-v)<=2)));
  check(label+' draws all four cyan outline strokes',visible.every(Boolean),visible);
 };
 try{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),context={performance,self:{postMessage(){}}};vm.createContext(context);vm.runInContext(html.match(/<script id="frame-boolean-worker" type="text\/plain">([\s\S]*?)<\/script>/)[1],context);
  for(const scale of [1,1e-8]){
   const p=Float32Array.from([0,0,0,2,0,0,4,0,0,0,2,0,2,2,0,4,2,0],v=>v*scale),ix=new Uint32Array([0,1,4,0,4,3,1,2,5,1,5,4]),guides=Float32Array.from([0,0,0,4,0,0],v=>v*scale),seam=Float32Array.from([2,0,0,2,2,0],v=>v*scale),result=context.booleanDisplayEdges(p,ix,guides,new Uint32Array([0,2]),seam,new Uint32Array([0,1])),keys=Array.from({length:result.length/2},(_,i)=>[result[i*2],result[i*2+1]].sort().join(':')).sort();
   check('Worker retains split source/seam edges at scale '+scale,JSON.stringify(keys)===JSON.stringify(['0:1','1:2','1:4']),keys);
   const away=Float32Array.from(guides,(v,i)=>i%3===2?scale*1e-4:v),negative=context.booleanDisplayEdges(p,ix,away,new Uint32Array([0,2]),new Float32Array(0),new Uint32Array(0));check('Worker rejects a separate nearby guide at scale '+scale,negative.length===0,Array.from(negative));
  }
  const adapter=await page.evaluate(()=>{const a=frameEngine.renderer.device.adapterInfo;return {vendor:a.vendor,architecture:a.architecture,isFallbackAdapter:a.isFallbackAdapter,dpr:devicePixelRatio};});check('Uses hardware WebGPU at requested DPR',adapter.isFallbackAdapter===false&&!/swiftshader|llvmpipe|software/i.test(JSON.stringify(adapter))&&adapter.dpr===Number(process.env.FRAME_DPR||1),adapter);
  let inner;
  for(const [op,length]of [['subtract',1620],['union',2400],['intersect',840]]){
   await call('scene.new');await call('view.set',{index:2,single:true,shading:'solid-isoparms'});const a=await call('scene.create',{type:'cube'}),b=await call('scene.create',{type:'cube'});await call('transform.apply',{ids:[b.hash],position:[40,30,20]});
   inner=await measure(op,()=>call('scene.create',{type:'boolean',inputs:[a.hash,b.hash],params:{op}}));check(op+' retains trusted closed geometry',!inner.buildError&&inner.evaluation.report.trusted&&inner.evaluation.report.watertight,inner.evaluation.report.postTransfer);await display(inner.hash,op,length);
  }
  await pixels(inner.hash,'Buffer Boolean');
  const raw=await page.evaluate(async hash=>{const g=await frameEngine.readGeometry(hash);return {vertices:Array.from(g.vertices),indices:Array.from(g.indices),data:frameEngine.splineDisplays.get(hash).data};},inner.hash),copy=await call('mesh.create',{vertices:raw.vertices,indices:raw.indices,storage:'texture'});
  await page.evaluate(([hash,data])=>frameEngine.setSplineDisplay(hash,data,true),[copy.hash,raw.data]);await call('scene.update',{id:inner.hash,visible:false});const paged=await display(copy.hash,'Paged Boolean geometry',840);check('Paged regression uses texture storage',paged.storage==='texture',paged);await pixels(copy.hash,'Paged Boolean geometry');await call('scene.delete',{ids:[copy.hash]});await call('scene.update',{id:inner.hash,visible:true});
  const cutter=await call('scene.create',{type:'cube',params:{'size x':20,'size y':200,'size z':200}});await call('transform.apply',{ids:[cutter.hash],position:[60,0,0]});const outer=await measure('Nested cut',()=>call('scene.create',{type:'boolean',inputs:[inner.hash,cutter.hash],params:{op:'subtract'}}));await display(outer.hash,'Nested cut',1360);
  const far=await call('scene.create',{type:'cube'});await call('transform.apply',{ids:[far.hash],position:[300,0,0]});const union=await measure('Disjoint nested union',()=>call('scene.create',{type:'boolean',inputs:[outer.hash,far.hash],params:{op:'union'}}));check('Disjoint union retains the GPU fast path',union.evaluation.report.backend==='webgpu-disjoint',union.evaluation.report);await display(union.hash,'Disjoint nested union',2560);
  const saved=await call('scene.export',{includeData:true});await measure('Reopen Boolean HASH',()=>call('scene.open',{base64:saved.base64,name:'boolean-isoparms.hash'}));await display(union.hash,'HASH reopen',2560);
  const frames=await call('diagnostics.frame',{frames:5});check('Boolean line frame budget',frames.timestampQueries&&frames.frames.every(f=>f.cpuMs<50&&f.gpuMs<50),frames.frames);
  return {pass:true,checks,timings,frames,adapter};
 }catch(error){return {pass:false,checks,timings,error:error.stack};}
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const app=await launch({headless:true}),report={pass:false,errors:[]};
 try{app.page.on('pageerror',e=>report.errors.push(e.stack));await ready(app.page);await app.page.evaluate(()=>{window.__booleanIsoparmsGPU=[];const d=frameEngine.renderer.device;d.addEventListener('uncapturederror',e=>__booleanIsoparmsGPU.push(e.error.message));d.pushErrorScope('validation');});Object.assign(report,await booleanIsoparmsChecks(app.page));report.gpu=await app.page.evaluate(async()=>({validation:(await frameEngine.renderer.device.popErrorScope())?.message||null,uncaptured:__booleanIsoparmsGPU}));report.pass&&=!report.errors.length&&!report.gpu.validation&&!report.gpu.uncaptured.length;}catch(error){report.pass=false;report.error=error.stack;}finally{await app.close();report.indexSHA256=createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex');await mkdir(new URL('results/',import.meta.url),{recursive:true});await writeFile(new URL('results/boolean-isoparms.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,checks:report.checks?.length,error:report.error,gpu:report.gpu}));process.exitCode=report.pass?0:1;}
}
