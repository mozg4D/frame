import {flowFixture,gradedFixture} from './fixtures.mjs';
import {boxAxes,boxMetric,captureFlowSurfaces,researchSceneContext} from './native-geometry.mjs';
import {runCase} from './flow.mjs';
import {mediumProperties} from './fluid.mjs';
import {LOCAL_BOX} from '../../plugin.js';
import {ahmedMesh} from './ahmed.mjs';
import {rotorParts} from './rotor.mjs';
import {nativeAxialSpin} from './rigid-spin.mjs';

// A native primitive is evaluated and converted to its renderer-backed mesh
// by Frame. Only the scoring stage knows the analytic sphere reference.
export async function benchmarkNativeSphere(device,tier,budgetMs,progress,graded=false,trace=false,globalPressure=false){
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
  const f={...flowFixture('sphere',tier),U:speed,maxSpeed:speed,rho:air.rho,nu:air.nu,period:.08/speed,
    normalization:.5*air.rho*speed**2*Math.PI*.04**2,budgetMs,trace,globalPressure,geometry:'Frame Sphere primitive evaluated in a CFD Box'};
  const result=await runCase(device,graded?gradedFixture(f,tier,mergedBounds(capture.meshes.map(m=>m.bounds))):f,'cartesian-fvm',progress,capture);
  return {...result,sourceExtentM:extent};
}

function mergedBounds(bounds){
  const min=[Infinity,Infinity,Infinity],max=min.map(v=>-v);
  for(const box of bounds)for(let k=0;k<3;k++){min[k]=Math.min(min[k],box.min[k]);max[k]=Math.max(max[k],box.max[k]);}
  return {min,max};
}

export async function benchmarkNativeRotor(device,tier,progress,selection){
  const call=(name,args={})=>frameAI.call(name,args);await call('scene.new');
  const ctx=researchSceneContext(frameEngine),box=await call('scene.create',{type:'cfd',name:'Static propeller control volume'});
  await call('scene.update',{id:box.hash,params:{Speed:0}});
  const authored=await call('animation.inspect'),end=60,angle=5011*360/60*end/authored.fps,ids=[];
  for(const [index,m] of rotorParts().entries()){
    const part=await call('mesh.create',{name:m.name,vertices:Array.from(m.vertices,v=>1000*v),
      indices:Array.from(m.indices),storage:index===1?'texture':'auto'});
    ids.push(part.hash);
  }
  const shaft=await call('scene.group',{ids});
  await call('transform.set',{ids:[shaft.hash],channel:'position',axis:1,value:200,coordinates:'world'});
  for(const [frame,value] of [[0,0],[end,angle]])
    await call('animation.key',{id:shaft.hash,path:'rotation',frame,value:[value,0,0],interpolation:'hard'});
  await call('animation.seek',{frame:0});await call('diagnostics.frame',{frames:4});
  const {capture,motion,assertCurrent}=await nativeAxialSpin(device,ctx,box.hash),fluid=mediumProperties('Air',0),diameter=.254;
  if(Math.abs(motion.diameterM/diameter-1)>.005)throw Error('Evaluated APC swept diameter disagrees with its nominal size');
  const rps=Math.abs(motion.omega)/(2*Math.PI);
  const f={...flowFixture('propeller',tier),...selection,sweptDiameterM:motion.diameterM,omega:motion.omega,period:1/rps,nu:fluid.nu,rho:fluid.rho,
    maxSpeed:.5*motion.diameterM*Math.abs(motion.omega),normalization:fluid.rho*rps**2*diameter**4,
    powerNormalization:fluid.rho*rps**3*diameter**5,checkKinematics:assertCurrent,geometry:'Evaluated keyed Frame polygon blades and shaft hub'};
  const grid=selection.graded?gradedFixture(f,tier,mergedBounds(capture.meshes.map(m=>m.bounds))):f;
  const result=await runCase(device,grid,'cartesian-fvm',progress,capture);await assertCurrent();
  return {...result,motion,nominalDiameterM:diameter,sourceSignature:capture.signature};
}

export async function benchmarkNativeAhmed(device,tier,progress,selection){
  const call=(name,args={})=>frameAI.call(name,args);await call('scene.new');
  const ctx=researchSceneContext(frameEngine),box=await call('scene.create',{type:'cfd',name:'Ahmed control volume'});
  await call('scene.update',{id:box.hash,params:{Speed:60}});
  await call('transform.set',{ids:[box.hash],channel:'size',axis:0,value:1800,coordinates:'world'});
  const body=await call('mesh.create',ahmedMesh());
  await call('diagnostics.frame',{frames:4});
  const source=captureFlowSurfaces(device,ctx,box.hash),mesh=source.meshes[0];
  if(source.meshes.length!==1||mesh.hash!==body.hash)throw Error('Expected one evaluated Ahmed surface in the CFD Box');
  const extent=mesh.bounds.max.map((x,k)=>x-mesh.bounds.min[k]);
  if(extent.some((v,k)=>Math.abs(v-[1.044,.288,.389][k])>.001))throw Error('Native Ahmed dimensions disagree with the reference: '+extent);
  const origin=[mesh.bounds.min[0],mesh.bounds.min[1]-.05,(mesh.bounds.min[2]+mesh.bounds.max[2])*.5];
  const capture=captureFlowSurfaces(device,ctx,box.hash,origin),air=mediumProperties('Air',0);
  const f={...flowFixture('ahmed',tier),...selection,rho:air.rho,nu:air.nu,normalization:.5*air.rho*60**2*.389*.288,
    geometry:'Evaluated native Ahmed polygon surface; fixed wind-tunnel floor, support tare omitted'};
  const result=await runCase(device,selection.graded?gradedFixture(f,tier,mergedBounds(capture.meshes.map(m=>m.bounds))):f,'cartesian-fvm',progress,capture);
  return {...result,sourceExtentM:extent,sourceSignature:capture.signature};
}

// One-level qualification domain around the complete evaluated occurrences.
// Use the box axes and physical sizes, independently of camera or source names.
function sceneDomain(ctx,hash,capture,tier,axisOrigin){
  const metric=boxMetric(ctx.document.world(hash));
  for(let a=0;a<3;a++)metric[12+a]=-axisOrigin[a];
  const boxCorners=Array.from({length:8},(_,k)=>ctx.math.point(metric,LOCAL_BOX.min.map((v,a)=>k&(1<<a)?LOCAL_BOX.max[a]:v)));
  const box=mergedBounds(boxCorners.map(p=>({min:p,max:p}))),bodies=capture.meshes.length?mergedBounds(capture.meshes.map(m=>m.bounds)):box;
  const scale=Math.max(...bodies.max.map((v,k)=>v-bodies.min[k]))||Math.max(...box.max.map((v,k)=>v-box.min[k])),bounds=mergedBounds([box,bodies]);
  const road=capture.params.Medium==='Air'&&capture.params.Ground==='Road';
  const origin=bounds.min.map((v,k)=>k===1&&road?box.min[1]:v-3*scale);
  const extent=bounds.max.map((v,k)=>v+(k===0?8:3)*scale-origin[k]);
  // Cube-aligned bricks, bounded by both per-binding capacity and the
  // one-level GPU study budget. Keep all physical lengths in metres.
  const cap=Math.min(Math.floor(ctx.device.limits.maxStorageBufferBindingSize/32),tier===1?750000:3000000);
  let h=scale/(tier*14),dims;
  do{h=Math.max(h,Math.cbrt(extent.reduce((a,b)=>a*b)/cap));dims=extent.map(v=>Math.max(8,8*Math.ceil(v/(8*h))));
    if(dims.reduce((a,b)=>a*b)<=cap)break;h*=1.025;}while(true);
  return {origin,dims,h,scale,road,bodies};
}

export async function solveCapturedBoxes(device,tier,budgetMs,progress,graded=false,globalPressure=false,settings={}){
  const ctx=researchSceneContext(frameEngine),scene=await frameAI.call('scene.inspect');
  const boxes=scene.objects.filter(n=>n.type==='cfd');if(!boxes.length)throw Error('The saved Frame scene has no CFD Box');
  const cases=[];
  for(const box of boxes){
    const {capture,motion,assertCurrent}=await nativeAxialSpin(device,ctx,box.hash,{allowStationary:true});
    const domain=sceneDomain(ctx,box.hash,capture,tier,motion?.axisOriginM??[0,0,0]);
    if(motion&&domain.road)throw Error('A road cannot share an axial rotating reference frame');
    const {Speed:U,Medium,Altitude}=capture.params,fluid=mediumProperties(Medium,Altitude),omega=motion?.omega??0;
    const diameter=motion?.diameterM??0,rps=Math.abs(omega)/(2*Math.PI),tip=.5*diameter*Math.abs(omega);
    const maxSpeed=Math.max(U+tip,fluid.nu/domain.h);
    const f={id:'scene',name:'scene',origin:domain.origin,dims:domain.dims,h:domain.h,rho:fluid.rho,nu:fluid.nu,U,maxSpeed,omega,
      rotor:!!motion,sphere:false,movingRoad:domain.road,laminar:!motion&&U*domain.scale/fluid.nu<200,period:motion?1/rps:domain.scale/maxSpeed,
      checkKinematics:assertCurrent,sweptDiameterM:diameter,implicitOuterSpin:!!motion&&graded&&(settings.implicitOuterSpin||settings.autoOuterSpin),pressureOpen:motion&&U>0?[false,true,true,true,true,true]:undefined,
      budgetMs,globalPressure,cutCells:!!motion||settings.cutCells,sheetLinks:!!motion||settings.sheetLinks,
      faceHistory:!!motion||settings.faceHistory,linearWallPressure:!!motion||settings.linearWallPressure,wallSpacing:settings.wallSpacing,sstWall:settings.sstWall,
      faceReconstruction:settings.faceReconstruction,normalization:motion?fluid.rho*rps**2*diameter**4:1,
      powerNormalization:motion?fluid.rho*rps**3*diameter**5:undefined,geometry:'Visible evaluated occurrences intersecting the saved CFD Box'};
    const mesh=graded&&capture.meshes.length?gradedFixture(f,tier,domain.bodies):f;
    const result=await runCase(device,mesh,'cartesian-fvm',progress,capture);
    const windows=result.windows.slice(-2),axes=boxAxes(ctx.document.world(box.hash));
    const average=key=>windows.reduce((sum,w)=>sum+w[key],0)/windows.length;
    const forceLocalN=windows.length?[0,1,2].map(k=>windows.reduce((sum,w)=>sum+(k===0?w.forceN:w.transverseForcesInBoxN[k-1]),0)/windows.length):null;
    const forceWorldN=forceLocalN?.map((_,k)=>forceLocalN.reduce((sum,v,a)=>sum+v*axes[a][k],0))??null;
    const {mean,relativeError,forcePassed,windows:trace,...study}=result;
    await assertCurrent();cases.push({...study,windows:trace.map(({coefficient,...physical})=>motion?{...physical,thrustCoefficient:coefficient}:physical),meanAxialForceN:forceLocalN?.[0]??null,
      box:{hash:box.hash,name:box.name,parameters:capture.params},medium:fluid,forceLocalN,forceWorldN,
      ...(motion?{motion,rotorMetrics:windows.length?{CT:mean,CP:average('powerCoefficient'),J:U/(rps*diameter),
        axialTorqueNm:average('torqueXNm'),shaftPowerToFluidW:average('shaftPowerToFluidW')}:null}:{}),
      scope:motion?'Constant native shaft kinematics at the saved frame':'Stationary evaluated geometry at the saved frame',experimental:true,sourceSignature:capture.signature});
  }
  return cases;
}
