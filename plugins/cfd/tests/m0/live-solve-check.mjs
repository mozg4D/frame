// Exercise the installed plugin through the same operations and Attributes
// buttons as the editor. No benchmark fixture or solver export drives this run.
export async function verifyOfflineRender(){
  const call=(name,params={})=>frameAI.call(name,params);
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  await call('scene.new');
  const {hash:id}=await call('scene.create',{type:'cfd',params:{Speed:.018258982159215297}});
  const sphere=await call('scene.create',{type:'sphere',params:{diameter:80,'angle approximation':5}});
  await call('transform.set',{ids:[sphere.hash],channel:'position',axis:1,value:100,coordinates:'world'});
  await call('view.set',{index:0,single:true,focus:sphere.hash});
  const camera=await call('scene.create',{type:'render',params:{renderer:'Viewport',realtime:'off','resolution x':96,'resolution y':96}});
  const op=(operation,args={})=>call('plugins.command',{id,operation,args});
  const image=()=>call('render.export',{kind:'image',download:false});
  const status=()=>op('results');
  await call('view.set',{index:1,single:true,shading:'wireframe'});
  await call('render.start');await call('render.stop');
  const idle=await status();
  if(idle.job)throw Error('A live camera preview initiated CFD.');
  const first=await image(),firstResult=await status();
  if(!first.bytes||firstResult.state!=='ready'||firstResult.result.solver!=='cartesian-fvm'||!firstResult.result.surfaceFields.available.includes('Shape'))
    throw Error('Offline image did not await the steady solved surface: '+JSON.stringify({first,firstResult}));
  const points=Array.from({length:64},(_,i)=>[(i%8+.5)/8,(Math.floor(i/8)+.5)/8]);
  const pixels=async()=>(await call('render.pixels',{points})).colors;
  const drag=await pixels();await op('pressure-map');const pressureImage=await image(),pressure=await pixels(),cached=await status();
  const changed=drag.filter((c,i)=>c.slice(0,3).some((v,k)=>Math.abs(v-pressure[i][k])>12)).length;
  if(!changed||cached.job.id!==firstResult.job.id)throw Error('Offline map or cache mismatch: '+JSON.stringify({changed,first,cached:cached.job,drag,pressure}));
  await call('scene.update',{id,params:{Speed:0}});
  await call('animation.key',{id,path:'param:Speed',frame:0,value:.018,interpolation:'hard'});
  await call('animation.key',{id,path:'param:Speed',frame:2,value:0,interpolation:'hard'});
  await call('animation.seek',{frame:7});
  const video=await call('render.export',{kind:'video',start:2,end:4,download:false}),held=(await call('animation.inspect')).frame;
  const history=await op('force-history');
  if(video.frames!==3||held!==7||history.samples.map(s=>s.frame).join(',')!=='2,3,4'||history.samples.some(s=>s.magnitude!==0||!s.stationary))
    throw Error('Offline interval solved an unencoded frame or lost its measured load: '+JSON.stringify({video,held,history}));
  await call('animation.seek',{frame:0});await call('scene.select',{ids:[camera.hash]});document.querySelector('#tabAttributes').click();
  // Stop on the ordinary editor button while the public export command is waiting.
  async function cancelExport(useAPI){
    const render=image();
    const limit=performance.now()+30000;
    while(frameEngine.renderState().exportKind!=='image'&&performance.now()<limit)await wait(10);
    if(frameEngine.renderState().exportKind!=='image')throw Error('Export did not enter its physical readiness wait');
    await wait(250);
    if(useAPI)await call('render.stop');else document.getElementById('frameRenderImage').click();
    const output=await render;if(!output.cancelled||output.bytes)throw Error('Cancelled output yielded a file');
    return output;
  }
  const cancelled=await cancelExport(false),owned=await status();
  if(owned.state!=='stopped')throw Error('Render-owned CFD work remained active: '+JSON.stringify(owned.job));
  const interactive=await op('solve-frame');const interrupted=await cancelExport(true),joined=await status();
  if(!['queued','solving','ready'].includes(joined.state)||joined.job?.id!==interactive.job.id)
    throw Error('Cancelling an export lost the independent interactive solve: '+JSON.stringify({interactive:interactive.job,joined}));
  await op('stop');await call('scene.update',{id,visible:false});
  const hidden=await image(),ignored=await status();
  return {pass:!!hidden.bytes&&ignored.state!=='solving'&&ignored.state!=='ready',first,pressureImage,changedPixels:changed,
    solver:firstResult.result.solver,ready:firstResult.state,windows:firstResult.result.completeWindows,forceN:firstResult.result.forceWorld,
    maps:firstResult.result.surfaceFields.available,job:firstResult.job.id,reused:cached.job.id,video,held,history,cancelled,owned:owned.state,
    interrupted,joined:joined.state,hidden,ignored:ignored.state};
}

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
  let changedPixels=0,vertices=0,outwardSensitivity=0,nonzero=0,probe=null,hover=null;
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
    const canvas=document.querySelector('#frame-engine-canvas'),[x,y]=points[4];
    canvas.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'mouse',clientX:x,clientY:y}));
    for(let i=0;i<80;i++){await new Promise(resolve=>setTimeout(resolve,40));const label=canvas.closest('.view').querySelector('.frame-surface-probe');
      if(label?.getClientRects().length){hover=label.textContent;break;}}
  }
  return {pass:value.state==='ready'&&Math.abs(cd/1.087-1)<.05&&r.validity.maxDivergencePerS<1e-6&&shape?.state==='ready'&&changedPixels>0&&nonzero>0&&/^Shape .+N\/m³.+N\/mm$/.test(hover),
    elapsedMs:performance.now()-start,cd,referenceCd:1.087,result:r,shapeCheck:{vertices,nonzero,outwardSensitivityNPerMm:outwardSensitivity,changedPixels,probe,hover}};
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

// Three normal Frame objects measure a box and two complementary parts of it.
// Keep all three boxes inside the same body's bounds so the surrounding flow,
// discrete grid and physical time are identical. Compare moments at one origin.
export async function verifyLiveRegions(){
  const call=(name,params={})=>frameAI.call(name,params),math=frameEngine.pluginMath;
  await call('scene.new');
  const sphere=await call('scene.create',{type:'sphere',params:{diameter:80,'angle approximation':10}});
  await call('transform.apply',{ids:[sphere.hash],position:[0,100,0],coordinates:'world'});
  const boxes=[];
  for(const [depth,z] of [[72,0],[36,-18],[36,18]]){
    const {hash:id}=await call('scene.create',{type:'cfd',params:{Speed:.018}});
    await call('transform.apply',{ids:[id],size:[74,70,depth],position:[0,0,0],coordinates:'world'});
    const center=()=>math.point(frameEngine.pluginWorld(id),[0,500,0]),base=center(),target=[0,100,z];
    await call('transform.apply',{ids:[id],position:target.map((v,a)=>v-base[a]),coordinates:'world'});
    const world=frameEngine.pluginWorld(id),corners=[[-500,0,-500],[500,1000,500]].map(p=>math.point(world,p));
    const extent=corners[1].map((v,a)=>v-corners[0][a]);
    if(Math.hypot(...center().map((v,a)=>v-target[a]))>.01||Math.hypot(...extent.map((v,a)=>v-[74,70,depth][a]))>.02)
      throw Error('Incorrect native regional box placement: '+JSON.stringify({center:center(),extent,target,base}));
    boxes.push({id,corners,pivot:math.point(world,frameEngine.pluginPivot(id).slice(12,15)).map(x=>.001*x)});
  }
  const regions=[];
  for(const {id,corners,pivot} of boxes){
    const op=(operation,args={})=>call('plugins.command',{id,operation,args});
    await op('solve-frame',{fidelityBudget:'preview'});
    try{
      let r;const until=performance.now()+120000;
      do{
        const state=await op('results');
        if(state.state==='failed'||state.state==='stale')throw Error(JSON.stringify(state));
        if(performance.now()>until)throw Error('Missing regional load');
        r=state.result;if(r?.steps>=4)break;
        await new Promise(resolve=>setTimeout(resolve,16));
      }while(true);
      if(!r.validity.partiallyContained||r.validity.loadScope!=='inside-cfd-box'||r.occurrences!==1)throw Error('Unexpected region: '+JSON.stringify(r));
      const triangles=r.surfaceFields.occurrences[0].triangles,probes=[];
      for(let j=0;j<36;j++){
        try{probes.push(await op('probe',{occurrence:0,triangle:Math.floor((j+.5)*triangles/36)}));}
        catch(error){if(error.code!=='STALE_CFD_RESULT')throw error;j--;}
      }
      const shift=math.cross(pivot,r.forceWorld);
      regions.push({corners,pivot,cells:r.cells,steps:r.steps,time:r.physicalTimeS,
        force:r.forceWorld,torqueAtPivot:r.torque,momentAtOrigin:r.torque.map((v,i)=>v+shift[i]),
        divergence:r.validity.maxDivergencePerS,profiles:r.profiles,probes});
    }finally{await op('stop');}
  }
  const [full,lo,hi]=regions;
  const error=key=>Math.hypot(...full[key].map((x,i)=>x-lo[key][i]-hi[key][i]))/Math.max(1e-30,Math.hypot(...full[key]));
  const forceError=error('force'),momentError=error('momentAtOrigin');
  let maxAreaError=0,outside=[0,0],inside=[0,0],invalid=0;
  for(let i=0;i<full.probes.length;i++){
    const a=full.probes[i],b=lo.probes[i],c=hi.probes[i];
    maxAreaError=Math.max(maxAreaError,Math.abs(a.areaM2-b.areaM2-c.areaM2));
    for(const [j,v] of [b,c].entries()){
      if(v.areaM2>0){inside[j]++;continue;}
      outside[j]++;if(v.pressurePa!==null||v.Cp!==null||v.gammaRev!==null||v.lossDensity!==null||v.attributedPowerW!==0)invalid++;
    }
  }
  return {regions,forceError,momentError,maxAreaError,outside,inside,invalid,
    pass:regions.every(r=>r.steps===full.steps&&Math.abs(r.time-full.time)<1e-8&&r.cells===full.cells&&r.divergence<1e-6)&&
      full.force[0]>0&&forceError<.002&&momentError<.002&&maxAreaError<5e-10&&Math.min(...outside,...inside)>0&&invalid===0};
}

export async function verifyLiveHover(device,movePointer){
  const call=(name,params={})=>frameAI.call(name,params),math=frameEngine.pluginMath;
  await call('scene.new');
  const vertices=[[-40,60,-40],[40,60,-40],[40,140,-40],[-40,140,-40],[-40,60,40],[40,60,40],[40,140,40],[-40,140,40]];
  const faces=[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,4,7],[0,7,3],[1,2,6],[1,6,5],[0,1,5],[0,5,4],[3,7,6],[3,6,2]];
  const body=await call('mesh.create',{name:'Native probe reference',vertices:vertices.flat(),indices:faces.flat(),storage:'texture'});
  const make=()=>call('scene.create',{type:'cfd',params:{Speed:.017}});
  const big=(await make()).hash,small=(await make()).hash;
  await call('transform.apply',{ids:[small],size:[180,180,180],position:[0,0,0],coordinates:'world'});
  const center=math.point(frameEngine.pluginWorld(small),[0,500,0]);
  await call('transform.apply',{ids:[small],position:[0,100,0].map((v,i)=>v-center[i]),coordinates:'world'});
  const op=(id,operation,args={})=>call('plugins.command',{id,operation,args});
  await call('scene.select',{ids:[body.hash]});await call('view.set',{index:1,single:true,shading:'solid',focus:body.hash});
  await call('diagnostics.frame',{frames:2});
  let triangle=-1,screen;
  for(const [t,ids] of faces.entries()){
    const center=[0,1,2].map(a=>ids.reduce((s,i)=>s+vertices[i][a],0)/3);
    const p=await call('view.project',{point:center}),[x,y]=p.screen;
    const pick=await call('view.pick',{x,y});
    if(pick.point&&Math.hypot(...pick.point.map((v,a)=>v-center[a]))<.1){triangle=t;screen=[x,y];break;}
  }
  if(triangle<0)throw Error('Cannot identify the visible native polygon in the test view');
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  for(const id of [big,small]){
    await op(id,'solve-frame',{fidelityBudget:'preview'});const until=performance.now()+150000;
    for(;;){
      const state=await op(id,'results');
      if(['ready','unconverged'].includes(state.state)&&state.result?.surfaceFields)break;
      if(state.state==='failed'||state.state==='stale'||performance.now()>until)throw Error('No complete hover reference: '+JSON.stringify(state));
      await wait(120);
    }
  }
  await op(big,'pressure-map');await op(small,'separation-map');
  const format=v=>v!==0&&(Math.abs(v)<.001||Math.abs(v)>=1e5)?v.toExponential(3):String(Number(v.toPrecision(4)));
  const a=await op(big,'probe',{occurrence:0,triangle}),b=await op(small,'probe',{occurrence:0,triangle});
  if(a.pressurePa===null||b.gammaRev===null||b.lossDensity===null)throw Error('Chosen face has incomplete reference fields');
  const expected={Pressure:'Pressure  '+format(a.pressurePa)+' Pa  ·  Cp '+format(a.Cp),Separation:'Separation  '+format(100*b.gammaRev)+'%',
    Drag:'Drag  '+format(b.lossDensity)+' '+(b.lossDensityUnit==='N/m2'?'N/m²':'W/m²')};
  const canvas=document.querySelector('#frame-engine-canvas'),section=canvas.closest('.view');
  const move=([x,y])=>movePointer?movePointer(x,y):canvas.dispatchEvent(new PointerEvent('pointermove',{clientX:x,clientY:y,pointerId:1,pointerType:'mouse',bubbles:true}));
  const visible=()=>{const el=section.querySelector('.frame-surface-probe');return el?.getClientRects().length?el.textContent:null;};
  async function expect(value){
    for(let i=0;i<80;i++){if(visible()===value)return visible();await wait(50);}
    throw Error('Native hover showed '+JSON.stringify(visible())+'; expected '+JSON.stringify(value)+' '+JSON.stringify({error:canvas.dataset.operationError,screen}));
  }
  const pixel=async()=>(await call('diagnostics.pixels',{points:[screen]})).colors[0];
  await move(screen);const normal=await expect(expected.Separation),defaultColor=await pixel();
  await call('scene.select',{ids:[big]});await call('diagnostics.frame',{frames:2});
  const selected=await expect(expected.Pressure),selectedColor=await pixel();
  await call('scene.select',{ids:[small]});await call('diagnostics.frame',{frames:2});
  await expect(expected.Separation);const smallerColor=await pixel();
  await op(small,'drag-map');const changedMode=await expect(expected.Drag);
  const rect=canvas.getBoundingClientRect();await move([rect.left+5,rect.top+25]);await wait(175);await expect(null);
  await move(screen);await expect(expected.Drag);
  await call('transform.set',{ids:[body.hash],channel:'position',axis:0,value:250,coordinates:'world'});await call('diagnostics.frame',{frames:2});
  await expect(null);const final=[(await op(big,'results')).state,(await op(small,'results')).state];
  return {triangle,screen,reference:{large:a,small:b},normal,selected,changedMode,defaultColor,selectedColor,smallerColor,final,
    pass:defaultColor.every((v,i)=>v===smallerColor[i])&&defaultColor.slice(0,3).some((v,i)=>Math.abs(v-selectedColor[i])>5)&&final.every(v=>v==='stale')};
}

// Compact instances share one hidden source mesh and owner hash. The native
// ray must recover the transformed instance and its original triangle.
export async function verifyCloudHover(){
  const call=(name,params={})=>frameAI.call(name,params),math=frameEngine.pluginMath;
  await call('scene.new');const {hash:atoms}=await call('plugins.create',{plugin:'atomic'});
  const atom=(operation,args={})=>call('plugins.command',{id:atoms,operation,args});
  await atom('create-crystal',{species:6,lattice:10,cells:[6,6,6]});
  const list=(await atom('inspect',{count:216})).atoms;
  const {hash:cloud}=await atom('create-selection',{tag:'Fixed',ids:list.map(a=>a.id),name:'Compact native surfaces'});
  await call('scene.update',{id:cloud,parent:''});await call('scene.delete',{ids:[atoms]});
  const {hash:id}=await call('scene.create',{type:'cfd',params:{Speed:.02}});
  const box=frameEngine.pluginWorld(id),meshes=frameEngine.pluginSnapshot(id,[],true).meshes.filter(m=>m.hash===cloud);
  if(meshes.length!==216)throw Error('Missing native compact occurrences: '+meshes.length);
  const worlds=meshes.map(m=>math.mul(box,m.matrix));
  const best=worlds.reduce((a,m,i)=>m[13]>worlds[a][13]?i:a,0),world=worlds[best],radius=Math.hypot(...world.slice(0,3));
  const target=math.point(world,[0,0,0]),size=[1,1,1].map(()=>2.2*radius);
  await call('transform.apply',{ids:[id],size,position:[0,0,0],coordinates:'world'});
  const base=math.point(frameEngine.pluginWorld(id),[0,500,0]);
  await call('transform.apply',{ids:[id],position:target.map((v,a)=>v-base[a]),coordinates:'world'});
  await call('scene.select',{ids:[id]});await call('view.set',{index:1,single:true,shading:'solid',focus:id});
  await call('diagnostics.frame',{frames:3});
  const op=(operation,args={})=>call('plugins.command',{id,operation,args});
  await op('solve-frame',{fidelityBudget:'preview'});let state;const until=performance.now()+150000;
  do{
    await new Promise(resolve=>setTimeout(resolve,100));state=await op('results');
    if(state.state==='failed'||state.state==='stale'||performance.now()>until)throw Error('Missing compact surface result: '+JSON.stringify(state));
  }while(!['ready','unconverged'].includes(state.state));
  const r=state.result,local=math.mul(math.inv(frameEngine.pluginWorld(id)),world);
  const current=frameEngine.pluginSnapshot(id,[],true,false,{min:[-500,0,-500],max:[500,1000,500]}).meshes;
  const occurrence=current.findIndex(m=>m.hash===cloud&&math.equal(m.matrix,local,1e-8));
  if(occurrence<0)throw Error('The authored box missed its target occurrence');
  const t=(1+Math.sqrt(5))/2,u=3*Math.hypot(1,t),triangle=1,center=math.point(world,[0,(2*t+1)/u,t/u]);
  await op('pressure-map');const expected=await op('probe',{occurrence,triangle});
  if(expected.pressurePa===null)throw Error('The exposed compact triangle has no pressure');
  const [x,y]=(await call('view.project',{point:center})).screen,canvas=document.querySelector('#frame-engine-canvas');
  canvas.dispatchEvent(new PointerEvent('pointermove',{clientX:x,clientY:y,pointerType:'mouse',bubbles:true}));
  let text=null;
  for(let i=0;i<80;i++){await new Promise(resolve=>setTimeout(resolve,50));const el=canvas.closest('.view').querySelector('.frame-surface-probe');
    if(el?.getClientRects().length){text=el.textContent;break;}}
  const p=parseFloat(text?.split('Pressure')[1]);
  return {pass:Number.isFinite(p)&&Math.abs(p-expected.pressurePa)<Math.max(1e-12,Math.abs(p)*.00051),
    authoredOccurrences:meshes.length,participating:r.occurrences,occurrence,triangle,radius,screen:[x,y],expected,text};
}

export async function verifyFrameHistory(){
  const call=(name,params={})=>frameAI.call(name,params);
  const op=(id,operation,args={})=>call('plugins.command',{id,operation,args});
  await call('scene.new');
  const {hash:a}=await call('scene.create',{type:'cfd',name:'Wind'});
  const {hash:b}=await call('scene.create',{type:'cfd',name:'Rest',params:{Speed:0}});
  const body=await call('scene.create',{type:'sphere',params:{diameter:80,'angle approximation':15}});
  await call('transform.apply',{ids:[body.hash],position:[0,100,0],coordinates:'world'});
  for(const [frame,value] of [[0,.017],[1,0],[3,0]])await call('animation.key',{id:a,path:'param:Speed',frame,value,interpolation:'hard'});
  const seek=async frame=>{await call('animation.seek',{frame});await call('diagnostics.frame',{frames:2});};
  const solve=async id=>{
    await op(id,'solve-frame',{fidelityBudget:'preview'});const until=performance.now()+180000;
    for(;;){const s=await op(id,'results');if(['ready','unconverged'].includes(s.state))return s;
      if(s.state==='failed'||s.state==='stale'||performance.now()>until)throw Error('No native sample: '+JSON.stringify(s));
      await new Promise(resolve=>setTimeout(resolve,85));}
  };
  await seek(0);const first=await solve(a),third=Math.floor(first.result.surfaceFields.occurrences[0].triangles/3);
  const field=await op(a,'probe',{occurrence:0,triangle:third});
  await seek(1);const dirty=await op(a,'results');
  if(dirty.result||['solving','queued'].includes(dirty.state))throw Error('Seeking started a solve or exposed another frame');
  const rest=await solve(a);await solve(b);
  await seek(2);const preceding=await op(a,'results');if(preceding.result)throw Error('Unexpected implicit frame solve');
  const reused=await solve(a);
  const history=await op(a,'force-history',{limit:2}),tail=await op(a,'force-history',{firstFrame:history.nextFrame,limit:1});
  if(rest.result.solver!=='uniform-equilibrium'||reused.result.cache!=='hit'||reused.job.id!==rest.job.id||
    history.total!==3||history.samples.length!==2||history.nextFrame!==2||tail.samples[0]?.frame!==2)throw Error('Invalid force/cache history: '+JSON.stringify({rest,reused,history,tail}));
  await seek(0);const back=await op(a,'results'),again=await op(a,'probe',{occurrence:0,triangle:third});
  if(back.result?.cache!=='hit'||back.job.id!==first.job.id||field.pressurePa!==again.pressurePa||field.lossDensity!==again.lossDensity)
    throw Error('Returning to a solved frame did not restore its native fields');
  await call('view.set',{index:1,single:true,shading:'solid',focus:body.hash});await call('diagnostics.frame',{frames:2});
  if((await op(a,'force-history')).total!==3)throw Error('Camera navigation erased force history');
  await call('scene.select',{ids:[a]});document.querySelector('#tabAttributes').click();await call('diagnostics.frame',{frames:2});
  const click=(shift=false)=>document.querySelector('[data-plugin-readout="force"]').dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:shift}));
  const rendered=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const list=()=>frameCurves.channels.map(ch=>({name:ch.path,samples:ch.t.keys.size,measured:!!ch.readOnly}));
  document.querySelector('[data-field="Speed"]').closest('.attr-row').querySelector('.attr-lab').click();await rendered();
  const authored=list();click(true);await rendered();const appended=list();click();await rendered();const only=list();
  const readOnlyHits=frameCurves.hits.filter(h=>h.ch?.readOnly).length;
  const before=(await call('animation.inspect',{id:a})).channels;
  frameCurves.canvas.dispatchEvent(new KeyboardEvent('keydown',{key:'a',code:'KeyA',ctrlKey:true,bubbles:true}));
  frameCurves.canvas.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',code:'Delete',bubbles:true}));
  const after=(await call('animation.inspect',{id:a})).channels;
  const sampled=frameCurves.channels.map(ch=>[...ch.t.keys].map(([f,row])=>[f,row.v[ch.axis]]));
  const h=(await op(a,'force-history')).samples;
  if(sampled.some((rows,i)=>rows.length!==h.length||rows.some(([f,v],k)=>f!==h[k].frame||v!==(i<3?h[k].forceWorld[i]:h[k].magnitude))))
    throw Error('Displayed Force channels disagree with physical samples');
  await seek(1);await call('scene.select',{ids:[b]});await call('diagnostics.frame',{frames:2});click(true);await rendered();
  const together=list();await call('transform.set',{ids:[body.hash],channel:'position',axis:0,value:25,coordinates:'world'});
  await call('diagnostics.frame',{frames:2});const invalidated=(await op(a,'force-history')).total;
  return {pass:authored.some(c=>!c.measured&&c.name==='param:Speed')&&appended.filter(c=>c.measured).length===4&&appended.length===5&&
    only.length===4&&only.every(c=>c.measured&&c.samples===3)&&together.length===8&&readOnlyHits===0&&JSON.stringify(before)===JSON.stringify(after)&&invalidated===0,
    first:first.result.forceWorld,history,tail,cache:{equilibrium:reused.job.id===rest.job.id,fields:back.job.id===first.job.id},
    restoredProbe:again,authored,appended,only,together,readOnlyHits,invalidated};
}

export async function verifyAnimationSolve(){
  const call=(name,params={})=>frameAI.call(name,params);
  await call('scene.new');const {hash:id}=await call('scene.create',{type:'cfd',name:'Animation reference',params:{Speed:0}});
  const body=await call('scene.create',{type:'sphere',params:{diameter:80,'angle approximation':15}});
  await call('transform.apply',{ids:[body.hash],position:[0,100,0],coordinates:'world'});
  const seek=async frame=>{await call('animation.seek',{frame});await call('diagnostics.frame',{frames:2});};
  const op=(operation,args={})=>call('plugins.command',{id,operation,args});
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function until(test){
    const end=performance.now()+180000;
    for(;;){const v=await op('status');if(test(v))return v;
      if(v.animation?.state==='failed'||performance.now()>end)throw Error('Unexpected animation state: '+JSON.stringify(v));await wait(25);}
  }
  await seek(7);await call('scene.select',{ids:[id]});document.querySelector('#tabAttributes').click();
  await call('diagnostics.frame',{frames:3});const button=()=>document.querySelector('[data-plugin-action-button="solve-animation"]');
  if(button()?.textContent!=='Animation'||button().disabled)throw Error('Native Solve Animation button is unavailable');
  button().click();const busy=await until(s=>s.animation?.state==='solving');
  const shown=button()?.textContent,native=await until(s=>s.animation?.state==='ready');
  const time=await call('animation.inspect'),series=await op('force-history',{limit:512});
  if(time.frame!==7||native.animation.completedFrames!==time.total+1||native.animation.cachedFrames!==time.total||
    series.samples.length!==time.total+1||series.samples.some(s=>s.magnitude!==0||!s.stationary))throw Error('Native timeline or cached samples disagree: '+JSON.stringify({time,native,series}));
  await call('animation.key',{id,path:'param:Speed',frame:0,value:.017,interpolation:'hard'});
  await call('animation.key',{id,path:'param:Speed',frame:1,value:0,interpolation:'hard'});
  await call('animation.key',{id,path:'param:Speed',frame:3,value:0,interpolation:'hard'});
  const measured=await op('solve-animation',{firstFrame:0,lastFrame:3,fidelityBudget:'preview'});
  const duplicate=await op('solve-animation',{firstFrame:0,lastFrame:3,fidelityBudget:'preview'});
  const done=await until(s=>s.animation?.id===measured.animation.id&&['ready','unconverged'].includes(s.animation.state));
  const loads=await op('force-history'),restored=(await call('animation.inspect')).frame;
  await seek(0);const final=await op('results');
  if(final.result?.solver!=='cartesian-fvm'||final.result?.cache!=='hit')throw Error('Missing force and surface fields after revisiting solved frame');
  await seek(7);
  const stop=await op('solve-animation',{firstFrame:0,lastFrame:1,fidelityBudget:'standard'});
  await until(s=>s.animation?.id===stop.animation.id&&s.job?.frame===0&&s.state==='solving');
  const stopButton=button();if(stopButton.textContent!=='Stop')throw Error('Animation Stop unavailable');
  stopButton.click();
  for(let i=0;i<120&&(await call('animation.inspect')).frame!==7;i++)await wait(50);
  const stopped=await op('status'),stopFrame=(await call('animation.inspect')).frame;
  const override=await op('solve-animation',{firstFrame:0,lastFrame:1,fidelityBudget:'standard'});
  await until(s=>s.animation?.id===override.animation.id&&s.job?.frame===0&&s.state==='solving');
  await seek(11);const interrupted=await until(s=>s.animation?.state==='stale'||s.animation?.state==='stopped');
  await wait(150);const held=(await call('animation.inspect')).frame,dirty=await op('results');
  return {pass:shown==='Stop'&&busy.animation.state==='solving'&&duplicate.animation.id===measured.animation.id&&done.animation.completedFrames===4&&
    done.animation.cachedFrames>=2&&loads.total===4&&loads.samples[0].magnitude>0&&loads.samples.slice(1).every(s=>s.magnitude===0)&&
    restored===7&&stopped.animation.state==='stopped'&&stopFrame===7&&held===11&&dirty.result===null,
    full:native.animation,totalFrames:time.total+1,physical:done.animation,loads,restored,stopped:stopped.animation,stopFrame,interrupted:interrupted.animation,held};
}
