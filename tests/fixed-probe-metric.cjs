const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const source=html.slice(html.indexOf('function createFrameSurfaceKernel()'),html.indexOf('const FrameSurfaceKernel=')).replace('return {topology2D,refine,buildTopology:', 'return {surfaceMetricGrid,topology2D,refine,buildTopology:');
const M=new Function(source+';return createFrameSurfaceKernel().MeshBuilder;')();
function field(fn,n=4,angle=5){let calls=0;const map=M.surfaceMetricGrid({n,evaluate:(u,v)=>{calls++;return fn(u,v);}},[],n,angle),expected=n===3?66:64;
 assert.equal(calls,expected);assert.equal(map.diagnostics.surfaceEvaluations,expected);assert.equal(map.diagnostics.extraSamples,0);
 if(n===3||n===4)assert.equal(map.diagnostics.boundaryProbes,n===3?30:28);
 const at=(x,y)=>Array.from(map(x,y,new Float64Array(3)));
 for(let i=0;i<1000;i++)at((i%31)/31,(i%47)/47);assert.equal(calls,expected+map.diagnostics.extraSamples,'all local verification calls are accounted');const saved=calls;for(let i=0;i<1000;i++)at((i%31)/31,(i%47)/47);assert.equal(calls,saved,'repeated probes use the cache');return {at,map};}
const plane=field((u,v)=>[u*100,v*3,7+u-v]);for(const [x,y] of [[.1,.1],[.5,.5],[.9,.9]]){const m=plane.at(x,y);assert(Math.abs(m[0]-.25)<1e-12&&Math.abs(m[1])<1e-12&&Math.abs(m[2]-.25)<1e-12);}
const k=Math.PI/2,theta=5*Math.PI/180,expected=k*k/(theta*theta),cylinder=field((u,v)=>[Math.sin(k*u),v,Math.cos(k*u)]);
for(const x of [0,.01,.05,.25,.5,.75,.95,.99,1]){const m=cylinder.at(x,.5);assert(Math.abs((m[0]-.25)/expected-1)<.15,'cylinder angular step estimate including boundary');assert(m[2]<.250001&&Math.abs(m[1])<1e-6,'straight axis was refined');}
const rotated=field((u,v)=>{const s=(u+v)/Math.SQRT2;return [Math.sin(k*s),(v-u)/Math.SQRT2,Math.cos(k*s)];});
for(const x of [.2,.5,.8]){const m=rotated.at(x,x);assert(Math.abs(m[1]/(expected*.5)-1)<.2,'mixed normal derivative lost');assert(Math.abs(m[0]-m[2])<expected*.1);}
// Every boundary is straight, but the interior needs sampling in both axes.
const bump=(u,v)=>[u,v,2*u*(1-u)*v*(1-v)],coarse=field(bump,4,10),fine=field(bump,4,1),a=coarse.at(.5,.5),b=fine.at(.5,.5);
assert(a[0]>10&&a[2]>10);assert(Math.abs((b[0]-.25)/(a[0]-.25)-100)<1e-8);assert(Math.abs((b[2]-.25)/(a[2]-.25)-100)<1e-8);
for(const n of [2,3,5,6,7,8,9,10,11,12]){const f=field((u,v)=>[u,v,.1*u*v],n);for(const q of [[.4,.4],[.5,.5],[.6,.4]]){const m=f.at(...q);assert(m.every(Number.isFinite)&&m[0]*m[2]>m[1]*m[1]);}}
console.log('PASS fixed 64/66 position probes; cached verification probes; plane, cylinder, rotated curvature, curved interior with straight boundaries and all 2–12-sided domains.');
