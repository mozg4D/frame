import {readFile} from 'node:fs/promises';

// Inject an incorrect transient cell into the real shared worker proof. Both
// nested disks have positive triangles and conforming edge incidence, but their
// union fills the authored hole. No production triangulator or test hook is
// substituted, and no runtime geometry is retained by this oracle.
export async function invalidPlanarFill(){
 const html=await readFile(new URL('../../../index.html',import.meta.url),'utf8'),start=html.indexOf('function sourceAccuracy(state){'),end=html.indexOf('\nfunction assembleFresh',start);
 if(start<0||end<=start)throw Error('Shared source proof not found');
 const K={segmentPoints:(data,id)=>{const e=data.segments[id],a=data.vertices[e.a],b=data.vertices[e.b];return [a,a.map((x,k)=>x+e.ha[k]),b.map((x,k)=>x+e.hb[k]),b];}},evaluate=Function('K','return ('+html.slice(start,end)+');')(K);
 const data={vertices:{},segments:{}},positions=[],indices=[],boundary=[],loops=[],params=new Map(),samples=new Map();
 for(let ring=0;ring<2;ring++){
  const radius=ring?1:2,points=[[radius,0,0],[0,radius,0],[-radius,0,0],[0,-radius,0]],refs=[],base=positions.length/3;
  for(let i=0;i<4;i++)data.vertices['r'+ring+'v'+i]=points[i];
  for(let i=0;i<4;i++){
   const a=points[i],b=points[(i+1)%4],id='r'+ring+'s'+i,e={a:'r'+ring+'v'+i,b:'r'+ring+'v'+((i+1)%4),ha:[-a[1]/2,a[0]/2,0],hb:[b[1]/2,-b[0]/2,0]};data.segments[id]=e;refs.push({edge:id,reversed:false});
   const cp=K.segmentPoints(data,id),times=Array.from({length:9},(_,i)=>i/8),list=times.map(t=>({t,position:[0,1,2].map(k=>(1-t)**3*cp[0][k]+3*(1-t)**2*t*cp[1][k]+3*(1-t)*t*t*cp[2][k]+t**3*cp[3][k])}));params.set(id,times);samples.set(id,list);
   for(let j=0;j<8;j++){boundary.push([j?'s:'+id+':'+j:'v:'+e.a,positions.length/3]);positions.push(...list[j].position);}
  }
  loops.push(refs);for(let i=1;i<31;i++)indices.push(base,base+i,base+i+1);
 }
 // Inner cubic controls satisfy |x|+|y| >= 1 in their respective quadrants.
 // Thus their distance from the origin is at least 1/sqrt(2), exceeding 0.7.
 const state={data,cells:{fills:[{planar:true,loops}]},quads:[null],params,samples,parts:[{cell:{positions:new Float32Array(positions),indices:new Uint32Array(indices),boundary,planar:true}}]};
 return {accuracy:evaluate(state),invalidFill:'two nested filled disks instead of an annulus',nativeHoleCenter:[0,0,0],authoredHoleDistanceLowerBound:.7};
}
