import {uniteChecks} from './unite-checks.mjs';
import {uniteConditioningChecks} from './unite-conditioning.mjs';
import {launch,ready} from '../tools/browser.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const source=await readFile(new URL('../index.html',import.meta.url)),session=await launch({headless:process.argv.includes('--headless')}),errors=[];
try{
 await session.page.route('**/index.html',route=>route.fulfill({status:200,contentType:'text/html',body:source}));await session.page.reload();await ready(session.page);session.page.on('pageerror',e=>errors.push(e.stack||e.message));session.page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await session.page.evaluate(()=>{window.__uniteGPU=[];window.__uniteDevice=frameEngine.renderer.device;window.__uniteLost=null;__uniteDevice.lost.then(e=>__uniteLost={reason:e.reason,message:e.message});__uniteDevice.addEventListener('uncapturederror',e=>__uniteGPU.push(e.error.message));__uniteDevice.pushErrorScope('validation');});
 const result=await uniteChecks(session.page);result.conditioning=await uniteConditioningChecks(session.page);result.pass&&=result.conditioning.pass;result.checks.push(...result.conditioning.checks);result.timings.push(...result.conditioning.timings);result.gpu=await session.page.evaluate(async()=>({validation:(await __uniteDevice.popErrorScope())?.message||null,uncaptured:__uniteGPU,lost:__uniteLost,replaced:frameEngine.renderer.device!==__uniteDevice}));result.errors=errors;result.pass&&=!errors.length&&!result.gpu.validation&&!result.gpu.uncaptured.length&&!result.gpu.lost&&!result.gpu.replaced;result.indexSHA256=createHash('sha256').update(source).digest('hex');
 await mkdir(new URL('results/',import.meta.url),{recursive:true});await writeFile(new URL('results/unite.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify({pass:result.pass,checks:result.checks.length,timings:result.timings,error:result.error,conditioning:{pass:result.conditioning.pass,checks:result.conditioning.checks.length,results:result.conditioning.results.map(r=>({name:r.name,outcome:r.outcome,ms:r.ms})),error:result.conditioning.error},gpu:result.gpu,errors},null,2));process.exitCode=result.pass?0:1;
}finally{await session.close();}
