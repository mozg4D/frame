import {flowFixture} from './fixtures.mjs';
import {boxAxes,boxMetric,captureFlowSurfaces,researchSceneContext} from './native-geometry.mjs';
import {runCase} from './flow.mjs';
import {mediumProperties} from './fluid.mjs';
import {LOCAL_BOX} from '../../plugin.js';

// A native primitive is evaluated and converted to its renderer-backed mesh
// by Frame. Only the scoring stage knows the analytic sphere reference.
export async function benchmarkNativeSphere(device,tier,budgetMs,progress){
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
    normalization:.5*air.rho*speed**2*Math.PI*.04**2,budgetMs,geometry:'Frame Sphere primitive evaluated in a CFD Box'};
  const result=await runCase(device,f,'cartesian-fvm',progress,capture);
  return {...result,sourceExtentM:extent};
}

function mergedBounds(bounds){
  const min=[Infinity,Infinity,Infinity],max=min.map(v=>-v);
  for(const box of bounds)for(let k=0;k<3;k++){min[k]=Math.min(min[k],box.min[k]);max[k]=Math.max(max[k],box.max[k]);}
  return {min,max};
}

// One-level qualification domain around the complete evaluated occurrences.
// Use the box axes and physical sizes, independently of camera or source names.
function sceneDomain(ctx,hash,capture,tier){
  const metric=boxMetric(ctx.document.world(hash));
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
  return {origin,dims,h,scale,road};
}

export async function solveCapturedBoxes(device,tier,budgetMs,progress){
  const ctx=researchSceneContext(frameEngine),scene=await frameAI.call('scene.inspect');
  const boxes=scene.objects.filter(n=>n.type==='cfd');if(!boxes.length)throw Error('The saved Frame scene has no CFD Box');
  const cases=[];
  for(const box of boxes){
    const capture=captureFlowSurfaces(device,ctx,box.hash),domain=sceneDomain(ctx,box.hash,capture,tier);
    const {Speed:U,Medium,Altitude}=capture.params,fluid=mediumProperties(Medium,Altitude),maxSpeed=Math.max(U,fluid.nu/domain.h);
    const f={id:'scene',name:'scene',origin:domain.origin,dims:domain.dims,h:domain.h,rho:fluid.rho,nu:fluid.nu,U,maxSpeed,omega:0,
      rotor:false,sphere:false,movingRoad:domain.road,laminar:U*domain.scale/fluid.nu<200,period:domain.scale/maxSpeed,
      budgetMs,normalization:1,geometry:'Visible evaluated occurrences intersecting the saved CFD Box'};
    const result=await runCase(device,f,'cartesian-fvm',progress,capture);
    const windows=result.windows.slice(-2),axes=boxAxes(ctx.document.world(box.hash));
    const forceLocalN=windows.length?[0,1,2].map(k=>windows.reduce((sum,w)=>sum+(k===0?w.forceN:w.transverseForcesInSolverFrameN[k-1]),0)/windows.length):null;
    const forceWorldN=forceLocalN?.map((_,k)=>forceLocalN.reduce((sum,v,a)=>sum+v*axes[a][k],0))??null;
    const {mean,relativeError,forcePassed,windows:trace,...study}=result;
    capture.assertCurrent();cases.push({...study,windows:trace.map(({coefficient,...physical})=>physical),meanAxialForceN:mean,
      box:{hash:box.hash,name:box.name,parameters:capture.params},medium:fluid,forceLocalN,forceWorldN,
      scope:'Stationary evaluated geometry at the saved frame',experimental:true,sourceSignature:capture.signature});
  }
  return cases;
}
