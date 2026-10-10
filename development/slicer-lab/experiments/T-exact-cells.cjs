'use strict';
// Experimental exact broad phase for many cells of ONE continuous phase.
// No tolerance, polygon repair, worker/pool, or change to production core.
const R=require('../core/rational.cjs'),A=require('../core/accuracy-contract.cjs'),{hull,subtract,intersectConvexCells}=require('../core/trajectory-union-accuracy.cjs');
const {dense}=require('./T-dense-input.cjs');
const bounded=q=>{if(q.n.toString(2).replace('-','').length>1024||q.d.toString(2).length>1024)throw Error('experimental coordinate representation budget');return q;};
const exact=x=>{let q;if(typeof x==='number'){if(!Number.isFinite(x))throw Error('finite experimental coordinate required');q=R.exact(x);}
 else if(typeof x==='string'){if(x.length>625)throw Error('experimental coordinate representation budget');if(!/^-?\d+\/\d+$/.test(x))throw Error('valid rational experimental coordinate required');const[n,d]=x.split('/').map(BigInt);if(d<=0n)throw Error('valid rational experimental coordinate required');bounded({n,d});q=R.rat(n,d);}
 else{if(!x||typeof x.n!=='bigint'||typeof x.d!=='bigint'||x.d<=0n)throw Error('valid rational experimental coordinate required');bounded(x);q=R.rat(x.n,x.d);}return bounded(q);};
const signed=p=>R.div(p.reduce((s,q,i)=>R.add(s,R.cross(q,p[(i+1)%p.length])),R.zero),R.rat(2n)),sum=ps=>ps.reduce((s,p)=>R.add(s,signed(p)),R.zero);
function createExactCells(polygons,{maxCells=576}={}){
 // Three flat-front caps/banks produce at most 576 cells in this admitted
 // seven-row class. Keep the same 1,000,000 clipping-operation budget.
 if(!Number.isSafeInteger(maxCells)||maxCells<1||maxCells>1536)throw Error('bounded integer experimental cell capacity required');
 dense(polygons,{max:maxCells,name:'experimental cells'});
 const boxes=new WeakMap(),box=p=>{if(boxes.has(p))return boxes.get(p);const b=[0,1].map(k=>p.reduce((m,q)=>A.min(m,q[k]),p[0][k])).concat([0,1].map(k=>p.reduce((m,q)=>A.max(m,q[k]),p[0][k])));boxes.set(p,b);return b;},
  disjoint=(a,b)=>R.cmp(a[2],b[0])<=0||R.cmp(b[2],a[0])<=0||R.cmp(a[3],b[1])<=0||R.cmp(b[3],a[1])<=0,
  prepare=ps=>{dense(ps,{max:maxCells,name:'experimental cell array'});return ps.map(p=>{dense(p,{min:3,max:512,name:'experimental polygon'});p.forEach(v=>dense(v,{min:2,max:2,name:'two-dimensional point'}));let q=p.map(v=>v.map(exact));
   if(new Set(q.map(p=>p.map(R.str).join(','))).size!==q.length)throw Error('distinct experimental cell vertices required');
   const area=signed(q);if(!area.n)throw Error('nondegenerate experimental cell required');if(area.n<0n)q=q.slice().reverse();
   for(let i=0;i<q.length;i++)if(q.some(v=>R.cross(R.vec(q[(i+1)%q.length],q[i]),R.vec(v,q[i])).n<0n))throw Error('ordered convex experimental cell required');
   return hull(q);});},cells=prepare(polygons);
 for(const cell of cells){for(const p of cell){p.forEach(Object.freeze);Object.freeze(p);}Object.freeze(cell);}Object.freeze(cells);
 const difference=(sources,targets,{maxWork=1000000,signal,order='input'}={})=>{if(!Number.isSafeInteger(maxWork)||maxWork<1||maxWork>1000000)throw Error('finite bounded integer experimental work budget required');
  if(!['input','bbox-largest-first'].includes(order))throw Error('unknown experimental exact cell order');
  sources=prepare(sources);targets=prepare(targets);const budget={work:0,maxWork,broadPhase:false},out=[];
  for(const source of sources){if(signal?.aborted)throw Error('experimental cells cancelled');let remaining=[source];
   const sb=box(source),ordered=order==='input'?targets:targets.filter(t=>!disjoint(sb,box(t))).map((target,index)=>{const b=box(target),score=R.mul(R.sub(A.min(sb[2],b[2]),A.max(sb[0],b[0])),R.sub(A.min(sb[3],b[3]),A.max(sb[1],b[1])));return{target,score,index};})
    .sort((a,b)=>R.cmp(b.score,a.score)||a.index-b.index).map(q=>q.target);
   for(const target of ordered){remaining=remaining.flatMap(p=>disjoint(box(p),box(target))?[p]:subtract(p,target,budget));if(remaining.length>4096)throw Error('experimental cell fragment budget');if(!remaining.length)break;}
   out.push(...remaining);
  }
  return{cells:out,work:budget.work,covered:!out.length,exactArea:R.str(sum(out))};};
 const measure=(signal)=>{const budget={work:0,maxWork:1000000,broadPhase:false},fragments=[];let P=R.zero,intersectingPairs=0;
  for(let i=0;i<cells.length;i++){if(signal?.aborted)throw Error('experimental cells cancelled');let remaining=[cells[i]];
   for(let j=0;j<i;j++)if(!disjoint(box(cells[i]),box(cells[j]))){const common=intersectConvexCells(cells[i],cells[j],budget),value=common.length>2?signed(common):R.zero;
    if(value.n<0n)throw Error('negative experimental pair area');P=R.add(P,value);if(value.n)intersectingPairs++;
    remaining=remaining.flatMap(p=>disjoint(box(p),box(cells[j]))?[p]:subtract(p,cells[j],budget));if(remaining.length>4096)throw Error('experimental union fragment budget');}
   fragments.push(...remaining);
  }
  const total=sum(cells),U=sum(fragments),D=R.sub(total,U),excess=R.sub(P,D);if(D.n<0n||excess.n<0n)throw Error('experimental multiplicity invariant');
  return{sumAreaExactMM2:R.str(total),unionAreaExactMM2:R.str(U),commandedDuplicateAreaExactMM2:R.str(D),pairIntersectionSumExactMM2:R.str(P),pairMinusDuplicateExactMM2:R.str(excess),
   positiveTripleCoverage:excess.n>0n,intersectingPairs,unionFragments:fragments.length,work:budget.work,commanded2DMultiplicityCertified:true,physicalFlowOrVolumeCertified:false,
   method:'exact convex partition and pair intersections; cached exact bounding boxes, zero tolerance'};
 };
 return{cells,prepare,difference,measure};
}
module.exports={createExactCells};
