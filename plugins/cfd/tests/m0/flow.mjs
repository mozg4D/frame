import {gpuScope} from './gpu.mjs';
import {flowFixture,geometryKernel,gridWGSL,references} from './fixtures.mjs';
import {cartesianSolver} from './fvm.mjs';
import {momentSolver} from './mr-lbm.mjs';
import {wakeLength} from './wake.mjs';

// A bounded trial reports time to target only after completing its physical windows.
export const caseBudgetMs=120000;

export function viewportMonitor(){
  const intervals=[],gpuMs=[],cpuMs=[];let frameId=-1,previous=null,pending=0,stopped=false,drawError=null;
  function tick(t){
    if(stopped)return;
    const sample=frameEngine.renderer.lastFrameRaw;
    if(sample&&sample.id!==frameId){
      frameId=sample.id;if(previous!==null)intervals.push(t-previous);previous=t;
      gpuMs.push(sample.gpuMs);cpuMs.push(sample.cpuMs);
    }
    Promise.resolve(frameEngine.draw(true)).catch(e=>{drawError=e.message;});
    pending=requestAnimationFrame(tick);
  }
  pending=requestAnimationFrame(tick);
  return ()=>{stopped=true;cancelAnimationFrame(pending);
    const p95=a=>a.length?[...a].sort((x,y)=>x-y)[Math.ceil(.95*a.length)-1]:null;
    const fps=intervals.length?1000*intervals.length/intervals.reduce((a,b)=>a+b,0):null;
    return {fps,frames:intervals.length,p95IntervalMs:p95(intervals),p95GpuMs:p95(gpuMs),p95CpuMs:p95(cpuMs),drawError,
      qualified:!drawError&&intervals.length>=15&&fps>=59.5&&p95(intervals)<=17.2};
  };
}

export function settledPeriods(windows){
  if(windows.length<5)return false;
  const v=windows.slice(-3).map(w=>w.coefficient),scale=Math.abs(v.reduce((a,b)=>a+b)/3);
  return Number.isFinite(scale)&&scale>0&&Math.max(...v)-Math.min(...v)<.02*scale;
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

async function sampleFlow(gpu,f,solver,dt,samplesTaken,wall){
  const count=f.dims.reduce((a,b)=>a*b),groups=Math.ceil(count/128),[nx,ny]=f.dims;
  const result=gpu.buffer('CFD divergence maximum',groups*4),stage=gpu.staging('CFD diagnostic readback',Math.max(result.size,nx*ny*4,128*4));
  const histogram=gpu.buffer('CFD near-wall y+ histogram',128*4);
  const code=gridWGSL(f)+`
    struct Flux{hi:vec4f,lo:vec4f}
    @group(0) @binding(0) var<storage,read> state:array<vec4f>;
    @group(0) @binding(1) var<storage,read> flux:array<Flux>;
    @group(0) @binding(2) var<storage,read_write> result:array<f32>;
    @group(0) @binding(3) var<storage,read> wall:array<vec4f>;
    @group(0) @binding(4) var<storage,read_write> histogram:array<atomic<u32>>;
    var<workgroup> w:array<f32,128>;
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u,@builtin(local_invocation_index) j:u32,@builtin(workgroup_id) id:vec3u){
      var d=0.;if(g.x<CELLS){let q=flux[g.x];d=abs(dot(q.hi.xyz-q.lo.xyz,vec3f(1)));let y=wall[g.x].x;
        if(y>0.&&y<=1.){let vel=length(state[g.x*2u].xyz-vec3f(0.,wall[g.x].yz))*${f.h/dt};
          let yp=sqrt(vel*y*${f.h/f.nu});atomicAdd(&histogram[u32(clamp(floor(log2(max(yp,0.001))*8.+64.),0.,127.))],1u);}}
      w[j]=d;for(var k=64u;k>0u;k/=2u){workgroupBarrier();if(j<k){w[j]=max(w[j],w[j+k]);}}
      if(j==0u){result[id.x]=w[0];}}`;
  gpu.run(await gpu.kernel('CFD divergence and wall resolution',code),[solver.state,solver.flux,result,wall,histogram],[groups]);
  const maxDivergencePerS=Math.max(...await gpu.read(result,stage,groups))/dt;
  const hist=new Uint32Array((await gpu.read(histogram,stage,128)).buffer),half=hist.reduce((a,b)=>a+b)/2;
  let hits=0;const middle=hist.findIndex(v=>(hits+=v)>=half);
  const field=await gpu.read(solver.plane,stage,nx*ny);
  const wakeLengthM=wakeLength(f,nx,ny,(i,j)=>{const a=field[i+nx*j];return (f.sphere?.5*(a+field[i+nx*(j-1)]):a)*f.h/(dt*samplesTaken);});
  return {maxDivergencePerS,relativeDivergenceMax:maxDivergencePerS*f.period,wakeLengthM,wallYPlusViscousEstimateP50:half?2**((middle+.5-64)/8):null};
}

async function runCase(device,f,kind,progress){
  f={...f,rotatingFrame:f.rotor&&kind==='cartesian-fvm'&&!f.inertialRotor};
  const gpu=gpuScope(device),start=performance.now();
  const count=f.dims.reduce((a,b)=>a*b),cfl=kind==='cartesian-fvm'?(f.rotor?.12:.32):.065;
  const dt=cfl*f.h/f.maxSpeed, periodSteps=Math.round(f.period/dt), windows=[];
  const budget=f.budgetMs??caseBudgetMs;
  const force=gpu.buffer('CFD window body impulse',count*4);
  const clear=loads=>{const e=device.createCommandEncoder();e.clearBuffer(force);if(loads)e.clearBuffer(loads);device.queue.submit([e.finish()]);};
  let stopMonitor=viewportMonitor();
  try{
    const finiteVolume=kind==='cartesian-fvm',geom=await geometryKernel(gpu,f,dt,finiteVolume);geom.update(0);
    const solver=finiteVolume?await cartesianSolver(gpu,f,dt,geom.wall,force,geom.response):await momentSolver(gpu,f,dt,geom.wall,force);
    const reduce=await sumForce(gpu,force,count),otherLoads=solver.loads?await sumForce(gpu,solver.loads,count,4):null;
    await device.queue.onSubmittedWorkDone();
    const setupMs=performance.now()-start;
    let step=0,batch=1,maxBatchMs=0,samplesTaken=0;
    let budgetExhausted=false;
    periods: for(let window=0;window<12;window++){
      clear(solver.loads);
      // Round cumulative times; each measured rotor window spans one revolution.
      const end=Math.round((window+1)*f.period/dt),first=step;
      while(step<end){
        if(performance.now()-start>=budget){budgetExhausted=true;break periods;}
        const n=Math.min(batch,end-step),since=performance.now();
        for(let j=0;j<n;j++,step++){if(f.rotor&&!f.rotatingFrame)geom.update(step);solver.step(step,window>=3);if(window>=3)samplesTaken++;}
        await device.queue.onSubmittedWorkDone();
        const ms=performance.now()-since;maxBatchMs=Math.max(maxBatchMs,ms);
        batch=Math.max(1,Math.min(12,Math.round(0.5*batch+0.5*n*5/Math.max(ms,0.1))));
      }
      const scale=f.rho*f.h**4/(dt**2*(step-first)),forceN=await reduce()*scale;
      const load=otherLoads?(await otherLoads()).map(v=>v*scale):null;
      const coefficient=forceN/f.normalization;
      windows.push({period:window+1,physicalTimeS:step*dt,forceN,coefficient,elapsedMs:performance.now()-start,
        ...load?{axialPressureForceN:load[0],axialMomentumForceN:forceN-load[0],torqueXNm:load[1],transverseForcesInSolverFrameN:load.slice(2),
          ...f.rotor?{shaftPowerToFluidW:-load[1]*f.omega,powerCoefficient:-load[1]*f.omega/f.powerNormalization}:{}}:{}});
      progress(f.id+' '+kind+' period '+(window+1)+' '+(f.rotor?'CT':'CD')+' '+coefficient.toFixed(4));
      if(!Number.isFinite(coefficient)||settledPeriods(windows))break;
    }
    const field=solver.flux&&samplesTaken?await sampleFlow(gpu,f,solver,dt,samplesTaken,geom.wall):null, ref=references[f.id];
    const viewport=stopMonitor();stopMonitor=null;
    const samples=windows.slice(-2).map(w=>w.coefficient), mean=samples.reduce((a,b)=>a+b,0)/samples.length;
    const diverged=windows.some(w=>!Number.isFinite(w.coefficient));
    const relativeError=ref.value?Math.abs(mean/ref.value-1):null,stable=settledPeriods(windows);
    const forcePassed=!!ref.value&&stable&&samples.every(v=>Math.abs(v/ref.value-1)<=.05);
    const powers=windows.slice(-2).map(w=>w.powerCoefficient);
    const powerRelativeError=ref.powerCoefficient&&powers.length===2&&powers.every(Number.isFinite)?Math.abs(.5*(powers[0]+powers[1])/ref.powerCoefficient-1):null;
    const expectedWake=ref.wakeM??(ref.wakeDiameters??0)*.08;
    const wakePassed=expectedWake?Number.isFinite(field?.wakeLengthM)&&Math.abs(field.wakeLengthM/expectedWake-1)<=.05:null;
    const qualified=stable&&(!ref.value||forcePassed)&&wakePassed!==false&&viewport.qualified&&(!solver.flux||(field&&field.relativeDivergenceMax<1e-6));
    const totalMs=performance.now()-start;
    return {fixture:f.id,kind,dims:f.dims,cells:count,hM:f.h,geometry:f.geometry,rotatingFrame:f.rotatingFrame,dtS:dt,periodSteps,wakePassed,
      setupMs,totalMs,caseBudgetMs:budget,budgetExhausted,completedSteps:step,ownedBufferBytes:gpu.allocatedBytes,windows,mean,relativeError,stable,field,
      timeToStationaryMs:stable?windows.at(-1).elapsedMs:null,
      forcePassed,powerRelativeError,viewport,maxBatchMs,bytesPerStateNode:solver.bytesPerStateNode,residentStateBytes:solver.residentStateBytes,
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
    const f={...flowFixture(name,tier),inertialRotor:selection.inertialRotor,budgetMs:selection.budgetMs};
    const kinds=name==='sphere'||name==='ahmed-wake'?['cartesian-fvm','sdf-graph']:name==='ahmed'?['cartesian-fvm','mr-lbm','sdf-graph']:['cartesian-fvm','mr-lbm'];
    for(const kind of kinds.filter(k=>(!graphOnly||k==='sdf-graph')&&(!selection.solver||selection.solver===k))){
      device.pushErrorScope('validation');
      try{cases.push(kind==='sdf-graph'?await (await import('./graph-flow.mjs')).benchmarkGraph(device,f,progress):await runCase(device,f,kind,progress));}
      catch(error){cases.push({fixture:name,kind,error:error.message,timeToTargetMs:null});progress(name+' '+kind+' failed: '+error.message);}
      const validation=await device.popErrorScope();
      if(validation)throw Error(validation.message);
    }
  }
  return {references,cases,contests:scoreContests(cases)};
}
