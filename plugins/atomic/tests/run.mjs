import {launch,ready} from '../../../tools/browser.mjs';
import {pluginChecks} from './index.mjs';
import {writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const s=await launch({headless:process.argv.includes('--headless')}),errors=[];
try{await ready(s.page);s.page.on('pageerror',e=>errors.push(e.stack));s.page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await s.page.evaluate(()=>{window.__atomicGPU=[];frameEngine.renderer.device.addEventListener('uncapturederror',e=>__atomicGPU.push(e.error.message));});const result=await pluginChecks(s.page);result.indexSHA256=createHash('sha256').update(await readFile(new URL('../../../index.html',import.meta.url))).digest('hex');result.pluginSHA256=createHash('sha256').update(await readFile(new URL('../plugin.js',import.meta.url))).digest('hex');result.errors=errors;result.gpu=await s.page.evaluate(()=>__atomicGPU);result.pass&&=!errors.length&&!result.gpu.length;await writeFile(new URL('../../../tests/results/atomic.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));process.exitCode=result.pass?0:1;}finally{await s.close();}
