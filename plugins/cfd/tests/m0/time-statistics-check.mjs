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
