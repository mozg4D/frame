// Run with: node tests/geometry.cjs
const fs=require('node:fs'),assert=require('node:assert/strict');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const start=html.indexOf('const SurfacePatch='),end=html.indexOf("if(typeof module!=='undefined')module.exports=MeshBuilder;",start);
const source=html.slice(start,end).replace('return {topology2D,refine,buildTopology:', 'return {improveSurfaceDiagonals,diagonalAgreement,topology2D,refine,buildTopology:');
const kernel=new Function(source+';return MeshBuilder;')();
// An asymmetric warped quad: the original diagonal creates a visible crease.
const uv=[[0,0],[1,0],[1,1],[0,1]];
let seed=7,random=()=>((seed=Math.imul(seed,1664525)+1013904223|0)>>>0)/2**32;
let improved=0;
for(let trial=0;trial<500;trial++) {
 const p=uv.map(([x,y])=>[x,y,(random()-.5)*2]),mesh={uv,p,triangles:[[0,1,2],[0,2,3]]};
 const points=JSON.stringify(p),old=kernel.diagonalAgreement(...p);
 const count=kernel.improveSurfaceDiagonals(mesh,{pairs:[0,1]});
 if(count) {
  improved++;
  const next=kernel.diagonalAgreement(p[1],p[2],p[3],p[0]);
  assert(next>old+1e-9,'diagonal must reduce crease');
  assert.equal(JSON.stringify(p),points,'boundary points must remain fixed');
  assert(kernel.checkTopology2D({...mesh,boundaryCount:4,domainArea:1}).valid,'flip must preserve topology');
 }
}
assert(improved>0,'regression did not exercise diagonal correction');
const flat={uv,p:uv.map(([x,y])=>[x,y,0]),triangles:[[0,1,2],[0,2,3]]};
assert.equal(kernel.improveSurfaceDiagonals(flat,{pairs:[0,1]}),0,'flat quads should be unchanged');
// Exercise the complete production patch builder, including validation.
const points=[[0,0,0],[100,0,12],[100,100,-8],[0,100,5]];
const edges=points.map((a,i)=>{const b=points[(i+1)%4];return [a,a.map((x,k)=>x+(b[k]-x)/3+(k===2?10:0)),a.map((x,k)=>x+2*(b[k]-x)/3+(k===2?10:0)),b]});
for(const angle of [5,10,20,40]) {
 const result=kernel.build(edges,{angle});
 assert(result.check2D.valid);
 for(const key of ['holes','nonmanifold','missing','extra','degenerate','flips']) assert.equal(result.check[key]||0,0,key);
 assert(result.mesh.p.every(p=>p.every(Number.isFinite)));
}
console.log(`PASS: ${improved} crease corrections; flat stability; patch topology at four resolutions.`);
