import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {launch,ready} from '../../../tools/browser.mjs';

const cases={
  'sphere':['live-solve-check','verifyLiveSphere'],'rotor':['live-solve-check','verifyLiveRotating'],
  'regions':['live-solve-check','verifyLiveRegions'],'curves':['live-solve-check','verifyFrameHistory'],
  'animation':['live-solve-check','verifyAnimationSolve'],'offline':['live-solve-check','verifyOfflineRender'],
  'streamlines':['streamlines-check','verifyNativeFlowLines'],'streamline-reference':['streamlines-check','verifyStreamlines'],
  'load-reference':['load-profiles-check','verifyLoadProfiles'],'rotor-profiles':['load-profiles-check','verifyRotorProfiles'],
  'translation':['translation-check','verifyTranslation'],'observer':['translation-check','verifyAnimatedObserver'],
  'saved-translation':['translation-check','verifySavedTranslation'],
  'oblique-shape':['steady-shape-check','verifyObliqueSteadyForce'],
  'paired':['paired-check','verifyPairedSolve'],
  'surface-report':['surface-statistics-check','verifyLiveSurfaceReport'],
  'transport-weights':['adjoint-refinement-check','verifyTransportWeights'],'adjoint-refinement':['adjoint-refinement-check','verifyAdjointRefinement'],
  'cavity':['cavity-check','verifyCavity'],
  'backward-step':['backstep-check','verifyBackwardStep'],
  'towing-media':['translation-check','verifyTowingSimilarity'],
  'region-profiles':['load-profiles-check','verifyRegionalProfiles'],'shape-design':['shape-design-check','verifyShapeDesign']
};
const args=process.argv.slice(2),which=args.find(v=>v.startsWith('--case='))?.slice(7);
if(!Object.hasOwn(cases,which))throw Error('Choose --case='+Object.keys(cases).join(', '));
const [moduleName,method]=cases[which],name='plugins/cfd/tests/m0/'+moduleName+'.mjs',output=resolve(args.find(v=>v.startsWith('--out='))?.slice(6)??'tests/results/cfd-live-'+which+'.json');
const files=[...new Set(['index.html','plugins/cfd/plugin.js','plugins/cfd/plugin.json','plugins/cfd/tests/native-flow.mjs',
  'plugins/cfd/tests/m0/live-solve-check.mjs','tools/browser.mjs',name,...which==='saved-translation'?['plugins/cfd/tests/m0/native-case.mjs','plugins/cfd/tests/m0/flow.mjs']:[]])];
if(files.some(f=>resolve(f)===output))throw Error('Use a separate path for the result.');
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await readFile(new URL('../../../'+f,import.meta.url))).digest('hex')])));
const result={case:which,startedUtc:new Date().toISOString(),sources:await hashes(),pageErrors:[],pass:false};
let session;
try{
  session=await launch({headless:args.includes('--headless')});const page=session.page;
  page.on('pageerror',e=>result.pageErrors.push(e.message));page.on('console',msg=>{if(msg.text().startsWith('CFD live '))console.log(msg.text());});
  await ready(page);
  Object.assign(result,await page.evaluate(async({name,method})=>{
    const device=frameEngine.renderer.device,{vendor,architecture,isFallbackAdapter}=device.adapterInfo;
    if(!vendor||isFallbackAdapter||/software|swiftshader|llvmpipe/i.test(vendor+' '+architecture))throw Error('An identifiable hardware WebGPU adapter is required.');
    const errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));device.pushErrorScope('validation');
    const value=await (await import('/'+name))[method](device);await device.queue.onSubmittedWorkDone();
    return {adapter:{vendor,architecture},value,errors,validation:(await device.popErrorScope())?.message??null};
  },{name,method}));
  result.sourcesCurrent=JSON.stringify(result.sources)===JSON.stringify(await hashes());
  result.pass=result.sourcesCurrent&&result.value.pass&&!result.errors.length&&!result.validation&&!result.pageErrors.length;
}catch(e){result.error=e.stack;}finally{await session?.close();}
result.endedUtc=new Date().toISOString();await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({case:which,pass:result.pass,output,error:result.error,validation:result.validation}));process.exitCode=result.pass?0:1;
