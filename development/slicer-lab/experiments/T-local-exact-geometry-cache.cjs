'use strict';
// Bounded PURE exact local arithmetic cache. It stores no source acceptance,
// material target, event owner, contour program, triangle binding or replay.
// Actual polygons are keyed after exact translation and positive W scaling.
const R=require('../core/rational.cjs'),{hull,intersectConvexCells}=require('../core/trajectory-union-accuracy.cjs'),owned=new WeakMap();
const area=q=>q.length<3?R.zero:R.div(q.reduce((s,p,i)=>R.add(s,R.cross(p,q[(i+1)%q.length])),R.zero),R.rat(2n)),pointKey=p=>p.map(R.str).join(','),frozenRat=q=>Object.freeze({n:q.n,d:q.d});
function createExactLocalGeometryCache({maxShapes=2048,maxPairs=1024,maxNumbers=16384,maxBytes=8*1024*1024}={}){
 if(![maxShapes,maxPairs,maxNumbers,maxBytes].every(Number.isSafeInteger)||maxShapes<1||maxShapes>4096||maxPairs<1||maxPairs>4096||maxNumbers<1||maxNumbers>16384||maxBytes<1024||maxBytes>16*1024*1024)throw Error('bounded local exact cache capacity required');
 const state={shapes:new Map(),pairs:new Map(),distances:new Map(),numbers:new Map(),maxShapes,maxPairs,maxNumbers,maxBytes,bytes:0,numberHits:0,numberMisses:0,shapeHits:0,shapeMisses:0,pairHits:0,pairMisses:0,distanceHits:0,distanceMisses:0,computedClipWork:0,reusedLogicalClipWork:0,evictions:0};
 const cache=Object.freeze({stats(){const s=owned.get(cache);return Object.freeze({numberHits:s.numberHits,numberMisses:s.numberMisses,shapeHits:s.shapeHits,shapeMisses:s.shapeMisses,pairHits:s.pairHits,pairMisses:s.pairMisses,distanceHits:s.distanceHits,distanceMisses:s.distanceMisses,computedClipWork:s.computedClipWork,reusedLogicalClipWork:s.reusedLogicalClipWork,shapes:s.shapes.size,pairs:s.pairs.size,distances:s.distances.size,numbers:s.numbers.size,storedKeyAndValueBytes:s.bytes,accountedRetainedBytes:s.bytes,maxBytes:s.maxBytes,evictions:s.evictions,accounting:'all maps including number rationals; UTF-16 keys, bigint limbs, array slots and 512-byte per-entry object/map allowance; not process RSS',fullContourOrAcceptanceStored:false});}});owned.set(cache,state);return cache;
}
function state(cache){const s=owned.get(cache);if(!s)throw Error('owned exact local geometry cache required');return s;}
const bigintBytes=q=>16+8*Math.ceil(q.toString(2).replace('-','').length/64),ratBytes=q=>64+bigintBytes(q.n)+bigintBytes(q.d);
function put(s,map,key,value,limit){const bytes=512+(typeof key==='number'?8:key.length*2)+(value.indices?.length??0)*16+(value.normalizedArea?ratBytes(value.normalizedArea):0)+(value.bound?ratBytes(value.bound):0)+(value.rational?ratBytes(value.rational):0);if(bytes>s.maxBytes||typeof key==='string'&&key.length>16384)return;
 while(map.size>=limit){const first=map.keys().next().value;s.bytes-=map.get(first).bytes;map.delete(first);s.evictions++;}
 while(s.bytes+bytes>s.maxBytes){const victim=[s.shapes,s.pairs,s.distances,s.numbers].find(m=>m.size),first=victim?.keys().next().value;if(first===undefined)throw Error('local cache accounting invariant');s.bytes-=victim.get(first).bytes;victim.delete(first);s.evictions++;}
 map.set(key,Object.freeze({...value,bytes}));s.bytes+=bytes;
}
function cachedExactNumber(cache,x){if(!cache)return R.exact(x);const s=state(cache),entry=s.numbers.get(x);if(entry){s.numberHits++;return entry.rational;}s.numberMisses++;const q=frozenRat(R.exact(x));put(s,s.numbers,x,{rational:q},s.maxNumbers);return q;}
function cachedHull(cache,parsed,W){if(!cache)return hull(parsed);const s=state(cache),w=cachedExactNumber(cache,W),origin=parsed[0],normalized=parsed.map(p=>p.map((v,k)=>R.div(R.sub(v,origin[k]),w))),key=normalized.map(pointKey).join(';');let entry=s.shapes.get(key);
 if(entry){s.shapeHits++;return entry.indices.map(i=>parsed[i]);}s.shapeMisses++;
 const poly=hull(normalized),positions=new Map(normalized.map((p,i)=>[pointKey(p),i])),indices=poly.map(p=>positions.get(pointKey(p)));if(indices.some(i=>i===undefined))throw Error('exact local hull index missing');put(s,s.shapes,key,{indices:Object.freeze(indices)},s.maxShapes);return indices.map(i=>parsed[i]);
}
function cachedIntersectionArea(cache,a,b,W,budget){if(!cache)return area(intersectConvexCells(a,b,budget));const s=state(cache);
 // Preserve the native representation guard on BOTH hits and misses. Every
 // convex-clip intermediate vertex is an original point or an intersection
 // of two ORIGINAL support lines. Input numerator/denominator <=B bits gives
 // homogeneous points <=2B, lines <=4B+1 and intersections <=8B+3 bits;
 // sign allowance makes <=8B+4. At B<=127 all native point guards fit 1024.
 // Outside this sufficient domain use the ORIGINAL guarded clip, not a hit.
 // This also preserves rejection/order for work and intermediate-point limits.
 if(a.concat(b).some(p=>p.some(q=>q.n.toString(2).length>127||q.d.toString(2).length>127)))return area(intersectConvexCells(a,b,budget));
 const w=cachedExactNumber(cache,W),w2=R.mul(w,w),origin=a[0],normalized=p=>p.map(q=>q.map((v,k)=>R.div(R.sub(v,origin[k]),w))).map(pointKey).join(';'),key=normalized(a)+'|'+normalized(b),entry=s.pairs.get(key);
 if(entry){s.pairHits++;budget.work+=entry.work;if(budget.work>budget.maxWork)throw Error('union accuracy work budget');s.reusedLogicalClipWork+=entry.work;return R.mul(entry.normalizedArea,w2);}
 s.pairMisses++;const before=budget.work,value=area(intersectConvexCells(a,b,budget)),work=budget.work-before;s.computedClipWork+=work;if(value.n<0n)throw Error('invalid exact local area orientation');put(s,s.pairs,key,{normalizedArea:frozenRat(R.div(value,w2)),work},s.maxPairs);return value;
}
function convexBound(ref,actual,threshold){const abs=q=>q.n<0n?R.sub(R.zero,q):q,min=(a,b)=>R.cmp(a,b)<0?a:b,max=(a,b)=>R.cmp(a,b)>0?a:b;let error=R.zero;
 // A convex-combination witness covers EVERY point of the complete reference
 // polygon. Any same-index target vertices are valid witnesses; their order
 // need not match. Use this conservative upper bound only while it is tiny.
 // Otherwise retain the nearest-vertex / exact-edge construction below.
 if(ref.length===actual.length){for(let i=0;i<ref.length;i++)error=max(error,ref[i].reduce((s,v,k)=>R.add(s,abs(R.sub(v,actual[i][k]))),R.zero));if(R.cmp(error,threshold)<=0)return error;error=R.zero;}
 for(const p of ref){let best=null;for(const q of actual){const d=p.reduce((s,v,k)=>R.add(s,abs(R.sub(v,q[k]))),R.zero);best=best?min(best,d):d;}if(best===null)throw Error('missing exact convex target');error=max(error,best);}if(R.cmp(error,threshold)<=0)return error;
 const poly=hull(actual);error=R.zero;for(const p of ref){if(poly.length>=3&&poly.every((a,i)=>R.cross(R.vec(poly[(i+1)%poly.length],a),R.vec(p,a)).n>=0n))continue;let nearest=null;for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],d=R.vec(b,a),length=R.dot(d,d),t=length.n?max(R.zero,min(R.one,R.div(R.dot(R.vec(p,a),d),length))):R.zero,q=a.map((v,k)=>R.add(v,R.mul(t,d[k]))),distance=p.reduce((s,v,k)=>R.add(s,abs(R.sub(v,q[k]))),R.zero);nearest=nearest?min(nearest,distance):distance;}if(nearest===null)throw Error('empty convex projection');error=max(error,nearest);}return error;
}
function cachedConvexDirectedBound(cache,ref,actual,W){const w=R.exact(W);if(!cache)return convexBound(ref,actual,R.div(w,R.rat(10000n)));const s=state(cache),origin=ref[0],normalized=p=>p.map(q=>q.map((v,k)=>R.div(R.sub(v,origin[k]),w))),a=normalized(ref),b=normalized(actual),key=a.map(pointKey).join(';')+'|'+b.map(pointKey).join(';'),entry=s.distances.get(key);if(entry){s.distanceHits++;return R.mul(entry.bound,w);}s.distanceMisses++;const value=convexBound(a,b,R.rat(1n,10000n));put(s,s.distances,key,{bound:frozenRat(value)},2048);return R.mul(value,w);}
function assertExactLocalGeometryCache(cache){state(cache);return true;}
module.exports={createExactLocalGeometryCache,cachedExactNumber,cachedHull,cachedIntersectionArea,cachedConvexDirectedBound,assertExactLocalGeometryCache};
