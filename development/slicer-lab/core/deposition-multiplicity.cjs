'use strict';
// Commanded TWO-DIMENSIONAL polygon multiplicity. Never physical flow/volume.
const R=require('./rational.cjs'),A=require('./accuracy-contract.cjs');
const {hull,subtract}=require('./trajectory-union-accuracy.cjs');
const bounded=q=>{if(q.n.toString(2).replace('-','').length>1024||q.d.toString(2).length>1024)throw Error('multiplicity rational representation budget');return q;};
function exact(x){let q;if(typeof x==='string'){if(x.length>625)throw Error('multiplicity rational representation budget');q=R.parse(x);}
 else if(typeof x==='number')q=R.exact(x);
 else{if(!x||typeof x.n!=='bigint'||typeof x.d!=='bigint'||x.d<=0n)throw Error('invalid exact multiplicity coordinate');bounded(x);q=R.rat(x.n,x.d);}
 return bounded(q);}
function workBudget(maxWork){if(typeof maxWork!=='number'||!Number.isSafeInteger(maxWork)||maxWork<1||maxWork>1000000)throw Error('finite bounded integer multiplicity work budget required');return{work:0,maxWork};}
const area=p=>R.div(A.abs(p.reduce((s,a,i)=>R.add(s,R.cross(a,p[(i+1)%p.length])),R.zero)),R.rat(2n));
const sum=ps=>ps.reduce((s,p)=>R.add(s,area(p)),R.zero);
const bounds=p=>[0,1].map(k=>[p.map(v=>v[k]).reduce(A.min),p.map(v=>v[k]).reduce(A.max)]);
const separated=(a,b)=>[0,1].some(k=>R.cmp(a[k][1],b[k][0])<=0||R.cmp(b[k][1],a[k][0])<=0);
function prepare(polys){if(!Array.isArray(polys)||polys.length>512)throw Error('bounded polygon multiplicity input');return polys.map(p=>{
 if(!Array.isArray(p)||p.length<3||p.length>512||p.some(v=>!Array.isArray(v)||v.length!==2))throw Error('bounded two-dimensional convex polygon required');
 const points=p.map(v=>v.map(exact)),keys=points.map(v=>v.map(R.str).join(','));
 if(new Set(keys).size!==points.length)throw Error('simple convex polygon requires distinct vertices');
 const signed=points.reduce((s,a,i)=>R.add(s,R.cross(a,points[(i+1)%points.length])),R.zero);
 if(!signed.n)throw Error('nondegenerate simple convex polygon required');
 const ordered=signed.n>0n?points:points.slice().reverse();
 for(let i=0;i<ordered.length;i++){const a=ordered[i],b=ordered[(i+1)%ordered.length],c=ordered[(i+2)%ordered.length],d=R.vec(b,a),e=R.vec(c,b);
  if(!R.cross(d,e).n&&R.dot(d,e).n<=0n)throw Error('simple convex polygon cannot reverse a collinear edge');
  if(ordered.some(v=>R.cross(d,R.vec(v,a)).n<0n))throw Error('simple convex polygon cyclic edge order required');
 }
 // Hull now removes only ordered redundant collinear vertices. It never repairs
 // invalid input or silently fills a concavity or a self-intersection.
 return hull(ordered);
});}
function union(polys,budget){const fragments=[],prior=[];for(const p of polys){let rest=[p];for(const q of prior){
 rest=rest.flatMap(r=>separated(bounds(r),bounds(q))?[r]:subtract(r,q,budget));if(rest.length>4096)throw Error('bounded union fragments');if(!rest.length)break;
 }fragments.push(...rest);prior.push(p);}return fragments;}
function commandedMultiplicity(polygons,{maxWork=1000000}={}){
 const budget=workBudget(maxWork),polys=prepare(polygons),u=union(polys,budget),total=sum(polys),unionArea=sum(u),D=R.sub(total,unionArea);
 let P=R.zero,intersectingPairs=0;
 for(let i=0;i<polys.length;i++)for(let j=0;j<i;j++){
  if(separated(bounds(polys[i]),bounds(polys[j])))continue;
  const common=R.sub(area(polys[i]),sum(subtract(polys[i],polys[j],budget)));
  if(common.n<0n)throw Error('negative exact pair area');P=R.add(P,common);if(common.n)intersectingPairs++;
 }
 const excess=R.sub(P,D);if(D.n<0n||excess.n<0n)throw Error('inconsistent exact multiplicity accounting');
 return{sumAreaExactMM2:R.str(total),unionAreaExactMM2:R.str(unionArea),commandedDuplicateAreaExactMM2:R.str(D),
  pairIntersectionSumExactMM2:R.str(P),pairMinusDuplicateExactMM2:R.str(excess),positiveTripleCoverage:excess.n>0n,
  intersectingPairs,unionFragments:u.length,work:budget.work,commanded2DMultiplicityCertified:true,
  physicalFlowOrVolumeCertified:false,physicalDepositionMultiplicityCertified:false,
  method:'exact convex polygon subtraction partition of union; D=sum areas-union area; P independently sums all pair intersections'};
}
function originalMaterialDifference(sourceCells,ribbons,{maxWork=1000000}={}){
 const budget=workBudget(maxWork),source=union(prepare(sourceCells),budget),output=prepare(ribbons),remaining=[];
 for(const cell of source){let rest=[cell];for(const q of output){rest=rest.flatMap(r=>separated(bounds(r),bounds(q))?[r]:subtract(r,q,budget));
  if(rest.length>4096)throw Error('bounded original material fragments');if(!rest.length)break;
 }remaining.push(...rest);}
 return{originalAreaExactMM2:R.str(sum(source)),missingOriginalAreaExactMM2:R.str(sum(remaining)),
  completeOriginalMaterialCovered:remaining.length===0,missingFragments:remaining.map(p=>p.map(v=>v.map(R.str))),
  work:budget.work,computationalError:false,approvedCADToPrescribedException:false,
  method:'unchanged original material cells minus all actual commanded ribbon polygons; zero tolerance'};
}
module.exports={commandedMultiplicity,originalMaterialDifference};
