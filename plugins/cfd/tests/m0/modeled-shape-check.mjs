import {nativeLocalShape} from './local-shape-fixture.mjs';

// Solve through the public operation, including the complete force window.
// Each perturbed mesh is uploaded independently on the retained physical grid.
export async function verifyModeledTimeShape(){
  const call=(name,args={})=>frameAI.call(name,args);
  await call('scene.new');
  const owner=(await call('scene.create',{type:'cfd',params:{Speed:.047}})).hash;
  const op=(operation,args={})=>call('plugins.command',{id:owner,operation,args});
  const base=nativeLocalShape(0),unit=nativeLocalShape(1);let body;
  async function solve(mm,prior){
    if(body)await call('scene.delete',{ids:[body]});
    const shape=nativeLocalShape(mm);body=(await call('mesh.create',{...shape.mesh,storage:'texture'})).hash;
    const start=performance.now();await op('solve-frame',{fidelityBudget:'preview',warmStart:false,...prior?{pairedWithJob:prior}:{}});let status;
    let last=-1;
    for(;;){
      await new Promise(ok=>setTimeout(ok,100));status=await op('results');
      const r=status.result,p=status.job?.progress;
      if(p?.stage==='shape'&&Math.floor(p.iterations/32)>last){
        last=Math.floor(p.iterations/32);console.log('CFD live modeled Shape '+JSON.stringify(p));
      }
      if(['ready','unconverged'].includes(status.state)||prior&&r?.shape?.state==='solving')break;
      if(!['queued','solving'].includes(status.state)||performance.now()-start>30*60*1000)
        throw Error('Physical-time Shape solve '+JSON.stringify(status.job));
    }
    const r=status.result,v=r.validity,record={mm,id:status.job.id,state:status.state,elapsedMs:performance.now()-start,
      volumeMm3:shape.volumeMm3,grid:v.gridHash,pressure:v.wallTopologyHash,groups:v.momentumTopologyHash,
      steps:r.steps,averagedSteps:r.averagedSteps,physicalTimeS:r.physicalTimeS,dtS:r.dtS,
      mass:v.maxDivergencePerS,dragN:r.forceLocal.drag,Re:r.reynolds,shape:r.shape};
    if(prior){if(status.state==='solving')await op('stop');}
    else if(r.shape?.state==='ready'){
      await op('shape-map');const g=[];
      for(let i=0;i<base.mesh.vertices.length/3;i+=128){
        const range=await op('shape-gradient',{occurrence:0,firstVertex:i,count:Math.min(128,base.mesh.vertices.length/3-i)});
        g.push(...range.vertices.flatMap(v=>v.gradientWorldNPerMm));
      }
      const tris=r.surfaceFields.occurrences[0].triangles;
      const sampleIds=[...new Set([0,1,Math.floor(tris/3),Math.floor(2*tris/3),tris-1].filter(t=>t>=0&&t<tris))];
      const probes=[];for(const triangle of sampleIds)probes.push(await op('probe',{occurrence:0,triangle}));
      record.triangleDensity=probes[0].shapeDensityNPerM3;
      record.probedDensities=probes.map(p=>p.shapeDensityNPerM3);
      record.probedPatches=probes.map(p=>p.shapePatchNPerMm);
      record.shapeScale=r.surfaceColorScale?.shapeNPerM3??null;
      record.shapeRegions=r.shapeSensitivitySummary?.length??0;
      record.available=r.surfaceFields.available;
      record.derivative=g.reduce((s,x,k)=>s+x*(unit.mesh.vertices[k]-base.mesh.vertices[k]),0);
    }
    console.log('CFD live modeled time force '+JSON.stringify(record));return record;
  }
  const reference=await solve(0,null),estimates=[];
  if(!Number.isFinite(reference.derivative))return {pass:false,reference};
  for(const mm of [.008,.004]){
    const lo=await solve(-mm,reference.id),hi=await solve(mm,reference.id);
    const secant=(hi.dragN-lo.dragN)/(2*mm),relativeError=Math.abs(secant-reference.derivative)/
      Math.max(Math.abs(secant),Math.abs(reference.derivative),1e-20);
    const same=[lo,hi].every(v=>v.grid===reference.grid&&v.pressure===reference.pressure&&v.groups===reference.groups&&
      v.physicalTimeS===reference.physicalTimeS&&v.averagedSteps===reference.averagedSteps&&v.mass<1e-6&&Math.abs(v.volumeMm3/reference.volumeMm3-1)<1e-12);
    estimates.push({mm,lo,hi,same,secant,relativeError});
  }
  const s=reference.shape;
  return {pass:s.method==='finite-time-discrete-sst'&&s.valueN===reference.dragN&&s.iterations===reference.steps&&
    s.averagedSteps===reference.averagedSteps&&s.timeRangeS[0]===(reference.steps-reference.averagedSteps)*reference.dtS&&
    s.timeRangeS[1]===reference.physicalTimeS&&reference.Re>=200&&reference.available.includes('Shape')&&
    Number.isFinite(reference.triangleDensity)&&reference.probedDensities?.every(Number.isFinite)&&
    reference.probedPatches?.every(Number.isFinite)&&new Set(reference.probedDensities).size>1&&
    reference.shapeScale>0&&s.replayedSteps>0&&reference.mass<1e-6&&estimates.every(x=>x.same&&x.relativeError<.05),
    reference,estimates};
}

export async function verifyModeledRefinement(){
  const call=(name,args={})=>frameAI.call(name,args);await call('scene.new');
  const owner=(await call('scene.create',{type:'cfd',params:{Speed:.047}})).hash;
  await call('mesh.create',nativeLocalShape(0).mesh);
  const op=(operation,args={})=>call('plugins.command',{id:owner,operation,args});
  async function measured(fidelityBudget,parent){
    const start=performance.now();
    await op('solve-frame',{fidelityBudget,...parent?{refineFromJob:parent}:{shapeObjective:'lift'}});
    for(;;){
      await new Promise(ok=>setTimeout(ok,120));const s=await op('results'),r=s.result;
      if(['ready','unconverged'].includes(s.state)){
        if(r.shape?.state!=='ready')throw Error('Unresolved transverse objective '+JSON.stringify(r.shape));
        const v=await op('shape-gradient',{occurrence:0,firstVertex:0,count:12});
        const record={id:s.job.id,state:s.state,cells:r.cells,grid:r.validity.gridHash,dtS:r.dtS,steps:r.steps,
          initialization:r.initialization.kind,range:r.shape.timeRangeS,shape:r.shape,refinement:r.validity.refinement,
          mass:r.validity.maxDivergencePerS,lift:r.forceLocal.lift,gradientObjective:v.objective,
          peakDerivative:Math.max(...v.vertices.map(p=>Math.hypot(...p.gradientWorldNPerMm)))};
        console.log('CFD live modeled refinement '+JSON.stringify(record));return record;
      }
      if(!['queued','solving'].includes(s.state)||performance.now()-start>30*60*1000)throw Error('Refined physical time interval '+JSON.stringify(s.job));
    }
  }
  const root=await measured('preview'),child=await measured('standard',root.id),ref=child.refinement;
  return {pass:[root,child].every(r=>r.shape.objective==='lift'&&r.gradientObjective==='lift'&&r.shape.valueN===r.lift&&
    r.mass<1e-6&&r.peakDerivative>0&&r.initialization==='projected-uniform-inflow'&&
    r.shape.refinementIndicator?.byAxisN.every(v=>v>0&&Number.isFinite(v)))&&
    child.cells>root.cells&&child.cells<=2*root.cells&&root.grid!==child.grid&&ref.parentGridHash===root.grid&&ref.parentJob===root.id&&
    child.range.every((v,i)=>Math.abs(v-root.range[i])<1e-12)&&child.steps%root.steps===0&&
    Math.abs(ref.deltaObjectiveN-(child.lift-root.lift))<1e-18,root,child};
}
