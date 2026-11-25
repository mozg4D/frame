// Compare cold and restarted equilibria at the same operating point. Then
// perturb the evaluated wall while keeping the baseline Cartesian hierarchy.
export async function verifyPairedSolve(){
  const call=(op,args={})=>frameAI.call(op,args),trials=[];
  async function scene(speed){
    await call('scene.new');const box=await call('scene.create',{type:'cfd',params:{Speed:speed}});
    const body=await call('scene.create',{type:'sphere',params:{diameter:80,'angle approximation':10}});
    await call('transform.apply',{ids:[body.hash],position:[0,500,0],coordinates:'world'});
    return {box:box.hash,body:body.hash};
  }
  const op=(s,operation,args={})=>call('plugins.command',{id:s.box,operation,args});
  const fidelityBudget='preview';
  async function solve(s,label,pairedWithJob){
    const start=performance.now();await op(s,'solve-frame',{fidelityBudget,...pairedWithJob?{pairedWithJob}:{}});
    let status;
    for(;;){
      await new Promise(r=>setTimeout(r,150));status=await op(s,'results');
      if(status.state==='ready')break;
      if(!['queued','solving'].includes(status.state)||performance.now()-start>18*60*1000)
        throw Error('Paired solve '+label+' '+JSON.stringify({state:status.state,job:status.job,validity:status.result?.validity}));
    }
    const r=status.result,measure={label,job:status.job.id,elapsedMs:performance.now()-start,force:r.forceLocal.drag,
      steps:r.steps,windows:r.completeWindows,validity:r.validity,initialization:r.initialization,paired:r.paired??null,shape:r.shape?.state};
    trials.push(measure);console.log('CFD live paired '+JSON.stringify(measure));return measure;
  }
  const s=await scene(.002),a=await solve(s,'baseline');
  await call('scene.update',{id:s.box,params:{Speed:.0022}});const b=await solve(s,'speed restart');
  await call('scene.update',{id:s.body,params:{diameter:81}});const c=await solve(s,'resized sphere on baseline grid',a.job);
  const fresh=await scene(.0022);let rejected=false;
  try{await op(fresh,'solve-frame',{fidelityBudget,pairedWithJob:a.job});}catch{rejected=true;}
  const cold=await solve(fresh,'independent speed reference');
  const difference=Math.abs(cold.force-b.force)/Math.abs(cold.force);
  return {pass:difference<.01&&a.initialization.kind==='uniform-inflow'&&cold.initialization.kind==='uniform-inflow'&&rejected&&
    b.initialization.fromJob===a.job&&b.validity.sameDiscretizationAsPrev&&b.validity.gridHash===cold.validity.gridHash&&
    c.initialization.fromJob===a.job&&c.paired?.baselineJob===a.job&&c.validity.gridHash===a.validity.gridHash&&c.force>b.force&&
    Math.abs(c.paired.deltaDragN-(c.force-a.force))<1e-18&&
    trials.every(r=>r.validity.stationary&&r.validity.maxDivergencePerS<1e-6&&r.shape==='ready'),
    coldComparison:difference,rejectedCrossDocumentBaseline:rejected,trials};
}
