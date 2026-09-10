const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),start=html.indexOf('const SurfacePatch='),end=html.indexOf("if(typeof module!=='undefined')module.exports=MeshBuilder;",start);
const kernel=new Function(html.slice(start,end).replace('return {topology2D,refine,buildTopology:','return {repairProjected,topology2D,refine,buildTopology:')+';return MeshBuilder;')();
let flips=0,multi=0;
for(let trial=0;trial<20;trial++){
 const uv=[],p=[],triangles=[],n=12;
 for(let y=0;y<=n;y++)for(let x=0;x<=n;x++){uv.push([x/n,y/n]);p.push([x/n,y/n,.3*Math.sin(x*.7+trial)*Math.cos(y*.6)+.05*Math.sin(x*y)]);}
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){let a=y*(n+1)+x,b=a+1,c=b+n+1,d=a+n+1;triangles.push([a,b,c],[a,c,d]);}
 const mesh={p,uv,triangles},original=JSON.stringify([p,uv]);
 flips+=kernel.repairProjected(mesh,{maxIterations:100,maxTests:100000,maxSwaps:100000});
 assert(mesh.diagonalReport.converged);if(mesh.diagonalReport.iterations>2)multi++;
 assert.equal(JSON.stringify([p,uv]),original);
 assert.equal(kernel.repairProjected(mesh),0,'converged mesh must be stable on a fresh full scan');
 const limited={p,uv,triangles:[]};for(let y=0;y<n;y++)for(let x=0;x<n;x++){let a=y*(n+1)+x,b=a+1,c=b+n+1,d=a+n+1;limited.triangles.push([a,b,c],[a,c,d]);}
 kernel.repairProjected(limited,{maxTests:7});assert(limited.diagonalReport.tests<=7);assert(limited.diagonalReport.limited);
}
assert(flips>0&&multi>0);console.log('PASS: '+flips+' adaptive flips; '+multi+' multi-wave cases; fixed points and bounded work.');
