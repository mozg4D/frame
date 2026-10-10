'use strict';
// Dyadic ORIGINAL fixture banks, independently specified before generation.
// Unit rational supporting normals give 128 facets; quantization is explicit
// in the actual source, not a comparison to an emitted command or old worker.
function annulus({W=1,subdivisions=1,reversed=false,turn=0,translation=[0,0],facets=128,alpha=63/64}={}){
 if(facets%4)throw Error('fixture facet count');
 const N=facets/4,unit=[];
 for(let quadrant=0;quadrant<4;quadrant++)for(let i=0;i<N;i++){
  const t=i/N,c=(1-t*t)/(1+t*t),s=2*t/(1+t*t);
  unit.push(quadrant===0?[c,s]:quadrant===1?[-s,c]:quadrant===2?[-c,-s]:[s,-c]);
 }
 const radius=64.0001,outer=unit.map((a,i)=>{
  const b=unit[(i+1)%unit.length],det=a[0]*b[1]-a[1]*b[0];
  return [(radius*b[1]-radius*a[1])/det,(a[0]*radius-b[0]*radius)/det].map(v=>Math.round(v*2**20)/2**20);
 }),inner=outer.map(p=>p.map(v=>v*alpha));
 const transform=p=>{
  let [x,y]=p;for(let i=0;i<turn;i++)[x,y]=[-y,x];
  return [x*W+translation[0],y*W+translation[1]];
 };
 const rings=[outer,inner].map(r=>r.flatMap((p,i)=>Array.from({length:subdivisions},(_,j)=>p.map((v,k)=>v+(r[(i+1)%r.length][k]-v)*j/subdivisions))).map(transform));
 if(reversed)rings.forEach(r=>r.reverse());return rings;
}
function annulusPrism(rings,{height=1,shift=[0,0],generation=1,alternateDiagonal=false}={}){
 if(rings.length!==2||rings[0].length!==rings[1].length)throw Error('paired prism fixture banks');
 const n=rings[0].length,base=rings.flat(),vertices=[...base.map(p=>[...p,0]),...base.map(p=>[p[0]+shift[0],p[1]+shift[1],height])],faces=[];
 for(let bank=0;bank<2;bank++)for(let i=0;i<n;i++){
  const a=bank*n+i,b=bank*n+(i+1)%n,c=b+2*n,d=a+2*n;
  const triangles=alternateDiagonal?[[a,b,d],[b,c,d]]:[[a,b,c],[a,c,d]];
  faces.push(...triangles.map(t=>bank?[t[0],t[2],t[1]]:t));
 }
 // Original source material caps; section through the middle misses these.
 for(let i=0;i<n;i++){
  const j=(i+1)%n;faces.push([i,n+j,j],[i,n+i,n+j],
   [i+2*n,j+2*n,n+j+2*n],[i+2*n,n+j+2*n,n+i+2*n]);
 }
 return {vertices,faces,generation};
}
function doubleWindingStar(){
 const n=191,radius=64/Math.cos(2*Math.PI/n)*(1+1.5e-6),outer=Array.from({length:n},(_,i)=>{
  const angle=4*Math.PI*i/n;return [Math.cos(angle),Math.sin(angle)].map(v=>Math.round(v*radius*2**20)/2**20);
 });
 return [outer,outer.map(p=>p.map(v=>v*63/64))];
}
module.exports={annulus,annulusPrism,doubleWindingStar};
