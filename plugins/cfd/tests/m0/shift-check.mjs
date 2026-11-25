// The same native sphere is translated through one physical cell while the
// Cartesian faces stay fixed. Every trial starts from uniform inflow.
export async function verifyGridShift(device,fidelityBudget='standard'){
  const call=(name,args={})=>frameAI.call(name,args),U=.018258982159215297,center=[0,100,0];
  await call('scene.new');const box=await call('scene.create',{type:'cfd',params:{Speed:U}});
  const body=await call('scene.create',{type:'sphere',params:{diameter:80,'angle approximation':5}});
  await call('transform.apply',{ids:[body.hash],position:center,coordinates:'world'});
  const op=(operation,args={})=>call('plugins.command',{id:box.hash,operation,args});
  let seed=0x41c6ce57;
  const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;};
  async function solve(index,offset,baseline){
    const t=performance.now();let firstFieldMs=null;
    await op('solve-frame',{fidelityBudget,warmStart:false,...baseline?{pairedWithJob:baseline}:{}});
    for(;;){
      await new Promise(r=>setTimeout(r,200));const s=await op('results');
      if(firstFieldMs===null&&s.result?.surfaceFields?.available?.includes('Drag'))firstFieldMs=performance.now()-t;
      if(['ready','unconverged'].includes(s.state)){
        const r=s.result,cd=r.forceLocal.drag/(.5*r.medium.rho*U**2*Math.PI*.04**2);
        const value={index,offsetM:offset,state:s.state,cd,steps:r.steps,forceWorld:r.forceWorld,shape:r.shape?.state,
          gridHash:r.validity.gridHash,wallTopologyHash:r.validity.wallTopologyHash,mass:r.validity.maxDivergencePerS,
          cellWidthM:r.minCellWidthM,cells:r.cells,dims:r.dims,stationary:r.validity.stationary,initialization:r.initialization.kind,
          job:s.job.id,firstFieldMs,elapsedMs:performance.now()-t};
        console.log('CFD live shifted sphere '+index+' Cd '+cd.toFixed(6)+' '+value.steps+' steps');return value;
      }
      if(!['queued','solving'].includes(s.state)||performance.now()-t>90*60*1000)throw Error('Subcell translation '+index+' '+JSON.stringify(s.job));
    }
  }
  const base=await solve(-1,[0,0,0],null),runs=[];let parent=base.job;
  for(let i=0;i<32;i++){
    const offset=base.cellWidthM.map(h=>h*random());
    await call('transform.apply',{ids:[body.hash],position:offset.map((d,a)=>center[a]+1000*d),coordinates:'world'});
    const r=await solve(i,offset,parent);runs.push(r);if(r.stationary)parent=r.job;
  }
  const cd=runs.map(s=>s.cd),mean=cd.reduce((a,b)=>a+b)/cd.length;
  const sd=Math.sqrt(cd.reduce((s,x)=>s+(x-mean)**2,0)/(cd.length-1)),variation=sd/Math.abs(mean);
  return {pass:runs.length===32&&variation<.01&&runs.every(s=>s.stationary&&s.gridHash===base.gridHash&&s.mass<1e-6&&s.firstFieldMs>0&&s.initialization==='uniform-inflow'),
    fidelityBudget,referenceRe:100,referenceCd:1.087,seed:'0x41c6ce57',meanCd:mean,sampleStdDevCd:sd,coefficientOfVariation:variation,
    minimumCd:Math.min(...cd),maximumCd:Math.max(...cd),base,runs};
}
export const verifyPreviewGridShift=device=>verifyGridShift(device,'preview');

// Time the default Frame solve to a physical, probeable field on an Ahmed
// body. Keep setup/authoring outside the stopwatch and include all GPU work
// from the solve request to the first valid surface probe.
export async function verifyCarFirstField(){
  const {ahmedMesh}=await import('./ahmed.mjs'),call=(name,args={})=>frameAI.call(name,args);
  await call('scene.new');
  const box=await call('scene.create',{type:'cfd',params:{Speed:60}});
  await call('transform.set',{ids:[box.hash],channel:'size',axis:0,value:1800,coordinates:'world'});
  const mesh=ahmedMesh();await call('mesh.create',mesh);
  await call('diagnostics.frame',{frames:3});
  const op=(operation,args={})=>call('plugins.command',{id:box.hash,operation,args});
  const start=performance.now(),limit=start+90*1000;
  await op('solve-frame');
  try{
    for(;;){
      const status=await op('results'),r=status.result;
      if(r?.surfaceFields?.available?.includes('Pressure')){
        const part=r.surfaceFields.occurrences[0],triangles=part.triangles;
        for(const triangle of [0,Math.floor(triangles/2),triangles-1]){
          const probe=await op('probe',{occurrence:0,triangle});
          if(!(probe.areaM2>0&&probe.pressureCoverage>0)||!Number.isFinite(probe.pressurePa))continue;
          const firstFieldMs=performance.now()-start;
          return {pass:firstFieldMs<=20000&&r.validity.maxDivergencePerS<1e-6&&r.initialization.kind==='projected-uniform-inflow'&&
              r.initialization.maxDivergencePerS<1e-6&&Math.abs(probe.Cp)<5,firstFieldMs,
            cells:r.cells,steps:r.steps,pressurePa:probe.pressurePa,Cp:probe.Cp,initialization:r.initialization,triangle,triangles,coverage:probe.pressureCoverage,
            mass:r.validity.maxDivergencePerS,activeMaps:r.surfaceFields.available};
        }
      }
      if(!['queued','solving'].includes(status.state)||performance.now()>limit)
        throw Error('No first sampled Ahmed surface pressure: '+JSON.stringify(status.job));
      await new Promise(ok=>setTimeout(ok,80));
    }
  }finally{await op('stop');}
}
