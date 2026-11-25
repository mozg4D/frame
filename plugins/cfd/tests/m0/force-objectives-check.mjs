// The two objective adjoints share a primal operating point. Four independent
// evaluations at constant physical volume differentiate both box-force components.
export async function verifyNativeForceObjectives(){
  const call=(name,args={})=>frameAI.call(name,args);
  await call('scene.new');const {hash:owner}=await call('scene.create',{type:'cfd',params:{Speed:.009}});
  const op=(operation,args={})=>call('plugins.command',{id:owner,operation,args});
  const axis=[0,.6,.8],center=[1.7,202.1,2.4],angle=.32,rings=12,sides=24;
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const basis=[[47,0,0]],indices=[];
  for(let i=1;i<rings;i++)for(let j=0;j<sides;j++){
    const a=Math.PI*i/rings,b=2*Math.PI*j/sides;
    basis.push([47*Math.cos(a),23*Math.sin(a)*Math.cos(b),20*Math.sin(a)*Math.sin(b)]);
  }
  const end=basis.push([-47,0,0])-1,id=(i,j)=>1+(i-1)*sides+j%sides;
  for(let j=0;j<sides;j++){
    indices.push(0,id(1,j),id(1,j+1),id(rings-1,j),end,id(rings-1,j+1));
    for(let i=1;i<rings-1;i++)indices.push(id(i,j),id(i+1,j),id(i+1,j+1),id(i,j),id(i+1,j+1),id(i,j+1));
  }
  let body,points;
  async function mesh(t){
    if(body)await call('scene.delete',{ids:[body]});
    const c=Math.cos(t),s=Math.sin(t);
    points=basis.map(v=>{const w=cross(axis,v),a=axis.reduce((sum,x,k)=>sum+x*v[k],0);
      return v.map((x,k)=>c*x+s*w[k]+(1-c)*a*axis[k]);});
    body=(await call('mesh.create',{name:'Native incidence perturbation',storage:'texture',indices,
      vertices:points.flatMap(p=>p.map((v,k)=>v+center[k]))})).hash;
  }
  async function sample(shapeObjective,baseline,needGradient){
    const args={fidelityBudget:'preview',warmStart:false,shapeObjective,...baseline?{pairedWithJob:baseline}:{}};
    const start=performance.now();await op('solve-frame',args);let status;
    for(;;){
      await new Promise(ok=>setTimeout(ok,90));status=await op('results');const r=status.result;
      if(status.state==='ready'||!needGradient&&r?.validity.stationary&&r.shape?.state==='solving')break;
      if(!['queued','solving'].includes(status.state)||performance.now()-start>25*60*1000)
        throw Error('Native objective solve '+JSON.stringify(status.job));
    }
    const r=status.result,record={job:status.job.id,objective:r.shape.objective,force:r.forceLocal,grid:r.validity.gridHash,wallTopology:r.validity.wallTopologyHash,dtS:r.dtS,
      stationary:r.validity.stationary,mass:r.validity.maxDivergencePerS,steps:r.steps,elapsedMs:performance.now()-start};
    if(needGradient){
      if(r.shape.state!=='ready'||r.shape.objective!==shapeObjective||r.shape.valueN!==r.forceLocal[shapeObjective]||
        r.shape.refinementIndicator?.objective!==shapeObjective)throw Error('Wrong objective or refinement data: '+JSON.stringify(r.shape));
      await op('shape-map');let total=0,covered=0;
      for(let first=0;first<points.length;first+=128){
        const g=await op('shape-gradient',{occurrence:0,firstVertex:first,count:Math.min(128,points.length-first)});
        if(g.objective!==shapeObjective)throw Error('Cached vertex gradient belongs to another objective');
        for(const v of g.vertices){
          const tangent=cross(axis,points[v.vertex]);total+=v.gradientWorldNPerMm.reduce((s,x,k)=>s+x*tangent[k],0);
          if(v.areaM2>0)covered++;
        }
      }
      Object.assign(record,{dForceDIncidenceNPerRad:total,covered,directionWorld:r.shape.directionWorld,
        indicator:r.shape.refinementIndicator.byAxisN,iterations:r.shape.iterations});
    }else if(status.state==='solving')await op('stop');
    console.log('CFD live force objective '+JSON.stringify(record));return record;
  }
  await mesh(angle);const lift=await sample('lift',null,true),side=await sample('side',lift.job,true);
  let rejected=false;
  try{await op('solve-frame',{fidelityBudget:'standard',refineFromJob:side.job,shapeObjective:'drag'});}
  catch(e){rejected=e.code==='CFD_REFINEMENT_UNAVAILABLE'||e.message.includes('force objective');}
  const differences=[];
  for(const epsilon of [.0004,.0002]){
    await mesh(angle-epsilon);const lower=await sample('drag',lift.job,false);
    await mesh(angle+epsilon);const upper=await sample('drag',lift.job,false);
    const slopes=['lift','side'].map(k=>(upper.force[k]-lower.force[k])/(2*epsilon));
    const relativeErrors=[lift,side].map((v,i)=>Math.abs(v.dForceDIncidenceNPerRad-slopes[i])/Math.max(1e-20,Math.abs(slopes[i])));
    differences.push({epsilonRad:epsilon,slopesNPerRad:slopes,relativeErrors,lower,upper});
  }
  await call('scene.update',{id:owner,params:{Speed:0}});
  const animation=await op('solve-animation',{firstFrame:0,lastFrame:0,fidelityBudget:'preview',shapeObjective:'side'});
  let rest;const start=performance.now();
  do{await new Promise(r=>setTimeout(r,40));rest=await op('results');
    if(!['queued','solving','ready'].includes(rest.animation.state)||performance.now()-start>60000)throw Error('Exact animation objective failed');}
  while(rest.animation.state!=='ready');
  const all=[lift,side,...differences.flatMap(d=>[d.lower,d.upper])];
  return {pass:rejected&&animation.animation.shapeObjective==='side'&&rest.result?.shape.objective==='side'&&rest.result.shape.valueN===0&&
    JSON.stringify(lift.directionWorld)==='[0,1,0]'&&JSON.stringify(side.directionWorld)==='[0,0,1]'&&
    Math.sign(lift.dForceDIncidenceNPerRad)===-Math.sign(side.dForceDIncidenceNPerRad)&&
    all.every(r=>r.grid===lift.grid&&r.wallTopology===lift.wallTopology&&r.stationary&&r.mass<1e-6)&&differences.every(r=>r.relativeErrors.every(x=>x<.15)),
    lift,side,differences,rejectedCrossObjectiveRefinement:rejected,restAnimation:rest.animation};
}
