// Rotate the CFD Box to the shaft and key the actual native source on
// each Euler channel. Transform a material point at two nearby times as
// an independent world-velocity measurement.
export async function verifyShaftChannels(){
  const call=(name,args={})=>frameAI.call(name,args),math=frameEngine.pluginMath,rows=[];
  for(const [axis,type] of [[0,'sphere'],[1,'cylinder'],[2,'cube']]){
    await call('scene.new');
    const {hash:id}=await call('scene.create',{type:'cfd',params:{Speed:0}});
    if(axis)await call('transform.set',{ids:[id],channel:'rotation',axis:axis===1?2:1,value:axis===1?90:-90,coordinates:'object'});
    const body=await call('scene.create',{type,params:type==='sphere'?{diameter:50}:type==='cylinder'?{diameter:48,height:65}:{}});
    const x=math.point(frameEngine.pluginWorld(id),[0,500,0]);
    await call('transform.apply',{ids:[body.hash],position:x,...type==='cube'?{size:[75,14,8]}:{},coordinates:'world'});
    const {fps}=await call('animation.inspect'),rpm=axis===1?-360:360,held=11;
    for(const frame of [0,60])await call('animation.key',{id:body.hash,path:'rotation',frame,
      value:[0,1,2].map(a=>a===axis?frame/fps*rpm*6:0),interpolation:'hard'});
    await call('animation.seek',{frame:held});await call('diagnostics.frame',{frames:3});
    const t=held/fps,eps=1e-5;
    const pointAt=time=>math.point(frameEngine.pluginSampleTransforms([body.hash],time).objects[0].world,[11,18,-9]).map(x=>.001*x);
    const point=pointAt(t),lo=pointAt(t-eps),hi=pointAt(t+eps),velocity=hi.map((v,k)=>(v-lo[k])/(2*eps));
    const op=(operation,args={})=>call('plugins.command',{id,operation,args});
    const motion=await op('wall-motion',{pointsWorldM:[point]});
    const angularSpeed=Math.hypot(...motion.angularVelocityWorldRadPerS),vError=Math.hypot(...motion.velocityWorldMPerS[0].map((v,k)=>v-velocity[k]));
    if(motion.kind!=='rigid-rotation'||Math.abs(Math.abs(motion.rpmInBox)-Math.abs(rpm))>1e-5||
      Math.abs(angularSpeed-Math.abs(rpm)*Math.PI/30)>1e-6||vError>5e-5)
      throw Error('Shaft velocity mismatch '+JSON.stringify({axis,motion,point,velocity,vError}));
    await op('solve-frame',{fidelityBudget:'preview'});let result;
    const end=performance.now()+240000;
    try{
      do{await new Promise(ok=>setTimeout(ok,75));const s=await op('results');result=s.result;
        if(['failed','stale','stopped'].includes(s.state))throw Error('Shaft solve '+JSON.stringify(s.job));
        if(performance.now()>end)throw Error('Missing shaft loads');
      }while((result?.steps??0)<4);
    }finally{await op('stop');}
    const powerIdentityError=Math.abs(result.powerW+result.rotorMetrics.shaftTorqueNm*motion.rpmInBox*Math.PI/30);
    rows.push({axis,type,angularVelocityWorldRadPerS:motion.angularVelocityWorldRadPerS,rpmInBox:motion.rpmInBox,
      velocityWorldMPerS:motion.velocityWorldMPerS[0],velocityErrorMPerS:vError,steps:result.steps,powerW:result.powerW,
      powerIdentityErrorW:powerIdentityError,pressure:result.surfaceFields.available.includes('Pressure'),forceWorldN:result.forceWorld,
      geometryExtent:result.validity.geometryExtent,maxDivergencePerS:result.validity.maxDivergencePerS});
  }
  await call('scene.new');
  const box=await call('scene.create',{type:'cfd',params:{Speed:12}}),body=await call('scene.create',{type:'sphere',params:{diameter:45}});
  await call('transform.apply',{ids:[body.hash],position:[0,500,0],coordinates:'world'});
  for(const frame of [0,60])await call('animation.key',{id:body.hash,path:'rotation',frame,value:[0,frame*6,0],interpolation:'hard'});
  await call('animation.seek',{frame:11});await call('diagnostics.frame',{frames:3});let crossAxisError=null;
  const crossMotion=await call('plugins.command',{id:box.hash,operation:'wall-motion',args:{pointsWorldM:[[0,.5,.02]]}});
  try{await call('plugins.command',{id:box.hash,operation:'solve-frame',args:{fidelityBudget:'preview'}});}
  catch(e){crossAxisError=e.message;}
  return {pass:!!crossAxisError?.includes('transverse inlet')&&Math.abs(crossMotion.shaftAxisWorld[1]-1)<1e-7&&
    crossMotion.velocityWorldMPerS[0][0]>0&&rows.every(r=>r.pressure&&r.forceWorldN.every(Number.isFinite)&&r.powerW>0&&
    r.geometryExtent.sweptDiameterM>0&&r.geometryExtent.characteristicLengthM===Math.max(r.geometryExtent.sweptDiameterM,
      r.geometryExtent.bodyBoundsM.max[0]-r.geometryExtent.bodyBoundsM.min[0])&&r.powerIdentityErrorW<1e-6&&r.maxDivergencePerS<1e-6),rows,crossAxisError};
}

// Keep the shaft and its physical velocity fixed. A quarter-turn of a
// cubic observation box keeps the same exterior and permutes its force axes.
export async function verifyTiltedShaft(device){
  const {createNativeRotorFixture}=await import('./native-case.mjs');
  const call=(name,args={})=>frameAI.call(name,args),math=frameEngine.pluginMath;
  const {boxHash:id}=await createNativeRotorFixture(device,true);
  const op=(operation,args={})=>call('plugins.command',{id,operation,args});
  const dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0),norm=v=>Math.hypot(...v),rows=[];
  for(const angle of [0,90,34]){
    await call('transform.apply',{ids:[id],rotation:[0,angle,0],position:[0,0,0],coordinates:'world'});
    const centre=math.point(frameEngine.pluginWorld(id),[0,500,0]),target=[0,200,0];
    await call('transform.apply',{ids:[id],position:target.map((v,k)=>v-centre[k]),coordinates:'world'});
    if(angle===90){
      const saved=await call('scene.export',{includeData:true});await call('scene.new');
      await call('scene.open',{name:'transverse-shaft.hash',base64:saved.base64});
    }
    await call('diagnostics.frame',{frames:3});
    const world=frameEngine.pluginWorld(id),pivot=math.point(world,frameEngine.pluginPivot(id).slice(12,15)).map(v=>.001*v);
    const points=[[0,.20,.05],[.016,.24,-.02]],motion=await op('wall-motion',{pointsWorldM:points});
    const omega=5011*Math.PI/30;
    const velocityError=Math.max(...points.map((p,i)=>norm(motion.velocityWorldMPerS[i].map((v,k)=>v-[0,-p[2]*omega,(p[1]-.2)*omega][k]))));
    await op('solve-frame',{fidelityBudget:'preview',warmStart:false});let r;
    const limit=performance.now()+240000;
    try{
      do{
        await new Promise(ok=>setTimeout(ok,30));const s=await op('results');r=s.result;
        if(!['queued','solving'].includes(s.state)||performance.now()>limit)throw Error('Tilted shaft '+JSON.stringify(s.job));
      }while((r?.steps??0)<4);
      const rotor=r.rotorMetrics,F=r.forceWorld,axis=rotor.shaftAxisWorld,boxAxes=r.profiles.axesWorld;
      const diameter=r.validity.geometryExtent.sweptDiameterM;
      const local=[r.forceLocal.drag,r.forceLocal.lift,r.forceLocal.side];
      const offset=pivot.map((v,k)=>v-motion.axisOriginWorldM[k]),arm=math.cross(offset,F);
      const shaftMoment=r.torque.map((v,k)=>v+arm[k]);
      const profile=r.profiles,integral=(rows,key)=>rows.reduce((s,row)=>s+row[key],0);
      const forceErrors=[...local.map((v,k)=>v-dot(F,boxAxes[k])),dot(F,axis)-rotor.axialForceN,
        rotor.CT*r.medium.rho*(5011/60)**2*diameter**4-rotor.axialForceN,
        integral(profile.dDragDx,'forceN')-local[0],integral(profile.dLiftDy,'forceN')-local[1],
        integral(profile.rotorRadial,'thrustN')-rotor.axialForceN];
      const forceError=Math.max(...forceErrors.map(Math.abs))/norm(F);
      const torqueError=Math.abs(dot(shaftMoment,axis)-rotor.shaftTorqueNm)/Math.max(Math.abs(rotor.shaftTorqueNm),1e-15);
      const powerError=Math.abs(r.powerW+omega*dot(shaftMoment,[1,0,0]))/Math.max(Math.abs(r.powerW),1e-15);
      rows.push({angle,hashRoundTrip:angle===90,steps:r.steps,dt:r.dtS,cells:r.cells,diameter,velocityError,forceWorld:F,local,axis,powerW:r.powerW,
        forceError,torqueError,powerError,mass:r.validity.maxDivergencePerS,CT:rotor.CT,CP:rotor.CP});
    }finally{await op('stop');}
  }
  const [aligned,quarter]=rows;
  const sameForce=norm(aligned.forceWorld.map((v,k)=>v-quarter.forceWorld[k]))/norm(aligned.forceWorld);
  const samePower=Math.abs(quarter.powerW/aligned.powerW-1);
  const pass=aligned.steps===quarter.steps&&aligned.cells===quarter.cells&&Math.abs(aligned.dt/quarter.dt-1)<1e-7&&
    sameForce<.003&&samePower<.003&&rows.every(r=>r.steps>=4&&r.velocityError<1e-5&&r.forceError<2e-5&&
      r.torqueError<2e-5&&r.powerError<2e-5&&r.mass<1e-6&&r.powerW>0&&Math.abs(r.CT)>.01&&Math.abs(r.diameter-.254)<.001);
  return {pass,sameForce,samePower,rows};
}
