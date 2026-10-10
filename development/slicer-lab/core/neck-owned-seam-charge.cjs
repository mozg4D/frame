'use strict';
const R=require('./rational.cjs');
const cross3=(a,b,p)=>R.cross(R.vec(b,a),R.vec(p,a));
function exactContained(poly,boundary){const B=boundary.map(p=>p.map(R.exact)),P=poly.map(p=>p.map(R.exact)),area=B.reduce((s,a,i)=>R.add(s,R.cross(a,B[(i+1)%B.length])),R.zero),sign=area.n<0n?-1:1;if(!area.n)return false;return P.every(p=>B.every((a,i)=>{const z=cross3(a,B[(i+1)%B.length],p);return sign<0?z.n<=0n:z.n>=0n;}));}
function exactOnDirectedInterval(p,a,b){[p,a,b]=[p,a,b].map(v=>v.map(R.exact));const d=R.vec(b,a),v=R.vec(p,a),u=R.dot(v,d),length=R.dot(d,d);return length.n>0n&&R.cross(d,v).n===0n&&R.cmp(u,R.zero)>=0&&R.cmp(u,length)<=0;}
function installOwnedSeamCharge(c){const charge=c.frameThroughNeckCharge;
 c.frameSourceOwnedNeckCharge=(original,points,widths,edges,W)=>{
 const old=original.map((a,i)=>c.frameThroughNeckRibbon(a,original[(i+1)%original.length],W,W)),final=points.slice(1).map((b,i)=>c.frameThroughNeckRibbon(points[i],b,widths[i],widths[i+1])),certificates=[];
 for(let i=0;i<edges.length;i++){const e=edges[i],id=e.originalEdge;if(e.role!=='through-neck-original-interval'||!Number.isInteger(id)||id<0||id>=original.length||widths[i]!==W||widths[i+1]!==W)continue;const a=original[id],b=original[(id+1)%original.length],forward=R.dot(R.vec(points[i+1].map(R.exact),points[i].map(R.exact)),R.vec(b.map(R.exact),a.map(R.exact))).n>0n;if(forward&&exactOnDirectedInterval(points[i],a,b)&&exactOnDirectedInterval(points[i+1],a,b)&&exactContained(final[i],old[id])){old.push(final[i]);certificates.push({segment:i,originalEdge:id,exactCollinearSubinterval:true,wholeRibbonExactSubset:true,commandedWidthUnchanged:true});}}
 const result=charge(old,final,W);return{...result,unchangedOriginalIntervalCertificates:certificates,additionalExemption:'only exact directed same-width subsets of immutable original nominal ribbons; no moved body, cap or profile exemption',specialReversePressExemptions:0};
 };return c;
}
module.exports={installOwnedSeamCharge,exactContained,exactOnDirectedInterval};
