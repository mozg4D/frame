import {captureFlowSurfaces,researchSceneContext} from './native-geometry.mjs';
import {nativeAxialSpin} from './rigid-spin.mjs';

// Two complete shaft turns fall between successive integer frames. A sampled
// wall point still has a verifiable fractional position and physical velocity.
export async function verifyPhysicalTime(device){
  const call=(name,data={})=>frameAI.call(name,data),ctx=researchSceneContext(frameEngine);
  const key=(id,path,frame,value)=>call('animation.key',{id,path,frame,value,interpolation:'hard'});
  await call('scene.new');
  const box=await call('scene.create',{type:'cfd'});
  const body=await call('mesh.create',{name:'Moving wall',storage:'texture',vertices:[0,0,0,0,10,0,0,0,10],indices:[0,1,2]});
  const group=await call('scene.group',{ids:[body.hash]});
  for(const [f,angle] of [[0,0],[12,8640]])await key(group.hash,'rotation',f,[angle,0,0]);
  for(const f of [0,12])await key(body.hash,'position',f,[5,110,15]);
  await call('animation.seek',{frame:3});await call('diagnostics.frame',{frames:2});
  const clock=await call('animation.inspect'),t=3.125/clock.fps;
  const before=captureFlowSurfaces(device,ctx,box.hash),stamp=frameEngine.pluginAuthoringStamp();
  const at=await call('animation.sampleTransforms',{ids:[body.hash,group.hash],timeSec:t});
  const world=at.objects[0].world,expected=[5,-15,110],pointErrorMm=Math.hypot(...expected.map((v,k)=>world[k+12]-v));
  const h=1e-5/clock.fps,ps=[t-h,t+h].map(s=>ctx.animation.sampleTransforms([body.hash],s).objects[0].world);
  const measuredVelocity=expected.map((_,k)=>.001*(ps[1][k+12]-ps[0][k+12])/(2*h)),omega=4*Math.PI*clock.fps;
  const velocityErrorMPerS=Math.hypot(measuredVelocity[0],measuredVelocity[1]+.110*omega,measuredVelocity[2]+.015*omega);
  const after=frameEngine.pluginAuthoringStamp(),clockAfter=await call('animation.inspect');
  before.assertCurrent();
  const untouched=stamp.epoch===after.epoch&&stamp.revision===after.revision&&clock.frame===clockAfter.frame&&
    captureFlowSurfaces(device,ctx,box.hash).meshes[0].positions===before.meshes[0].positions;
  const camera=await call('scene.create',{type:'render',params:{realtime:'off'}}),target=await call('scene.create',{type:'target',params:{object:camera.hash}});
  await key(target.hash,'position',0,[30,50,40]);await key(target.hash,'position',12,[-20,10,70]);
  const aim=ctx.animation.sampleTransforms([camera.hash],7/clock.fps).objects[0].world;
  const inputs=ctx.animation.inspect([camera.hash]);await call('animation.seek',{frame:7});
  const actual=ctx.document.world(camera.hash),targetError=Math.max(...aim.map((v,i)=>Math.abs(v-actual[i])));
  const hasTarget=inputs.objects.some(o=>o.id===camera.hash&&o.target===target.hash)&&inputs.channels.some(c=>c.id===target.hash);
  // This second assembly has just one authored rotation. Its native transforms
  // are identical at every integer frame, including both animation endpoints.
  await call('scene.new');
  const owner=await call('scene.create',{type:'cfd'}),mesh=await call('mesh.create',{
    vertices:[0,11,1,0,27,2,0,12,6],indices:[0,1,2]});
  const shaft=await call('scene.group',{ids:[mesh.hash]});
  await call('transform.apply',{ids:[shaft.hash],position:[0,120,0]});
  await key(owner.hash,'param:Speed',0,0);await key(owner.hash,'param:Speed',1,2);
  await key(shaft.hash,'rotation',0,[0,0,0]);await key(shaft.hash,'rotation',1,[-720,0,0]);
  await call('animation.seek',{frame:1});await call('diagnostics.frame',{frames:2});
  const held=frameEngine.pluginAuthoringStamp(),fitted=await nativeAxialSpin(device,ctx,owner.hash),post=frameEngine.pluginAuthoringStamp();
  const wall=(pointsWorldM=[])=>call('plugins.command',{id:owner.hash,operation:'wall-motion',args:{pointsWorldM}});
  const field=await wall(),origin=field.axisOriginWorldM,point=origin.map((x,k)=>x+[0,.03,.04][k]);
  const probe=await wall([origin,point]),velocity=probe.velocityWorldMPerS;
  const probeError=Math.max(Math.hypot(...velocity[0]),Math.hypot(velocity[1][0],velocity[1][1]-.04*omega,velocity[1][2]+.03*omega));
  const endFrame=(await call('animation.inspect')).frame;
  await key(shaft.hash,'rotation',0,[90,0,0]);let stale=false;
  try{await fitted.assertCurrent();}catch{stale=true;}
  return {pointErrorMm,velocityErrorMPerS,targetError,hasTarget,untouched,endFrame,probeErrorMPerS:probeError,fittedRpm:fitted.motion.rpm,
    verifiedFrames:fitted.motion.verifiedFrames,stale,
    pass:pointErrorMm<1e-6&&velocityErrorMPerS<1e-5&&targetError<1e-8&&hasTarget&&untouched&&endFrame===1&&
      field.kind==='rigid-rotation'&&field.occurrences===1&&probeError<1e-7&&
      held.revision===post.revision&&held.epoch===post.epoch&&Math.abs(fitted.motion.rpm+120*clock.fps)<1e-6&&stale};
}
