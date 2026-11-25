export async function verifyTranslation(){
  const call=(name,params={})=>frameAI.call(name,params),results=[];
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),speed=.012,center=[0,500,0];
  const key=(id,path,frame,value)=>call('animation.key',{id,path,frame,value,interpolation:'hard'});
  async function run(name,ambient,velocity){
    await call('scene.new');const {hash:id}=await call('scene.create',{type:'cfd',params:{Speed:ambient}});
    const body=await call('scene.create',{type:'sphere',params:{diameter:80,'angle approximation':10}});
    await call('transform.apply',{ids:[body.hash],position:center,coordinates:'world'});
    if(velocity){
      for(const frame of [0,60])await key(body.hash,'position',frame,center.map((v,a)=>v+1000*(frame-30)/60*velocity[a]));
    }
    await call('animation.seek',{frame:30});
    const op=(operation,args={})=>call('plugins.command',{id,operation,args});
    const motion=await op('wall-motion',{pointsWorldM:[[0,.5,0],[.03,.5,.02]]});
    if(velocity&&(motion.kind!=='rigid-translation'||motion.velocityWorldMPerS.some(v=>Math.hypot(...v.map((x,k)=>x-velocity[k]))>1e-7)))
      throw Error('Native translation disagrees with keyed motion: '+JSON.stringify(motion));
    await op('solve-frame',{fidelityBudget:'preview'});let snapshot;const until=performance.now()+180000;
    for(;;){
      await wait(100);snapshot=await op('results');
      if(['ready','unconverged'].includes(snapshot.state))break;
      if(!['solving','queued'].includes(snapshot.state)||performance.now()>until)throw Error('Translation solve: '+JSON.stringify(snapshot));
    }
    const r=snapshot.result,profile=(rows=[])=>rows.reduce((sum,row)=>sum+row.value*(row.upperM-row.lowerM),0);
    const profileError=r.profiles?Math.max(Math.abs(profile(r.profiles.dDragDx)-r.forceLocal.drag),Math.abs(profile(r.profiles.dLiftDy)-r.forceLocal.lift))/r.forceLocal.magnitude:0;
    const short={name,state:snapshot.state,motion:motion.kind,velocity:motion.velocityWorldMPerS[0],
      relativeWind:r.kinematics?.relativeWindBoxMPerS,force:r.forceWorld,local:r.forceLocal,relativeDragN:r.kinematics?.relativeWindDragN??r.forceLocal.drag,
      steps:r.steps,solver:r.solver,divergence:r.validity.maxDivergencePerS,lossUnit:r.surfaceFields?.loss.unit,profileAxes:r.profiles?.axesWorld,profileError};
    if(velocity){await call('animation.seek',{frame:90});short.afterKeys=(await op('wall-motion')).kind;}
    results.push(short);return short;
  }
  const reference=await run('stationary inflow',speed,null),aligned=await run('translated inflow',speed+.02,[.02,0,0]);
  const reversed=await run('axial towing in still fluid',0,[speed,0,0]),side=await run('lateral towing in still fluid',0,[0,0,speed]);
  const equilibrium=await run('moves with the medium',speed,[speed,0,0]);
  const referenceN=reference.force[0],difference=(r,want)=>Math.hypot(...r.force.map((x,k)=>x-want[k]))/referenceN;
  const alignedError=difference(aligned,reference.force),reverseError=difference(reversed,[-reference.force[0],reference.force[1],-reference.force[2]]);
  const lateralError=difference(side,[reference.force[2],reference.force[1],-reference.force[0]]);
  return {pass:referenceN>0&&alignedError<.001&&reverseError<.03&&lateralError<.03&&equilibrium.solver==='uniform-equilibrium'&&
    equilibrium.local.magnitude===0&&results.every(r=>r.divergence<1e-6&&r.profileError<1e-5)&&results.slice(1).every(r=>r.afterKeys==='stationary')&&
    reversed.lossUnit==='W/m2'&&side.relativeDragN>0&&Math.abs(side.force[2]+side.relativeDragN)<1e-12,
    alignedError,reverseError,lateralError,results};
}

export async function verifySavedTranslation(device){
  const call=(name,params={})=>frameAI.call(name,params);await call('scene.new');
  const box=await call('scene.create',{type:'cfd',name:'Towing region',params:{Speed:0}});
  const body=await call('scene.create',{type:'sphere',params:{diameter:80,'angle approximation':10}});
  const fps=(await call('animation.inspect')).fps,velocity=[.0096,0,.0072],speed=Math.hypot(...velocity),center=[0,500,0];
  for(const frame of [0,30,60]){
    const value=center.map((v,a)=>v+1000*(frame-30)/fps*velocity[a]*(frame===0?.5:1));
    await call('animation.key',{id:body.hash,path:'position',frame,value,interpolation:'hard'});
  }
  await call('animation.seek',{frame:30});
  const saved=await call('scene.export',{includeData:true});await call('scene.new');
  await call('scene.open',{name:'towed-sphere.hash',base64:saved.base64});await call('diagnostics.frame',{frames:3});
  const study=(await import('./native-case.mjs')).solveCapturedBoxes;
  const run=async()=> (await study(device,.45,180000,()=>{},true,true,{solver:'cartesian-fvm',periodLimit:1}))[0];
  const loaded=await run(),force=loaded.forceWorldN,drag=-force.reduce((s,x,k)=>s+x*velocity[k],0)/speed;
  const cosine=drag/Math.hypot(...force),readMotion=async()=>call('plugins.command',{id:box.hash,operation:'wall-motion',args:{pointsWorldM:[center.map(x=>x*.001)]}});
  const velocityAtKink=(await readMotion()).velocityWorldMPerS[0];await call('animation.seek',{frame:10});
  const prior=(await readMotion()).velocityWorldMPerS[0];await call('animation.seek',{frame:90});
  const equilibrium=await run();await call('animation.seek',{frame:30});
  const fixed=await call('scene.create',{type:'sphere',params:{diameter:30}});
  await call('transform.apply',{ids:[fixed.hash],position:[100,500,0],coordinates:'world'});let rejection;
  try{await readMotion();}catch(e){rejection={message:e.message,code:e.code};}
  const rateError=Math.max(...velocity.map((v,k)=>Math.max(Math.abs(v-velocityAtKink[k]),Math.abs(.5*v-prior[k]))));
  return {pass:cosine>.97&&loaded.massPassed&&rateError<1e-8&&
    loaded.windows[0].relativeWindAxialForceN>0&&Math.abs(loaded.windows[0].forceN-force[0])<1e-12&&
    equilibrium.kind==='uniform-equilibrium'&&equilibrium.completedSteps===0&&!!rejection?.message?.includes('one constant linear velocity'),
    fps,velocity,velocityAtKink,prior,rateError,forceWorldN:force,dragN:drag,cosine,maxDivergencePerS:loaded.field.maxDivergencePerS,
    savedFrame:loaded.translation.verifiedFrames[0],equilibrium,rejection};
}

export async function verifyAnimatedObserver(){
  const call=(name,params={})=>frameAI.call(name,params);await call('scene.new');
  const {hash:id}=await call('scene.create',{type:'cfd',params:{Speed:.012}});
  for(const [frame,angle] of [[0,0],[30,90]])await call('animation.key',{id,path:'rotation',frame,value:[0,angle,0],interpolation:'hard'});
  await call('animation.seek',{frame:15});const world=frameEngine.pluginWorld(id),math=frameEngine.pluginMath;
  const center=math.point(world,[0,500,0]),axis=world.slice(0,3),length=Math.hypot(...axis);
  const sphere=await call('scene.create',{type:'sphere',params:{diameter:80,'angle approximation':10}});
  await call('transform.apply',{ids:[sphere.hash],position:center,coordinates:'world'});
  const op=(operation,args={})=>call('plugins.command',{id,operation,args}),motion=await op('wall-motion',{pointsWorldM:[center.map(x=>x*.001)]});
  await op('solve-frame',{fidelityBudget:'preview'});let state;const end=performance.now()+180000;
  for(;;){await new Promise(r=>setTimeout(r,100));state=await op('results');if(['ready','unconverged'].includes(state.state))break;
    if(!['queued','solving'].includes(state.state)||performance.now()>end)throw Error('Animated CFD observation region: '+JSON.stringify(state));}
  const r=state.result,cosine=r.forceWorld.reduce((s,x,i)=>s+x*axis[i],0)/(length*r.forceLocal.magnitude);
  return {pass:motion.kind==='stationary'&&Math.hypot(...motion.velocityWorldMPerS[0])===0&&cosine>.99&&r.forceLocal.drag>0&&r.validity.maxDivergencePerS<1e-6,
    frame:r.frame,cosine,axis,forceWorldN:r.forceWorld,wall:motion,divergence:r.validity.maxDivergencePerS};
}
