// Compare exposed and box-clipped native triangle observations with physical
// areas known exactly for closed cubes and a single two-sided flat sheet.
export async function verifyStillSurfaceFields(){
  const call=(name,args={})=>frameAI.call(name,args);
  const operations=id=>(operation,args={})=>call('plugins.command',{id,operation,args});
  async function solve(op){
    const start=performance.now();await op('solve-frame',{fidelityBudget:'preview'});
    for(;;){
      const status=await op('results');
      if(status.state==='ready')return status;
      if(!['queued','solving'].includes(status.state)||performance.now()-start>60000)throw Error(JSON.stringify(status.job));
      await new Promise(ok=>setTimeout(ok,20));
    }
  }
  const cube=(name,x,size,storage)=>{
    const y=150,vertices=Array.from({length:8},(_,k)=>[x+(k&1?.5:-.5)*size,y+(k&2?.5:-.5)*size,(k&4?.5:-.5)*size]);
    const quads=[[0,4,6,2],[1,3,7,5],[0,1,5,4],[2,6,7,3],[0,2,3,1],[4,5,7,6]];
    return call('mesh.create',{name,vertices:vertices.flat(),indices:quads.flatMap(([a,b,c,d])=>[a,b,c,a,c,d]),storage});
  };
  await call('scene.new');const {hash:id}=await call('scene.create',{type:'cfd',params:{Speed:0}}),op=operations(id);
  const bodies=[await cube('Exposed buffered cube',-100,100,'auto'),await cube('Half of a paged cube',500,100,'texture'),
    await cube('Interior faces',-100,20,'texture'),await call('mesh.create',{name:'Open native sheet',storage:'texture',
      vertices:[0,300,0,60,300,0,60,330,0,0,330,0],indices:[0,1,2,0,2,3]})];
  await call('scene.select',{ids:[id]});document.querySelector('#tabAttributes').click();
  const solved=await solve(op),r=solved.result;await call('diagnostics.frame',{frames:2});
  const button=document.querySelector('[data-plugin-action-button="shape-map"]');
  if(!button||button.disabled)throw Error('Missing equilibrium Shape button');button.click();await call('diagnostics.frame',{frames:2});
  const modeSelected=document.querySelector('[data-plugin-action-button="shape-map"]')?.getAttribute('aria-pressed')==='true';
  const areas=[],snapshots=[];let gradientsZero=true,fieldsValid=true;
  for(const {occurrence,hash,triangles,vertices} of r.surfaceFields.occurrences){
    const samples=[];for(let triangle=0;triangle<triangles;triangle++)samples.push(await op('probe',{occurrence,triangle}));
    const g=await op('shape-gradient',{occurrence,firstVertex:0,count:vertices});
    gradientsZero&&=g.vertices.every(v=>v.gradientWorldNPerMm.every(x=>x===0)&&(v.normalNPerMm===null||v.normalNPerMm===0));
    fieldsValid&&=samples.every(s=>s.Cp===null&&s.gammaRev===null&&s.attributedPowerW===0&&(s.areaM2>0?
      s.pressurePa===0&&s.shapeDensityNPerM3===0&&s.shapePatchNPerMm===0&&s.lossDensity===0:
      s.pressurePa===null&&s.shapePatchNPerMm===null&&s.lossDensity===null));
    const index=bodies.findIndex(b=>b.hash===hash);
    areas[index]=samples.reduce((s,p)=>s+p.areaM2,0);
    snapshots[index]={triangles,vertices,areaM2:areas[index],zeroGradient:g.vertices.every(v=>v.gradientWorldNPerMm.every(x=>x===0)),
      covered:samples.filter(s=>s.areaM2>0).length,partial:samples.filter(s=>s.pressureCoverage>0&&s.pressureCoverage<1).length};
  }
  await op('flow-lines',{density:4});const forward=await op('flow-line',{seed:3}),backward=await op('flow-line',{seed:0,backward:true});
  const sameJob=(await op('results')).job.id===solved.job.id;
  await call('scene.update',{id,params:{Speed:.01}});const invalidated=(await op('results')).result===null;
  await call('scene.new');const {hash:owner}=await call('scene.create',{type:'cfd',params:{Speed:.012}}),co=operations(owner);
  const empty=(await solve(co)).result,body=await call('scene.create',{type:'sphere',params:{diameter:80,'angle approximation':10}});
  const fps=(await call('animation.inspect')).fps;
  for(const frame of [0,60])await call('animation.key',{id:body.hash,path:'position',frame,value:[12*(frame-30)/fps,150,0],interpolation:'hard'});
  await call('animation.seek',{frame:30});const translated=(await solve(co)).result,p=await co('probe',{occurrence:0,triangle:5});
  const expectedAreas=[.06,.03,0,.0018],areaError=Math.max(...areas.map((a,i)=>Math.abs(a-expectedAreas[i])));
  const exact=s=>s.solver==='uniform-equilibrium'&&s.steps===0&&s.averagedSteps===0&&s.forceLocal.magnitude===0&&s.validity.stationary;
  return {pass:exact(r)&&exact(empty)&&!empty.surfaceFields&&exact(translated)&&translated.kinematics?.relativeSpeedMPerS===0&&
    translated.shape?.method==='exact-equilibrium'&&p.pressurePa===0&&p.shapeDensityNPerM3===0&&
    modeSelected&&sameJob&&invalidated&&fieldsValid&&gradientsZero&&snapshots[1].partial>0&&areaError<1e-7&&
    Math.abs(r.pressureStats.sampledAreaM2-expectedAreas.reduce((a,b)=>a+b))<1e-7&&
    r.pressureStats.minPa===0&&r.pressureStats.maxPa===0&&r.separationStats.meanGammaRev===null&&
    forward.points.length===0&&backward.points.length===0,expectedAreas,areaError,surfaces:snapshots,shape:r.shape,
    pressure:r.pressureStats,separation:r.separationStats,modeSelected,sameJob,invalidated,fieldsValid,gradientsZero,
    streamlinePoints:[forward.points.length,backward.points.length],coMotion:{speed:translated.kinematics?.relativeSpeedMPerS,steps:translated.steps,probe:p}};
}
