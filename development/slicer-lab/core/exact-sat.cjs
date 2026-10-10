'use strict';
const fastPredicateSource=`function frameFastDisjointConvex(a,b){
 frameThroughNeckProfile.reset(); // Same per-predicate resource-counter boundary as retained SAT.
 const raw=frameAcuteExact([...a.flat(),...b.flat()]),A=a.map((_,i)=>raw.slice(i*2,i*2+2)),B=b.map((_,i)=>raw.slice(a.length*2+i*2,a.length*2+i*2+2));
 const cross=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
 for(const[first,second]of[[A,B],[B,A]]){let area=0n;for(let i=0;i<first.length;i++)area+=first[i][0]*first[(i+1)%first.length][1]-first[i][1]*first[(i+1)%first.length][0];if(!area)throw Error('degenerate-neck-neighbor-ribbon');const sign=area<0n?-1n:1n;for(let i=0;i<first.length;i++)if(second.every(p=>cross(first[i],first[(i+1)%first.length],p)*sign<=0n))return true;}
 return false;
}`;
module.exports={fastPredicateSource};
