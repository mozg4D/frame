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
const nativeAhmed=args.includes('--native-ahmed');
const nativeRotor=args.includes('--native-rotor');
if([nativeSphere,nativeAhmed,nativeRotor].filter(Boolean).length>1)throw Error('Choose a single native CFD reference');
const scenePath=args.find(s=>s.startsWith('--scene='))?.slice(8),saveFixture=args.find(s=>s.startsWith('--save-fixture='))?.slice(15);
if(saveFixture&&!nativeSphere&&!nativeAhmed&&!nativeRotor)throw Error('Saving requires a native reference scene');
if(scenePath&&(nativeSphere||nativeAhmed||nativeRotor||resolve(scenePath)===reportPath))throw Error('Use a separate report path for a saved scene');
if(saveFixture&&resolve(saveFixture)===reportPath)throw Error('Use separate paths for the reference scene and its report');
const sceneBytes=scenePath?await readFile(scenePath):null;
const experimentalWebNN=args.includes('--experimental-webnn');
if(args.includes('--uniform')&&args.includes('--graded'))throw Error('Choose a single Cartesian spacing');
const selection={fixture:args.find(s=>s.startsWith('--case='))?.slice(7),solver:args.find(s=>s.startsWith('--solver='))?.slice(9),inertialRotor:args.includes('--inertial-rotor'),
  graded:args.includes('--graded')||Boolean(scenePath&&!args.includes('--uniform')&&!args.includes('--solver=mr-lbm'))};
selection.trace=args.includes('--trace-steps');
selection.projectionShape=args.includes('--projection-shape');
selection.steadyShape=args.includes('--steady-shape');
selection.region=args.includes('--region');
selection.matchedTunnel=args.includes('--matched-tunnel');
if(selection.matchedTunnel&&(!nativeAhmed||selection.fixture!=='ahmed-wake'||!selection.graded||
  selection.solver&&selection.solver!=='cartesian-fvm'))throw Error('Use the graded native Cartesian Ahmed wake fixture for the matched tunnel');
selection.measuredPlanform=args.includes('--uiuc-planform');
if(selection.measuredPlanform&&(scenePath||nativeSphere||nativeAhmed||selection.fixture&&selection.fixture!=='propeller'))
  throw Error('UIUC planform data apply only when creating the propeller reference geometry');
selection.apertureFlow=args.includes('--aperture-flow');
selection.interpolatedWall=args.includes('--interpolated-lattice-wall');
selection.latticeSurfaceWall=args.includes('--lattice-surface-wall');
if(selection.latticeSurfaceWall&&(selection.interpolatedWall||!wallOnly&&(selection.solver!=='mr-lbm'||!scenePath&&!nativeRotor&&!nativeAhmed&&!nativeSphere)))
  throw Error('Lattice surface forcing requires a native uniform-lattice reference or its manufactured wall control');
if(selection.interpolatedWall&&!wallOnly&&!(selection.solver==='mr-lbm'&&(nativeAhmed||nativeSphere||selection.fixture==='ahmed')))
  throw Error('Select the stationary Ahmed MR-LBM case or the manufactured wall check for interpolated links');
if(selection.inertialRotor&&(nativeRotor||scenePath))throw Error('Captured shaft motion uses its verified rotating frame');
const layerArg=args.find(a=>a.startsWith('--graph-wall-mm='));
const tangentArg=args.find(a=>a.startsWith('--graph-tangent-mm='));
if(tangentArg){
  const mm=Number(tangentArg.slice('--graph-tangent-mm='.length));
  if(selection.solver!=='sdf-graph'||!Number.isFinite(mm)||mm<=0)throw Error('Graph tangential spacing must be a positive distance in millimetres');
  selection.graphTangentM=.001*mm;
}
if(layerArg){
  const mm=layerArg.slice('--graph-wall-mm='.length).split(',').map(x=>x.trim()===''?NaN:Number(x));
  if(mm[0]===0)mm.shift();
  if(selection.solver!=='sdf-graph'||!mm.length||mm.some((v,i)=>!Number.isFinite(v)||v<=0||i>0&&v<=mm[i-1]))
    throw Error('Graph wall distances in millimetres must be positive, finite and increasing');
  selection.graphWallLayers=mm.map(v=>v*.001);
}
if(args.includes('--global-pressure')&&args.includes('--local-pressure'))throw Error('Choose a single pressure preconditioner');
selection.coarseSpectral=args.includes('--coarse-spectral');
if(selection.coarseSpectral&&(!selection.graded||args.includes('--local-pressure')))throw Error('The coarse spectral correction needs a graded Cartesian pressure operator');
selection.globalPressure=selection.coarseSpectral||args.includes('--global-pressure')||Boolean(scenePath&&selection.graded&&!args.includes('--local-pressure'));
selection.cutCells=args.includes('--cut-cells');
selection.cutBlockSmoother=args.includes('--cut-block-smoother');
if(selection.cutBlockSmoother&&!wallOnly&&(!selection.graded||!selection.cutCells))throw Error('Coloured cut-brick relaxation needs graded cut volumes');
selection.mergeToFluid=args.includes('--merge-to-fluid');
if(selection.mergeToFluid&&!selection.cutCells)throw Error('Finding connected full-fluid roots requires cut volumes');
selection.subcellSurface=args.includes('--subcell-surface');
selection.surfacePressure=args.includes('--surface-pressure');
if(selection.surfacePressure&&!wallOnly&&!(scenePath||nativeAhmed||nativeRotor))throw Error('Surface pressure needs evaluated native geometry');
if(selection.subcellSurface&&(!selection.cutCells||!wallOnly&&!(nativeAhmed||nativeRotor||scenePath)))throw Error('Subcell integration requires captured cut-volume geometry');
selection.implicitOuterSpin=args.includes('--implicit-outer-spin');
selection.groupTransport=args.includes('--implicit-volume-transport');
if(selection.implicitOuterSpin&&args.includes('--explicit-outer-spin'))throw Error('Choose a single exterior transport scheme');
selection.autoOuterSpin=Boolean(scenePath&&selection.graded&&!args.includes('--explicit-outer-spin'));
if(selection.implicitOuterSpin&&!wallOnly&&(!(nativeRotor||scenePath)||!selection.graded||(!scenePath&&!selection.cutCells)))
  throw Error('Implicit far-field rotation requires a captured rotor and a graded cut-volume domain');
selection.faceHistory=args.includes('--transport-faces');
selection.incrementalPressure=args.includes('--incremental-pressure');
selection.fluxEquilibration=args.includes('--equilibrate-flux');
if(args.includes('--prefix-forest')&&args.includes('--depth-forest'))throw Error('Choose one subtree reduction');
selection.prefixForest=args.includes('--prefix-forest')?true:args.includes('--depth-forest')?false:undefined;
if(selection.prefixForest!==undefined&&!selection.fluxEquilibration)throw Error('Subtree reductions require conservative flux reconstruction');
if(selection.fluxEquilibration&&!wallOnly&&(!selection.cutCells||!selection.graded||!scenePath&&!selection.faceHistory))
  throw Error('Conservative flux reconstruction requires graded cut volumes and transported face flow');
if(selection.incrementalPressure&&!wallOnly&&!scenePath&&!selection.faceHistory)throw Error('Choose transported face flows for the incremental projection');
if(selection.groupTransport&&!wallOnly&&(!selection.graded||!scenePath&&(!selection.cutCells||!selection.faceHistory)))
  throw Error('Implicit merged transport needs graded cut volumes and transported discharges');
selection.linearWallPressure=args.includes('--linear-wall-pressure');
selection.wallSpacing=args.includes('--wall-spacing');
if(selection.wallSpacing&&!selection.graded)throw Error('Surface-focused axis spacing requires a graded Cartesian domain');
selection.sheetLinks=args.includes('--sheet-links');
selection.sstWall=args.includes('--sst-wall');
selection.ddes=args.includes('--ddes');
selection.wakeDistance=selection.ddes||args.includes('--wake-distance');
if(selection.wakeDistance&&!wallOnly&&!nativeAhmed&&!nativeRotor&&!scenePath)throw Error('Exterior wall distances require native geometry');
if(selection.ddes&&!selection.sstWall)throw Error('Shielded SST requires the wall-adjacent SST transport');
if(nativeAhmed&&selection.fixture&&!['ahmed','ahmed-wake'].includes(selection.fixture))throw Error('Choose the drag or wake reference for the native Ahmed body');
selection.faceReconstruction=args.includes('--reconstruct-faces');
if(selection.faceReconstruction&&!selection.cutCells)throw Error('Aperture-centroid transport requires cut volumes');
if(selection.sstWall&&!selection.cutCells)throw Error('The wall-adjacent SST model requires physical cut volumes');
if(selection.sheetLinks&&!selection.cutCells)throw Error('Fluid representative segments require cut-volume geometry');
if(selection.linearWallPressure&&!selection.cutCells)throw Error('Linear wall pressure uses cut-cell face geometry');
if(selection.cutCells&&selection.inertialRotor)throw Error('Cut-volume momentum groups require fixed geometry in the solver frame');
if(selection.graded&&selection.inertialRotor)throw Error('Grading around fixed blades requires the rotating reference frame');
const seconds=args.find(s=>s.startsWith('--budget-seconds='))?.slice(17);
const periods=args.find(s=>s.startsWith('--periods='))?.slice(10);
if(periods!==undefined){selection.periodLimit=Number(periods);
  if(!(selection.periodLimit>0&&selection.periodLimit<=32))throw Error('Choose a physical duration greater than zero and at most 32 periods');}
if(seconds!==undefined){selection.budgetMs=1000*Number(seconds);if(!Number.isFinite(selection.budgetMs)||selection.budgetMs<=0)throw Error('Expected a positive case budget in seconds');}
if(selection.fixture&&!['sphere','ahmed','ahmed-wake','propeller'].includes(selection.fixture))throw Error('Unknown physical fixture');
if(selection.solver&&!['cartesian-fvm','sdf-graph','mr-lbm'].includes(selection.solver))throw Error('Unknown CFD candidate');
if((scenePath||nativeSphere||nativeAhmed||nativeRotor)&&selection.solver==='mr-lbm'&&selection.graded)
  throw Error('Native MR-LBM uses a uniform physical lattice');
if(nativeRotor&&selection.solver==='sdf-graph')throw Error('The graph candidate requires stationary evaluated geometry');
if(scenePath&&selection.solver==='sdf-graph')throw Error('Saved-scene graph qualification needs an independent wall and motion certificate');
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
  const result=await page.evaluate(async({pressureOnly,wallOnly,nativeSphere,nativeAhmed,nativeRotor,savedScene,saveFixture,graphOnly,tier,focused,selection})=>{
    const device=frameEngine.renderer.device, info=device.adapterInfo;
    const hardware=Object.fromEntries(['vendor','architecture','device','description','isFallbackAdapter'].map(k=>[k,info?.[k]]));
    if(info?.isFallbackAdapter!==false || !(info.vendor||info.architecture||info.device||info.description) || /swiftshader|llvmpipe|lavapipe|software/i.test(JSON.stringify(hardware)))throw Error('A verified hardware WebGPU device is required');
    const errors=[];let lost=null;
    device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
    device.lost.then(e=>{lost={reason:e.reason,message:e.message};});
    const fixtureGeometry=selection.measuredPlanform||selection.fixture==='ahmed-wake'?
      await (await import('./plugins/cfd/tests/m0/fixture-geometry-check.mjs')).verifyFixtureGeometry(device):null;
    if(fixtureGeometry&&!fixtureGeometry.pass)throw Error('Reference geometry mismatch: '+JSON.stringify(fixtureGeometry));
    const regularPressure=selection.globalPressure?await (await import('./plugins/cfd/tests/m0/separable-pressure.mjs')).verifySeparablePressure(device):null;
    if(regularPressure&&!regularPressure.pass)throw Error('Whole-domain regular inverse failed: '+JSON.stringify(regularPressure));
    const coarsePressure=selection.coarseSpectral?await (await import('./plugins/cfd/tests/m0/coarse-spectral-check.mjs')).verifyCoarseSpectral(device):null;
    if(coarsePressure&&!coarsePressure.pass)throw Error('Coarse spectral pressure missed the independent force-free pressure solution: '+JSON.stringify(coarsePressure));
    const physicalTime=wallOnly?await (await import('./plugins/cfd/tests/m0/physical-time-check.mjs')).verifyPhysicalTime(device):null;
    if(physicalTime&&!physicalTime.pass)throw Error('Native physical-time wall motion failed: '+JSON.stringify(physicalTime));
    const projectionShape=selection.projectionShape?await (await import('./plugins/cfd/tests/m0/projection-shape-check.mjs')).verifyProjectionShape(device):null;
    if(projectionShape&&!projectionShape.pass)throw Error('Pressure force sensitivity failed the independent cut-plane perturbations: '+JSON.stringify(projectionShape));
    const nativeProjectionShape=selection.projectionShape?await (await import('./plugins/cfd/tests/m0/native-shape-check.mjs')).verifyNativeProjectionShape(device):null;
    const shapeSuite=selection.steadyShape?await import('./plugins/cfd/tests/m0/steady-shape-check.mjs'):null;
    const steadyShape=shapeSuite?{transport:await shapeSuite.verifyMomentumTranspose(device),force:await shapeSuite.verifySteadyForce(device),
      native:await shapeSuite.verifyNativeSteadyForce(device)}:null;
    if(steadyShape&&Object.values(steadyShape).some(v=>!v.pass))throw Error('The steady force adjoint disagrees with paired physical solves: '+JSON.stringify(steadyShape));
    let region=null;
    if(selection.region){
      const cut=await import('./plugins/cfd/tests/m0/region-check.mjs');
      const shape=await import('./plugins/cfd/tests/m0/steady-shape-check.mjs');
      const loss=await import('./plugins/cfd/tests/m0/loss-check.mjs');
      region={volumes:await cut.verifyRegionVolumes(device),wrench:await cut.verifyRegionalWrench(device),
        loss:await loss.verifyRegionalLoss(device),adjoint:await shape.verifyRegionalSteadyForce(device)};
      if(Object.values(region).some(v=>!v.pass))throw Error('Partial CFD box failed independent balances: '+JSON.stringify(region));
    }
    if(nativeProjectionShape&&!nativeProjectionShape.pass)throw Error('Pressure force sensitivity failed the re-authored native vertex perturbations: '+JSON.stringify(nativeProjectionShape));
    if(nativeProjectionShape)await window.cfdProgress('Shape: pressure projection passed independent 3D cut-plane and native vertex perturbations');
    const piston=await (await import('./plugins/cfd/tests/m0/piston.mjs')).verifyPiston(device,selection.graded,selection.globalPressure);
    if(!piston.pass)throw Error('Immersed pressure/force reference failed: '+JSON.stringify(piston.checks));
    await window.cfdProgress('Frame piston: buffer mesh and paged instance passed pressure, force, visibility and source revision checks');
    const momentum=await (await import('./plugins/cfd/tests/m0/momentum-check.mjs')).verifyMomentum(device,selection.graded);
    if(!momentum.pass)throw Error('Fluid/body impulse mismatch: '+JSON.stringify(momentum));
    const latticeWall=selection.interpolatedWall?await (await import('./plugins/cfd/tests/m0/lattice-wall-check.mjs')).verifyLatticeWall(device):null;
    const latticeMotion=selection.solver==='mr-lbm'||wallOnly?
      await (await import('./plugins/cfd/tests/m0/lattice-motion-check.mjs')).verifyLatticeMotion(device):null;
    if(latticeMotion&&!latticeMotion.pass)throw Error('Rotating lattice wall failed physical pose and momentum balance: '+JSON.stringify(latticeMotion));
    const latticeMass=latticeMotion?await (await import('./plugins/cfd/tests/m0/lattice-mass-check.mjs')).verifyLatticeMass(device):null;
    if(latticeMass&&!latticeMass.pass)throw Error('Packed lattice mass disagrees with boundary and reservoir exchanges: '+JSON.stringify(latticeMass));
    const latticeSurface=selection.latticeSurfaceWall?await (await import('./plugins/cfd/tests/m0/lattice-surface-check.mjs')).verifyLatticeSurface(device):null;
    if(latticeSurface&&!latticeSurface.pass)throw Error('Native lattice surface failed area or wrench balance: '+JSON.stringify(latticeSurface));
    if(latticeWall&&!latticeWall.pass)throw Error('Interpolated lattice wall failed Couette velocity or shear: '+JSON.stringify(latticeWall));
    const subcell=selection.subcellSurface?await (await import('./plugins/cfd/tests/m0/subcell-metric-check.mjs')).verifySubcellSurface(device):null;
    if(subcell&&!subcell.pass)throw Error('Subcell slab measure or first moment mismatch: '+JSON.stringify(subcell));
    const skinPressure=selection.surfacePressure?await (await import('./plugins/cfd/tests/m0/surface-pressure-check.mjs')).verifySurfacePressure(device):null;
    if(skinPressure&&!skinPressure.pass)throw Error('Native surface pressure disagrees with the analytic wrench: '+JSON.stringify(skinPressure));
    const loss=selection.surfacePressure?await import('./plugins/cfd/tests/m0/loss-check.mjs'):null;
    const surfaceLoss=loss?{bins:await loss.verifyClosestWallBins(device),dissipation:await loss.verifyDissipation(device)}:null;
    if(surfaceLoss&&(!surfaceLoss.bins.pass||!surfaceLoss.dissipation.pass))throw Error('Surface loss assignment disagrees with physical balances: '+JSON.stringify(surfaceLoss));
    const exteriorMomentum=await (await import('./plugins/cfd/tests/m0/momentum-check.mjs')).verifyMomentum(device,selection.graded,true);
    if(!exteriorMomentum.pass)throw Error('Exterior traction or smooth-wall relation failed: '+JSON.stringify(exteriorMomentum));
    const cutMetric=selection.cutCells?await (await import('./plugins/cfd/tests/m0/cut-metric.mjs')).verifyCutMetric(device):null;
    if(cutMetric&&!cutMetric.pass)throw Error('Inclined-plane face or volume fraction failed: '+JSON.stringify(cutMetric));
    const cutMomentum=selection.cutCells?await (await import('./plugins/cfd/tests/m0/momentum-check.mjs')).verifyMomentum(device,selection.graded,true,true,selection.linearWallPressure,selection.sstWall,selection.faceReconstruction,selection.mergeToFluid):null;
    const wallDistance=selection.wakeDistance?await (await import('./plugins/cfd/tests/m0/wall-distance.mjs')).verifyWallDistance(device):null;
    if(wallDistance&&!wallDistance.pass)throw Error('Physical distance extension disagrees with the analytic sphere: '+JSON.stringify(wallDistance));
    if(cutMomentum&&!cutMomentum.pass)throw Error('Cut-volume fluid/body impulse mismatch: '+JSON.stringify(cutMomentum));
    const affineWall=selection.linearWallPressure?await (await import('./plugins/cfd/tests/m0/momentum-check.mjs')).verifyLinearWallPressure(device,selection.graded):null;
    if(affineWall&&!affineWall.pass)throw Error('Manufactured cut-wall pressure load failed: '+JSON.stringify(affineWall));
    const outerTransport=selection.implicitOuterSpin?await (await import('./plugins/cfd/tests/m0/outer-transport-check.mjs')).verifyOuterTransport(device):null;
    const groupTransport=selection.groupTransport?await (await import('./plugins/cfd/tests/m0/group-transport-check.mjs')).verifyGroupTransport(device):null;
    if(groupTransport&&!groupTransport.pass)throw Error('Merged transport failed the independent finite-volume solve: '+JSON.stringify(groupTransport));
    const incremental=selection.incrementalPressure||selection.fluxEquilibration?
      await (await import('./plugins/cfd/tests/m0/incremental-check.mjs')).verifyIncrementalPressure(device,selection.fluxEquilibration):null;
    const equilibrium=selection.fluxEquilibration?await (await import('./plugins/cfd/tests/m0/flux-equilibration-check.mjs')).verifyFluxEquilibration(device):null;
    if(equilibrium&&!equilibrium.pass)throw Error('Flow reconstruction did not preserve the physical bounds or baffle: '+JSON.stringify(equilibrium));
    const cutRelax=selection.cutBlockSmoother?await (await import('./plugins/cfd/tests/m0/cut-relax-check.mjs')).verifyCutRelaxation(device):null;
    if(cutRelax&&!cutRelax.pass)throw Error('Coloured pressure corrections disagree with independent subdomain solves: '+JSON.stringify(cutRelax));
    if(incremental&&!incremental.pass)throw Error('Incremental pressure changed the force, field or mass balance: '+JSON.stringify(incremental));
    if(outerTransport&&!outerTransport.pass)throw Error('Implicit momentum transport disagrees with the independent solution: '+JSON.stringify(outerTransport));
    const spinningLoad=nativeRotor||savedScene||wallOnly?await (await import('./plugins/cfd/tests/m0/rotating-loads.mjs')).verifyRotatingLoads(device):null;
    const apertureFlow=selection.apertureFlow?await (await import('./plugins/cfd/tests/m0/aperture-predictor-check.mjs')).verifyAperturePredictor(device):null;
    if(apertureFlow&&!apertureFlow.pass)throw Error('Relative aperture flow disagrees with the independent surface integral: '+JSON.stringify(apertureFlow));
    if(spinningLoad&&!spinningLoad.pass)throw Error('Phase-resolved force failed: '+JSON.stringify(spinningLoad));
    const sheet=selection.sheetLinks?await (await import('./plugins/cfd/tests/m0/sheet-check.mjs')).verifySheetLinks(device,selection.graded):null;
    const faceTransport=selection.faceReconstruction?await (await import('./plugins/cfd/tests/m0/face-transport-check.mjs')).verifyFaceTransport(device,selection.graded):null;
    if(faceTransport&&!faceTransport.pass)throw Error('Affine momentum flux or rigid rotation stress failed: '+JSON.stringify(faceTransport));
    if(sheet&&!sheet.pass)throw Error('A displaced pressure segment disagrees with an exact sheet crossing: '+JSON.stringify(sheet));
    await window.cfdProgress('Body impulse agrees with an independent fluid momentum balance on every axis');
    const {benchmarkPressure}=await import('./plugins/cfd/tests/m0/pressure.mjs');
    const pressure=wallOnly||nativeSphere||nativeAhmed||nativeRotor||savedScene||graphOnly||focused?null:await benchmarkPressure(device,navigator.ml,s=>window.cfdProgress(s),tier===2?[64,32,32]:[32,16,16]);
    const progress=s=>window.cfdProgress(s);
    const nativeGraphLinks=selection.solver==='sdf-graph'&&(nativeSphere||nativeAhmed)?
      await (await import('./plugins/cfd/tests/m0/graph-contact-check.mjs')).verifyNativeGraphLinks(device):null;
    if(nativeGraphLinks&&!nativeGraphLinks.pass)throw Error('Native triangles failed the graph crossing check: '+JSON.stringify(nativeGraphLinks));
    let flow=null;
    if(savedScene){await frameAI.call('scene.open',savedScene);await frameAI.call('diagnostics.frame',{frames:4});
      const cases=await (await import('./plugins/cfd/tests/m0/native-case.mjs')).solveCapturedBoxes(device,tier,selection.budgetMs,progress,selection.graded,selection.globalPressure,selection);
      const {scoreContests}=await import('./plugins/cfd/tests/m0/flow.mjs');flow={cases,contests:scoreContests(cases)};}
    else if(nativeSphere){const c=await (await import('./plugins/cfd/tests/m0/native-case.mjs')).benchmarkNativeSphere(device,tier,selection.budgetMs,progress,selection.graded,selection.trace,selection.globalPressure,selection);
      const {scoreContests}=await import('./plugins/cfd/tests/m0/flow.mjs');flow={cases:[c],contests:scoreContests([c])};}
    else if(nativeAhmed){const c=await (await import('./plugins/cfd/tests/m0/native-case.mjs')).benchmarkNativeAhmed(device,tier,progress,selection);
      const {scoreContests}=await import('./plugins/cfd/tests/m0/flow.mjs');flow={cases:[c],contests:scoreContests([c])};}
    else if(nativeRotor){const c=await (await import('./plugins/cfd/tests/m0/native-case.mjs')).benchmarkNativeRotor(device,tier,progress,selection);
      const {scoreContests}=await import('./plugins/cfd/tests/m0/flow.mjs');flow={cases:[c],contests:scoreContests([c])};}
    else if(!wallOnly&&!pressureOnly)flow=await (await import('./plugins/cfd/tests/m0/flow.mjs')).benchmarkFlow(device,progress,graphOnly,tier,selection);
    if(focused&&!flow?.cases.length)throw Error('No candidate matches the requested case');
    await device.queue.onSubmittedWorkDone();
    const fixture=saveFixture?await frameAI.call('scene.export',{includeData:true}):null;
    return {hardware,deviceRequests:window.cfdDeviceRequests,features:[...device.features],webnn:!!navigator.ml,fixtureGeometry,physicalTime,piston,momentum,exteriorMomentum,cutMetric,cutMomentum,wallDistance,affineWall,sheet,faceTransport,nativeGraphLinks,spinningLoad,outerTransport,latticeWall,latticeMotion,latticeMass,latticeSurface,subcell,apertureFlow,skinPressure,surfaceLoss,coarsePressure,groupTransport,incremental,cutRelax,equilibrium,regularPressure,projectionShape,nativeProjectionShape,steadyShape,region,pressure,flow,errors,lost,fixture};
  },{pressureOnly,wallOnly,nativeSphere,nativeAhmed,nativeRotor,savedScene:sceneBytes?{name:basename(scenePath),base64:sceneBytes.toString('base64')}:null,saveFixture:!!saveFixture,graphOnly:args.includes('--graph-only'),tier,focused,selection});
  const {fixture}=result;delete result.fixture;
  Object.assign(report,result,{browser:browser.version(),pageErrors:errors});
  if(result.deviceRequests!==1 || result.errors.length || result.lost || errors.length)throw Error('Unexpected device count, loss, browser or GPU errors');
  if(fp32Only && (result.webnn||result.features.includes('shader-f16')))throw Error('Optional backends were enabled in the fallback trial');
  if(saveFixture){await mkdir(dirname(resolve(saveFixture)),{recursive:true});await writeFile(resolve(saveFixture),Buffer.from(fixture.base64,'base64'),{flag:'wx'});}
  if(sceneBytes){report.sceneStudyCompleted=result.flow.cases.every(c=>c.forceWorldN?.every(Number.isFinite)&&(c.kind==='uniform-equilibrium'?
      c.completedSteps===0&&c.stable&&c.massPassed&&c.forceWorldN.every(v=>v===0):
      c.windows.length>0&&(c.kind==='mr-lbm'?c.windows.every(w=>Number.isFinite(w.latticeMass?.relativeGlobalMassDefect)):Number.isFinite(c.field?.relativeDivergenceMax))));
    report.sceneStudyConverged=result.flow.cases.every(c=>c.stable&&(c.kind==='mr-lbm'?c.latticeMassPassed:c.massPassed));
    if(selection.periodLimit>0&&selection.periodLimit<1){
      report.requestedPartialIntervalCompleted=result.flow.cases.every(c=>{
        if(c.kind==='uniform-equilibrium')return c.completedSteps===0&&c.stable&&c.massPassed;
        const w=c.partialWindow;
        return w&&!c.budgetExhausted&&c.completedSteps===Math.max(1,Math.round(selection.periodLimit*w.sampleCount/w.periodFraction))&&
          Number.isFinite(w.forceN)&&(!c.motion||Number.isFinite(w.shaftPowerToFluidW))&&
          (c.kind==='mr-lbm'?Number.isFinite(w.latticeMass?.relativeGlobalMassDefect):Number.isFinite(c.field?.maxDivergencePerS));
      });
    }
    if(!report.sceneStudyCompleted&&!report.requestedPartialIntervalCompleted)throw Error('Saved scene study did not finish the requested interval with finite loads and a flux certificate');}
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
if(!wallOnly&&!pressureOnly&&!report.sceneStudyCompleted&&!report.requestedPartialIntervalCompleted&&!report.gatePassed)process.exitCode=1;
