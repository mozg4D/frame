const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),source=html.slice(html.indexOf('function createFrameSurfaceKernel()'),html.indexOf('const FrameSurfaceKernel=')),M=new Function(source+';return createFrameSurfaceKernel().MeshBuilder;')();
const P=[[0,0,0],[100,0,0],[100,100,0],[0,100,0]],edges=P.map((a,i)=>{const b=P[(i+1)%4];return [a,a.map((x,k)=>x+(b[k]-x)/3),a.map((x,k)=>x+2*(b[k]-x)/3),b];});edges[1][1][2]=edges[1][2][2]=40;
for(const angle of [1,5,10]){const r=M.build(edges,{angle,deferQuality:true}),m=r.mesh;assert(m.diagnostics.edgeRows);assert.equal(m.diagnostics.queries,0);assert(m.diagnostics.rows>1);assert.equal(m.diagnostics.rowReversals,0);assert.equal(m.diagnostics.surfaceEvaluations,m.p.length-m.boundaryCount);
 for(let i=0;i<m.boundaryCount;i++){const point=M.evaluate(m.surfacePatch,m.uv[i]);assert(Math.hypot(...point.map((x,k)=>x-m.p[i][k]))<1e-8,'quad boundary UV must use the same parameter as surface evaluation');}
 const indices=JSON.stringify(m.triangles);M.refine(m);assert(m.qualityValidation.topology.valid);assert.equal(JSON.stringify(m.triangles),indices);
}
console.log('PASS: forward edge rows, no spatial queries, unchanged boundary points match surface UV, no deferred swaps.');
