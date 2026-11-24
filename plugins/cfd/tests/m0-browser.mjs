import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {basename,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {ready,serve} from '../../../tools/browser.mjs';
import {verifyShape,verifyGoalRefinement} from './m0/shape.mjs';
import {verifyThinWalls} from './m0/graph-checks.mjs';

const args=process.argv.slice(2), fp32Only=args.includes('--fp32-only');
const reportPath=resolve(args.find(s=>s.startsWith('--out='))?.slice(6) ?? 'tests/results/cfd-m0.json');
const pressureOnly=args.includes('--pressure-only');
const wallOnly=args.includes('--wall-only');
const nativeSphere=args.includes('--native-sphere');
const scenePath=args.find(s=>s.startsWith('--scene='))?.slice(8),saveFixture=args.find(s=>s.startsWith('--save-fixture='))?.slice(15);
if(saveFixture&&!nativeSphere)throw Error('Saving a reference scene requires --native-sphere');
if(scenePath&&(nativeSphere||resolve(scenePath)===reportPath))throw Error('Use a separate report path for a saved scene');
if(saveFixture&&resolve(saveFixture)===reportPath)throw Error('Use separate paths for the reference scene and its report');
const sceneBytes=scenePath?await readFile(scenePath):null;
const experimentalWebNN=args.includes('--experimental-webnn');
const selection={fixture:args.find(s=>s.startsWith('--case='))?.slice(7),solver:args.find(s=>s.startsWith('--solver='))?.slice(9),inertialRotor:args.includes('--inertial-rotor'),graded:args.includes('--graded')};
selection.trace=args.includes('--trace-steps');
if(selection.graded&&selection.inertialRotor)throw Error('Grading around fixed blades requires the rotating reference frame');
const seconds=args.find(s=>s.startsWith('--budget-seconds='))?.slice(17);
if(seconds!==undefined){selection.budgetMs=1000*Number(seconds);if(!Number.isFinite(selection.budgetMs)||selection.budgetMs<=0)throw Error('Expected a positive case budget in seconds');}
if(selection.fixture&&!['sphere','ahmed','ahmed-wake','propeller'].includes(selection.fixture))throw Error('Unknown physical fixture');
if(selection.solver&&!['cartesian-fvm','sdf-graph','mr-lbm'].includes(selection.solver))throw Error('Unknown CFD candidate');
const focused=Boolean(selection.fixture||selection.solver);
const tier=Number(args.find(s=>s.startsWith('--tier='))?.slice(7)??1);
if(![1,2].includes(tier))throw Error('Use --tier=1 or --tier=2');
const report={scope:'Isolated CFD M0 qualification',fp32Only,experimentalWebNN,tier,shape:verifyShape(),goalRefinement:verifyGoalRefinement(),thinWalls:verifyThinWalls()};
if(sceneBytes)report.inputScene={name:basename(scenePath),bytes:sceneBytes.length,sha256:createHash('sha256').update(sceneBytes).digest('hex')};
const sourceNames=['../../../index.html','../../../tools/browser.mjs','../../index.json','../plugin.json','../plugin.js','m0-browser.mjs',
  ...(await readdir(new URL('m0/',import.meta.url))).filter(n=>n.endsWith('.mjs')).sort().map(n=>'m0/'+n)];
async function fingerprint(){const hashes={};for(const name of sourceNames)hashes[name]=createHash('sha256').update(await readFile(new URL(name,import.meta.url))).digest('hex');return hashes;}
report.sources=await fingerprint();
const server=await serve();
let browser;
try{
  if(!report.shape.pass||!report.goalRefinement.pass||!report.thinWalls.pass)throw Error('Shape, refinement or crossing reference failed');
  console.log('Shape: annular force, analytic uniform derivative and 24 paired wall perturbations passed');
  browser=await chromium.launch({headless:true,channel:'chromium',executablePath:process.env.FRAME_BROWSER||undefined,
    args:['--enable-unsafe-webgpu','--disable-background-timer-throttling','--disable-renderer-backgrounding',
      ...experimentalWebNN?['--enable-features=WebMachineLearningNeuralNetwork']:[]]});
  const context=await browser.newContext({viewport:{width:1280,height:900},deviceScaleFactor:1,serviceWorkers:'block'});
  // The optional-feature trial opts in at the single native device request.
  // The fallback trial leaves Frame's descriptor unchanged and removes WebNN.
  await context.addInitScript(forceFp32=>{
    if(forceFp32)Object.defineProperty(navigator,'ml',{get:()=>undefined,configurable:true});
    if(!globalThis.GPUAdapter)return;
    const request=GPUAdapter.prototype.requestDevice;
    window.cfdDeviceRequests=0;
    GPUAdapter.prototype.requestDevice=function(descriptor={}){
      window.cfdDeviceRequests++;
      if(forceFp32)descriptor={...descriptor,requiredFeatures:(descriptor.requiredFeatures??[]).filter(k=>k!=='shader-f16')};
      if(!forceFp32 && this.features.has('shader-f16'))descriptor={...descriptor,requiredFeatures:[...new Set([...(descriptor.requiredFeatures??[]),'shader-f16'])]};
      return request.call(this,descriptor);
    };
  },fp32Only);
  const page=await context.newPage(), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.exposeFunction('cfdProgress',line=>console.log(line));
  await page.goto(server.url+'/index.html');await ready(page);
  const result=await page.evaluate(async({pressureOnly,wallOnly,nativeSphere,savedScene,saveFixture,graphOnly,tier,focused,selection})=>{
    const device=frameEngine.renderer.device, info=device.adapterInfo;
    const hardware=Object.fromEntries(['vendor','architecture','device','description','isFallbackAdapter'].map(k=>[k,info?.[k]]));
    if(info?.isFallbackAdapter!==false || !(info.vendor||info.architecture||info.device||info.description) || /swiftshader|llvmpipe|lavapipe|software/i.test(JSON.stringify(hardware)))throw Error('A verified hardware WebGPU device is required');
    const errors=[];let lost=null;
    device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
    device.lost.then(e=>{lost={reason:e.reason,message:e.message};});
    const piston=await (await import('./plugins/cfd/tests/m0/piston.mjs')).verifyPiston(device,selection.graded);
    if(!piston.pass)throw Error('Immersed pressure/force reference failed: '+JSON.stringify(piston.checks));
    await window.cfdProgress('Frame piston: buffer mesh and paged instance passed pressure, force, visibility and source revision checks');
    const momentum=await (await import('./plugins/cfd/tests/m0/momentum-check.mjs')).verifyMomentum(device,selection.graded);
    if(!momentum.pass)throw Error('Fluid/body impulse mismatch: '+JSON.stringify(momentum));
    await window.cfdProgress('Body impulse agrees with an independent fluid momentum balance on every axis');
    const {benchmarkPressure}=await import('./plugins/cfd/tests/m0/pressure.mjs');
    const pressure=wallOnly||nativeSphere||savedScene||graphOnly||focused?null:await benchmarkPressure(device,navigator.ml,s=>window.cfdProgress(s),tier===2?[64,32,32]:[32,16,16]);
    const progress=s=>window.cfdProgress(s);
    let flow=null;
    if(savedScene){await frameAI.call('scene.open',savedScene);await frameAI.call('diagnostics.frame',{frames:4});
      const cases=await (await import('./plugins/cfd/tests/m0/native-case.mjs')).solveCapturedBoxes(device,tier,selection.budgetMs,progress,selection.graded);
      const {scoreContests}=await import('./plugins/cfd/tests/m0/flow.mjs');flow={cases,contests:scoreContests(cases)};}
    else if(nativeSphere){const c=await (await import('./plugins/cfd/tests/m0/native-case.mjs')).benchmarkNativeSphere(device,tier,selection.budgetMs,progress,selection.graded,selection.trace);
      const {scoreContests}=await import('./plugins/cfd/tests/m0/flow.mjs');flow={cases:[c],contests:scoreContests([c])};}
    else if(!wallOnly&&!pressureOnly)flow=await (await import('./plugins/cfd/tests/m0/flow.mjs')).benchmarkFlow(device,progress,graphOnly,tier,selection);
    if(focused&&!flow?.cases.length)throw Error('No candidate matches the requested case');
    await device.queue.onSubmittedWorkDone();
    const fixture=saveFixture?await frameAI.call('scene.export',{includeData:true}):null;
    return {hardware,deviceRequests:window.cfdDeviceRequests,features:[...device.features],webnn:!!navigator.ml,piston,momentum,pressure,flow,errors,lost,fixture};
  },{pressureOnly,wallOnly,nativeSphere,savedScene:sceneBytes?{name:basename(scenePath),base64:sceneBytes.toString('base64')}:null,saveFixture:!!saveFixture,graphOnly:args.includes('--graph-only'),tier,focused,selection});
  const {fixture}=result;delete result.fixture;
  Object.assign(report,result,{browser:browser.version(),pageErrors:errors});
  if(result.deviceRequests!==1 || result.errors.length || result.lost || errors.length)throw Error('Unexpected device count, loss, browser or GPU errors');
  if(fp32Only && (result.webnn||result.features.includes('shader-f16')))throw Error('Optional backends were enabled in the fallback trial');
  if(saveFixture){await mkdir(dirname(resolve(saveFixture)),{recursive:true});await writeFile(resolve(saveFixture),Buffer.from(fixture.base64,'base64'),{flag:'wx'});}
  if(sceneBytes){report.sceneStudyCompleted=result.flow.cases.every(c=>c.forceWorldN?.every(Number.isFinite)&&c.field&&Number.isFinite(c.field.relativeDivergenceMax));
    if(!report.sceneStudyCompleted)throw Error('Saved scene study did not produce finite completed windows and a flux certificate');}
  report.harnessCompleted=true;
  report.gatePassed=Boolean(result.pressure?.selected&&result.flow?.contests.qualified);
  if(result.pressure)console.log('Pressure:',JSON.stringify(result.pressure.selected));
  if(result.flow)console.log('Physical gate:',JSON.stringify(result.flow.contests));
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{
  await browser?.close();await server.close();
  if(JSON.stringify(await fingerprint())!==JSON.stringify(report.sources)){report.error='Source changed during the benchmark';report.gatePassed=false;process.exitCode=1;}
  await mkdir(dirname(reportPath),{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
  if(report.error)console.error(report.error);
  console.log(reportPath);
}
if(!wallOnly&&!pressureOnly&&!report.sceneStudyCompleted&&!report.gatePassed)process.exitCode=1;
