// Recover the individual block loads from successive public two-window
// results, including the alternating integer step counts for one period.
export async function verifyNativeTemporalInterval(){
  const call=(name,args={})=>frameAI.call(name,args);
  await call('scene.new');const box=await call('scene.create',{type:'cfd',params:{Speed:.002}});
  const body=await call('scene.create',{type:'sphere',params:{diameter:80,'angle approximation':10}});
  await call('transform.apply',{ids:[body.hash],position:[0,500,0],coordinates:'world'});
  const op=(operation,args={})=>call('plugins.command',{id:box.hash,operation,args});
  await op('solve-frame',{fidelityBudget:'preview',warmStart:false});
  const blocks=[],limit=performance.now()+20*60*1000;let final;
  for(;;){
    const status=await op('results'),r=status.result;
    if(r&&!r.validity.stationary&&r.uncertainty.ci95Drag!==null)throw Error('Transient sample carries a stationary interval');
    if(r&&r.completeWindows>blocks.length){
      if(r.completeWindows!==blocks.length+1)throw Error('A public averaging window was missed');
      const prev=blocks.at(-1),steps=r.averagedSteps-(prev?.steps??0);
      const values=[...r.forceWorld,r.forceLocal.drag].map((x,a)=>(x*r.averagedSteps-(prev?.steps??0)*(prev?.values[a]??0))/steps);
      if(!(steps>0))throw Error('Invalid published two-window weights');blocks.push({steps,values});
    }
    if(status.state==='ready'){final=r;break;}
    if(!['queued','solving'].includes(status.state)||performance.now()>limit)throw Error(JSON.stringify(status.job));
    await new Promise(ok=>setTimeout(ok,50));
  }
  const u=final.uncertainty,observations=blocks.slice(2),last=blocks.slice(-2),count=last[0].steps+last[1].steps;
  function independentError(axis){
    const v=observations.map(b=>b.values[axis]),n=v.length,mean=v.reduce((a,b)=>a+b,0)/n;
    const d=v.map(x=>x-mean),cross=lag=>d.slice(lag).reduce((a,x,j)=>a+x*d[j],0),ss=cross(0);
    if(ss===0)return 0;
    let tau=1;for(let lag=1;lag<=Math.floor(n/3)&&cross(lag)>0;lag++)tau+=2*cross(lag)/ss;
    const cov=Math.max(0,cross(1))/ss;
    return Math.sqrt(ss/(n-Math.min(n-1,tau))*(last[0].steps**2+last[1].steps**2+2*cov*last[0].steps*last[1].steps))/count;
  }
  const expected=[0,1,2].map(independentError),peak=Math.max(...expected),drag=final.forceLocal.drag;
  const relativeSeError=Math.max(...expected.map((x,a)=>Math.abs(x-u.standardErrorForce[a])))/peak;
  const ciCenterError=Math.abs(.5*(u.ci95Drag[0]+u.ci95Drag[1])-drag)/Math.abs(drag);
  return {pass:final.validity.stationary&&u.blocks===observations.length&&u.averagedSteps===count&&u.averagedBlocks===2&&
    peak>0&&relativeSeError<1e-8&&ciCenterError<1e-10&&u.ci95Drag[1]>u.ci95Drag[0]&&final.validity.maxDivergencePerS<1e-6,
    windows:blocks.length,blocks,drag,uncertainty:u,independentStandardErrorForce:expected,relativeSeError,ciCenterError,
    maximumDivergencePerS:final.validity.maxDivergencePerS,shape:final.shape?.state};
}

// Twenty independently prepared flow histories reach the same held geometry,
// operating point and physical grid. A separate cold trajectory continues
// past its first stationary report to provide a fixed-discretization reference.
export async function verifyNativeTemporalCoverage(){
  const call=(name,args={})=>frameAI.call(name,args),target=.006,seed0=0x5011e23d;
  let seed=seed0;
  const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;};
  async function create(speed){
    await call('scene.new');
    const box=await call('scene.create',{type:'cfd',params:{Speed:speed}});
    const body=await call('scene.create',{type:'sphere',params:{diameter:80,'angle approximation':10}});
    await call('transform.apply',{ids:[body.hash],position:[0,500,0],coordinates:'world'});return box.hash;
  }
  async function solve(id,options){
    const op=(operation,args={})=>call('plugins.command',{id,operation,args});
    const start=performance.now();await op('solve-frame',{fidelityBudget:'preview',...options});
    for(;;){
      await new Promise(ok=>setTimeout(ok,120));const status=await op('results'),r=status.result;
      if(status.state==='ready'){
        if(!r.validity.stationary||!r.uncertainty.ci95Drag||r.validity.maxDivergencePerS>=1e-6)throw Error('Uncertified stationary reference');
        return {id:status.job.id,drag:r.forceLocal.drag,interval:r.uncertainty.ci95Drag,gridHash:r.validity.gridHash,wallTopologyHash:r.validity.wallTopologyHash,
          steps:r.steps,windows:r.completeWindows,mass:r.validity.maxDivergencePerS,initialization:r.initialization.kind};
      }
      if(!['queued','solving'].includes(status.state)||performance.now()-start>15*60*1000)throw Error(JSON.stringify(status.job));
    }
  }
  const refBox=await create(target),references=[await solve(refBox,{warmStart:false})];let stable=0;
  while(references.length<9&&stable<2){
    const prior=references.at(-1),next=await solve(refBox,{pairedWithJob:prior.id});
    stable=Math.abs(next.drag/prior.drag-1)<1e-4?stable+1:0;references.push(next);
  }
  const ref=references.at(-1),runs=[];
  for(let i=0;i<20;i++){
    const prepSpeed=target*(.2+1.6*random()),id=await create(prepSpeed),preparation=await solve(id,{warmStart:false});
    await call('scene.update',{id,params:{Speed:target}});
    const sample=await solve(id,{pairedWithJob:preparation.id});
    const covered=sample.interval[0]<=ref.drag&&ref.drag<=sample.interval[1];
    console.log('CFD live temporal coverage '+(i+1)+'/20, drag '+sample.drag.toExponential(6)+', covered '+covered);
    runs.push({prepSpeed,preparationDrag:preparation.drag,covered,...sample});
  }
  const covered=runs.filter(s=>s.covered).length;
  return {pass:stable>=2&&covered>=18&&runs.every(s=>s.gridHash===ref.gridHash&&s.wallTopologyHash===ref.wallTopologyHash&&s.initialization==='projected-stationary-predictor'),
    scope:'Temporal intervals on one fixed grid with independent inflow preparations',targetMPerS:target,randomSeed:seed0,covered,trials:runs.length,
    coverage:covered/runs.length,references,runs};
}
