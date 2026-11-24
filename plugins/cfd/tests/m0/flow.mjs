import {gpuScope} from './gpu.mjs';
import {flowFixture,geometryKernel,gradedFixture,gridWGSL,references} from './fixtures.mjs';
import {cartesianSolver,faceBalanceWGSL} from './fvm.mjs';
import {momentSolver} from './mr-lbm.mjs';
import {wakeLength} from './wake.mjs';
import {viewportBudget} from './viewport-budget.mjs';
import {cellWidth,metricWGSL,metricBuffer} from './rectilinear.mjs';

// A bounded trial reports time to target only after completing its physical windows.
export const caseBudgetMs=120000;

export function viewportMonitor(){
  const intervals=[],gpuMs=[],cpuMs=[];let frameId=-1,previous=null,pending=0,stopped=false,drawError=null,rafTime=performance.now();
  function tick(t){
    if(stopped)return;rafTime=t;
    const sample=frameEngine.renderer.lastFrameRaw;
    if(sample&&sample.id!==frameId){
      frameId=sample.id;if(previous!==null)intervals.push(t-previous);previous=t;
      gpuMs.push(sample.gpuMs);cpuMs.push(sample.cpuMs);
    }
    Promise.resolve(frameEngine.draw(true)).catch(e=>{drawError=e.message;});
    pending=requestAnimationFrame(tick);
  }
  pending=requestAnimationFrame(tick);
  const stop=()=>{stopped=true;cancelAnimationFrame(pending);
    const p95=a=>a.length?[...a].sort((x,y)=>x-y)[Math.ceil(.95*a.length)-1]:null;
    const fps=intervals.length?1000*intervals.length/intervals.reduce((a,b)=>a+b,0):null;
    return {fps,frames:intervals.length,p95IntervalMs:p95(intervals),p95GpuMs:p95(gpuMs),p95CpuMs:p95(cpuMs),drawError,
      qualified:!drawError&&intervals.length>=15&&fps>=59.5&&p95(intervals)<=17.2};
  };
  return Object.assign(stop,{lastFrame:()=>rafTime});
}

export function settledPeriods(windows,requireWake=false){
  if(windows.length<8)return false;
  const recent=windows.slice(-6);
  function stationary(key){
    const v=recent.map(w=>w[key]);if(!v.every(Number.isFinite))return false;
    const a=(v[0]+v[1]+v[2])/3,b=(v[3]+v[4]+v[5])/3,scale=Math.max(Math.abs(a),Math.abs(b));
    return scale===0||Math.abs(a-b)<.005*scale&&Math.max(...v.slice(3))-Math.min(...v.slice(3))<.02*scale;
  }
  return stationary('coefficient')&&(!requireWake||stationary('wakeLengthM'))&&
    (recent.at(-1).powerCoefficient===undefined||stationary('powerCoefficient'));
}

export async function sumForce(gpu,force,count,components=1){
  const type=components===1?'f32':'vec4f';
  const n=Math.ceil(count/128),partials=gpu.buffer('CFD window force sums',n*4*components),stage=gpu.staging('CFD window sums readback',n*4*components);
  const pipeline=await gpu.kernel('CFD force reduction',`
    @group(0) @binding(0) var<storage,read> f:array<${type}>; @group(0) @binding(1) var<storage,read_write> sums:array<${type}>;
    var<workgroup> w:array<${type},128>;
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u,@builtin(workgroup_id) id:vec3u,@builtin(local_invocation_index) j:u32){
      var x:${type};if(g.x<${count}u){x=f[g.x];}w[j]=x;
      for(var k=64u;k>0u;k/=2u){workgroupBarrier();if(j<k){w[j]+=w[j+k];}}
      if(j==0u){sums[id.x]=w[0];}}`);
  return async()=>{
    gpu.run(pipeline,[force,partials],[n]);const data=await gpu.read(partials,stage,n*components);
    if(components===1)return data.reduce((a,b)=>a+b,0);
    const total=Array(components).fill(0);for(let i=0;i<data.length;i++)total[i%components]+=data[i];return total;
  };
}

// Independent acceptance check in Float64. Copy bounded slabs of numerical
// fluxes after timing the solve. Retain only a maximum and its location.
async function certifyFlux(gpu,solver,f,count,dt){
  const chunk=Math.min(count,32768),stage=gpu.staging('CFD independent flux certificate',64*chunk);
  const [nx,ny]=f.dims;
  let rawMax=0,max=0,worst=-1;
  for(let first=0;first<count;first+=chunk){
    const n=Math.min(chunk,count-first),bytes=32*n,e=gpu.device.createCommandEncoder();
    e.copyBufferToBuffer(solver.flux,32*first,stage,0,bytes);e.copyBufferToBuffer(solver.fluxTail,32*first,stage,bytes,bytes);
    gpu.device.queue.submit([e.finish()]);await stage.mapAsync(GPUMapMode.READ,0,2*bytes);
    try{const range=stage.getMappedRange(0,2*bytes),hi=new Float32Array(range,0,8*n),low=new Float32Array(range,bytes,8*n);
      for(let i=0;i<n;i++){
        const j=8*i;let raw=0,extra=0;for(let a=0;a<3;a++){raw+=hi[j+a]-hi[j+4+a];extra+=low[j+a]-low[j+4+a];}
        const cell=first+i;
        const volume=f.axes?cellWidth(f,0,cell%nx)*cellWidth(f,1,Math.floor(cell/nx)%ny)*cellWidth(f,2,Math.floor(cell/(nx*ny))):1;
        rawMax=Math.max(rawMax,Math.abs(raw)/volume);const imbalance=Math.abs(raw+extra)/volume;
        if(!Number.isFinite(imbalance))throw Error('Nonfinite stored CFD face flow');if(imbalance>max){max=imbalance;worst=first+i;}
      }
    }finally{stage.unmap();}
  }return {maxDivergencePerS:max/dt,rawDivergencePerS:rawMax/dt,worstCell:worst};
}

function windowWake(f,dt,plane,steps,previous=null){
  const [nx,ny]=f.dims,total=steps+(previous?.steps??0);
  const value=i=>(plane[i]+(previous?.plane[i]??0))*f.h/(dt*total);
  return wakeLength(f,nx,ny,(i,j)=>f.sphere?.5*(value(i+nx*j)+value(i+nx*(j-1))):value(i+nx*j));
}

async function sampleFlow(gpu,f,solver,dt,wakeLengthM,wall){
  const count=f.dims.reduce((a,b)=>a*b),groups=Math.ceil(count/128),[nx,ny]=f.dims;
  const result=gpu.buffer('CFD divergence and Courant maxima',groups*8),stage=gpu.staging('CFD diagnostic readback',Math.max(result.size,nx*ny*4,128*4));
  const histogram=gpu.buffer('CFD near-wall y+ histogram',128*4);
  const code=gridWGSL(f)+metricWGSL(f)+faceBalanceWGSL+`
    struct Flux{hi:vec4f,lo:vec4f}
    @group(0) @binding(0) var<storage,read> state:array<vec4f>;
    @group(0) @binding(1) var<storage,read> flux:array<Flux>;
    @group(0) @binding(2) var<storage,read_write> result:array<vec2f>;
    @group(0) @binding(3) var<storage,read> wall:array<vec4f>;
    @group(0) @binding(4) var<storage,read_write> histogram:array<atomic<u32>>;
    @group(0) @binding(5) var<storage,read> tail:array<Flux>;
    var<workgroup> lanes:array<vec2f,128>;
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u,@builtin(local_invocation_index) j:u32,@builtin(workgroup_id) id:vec3u){
      var d=vec2f(0);if(g.x<CELLS){let q=flux[g.x];let dq=tail[g.x];let w=cellWidths(point(g.x));let vol=w.x*w.y*w.z;
        d.x=abs(faceBalance(q.hi.xyz,q.lo.xyz)+faceBalance(dq.hi.xyz,dq.lo.xyz))/vol;let y=wall[g.x].x;
        let moving=${f.rotatingFrame?'vec3f(0.,wall[g.x].yz)*faceAreas(w)':'vec3f(0)'};
        let flows=abs(q.hi.xyz+dq.hi.xyz-moving)+abs(q.lo.xyz+dq.lo.xyz-moving);d.y=.5*(flows.x+flows.y+flows.z)/vol;
        if(y>0.&&y<=1.){let vel=length(state[g.x*2u].xyz-vec3f(0.,wall[g.x].yz))*${f.h/dt};
          let yp=sqrt(vel*y*${f.h/f.nu});atomicAdd(&histogram[u32(clamp(floor(log2(max(yp,0.001))*8.+64.),0.,127.))],1u);}}
      lanes[j]=d;for(var k=64u;k>0u;k/=2u){workgroupBarrier();if(j<k){lanes[j]=max(lanes[j],lanes[j+k]);}}
      if(j==0u){result[id.x]=lanes[0];}}`;
  gpu.run(await gpu.kernel('CFD divergence and wall resolution',code),[solver.state,solver.flux,result,wall,histogram,solver.fluxTail],[groups],metricBuffer(gpu,f));
  const maxima=await gpu.read(result,stage,2*groups);let gpuDivergencePerS=0,maxCourant=0;
  for(let i=0;i<maxima.length;i+=2){gpuDivergencePerS=Math.max(gpuDivergencePerS,maxima[i]/dt);maxCourant=Math.max(maxCourant,maxima[i+1]);}
  const certified=await certifyFlux(gpu,solver,f,count,dt);
  const hist=new Uint32Array((await gpu.read(histogram,stage,128)).buffer),half=hist.reduce((a,b)=>a+b)/2;
  let hits=0;const middle=hist.findIndex(v=>(hits+=v)>=half);
  return {...certified,gpuDivergencePerS,maxCourant,relativeDivergenceMax:certified.maxDivergencePerS*f.period,wakeLengthM,wallYPlusViscousEstimateP50:half?2**((middle+.5-64)/8):null};
}

function rotorTransportStep(f){
  const [dx]=f.minPitch,[,ys,zs]=f.axes;
  let maxRate=0;
  for(let j=0;j<ys.length-1;j++)for(let k=0;k<zs.length-1;k++){
    const dy=ys[j+1]-ys[j],dz=zs[k+1]-zs[k];
    const frameRate=.5*Math.abs(f.omega)*(Math.abs(zs[k]+zs[k+1])/dy+Math.abs(ys[j]+ys[j+1])/dz);
    maxRate=Math.max(maxRate,frameRate+f.maxSpeed*Math.hypot(1/dx,1/dy,1/dz));
  }
  return .65/maxRate;
}

async function stepMonitor(gpu,solver,count){
  const groups=Math.ceil(count/128),maxima=gpu.buffer('CFD step extrema',groups*16),stage=gpu.staging('CFD step extrema readback',groups*16);
  const pipe=await gpu.kernel('CFD finite step diagnostics',`
    @group(0) @binding(0) var<storage,read> cells:array<vec4f>;@group(0) @binding(1) var<storage,read> p:array<f32>;
    @group(0) @binding(2) var<storage,read_write> out:array<vec4f>;var<workgroup> lanes:array<vec4f,128>;
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u,@builtin(local_invocation_index) j:u32,@builtin(workgroup_id) id:vec3u){
      let i=g.x;var v=vec4f(0);if(i<arrayLength(&p)){let u=cells[2u*i];let s=cells[2u*i+1u];v=vec4f(length(u.xyz),abs(p[i]),abs(u.w),abs(s.x));
        v=select(v,vec4f(3e38),(bitcast<vec4u>(v)&vec4u(0x7f800000u))==vec4u(0x7f800000u));}lanes[j]=v;
      for(var d=64u;d>0u;d/=2u){workgroupBarrier();if(j<d){lanes[j]=max(lanes[j],lanes[j+d]);}}if(j==0u){out[id.x]=lanes[0];}}`);
  return async()=>{gpu.run(pipe,[solver.state,solver.pressure,maxima],[groups]);const vals=await gpu.read(maxima,stage,4*groups),peak=[0,0,0,0];
    for(let i=0;i<vals.length;i++)peak[i%4]=Math.max(peak[i%4],vals[i]);return peak;};
}

export async function runCase(device,f,kind,progress,capture=null){
  f={...f,rotatingFrame:f.rotor&&kind==='cartesian-fvm'&&!f.inertialRotor};
  const gpu=gpuScope(device),start=performance.now();
  const count=f.dims.reduce((a,b)=>a*b),cfl=kind==='cartesian-fvm'?(f.rotor?.12:.32):.065;
  const advectiveStep=f.rotatingFrame&&f.axes?rotorTransportStep(f):cfl*f.h/f.maxSpeed;
  const inverseWidth=(f.minPitch??[f.h,f.h,f.h]).map(w=>1/w),inverseNorm=Math.hypot(...inverseWidth);
  const combinedStep=.78/(f.maxSpeed*inverseNorm+2*f.nu*inverseNorm**2);
  const dt=kind==='cartesian-fvm'?Math.min(advectiveStep,.145*f.h**2/f.nu,f.axes?combinedStep:Infinity):advectiveStep,periodSteps=Math.round(f.period/dt),windows=[];
  const budget=f.budgetMs??caseBudgetMs;
  const force=gpu.buffer('CFD window body impulse',count*4);
  const clear=(loads,plane)=>{const e=device.createCommandEncoder();e.clearBuffer(force);if(loads)e.clearBuffer(loads);if(plane)e.clearBuffer(plane);device.queue.submit([e.finish()]);};
  let stopMonitor=viewportMonitor();
  try{
    const finiteVolume=kind==='cartesian-fvm';
    const geom=capture?await (await import('./native-volume.mjs')).nativeFlowGeometry(gpu,f,capture):await geometryKernel(gpu,f,dt,finiteVolume);
    geom.update(0);
    const solver=finiteVolume?await cartesianSolver(gpu,f,dt,geom.wall,force,geom.response):await momentSolver(gpu,f,dt,geom.wall,force);
    const trace=f.trace&&solver.pressure?await stepMonitor(gpu,solver,count):null;
    const reduce=await sumForce(gpu,force,count),otherLoads=solver.loads?await sumForce(gpu,solver.loads,count,4):null;
    const measureWake=!!solver.plane&&(f.sphere||f.name==='ahmed'),requireWake=measureWake&&(f.sphere||f.id==='ahmed-wake');
    const planeStage=measureWake?gpu.staging('CFD complete wake window',solver.plane.size):null;
    await device.queue.onSubmittedWorkDone();
    const setupMs=performance.now()-start;
    const scheduler=solver.phases?viewportBudget(device,stopMonitor.lastFrame):null;
    let step=0,batch=1,maxBatchMs=0,samplesTaken=0;
    let budgetExhausted=false,previousPlane=null,averagedWake=null;
    periods: for(let window=0;window<32;window++){
      clear(solver.loads,measureWake?solver.plane:null);
      // Round cumulative times; each measured rotor window spans one revolution.
      const end=Math.round((window+1)*f.period/dt),first=step;
      while(step<end){
        if(performance.now()-start>=budget){budgetExhausted=true;break periods;}
        geom.assertCurrent?.();const n=Math.min(batch,end-step),since=performance.now();
        for(let j=0;j<n;j++,step++){
          if(f.rotor&&!f.rotatingFrame)geom.update(step);
          if(scheduler)await scheduler.perform(solver.phases(step,window>=3),geom.assertCurrent);else solver.step(step,window>=3);
          if(trace&&(step<4||((step+1)&step)===0)){
            const peak=await trace();progress('step '+(step+1)+' max lattice |u|, |p|, k, omega '+peak.map(x=>x.toExponential(3)).join(' '));
            if(peak.slice(0,2).some(x=>x>1e20))throw Error('Nonfinite or unbounded CFD state at step '+(step+1));
          }
          if(window>=3)samplesTaken++;
        }
        await device.queue.onSubmittedWorkDone();
        const ms=performance.now()-since;maxBatchMs=Math.max(maxBatchMs,ms);
        batch=Math.max(1,Math.min(12,Math.round(0.5*batch+0.5*n*5/Math.max(ms,0.1))));
      }
      const scale=f.rho*f.h**4/(dt**2*(step-first)),forceN=await reduce()*scale;
      const load=otherLoads?(await otherLoads()).map(v=>v*scale):null;
      const coefficient=forceN/f.normalization;
      let isolatedWake=null;
      if(measureWake&&window>=3){const steps=step-first,plane=await gpu.read(solver.plane,planeStage,solver.plane.size/4);
        isolatedWake=windowWake(f,dt,plane,steps);averagedWake=windowWake(f,dt,plane,steps,previousPlane);previousPlane={steps,plane};}
      windows.push({period:window+1,physicalTimeS:step*dt,forceN,coefficient,elapsedMs:performance.now()-start,
        ...measureWake?{wakeLengthM:isolatedWake}:{},
        ...load?{axialPressureForceN:load[0],axialMomentumForceN:forceN-load[0],torqueXNm:load[1],transverseForcesInSolverFrameN:load.slice(2),
          ...f.rotor?{shaftPowerToFluidW:-load[1]*f.omega,powerCoefficient:-load[1]*f.omega/f.powerNormalization}:{}}:{}});
      progress(f.id+' '+kind+' period '+(window+1)+' '+(f.id==='scene'?'axial force (N)':f.rotor?'CT':'CD')+' '+coefficient.toPrecision(5));
      if(!Number.isFinite(coefficient)||settledPeriods(windows,requireWake))break;
    }
    const viewport=stopMonitor();stopMonitor=null;
    const certificationStart=performance.now();
    const field=solver.flux&&samplesTaken?await sampleFlow(gpu,f,solver,dt,averagedWake,geom.wall):null, ref=references[f.id]??{};
    geom.assertCurrent?.();
    const certificationMs=performance.now()-certificationStart;
    const samples=windows.slice(-2).map(w=>w.coefficient), mean=samples.reduce((a,b)=>a+b,0)/samples.length;
    const diverged=windows.some(w=>!Number.isFinite(w.coefficient));
    const relativeError=ref.value?Math.abs(mean/ref.value-1):null,stable=settledPeriods(windows,requireWake);
    const forcePassed=!!ref.value&&stable&&samples.every(v=>Math.abs(v/ref.value-1)<=.05);
    const powers=windows.slice(-2).map(w=>w.powerCoefficient);
    const powerRelativeError=ref.powerCoefficient&&powers.length===2&&powers.every(Number.isFinite)?Math.abs(.5*(powers[0]+powers[1])/ref.powerCoefficient-1):null;
    const expectedWake=ref.wakeM??(ref.wakeDiameters??0)*.08;
    const wakePassed=expectedWake?Number.isFinite(field?.wakeLengthM)&&Math.abs(field.wakeLengthM/expectedWake-1)<=.05:null;
    const qualified=!!references[f.id]&&stable&&(!ref.value||forcePassed)&&wakePassed!==false&&viewport.qualified&&(!solver.flux||(field&&field.relativeDivergenceMax<1e-6));
    const totalMs=performance.now()-start;
    return {fixture:f.id,kind,dims:f.dims,cells:count,hM:f.h,minCellWidthM:f.minPitch,spacing:f.axes?'graded':'uniform',
      geometry:f.geometry,nativeGeometry:geom.stats,rotatingFrame:f.rotatingFrame,dtS:dt,periodSteps,wakePassed,
      setupMs,totalMs,certificationMs,caseBudgetMs:budget,budgetExhausted,completedSteps:step,ownedBufferBytes:gpu.allocatedBytes,windows,mean,relativeError,stable,field,
      timeToStationaryMs:stable?windows.at(-1).elapsedMs:null,
      forcePassed,powerRelativeError,viewport,scheduling:scheduler?.measure(),maxBatchMs,bytesPerStateNode:solver.bytesPerStateNode,residentStateBytes:solver.residentStateBytes,
      globalHaloBytes:solver.globalHaloBytes,sharedBytesPerWorkgroup:solver.tileBytes,diverged,timeToTargetMs:qualified?totalMs:null};
  }finally{stopMonitor?.();gpu.close();}
}

export function scoreContests(cases){
  function contest(kinds,fixtures){
    const qualified=[];
    for(const kind of kinds){
      const runs=fixtures.map(name=>cases.find(c=>c.kind===kind&&c.fixture===name));
      if(runs.every(c=>Number.isFinite(c?.timeToTargetMs)))qualified.push({kind,totalMs:runs.reduce((s,c)=>s+c.timeToTargetMs,0)});
    }
    return qualified.sort((a,b)=>a.totalMs-b.totalMs)[0]??null;
  }
  const bodyAndRotor=contest(['cartesian-fvm','mr-lbm'],['ahmed','propeller']);
  const staticBodies=contest(['cartesian-fvm','sdf-graph'],['sphere','ahmed','ahmed-wake']);
  return {bodyAndRotor,staticBodies,qualified:!!bodyAndRotor&&!!staticBodies};
}

export async function benchmarkFlow(device,progress,graphOnly=false,tier=1,selection={}){
  const cases=[];
  await frameAI.call('scene.create',{type:'cube',name:'CFD viewport timing fixture'});
  await frameAI.call('diagnostics.frame',{frames:8});
  for(const name of ['sphere','ahmed','ahmed-wake','propeller']){
    if(selection.fixture&&selection.fixture!==name)continue;
    const f={...flowFixture(name,tier),inertialRotor:selection.inertialRotor,budgetMs:selection.budgetMs,trace:selection.trace};
    const kinds=name==='sphere'||name==='ahmed-wake'?['cartesian-fvm','sdf-graph']:name==='ahmed'?['cartesian-fvm','mr-lbm','sdf-graph']:['cartesian-fvm','mr-lbm'];
    for(const kind of kinds.filter(k=>(!graphOnly||k==='sdf-graph')&&(!selection.solver||selection.solver===k))){
      device.pushErrorScope('validation');
      try{const grid=selection.graded&&kind==='cartesian-fvm'?gradedFixture(f,tier):f;
        cases.push(kind==='sdf-graph'?await (await import('./graph-flow.mjs')).benchmarkGraph(device,f,progress):await runCase(device,grid,kind,progress));}
      catch(error){cases.push({fixture:name,kind,error:error.message,timeToTargetMs:null});progress(name+' '+kind+' failed: '+error.message);}
      const validation=await device.popErrorScope();
      if(validation)throw Error(validation.message);
    }
  }
  return {references,cases,contests:scoreContests(cases)};
}
