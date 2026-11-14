import {pluginEnabled} from './test-policy.mjs';
import assert from 'node:assert/strict';
import {readFile,readdir,access,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {launch,ready} from '../tools/browser.mjs';

export async function pluginLayoutChecks(root=new URL('../plugins/',import.meta.url)){
 const catalogue=JSON.parse(await readFile(new URL('index.json',root),'utf8')),checks=[];
 const directories=(await readdir(root,{withFileTypes:true})).filter(e=>e.isDirectory()).map(e=>e.name).sort();
 assert.deepEqual(directories,catalogue.map(path=>path.split('/')[0]).sort(),'Every plugin directory belongs to the catalogue');
 for(const id of directories.filter(pluginEnabled)){
  const folder=new URL(id+'/',root),entries=await readdir(folder,{withFileTypes:true});
  assert.deepEqual(entries.filter(e=>e.isFile()).map(e=>e.name).sort(),['AGENTS.md','icon.svg','plugin.js','plugin.json'],id+' has exactly four plugin files');
  assert.ok(entries.every(e=>e.isFile()||e.isDirectory()&&e.name==='tests'),id+' allows only the tests directory');
  const manifest=JSON.parse(await readFile(new URL('plugin.json',folder),'utf8'));
  assert.equal(manifest.id,id);assert.equal(manifest.module,'plugin.js');assert.equal(manifest.icon,'icon.svg');
  assert.ok(!manifest.assets?.length,id+' has no runtime sidecar assets');
  const source=await readFile(new URL('plugin.js',folder),'utf8');
  assert.doesNotMatch(source,/^import\s.+\bfrom\s+['"]\.\//m,id+' imports no runtime sidecar modules');
  checks.push({name:id+' uses four plugin files and optional tests only',pass:true});
 }
 return {pass:true,checks,timings:[]};
}

export async function pluginInfrastructureChecks(page){
 const {checks}=await pluginLayoutChecks(),timings=[],catalogue=JSON.parse(await readFile(new URL('../plugins/index.json',import.meta.url),'utf8'));
 for(const manifest of catalogue.filter(path=>pluginEnabled(path.split('/')[0]))){
  const folder=new URL('../plugins/'+manifest.replace(/[^/]+$/,''),import.meta.url),entry=new URL('tests/index.mjs',folder);
  await access(fileURLToPath(new URL('AGENTS.md',folder)));await access(fileURLToPath(entry));
  console.log('[tests] plugin '+manifest.split('/')[0]+' START');const started=performance.now();const {pluginChecks}=await import(entry.href),result=await pluginChecks(page);console.log('[tests] plugin '+manifest.split('/')[0]+' '+(result.pass?'PASS':'FAIL')+' '+((performance.now()-started)/1000).toFixed(1)+'s');
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
