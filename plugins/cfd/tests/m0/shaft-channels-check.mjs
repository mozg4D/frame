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
  const box=await call('scene.create',{type:'cfd',params:{Speed:0}}),body=await call('scene.create',{type:'sphere',params:{diameter:45}});
  await call('transform.apply',{ids:[body.hash],position:[0,500,0],coordinates:'world'});
  for(const frame of [0,60])await call('animation.key',{id:body.hash,path:'rotation',frame,value:[0,frame*6,0],interpolation:'hard'});
  await call('animation.seek',{frame:11});await call('diagnostics.frame',{frames:3});let crossAxisError=null;
  try{await call('plugins.command',{id:box.hash,operation:'wall-motion',args:{pointsWorldM:[[0,.5,.02]]}});}
  catch(e){crossAxisError=e.message;}
  return {pass:!!crossAxisError?.includes('axial angular velocity')&&rows.every(r=>r.pressure&&r.forceWorldN.every(Number.isFinite)&&r.powerW>0&&
    r.geometryExtent.sweptDiameterM>0&&r.geometryExtent.characteristicLengthM===Math.max(r.geometryExtent.sweptDiameterM,
      r.geometryExtent.bodyBoundsM.max[0]-r.geometryExtent.bodyBoundsM.min[0])&&r.powerIdentityErrorW<1e-6&&r.maxDivergencePerS<1e-6),rows,crossAxisError};
}
