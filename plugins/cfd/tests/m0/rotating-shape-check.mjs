import {cartesianSolver,controlVolumeRegion,cutGroups,gpuScope,meshReader,meshResources,modeledTimeShape,
  nativeFlowGeometry,nativeSurfaceMeasures} from '../../plugin.js';
import {createNativeRotorFixture} from './native-case.mjs';
import {rotorParts} from './rotor.mjs';

// Shear the middle of each section axially. The displacements vanish at
// the hub, tip and extreme stations. An unequal change on the two blades
// exercises transverse reaction as well as the axial thrust.
function bladeEdit(mm,patch=null){
  return (vertices,part)=>{
    if(part>1||patch&&patch.part!==part)return;
    const lo=patch?.innerMm??41,hi=patch?.outerMm??90;
    const amplitude=!patch&&part===0 ? 0.42 : 1;
    for(let k=0;k<vertices.length;k+=3){
      const y=vertices[k+1],z=vertices[k+2];
      const span=(Math.abs(y)-lo)/(hi-lo);
      if(span>0&&span<1)vertices[k]+=mm*Math.sin(Math.PI*span)**2*amplitude*Math.sign(y)*z/12;
    }
  };
}

async function observedVertices(gpu,mesh){
  const x=gpu.buffer('Evaluated blade positions in shaft coordinates',12*mesh.vertexCount);
  const pose=gpu.buffer('Evaluated shaft transform',Float32Array.from(mesh.matrix),GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
  const pipeline=await gpu.kernel('CFD observe native blade vertices',meshReader(mesh.storage)+`
    @group(0) @binding(2) var<uniform> pose:mat4x4f;@group(0) @binding(3) var<storage,read_write> x:array<f32>;
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
      let k=3u*g.x;if(k<arrayLength(&x)){let p=pose*vec4f(coord(k),coord(k+1u),coord(k+2u),1.);
        x[k]=p.x;x[k+1u]=p.y;x[k+2u]=p.z;}}`);
  const bind=gpu.device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[
    {binding:0,resource:meshResources(mesh)[0]},{binding:2,resource:{buffer:pose}},{binding:3,resource:{buffer:x}}]});
  const e=gpu.device.createCommandEncoder();gpu.dispatch(e,pipeline,bind,[Math.ceil(mesh.vertexCount/128)]);gpu.device.queue.submit([e.finish()]);
  return gpu.read(x,gpu.staging('Evaluated vertex observations',x.size),x.size/4);
}

export async function verifyNativeRotatingShape(device){
  const dims=[32,40,32],n=dims.reduce((a,b)=>a*b),h=.0037,dt=.000045,steps=12,first=4;
  const origin=[-.05131,-.15173,-.12917],widths=[h,.0079,.0083];
  const axes=dims.map((d,a)=>Float64Array.from({length:d+1},(_,i)=>origin[a]+i*widths[a]));
  async function solve(mm,reverse,patch){
    const {capture,motion}=await createNativeRotorFixture(device,true,bladeEdit(mm,patch));
    const ext=await nativeSurfaceMeasures(device,capture,true),gpu=gpuScope(device);
    const active={...capture,meshes:capture.meshes.map((m,i)=>({...m,bounds:ext.bounds[i]}))};
    const f={dims,h,origin,axes,U:0,maxSpeed:.127*Math.abs(motion.omega),nu:1.46e-5,rho:1.225,rotor:true,
      rotatingFrame:true,omega:motion.omega,period:2*Math.PI/Math.abs(motion.omega),cutCells:true,wallModeled:true,
      groupTransport:true,implicitRadiusM:.14,apertureFlow:true,modeledShape:true,subcellSurface:true,sheetLinks:true,
      faceHistory:true,faceReconstruction:true,linearWallPressure:true,fullMoment:true,regionalLoads:true,
      fluxEquilibration:true,cutBlockSmoother:true,incrementalPressure:true,globalPressure:true};
    const scale=f.rho*h**4/(dt**2*(steps-first)),check=()=>active.assertCurrent();
    const submit=encode=>{const e=device.createCommandEncoder();encode(e);device.queue.submit([e.finish()]);};
    const scheduler={async perform(phases,current){current();submit(e=>{for(const p of phases)p.encode(e);});}};
    try{
      const geom=await nativeFlowGeometry(gpu,f,active,dt),groups=await cutGroups(gpu,f,geom.response,geom.wall);
      const force=gpu.buffer('Native rotor axial impulse',4*n),s=await cartesianSolver(gpu,f,dt,geom.wall,force,geom.response,groups,geom.centers);
      const roi=await controlVolumeRegion(gpu,f,{center:[0,.070,0],halfAxes:[[.09,0,0],[0,.059,0],[0,0,.12]]});
      const stage=gpu.staging('Physical rotor loads and topology',Math.max(s.checkpointSize,48*n)),read=b=>gpu.read(b,stage,b.size/4);
      const snapshot=label=>gpu.buffer(label,s.checkpointSize,GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST);
      const start=reverse?snapshot('Initial physical shaft state'):null;
      if(start)submit(e=>s.capture(e,start));
      const forceLocal={drag:0,lift:0};
      for(let t=0;t<steps;t++){
        const angle=(t+.5)*dt*f.omega;roi.angle(angle);
        submit(e=>{e.clearBuffer(force);e.clearBuffer(s.loads);roi.encode(e);});
        await s.advance(t,false,scheduler,check);
        if(t>=first){
          const axial=await read(force),loads=await read(s.loads),weights=await read(roi.mask);
          for(let i=0;i<n;i++){
            forceLocal.drag+=scale*axial[i];
            forceLocal.lift+=scale*weights[i]*(Math.cos(angle)*loads[4*i+2]-Math.sin(angle)*loads[4*i+3]);
          }
        }
      }
      const openings=(await read(geom.response)).map(v=>v>0?1:0);
      const roots=new Uint32Array((await read(groups.links)).buffer).filter((_,k)=>k%3===0);
      const positions=[],gradient={},metadata={};
      for(const o of geom.cutShape.occurrences)positions.push(await observedVertices(gpu,o.mesh));
      let replay=null;
      if(reverse){
        const history={submit,snapshot,stride:3,anchors:[{step:0,buffer:start}]};
        const copy=snapshot('Terminal physical shaft state');submit(e=>s.capture(e,copy));const terminal=await read(copy);
        for(const [objective,axis] of [['drag',[1,0,0]],['lift',[0,1,0]]]){
          s.forceRegion=objective==='lift'?roi:null;s.forceMask=s.forceRegion?.mask;
          const result=await modeledTimeShape(gpu,f,s,force,geom.cutShape,{...history,stride:objective==='lift'?2:3},
            {steps,averagedSteps:steps-first,dtS:dt,forceLocal},
            {shapeObjective:objective,objectiveWorld:axis,objectiveAxis:axis},scheduler,check,()=>{});
          if(!result.gradient)throw Error('Unresolved native shaft objective '+JSON.stringify(result.shape));
          metadata[objective]=result.shape;const vectors=[];
          for(const o of geom.cutShape.occurrences){
            const out=gpu.buffer('Physical force gradient on original blade vertices',12*o.vertices);
            const range=gpu.buffer('Native blade vertex interval',new Uint32Array([o.first,o.vertices,0,0]),GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
            submit(e=>geom.cutShape.scatter(e,result.gradient,out,range));vectors.push(await read(out));
          }
          gradient[objective]=vectors;
        }
        submit(e=>s.capture(e,copy));const returned=await read(copy);
        submit(e=>s.restore(e,start));for(let t=0;t<steps;t++)await s.replay(t,scheduler,check);
        submit(e=>s.capture(e,copy));const recomputed=await read(copy);
        replay={restored:terminal.every((v,k)=>Object.is(v,returned[k])),identical:terminal.every((v,k)=>Object.is(v,recomputed[k]))};
      }
      console.log('CFD live material blade '+JSON.stringify({mm,forceLocal,mass:s.fluxConvergence.maxDivergencePerS,replay}));
      return {mm,forceLocal,positions,gradient,metadata,openings,roots,replay,mass:s.fluxConvergence.maxDivergencePerS,
        storage:geom.cutShape.occurrences.map(o=>o.mesh.storage),rpm:motion.rpm};
    }finally{gpu.close();}
  }
  const base=await solve(0,true),rows=[];
  const displacements=[.014,.007,.0035].map(stepMm=>({stepMm}));
  for(const part of [0,1])for(const [innerMm,outerMm] of [[41,65],[65,90]]){
    displacements.push({stepMm:.014,patch:{part,innerMm,outerMm}});
  }
  for(const {stepMm,patch} of displacements){
    const minus=await solve(-stepMm,false,patch),plus=await solve(stepMm,false,patch);
    const sameWalls=base.openings.every((v,k)=>v===minus.openings[k]&&v===plus.openings[k]);
    const sameGroups=base.roots.every((v,k)=>v===minus.roots[k]&&v===plus.roots[k]);
    for(const objective of ['drag','lift']){
      let predicted=0;
      for(const [j,g] of base.gradient[objective].entries())for(let k=0;k<g.length;k++)
        predicted+=g[k]*(plus.positions[j][k]-minus.positions[j][k])/(2*stepMm);
      const measured=(plus.forceLocal[objective]-minus.forceLocal[objective])/(2*stepMm);
      rows.push({objective,stepMm,...patch?{patch}:{},sameWalls,sameGroups,predictedNPerMm:predicted,measuredNPerMm:measured,
        relativeError:Math.abs(predicted-measured)/Math.max(1e-15,Math.abs(predicted),Math.abs(measured)),
        mass:Math.max(base.mass,minus.mass,plus.mass)});
    }
  }
  const eligible=rows.filter(row=>row.sameWalls&&row.sameGroups);
  const localPatches=['drag','lift'].map(objective=>{
    const v=eligible.filter(r=>r.objective===objective&&r.patch),count=v.length;
    const mean=key=>v.reduce((s,r)=>s+r[key],0)/count,p=mean('predictedNPerMm'),m=mean('measuredNPerMm');
    let pp=0,mm=0,pm=0,energy=0,error=0;
    for(const r of v){
      const a=r.predictedNPerMm,b=r.measuredNPerMm;
      pp+=(a-p)**2;mm+=(b-m)**2;pm+=(a-p)*(b-m);energy+=b*b;error+=(a-b)**2;
    }
    return {objective,count,correlation:pm/Math.sqrt(pp*mm),relativeL2:Math.sqrt(error/energy)};
  });
  return {pass:base.replay.restored&&base.replay.identical&&Object.values(base.metadata).every(m=>m.pressureDefect<3e-6&&
      m.groupTransportTranspose.maxRelativeDefect<3e-6&&m.iterations===steps&&m.replayedSteps===(m.objective==='lift'?28:21))&&
      ['drag','lift'].every(k=>eligible.filter(r=>!r.patch&&r.objective===k).length>=2)&&eligible.every(r=>r.mass<1e-6)&&
      eligible.filter(r=>!r.patch).every(r=>r.relativeError<.05)&&localPatches.every(v=>v.count===4&&v.correlation>=.9&&v.relativeL2<.05),
    dims,steps,meanSteps:steps-first,dtS:dt,rpm:base.rpm,fields:base.forceLocal,storage:base.storage,
    replay:base.replay,metadata:base.metadata,localPatches,rows};
}

async function publicShaftWindow(device,mm,gradient,fixture,pairedWithJob){
  const {boxHash:id,motion,partHashes}=fixture??await createNativeRotorFixture(device,true,mm?bladeEdit(mm):null);
  const op=(operation,args={})=>frameAI.call('plugins.command',{id,operation,args});
  await op('solve-frame',{fidelityBudget:'preview',warmStart:false,...pairedWithJob?{pairedWithJob}:{}});
  const start=performance.now();let last='';
  for(;;){
    await new Promise(ok=>setTimeout(ok,180));const s=await op('results'),r=s.result,p=s.job?.progress;
    const progress=p?.stage+':'+r?.completeWindows+':'+Math.floor((p?.iterations??0)/128);
    if(p&&progress!==last){last=progress;console.log('CFD live public rotor '+JSON.stringify(p));}
    if(!gradient&&r?.shape&&['solving','ready','unresolved','failed'].includes(r.shape.state)&&r.averagedSteps>0){
      const value={mm,dragN:r.forceLocal.drag,grid:r.validity.gridHash,faces:r.validity.wallTopologyHash,
        groups:r.validity.momentumTopologyHash,steps:r.steps,averagedSteps:r.averagedSteps,dtS:r.dtS,mass:r.validity.maxDivergencePerS};
      if(s.state==='solving')await op('stop');
      return value;
    }
    if(['ready','unconverged'].includes(s.state)){
      if(r.shape?.state!=='ready')return {pass:false,state:s.state,shape:r.shape,result:r};
      await op('shape-map');const parts=[],meshes=rotorParts(true);
      for(const o of r.surfaceFields.occurrences){
        const index=partHashes.indexOf(o.hash),mesh=meshes[index];
        if(!mesh||3*o.vertices!==mesh.vertices.length)throw Error('Native shaft source vertex correspondence changed');
        const source=Array.from(mesh.vertices,x=>1000*x),moved=source.slice();bladeEdit(1)(moved,index);
        let peak=0,derivativeNPerMm=0;
        for(let first=0;first<o.vertices;first+=128){
          const v=await op('shape-gradient',{occurrence:o.occurrence,firstVertex:first,count:Math.min(128,o.vertices-first)});
          if(v.objective!=='drag')throw Error('Unexpected shaft force objective');
          for(const p of v.vertices){
            const k=3*p.vertex,work=p.gradientWorldNPerMm;
            peak=Math.max(peak,Math.hypot(...work));derivativeNPerMm+=work[0]*(moved[k]-source[k]);
          }
        }
        parts.push({occurrence:o.occurrence,objective:'drag',peak,derivativeNPerMm});
      }
      const derivativeNPerMm=parts.reduce((v,p)=>v+p.derivativeNPerMm,0);
      return {pass:r.shape.method==='finite-time-discrete-rotating-sst'&&r.shape.state==='ready'&&r.shape.iterations===r.steps&&
          r.shape.valueN===r.forceLocal.drag&&parts.length===3&&parts.every(p=>p.objective==='drag'&&Number.isFinite(p.peak))&&
          Number.isFinite(derivativeNPerMm)&&parts.some(p=>p.peak>0)&&r.validity.maxDivergencePerS<1e-6,
        id:s.job.id,state:s.state,result:r,parts,derivativeNPerMm,rpm:motion.rpm,elapsedMs:performance.now()-start};
    }
    if(!['queued','solving'].includes(s.state)||performance.now()-start>8*3600000)throw Error('Public shaft Shape '+JSON.stringify(s.job));
  }
}

export function verifyPublicRotatingShape(device){return publicShaftWindow(device,0,true);}

export async function measureRotatingWindowPerturbations(device){
  const samples=[];
  for(const delta of [.014,.007]){
    const lo=await publicShaftWindow(device,-delta,false),hi=await publicShaftWindow(device,delta,false);
    samples.push({delta,lo,hi,secantNPerMm:(hi.dragN-lo.dragN)/(2*delta),
      matched:['grid','faces','groups','steps','averagedSteps','dtS'].every(k=>lo[k]===hi[k])});
    console.log('CFD live full shaft perturbation '+JSON.stringify(samples.at(-1)));
  }
  return {pass:samples.every(r=>r.matched&&Number.isFinite(r.secantNPerMm)&&r.lo.mass<1e-6&&r.hi.mass<1e-6),samples};
}

// Move the existing logical vertices and keep the baseline Box, shaft keys,
// pressure grid and observation interval for every independent force solve.
export async function verifyMatchedShaftShape(device){
  const fixture=await createNativeRotorFixture(device,true),meshes=rotorParts(true),call=(name,args)=>frameAI.call(name,args);
  const blades=[];
  for(let part=0;part<2;part++){
    const m=meshes[part],source=Array.from(m.vertices,v=>1000*v),moved=source.slice();bladeEdit(1)(moved,part);
    const current=await call('mesh.inspect',{id:fixture.partHashes[part],vertices:Array.from({length:source.length/3},(_,i)=>i)});
    const positions=current.vertices.flatMap(v=>v.position);
    blades.push({id:fixture.partHashes[part],positions,indices:Array.from(m.indices),direction:moved.map((v,i)=>v-source[i])});
  }
  const baseline=await publicShaftWindow(device,0,true,fixture),result=baseline.result;
  if(!baseline.pass)return baseline;
  console.log('CFD live resolved shaft baseline '+JSON.stringify({id:baseline.id,derivativeNPerMm:baseline.derivativeNPerMm,
    dims:result.dims,steps:result.steps,CT:result.rotorMetrics.CT,dtS:result.dtS}));
  async function perturb(mm){
    for(const b of blades){
      const changed=await call('mesh.replace',{id:b.id,vertices:b.positions.map((v,i)=>v+mm*b.direction[i]),indices:b.indices});
      b.id=changed.object.hash;
    }
    await call('diagnostics.frame',{frames:2});return publicShaftWindow(device,mm,false,fixture,baseline.id);
  }
  const samples=[];
  for(const delta of [.014,.007]){
    const lo=await perturb(-delta),hi=await perturb(delta),secant=(hi.dragN-lo.dragN)/(2*delta);
    const same=[lo,hi].every(p=>p.grid===result.validity.gridHash&&p.faces===result.validity.wallTopologyHash&&
      p.groups===result.validity.momentumTopologyHash&&p.steps*p.dtS===result.steps*result.dtS&&
      Math.abs(p.averagedSteps*p.dtS-result.averagedSteps*result.dtS)<1e-14);
    const error=Math.abs(baseline.derivativeNPerMm-secant)/Math.max(Math.abs(secant),Math.abs(baseline.derivativeNPerMm),1e-20);
    samples.push({delta,lo,hi,same,secantNPerMm:secant,relativeError:error});
    console.log('CFD live resolved shaft derivative '+JSON.stringify(samples.at(-1)));
  }
  return {pass:result.rotorMetrics.CT>.01&&baseline.pass&&samples.every(s=>s.same&&s.relativeError<.05&&
    s.lo.mass<1e-6&&s.hi.mass<1e-6),baseline,samples};
}
