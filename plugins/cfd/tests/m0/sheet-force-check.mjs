// A comparison uses one authored box and one frozen physical grid. Every
// independent forward solve starts from uniform inflow after rebuilding the
// actual native surface.
async function comparison(speed){
  const call=(name,args={})=>frameAI.call(name,args);
  await call('scene.new');
  const box=await call('scene.create',{type:'cfd',params:{Speed:speed}});
  const op=(operation,args={})=>call('plugins.command',{id:box.hash,operation,args});
  let previous,baseline;
  return async function measure(label,create){
    if(previous)await call('scene.delete',{ids:[previous]});
    const body=await create(call);
    previous=body.hash;
    const start=performance.now();
    await op('solve-frame',{fidelityBudget:'preview',warmStart:false,...baseline?{pairedWithJob:baseline}:{}});
    let firstFieldMs=null,status;
    for(;;){
      await new Promise(ok=>setTimeout(ok,150));status=await op('results');
      if(firstFieldMs===null&&status.result?.surfaceFields?.available.includes('Drag'))firstFieldMs=performance.now()-start;
      if(status.state==='ready'||status.state==='unconverged')break;
      if(!['queued','solving'].includes(status.state)||performance.now()-start>45*60*1000)
        throw Error(label+' '+JSON.stringify(status.job));
    }
    const r=status.result,v=r.validity;
    const row={label,job:status.job.id,state:status.state,method:r.method,dragN:r.forceLocal.drag,forceWorld:r.forceWorld,
      torqueNm:r.torque,interval:r.uncertainty.ci95Drag,reynolds:r.reynolds,gridHash:v.gridHash,wallTopologyHash:v.wallTopologyHash,
      minCellWidthM:r.minCellWidthM,cells:r.cells,steps:r.steps,stationary:v.stationary,mass:v.maxDivergencePerS,
      closure:v.turbulenceClosure,shape:r.shape?.state??null,initialization:r.initialization.kind,firstFieldMs,elapsedMs:performance.now()-start};
    console.log('CFD live deform '+JSON.stringify(row));
    if(!baseline&&v.stationary)baseline=row.job;
    return row;
  };
}

function plate(thickness){
  // 80 x 60 mm at 17 degrees yaw, offset from body/box symmetry planes.
  const angle=17*Math.PI/180,co=Math.cos(angle),si=Math.sin(angle);
  const corners=[[-40,-30],[40,-30],[40,30],[-40,30]],vertices=[],indices=[];
  for(const d of thickness?[.5*thickness,-.5*thickness]:[0]){
    for(const [y,z] of corners)vertices.push([2.7+d*co-z*si,498.4+y,1.9+d*si+z*co]);
  }
  indices.push(0,1,2,0,2,3);
  if(thickness){
    indices.push(4,6,5,4,7,6);
    for(let i=0;i<4;i++){const j=(i+1)%4;indices.push(i,j+4,j,i,i+4,j+4);}
  }
  return {vertices,indices};
}

export async function verifySheetForce(){
  const measure=await comparison(.009),runs=[];
  for(const [index,thickness] of [0,.2,.1].entries()){
    const {vertices,indices}=plate(thickness);
    const label=thickness?'Closed '+thickness+' mm plate':'Open sheet';
    const result=await measure(label,call=>call('mesh.create',{name:label,vertices:vertices.flat(),indices,storage:index%2?'texture':'auto'}));
    runs.push({...result,thicknessMm:thickness});
  }
  const [sheet,...shells]=runs;
  const errors=shells.map(s=>Math.hypot(...s.forceWorld.map((f,a)=>f-sheet.forceWorld[a]))/Math.hypot(...s.forceWorld));
  return {pass:runs.every(s=>s.stationary&&s.gridHash===sheet.gridHash&&s.dragN>0&&s.mass<1e-6&&s.initialization==='uniform-inflow')&&
    errors.every(v=>v<.03),relativeForceDifferences:errors,runs};
}
