export async function autotuneChecks(page){
 const checks=[],timings=[],call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]),check=(name,pass,detail)=>{checks.push({name:'Atomic autotune: '+name,pass:!!pass,detail});if(!pass)throw Error(name+': '+JSON.stringify(detail));};
 try{
  const fcc=[[0,0,0],[0,.5,.5],[.5,0,.5],[.5,.5,0]],basis=[...fcc,...fcc.map(p=>p.map(v=>v+.25))],cluster=[];
  for(let z=0;z<3;z++)for(let y=0;y<3;y++)for(let x=0;x<3;x++)for(const p of basis)cluster.push({species:6,position:p.map((v,k)=>(v+[x,y,z][k])*3.567)});
  const reference=(await call('plugins.create',{plugin:'atomic'})).hash,c=(id,operation,args={})=>call('plugins.command',{id,operation,args});
  await c(reference,'settings',{Temperature:-273.15,Damping:0});await c(reference,'create-atoms',{atoms:cluster});const expected=await c(reference,'inspect',{count:216,forces:true});await call('scene.delete',{ids:[reference]});
  const h=(await call('plugins.create',{plugin:'atomic'})).hash,atoms=[];for(let z=0;z<2;z++)for(let y=0;y<4;y++)for(let x=0;x<5;x++)for(const a of cluster)atoms.push({species:6,position:a.position.map((v,k)=>v+16*[x,y,z][k])});
  await c(h,'settings',{Temperature:-273.15,Damping:0});await c(h,'create-atoms',{atoms});
  const fixedIds=Array.from({length:216},(_,i)=>i+217),velocityIds=Array.from({length:216},(_,i)=>i+649);
  await c(h,'create-selection',{tag:'Fixed',ids:fixedIds,name:'Fixed replica'});const force=await c(h,'create-selection',{tag:'Force',ids:[433],name:'Loaded replica'}),velocity=await c(h,'create-selection',{tag:'Velocity',ids:velocityIds,name:'Moving replica'});
  await c(h,'selection',{selection:force.hash,params:{'Force x':.02}});await c(h,'selection',{selection:velocity.hash,params:{'Velocity x':.03}});
  const begin=performance.now(),actual=await c(h,'inspect',{count:216,forces:true}),state=await c(h,'status');timings.push({name:'8640-atom cold initialization and tuning',ms:performance.now()-begin,limit:15000});
  check('Large world has measured serial/cooperative profiles',state.atoms===8640&&['descriptors','directedForces','gatherForces'].every(k=>state.kernelProfiles?.[k]?.serial?.length===2&&state.kernelProfiles[k].cooperative.length===2&&[...state.kernelProfiles[k].serial,...state.kernelProfiles[k].cooperative].every(v=>Number.isFinite(v)&&v>=0)),state.kernelModes);
  const forceError=Math.max(...actual.atoms.flatMap((a,i)=>a.force.map((v,k)=>Math.abs(v-expected.atoms[i].force[k])/Math.max(1,Math.abs(expected.atoms[i].force[k]))))),energyError=Math.max(...actual.atoms.map((a,i)=>Math.abs(a.energy-expected.atoms[i].energy)/Math.max(1,Math.abs(expected.atoms[i].energy))));
  check('Tuned replicas match the independent serial world',forceError<.002&&energyError<.001,{forceError,energyError});
  const fixedBefore=await c(h,'inspect',{offset:216,count:216,runtime:true,forces:true}),loaded=await c(h,'inspect',{offset:432,count:1,forces:true});
  check('External force survives tuned gathering',Math.abs(loaded.atoms[0].force[0]-expected.atoms[0].force[0]-.02)<.002,loaded.atoms[0].force);
  const t=performance.now();await c(h,'step',{timeFs:.5});timings.push({name:'8640-atom tuned exact interval',ms:performance.now()-t,limit:1000});const mobile=await c(h,'inspect',{count:216,runtime:true}),fixedAfter=await c(h,'inspect',{offset:216,count:216,runtime:true}),moving=await c(h,'inspect',{offset:648,count:216,runtime:true});
  check('Fixed atoms retain their centers with tuned kernels',fixedAfter.atoms.every((a,i)=>a.position.every((v,k)=>v===fixedBefore.atoms[i].position[k])));
  const velocityError=Math.max(...moving.atoms.map((a,i)=>Math.abs(a.position[0]-48-mobile.atoms[i].position[0]-.015)));
  check('Uniform Velocity remains physical with tuned kernels',velocityError<.0002,{velocityError});
  const metadata=await call('plugins.describe',{plugin:'atomic'});check('Atomic has no independent playback operations',!metadata.operations.some(o=>['play','pause','toggle-play'].includes(o.id)));await call('scene.select',{ids:[h]});await call('animation.seek',{frame:0});await call('animation.play');await page.waitForFunction(()=>document.querySelector('#tlCur').value!=='0');
  const invalidStart=performance.now();let invalid=false;try{await call('animation.pause',{unexpected:true});}catch{invalid=true;}check('Invalid Pause arguments do not stop playback',invalid&&performance.now()-invalidStart<100&&await page.locator('#tlPlay').getAttribute('aria-pressed')==='true');const pauseStart=performance.now();await page.locator('#tlPlay').click();await call('animation.pause');const paused=await c(h,'status'),pauseMs=performance.now()-pauseStart;timings.push({name:'Native timeline Pause drains the current compute frame',ms:pauseMs,limit:1000});check('Native timeline Pause prevents continued computation',!paused.playing&&pauseMs<1000,{pauseMs});
  const fast=await c(h,'status');check('Queued GPU work remains bounded for the measured step cost',fast.packetBudgetMs===8&&fast.maxQueuedPackets===((fast.simulationMs||0)>1000/60?8:2),fast);
  await call('scene.delete',{ids:[h]});return {pass:true,checks,timings};
 }catch(error){return {pass:false,checks,timings,error:error.stack};}
}
