import {flowFixture,gradedFixture} from './fixtures.mjs';
import {boxAxes,captureFlowSurfaces,researchSceneContext} from './native-geometry.mjs';
import {runCase} from './flow.mjs';
import {mediumProperties,capturedDomain,flowAxes,vectorInWorld} from '../../plugin.js';
import {ahmedMesh,wakeTunnel} from './ahmed.mjs';
import {rotorParts} from './rotor.mjs';
import {nativeAxialSpin} from './rigid-spin.mjs';

// A native primitive is evaluated and converted to its renderer-backed mesh
// by Frame. Only the scoring stage knows the analytic sphere reference.
export async function benchmarkNativeSphere(device,tier,budgetMs,progress,graded=false,trace=false,globalPressure=false,selection={}){
  const call=(name,args={})=>frameAI.call(name,args);await call('scene.new');
  const context=researchSceneContext(frameEngine);
  const box=await call('scene.create',{type:'cfd',name:'Sphere control volume'});
  const air=mediumProperties('Air',0),speed=100*air.nu/.08;
  await call('scene.update',{id:box.hash,params:{Speed:speed}});
  const sphere=await call('scene.create',{type:'sphere',name:'80 mm reference',params:{diameter:80,'angle approximation':5}});
  await call('transform.set',{ids:[sphere.hash],channel:'position',axis:1,value:100,coordinates:'world'});
  await call('diagnostics.frame',{frames:4});
  const initial=captureFlowSurfaces(device,context,box.hash);
  if(initial.meshes.length!==1||initial.meshes[0].hash!==sphere.hash)throw Error('The solver did not capture the authored sphere');
  const bounds=initial.meshes[0].bounds,extent=bounds.max.map((v,k)=>v-bounds.min[k]);
  if(extent.some(d=>Math.abs(d-.08)>.001))throw Error('Unexpected native sphere extent in metres: '+extent);
  const center=bounds.min.map((v,k)=>(v+bounds.max[k])*.5),capture=captureFlowSurfaces(device,context,box.hash,center);
  const f={...flowFixture('sphere',tier),...selection,U:speed,maxSpeed:speed,rho:air.rho,nu:air.nu,period:.08/speed,
    normalization:.5*air.rho*speed**2*Math.PI*.04**2,budgetMs,trace,globalPressure,geometry:'Frame Sphere primitive evaluated in a CFD Box'};
  const result=selection.solver==='sdf-graph'?await (await import('./graph-flow.mjs')).benchmarkGraph(device,f,progress,capture):
    await runCase(device,graded?gradedFixture(f,tier,mergedBounds(capture.meshes.map(m=>m.bounds))):f,selection.solver??'cartesian-fvm',progress,capture);
  return {...result,sourceExtentM:extent,sourceSignature:capture.signature};
}

function mergedBounds(bounds){
  const min=[Infinity,Infinity,Infinity],max=min.map(v=>-v);
  for(const box of bounds)for(let k=0;k<3;k++){min[k]=Math.min(min[k],box.min[k]);max[k]=Math.max(max[k],box.max[k]);}
  return {min,max};
}

export async function createNativeRotorFixture(device,measuredPlanform=false){
  const call=(name,args={})=>frameAI.call(name,args);await call('scene.new');
  const ctx=researchSceneContext(frameEngine),box=await call('scene.create',{type:'cfd',name:'Static propeller control volume'});
  await call('scene.update',{id:box.hash,params:{Speed:0}});
  const authored=await call('animation.inspect'),end=60,angle=5011*360/60*end/authored.fps,ids=[];
  for(const [index,m] of rotorParts(measuredPlanform).entries()){
    const part=await call('mesh.create',{name:m.name,vertices:Array.from(m.vertices,v=>1000*v),
      indices:Array.from(m.indices),storage:index===1?'texture':'auto'});
    ids.push(part.hash);
  }
  const shaft=await call('scene.group',{ids});
  await call('transform.set',{ids:[shaft.hash],channel:'position',axis:1,value:200,coordinates:'world'});
  for(const [frame,value] of [[0,0],[end,angle]])
    await call('animation.key',{id:shaft.hash,path:'rotation',frame,value:[value,0,0],interpolation:'hard'});
  await call('animation.seek',{frame:0});await call('diagnostics.frame',{frames:4});
  const {capture,motion,assertCurrent}=await nativeAxialSpin(device,ctx,box.hash),diameter=.254;
  if(Math.abs(motion.diameterM/diameter-1)>.005)throw Error('Evaluated APC swept diameter disagrees with its nominal size');
  return {capture,motion,assertCurrent,diameter,boxHash:box.hash};
}

export async function benchmarkNativeRotor(device,tier,progress,selection){
  const {capture,motion,assertCurrent,diameter}=await createNativeRotorFixture(device,selection.measuredPlanform);
  const fluid=mediumProperties('Air',0);
  const rps=Math.abs(motion.omega)/(2*Math.PI);
  const f={...flowFixture('propeller',tier),...selection,sweptDiameterM:motion.diameterM,omega:motion.omega,period:1/rps,nu:fluid.nu,rho:fluid.rho,
    maxSpeed:.5*motion.diameterM*Math.abs(motion.omega),normalization:fluid.rho*rps**2*diameter**4,
    powerNormalization:fluid.rho*rps**3*diameter**5,checkKinematics:assertCurrent,geometry:selection.measuredPlanform?
      'Evaluated keyed UIUC test-specimen chord and pitch, APC design sweep, rake, profiles and hub':
      'Evaluated keyed Frame polygon blades and shaft hub'};
  const grid=selection.graded?gradedFixture(f,tier,mergedBounds(capture.meshes.map(m=>m.bounds))):f;
  const result=await runCase(device,grid,selection.solver??'cartesian-fvm',progress,capture);await assertCurrent();
  return {...result,motion,nominalDiameterM:diameter,sourceSignature:capture.signature};
}

export async function createNativeAhmedFixture(device,reference='ahmed'){
  const call=(name,args={})=>frameAI.call(name,args);await call('scene.new');
  const ctx=researchSceneContext(frameEngine),box=await call('scene.create',{type:'cfd',name:'Ahmed control volume'});
  const air=mediumProperties('Air',0);
  const speed=reference==='ahmed-wake'?768000*air.nu/.288:60;
  await call('scene.update',{id:box.hash,params:{Speed:speed}});
  await call('transform.set',{ids:[box.hash],channel:'size',axis:0,value:1800,coordinates:'world'});
  const body=await call('mesh.create',ahmedMesh());
  // Wind-tunnel mounting drawing, Fig. 1 of Guilmineau et al., ECCOMAS
  // 2016. The drag reference is tared to the body. The measured wake is
  // downstream of the entire mounted model, including its four supports.
  const supports=[];
  if(reference==='ahmed-wake'){
    for(const station of [202,672])for(const z of [-163.5,163.5]){
      const cylinder=await call('scene.create',{type:'cylinder',name:'Ahmed tunnel support',
        params:{diameter:30,height:50,'angle approximation':5}});
      for(const [axis,value] of [[0,station-522],[2,z]]){
        await call('transform.set',{ids:[cylinder.hash],channel:'position',axis,value,coordinates:'world'});
      }
      supports.push({hash:cylinder.hash,station,z});
    }
  }
  await call('diagnostics.frame',{frames:4});
  const source=captureFlowSurfaces(device,ctx,box.hash),mesh=source.meshes.find(m=>m.hash===body.hash);
  if(!mesh||source.meshes.length!==1+supports.length)throw Error('Incomplete evaluated Ahmed tunnel assembly');
  const extent=mesh.bounds.max.map((x,k)=>x-mesh.bounds.min[k]);
  if(extent.some((v,k)=>Math.abs(v-[1.044,.288,.389][k])>.001))throw Error('Native Ahmed dimensions disagree with the reference: '+extent);
  const origin=[mesh.bounds.min[0],mesh.bounds.min[1]-.05,(mesh.bounds.min[2]+mesh.bounds.max[2])*.5];
  const capture=captureFlowSurfaces(device,ctx,box.hash,origin),U=capture.params.Speed;
  const hull=capture.meshes.find(m=>m.hash===body.hash),supportBounds=supports.map(({hash,station,z})=>{
    const cylinder=capture.meshes.find(m=>m.hash===hash);
    if(!cylinder)throw Error('Missing evaluated wind-tunnel support');
    const bounds=cylinder.bounds,lo=[station-15,0,z-15],hi=[station+15,50,z+15];
    if(lo.some((x,k)=>Math.abs(bounds.min[k]-.001*x)>.0001||Math.abs(bounds.max[k]-.001*hi[k])>.0001)){
      throw Error('Evaluated support does not meet the floor and the underside at its measured position');
    }
    return bounds;
  });
  return {capture,hull,extent,U,air,supportBounds,boxHash:box.hash};
}

export async function benchmarkNativeAhmed(device,tier,progress,selection){
  const reference=selection.fixture??'ahmed';
  const {capture,hull,extent,U,air,supportBounds}=await createNativeAhmedFixture(device,reference);
  const f={...flowFixture(reference,tier),...selection,U,maxSpeed:U,period:1.044/U,rho:air.rho,nu:air.nu,normalization:.5*air.rho*U**2*.389*.288,
    geometry:supportBounds.length?'Mounted native Ahmed body and four cylinder supports on the fixed tunnel floor, combined loads':
      'Evaluated native Ahmed polygon surface on a fixed floor, body-only load'};
  const result=selection.solver==='sdf-graph'?await (await import('./graph-flow.mjs')).benchmarkGraph(device,f,progress,capture):
    await runCase(device,selection.graded?gradedFixture(selection.matchedTunnel?wakeTunnel(f):f,tier,hull.bounds):f,selection.solver??'cartesian-fvm',progress,capture);
  return {...result,sourceExtentM:extent,supportBoundsM:supportBounds,sourceSignature:capture.signature};
}

export async function solveCapturedBoxes(device,tier,budgetMs,progress,graded=false,globalPressure=false,settings={}){
  const ctx=researchSceneContext(frameEngine),scene=await frameAI.call('scene.inspect');
  const boxes=scene.objects.filter(n=>n.type==='cfd');if(!boxes.length)throw Error('The saved Frame scene has no CFD Box');
  const cases=[];
  for(const box of boxes){
    const {capture,motion,translation,assertCurrent}=await nativeAxialSpin(device,ctx,box.hash,{allowStationary:true});
    const {Speed,Medium,Altitude}=capture.params,fluid=mediumProperties(Medium,Altitude),omega=motion?.omega??0;
    const U=translation?.relativeSpeedMPerS??Speed,boxInfo={hash:box.hash,name:box.name,parameters:capture.params};
    const scope=motion?'Constant native shaft kinematics at the saved frame':translation?'Common constant native wall translation at the saved frame':'Stationary evaluated geometry at the saved frame';
    const context={box:boxInfo,medium:fluid,scope,experimental:true,sourceSignature:capture.signature,...translation?{translation}:{}};
    const domain=capturedDomain(ctx,box.hash,capture,tier,motion?.axisOriginM,undefined,translation?.basis);
    if(motion&&domain.road)throw Error('A road cannot share an axial rotating reference frame');
    if(translation&&domain.road&&Math.abs(translation.velocityBoxMPerS[1])>1e-8)throw Error('A wall moving normal to the road changes the ground clearance during the solve.');
    if(!capture.meshes.length||!motion&&U===0){
      assertCurrent();
      cases.push({...context,fixture:'scene',kind:'uniform-equilibrium',stable:true,massPassed:true,
        field:{maxDivergencePerS:0,relativeDivergenceMax:0},forceLocalN:[0,0,0],forceWorldN:[0,0,0],meanAxialForceN:0,windows:[],completedSteps:0});
      continue;
    }
    const diameter=motion?.diameterM??0,rps=Math.abs(omega)/(2*Math.PI),tip=.5*diameter*Math.abs(omega);
    const maxSpeed=Math.max(U+tip,fluid.nu/domain.h);
    const f={id:'scene',name:'scene',origin:domain.origin,dims:domain.dims,h:domain.h,rho:fluid.rho,nu:fluid.nu,U,ambientSpeed:Speed,maxSpeed,omega,
      rotor:!!motion,sphere:false,movingRoad:domain.road,laminar:!motion&&U*domain.scale/fluid.nu<200,period:motion?1/rps:domain.scale/maxSpeed,
      checkKinematics:assertCurrent,sweptDiameterM:diameter,implicitOuterSpin:!!motion&&graded&&(settings.implicitOuterSpin||settings.autoOuterSpin),pressureOpen:motion&&U>0?[false,true,true,true,true,true]:undefined,
      budgetMs,periodLimit:settings.periodLimit,globalPressure,coarseSpectral:settings.coarseSpectral,incrementalPressure:settings.incrementalPressure,cutBlockSmoother:settings.cutBlockSmoother,cutCells:!!motion||settings.cutCells,sheetLinks:!!motion||settings.sheetLinks,
      faceHistory:!!motion||settings.faceHistory,fluxEquilibration:settings.fluxEquilibration,prefixForest:settings.prefixForest,groupTransport:settings.groupTransport,linearWallPressure:!!motion||settings.linearWallPressure,wallSpacing:settings.wallSpacing,sstWall:settings.sstWall,
      faceReconstruction:settings.faceReconstruction,subcellSurface:settings.subcellSurface,apertureFlow:!!motion&&settings.apertureFlow,mergeToFluid:settings.mergeToFluid,wakeDistance:settings.wakeDistance,ddes:settings.ddes,
      surfacePressure:settings.surfacePressure,latticeSurfaceWall:settings.latticeSurfaceWall,normalization:motion?fluid.rho*rps**2*diameter**4:1,
      powerNormalization:motion?fluid.rho*rps**3*diameter**5:undefined,geometry:'Visible evaluated occurrences intersecting the saved CFD Box'};
    const mesh=graded&&capture.meshes.length?gradedFixture(f,tier,domain.bodies):f;
    const result=await runCase(device,mesh,settings.solver??'cartesian-fvm',progress,capture);
    const windows=result.windows.slice(-2),authoredAxes=boxAxes(ctx.document.world(box.hash)),axes=flowAxes(authoredAxes,translation?.basis);
    const average=key=>windows.reduce((sum,w)=>sum+w[key],0)/windows.length;
    function frameForces(w){
      const solver=[w.forceN,...w.transverseForcesInBoxN],world=vectorInWorld(solver,axes);
      return {world,local:translation?vectorInWorld(solver,translation.basis):solver};
    }
    const measured=windows.map(frameForces),meanForce=key=>windows.length?[0,1,2].map(a=>measured.reduce((sum,w)=>sum+w[key][a],0)/windows.length):null;
    const forceWorldN=meanForce('world'),forceLocalN=meanForce('local');
    function windowInBox({coefficient,...physical}){
      if(!translation)return motion?{...physical,thrustCoefficient:coefficient}:physical;
      const {local,world}=frameForces(physical);
      const {axialPressureForceN,axialMomentumForceN,torqueXNm,...values}=physical;
      return {...values,relativeWindAxialForceN:physical.forceN,relativeWindPressureForceN:axialPressureForceN,
        relativeWindMomentumForceN:axialMomentumForceN,torqueAboutRelativeWindAxisNm:torqueXNm,
        forceN:local[0],transverseForcesInBoxN:local.slice(1),forceWorldN:world};
    }
    const {mean,relativeError,forcePassed,windows:trace,...study}=result;
    await assertCurrent();cases.push({...study,...context,windows:trace.map(windowInBox),meanAxialForceN:forceLocalN?.[0]??null,
      ...(translation&&result.partialWindow?{partialWindow:windowInBox(result.partialWindow)}:{}),forceLocalN,forceWorldN,
      ...(motion?{motion,rotorMetrics:windows.length?{CT:mean,CP:average('powerCoefficient'),J:U/(rps*diameter),
        axialTorqueNm:average('torqueXNm'),shaftPowerToFluidW:average('shaftPowerToFluidW')}:null}:{}),
    });
  }
  return cases;
}
