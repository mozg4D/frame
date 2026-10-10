'use strict';
// Exact section C is preserved while redundant collinear TRIANGLE subdivisions
// are removed. Every executed bank interval is re-partitioned against ORIGINAL
// exact triangle fragments; rounded midpoint coordinates provide no authority.
const R=require('../core/rational.cjs'),{hash}=require('../core/mesh-section.cjs');
const same=(a,b)=>a.length===b.length&&a.every((v,k)=>v===b[k]),P=p=>p.map(R.parse),min=(a,b)=>R.cmp(a,b)<0?a:b,max=(a,b)=>R.cmp(a,b)>0?a:b;
function createDecimalSectionBinder(section){
 if(section.rings.length!==1||section.exactRings.length!==1||!section.closedComponentsQualified)throw Error('single closed exact decimal section required');
 const raw=section.exactRings[0].map(P),n=raw.length,corners=[];for(let i=0;i<n;i++){const d=R.vec(raw[(i+1)%n],raw[i]);if(!d.some(q=>q.n)||d.every(q=>q.n))throw Error('axis-aligned original exact bank required');if(R.cross(R.vec(raw[i],raw[(i+n-1)%n]),d).n)corners.push(i);}
 if(corners.length!==8)throw Error('exact eight-corner T section required');const source=corners.map(i=>raw[i].map(q=>{const x=R.number(q);if(R.cmp(R.exact(x),q))throw Error('nonrepresentable ORIGINAL source corner');return x;}));
 for(const faces of section.edgeFaces[0])for(const f of faces)if(f.exactNormal.length!==3||R.parse(f.exactNormal[2]).n)throw Error('decimal route requires exact vertical source triangles');
 const banks=corners.map((i,edge)=>{const next=corners[(edge+1)%8],A=raw[i],B=raw[next],D=R.vec(B,A),length2=R.dot(D,D),at=p=>R.div(R.dot(R.vec(p,A),D),length2),parts=[];let prior=R.zero,j=i;
  while(j!==next){const k=(j+1)%n,a=raw[j],b=raw[k],t0=at(a),t1=at(b);if(R.cross(D,R.vec(a,A)).n||R.cross(D,R.vec(b,A)).n||R.cmp(t0,prior)||R.cmp(t1,t0)<=0)throw Error('incomplete original exact bank chain');parts.push({edge:j,t0,t1,faces:section.edgeFaces[0][j]});prior=t1;j=k;}if(R.cmp(prior,R.one))throw Error('original exact bank not fully covered');return{edge,A,B,parts};});
 const certificate={sourceCorners:source,originalExactSectionHash:hash(section.exactRings),originalTriangleFragments:n,removedExactCollinearSubdivisions:n-8,geometricSourceConversionExactUpperBound:'0/1',reportedFiniteMidpointConversionExactUpperBound:section.conversionExactUpperBound,originalCAndPGeometryUnchanged:true,completeExactBankChains:true,nonrepresentableCornersAccepted:false};
 function bind(intervals){return intervals.map(q=>{const bank=banks[q.edge],u0=R.parse(q.exactU0),u1=R.parse(q.exactU1);if(q.ring!==0||!bank||!same(q.sourceStart,source[q.edge])||!same(q.sourceEnd,source[(q.edge+1)%8])||[u0,u1].some(q=>q.n<0n||R.cmp(q,R.one)>0))throw Error('unbound original decimal canonical bank');const lo=min(u0,u1),hi=max(u0,u1),reverse=R.cmp(u1,u0)<0,actualTriangleIntervals=[];
  for(const part of reverse?bank.parts.slice().reverse():bank.parts){const left=max(lo,part.t0),right=min(hi,part.t1);if(R.cmp(left,right)>0||R.cmp(left,right)===0&&R.cmp(lo,hi)!==0)continue;const a=reverse?right:left,b=reverse?left:right,local=t=>R.div(R.sub(t,part.t0),R.sub(part.t1,part.t0)),at=t=>bank.A.map((v,k)=>R.str(R.add(v,R.mul(t,R.sub(bank.B[k],v)))));for(const f of part.faces)actualTriangleIntervals.push({faceId:f.faceId,sourceAngle:f.sourceAngle,exactNormal:f.exactNormal,originalSectionRing:0,originalSectionEdge:part.edge,exactU0:R.str(local(a)),exactU1:R.str(local(b)),canonicalExactU0:R.str(a),canonicalExactU1:R.str(b),exactSectionStart:at(a),exactSectionEnd:at(b)});}
  if(!actualTriangleIntervals.length)throw Error('decimal original triangle ownership missing');return{...q,coordinateSpace:'exact original canonical bank; actualTriangleIntervals identify original mesh fragments',actualTriangleIntervals};});}
 return{source,certificate,bind};
}
module.exports={createDecimalSectionBinder};
