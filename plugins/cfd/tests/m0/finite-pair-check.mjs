// Compare actual time integrals after a shape or inlet edit. Each solve
// independently projects its initial velocity on the rebuilt cut volumes.
export async function verifyFinitePair(){
  const call=(name,args={})=>frameAI.call(name,args);
  await call('scene.new');
  const box=await call('scene.create',{type:'cfd',params:{Speed:1.8}});
  const body=await call('scene.create',{type:'cube'});
  const transform=size=>call('transform.apply',{ids:[body.hash],rotation:[13,27,7],
    position:[-40,460,-35],size,coordinates:'object'});
  await transform([85,79,74]);
  const op=(operation,args={})=>call('plugins.command',{id:box.hash,operation,args});
  async function solve(label,pairedWithJob){
    await op('solve-frame',{fidelityBudget:'preview',warmStart:false,...pairedWithJob?{pairedWithJob}:{}});
    const seen=new Map(),start=performance.now();
    for(;;){
      await new Promise(ok=>setTimeout(ok,60));
      const s=await op('results'),r=s.result;
      if(r&&!seen.has(r.steps))seen.set(r.steps,{steps:r.steps,timeS:r.physicalTimeS,averagedSteps:r.averagedSteps,
        dragN:r.forceLocal.drag,windows:r.completeWindows,paired:r.paired??null});
      if(s.state==='ready'||s.state==='unconverged'){
        const v=r.validity,row={label,id:s.job.id,state:s.state,steps:r.steps,dtS:r.dtS,physicalTimeS:r.physicalTimeS,
          averagedSteps:r.averagedSteps,windows:r.completeWindows,stationary:v.stationary,dragN:r.forceLocal.drag,paired:r.paired,
          initialization:r.initialization.kind,mass:v.maxDivergencePerS,gridHash:v.gridHash,
          pressureHash:v.wallTopologyHash,groupsHash:v.momentumTopologyHash,previousJob:v.previousJob,
          samePressure:v.samePressureConnectivityAsPrev,sameGroups:v.sameMomentumGroupsAsPrev,
          sameDiscretization:v.sameDiscretizationAsPrev,samples:[...seen.values()]};
        console.log('CFD live finite interval '+JSON.stringify({...row,samples:row.samples.length}));
        return row;
      }
      if(!['queued','solving'].includes(s.state)||performance.now()-start>20*60*1000)throw Error(label+' '+JSON.stringify(s.job));
    }
  }
  const original=await solve('original');
  if(original.state!=='unconverged')return {pass:false,reason:'This reference already reached stationary loads.',original};
  const repeat=await solve('independent repeat',original.id);
  await transform([88,78,75]);
  const geometryEdit=await solve('edited body at original speed',original.id);
  await transform([85.2,79,74]);await call('scene.update',{id:box.hash,params:{Speed:3.9}});
  const edit=await solve('edited body at higher speed',original.id);
  await call('scene.update',{id:box.hash,params:{Speed:0}});
  await op('solve-frame',{fidelityBudget:'preview',pairedWithJob:original.id});
  let rest;const started=performance.now();
  do{await new Promise(ok=>setTimeout(ok,50));rest=await op('results');}
  while(['queued','solving'].includes(rest.state)&&performance.now()-started<20000);
  const exact=rest.result?.paired;
  const matched=(s,b)=>{
    const p=s.paired,sub=p.substepsPerBaselineStep;
    const baseline=b.samples.filter(it=>it.paired===null&&it.windows>0);
    const comparisons=s.samples.filter(it=>it.paired?.timeRangeS);
    return Number.isSafeInteger(sub)&&sub>=1&&s.windows===b.windows&&s.steps===sub*b.steps&&s.averagedSteps===sub*b.averagedSteps&&
      Math.abs(s.dtS*sub/b.dtS-1)<1e-12&&s.gridHash===b.gridHash&&s.previousJob===b.id&&p.baselineJob===b.id&&
      p.baselineMomentumTopologyHash===b.groupsHash&&p.baselineWallTopologyHash===b.pressureHash&&p.baselineInitialization===b.initialization&&
      p.timeRangeS[0]===(b.steps-b.averagedSteps)*b.dtS&&p.timeRangeS[1]===b.physicalTimeS&&p.deltaDragN===s.dragN-b.dragN&&
      comparisons.length>=2&&comparisons.every(it=>{
        const prior=baseline.find(v=>v.steps*sub===it.steps&&v.averagedSteps*sub===it.averagedSteps);
        return !prior||(it.paired.deltaDragN===it.dragN-prior.dragN&&it.paired.baselineDragN===prior.dragN);
      })&&s.samples.every(it=>it.paired?.ci95DeltaDragN===null&&
        (it.paired.timeRangeS?it.paired.scope==='matched physical time':it.paired.deltaDragN===null));
  };
  const repeatRelative=Math.abs(repeat.dragN/original.dragN-1);
  return {pass:[repeat,geometryEdit,edit].every(s=>matched(s,original)&&s.mass<1e-6)&&repeatRelative<1e-4&&
    repeat.sameGroups&&repeat.samePressure&&repeat.sameDiscretization&&edit.paired.substepsPerBaselineStep>1&&
    !geometryEdit.sameGroups&&!geometryEdit.sameDiscretization&&rest.state==='ready'&&exact.ci95DeltaDragN===null&&
    exact.deltaDragN===-original.dragN&&exact.timeRangeS[1]===original.physicalTimeS&&
    edit.sameDiscretization===(edit.sameGroups&&edit.samePressure)&&Math.abs(edit.dragN-original.dragN)>Math.abs(original.dragN)*.1,
    repeatRelative,original,repeat,geometryEdit,edit,exact};
}
