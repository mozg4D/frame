import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {facetedKernelChecks,facetChecks} from './unite-facets.mjs';
import {surfaceDeviation} from './unite-deviation.mjs';

// A gridded plate with two through-holes and an open notch. All coordinates of
// the oblique affine transform are exact dyadic floats at the fixture vertices.
function plate(){
  const nx=36,ny=24,h=5,step=2,vertices=[],indices=[],ids=new Map(),local=new Map();
  const boxes=[[4,6,10,15],[17,8,23,18],[31,14,36,20]];
  const solid=(x,y)=>x>=0&&x<nx&&y>=0&&y<ny&&!boxes.some(([a,b,c,d])=>x>=a&&x<c&&y>=b&&y<d);
  function id(x,y,k){
    const key=x+64*(y+32*k);if(ids.has(key))return ids.get(key);
    const i=vertices.length/3;ids.set(key,i);
    const X=step*x,Y=step*y,Z=k*h,p=[X+.25*Y+.125*Z,Y+.125*Z,Z+.125*X-.25*Y];
    vertices.push(...p);local.set(p.join(','),[x,y,k]);return i;
  }
  const quad=(a,b,c,d)=>indices.push(a,b,c,a,c,d);
  for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
    if(!solid(x,y))continue;
    const xy=[[x,y],[x+1,y],[x+1,y+1],[x,y+1]],lo=xy.map(p=>id(...p,0)),hi=xy.map(p=>id(...p,1));
    quad(hi[0],hi[1],hi[2],hi[3]);quad(lo[3],lo[2],lo[1],lo[0]);
    const neighbor=[[x,y-1],[x+1,y],[x,y+1],[x-1,y]];
    for(let k=0;k<4;k++)if(!solid(...neighbor[k])){const j=(k+1)%4;quad(lo[k],lo[j],hi[j],hi[k]);}
  }
  function inner(mesh){
    let count=0;
    for(let i=0;i<mesh.vertices.length;i+=3){
      const [x,y]=local.get(Array.from(mesh.vertices.slice(i,i+3)).join(','));
      if(solid(x,y)&&solid(x-1,y)&&solid(x-1,y-1)&&solid(x,y-1))count++;
    }
    return count;
  }
  return {vertices,indices,inner};
}
function roundedTube(){
  const vertices=[],indices=[],sides=32,stations=35;
  for(let s=0;s<stations;s++)for(let i=0;i<sides;i++){
    const z=s*.75,neck=1-.28*Math.exp(-((z-13)**2)/2.5);
    const angle=(2*Math.PI*i/sides)+.014*Math.sin(s*1.37);
    vertices.push(4.5*neck*Math.cos(angle),3.3*neck*Math.sin(angle),z);
  }
  for(let s=1;s<stations;s++)for(let i=0;i<sides;i++){
    const a=(s-1)*sides+i,b=(s-1)*sides+(i+1)%sides;
    indices.push(a,b,b+sides,a,b+sides,a+sides);
  }
  for(let i=1;i<sides-1;i++){
    const cap=(stations-1)*sides;indices.push(0,i+1,i,cap,cap+i,cap+i+1);
  }
  return {vertices,indices};
}
function drum(sides){
  const vertices=[],indices=[],cap=2*sides;
  for(const z of [0,5])for(let i=0;i<sides;i++){
    const a=2*Math.PI*i/sides;vertices.push(12*Math.cos(a),12*Math.sin(a),z);
  }
  vertices.push(0,0,0,0,0,5);
  for(let i=0;i<sides;i++){
    const j=(i+1)%sides;
    indices.push(i,j,j+sides,i,j+sides,i+sides,cap,j,i,cap+1,i+sides,j+sides);
  }
  return {vertices:new Float32Array(vertices),indices};
}
function audit(mesh){
  const t=mesh.indices,p=mesh.vertices,n=p.length/3,edges=new Map(),next=new Map();
  let volume=0;
  for(let i=0;i<t.length;i+=3){
    for(let j=0;j<3;j++){
      const a=t[i+j],b=t[i+(j+1)%3],c=t[i+(j+2)%3],k=a*n+b;
      assert.ok(!edges.has(k),'Duplicated directed edge');edges.set(k,true);next.set(k,c);
    }
    const [a,b,c]=Array.from(t.slice(i,i+3),v=>3*v);
    const dx=p[b]-p[a],dy=p[b+1]-p[a+1],dz=p[b+2]-p[a+2],ex=p[c]-p[a],ey=p[c+1]-p[a+1],ez=p[c+2]-p[a+2];
    const nx=dy*ez-dz*ey,ny=dz*ex-dx*ez,nz=dx*ey-dy*ex;assert.ok(nx*nx+ny*ny+nz*nz>0);
    volume+=(p[a]*nx+p[a+1]*ny+p[a+2]*nz)/6;
  }
  const fans=new Set(),visited=new Set();
  for(const k of edges.keys()){
    const a=Math.floor(k/n),b=k%n;assert.ok(edges.has(b*n+a),'Open edge');
    if(visited.has(k))continue;
    assert.ok(!fans.has(a),'Disconnected vertex fan');fans.add(a);
    let e=k;do{visited.add(e);e=a*n+next.get(e);}while(!visited.has(e));assert.equal(e,k);
  }
  return volume;
}
async function nativeFit(){
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const bytes=Buffer.from(html.match(/<script id="frame-unite-wasm"[^>]*>([^<]+)/)[1],'base64');
  const {instance}=await WebAssembly.instantiate(bytes,{env:{emscripten_notify_memory_growth(){}},wasi_snapshot_preview1:{fd_write:()=>8,fd_seek:()=>8,fd_close:()=>8}});
  const api=instance.exports;api._initialize();facetedKernelChecks(api);
  return (input,pitch,optimize)=>{
    const s=api.begin_surface(),ptr=api.malloc(24);
    try{
      api.resize_surface(s,input.vertices.length/3,input.indices.length);
      new Float32Array(api.memory.buffer,api.surface_vertices(s),input.vertices.length).set(input.vertices);
      new Uint32Array(api.memory.buffer,api.surface_indices(s),input.indices.length).set(input.indices);
      new Uint32Array(api.memory.buffer,ptr,2).fill(0);
      api.refine_contour(s,0,0,0,0,pitch,optimize,ptr);api.surface_counts(s,ptr+8);
      const [planar,strips,nv,ni]=new Uint32Array(api.memory.buffer,ptr,6);
      return {vertices:new Float32Array(api.memory.buffer,api.surface_vertices(s),3*nv).slice(),
        indices:new Uint32Array(api.memory.buffer,api.surface_indices(s),ni).slice(),planar,strips};
    }finally{api.free(ptr);api.end_surface(s);}
  };
}
export async function regionKernelChecks(){
  const fit=await nativeFit(),p=plate(),oldVolume=audit(p),plateRows=[];
  for(const optimize of [0,75]){
    const q=fit(p,.75,optimize),volume=audit(q),inner=p.inner(q);
    plateRows.push({optimize,faces:q.indices.length/3,inner,removed:q.planar,strips:q.strips});
    assert.ok(Math.abs(volume-oldVolume)<1e-7*Math.abs(oldVolume),'Preserve the plate and both through-holes');
    assert.equal(q.indices.length/3,68);
    assert.equal(inner,0,'Every interior sample on both exactly flat faces can be removed');
  }
  const caps=drum(256),coarse=fit(caps,1,0);
  assert.ok(coarse.planar>=2&&Math.abs(audit(caps)-audit(coarse))<1e-7);
  for(let i=0;i<coarse.vertices.length;i+=3)assert.ok(Math.hypot(coarse.vertices[i],coarse.vertices[i+1])>11.99,'Remove high-valence cap hubs');
  const tube=roundedTube(),q=fit(tube,.8,75);
  const deviation=[surfaceDeviation({from:tube,to:q,pitch:.8}),surfaceDeviation({from:q,to:tube,pitch:.8})];
  assert.ok(audit(q)>0&&q.strips>0&&q.indices.length<tube.indices.length*.70);
  assert.ok(deviation.every(m=>m.distanceMm.max<.115&&m.normalDegrees.p95<14),'Retain the changing transverse profile at the neck');
  console.log('Constrained flats and longitudinal profiles',JSON.stringify({plate:plateRows,drumFaces:coarse.indices.length/3,tube:{raw:tube.indices.length/3,faces:q.indices.length/3,
    removed:q.strips,distance:deviation.map(m=>m.distanceMm.max),normal:deviation.map(m=>m.normalDegrees.p95)}}));
}
function measurePlate(mesh){
  const p=mesh.vertices,t=mesh.indices,xy=[],holes=[[8,12,20,30],[34,16,46,36],[62,28,72,40]];
  const clearance=(x,y)=>Math.min(x,y,72-x,48-y,...holes.map(([a,b,c,d])=>
    Math.hypot(Math.max(0,a-x,x-c),Math.max(0,b-y,y-d))));
  let inner=0,inner3mm=0;
  for(let i=0;i<p.length;i+=3){
    const X=p[i],Y=p[i+1],Z=p[i+2],z=(Z-.125*X+.28125*Y)/1.01953125,y=Y-.125*z,x=X-.25*y-.125*z;
    xy.push([x,y,z]);
    if(Math.min(Math.abs(z),Math.abs(z-5))<.1){const d=clearance(x,y);if(d>3)inner3mm++;if(d>6)inner++;}
  }
  function hits(x,y){
    const z=[];
    for(let i=0;i<t.length;i+=3){
      const a=xy[t[i]],b=xy[t[i+1]],c=xy[t[i+2]];
      const bx=b[0]-a[0],by=b[1]-a[1],cx=c[0]-a[0],cy=c[1]-a[1],d=bx*cy-by*cx;
      if(Math.abs(d)<1e-10)continue;
      const u=((x-a[0])*cy-(y-a[1])*cx)/d,v=(bx*(y-a[1])-by*(x-a[0]))/d;
      if(u>=0&&v>=0&&u+v<=1)z.push(a[2]+u*(b[2]-a[2])+v*(c[2]-a[2]));
    }
    return z.sort((a,b)=>a-b);
  }
  let samples=0,maxFlatErrorMm=0;
  const toNormalMm=1.01953125/Math.hypot(1,.125,.28125);
  for(let x=1.17;x<72;x+=1.5)for(let y=1.31;y<48;y+=1.5){
    if(clearance(x,y)<=6)continue;
    const z=hits(x,y);assert.equal(z.length,2,'One crossing on each broad face');
    maxFlatErrorMm=Math.max(maxFlatErrorMm,toNormalMm*Math.max(Math.abs(z[0]),Math.abs(z[1]-5)));samples+=2;
  }
  for(const [x,y] of [[14,21],[40,26],[67,34]])assert.equal(hits(x,y).length,0,'Both holes and the notch stay open');
  assert.ok(audit(mesh)>0);
  return {inner,inner3mm,faces:t.length/3,samples,maxFlatErrorMm};
}
// Build through normal Frame entry points as well: the sampled slanted plate
// exposes grid-phase noise which the purely planar kernel proof cannot exercise.
export async function regionBrowserChecks(page,call){
  await call('scene.new');
  const {vertices,indices}=plate(),source=await call('mesh.create',{vertices,indices});
  const params={resolution:112,smoothing:1.2,optimize:75,fast:true};
  const owner=await call('scene.create',{type:'unite',inputs:[source.hash],params});
  assert.ifError(owner.buildError);
  const inspect=async()=>measurePlate(await page.evaluate(async id=>{
    const {vertices,indices}=await frameEngine.readGeometry(id);
    return {vertices:Array.from(vertices),indices:Array.from(indices)};
  },owner.hash));
  const fast=await inspect(),final=await call('scene.update',{id:owner.hash,params:{fast:false}});
  assert.ifError(final.buildError);const quality=await inspect(),report=final.evaluation.report;
  console.log('Sampled slanted plate',JSON.stringify({fast,quality,planar:report.planarVerticesRemoved,strips:report.stripVerticesRemoved}));
  assert.ok(report.reusedField&&report.reusedTessellation&&report.planarVerticesRemoved>0&&report.stripVerticesRemoved>0);
  assert.equal(quality.inner,0,'Keep every remaining vertex near a contour or a rounded transition');
  const preview=owner.evaluation.report;
  assert.equal(preview.globalCollapses,0);assert.ok(preview.perimeterPatches>=2&&preview.perimeterHoles>=4);
  assert.ok(preview.interiorCrossingsSkipped>5000&&preview.perimeterRimSkipped>0);
  assert.equal(fast.inner3mm,0);assert.equal(quality.inner3mm,0);
  assert.ok(quality.faces<fast.faces&&quality.samples>500&&quality.maxFlatErrorMm<.05&&fast.maxFlatErrorMm<.002);
  console.log('Field perimeters',JSON.stringify({patches:preview.perimeterPatches,holes:preview.perimeterHoles,cells:preview.perimeterCells,
    crossings:preview.interiorCrossingsSkipped,rim:preview.perimeterRimSkipped}));

  await facetChecks(page,call,audit);
}
