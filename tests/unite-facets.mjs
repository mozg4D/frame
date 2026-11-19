import assert from 'node:assert/strict';

function triangularShell(steps=5){
  const vertices=[],indices=[],ids=new Map();
  function id(x,y,z){
    const key=x+','+y+','+z;if(ids.has(key))return ids.get(key);
    const k=vertices.length/3,length=Math.hypot(x,y,z);
    vertices.push(Math.fround((26*x+3*y-2*z)/length),Math.fround((23*y+2*z)/length),Math.fround((20*z+2*x-y)/length));ids.set(key,k);return k;
  }
  function face(a,b,c){
    const p=i=>vertices.slice(3*i,3*i+3),A=p(a),B=p(b),C=p(c),d=B.map((v,i)=>v-A[i]),e=C.map((v,i)=>v-A[i]);
    const n=[d[1]*e[2]-d[2]*e[1],d[2]*e[0]-d[0]*e[2],d[0]*e[1]-d[1]*e[0]];
    if(n.reduce((sum,v,i)=>sum+v*A[i],0)<0)[b,c]=[c,b];
    indices.push(a,b,c);
  }
  for(const sx of [-1,1])for(const sy of [-1,1])for(const sz of [-1,1]){
    const point=(i,j)=>id(sx*i,sy*j,sz*(steps-i-j));
    for(let i=0;i<steps;i++)for(let j=0;i+j<steps;j++){
      face(point(i,j),point(i+1,j),point(i,j+1));
      if(i+j+1<steps)face(point(i+1,j),point(i+1,j+1),point(i,j+1));
    }
  }
  return {vertices,indices};
}
function countFacetInteriors(source,positions,pitch){
  const sub=(a,b)=>a.map((v,i)=>v-b[i]),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const unit=a=>{const l=Math.hypot(...a);return a.map(v=>v/l);};
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  let inner=0,withInterior=0;
  for(let f=0;f<source.indices.length;f+=3){
    const v=source.indices.slice(f,f+3).map(i=>source.vertices.slice(3*i,3*i+3));
    const n=unit(cross(sub(v[1],v[0]),sub(v[2],v[0]))),h=dot(n,v[0]);
    const side=v.map((p,i)=>unit(cross(n,sub(v[(i+1)%3],p)))),c=side.map((s,i)=>dot(s,v[i]));
    let count=0;
    const lo=[0,1,2].map(k=>Math.min(v[0][k],v[1][k],v[2][k])-pitch),hi=[0,1,2].map(k=>Math.max(v[0][k],v[1][k],v[2][k])+pitch);
    for(let i=0;i<positions.length;i+=3){
      const x=positions[i],y=positions[i+1],z=positions[i+2];
      if(x<lo[0]||x>hi[0]||y<lo[1]||y>hi[1]||z<lo[2]||z>hi[2]||Math.abs(x*n[0]+y*n[1]+z*n[2]-h)>.2*pitch)continue;
      if(side.every((s,k)=>x*s[0]+y*s[1]+z*s[2]-c[k]>5*pitch))count++;
    }
    inner+=count;if(count)withInterior++;
  }
  return {inner,withInterior,sourceFaces:source.indices.length/3};
}
function splitFaces(source){
  const vertices=source.vertices.slice(),indices=[];
  for(let f=0;f<source.indices.length;f+=3){
    const [a,b,c]=source.indices.slice(f,f+3),j=vertices.length/3;
    for(let k=0;k<3;k++)vertices.push(Math.fround((vertices[3*a+k]+vertices[3*b+k]+vertices[3*c+k])/3));
    indices.push(a,b,j,b,c,j,c,a,j);
  }
  return {vertices,indices};
}
export function facetedKernelChecks(api){
  const source=triangularShell(2);
  let top=0;
  for(let i=3;i<source.vertices.length;i+=3)if(source.vertices[i+2]>source.vertices[top+2])top=i;
  function exact(vertices,indices){
    const s=api.begin_surface(),soup=Float32Array.from(indices.flatMap(i=>vertices.slice(3*i,3*i+3)));
    const ptr=api.malloc(soup.byteLength);
    try{
      new Float32Array(api.memory.buffer,ptr,soup.length).set(soup);
      return api.faceted_perimeters(s,ptr,indices.length/3,.2);
    }finally{api.free(ptr);api.end_surface(s);}
  }
  assert.equal(exact(source.vertices,source.indices),1);
  const concave=source.vertices.slice();concave[top+2]-=14;
  assert.equal(exact(concave,source.indices),1,'An embedded inward crease retains its facets');
  const crossed=source.vertices.slice();crossed[top]+=9;crossed[top+2]-=55;
  assert.equal(exact(crossed,source.indices),0,'A closed but self-intersecting shell requires the material field');
  const nested=source.vertices.map(x=>x*.5);
  assert.equal(exact([...source.vertices,...nested],[...source.indices,...source.indices.map(i=>i+nested.length/3)]),0,
    'Distinct shells require material and cavity classification');
}
export async function facetChecks(page,call,audit){
  const base=triangularShell(),source=splitFaces(base);
  const geometry=async id=>page.evaluate(async id=>{
    const g=await frameEngine.readGeometry(id);return {vertices:Array.from(g.vertices),indices:Array.from(g.indices)};
  },id);
  await call('scene.new');
  const shape=await call('mesh.create',source);
  const u=await call('scene.create',{type:'unite',inputs:[shape.hash],params:{resolution:192,smoothing:0,optimize:0,fast:true}});
  assert.ifError(u.buildError);const exact=u.evaluation.report,raw=await geometry(u.hash);
  assert.equal(exact.backend,'Exact faceted');assert.equal(raw.indices.length,base.indices.length);
  assert.equal(raw.vertices.length,base.vertices.length);assert.equal(exact.interiorCrossingsSkipped,200);
  const ids=new Map();
  for(let i=0;i<base.vertices.length;i+=3)ids.set(base.vertices.slice(i,i+3).join(','),i/3);
  const vertexIds=[];for(let i=0;i<raw.vertices.length;i+=3)vertexIds.push(ids.get(raw.vertices.slice(i,i+3).join(',')));
  const tris=t=>Array.from({length:t.length/3},(_,i)=>t.slice(3*i,3*i+3).sort((a,b)=>a-b).join(',')).sort();
  assert.deepEqual(tris(raw.indices.map(i=>vertexIds[i])),tris(base.indices));assert.ok(audit(raw)>0);
  const p={resolution:192,smoothing:.45,optimize:75,fast:true};
  const preview=await call('scene.update',{id:u.hash,params:p});assert.ifError(preview.buildError);
  const fast=preview.evaluation.report,mesh=await geometry(u.hash),fi=countFacetInteriors(base,mesh.vertices,fast.pitch);assert.ok(audit(mesh)>0);
  assert.equal(fast.backend,'WebGPU / WASM');assert.ok(fast.perimeterPatches>128&&fast.interiorCrossingsSkipped>30000);
  assert.equal(fi.inner,0,'The preview fills the large triangular planes from their outlines');
  const final=await call('scene.update',{id:u.hash,params:{fast:false}});assert.ifError(final.buildError);
  const q=await geometry(u.hash),qi=countFacetInteriors(base,q.vertices,fast.pitch);assert.ok(audit(q)>0);
  assert.equal(qi.inner,0);assert.ok(final.evaluation.report.reusedTessellation&&q.indices.length<mesh.indices.length);
  const back=await call('scene.update',{id:u.hash,params:{smoothing:0,optimize:0}});
  assert.equal(back.evaluation.report.backend,'Exact faceted');assert.equal(back.evaluation.report.triangles,200);
  // Cross the middle of a large inclined triangular facet with a second
  // tetrahedron. Its exposed tip must survive; its buried base is internal.
  const v=base.indices.slice(0,3).map(i=>base.vertices.slice(3*i,3*i+3));
  const c=[0,1,2].map(k=>(v[0][k]+v[1][k]+v[2][k])/3);
  const d=v[1].map((x,k)=>x-v[0][k]),e=v[2].map((x,k)=>x-v[0][k]);
  const cross=[d[1]*e[2]-d[2]*e[1],d[2]*e[0]-d[0]*e[2],d[0]*e[1]-d[1]*e[0]],n=cross.map(x=>x/Math.hypot(...cross));
  const verts=v.flatMap(p=>p.map((x,k)=>c[k]+.77*(x-c[k])-1.4*n[k])).concat(c.map((x,k)=>x+3.2*n[k]));
  const op=await call('mesh.create',{vertices:verts,indices:[0,2,1,0,1,3,1,2,3,2,0,3]});
  await call('scene.update',{id:op.hash,parent:u.hash});
  const rawCut=await call('scene.update',{id:u.hash,params:{...p,smoothing:0,optimize:0}});
  assert.ifError(rawCut.buildError);
  const info=rawCut.evaluation.report,clipped=await geometry(u.hash);
  assert.equal(info.backend,'WebGPU / WASM');assert.ok(info.perimeterPatches>128&&info.interiorCrossingsSkipped>30000);
  assert.ok(audit(clipped)>0);
  const exposed={vertices:base.vertices,indices:base.indices.slice(3)};
  assert.equal(countFacetInteriors(exposed,clipped.vertices,info.pitch).inner,0,'Flat facet interiors stay empty at zero Optimize');
  const cut=await call('scene.update',{id:u.hash,params:{...p,smoothing:.25}});
  assert.ifError(cut.buildError);const both=await geometry(u.hash);assert.ok(audit(both)>0);
  assert.equal(cut.evaluation.report.backend,'WebGPU / WASM');assert.ok(cut.evaluation.report.perimeterPatches>128);
  const probe=c.map((x,k)=>x+.7*n[k]);let angle=0;
  for(let i=0;i<both.indices.length;i+=3){
    const [a,b,c]=both.indices.slice(i,i+3).map(id=>[0,1,2].map(k=>both.vertices[3*id+k]-probe[k]));
    const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],det=a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]);
    angle+=Math.atan2(det,Math.hypot(...a)*Math.hypot(...b)*Math.hypot(...c)+dot(a,b)*Math.hypot(...c)+dot(b,c)*Math.hypot(...a)+dot(c,a)*Math.hypot(...b));
  }
  assert.ok(Math.abs(angle)>Math.PI,'The volume extends above the original facet inside its clipped perimeter');
  await call('scene.new');
  const many=triangularShell(64),large=await call('mesh.create',many);
  const broad=await call('scene.create',{type:'unite',inputs:[large.hash],params:{resolution:1024,smoothing:0,optimize:0}});
  assert.ifError(broad.buildError);assert.equal(broad.evaluation.report.backend,'Exact faceted');
  assert.equal(broad.evaluation.report.triangles,many.indices.length/3);
  const largeMesh=await geometry(broad.hash);assert.equal(largeMesh.vertices.length,many.vertices.length);assert.ok(audit(largeMesh)>0);
  console.log('Oblique triangular facets',JSON.stringify({source:200,split:600,exact:raw.indices.length/3,fast:mesh.indices.length/3,final:q.indices.length/3,
    fastInterior:fi.inner,finalInterior:qi.inner,patches:fast.perimeterPatches,skipped:fast.interiorCrossingsSkipped,overlapPatches:cut.evaluation.report.perimeterPatches,overlapRawPatches:info.perimeterPatches,overlapRawSkipped:info.interiorCrossingsSkipped,largeExact:broad.evaluation.report.triangles}));
}
