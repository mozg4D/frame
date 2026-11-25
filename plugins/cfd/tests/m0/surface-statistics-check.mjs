import {gpuScope,nativeSurfaceStatistics} from '../../plugin.js';

function quantile(rows,column,area,rank){
  const sorted=rows.filter(row=>row[area]>0).sort((a,b)=>a[column]-b[column]);
  const target=rank*sorted.reduce((sum,r)=>sum+r[area],0);let sum=0;
  for(const r of sorted){sum+=r[area];if(sum>=target)return r[column];}
  return null;
}

// A half-plane cuts the tied maximum-pressure triangles. The retained
// triangular patch has an analytic centroid, including its world transform.
export async function verifySurfaceStatistics(device){
  const gpu=gpuScope(device),chunks=[],shown=[],reference=[];
  const frame={axes:[[0,1,0],[-1,0,0],[0,0,1]],originWorldM:[1,2,3]};
  const region={inverse:[1000,0,0,0,0,1000,0,0,0,0,1000,0,0,0,0,1]};
  const corners=[[-.25,.1,.1],[.75,.1,.1],[.75,.4,.1]],centroid=[5/12,.2,.1];
  try{
    for(const [occurrence,count] of [385,527].entries()){
      const sites=new Float32Array(48*count),field=new Float32Array(4*count),loss=new Float32Array(4*count),shape=new Float32Array(4*count);
      for(let i=0;i<count;i++){
        const n=i+reference.length%7,tied=occurrence===1&&[7,11].includes(i);
        const p=Math.fround(tied?513.75:-2.25+(Math.sin(n*13)*7.75)),gamma=Math.fround((i%11)/10);
        const a=Math.fround(tied?.05:(1+(i%41)**2)*.7e-5),coverage=Math.fround(tied?.5625:i%7===0?0:1/3+(i%3)/3);
        for(let k=0;k<3;k++){sites.set(corners[k].map((x,j)=>(x+centroid[j])/2),48*i+16*k);sites[48*i+16*k+3]=a;}
        field.set([p,gamma,coverage,coverage],4*i);
        loss.set([i+1,0,3*a,0],4*i);shape.set([Math.fround((i-202)/7),0,3*a,0],4*i);
        reference.push({p,gamma,abs:Math.abs(p),pa:3*a*coverage,loss:loss[4*i],shape:Math.abs(shape[4*i]),area:loss[4*i+2]});
      }
      chunks.push({site:gpu.buffer('Measured sites',sites),first:occurrence?700:0,triangles:count,cover:true});
      shown.push({occurrence,visible:gpu.buffer('Measured pressure and reversal',field),loss:gpu.buffer('Measured loss',loss),shape:gpu.buffer('Measured sensitivity',shape)});
    }
    const r=await nativeSurfaceStatistics(device,chunks,shown,region,frame,()=>{}),p=r.pressureStats,s=r.surfaceColorScale;
    const peak=[.825,2.25,3.1],area=reference.reduce((a,b)=>a+b.pa,0);
    const expected=[quantile(reference,'p','pa',.05),quantile(reference,'p','pa',.95),quantile(reference,'abs','pa',.975),
      quantile(reference,'loss','area',.975),quantile(reference,'shape','area',.975)];
    const values=[p.p05Pa,p.p95Pa,s.pressurePa,s.lossDensity,s.shapeNPerM3];
    const reversalArea=reference.reduce((a,b)=>a+(b.gamma>=.2?b.pa:0),0);
    const full=values.every((v,i)=>v===expected[i])&&p.minPa===Math.min(...reference.filter(v=>v.pa>0).map(v=>v.p))&&
      p.maxPa===513.75&&p.maxSurface.occurrence===1&&p.maxSurface.triangle===707&&Math.hypot(...p.maxCoord.map((v,i)=>v-peak[i]))<2e-7&&
      Math.abs(p.sampledAreaM2/area-1)<1e-6&&Math.abs(r.separationStats.above20PercentAreaM2/reversalArea-1)<1e-6;
    const e=device.createCommandEncoder();for(const part of shown){for(const b of [part.visible,part.loss,part.shape])e.clearBuffer(b);}
    device.queue.submit([e.finish()]);
    const none=await nativeSurfaceStatistics(device,chunks,shown,region,frame,()=>{});
    return {pass:full&&none.pressureStats.sampledAreaM2===0&&none.pressureStats.maxCoord===null&&none.pressureStats.p95Pa===null&&none.surfaceColorScale.shapeNPerM3===null,
      measured:r,expectedQuantiles:expected,expectedPeakWorldM:peak,expectedAreaM2:area,unobserved:none};
  }finally{gpu.close();}
}

export async function verifyLiveSurfaceReport(device){
  const reference=await verifySurfaceStatistics(device);
  if(!reference.pass)throw Error('Manufactured surface distribution mismatch: '+JSON.stringify(reference));
  const call=(name,args={})=>frameAI.call(name,args);
  await call('scene.new');const box=await call('scene.create',{type:'cfd',params:{Speed:.002}});
  const vertices=[[44,200,0]],faces=[],rings=8,sides=16;
  for(let i=1;i<rings;i++)for(let j=0;j<sides;j++){
    const t=Math.PI*i/rings,q=2*Math.PI*j/sides;
    vertices.push([44*Math.cos(t),200+36*Math.sin(t)*Math.cos(q),39*Math.sin(t)*Math.sin(q)]);
  }
  const pole=vertices.push([-44,200,0])-1,id=(i,j)=>1+(i-1)*sides+j%sides;
  for(let j=0;j<sides;j++){
    faces.push([0,id(1,j),id(1,j+1)],[id(rings-1,j),pole,id(rings-1,j+1)]);
    for(let i=1;i<rings-1;i++)faces.push([id(i,j),id(i+1,j),id(i+1,j+1)],[id(i,j),id(i+1,j+1),id(i,j+1)]);
  }
  await call('mesh.create',{name:'Native pressure reference',storage:'texture',vertices:vertices.flat(),indices:faces.flat()});
  const op=(operation,args={})=>call('plugins.command',{id:box.hash,operation,args});
  await op('solve-frame',{fidelityBudget:'preview'});let current;const start=performance.now();
  do{
    await new Promise(r=>setTimeout(r,150));current=await op('results');
    if(!['queued','solving','ready','partial'].includes(current.state)||performance.now()-start>12*60*1000)
      throw Error('Native surface report failed: '+JSON.stringify({state:current.state,job:current.job}));
  }while(current.state==='queued'||current.state==='solving');
  const r=current.result,rows=[];
  for(const [triangle,ids] of faces.entries()){
    const [a,b,c]=ids.map(i=>vertices[i]),u=b.map((v,k)=>v-a[k]),v=c.map((x,k)=>x-a[k]);
    const area=.5e-6*Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]);
    const p=await op('probe',{occurrence:0,triangle});
    rows.push({p:p.pressurePa,abs:Math.abs(p.pressurePa),pa:area*p.pressureCoverage,loss:p.lossDensity,area:p.areaM2,
      shape:Math.abs(p.shapeDensityNPerM3),shapeArea:p.areaM2,separationArea:area*p.separationCoverage,gamma:p.gammaRev});
  }
  const p=r.pressureStats,s=r.surfaceColorScale,withPressure=rows.filter(v=>v.pa>0),peak=faces[p.maxSurface.triangle].map(i=>vertices[i]);
  const expected=[quantile(rows,'p','pa',.05),quantile(rows,'p','pa',.95),quantile(rows,'abs','pa',.975),quantile(rows,'loss','area',.975),quantile(rows,'shape','shapeArea',.975)];
  const values=[p.p05Pa,p.p95Pa,s.pressurePa,s.lossDensity,s.shapeNPerM3],area=rows.reduce((sum,x)=>sum+x.pa,0);
  const inFace=p.maxCoord.every((x,k)=>1000*x>=Math.min(...peak.map(q=>q[k]))-.001&&1000*x<=Math.max(...peak.map(q=>q[k]))+.001);
  await op('pressure-map');await op('separation-map');await op('shape-map');const reused=await op('results');
  return {pass:current.state==='ready'&&r.shape?.state==='ready'&&r.validity.stationary&&inFace&&
    values.every((v,i)=>v===expected[i])&&p.minPa===Math.min(...withPressure.map(v=>v.p))&&p.maxPa===Math.max(...withPressure.map(v=>v.p))&&
    Math.abs(p.sampledAreaM2/area-1)<3e-6&&reused.job.id===current.job.id,
    job:current.job.id,triangles:faces.length,pressure:p,separation:r.separationStats,colorScale:s,independentQuantiles:expected,
    independentlySampledAreaM2:area,shape:r.shape?.state,maxDivergencePerS:r.validity.maxDivergencePerS,reference};
}
