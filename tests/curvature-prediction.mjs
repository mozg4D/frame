import assert from 'node:assert/strict';
import {cylinder,icosphere} from './curvature-prediction-fixtures.mjs';
import {readFile} from 'node:fs/promises';
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('function framePredictBend('),end=html.indexOf('    const bendStates=',start);
assert.ok(start>=0&&end>start);
const framePredictBend=Function(html.slice(start,end)+'\nreturn framePredictBend;')();

const PI=Math.PI, I=[1,0,0,0,1,0,0,0,1],close=(x,y,t=1e-11)=>assert(Math.abs(x-y)<=t,`${x} != ${y}`);
const principal=(P,F,angle=44,metric=I,cylinders=false)=>framePredictBend(Float64Array.from(P),Uint32Array.from(F),metric,angle,{raw:true,cylinders});
for(const N of [12,24])for(const R of [10,100,1000])for(const cap of [true,false])for(const flip of [true,false])for(const rows of [[0,100],[0,29,71,100]]){
  const [p,f,ns]=cylinder(N,R,cap,flip,rows);
  const out=principal(p,f);
  assert.equal(out.diagnostics.hard,cap?2*N:0);
  for(let i=0;i<6*ns;i+=2){close(out.principals[i],0);close(out.principals[i+1],1/R);}
  for(let i=6*ns;i<out.principals.length;i++)close(out.principals[i],0);
}
{
  const [p,f,ns]=cylinder(12,100);
  const cut=principal(p,f,29.999,I,true);
  assert.equal(cut.diagnostics.recognizedCylinders,0);
  assert.equal(cut.diagnostics.hard,60);
  for(const x of cut.principals)close(x,0);
  const s2=principal(p,f,44,[2,0,0,0,2,0,0,0,2]);
  for(let i=1;i<6*ns;i+=2)close(s2.principals[i],.005);
  const a=.58,b=.31,c=Math.cos(a),s=Math.sin(a),C=Math.cos(b),S=Math.sin(b);
  const R=[c,s,0,-C*s,C*c,S,S*s,-S*c,C];
  const rot=principal(p,f,44,R,true);assert.equal(rot.diagnostics.recognizedCylinders,1);
  for(let i=1;i<6*ns;i+=2)close(rot.principals[i],.01);
}
for(const flip of [true,false]) {
  const [p,f,ns]=cylinder(12,100,false,flip,undefined,true,true);
  const generic=principal(p,f),circle=principal(p,f,44,I,true);
  let lo=Infinity,hi=-Infinity;
  assert.equal(circle.diagnostics.recognizedCylinders,1);
  for(let i=1;i<6*ns;i+=2){close(circle.principals[i],.01);lo=Math.min(lo,generic.principals[i]);hi=Math.max(hi,generic.principals[i]);}
  assert(hi-lo>5e-4, 'irregular is a useful stress fixture');
  console.log('Irregular cylinder',flip,`generic [${lo.toPrecision(7)}, ${hi.toPrecision(7)}], recognized 0.01`);
}
// One hard axial seam does not disconnect the face component: it reconnects
// around the other eleven strips. A global cylinder fit must still see the cut.
for(const flip of [false,true]){
  const stations=[0,50,100,126,152,178,204,230,256,282,308,334],n=stations.length,p=[],f=[];
  for(const z of [0,30,60,90])for(const a of stations)p.push(100*Math.cos(a*PI/180),100*Math.sin(a*PI/180),z);
  for(let row=0;row<3;row++)for(let i=0;i<n;i++){
    const a=row*n+i,b=row*n+(i+1)%n,c=b+n,d=a+n;
    if(flip)f.push(a,b,d,b,c,d);else f.push(a,b,c,a,c,d);
  }
  const cut=principal(p,f,44,I,true),local=principal(p,f,44,I,false),uncut=principal(p,f,55,I,true);
  assert.equal(f.length/3,72);
  assert.equal(cut.diagnostics.hard,3);
  assert.equal(cut.diagnostics.recognizedCylinders,0,'an alternate path around the cylinder must not erase the hard seam');
  assert.equal(cut.diagnostics.validFans+cut.diagnostics.unknownFans,52);
  assert(cut.diagnostics.unknownFans>0,'low-support local fits remain unknown, not analytic curvature');
  assert.equal(uncut.diagnostics.hard,0);
  assert.equal(uncut.diagnostics.recognizedCylinders,1);
  assert.equal(uncut.diagnostics.validFans,48);
  assert.deepEqual(cut.principals,local.principals,'use side-local estimates when a shared fit would bridge the cut');
  assert.deepEqual(cut.values,local.values);
  const sideValues=[[],[]];
  for(let i=0;i<f.length;i++){
    close(uncut.principals[i*2],0);
    close(uncut.principals[i*2+1],.01);
    if(f[i]%n!==1)continue;
    const strip=Math.floor(i/6)%n;
    if(strip<=1)sideValues[strip].push(Math.max(Math.abs(cut.principals[i*2]),Math.abs(cut.principals[i*2+1])));
  }
  assert(sideValues.every(values=>values.length>0&&values.every(Number.isFinite)&&values.some(k=>Math.abs(k-.01)>1e-4)));
  console.log('Isolated axial seam',flip,'44° shared fits',cut.diagnostics.recognizedCylinders,'55° shared fits',uncut.diagnostics.recognizedCylinders,'known/unknown fans',cut.diagnostics.validFans+'/'+cut.diagnostics.unknownFans,'interior seam κ',sideValues.map(v=>v[2]));
}
{
  const [p,f,ns]=cylinder(12,100,true);
  const out=principal(p,f,44,I,true);
  assert.equal(out.diagnostics.hard,24);
  assert.equal(out.diagnostics.recognizedCylinders,1,'separating hard rims must not block the side fit');
  for(let i=0;i<6*ns;i+=2){close(out.principals[i],0);close(out.principals[i+1],.01);}
  for(let i=6*ns;i<out.principals.length;i++)close(out.principals[i],0);
}
for(const [ell,taper] of [[1.05,0],[1,.002]]){
  const [p,f]=cylinder(12,100,false,false,undefined,false,false,ell,taper);
  assert.equal(principal(p,f,44,I,true).diagnostics.recognizedCylinders,0);
}
for(let level=0;level<4;level++)for(const uneven of level?[false,true]:[false]){
  const [p,f]=icosphere(level,100,uneven),out=principal(p,f,44,I,true);
  assert.equal(out.diagnostics.recognizedCylinders,0);
  let lo=Infinity,hi=-Infinity;
  for(const x of out.principals){lo=Math.min(lo,Math.abs(x));hi=Math.max(hi,Math.abs(x));}
  assert(lo>.009 && hi<.011, 'check both principal curvatures before normalization');
  console.log(`Sphere ${f.length/3} tris uneven=${uneven} |κ|=[${lo.toPrecision(8)},${hi.toPrecision(8)}]`);
}
{
  const [p,f]=icosphere(0);
  assert.equal(principal(p,f,40).diagnostics.unknownCorners,f.length);
  const single=principal([0,0,0,1,0,0,0,1,0],[0,1,2]);
  assert(single.principals.every(Number.isNaN));
  assert.deepEqual([...single.values],[-1,-1,-1,-1]);
  const angle=44*PI/180,P=[0,0,0,1,0,0,0,1,0,0,-Math.cos(angle),Math.sin(angle)],F=[0,1,2,1,0,3];
  for(const [limit,hard] of [[43.999,1],[44,0],[44.001,0]])assert.equal(principal(P,F,limit).diagnostics.hard,hard);
  assert.equal(principal(...icosphere(0)).values[3],-8);
  const wasm=Function(`return (${framePredictBend.toString()})`)();
  assert.equal(wasm(P,F,I,44).diagnostics.hard,0);
  const invalid=principal([...P,0,-1,-1],[...F,0,1,4]);
  assert.equal(invalid.diagnostics.invalid,1);
}
if(process.argv.includes('--stress')){
  const [p,f]=cylinder(150,500,false,false,Array.from({length:501},(_,i)=>i*10),true,true,1.02);
  const before=process.memoryUsage(),start=performance.now();
  const out=framePredictBend(Float64Array.from(p),Uint32Array.from(f),I,44);
  const after=process.memoryUsage();
  assert.equal(f.length/3,150000);
  assert.equal(out.values.length,600000);
  assert(!Object.hasOwn(out,'principals'));
  console.log(`Cap fixture ${Math.round(performance.now()-start)} ms; peak-ish RSS delta ${Math.round((after.rss-before.rss)/1048576)} MiB; packed ${out.values.byteLength} bytes; accepted ${out.diagnostics.validFans}`);
}
console.log('Standalone Node CPU checks passed.');
