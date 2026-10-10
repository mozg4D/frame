'use strict';
const R=require('./rational.cjs');
// Exact open halfplane clipping: a nonempty interval proves positive contact
// with the INTERIOR of a convex deposited ribbon, without epsilon predicates.
function segmentInteriorInterval(a,b,quad){const P=quad.map(p=>p.map(R.exact)),A=a.map(R.exact),B=b.map(R.exact);let area=R.zero;for(let i=0;i<P.length;i++)area=R.add(area,R.cross(P[i],P[(i+1)%P.length]));const sign=R.cmp(area,R.zero);if(!sign)throw Error('degenerate deposited ribbon');let lo=R.zero,hi=R.one;for(let i=0;i<P.length;i++){const p=P[i],q=P[(i+1)%P.length],edge=R.vec(q,p),f=x=>R.mul(R.rat(BigInt(sign)),R.cross(edge,R.vec(x,p))),u=f(A),v=f(B),slope=R.sub(v,u);if(R.cmp(slope,R.zero)===0){if(R.cmp(u,R.zero)<=0)return null;continue;}const cut=R.div(R.mul(R.rat(-1n),u),slope);if(R.cmp(slope,R.zero)>0){if(R.cmp(cut,lo)>0)lo=cut;}else if(R.cmp(cut,hi)<0)hi=cut;if(R.cmp(lo,hi)>=0)return null;}return R.cmp(lo,hi)<0?{exactT0:R.str(lo),exactT1:R.str(hi)}:null;}
module.exports={segmentInteriorInterval};
