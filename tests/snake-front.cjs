// The interactive cell must contain its final vertices before any global QA.
const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),checks={topology:0,surface:0,swaps:0};
let source=html.slice(html.indexOf('function createFrameSurfaceKernel()'),html.indexOf('const FrameSurfaceKernel='));
source=source.replace('function checkTopology2D(mesh,shared){','function checkTopology2D(mesh,shared){__checks.topology++;')
 .replace('function validateFast(mesh,samples,n,shared){','function validateFast(mesh,samples,n,shared){__checks.surface++;')
 .replace('function repairProjected(mesh, options={}) {','function repairProjected(mesh, options={}) {__checks.swaps++;');
const M=new Function('__checks',source+';return createFrameSurfaceKernel().MeshBuilder;')(checks);
const mix=(a,b,t)=>a.map((v,k)=>v+(b[k]-v)*t),distance=(a,b)=>Math.hypot(...a.map((v,k)=>v-b[k]));
let seed=1789,random=()=>((seed=Math.imul(seed,1664525)+1013904223|0)>>>0)/2**32;
let tested=0,faces=0;
for(let trial=0;trial<64;trial++){
 const n=3+trial%10,points=Array.from({length:n},(_,i)=>{const a=2*Math.PI*i/n;return [100*Math.cos(a),100*Math.sin(a),(random()-.5)*60];});
 const edges=points.map((a,i)=>{const b=points[(i+1)%n],u=mix(a,b,1/3),v=mix(a,b,2/3);u[2]+=(random()-.5)*70;v[2]+=(random()-.5)*70;return [a,u,v,b];});
 const before={...checks},r=M.build(edges,{angle:trial%3?10:5,deferQuality:true,maxVertices:12000}),mesh=r.mesh;
 assert.deepEqual(checks,before,'global QA or swaps blocked the interactive mesh');assert(r.qualityDeferred&&r.check.deferred&&r.check2D.deferred);assert(mesh.diagnostics.snake);
 const boundary=r.edgeSamples.flatMap(side=>side.slice(0,-1).map(q=>q.p));assert.deepEqual(mesh.p.slice(0,mesh.boundaryCount),boundary);
 assert.equal(r.frontReport.curvatureMap.baseSamples,n===3?66:64);assert.equal(r.frontReport.curvatureMap.surfaceEvaluations,(n===3?66:64)+r.frontReport.curvatureMap.extraSamples);assert.equal(r.frontReport.surfaceEvaluations,mesh.p.length-mesh.boundaryCount);
 const positions=JSON.stringify(mesh.p),uv=JSON.stringify(mesh.uv),indices=JSON.stringify(mesh.triangles),count=mesh.triangles.length;
 M.refine(mesh);assert(mesh.qualityValidation.topology.valid);assert.equal(mesh.qualityValidation.surface.missing,0);assert.equal(mesh.qualityValidation.surface.extra,0);
 assert.equal(JSON.stringify(mesh.p),positions);assert.equal(JSON.stringify(mesh.uv),uv);assert.equal(mesh.triangles.length,count);assert.equal(JSON.stringify(mesh.triangles),indices);assert.equal(mesh.diagonalReport.iterations,0);assert.equal(checks.swaps,0);assert(mesh.diagnostics.normalUpdates>=0);
 tested++;faces+=count;
}
for(const angle of [10,1]){
 const edges=[[[-1,0,0],[-1,1,0],[1,1,0],[1,0,0]],[[1,0,0],[1,-1,.3],[-1,-1,.3],[-1,0,0]]],r=M.build(edges,{angle,deferQuality:true}),m=r.mesh;
 assert(m.diagnostics.snake);assert(r.check.deferred);
 const points=JSON.stringify(m.p);M.refine(m);assert(m.qualityValidation.topology.valid);assert.equal(JSON.stringify(m.p),points);tested++;faces+=m.triangles.length;
}
console.log(`PASS: ${tested} irregular 2–12-sided cells / ${faces} triangles; no QA before initial output, fixed boundaries/probes, valid topology and zero deferred swaps.`);
