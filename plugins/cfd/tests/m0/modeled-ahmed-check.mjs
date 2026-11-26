import {cartesianSolver,gpuScope,settledPeriods} from '../../plugin.js';
import {flowFixture,gradedFixture,references} from './fixtures.mjs';
import {createNativeAhmedFixture} from './native-case.mjs';
import {mountedAxialBalance} from './mounted-balance.mjs';
import {runCase} from './flow.mjs';
import {assessSlant} from './wake.mjs';

export function assessMountedAhmed(run,angle){
  const target=references[angle===35?'ahmed-35':'ahmed'],windows=run.windows;
  const balance=windows.slice(-2).map(w=>w.mountedBalance);
  const stationary=settledPeriods(windows.map(w=>({coefficient:w.mountedBalance.bodyCd})));
  const closure=windows.length>0&&windows.every(w=>Math.abs(w.mountedBalance.closureN)<1e-5*Math.max(1,Math.abs(w.forceN)));
  const dragQualified=balance.length===2&&balance.every(b=>{
    const [lo,hi]=b.cellAssignmentRangeCd;
    return .95*target.value<=lo&&lo<=b.bodyCd&&b.bodyCd<=hi&&hi<=1.05*target.value;
  });
  const bodyCd=balance.length===2?(balance[0].bodyCd+balance[1].bodyCd)/2:null;
  const slant=assessSlant(angle,run.slantDiagnostics?.profiles);
  return {pass:!!(run.massPassed&&run.stable&&stationary&&closure&&dragQualified&&slant.observed),
    bodyCd,referenceCd:target.value,bodyRelativeError:bodyCd===null?null:bodyCd/target.value-1,
    bodyStationary:stationary,closure,dragQualified,slant,forceReference:target.source,
    topologyReference:'https://files.eccomasproceedia.org/papers/eccomas-congress-2016/10023.pdf'};
}

async function study(device,angle){
  const id=angle===35?'ahmed-35':'ahmed',length=1.044;
  const {capture,hull,supportBounds,U,air}=await createNativeAhmedFixture(device,id,true);
  const f={...flowFixture(id,1),id:'mounted-'+angle,slantDegrees:angle,slantSampling:true,
    origin:[-1.35*length,0,-1.5],domainEnd:[3.43*length,3,1.5],pressureOpen:[false,true,false,true,true,true],
    U,maxSpeed:U,period:length/U,nu:U*length/4.29e6,rho:air.rho,normalization:.5*air.rho*U*U*.389*.288,
    sheetLinks:true,wallSpacing:true,cutCells:true,mergeToFluid:true,linearWallPressure:true,faceReconstruction:true,faceHistory:true,
    incrementalPressure:true,cutBlockSmoother:true,globalPressure:true,fluxEquilibration:true,ddes:true,sstWall:true,wakeDistance:true,
    projectInflow:true,modeledShape:true,periodLimit:32,budgetMs:5*3600000,balanceBody:hull.hash,
    geometry:'Native Ahmed body and four 30-mm supports on a fixed floor; separate body and support reactions'};
  const bounds={min:[hull.bounds.min[0],0,hull.bounds.min[2]],max:hull.bounds.max},grid=gradedFixture(f,1,bounds);
  const run=await runCase(device,grid,'cartesian-fvm',s=>console.log('CFD live mounted Ahmed '+s),capture,mountedAxialBalance);
  return {...assessMountedAhmed(run,angle),angle,reynolds:U*length/f.nu,supportBounds,
    pressureBoundaryM:{min:f.origin,max:f.domainEnd},run};
}
export const verifyAhmed35=device=>study(device,35);
export const verifyAhmed25=device=>study(device,25);

export async function verifyAhmedObservations(device){
  const gpu=gpuScope(device);
  try{
    const dims=[16,16,16],n=dims.reduce((a,b)=>a*b),dt=.001;
    const f={...flowFixture('sphere',1),dims,h:.01,origin:[-.08,0,-.08],slantSampling:true};
    const solid=gpu.buffer('Empty fluid tunnel',16*n),force=gpu.buffer('Empty body impulse',4*n);
    const mu=gpu.buffer('Open observation faces',new Float32Array(4*n).fill(1));
    const solver=await cartesianSolver(gpu,f,dt,solid,force,mu),input=new Float32Array(8*n);
    for(let i=0;i<n;i++){
      input[8*i]=.12+.008*Math.cos(i*.13);input[8*i+1]=.05*Math.sin(i*.081);input[8*i+3]=1e-8;input[8*i+4]=.001;
    }
    device.queue.writeBuffer(solver.state,0,input);solver.step(0,true);
    const read=b=>gpu.read(b,gpu.staging('Measured symmetry plane',b.size),b.size/4);
    const field=await read(solver.state),plane=await read(solver.plane),size=dims[0]*dims[1];
    let planeError=0,transversePeak=0;
    for(let i=0;i<size;i++)for(const axis of [0,1]){
      const k=8*(i+size*(dims[2]/2-1))+axis,value=plane[axis*size+i];
      planeError=Math.max(planeError,Math.abs(value-.5*(field[k]+field[k+8*size])));
      if(axis===1)transversePeak=Math.max(transversePeak,Math.abs(value));
    }
    const assemblies=[];
    for(const angle of [25,35]){
      const id=angle===25?'ahmed':'ahmed-35',native=await createNativeAhmedFixture(device,id,true);
      const f={...flowFixture(id,1),h:.0125,dims:[96,32,40],origin:[-.08,0,-.25],normalization:1,balanceBody:native.hull.hash};
      const [nx,ny,nz]=f.dims,loads=new Float32Array(nx*ny*nz);
      const at=p=>{const [x,y,z]=p.map((v,a)=>Math.floor((v-f.origin[a])/f.h));return x+nx*(y+ny*z);};
      loads[at([.53,.338,0])]=3;loads[at([.202,.006,.1785])]=-.75;
      const buffer=gpu.buffer('Known body and support impulses',loads);
      const measure=await mountedAxialBalance(gpu,f,buffer,native.capture),clear=await measure(1,2.25);
      loads[at([.217,.05,.1635])]=.5;device.queue.writeBuffer(buffer,0,loads);
      const joint=await measure(1,2.75);
      assemblies.push({angle,supports:native.supportBounds.length,bodyWidthM:native.hull.bounds.max[2]-native.hull.bounds.min[2],clear,joint});
    }
    return {pass:plane.length===2*size&&planeError<1e-6&&transversePeak>.001&&assemblies.every(a=>a.supports===4&&
      Math.abs(a.bodyWidthM-.389)<.001&&a.clear.bodyN===3&&a.clear.stiltsN===-.75&&a.clear.closureN===0&&a.joint.closureN===0&&
      a.joint.cellAssignmentRangeCd[0]<=3&&a.joint.cellAssignmentRangeCd[1]>=3.5),planeError,transversePeak,assemblies};
  }finally{gpu.close();}
}
