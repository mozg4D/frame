// Display-only clipping for inherited Boolean cage/spline polylines.
// Geometry/topology stays entirely in the R2 triangle Boolean. This module only
// keeps source/display curve intervals that lie on the final installed mesh.
const lerp3=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];
const near=(a,b,t)=>Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1])+Math.abs(a[2]-b[2])<=t;
const clock=()=>globalThis.performance?.now?.()??Date.now();

export async function clipBooleanCageToSurface(runtime,polylines,solid,{steps=32,refine=18}={}){
  if(!polylines?.length||!solid?.indices?.length)return{polylines:[],wallMilliseconds:0,grid:0,postings:0,tolerance:solid?.tolerance||0,probes:0,transitions:0};
  const flat=[],ranges=[],sources=[];
  for(const line of polylines){
    const points=line.closed&&line.points.length>2?line.points.concat([line.points[0]]):line.points;
    const start=flat.length/3;
    for(const p of points)flat.push(...p);
    ranges.push(start,points.length);sources.push({line,points});
  }
  const started=clock();
  const response=await runtime.surfaceClip({positions:solid.positions,indices:solid.indices},new Float32Array(flat),new Uint32Array(ranges),solid.tolerance||0,{steps,refine});
  const wallMilliseconds=clock()-started,eps=Math.max(1e-7,(response.tolerance||solid.tolerance||1e-7)*4),runs=Array.from({length:sources.length},()=>[]);
  for(let i=0;i<response.lineIds.length;i++){
    const li=response.lineIds[i],edge=response.edgeIds[i],source=sources[li];
    const a=lerp3(source.points[edge],source.points[edge+1],response.t[i*2]),b=lerp3(source.points[edge],source.points[edge+1],response.t[i*2+1]),list=runs[li],run=list.at(-1);
    if(run&&near(run.at(-1),a,eps))run.push(b);else list.push([a,b]);
  }
  const result=[];
  for(let li=0;li<sources.length;li++){
    const source=sources[li],list=runs[li];
    // If a clipped interval crosses the arbitrary start of a closed source loop,
    // reconnect the end/start runs. Full surviving loops remain closed.
    if(source.line.closed&&list.length>1&&near(list[0][0],source.points[0],eps)&&near(list.at(-1).at(-1),source.points.at(-1),eps)){
      const first=list.shift(),last=list.pop();list.unshift(last.concat(first.slice(1)));
    }
    for(const points of list)if(points.length>1)result.push({kind:source.line.kind||'boundary',closed:!!source.line.closed&&list.length===1&&near(points[0],points.at(-1),eps),points:points.map(p=>p.slice()),sourceLine:li});
  }
  return{polylines:result,wallMilliseconds,grid:response.grid,postings:response.postings,tolerance:response.tolerance,probes:response.probes,transitions:response.transitions};
}
