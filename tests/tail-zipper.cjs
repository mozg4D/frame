const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),data=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/depressed-sphere.json')));
let source=html.slice(html.indexOf('function createFrameSurfaceKernel()'),html.indexOf('const FrameSurfaceKernel='));
source=source.replace('function repairProjected(mesh, options={}) {',"function repairProjected(mesh, options={}) {throw Error('Post-build swaps are disabled');");
const M=new Function(source+';return createFrameSurfaceKernel().MeshBuilder;')();
let total=0,quads=0;
for(const cell of data.cells){const edges=cell.segments.map((id,i)=>{const e=data.segments[id],a=data.vertices[e.a],b=data.vertices[e.b],q=[a,a.map((v,k)=>v+e.ha[k]),b.map((v,k)=>v+e.hb[k]),b];return e.a===cell.vertices[i]?q:q.reverse();});
 const result=M.build(edges,{angle:1,deferQuality:true}),m=result.mesh,indices=JSON.stringify(m.triangles),positions=JSON.stringify(m.p),boundary=result.edgeSamples.flatMap(s=>s.slice(0,-1).map(q=>q.p));
 assert(m.diagnostics.edgeRows);assert.equal(m.diagnostics.startEdge,0);assert.equal(m.diagnostics.rowReversals,0);assert.equal(m.diagnostics.queries,0);assert(m.diagnostics.normalUpdates>0);assert.equal(result.frontReport.curvatureMap.surfaceEvaluations,66+result.frontReport.curvatureMap.extraSamples);assert.equal(m.diagnostics.diagonalChoices,m.diagnostics.quads);assert.deepEqual(m.p.slice(0,m.boundaryCount),boundary);
 assert.equal(M.refine(m),0);assert.equal(JSON.stringify(m.triangles),indices);assert.equal(JSON.stringify(m.p),positions);assert(m.qualityValidation.topology.valid);assert(m.diagonalReport.disabled);assert.equal(m.diagonalReport.tests,0);
 total+=m.triangles.length;quads+=m.diagnostics.quads;
}
assert(quads>0,'fixture must exercise immediate quad triangulation');
console.log('PASS depressed sphere:',total,'triangles,',quads,'quads chosen at emission; fixed perimeter and no later index changes.');
