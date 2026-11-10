import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {launch,ready} from '../../../tools/browser.mjs';
const paths=['index.html','tools/browser.mjs','experiments/structural-surface/surface-work.js','experiments/structural-surface/sat-reference.js','experiments/structural-surface/kernels/buffer.wgsl','experiments/structural-surface/kernels/texture.wgsl','experiments/structural-surface/tests/hardware.mjs','experiments/structural-surface/tests/hardware-probe.mjs','experiments/structural-surface/tests/hardware-fixtures.mjs','experiments/structural-surface/tests/hardware-fixtures.test.mjs'];
const sources=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,createHash('sha256').update(await readFile(new URL('../../../'+p,import.meta.url))).digest('hex')])));
const report={started:new Date().toISOString(),scope:'Test-owned controlled native-format resources on Frame shared GPU; compile and surface-candidate label comparisons only',pass:false,sceneSolved:false,analysisReady:false,nativeCaptureQualified:false,physicalVolumeClassified:false,errors:[],limitations:['No production job runner or native scene capture/completeness qualification','No volume interior, effective material/fixture/load classification or PCG coupling','Controlled fixtures do not prove arbitrary dirty/degenerate or large-cancellation geometry robustness','Staleness and retirement checked on controlled capture handles; no production cancellation/device-loss injection','Geometry is test-owned native-format data, not copied/read back from a user scene'],sources:await sources()};let app;
const inspect=async page=>page.evaluate(async()=>{const s=await frameAI.call('scene.inspect');if(s.stats)delete s.stats.frame;return JSON.stringify(s);});
try{
 app=await launch({headless:true});app.page.on('pageerror',e=>report.errors.push(e.message));await ready(app.page);const before=await inspect(app.page);
 report.adapter=await app.page.evaluate(()=>Object.fromEntries(['vendor','architecture','isFallbackAdapter'].map(k=>[k,frameEngine.renderer.device.adapterInfo?.[k]??null])));
 if(report.adapter.vendor!=='nvidia'||report.adapter.isFallbackAdapter!==false)throw Error('Required native NVIDIA hardware adapter unavailable; no software fallback or skip');
 report.probe=await app.page.evaluate(async()=>{const {structuralSurfaceHardwareProbe}=await import('./experiments/structural-surface/tests/hardware-probe.mjs');return structuralSurfaceHardwareProbe(frameEngine.renderer.device);});
 const after=await inspect(app.page);report.sceneUnchanged=before===after;
 if(!report.probe.pass||!report.sceneUnchanged||report.errors.length||report.probe.errors.length||report.probe.deviceLost||report.probe.resources.remaining)throw Error(report.probe.error||'Scene isolation, GPU errors, lifetime or gate failure');
 report.pass=true;report.controlledSurfaceHardwareValidated=true;
}catch(e){report.error=e.stack||String(e);process.exitCode=1;}finally{
 await app?.close();report.sourcesAfter=await sources();if(JSON.stringify(report.sources)!==JSON.stringify(report.sourcesAfter)){report.pass=false;process.exitCode=1;report.error='Source changed during gate';}
 report.finished=new Date().toISOString();await mkdir(new URL('./results/',import.meta.url),{recursive:true});await writeFile(new URL('./results/hardware.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({pass:report.pass,checks:report.probe?.checks.length,error:report.error,adapter:report.adapter,scope:report.scope},null,2));
}
