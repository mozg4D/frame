import {adjointTransportWeights,gpuScope,laminarMomentumAdjoint,nestedParentCoordinates,refineAdjointGrid} from '../../plugin.js';

// Cell averages of a polynomial have an exact face value and derivative.
// A jump in the dual at a single interior face isolates that face's defect.
export async function verifyTransportWeights(device){
  const dims=[16,8,8],axes=dims.map((n,k)=>Float64Array.from({length:n+1},(_,i)=>i*(1+.008*(k+1)*i))),n=1024,x=axes[0],cut=7;
  const f={axes,dims,origin:[0,0,0],h:1,nu:.2,rho:1.2,U:.3,laminar:true},dt=.1,results=[];
  for(const [label,c,q,blocked,constantDual] of [
    ['constant',[2,0,0,0],.18,'',false],['affine',[.3,.24,0,0],-.08,'',false],
    ['cubic, forward',[.5,.12,-.013,.002],.18,'',false],['cubic, reverse',[.5,.12,-.013,.002],-.08,'',false],
    ['one-sided quadratic',[.4,.15,.024,0],.13,'left',false],['sealed face',[.5,.12,-.013,.002],0,'face',false],
    ['constant adjoint',[.5,.12,-.013,.002],.18,'',true]]){
    const gpu=gpuScope(device);
    try{
      const state=new Float32Array(8*n),flux=new Float32Array(8*n),mu=new Float32Array(4*n).fill(1),lambda=new Float32Array(4*n);
      const face=x[cut+1],width=i=>x[i+1]-x[i],center=i=>(x[i]+x[i+1])/2;
      const mean=Array.from({length:dims[0]},(_,i)=>c.reduce((s,v,k)=>s+v*((x[i+1]-face)**(k+1)-(x[i]-face)**(k+1))/((k+1)*width(i)),0));
      for(let i=0;i<n;i++){
        const ix=i%16,j=Math.floor(i/16)%8,k=Math.floor(i/128),area=(axes[1][j+1]-axes[1][j])*(axes[2][k+1]-axes[2][k]);
        state[8*i+1]=mean[ix];lambda[4*i+1]=Number(constantDual||ix>cut);
        flux[8*i]=q*area;flux[8*i+4]=q*area;
        if(blocked==='left'&&ix===cut-1||blocked==='face'&&ix===cut)mu[4*i]=0;
      }
      const solved={state:gpu.buffer('Polynomial cell averages',state),flux:gpu.buffer('Uniform discharges',flux),
        fluxTail:gpu.buffer('Discharge rounding tails',32*n),mobility:gpu.buffer('Connected cells',mu)};
      const dual=gpu.buffer('Jump in force adjoint',lambda);
      const frozen=await laminarMomentumAdjoint(gpu,f,dt,solved,dual,gpu.buffer('Transpose scratch',48*n));
      const e=device.createCommandEncoder();frozen.freeze(e);device.queue.submit([e.finish()]);
      const weights=await adjointTransportWeights(gpu,f,dt,solved,{faces:frozen.faces,lambda:dual});
      const d=q>=0?cut:cut+1,other=q>=0?cut+1:cut,behind=2*d-other;
      const back=(mean[d]-mean[behind])/Math.abs(center(d)-center(behind)),front=(mean[other]-mean[d])/Math.abs(center(d)-center(other));
      const trace=mean[d]+.5*width(d)*(front*back>0?Math.sign(back)*Math.min(Math.abs(back),Math.abs(front)):0);
      const secant=(mean[cut+1]-mean[cut])/(center(cut+1)-center(cut));
      const expected=constantDual||blocked==='face'?0:Math.abs(q*(c[0]-trace)-f.nu*dt*(c[1]-secant))*
        axes[1].at(-1)*axes[2].at(-1)*f.rho/dt**2;
      const total=weights[0][cut]+weights[0][cut+1],offTarget=weights.flat().reduce((s,v)=>s+v,0)-total;
      results.push({label,expected,actual:total,offTarget,pass:Math.abs(total-expected)<3e-5*Math.max(1,expected)&&
        Math.abs(weights[0][cut]-weights[0][cut+1])<1e-7&&offTarget<1e-8});
    }finally{gpu.close();}
  }
  const weights=dims.map((n,k)=>Array.from({length:n},(_,i)=>k===0&&i>=4&&i<12?1:0));
  const refined=refineAdjointGrid(f,weights,1536),nested=axes.every((axis,a)=>Array.from(axis).every(v=>refined.grid.axes[a].includes(v)));
  const map=nestedParentCoordinates(f,refined.grid);let widthError=0,offset=0;
  for(const [a,axis] of refined.grid.axes.entries()){
    const sum=new Float64Array(dims[a]);
    for(let j=0;j+1<axis.length;j++)sum[map[offset++]]+=axis[j+1]-axis[j];
    for(let j=0;j<sum.length;j++)widthError=Math.max(widthError,Math.abs(sum[j]-(axes[a][j+1]-axes[a][j])));
  }
  let limited=false;try{refineAdjointGrid(f,weights,n);}catch(e){limited=e.code==='CFD_REFINEMENT_UNAVAILABLE';}
  return {pass:results.every(v=>v.pass)&&nested&&limited&&widthError<1e-12&&refined.details.cells===1536&&refined.details.selectedIndicatorFraction===1,
    results,nested,maxParentWidthError:widthError,budgetEnforced:limited,refinement:refined.details};
}

export async function verifyAdjointRefinement(){
  const call=(op,args={})=>frameAI.call(op,args);await call('scene.new');
  const U=.018258982159215297,owner=await call('scene.create',{type:'cfd',params:{Speed:U}});
  const body=await call('scene.create',{type:'sphere',params:{diameter:80,'angle approximation':5}});
  await call('transform.set',{ids:[body.hash],channel:'position',axis:1,value:100,coordinates:'world'});
  const op=(operation,args={})=>call('plugins.command',{id:owner.hash,operation,args});
  async function solve(label,fidelityBudget,refineFromJob,warmStart=true){
    const start=performance.now();await op('solve-frame',{fidelityBudget,warmStart,...refineFromJob?{refineFromJob}:{}});
    for(;;){
      await new Promise(resolve=>setTimeout(resolve,200));const s=await op('results');
      if(s.state==='ready'){
        const r=s.result,cd=r.forceLocal.drag/(.5*r.medium.rho*U**2*Math.PI*.04**2);
        const result={label,job:s.job.id,cells:r.cells,dims:r.dims,cd,relativeError:Math.abs(cd/1.087-1),steps:r.steps,
          shape:r.shape?.state,elapsedMs:performance.now()-start,validity:r.validity,initialization:r.initialization};
        console.log('CFD live drag refinement '+JSON.stringify(result));return result;
      }
      if(!['queued','solving'].includes(s.state)||performance.now()-start>90*60*1000)
        throw Error(label+' '+JSON.stringify({state:s.state,error:s.job?.error,validity:s.result?.validity}));
    }
  }
  const parent=await solve('baseline','preview'),child=await solve('adjoint-refined','standard',parent.job);
  const levels=[parent,child];
  while(levels.length<4&&levels.at(-1).relativeError>.05){
    levels.push(await solve('nested refinement '+levels.length,'standard',levels.at(-1).job));
  }
  const best=levels.at(-1),cold=await solve('same nested grid from uniform inflow','standard',levels.at(-2).job,false);
  const independent=await solve('independently graded','standard');
  await call('scene.update',{id:owner.hash,params:{Speed:U*1.01}});
  let changedRejected=false;try{await op('solve-frame',{fidelityBudget:'standard',refineFromJob:parent.job});}catch{changedRejected=true;}
  const d=child.validity.refinement;
  return {pass:changedRejected&&d?.parentJob===parent.job&&d.parentGridHash===parent.validity.gridHash&&
    child.validity.gridHash!==parent.validity.gridHash&&child.initialization.kind==='projected-nested-predictor'&&
    child.cells>parent.cells&&child.cells<=2*parent.cells&&child.relativeError<parent.relativeError&&
    levels.every((v,i)=>!i||v.validity.refinement?.parentJob===levels[i-1].job&&v.cells<=2*levels[i-1].cells)&&
    cold.validity.gridHash===best.validity.gridHash&&cold.validity.wallTopologyHash===best.validity.wallTopologyHash&&
    cold.initialization.kind==='uniform-inflow'&&Math.abs(best.cd/cold.cd-1)<.01&&
    levels.slice(1).every((v,i)=>v.initialization.fromJob===levels[i].job&&v.initialization.maxDivergencePerS<1e-6)&&
    [...levels,cold,independent].every(v=>v.shape==='ready'&&v.validity.stationary&&v.validity.maxDivergencePerS<1e-6)&&
    best.relativeError<=.05&&best.cells<independent.cells,
    referenceCd:1.087,changedOperatingPointRejected:changedRejected,levels,cold,independent};
}
