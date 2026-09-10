// Run with: node tests/deformation.cjs
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function section(a,b){return html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)))}
const core=section('var v3 =','function approximateSpline(')
 +section('function incident(','function tangentAxis(')
 +section('function transformSplineSelection(','function graphAdjacency(');
const spline=new Function(core+';return {sampleSplineSegment,segmentPoints,transformSplineSelection};')();
const kernel=new Function(section('const SurfacePatch=',"if(typeof module!=='undefined')module.exports=MeshBuilder;")+';return MeshBuilder;')();
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/deformed-sphere.json'),'utf8'));
let folds=0,patches=0;
for(const y of [-40,-45,-49,-49.9,-55]) {
 const data=structuredClone(fixture);data.vertices.v3[1]=y;
 for(const cell of data.patchCells) {
  const edges=[],samples=[];
  for(let i=0;i<cell.edges.length;i++) {
   const id=cell.edges[i],reverse=data.segments[id].a!==cell.vertices[i];
   const cp=spline.segmentPoints(data,id),points=spline.sampleSplineSegment(data,id).map(q=>({t:q.t,p:q.position}));
   edges.push(reverse?cp.slice().reverse():cp);
   samples.push(reverse?points.slice().reverse().map(q=>({t:1-q.t,p:q.p})):points);
  }
  const result=kernel.build(edges,{angle:10,length:'span',edgeSamples:samples});
  assert.equal(result.limited,false,`valid folded surface disappeared at y=${y}`);
  assert(result.check2D.valid);
  for(const key of ['holes','nonmanifold','degenerate','missing','extra'])assert.equal(result.check[key],0,key);
  assert(result.mesh.p.every(p=>p.every(Number.isFinite)));
  folds+=result.check.flips;patches++;
 }
}
assert(folds>0,'test must exercise real folds, not just mild deformation');
// A point translation must carry all four tangent arms without any rotation
// or cancellation error, even when the object is far from the world origin.
const data=structuredClone(fixture),before=structuredClone(data.segments);
const move=[1,0,0,0,0,1,0,0,0,0,1,0,1e12,3,-5,1];
spline.transformSplineSelection(data,{vertices:['v2']},move);
for(const id in before)for(const k of ['ha','hb'])assert.deepEqual(data.segments[id][k],before[id][k]);
console.log(`PASS: ${patches} deformed patches, ${folds} allowed folds, tangent vectors unchanged by translation.`);
