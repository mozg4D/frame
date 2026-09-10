// Physical-density and generic polygon regression; no primitive code is used by the kernel.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const source=html.slice(html.indexOf('function createFrameSurfaceKernel()'),html.indexOf('const FrameSurfaceKernel='));
const M=new Function(source+';return createFrameSurfaceKernel().MeshBuilder;')();
const k=4*(Math.SQRT2-1)/3,egg=[[[1,0,0],[1,k,0],[k,2,0],[0,2,0]],[[0,2,0],[0,2,k],[0,k,1],[0,0,1]],[[0,0,1],[k,0,1],[1,0,k],[1,0,0]]];
const result=M.build(egg,{angle:1,length:'span'}),mesh=result.mesh;
assert(result.check2D.valid);assert(!result.limited);
const ratios=[];
for(const range of [[.4,.7],[.8,1.1],[1.2,1.5]]){
 const bins=[{n:0,area:0},{n:0,area:0}];
 for(const f of mesh.triangles){const p=f.map(i=>mesh.p[i]),center=[0,1,2].map(k=>p.reduce((s,v)=>s+v[k],0)/3);if(center[1]<range[0]||center[1]>range[1])continue;
  const az=Math.atan2(center[2],center[0]),d=Math.min(az,Math.PI/2-az);if(d>.15&&d<.5)continue;
  const b=bins[d<=.15?0:1],u=p[1].map((v,k)=>v-p[0][k]),v=p[2].map((v,k)=>v-p[0][k]);b.n++;b.area+=Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;
 }
 const ratio=(bins[0].n/bins[0].area)/(bins[1].n/bins[1].area);ratios.push(ratio);assert(ratio>.7&&ratio<1.65,'meridian density imbalance: '+ratio);
}
let patches=0;
for(let n=3;n<=6;n++)for(const angle of [10,1]){
 const points=Array.from({length:n},(_,i)=>{const t=i*2*Math.PI/n;return [Math.cos(t),Math.sin(t),.25*Math.sin(t*2)];});
 const edges=points.map((a,i)=>{const b=points[(i+1)%n];return [a,a.map((v,k)=>v+(b[k]-v)/3+(k===2?.3:0)),a.map((v,k)=>v+2*(b[k]-v)/3+(k===2?.3:0)),b];});
 const r=M.build(edges,{angle,length:'span'});assert(r.check2D.valid);assert(!r.limited);for(const key of ['holes','missing','extra','nonmanifold','degenerate'])assert.equal(r.check[key],0,n+' sides '+key);
 const boundary=r.edgeSamples.flatMap(side=>side.slice(0,-1).map(q=>q.p));assert.deepEqual(r.mesh.p.slice(0,r.mesh.boundaryCount),boundary,'boundary moved');patches++;
 // Similarity transforms must not change physical density materially.
 if(angle===10){const translated=M.build(edges.map(e=>e.map(p=>p.map(v=>v+1e6))),{angle,length:'span'});assert(Math.abs(translated.mesh.triangles.length-r.mesh.triangles.length)<Math.max(12,r.mesh.triangles.length*.15),'translation dependent density');const scaled=M.build(edges.map(e=>e.map(p=>p.map(v=>v*100))),{angle,length:'span'});assert(Math.abs(scaled.mesh.triangles.length-r.mesh.triangles.length)<Math.max(12,r.mesh.triangles.length*.15),'scale dependent density');}
}
console.log('PASS: egg meridian density ratios '+ratios.map(x=>x.toFixed(2)).join(', ')+'; '+patches+' patches with 3–6 sides; boundaries and scale invariance.');
