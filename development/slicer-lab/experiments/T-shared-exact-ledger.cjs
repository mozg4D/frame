'use strict';
// One immutable exact geometry preparation for all coupled events. No tolerance,
// overlap credit, changed material plan or production worker/pool modification.
const R=require('../core/rational.cjs'),{hull,intersectConvexCells}=require('../core/trajectory-union-accuracy.cjs'),{dense}=require('./T-dense-input.cjs');
const key=p=>p.map(q=>q.join(',')).sort().join(';'),area=q=>q.length<3?R.zero:R.div(q.reduce((s,p,i)=>R.add(s,R.cross(p,q[(i+1)%q.length])),R.zero),R.rat(2n));
function upper(q){if(!q.n)return 0;const n=q.n,ns=Math.max(0,n.toString(2).length-53),ds=Math.max(0,q.d.toString(2).length-53),e=ns-ds;let v=(Number(n>>BigInt(ns))/Number(q.d>>BigInt(ds)))*2**Math.min(e,1023)*2**Math.max(e-1023,0);const b=new DataView(new ArrayBuffer(8));for(let i=0;i<8&&R.cmp(R.exact(v),q)<0;i++){b.setFloat64(0,v);b.setBigUint64(0,b.getBigUint64(0)+1n);v=b.getFloat64(0);}if(!Number.isFinite(v)||R.cmp(R.exact(v),q)<0)throw Error('shared exact charge upper bound unavailable');return v;}
function sharedExactLedger(final,W,events,{signal,maxWork=1000000}={}){
 dense(final,{min:1,max:1536,name:'final ledger polygons'});dense(events,{min:1,max:16,name:'coupled events'});if(!Number.isFinite(W)||W<=0||!Number.isSafeInteger(maxWork)||maxWork<1||maxWork>1000000)throw Error('bounded exact ledger budget required');
 const rows=final.map((p,id)=>{dense(p,{min:3,max:512,name:'ledger polygon'});p.forEach(q=>{dense(q,{min:2,max:2,name:'ledger point'});if(q.some(v=>!Number.isFinite(v)))throw Error('finite ledger point required');});return{id,key:key(p),poly:hull(p.map(q=>q.map(R.exact))),bounds:[Math.min(...p.map(q=>q[0])),Math.min(...p.map(q=>q[1])),Math.max(...p.map(q=>q[0])),Math.max(...p.map(q=>q[1]))],newMask:0,leftMask:0,rightMask:0};});
 const ids=q=>{dense(q,{max:1536,name:'event cell ids'});if(new Set(q).size!==q.length||q.some(i=>!Number.isSafeInteger(i)||i<0||i>=rows.length))throw Error('finite unique event cell ids required');return new Set(q);};
 const results=events.map((e,index)=>{if(e.mode==='foreign-only'){const left=ids(e.priorCellIds),right=ids(e.initialCellIds);if(!right.size||[...left].some(i=>right.has(i)))throw Error('disjoint prior/initial ownership required');for(const i of left)rows[i].leftMask|=1<<index;for(const i of right)rows[i].rightMask|=1<<index;return{foreignOnly:true,passed:false,total:R.zero,areas:[],commonOriginalRibbons:left.size,candidatePairs:0};}
  if(e.mode!==undefined)throw Error('unknown coupled ledger mode');dense(e.eventCellIds,{min:1,max:1536,name:'event cell ids'});const excluded=ids(e.eventCellIds);
  const slots=new Map();for(const q of rows)if(!excluded.has(q.id))slots.set(q.key,(slots.get(q.key)??0)+1);let common=0;
  for(const q of rows){const n=slots.get(q.key)??0;if(n){slots.set(q.key,n-1);common++;}else q.newMask|=1<<index;}
  return{passed:false,total:R.zero,areas:[],commonOriginalRibbons:common,candidatePairs:0};});
 const ordered=rows.slice().sort((a,b)=>a.bounds[0]-b.bounds[0]||a.id-b.id),active=[],pairs=[],budget={work:0,maxWork};
 for(const q of ordered){if(signal?.aborted)throw Error('shared exact ledger cancelled');for(let k=active.length-1;k>=0;k--)if(active[k].bounds[2]<=q.bounds[0])active.splice(k,1);
  for(const p of active){const mask=q.newMask|p.newMask|(q.leftMask&p.rightMask)|(q.rightMask&p.leftMask);if(!mask||p.bounds[3]<=q.bounds[1]||q.bounds[3]<=p.bounds[1])continue;const i=Math.max(q.id,p.id),j=Math.min(q.id,p.id);pairs.push({i,j,mask});}active.push(q);}
 pairs.sort((a,b)=>a.i-b.i||a.j-b.j);
 for(const {i,j,mask} of pairs){if(signal?.aborted)throw Error('shared exact ledger cancelled');const poly=intersectConvexCells(rows[i].poly,rows[j].poly,budget),value=area(poly);if(value.n<0n)throw Error('invalid exact ledger orientation');const retained=value.n?upper(value):0;
  for(let e=0;e<results.length;e++)if(mask&(1<<e)){const r=results[e];r.candidatePairs++;if(value.n){r.total=R.add(r.total,R.exact(retained));r.areas.push({first:i,second:j,exactAreaMM2:R.str(value),upperAreaMM2:retained});}}}
 const limit=R.mul(R.mul(R.exact(W),R.exact(W)),R.rat(1n,2n));return{sharedExactWork:budget.work,preparedPolygons:rows.length,sharedCandidatePairs:pairs.length,
  events:results.map(r=>({passed:r.foreignOnly?r.total.n===0n:R.cmp(r.total,limit)<=0,foreignOnly:!!r.foreignOnly,exactChargeUpperBoundMM2:R.str(r.total),chargeUpperBoundMM2:upper(r.total),exactLimitMM2:R.str(r.foreignOnly?R.zero:limit),
   commonOriginalRibbons:r.commonOriginalRibbons,chargedPairs:r.areas.length,candidatePairs:r.candidatePairs,areas:r.areas,sharedExactWork:budget.work,
   method:'all-final identity-common cancellation once; exact shared intersections; no removed-overlap credit',scope:'same unchanged coupled W^2/2 ceiling and complete final polygons'}))};
}
module.exports={sharedExactLedger};
