const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');const section=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
const code=section('function createFrameSurfaceKernel()','const FrameSurfaceKernel=')+section('function createFrameCageCells()','const FrameCageCells=')+section('function createSplineSurfaceBuilder(','const buildSplineSurface=')+section('function prepareSplineBVH(','const splineSurfaceWorkers=')+section('var v3 =','function approximateSpline(');
const {b,sample,render}=new Function(code+';return {b:createSplineSurfaceBuilder(createFrameSurfaceKernel(),createFrameCageCells(),createSplinePlanarTools()),sample:sampleSplineSegment,render:prepareSplineRender}')();
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/deformed-sphere.json'),'utf8')),cache=new Map(),workerCache=new Map(),display=new Map();let serial=0,maxError=0;
for(const y of [50,60,70,70,-49.9,50]){
 const data=structuredClone(fixture);data.vertices.v3[1]=y;const cells=b.resolve(data),parts=cells.fills.map(fill=>{const refs=fill.loops.flat().map(r=>r.edge),key=JSON.stringify([fill,refs.map(id=>{const e=data.segments[id];return [e,data.vertices[e.a],data.vertices[e.b]];})]);let c=cache.get(key);if(!c){c=b.cell(data,fill,10,id=>sample(data,id));c.render=render(new Float32Array(c.positions),c.indices,Math.cos(Math.PI/4),c.positions);c.ticket=++serial;cache.set(key,c);}return c;});
 const reference=b.cached(data,cells,parts,Math.cos(Math.PI/4)),result=b.chunks(data,cells,parts,Math.cos(Math.PI/4),workerCache);
 for(const update of result.chunks){if(update.positions)display.set(update.id,update);else{const c=display.get(update.id);for(let i=0;i<update.normalIds.length;i++)c.normals.set(update.normalValues.subarray(i*3,i*3+3),update.normalIds[i]*3);}}
 let at=0,wire=0;for(const id of result.liveIds){const c=display.get(id);wire+=c.wire.length;for(const ix of c.indices){const dst=reference.render.indices[at++];for(let k=0;k<3;k++){assert.equal(c.positions[ix*3+k],reference.render.positions[dst*3+k]);const error=Math.abs(c.normals[ix*3+k]-reference.render.normals[dst*3+k]);maxError=Math.max(maxError,error);assert(error<2e-5,'seam normal mismatch '+error);}}}
 assert.equal(at,reference.render.indices.length);assert.equal(wire,reference.render.wire.length,'duplicate boundary wire');assert.equal(result.report.meshValidation.boundaryEdges,0);
 console.log('y='+y+': uploaded '+result.report.uploadedCells+', seam-only '+result.report.seamNormalCells);
}
console.log('PASS: incremental cell positions, indices, seam normals and wire match full assembly; max normal error '+maxError);
