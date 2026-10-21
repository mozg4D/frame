import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../tools/browser.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
// Independent source reader; runtime parser/triangulator is never used as the oracle.
function reference(bytes){
 const original=[],positions=[],used=new Map();let triangles=0,uvCorners=0;
 const lines=bytes.toString().replace(/\\\r?\n/g,' ').replace(/#[^\n]*/g,'').split(/\r?\n/);
 for(const line of lines){const t=line.trim().split(/\s+/);if(t[0]==='v')original.push(t.slice(1,4).map(Number));
  if(t[0]==='f'){triangles+=t.length-3;for(const token of t.slice(1)){const x=Number(token.split('/')[0]),id=x<0?original.length+x:x-1;if(!used.has(id)){used.set(id,positions.length/3);positions.push(...original[id]);}if(token.split('/')[1])uvCorners++;}}
 }return {positions:Float32Array.from(positions),triangles,uvCorners};
}
export async function objImportChecks(page){
 const checks=[],timings=[],call=(n,a={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[n,a]),check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});if(!pass)throw Error(name+': '+JSON.stringify(detail));},measure=async(name,limit,fn)=>{const t=performance.now(),result=await fn(),ms=performance.now()-t;timings.push({name,ms,limit});check(name+' latency',ms<limit,{ms,limit});return result;};
 try{
  const sources=JSON.parse(await readFile(new URL('scenes/obj-import/sources.json',import.meta.url)));
  check('At least ten distinct upstream OBJ files',sources.length>=10&&new Set(sources.map(f=>f.sha256)).size>=10);
  for(const f of sources){
   const bytes=await readFile(new URL('scenes/obj-import/'+f.name,import.meta.url)),expected=reference(bytes);check(f.name+' unmodified upstream digest',sha(bytes)===f.sha256);
   const opened=await measure(f.name+' import',8000,()=>call('scene.open',{url:'tests/scenes/obj-import/'+f.name})),n=opened.objects.find(n=>n.mesh),g=await call('diagnostics.mesh',{id:n.hash,geometry:true});
   check(f.name+' independent source geometry',g.finite&&g.indicesValid&&g.positionsSHA256===sha(Buffer.from(expected.positions.buffer))&&g.triangles===expected.triangles,{vertices:g.vertices,triangles:g.triangles,expected:expected.triangles});
   const appearance=await call('diagnostics.appearance',{id:n.hash});check(f.name+' corner UV ownership',expected.uvCorners?appearance.uv?.corners===g.triangles*3:!appearance.uv,appearance.uv);
  }
  const mixed='v 0 0 0\nv 1 0 0\nv 0 1 0\nv 0 0 1\nvt 0.25 0.75\nvt 0.5 0.5\nvt 0.75 0.25\nf 1 2 3\nf 1/1 3/2 4/3\nf 1 4 2\n',n=(await call('scene.open',{name:'mixed.obj',base64:Buffer.from(mixed).toString('base64')})).objects[0],uv=await call('diagnostics.appearance',{id:n.hash,corners:[0,1,2,3,4,5,6,7,8]});
  check('Mixed OBJ retains supplied UV and initializes missing corners',uv.uv?.corners===9&&JSON.stringify(uv.uv.samples.map(s=>s.value))===JSON.stringify([[0,0],[0,0],[0,0],[0.25,0.25],[0.5,0.5],[0.75,0.75],[0,0],[0,0],[0,0]]),uv.uv);
  const hash=await call('scene.export',{includeData:true}),reopened=await call('scene.open',{name:'mixed.hash',base64:hash.base64}),after=await call('diagnostics.appearance',{id:reopened.objects[0].hash});check('Mixed UV persists in native HASH',uv.uv.sha256===after.uv.sha256);
  return {pass:true,checks,timings,models:sources.length};
 }catch(error){return {pass:false,checks,timings,error:error.stack};}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const s=await launch({headless:false}),errors=[];try{await ready(s.page);s.page.on('pageerror',e=>errors.push(e.message));await s.page.evaluate(()=>{window.__objGPU=[];frameEngine.renderer.device.addEventListener('uncapturederror',e=>__objGPU.push(e.error.message));frameEngine.renderer.device.pushErrorScope('validation');});const result=await objImportChecks(s.page);result.gpu=await s.page.evaluate(async()=>({validation:(await frameEngine.renderer.device.popErrorScope())?.message||null,uncaptured:__objGPU}));result.errors=errors;result.pass&&=!errors.length&&!result.gpu.validation&&!result.gpu.uncaptured.length;result.indexSHA256=sha(await readFile(new URL('../index.html',import.meta.url)));await writeFile(new URL('results/obj-import.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify({pass:result.pass,checks:result.checks.length,models:result.models,error:result.error,gpu:result.gpu,errors},null,2));process.exitCode=result.pass?0:1;}finally{await s.close();}}
