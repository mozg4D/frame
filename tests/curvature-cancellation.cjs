const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),source=html.slice(html.indexOf('function createFrameSurfaceKernel()'),html.indexOf('const FrameSurfaceKernel=')).replace('return {topology2D,refine,buildTopology:','return {surfaceMetricGrid,topology2D,refine,buildTopology:'),M=new Function(source+';return createFrameSurfaceKernel().MeshBuilder')(),data=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/depressed-sphere.json')));
const cell=data.cells[0],edges=cell.segments.map((id,i)=>{const e=data.segments[id],a=data.vertices[e.a],b=data.vertices[e.b],q=[a,a.map((v,k)=>v+e.ha[k]),b.map((v,k)=>v+e.hb[k]),b];return e.a===cell.vertices[i]?q:q.reverse();});
const step=M.startRows(edges,{angle:1}),patch=step.patch,map=M.surfaceMetricGrid(patch,step.edgeSamples,3,1),u=.2577024057307389,v=.3724988171625194;
const sub=(a,b)=>a.map((v,k)=>v-b[k]),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function normal(x,y){const h=1e-6,U=sub(patch.evaluate(x+h,y),patch.evaluate(x-h,y)),V=sub(patch.evaluate(x,y+h),patch.evaluate(x,y-h)),N=cross(U,V),L=Math.hypot(...N);return N.map(v=>v/L);}
const m=map(u,v,new Float64Array(3)),estimate=Math.sqrt(m[2]-.25)*Math.PI/180;
for(const h of [1e-3,1e-4]){const actual=Math.hypot(...sub(normal(u,v+h),normal(u,v-h)))/(2*h);assert(Math.abs(estimate/actual-1)<.02,'cancellation must not produce fictitious curvature');}
assert.equal(map.diagnostics.extraSamples,9);const calls=map.diagnostics.surfaceEvaluations;map(u,v,new Float64Array(3));assert.equal(map.diagnostics.surfaceEvaluations,calls);
console.log('PASS depressed-sphere curvature cancellation: |Nv| =',estimate,'(reference ~0.03728), one cached local verification.');
