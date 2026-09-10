const fs=require('fs'),assert=require('node:assert/strict'),path=require('path'),html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),section=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
const code=section('function createFrameSurfaceKernel()','const FrameSurfaceKernel=')+section('function createFrameCageCells()','const FrameCageCells=')+section('function createSplineSurfaceBuilder(','const buildSplineSurface=')+section('function prepareSplineBVH(','const splineSurfaceWorkers=');
const {B,M}=new Function(code+';const K=createFrameSurfaceKernel();return {B:createSplineSurfaceBuilder(K,createFrameCageCells(),createSplinePlanarTools()),M:K.MeshBuilder};')();
let captures=[];const build=M.build;M.build=(...args)=>{const r=build(...args);captures.push(r);return r;};
const mix=(a,b,t)=>a.map((v,k)=>v+(b[k]-v)*t);
// Only one curved boundary: sample counts alone previously selected a fan.
const pts=[[0,0,0],[100,0,0],[100,100,0],[0,100,0]],edges=pts.map((a,i)=>{const b=pts[(i+1)%4];return [a,mix(a,b,1/3),mix(a,b,2/3),b]});edges[1][1][2]=edges[1][2][2]=40;
for(const angle of [10,1]){const r=M.build(edges,{angle});assert(r.check2D.valid&&!r.limited);assert(r.positionCount>0);assert(!r.frontReport.fan&&!r.frontReport.strip);console.log('one curved side',angle,r.mesh.triangles.length,r.positionCount);}
// Cube cage with an inserted, displaced vertex; hard then soft. No primitive metadata.
const d={vertices:{},segments:{},sequences:[],autoBorder:false,approximation:{angle:10}};
for(let i=0;i<8;i++)d.vertices['v'+i]=[i&1?100:0,i&2?100:0,i&4?100:0];
let id=0;for(let i=0;i<8;i++)for(const bit of [1,2,4])if(!(i&bit)){const sid='e'+id++;d.segments[sid]={id:sid,a:'v'+i,b:'v'+(i|bit),ha:[0,0,0],hb:[0,0,0]};}
const edge=d.segments.e0;d.vertices.mid=[50,-20,15];edge.b='mid';d.segments.extra={id:'extra',a:'mid',b:'v1',ha:[0,0,0],hb:[0,0,0]};
for(const soft of [false,true]){
 if(soft){edge.hb=[-20,0,0];d.segments.extra.ha=[20,0,0];}
 const r=B.resolve(d);assert.equal(r.fills.length,6);assert.equal(r.status,'closed-candidate');
 let previousTriangles=0;
 for(const angle of [10,2,1]){
  captures=[];const built=r.fills.map(f=>B.cell(r.reconstructedData||d,f,angle));
  const assembled=B(d,{cells:r,builtCells:built});
  assert(assembled.indices.length/3>=previousTriangles,'lower angle unexpectedly coarsens this fixture');previousTriangles=assembled.indices.length/3;
  for(const key of ['boundaryEdges','nonManifoldEdges','windingErrors','degenerate'])assert.equal(assembled.report.meshValidation[key],0,key);
  let longSlivers=0;for(const c of built){assert(c.indices.length);assert(c.positions.every(Number.isFinite));for(let i=0;i<c.indices.length;i+=3){const f=[...c.indices.subarray(i,i+3)],ls=f.map((a,j)=>{const b=f[(j+1)%3];return Math.hypot(...[0,1,2].map(k=>c.positions[a*3+k]-c.positions[b*3+k]));});if(Math.max(...ls)>60&&Math.max(...ls)>8*Math.min(...ls))longSlivers++;}}
  // Long triangles are useful in nearly flat directions and unavoidable at
  // some unsplit boundaries. Check geometric deviation, not aspect ratio alone.
  if(soft&&angle===1){let maxError=0;for(const c of captures){const m=c.mesh;for(const f of m.triangles){const p=f.map(i=>m.p[i]),ls=p.map((a,i)=>Math.hypot(...a.map((v,k)=>v-p[(i+1)%3][k])));if(Math.max(...ls)<=60||Math.max(...ls)<=8*Math.min(...ls))continue;
    for(let i=0;i<3;i++)for(const t of [.25,.5,.75]){const a=f[i],b=f[(i+1)%3],q=M.evaluate(m.surfacePatch,m.uv[a].map((v,k)=>v+(m.uv[b][k]-v)*t));maxError=Math.max(maxError,Math.hypot(...q.map((v,k)=>v-(m.p[a][k]+(m.p[b][k]-m.p[a][k])*t)))/ls[i]);}
   }}assert(maxError<=Math.sin(angle*Math.PI/180)*.5,'long triangle misses surface: '+maxError);console.log('long-edge normalized deviation',maxError);}
  assert(assembled.indices.length/3<15000,'unbounded density');
  console.log('split moved cube',soft?'soft':'hard',angle,'degrees:',assembled.indices.length/3,'triangles;',longSlivers,'long slivers');
 }
}
for(const n of [5,6,7,12]){const d={vertices:{},segments:{},sequences:[],autoBorder:false};for(let i=0;i<n;i++){const t=2*Math.PI*i/n;d.vertices['v'+i]=[100*Math.cos(t),100*Math.sin(t),10*Math.sin(2*t)];}for(let i=0;i<n;i++)d.segments['e'+i]={id:'e'+i,a:'v'+i,b:'v'+((i+1)%n),ha:[0,0,2],hb:[0,0,2]};const r=B.resolve(d);assert.equal(r.fills.length,1,'polygon '+n);assert(B.cell(d,r.fills[0],10).indices.length);console.log('nonplanar polygon',n);}
