const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const part=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a))),factories=part('function createFrameSurfaceKernel()','const FrameSurfaceKernel=')+part('function createFrameCageCells()','const FrameCageCells=')+part('function createSplineSurfaceBuilder(','const buildSplineSurface=')+part('function prepareSplineBVH(','const splineSurfaceWorkers=')+part('var v3 =','function approximateSpline(');
const {B,M,sample}=new Function(factories+';const K=createFrameSurfaceKernel();return {B:createSplineSurfaceBuilder(K,createFrameCageCells(),createSplinePlanarTools()),M:K.MeshBuilder,sample:sampleSplineSegment};')();
let captures=[];const build=M.build;M.build=(edges,opt)=>{const r=build(edges,{...opt,deferQuality:true});captures.push(r);return r;};
const canonical=loop=>{let best,text;for(const rev of [false,true]){const src=rev?loop.slice().reverse().map(r=>({...r,reversed:!r.reversed})):loop;for(let i=0;i<src.length;i++){const c=[...src.slice(i),...src.slice(0,i)],key=JSON.stringify(c);if(text===undefined||key<text){text=key;best=c;}}}return best;};
// Straight perimeter segments do not impose a lower bound on interior steps.
let previous=Infinity;
for(const angle of [1,2,4,5]){
 const d=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/user-angle-cage.json')));delete d.patchCells;d.autoBorder=true;d.approximation.angle=angle;for(const e of Object.values(d.segments))e.approximation.angle=angle;
 const r=B.resolve(d);assert.equal(r.fills.length,6);captures=[];
 for(const f of r.fills)B.cell(d,{...f,loops:f.loops.map(canonical)},angle,id=>sample(d,id));
 assert.equal(captures.length,2);
 for(const c of captures){
  const m=c.mesh;assert(M.checkTopology2D(m).valid);assert(c.check.deferred);assert(m.p.flat().every(Number.isFinite));assert.equal(c.frontReport.metricInsertions,0);assert(c.frontReport.snake);
  assert(m.triangles.length<12000);assert.equal(c.frontReport.curvatureMap.surfaceEvaluations,64);
  assert.deepEqual(m.p.slice(0,m.boundaryCount),c.edgeSamples.flatMap(s=>s.slice(0,-1).map(q=>q.p)));
 }
 const curved=captures.reduce((a,b)=>a.mesh.triangles.length>b.mesh.triangles.length?a:b);assert(curved.frontReport.insertions>0,'curved interior requires vertices despite straight perimeter');assert(curved.mesh.triangles.length<previous);previous=curved.mesh.triangles.length;
 console.log('curved interior / fixed perimeter',angle,'degrees:',captures.map(c=>({triangles:c.mesh.triangles.length,probes:c.frontReport.curvatureMap.surfaceEvaluations})));
}
