const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),source=html.slice(html.indexOf('function createFrameSurfaceKernel()'),html.indexOf('const FrameSurfaceKernel=')),M=new Function(source+';return createFrameSurfaceKernel().MeshBuilder;')();
for(const P of [[[0,0,0],[100,0,0],[100,100,0],[0,100,0]],[[0,0,0],[100,0,0],[0,100,0]]]){
 const edges=P.map((a,i)=>{const b=P[(i+1)%P.length];return [a,a.map((x,k)=>x+(b[k]-x)/3),a.map((x,k)=>x+2*(b[k]-x)/3),b];});edges[1][1][2]=edges[1][2][2]=40;
 const opt={angle:5,deferQuality:true},step=M.startRows(edges,opt);let mesh=step.initial,steps=0,calls=0;const evaluate=step.patch.evaluate;step.patch.evaluate=(...args)=>{calls++;return evaluate(...args);};
 assert.equal(mesh.p.length,mesh.boundaryCount);assert.equal(mesh.diagnostics.surfaceEvaluations,0);
 const boundary=JSON.stringify(mesh.p);assert.equal(step.curvatureMap.surfaceEvaluations,P.length===3?66:64);
 while(true){const count=mesh.p.length,faces=mesh.triangles.length,r=step.iterator.next();mesh=r.value;if(r.done)break;
  assert(mesh.triangles.length>faces,'each inserted point immediately emits faces');assert.equal(calls,steps+1,'no extra sampling calls');assert.equal(mesh.p.length-count,1,'one click must evaluate and insert exactly one point');
  assert.equal(mesh.diagnostics.surfaceEvaluations,++steps,'no future interior points evaluated');
  const uv=mesh.uv.at(-1),prev=mesh.uv.at(-2);if(count>mesh.boundaryCount&&Math.abs(uv[1]-prev[1])<1e-12)assert(uv[0]>prev[0],'every row proceeds forward');
 }
 assert.equal(JSON.stringify(mesh.p.slice(0,mesh.boundaryCount)),boundary);
 assert(mesh.diagnostics.normalUpdates>0);assert.equal(step.curvatureMap.surfaceEvaluations,step.curvatureMap.baseSamples+step.curvatureMap.extraSamples);const full=M.build(edges,opt).mesh;assert.deepEqual(mesh.p,full.p);assert.deepEqual(mesh.triangles,full.triangles);assert(M.checkTopology2D(mesh).valid);
}
console.log('PASS triangle/quad stepper: exactly one new evaluation and point, forward rows, fixed boundary, identical full mesh.');
