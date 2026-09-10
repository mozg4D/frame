const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function part(a,b){const i=html.indexOf(a),j=html.indexOf(b,i);assert(i>=0&&j>i);return html.slice(i,j);}
const factories=part('function createFrameSurfaceKernel()', 'const FrameSurfaceKernel=')+part('function createFrameCageCells()', 'const FrameCageCells=')+part('function createSplineSurfaceBuilder(', 'const buildSplineSurface=')+part('function prepareSplineBVH(', 'const splineSurfaceWorkers=');
const core=part('var v3 =','function approximateSpline(');
const {builder,render,sample}=new Function(factories+core+`;return {builder:createSplineSurfaceBuilder(createFrameSurfaceKernel(),createFrameCageCells(),createSplinePlanarTools()),render:prepareSplineRender,sample:sampleSplineSegment};`)();
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/deformed-sphere.json'),'utf8'));
const cosine=Math.cos(Math.PI/4);let compared=0,maxNormalError=0;
for(const y of [50,-45,-49.9]){
  const data=structuredClone(fixture);data.vertices.v3[1]=y;
  const cells=builder.resolve(data),cache=builder.resolve(data,cells);assert(cache.diagnostics.selectionReused);assert.equal(cache.diagnostics.searchNodes,0);
  const built=cells.fills.map((f,i)=>{const reverse=i%2===1,fill=reverse?{...f,loops:f.loops.map(loop=>loop.slice().reverse().map(e=>({...e,reversed:!e.reversed})))}:f;
    const c=builder.cell(data,fill,10,id=>sample(data,id));c.render=render(new Float32Array(c.positions),c.indices,cosine,c.positions);return {...c,reverse};});
  const reference=builder(data,{cells,builtCells:built}),referenceRender=render(reference.positions,reference.indices,cosine),cached=builder.cached(data,cells,built,cosine);
  assert.deepEqual(cached.positions,reference.positions);assert.deepEqual(cached.indices,reference.indices);
  assert(Math.abs(cached.report.meshValidation.volume-reference.report.meshValidation.volume)<1e-6);
  for(let i=0;i<referenceRender.indices.length;i++)for(let k=0;k<3;k++){
    const a=referenceRender.indices[i]*3+k,b=cached.render.indices[i]*3+k;
    assert.equal(cached.render.positions[b],referenceRender.positions[a]);
    const error=Math.abs(cached.render.normals[b]-referenceRender.normals[a]);maxNormalError=Math.max(maxNormalError,error);assert(error<2e-5,'seam shading changed: '+error);
  }
  const r=cached.render,seen=new Set(),stack=[0];
  while(stack.length){const n=stack.pop(),at=n*4;assert(!seen.has(n));seen.add(n);if(r.bvhChildren[at]>=0){stack.push(r.bvhChildren[at],r.bvhChildren[at+1]);continue;}for(let i=r.bvhChildren[at+2];i<r.bvhChildren[at+3];i++){const f=r.bvhOrder[i];for(let c=0;c<3;c++)for(let k=0;k<3;k++){const p=r.positions[r.indices[f*3+c]*3+k];assert(p>=r.bvhBounds[n*6+k]-1e-5&&p<=r.bvhBounds[n*6+k+3]+1e-5);}}}
  assert.equal(seen.size,r.bvhChildren.length/4);compared+=reference.indices.length/3;
}
console.log(`PASS: ${compared} triangles match full assembly; seam normal error ${maxNormalError}; every cached BVH leaf covers its triangles.`);
