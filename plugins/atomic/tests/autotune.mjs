export async function autotuneChecks(page){
 const checks=[],timings=[],call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]),check=(name,pass,detail)=>{checks.push({name:'Atomic autotune: '+name,pass:!!pass,detail});if(!pass)throw Error(name+': '+JSON.stringify(detail));};
 try{
  const fcc=[[0,0,0],[0,.5,.5],[.5,0,.5],[.5,.5,0]],basis=[...fcc,...fcc.map(p=>p.map(v=>v+.25))],cluster=[];
  for(let z=0;z<3;z++)for(let y=0;y<3;y++)for(let x=0;x<3;x++)for(const p of basis)cluster.push({species:6,position:p.map((v,k)=>(v+[x,y,z][k])*3.567)});
  const reference=(await call('plugins.create',{plugin:'atomic'})).hash,c=(id,operation,args={})=>call('plugins.command',{id,operation,args});
  await c(reference,'settings',{Temperature:-273.15,Damping:0});await c(reference,'create-atoms',{atoms:cluster});const expected=await c(reference,'inspect',{count:216,forces:true});await call('scene.delete',{ids:[reference]});
  const h=(await call('plugins.create',{plugin:'atomic'})).hash,atoms=[];for(let z=0;z<2;z++)for(let y=0;y<4;y++)for(let x=0;x<5;x++)for(const a of cluster)atoms.push({species:6,position:a.position.map((v,k)=>v+16*[x,y,z][k])});
  await c(h,'settings',{Temperature:-273.15,Damping:0,'Target FPS':10});await c(h,'create-atoms',{atoms});
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
  const metadata=await call('plugins.describe',{plugin:'atomic'});check('Pause advertises interruptible operation metadata',metadata.operations.some(o=>o.id==='pause'&&o.interruptible));await c(h,'settings',{'Target FPS':1});await call('scene.select',{ids:[h]});await c(h,'play');await page.waitForTimeout(1100);
  const invalidStart=performance.now();let invalid=false;try{await c(h,'pause',{unexpected:true});}catch{invalid=true;}check('Invalid interruption arguments do not stop playback',invalid&&performance.now()-invalidStart<100&&(await page.locator('[data-plugin-action-button="toggle-play"]').textContent())==='Pause');const pauseStart=performance.now();await page.locator('[data-plugin-action-button="toggle-play"]').click();const paused=await c(h,'status'),pauseMs=performance.now()-pauseStart;timings.push({name:'Native Pause interrupts long compute window',ms:pauseMs,limit:400});check('Native Pause cancels continued computation promptly',!paused.playing&&pauseMs<400,{pauseMs});
  await c(h,'settings',{'Target FPS':60});const fast=await c(h,'status');check('Queued GPU work stays within one target frame',fast.packetBudgetMs*fast.maxQueuedPackets<=1000/60+.001,fast);
  await call('scene.delete',{ids:[h]});return {pass:true,checks,timings};
 }catch(error){return {pass:false,checks,timings,error:error.stack};}
}
