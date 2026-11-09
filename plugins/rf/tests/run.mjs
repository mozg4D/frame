import {launch,ready} from '../../../tools/browser.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pluginChecks} from './index.mjs';
const report={started:new Date().toISOString(),pass:false,sources:{}},paths=['index.html','plugins/index.json','plugins/rf/plugin.json','plugins/rf/plugin.js','plugins/rf/icon.svg'];
for(const path of paths)report.sources[path]=createHash('sha256').update(await readFile(new URL('../../../'+path,import.meta.url))).digest('hex');
let session;
try{
  session=await launch({headless:process.argv.includes('--headless')});await ready(session.page);
  const errors=[];session.page.on('pageerror',e=>errors.push(e.message));
  report.adapter=await session.page.evaluate(()=>Object.fromEntries(['vendor','architecture','device','description'].map(k=>[k,frameEngine.renderer.device.adapterInfo[k]])));
  const identity=Object.values(report.adapter).join(' ');
  if(!identity.trim()||/swiftshader|llvmpipe|software|lavapipe/i.test(identity))throw Error('Identifiable hardware WebGPU is required; software is not a pass.');
  await session.page.evaluate(()=>{window.__rfDevice=frameEngine.renderer.device;window.__rfGPU=[];__rfDevice.addEventListener('uncapturederror',e=>__rfGPU.push(e.error.message));__rfDevice.pushErrorScope('validation');});
  Object.assign(report,await pluginChecks(session.page));
  report.gpu=await session.page.evaluate(async()=>({validation:(await __rfDevice.popErrorScope())?.message||null,errors:__rfGPU,deviceChanged:__rfDevice!==frameEngine.renderer.device}));
  report.pageErrors=errors;report.pass&&=!errors.length&&!report.gpu.validation&&!report.gpu.errors.length&&!report.gpu.deviceChanged;
}catch(e){report.error=e.stack;report.pass=false;}finally{
  await session?.close();await mkdir(new URL('../../../tests/results/',import.meta.url),{recursive:true});
  await writeFile(new URL('../../../tests/results/rf.json',import.meta.url),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));process.exitCode=report.pass?0:1;
}
