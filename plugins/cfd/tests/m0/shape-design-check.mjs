// Drive complete, independent native solves. The family has one design
// parameter and identical topology. Its affine deformation preserves volume.
function fairing(parameter){
  const a=24*Math.exp(parameter),b=52*Math.exp(-.5*parameter),rings=24,sides=48,vertices=[[a,0,0]],indices=[];
  for(let i=1;i<rings;i++)for(let j=0;j<sides;j++){
    const t=Math.PI*i/rings,q=2*Math.PI*j/sides;
    vertices.push([a*Math.cos(t),b*Math.sin(t)*Math.cos(q),b*Math.sin(t)*Math.sin(q)]);
  }
  const pole=vertices.push([-a,0,0])-1,id=(i,j)=>1+(i-1)*sides+(j%sides);
  for(let j=0;j<sides;j++){
    indices.push(0,id(1,j),id(1,j+1));
    for(let i=1;i<rings-1;i++)indices.push(id(i,j),id(i+1,j),id(i+1,j+1),id(i,j),id(i+1,j+1),id(i,j+1));
    indices.push(id(rings-1,j),pole,id(rings-1,j+1));
  }
  let volume=0;for(let i=0;i<indices.length;i+=3){
    const [p,q,r]=indices.slice(i,i+3).map(j=>vertices[j]);
    volume+=(p[0]*(q[1]*r[2]-q[2]*r[1])+p[1]*(q[2]*r[0]-q[0]*r[2])+p[2]*(q[0]*r[1]-q[1]*r[0]))/6;
  }
  return {vertices,indices,volumeMm3:volume,axesMm:[a,b,b]};
}

export async function verifyShapeDesign(){
  const call=(name,params={})=>frameAI.call(name,params),trials=[];
  async function measure(parameter){
    await call('scene.new');
    const mesh=fairing(parameter),{hash:id}=await call('scene.create',{type:'cfd',params:{Speed:.012}});
    const body=await call('mesh.create',{name:'Fixed-volume fairing',storage:'texture',
      vertices:mesh.vertices.flatMap(([x,y,z])=>[x,y+210,z]),indices:mesh.indices});
    const op=(operation,args={})=>call('plugins.command',{id,operation,args});
    await op('solve-frame');const start=performance.now();let value,window=-1;
    for(;;){
      await new Promise(resolve=>setTimeout(resolve,450));value=await op('results');
      if(value.state==='ready')break;
      if(!['queued','solving'].includes(value.state)||performance.now()-start>20*60*1000)
        throw Error('No stationary design sample: '+JSON.stringify(value));
      const complete=value.result?.completeWindows;
      if(complete!==undefined&&complete!==window){window=complete;if(!(window%5))console.log('CFD live design '+parameter.toPrecision(4)+' window '+window);}
    }
    const r=value.result,part=r.surfaceFields?.occurrences[0];
    if(!r.validity.stationary||r.validity.maxDivergencePerS>=1e-6||r.shape?.state!=='ready'||part?.hash!==body.hash||part.vertices!==mesh.vertices.length)
      throw Error('Incomplete objective or Shape field: '+JSON.stringify(r));
    let derivative=0,covered=0;
    for(let first=0;first<part.vertices;first+=128){
      const {vertices}=await op('shape-gradient',{occurrence:0,firstVertex:first,count:Math.min(128,part.vertices-first)});
      for(const v of vertices){
        const [x,y,z]=mesh.vertices[v.vertex],g=v.gradientWorldNPerMm;
        derivative+=g[0]*x-.5*(g[1]*y+g[2]*z);if(v.areaM2>0)covered++;
      }
    }
    if(!Number.isFinite(derivative)||covered<part.vertices*.9)throw Error('Missing fixed-volume shape derivative');
    const result={parameter,axesMm:mesh.axesMm,volumeMm3:mesh.volumeMm3,vertices:part.vertices,covered,dragN:r.forceLocal.drag,
      dDragDParameterN:derivative,re:r.reynolds,steps:r.steps,windows:r.completeWindows,maxDivergencePerS:r.validity.maxDivergencePerS,
      adjointResidual:r.shape.momentumDefect,elapsedMs:performance.now()-start};
    console.log('CFD live design accepted measurement '+JSON.stringify(result));trials.push(result);return result;
  }
  let current=await measure(0);const baseline=current;let radius=.30;
  while(trials.length<6&&current.dragN>.90*baseline.dragN){
    if(current.dDragDParameterN===0)break;
    const delta=-Math.sign(current.dDragDParameterN)*Math.min(radius,.2*current.dragN/Math.abs(current.dDragDParameterN));
    const next=await measure(current.parameter+delta);next.predictedDragChangeN=delta*current.dDragDParameterN;next.measuredDragChangeN=next.dragN-current.dragN;
    if(next.measuredDragChangeN<0){current=next;radius=.30;}else radius*=.5;
  }
  const reduction=1-current.dragN/baseline.dragN,volumeError=Math.max(...trials.map(t=>Math.abs(t.volumeMm3/baseline.volumeMm3-1)));
  return {pass:reduction>=.1&&volumeError<1e-10&&trials.length<=6&&baseline.dragN>0,objective:'axial drag at fixed polygon volume',
    design:'axisymmetric laminar fairing in air',designEvaluations:trials.length,relativeDragReduction:reduction,relativeVolumeError:volumeError,trials};
}
