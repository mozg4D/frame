import {readFile,access,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {launch,ready} from '../tools/browser.mjs';

export async function pluginInfrastructureChecks(page){
 const checks=[],timings=[],catalogue=JSON.parse(await readFile(new URL('../plugins/index.json',import.meta.url),'utf8'));
 for(const manifest of catalogue){
  const folder=new URL('../plugins/'+manifest.replace(/[^/]+$/,''),import.meta.url),entry=new URL('tests/index.mjs',folder);
  await access(fileURLToPath(new URL('AGENTS.md',folder)));await access(fileURLToPath(entry));
  const {pluginChecks}=await import(entry.href),result=await pluginChecks(page);
  checks.push(...result.checks);timings.push(...result.timings||[]);if(!result.pass)return {...result,checks,timings};
 }
 return {pass:true,checks,timings};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const s=await launch({headless:process.argv.includes('--headless')}),errors=[];
 try{await ready(s.page);s.page.on('pageerror',e=>errors.push(e.stack));await s.page.evaluate(()=>{window.__pluginGPU=[];frameEngine.renderer.device.addEventListener('uncapturederror',e=>__pluginGPU.push(e.error.message));frameEngine.renderer.device.pushErrorScope('validation');});
  const r=await pluginInfrastructureChecks(s.page);r.gpu=await s.page.evaluate(async()=>({validation:(await frameEngine.renderer.device.popErrorScope())?.message||null,uncaptured:__pluginGPU}));r.errors=errors;r.pass&&=!errors.length&&!r.gpu.validation&&!r.gpu.uncaptured.length;r.indexSHA256=createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex');await mkdir(new URL('./results/',import.meta.url),{recursive:true});await writeFile(new URL('./results/plugin-infrastructure.json',import.meta.url),JSON.stringify(r,null,2));console.log(JSON.stringify(r,null,2));process.exitCode=r.pass?0:1;
 }finally{await s.close();}
}
