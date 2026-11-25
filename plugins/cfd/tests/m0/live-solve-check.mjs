// Exercise the installed plugin through the same operations and Attributes
// buttons as the editor. No benchmark fixture or solver export drives this run.
export async function verifyLiveSolve(){
  const call=(name,params={})=>frameAI.call(name,params);
  await call('scene.new');
  const owner=await call('scene.create',{type:'cfd'}),id=owner.hash;
  const command=(operation,args={})=>call('plugins.command',{id,operation,args});
  async function waitUntil(test){
    const until=performance.now()+360000;
    do{
      const value=await command('results');
      if(value.state==='failed')throw Error(JSON.stringify(value.job.error));
      if(test(value))return value;
      await new Promise(resolve=>setTimeout(resolve,50));
    }while(performance.now()<until);
    throw Error('Timed out waiting for live CFD output.');
  }
  const empty=await command('solve-frame');
  const exact=await waitUntil(v=>v.state==='ready');
  if(exact.result.solver!=='uniform-equilibrium'||exact.result.forceLocal.magnitude!==0)throw Error('Empty box has a body force');
  const sphere=await call('scene.create',{type:'sphere',params:{diameter:80,'angle approximation':10}});
  await call('transform.set',{ids:[sphere.hash],channel:'position',axis:1,value:110,coordinates:'world'});
  await call('scene.update',{id,params:{Speed:0}});
  await call('scene.select',{ids:[id]});document.querySelector('#tabAttributes').click();
  await call('diagnostics.frame',{frames:3});
  const button=document.querySelector('[data-plugin-action-button="solve-frame"]');
  if(!button||button.textContent!=='Frame')throw Error('Native Solve Frame button is missing');
  button.click();const rest=await waitUntil(v=>v.state==='ready'&&v.job.id!==empty.job.id);
  if(rest.result.occurrences!==1||rest.result.forceLocal.magnitude!==0)throw Error('Incorrect static equilibrium');
  await call('scene.update',{id,params:{Speed:.018}});
  const invalid=await command('results');
  if(invalid.state!=='stale'||invalid.result!==null)throw Error('Stale equilibrium survived input edit');
  const handle=await command('solve-frame',{fidelityBudget:'preview'}),again=await command('solve-frame',{fidelityBudget:'preview'});
  if(again.job.id!==handle.job.id)throw Error('Duplicate active solve');
  const mid=await waitUntil(v=>v.result?.solver==='cartesian-fvm'&&v.result.steps>=1);
  const r=mid.result;
  if(!(r.forceLocal.drag>0&&r.forceWorld.every(Number.isFinite)&&r.torque.every(Number.isFinite)&&r.validity.maxDivergencePerS<1e-6))
    throw Error('Invalid native sphere load or mass residual: '+JSON.stringify(r));
  const part=r.surfaceFields?.occurrences[0],samples=[];
  if(!part||part.hash!==sphere.hash)throw Error('Missing native sphere surface field');
  for(let k=0;k<20;k++){
    const triangle=Math.floor((k+.5)*part.triangles/20);
    try{samples.push(await command('probe',{occurrence:0,triangle}));}
    catch(e){if(e.code!=='STALE_CFD_RESULT')throw e;k--;}
  }
  const valid=samples.filter(s=>s.pressureCoverage>0);
  if(valid.length<5||!valid.some(s=>s.pressurePa>0)||!valid.some(s=>s.pressurePa<0)||
    !valid.every(s=>Math.abs(s.pressurePa/(.5*r.medium.rho*.018**2)-s.Cp)<1e-5&&s.gammaRev>=0&&s.gammaRev<=1&&
      s.areaM2>0&&s.lossDensityUnit==='N/m2'&&s.dragDensityNPerM2>=0&&s.attributedPowerW>=0))
    throw Error('Surface observations disagree with the flow units or coverage: '+JSON.stringify(samples));
  const separation=document.querySelector('[data-plugin-action-button="separation-map"]');
  if(!separation||!separation.getClientRects().length)throw Error('No Separation map in native Attributes');
  const drag=document.querySelector('[data-plugin-action-button="drag-map"]');
  if(!drag||drag.getAttribute('aria-pressed')!=='true')throw Error('Drag must be the initial field of a new solution');
  await call('view.set',{index:1,single:true,shading:'solid',focus:sphere.hash});
  await call('diagnostics.frame',{frames:2});
  const points=[];
  for(const offset of [-28,-14,0,14,28])for(const y of [-12,12]){
    const hit=await call('view.project',{point:[offset,110+y,y]});points.push(hit.screen);
  }
  const dragColors=(await call('diagnostics.pixels',{points})).colors;
  document.querySelector('[data-plugin-action-button="pressure-map"]').click();await call('diagnostics.frame',{frames:3});
  const pressureColors=(await call('diagnostics.pixels',{points})).colors;
  const changedDragPixels=dragColors.filter((a,i)=>a.slice(0,3).some((v,k)=>Math.abs(v-pressureColors[i][k])>12)).length;
  if(!changedDragPixels)throw Error('Drag density was not visible on the native model');
  separation.click();await call('diagnostics.frame',{frames:3});
  if(separation.getAttribute('aria-pressed')!=='true')throw Error('Map selection did not reach the native viewport');
  const separationColors=(await call('diagnostics.pixels',{points})).colors;
  const changedPixels=pressureColors.filter((a,i)=>a.slice(0,3).some((v,k)=>Math.abs(v-separationColors[i][k])>12)).length;
  if(!changedPixels)throw Error('Switching surface fields did not change measured native pixels: '+JSON.stringify([pressureColors,separationColors]));
  const stop=document.querySelector('[data-plugin-action-button="solve-frame"]');
  if(stop?.textContent!=='Stop')throw Error('Running calculator has no Stop button');
  stop.click();await waitUntil(v=>v.state==='stopped'&&v.result===null);
  await command('solve-frame',{fidelityBudget:'preview'});
  await call('transform.set',{ids:[sphere.hash],channel:'position',axis:1,value:130,coordinates:'world'});
  await call('diagnostics.frame',{frames:3});
  const stale=await waitUntil(v=>v.state==='stale'&&v.result===null);
  return {pass:true,empty:exact.result,rest:rest.result,mid:r,samples,changedPixels,changedDragPixels,finalState:stale.state};
}

export async function verifyLiveSphere(){
  const call=(name,params={})=>frameAI.call(name,params);
  await call('scene.new');
  const owner=await call('scene.create',{type:'cfd'}),id=owner.hash,U=.018258982159215297;
  await call('scene.update',{id,params:{Speed:U}});
  const sphere=await call('scene.create',{type:'sphere',params:{diameter:80,'angle approximation':5}});
  await call('transform.set',{ids:[sphere.hash],channel:'position',axis:1,value:100,coordinates:'world'});
  await call('scene.select',{ids:[id]});document.querySelector('#tabAttributes').click();
  await call('diagnostics.frame',{frames:3});
  document.querySelector('[data-plugin-action-button="solve-frame"]').click();
  const start=performance.now();
  let value,last=-1;
  do{
    await new Promise(resolve=>setTimeout(resolve,500));
    value=await call('plugins.command',{id,operation:'results',args:{}});
    if(value.result&&value.result.completeWindows!==last){
      last=value.result.completeWindows;console.log('CFD live sphere window '+last+' steps '+value.result.steps+' drag '+value.result.forceLocal.drag+' N');
    }
    if(value.state==='failed'||value.state==='stale')throw Error(JSON.stringify(value));
    if(performance.now()-start>4*60*60*1000)throw Error('Native sphere did not finish in the allotted run.');
  }while(value.state==='queued'||value.state==='solving');
  const r=value.result,cd=r.forceLocal.drag/(.5*r.medium.rho*U**2*Math.PI*.04**2),shape=r.shape;
  let changedPixels=0,vertices=0,outwardSensitivity=0,nonzero=0,probe=null;
  if(shape?.state==='ready'){
    const command=(operation,args={})=>call('plugins.command',{id,operation,args});
    const part=r.surfaceFields.occurrences[0];
    for(let i=0;i<part.vertices;i+=128){
      const samples=await command('shape-gradient',{occurrence:0,firstVertex:i,count:Math.min(128,part.vertices-i)});
      for(const v of samples.vertices){
        if(!v.gradientWorldNPerMm.every(Number.isFinite))throw Error('Nonfinite native force sensitivity');
        vertices++;if(v.normalNPerMm){outwardSensitivity+=v.normalNPerMm;nonzero++;}
      }
    }
    await call('view.set',{index:1,single:true,shading:'solid',focus:sphere.hash});await call('diagnostics.frame',{frames:3});
    const points=[];for(const x of [-28,-14,0,14,28])for(const y of [-12,12])points.push((await call('view.project',{point:[x,100+y,y]})).screen);
    const before=(await call('diagnostics.pixels',{points})).colors;
    const button=document.querySelector('[data-plugin-action-button="shape-map"]');if(!button?.getClientRects().length)throw Error('Missing Shape button');
    button.click();await call('diagnostics.frame',{frames:3});
    const after=(await call('diagnostics.pixels',{points})).colors;
    changedPixels=before.filter((a,i)=>a.slice(0,3).some((v,k)=>Math.abs(v-after[i][k])>12)).length;
    probe=await command('probe',{occurrence:0,triangle:Math.floor(part.triangles/3)});
    if(button.getAttribute('aria-pressed')!=='true'||!Number.isFinite(probe.shapeDensityNPerM3))throw Error('Native Shape selection or probe failed');
  }
  return {pass:value.state==='ready'&&Math.abs(cd/1.087-1)<.05&&r.validity.maxDivergencePerS<1e-6&&shape?.state==='ready'&&changedPixels>0&&nonzero>0,
    elapsedMs:performance.now()-start,cd,referenceCd:1.087,result:r,shapeCheck:{vertices,nonzero,outwardSensitivityNPerMm:outwardSensitivity,changedPixels,probe}};
}

export async function verifyLiveRotating(device){
  const {createNativeRotorFixture}=await import('./native-case.mjs');
  const {boxHash:id,motion}=await createNativeRotorFixture(device,true);
  const op=(operation,args={})=>frameAI.call('plugins.command',{id,operation,args});
  const started=await op('solve-frame',{fidelityBudget:'preview'}),until=performance.now()+240000;
  let snapshot;
  try{
    do{
      await new Promise(resolve=>setTimeout(resolve,80));snapshot=await op('results');
      if(snapshot.state==='failed'||snapshot.state==='stale')throw Error(JSON.stringify(snapshot));
      if(performance.now()>until)throw Error('No native rotating-frame load arrived');
    }while((snapshot.result?.steps??0)<4);
    const r=snapshot.result,occ=r.surfaceFields.occurrences;
    if(occ.length!==3)throw Error('Missing blade or hub fields');
    const probes=[];
    for(const o of occ)probes.push(await op('probe',{occurrence:o.occurrence,triangle:Math.floor(o.triangles*.4)}));
    const shaftWorkErrorW=Math.abs(r.powerW+motion.omega*r.rotorMetrics.shaftTorqueNm);
    return {pass:r.steps>=4&&r.forceLocal.magnitude>0&&r.torque.every(Number.isFinite)&&
      r.surfaceFields.loss.unit==='W/m2'&&r.surfaceFields.loss.attributedPowerW>0&&probes.every(p=>p.lossDensityUnit==='W/m2'&&p.dragDensityNPerM2===null)&&
      Number.isFinite(r.powerW)&&r.rotorMetrics.J===0&&shaftWorkErrorW<1e-6&&r.validity.maxDivergencePerS<1e-6,
      job:started.job,rpm:motion.rpm,shaftWorkErrorW,result:r,probes};
  }finally{await op('stop');}
}
