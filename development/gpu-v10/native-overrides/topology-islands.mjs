/**
 * Topology-only connected components. Authoring arrays are never welded or changed.
 * Logical grouping is the pinned Frame rule Math.round(x * 1e5); faces connect by
 * shared logical edges, vertices/edges by shared logical vertices. No camera/depth.
 */
const abort = () => new DOMException('Topology request cancelled', 'AbortError');
const checkCount = (n, label) => {
  if (!Number.isSafeInteger(n) || n < 0 || n > 0x3ffffff) throw Error(`${label} is outside supported topology limits`);
};
export function topologyStamp(geometry) {
  const p = geometry?.attributes?.position, ix = geometry?.index;
  if (!p || p.itemSize !== 3) throw Error('A position attribute with three components is required');
  const attribute = a => a && [a, a.array ?? a.data?.array, a.version ?? a.data?.version, a.count, a.itemSize, a.normalized, a.data, a.offset, a.data?.stride];
  const position = attribute(p), index = attribute(ix);
  const same = (a, stamp) => !stamp ? !a : !!a && attribute(a).every((v, i) => Object.is(v, stamp[i]));
  return {geometry, position, index, isCurrent: () => geometry.attributes.position === p && geometry.index === ix && same(p, position) && same(ix, index)};
}
/** Capture a private transfer snapshot in bounded batches, including Float64 sources. */
export async function captureTopology(geometry, {yieldTask = () => new Promise(r => setTimeout(r, 0)), signal, batch = 4096} = {}) {
  if (!Number.isSafeInteger(batch) || batch < 1) throw Error('Invalid capture batch');
  const stamp = topologyStamp(geometry), p = geometry.attributes.position, ix = geometry.index;
  checkCount(p.count, 'Vertex count');
  const positions = new Float64Array(p.count * 3), indices = ix ? new Uint32Array(ix.count) : null;
  const check = () => { if (signal?.aborted || !stamp.isCurrent()) throw abort(); };
  check();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (![x, y, z].every(Number.isFinite)) throw Error('Nonfinite topology coordinate');
    positions.set([x, y, z], i * 3);
    if ((i + 1) % batch === 0) { await yieldTask(); check(); }
  }
  if (ix) {
    if (ix.itemSize !== 1) throw Error('Scalar topology index required');
    for (let i = 0; i < ix.count; i++) {
      const v = ix.getX(i);
      if (!Number.isSafeInteger(v) || v < 0 || v >= p.count) throw Error('Index outside topology positions');
      indices[i] = v;
      if ((i + 1) % batch === 0) { await yieldTask(); check(); }
    }
  }
  check();
  return {stamp, input: {positions, indices}, transfer: [positions.buffer, ...(indices ? [indices.buffer] : [])]};
}
function* csrFromLabels(labels, componentCount, batch) {
  const offsets = new Uint32Array(componentCount + 1);
  for (let i = 0; i < labels.length; i++) { offsets[labels[i] + 1]++; if ((i + 1) % batch === 0) yield; }
  for (let i = 1; i < offsets.length; i++) { offsets[i] += offsets[i - 1]; if (i % batch === 0) yield; }
  const cursor = offsets.slice(), members = new Uint32Array(labels.length);
  for (let i = 0; i < labels.length; i++) { members[cursor[labels[i]]++] = i; if ((i + 1) % batch === 0) yield; }
  return {offsets, members};
}
// Worker credit may stop between copies and rehash rows, including table growth.
function* topologyCopyWork(source,target,count,batch){for(let start=0;start<count;start+=batch){const end=Math.min(count,start+batch);target.set(source.subarray(start,end),start);yield;}}
function* topologySliceWork(source,count,batch){const target=new source.constructor(count);yield;yield* topologyCopyWork(source,target,count,batch);return target;}
// Exact worker-local numeric tables. IDs retain first encounter order.
class topologyPackedPairTable {
  constructor(pairs=false,capacity=8){const n=2**Math.ceil(Math.log2(Math.max(8,capacity)));this.slots=new Uint32Array(n*2);this.keys=new Float64Array(n);this.values=pairs?null:new Uint32Array(n);this.pairs=pairs?new Uint32Array(n*2):null;this.size=0;this.fresh=false;}
  hash(key){return(Math.imul(key,73856093)^Math.imul(Math.floor(key/4294967296),19349663))>>>0;}
  *growWork(batch){const slots=new Uint32Array(this.slots.length*2),keys=new Float64Array(this.keys.length*2);yield;yield* topologyCopyWork(this.keys,keys,this.size,batch);if(this.values){const a=new Uint32Array(this.values.length*2);yield;yield* topologyCopyWork(this.values,a,this.size,batch);this.values=a;}if(this.pairs){const a=new Uint32Array(this.pairs.length*2);yield;yield* topologyCopyWork(this.pairs,a,this.size*2,batch);this.pairs=a;}for(let id=0;id<this.size;id++){let s=this.hash(keys[id])&(slots.length-1);while(slots[s])s=(s+1)&(slots.length-1);slots[s]=id+1;if((id+1)%batch===0)yield;}this.slots=slots;this.keys=keys;}
  grow(){throw Error('Packed table growth requires a worker continuation credit');}
  find(key){let s=this.hash(key)&(this.slots.length-1);while(this.slots[s]){const id=this.slots[s]-1;if(this.keys[id]===key)return id;s=(s+1)&(this.slots.length-1);}return-1;}
  intern(key,value){if((this.size+1)*2>this.slots.length)this.grow();let s=this.hash(key)&(this.slots.length-1);while(this.slots[s]){const id=this.slots[s]-1;if(this.keys[id]===key){this.fresh=false;return id;}s=(s+1)&(this.slots.length-1);}const id=this.size++;this.slots[s]=id+1;this.keys[id]=key;if(this.values)this.values[id]=value;this.fresh=true;return id;}
  clear(){this.slots=this.keys=this.values=this.pairs=null;}
}
class topologyPackedEdgeTable extends topologyPackedPairTable {
  constructor(capacity){super(false,capacity);const n=this.keys.length;this.rawIds=new Uint32Array(n);this.rawKeys=new Float64Array(n);this.rawPairs=new Uint32Array(n*2);this.rawCount=0;}
  *growWork(batch){const oldSize=this.size,oldCount=this.rawCount;yield* super.growWork(batch);const n=this.keys.length;for(const name of ['rawIds','rawKeys','rawPairs']){const old=this[name],a=new old.constructor(name==='rawPairs'?n*2:n);yield;yield* topologyCopyWork(old,a,name==='rawIds'?oldSize:name==='rawPairs'?oldCount*2:oldCount,batch);this[name]=a;}}
  edge(id,key,a,b){if(this.rawIds[id])return;const e=this.rawCount++;this.rawIds[id]=e+1;this.rawKeys[e]=key;this.rawPairs[e*2]=Math.min(a,b);this.rawPairs[e*2+1]=Math.max(a,b);}
  clear(){super.clear();this.rawIds=this.rawKeys=this.rawPairs=null;}
}
function* topologyPackedSortedEdges(table,batch){
  const n=table.rawCount,keys=table.rawKeys,counts=new Uint32Array(65536);let order=new Uint32Array(n),scratch=new Uint32Array(n);
  for(let i=0;i<n;i++){order[i]=i;if((i+1)%batch===0)yield;}
  // Exact integer pair keys have at most 52 bits. Four stable 16-bit passes
  // retain the original unique-key order, including values above Uint32 range.
  for(let pass=0;pass<4;pass++){
    counts.fill(0);const digit=k=>pass===0?(k>>>0)&65535:pass===1?k>>>16:pass===2?Math.floor(k/4294967296)&65535:Math.floor(k/281474976710656);
    for(let i=0;i<n;i++){counts[digit(keys[order[i]])]++;if((i+1)%batch===0)yield;}
    let sum=0;for(let d=0;d<counts.length;d++){const c=counts[d];counts[d]=sum;sum+=c;if((d+1)%batch===0)yield;}
    for(let i=0;i<n;i++){const id=order[i];scratch[counts[digit(keys[id])]++]=id;if((i+1)%batch===0)yield;}
    const swap=order;order=scratch;scratch=swap;
  }
  const sortedEdgeKeys=new Float64Array(n);for(let i=0;i<n;i++){sortedEdgeKeys[i]=keys[order[i]];if((i+1)%batch===0)yield;}
  return{sortedEdgeKeys,edgeOrder:order};
}
class topologyPackedTripleTable {
  constructor(){this.slots=new Uint32Array(16);this.keys=new Float64Array(24);this.representatives=new Uint32Array(8);this.size=0;}
  hash(x,y,z){return(Math.imul(x,73856093)^Math.imul(y,19349663)^Math.imul(z,83492791))>>>0;}
  *growWork(batch){const slots=new Uint32Array(this.slots.length*2),keys=new Float64Array(this.keys.length*2),reps=new Uint32Array(this.representatives.length*2);yield;yield* topologyCopyWork(this.keys,keys,this.size*3,batch);yield* topologyCopyWork(this.representatives,reps,this.size,batch);for(let id=0;id<this.size;id++){const o=id*3;let s=this.hash(keys[o],keys[o+1],keys[o+2])&(slots.length-1);while(slots[s])s=(s+1)&(slots.length-1);slots[s]=id+1;if((id+1)%batch===0)yield;}this.slots=slots;this.keys=keys;this.representatives=reps;}
  grow(){throw Error('Packed alias growth requires a worker continuation credit');}
  intern(x,y,z,vertex){if((this.size+1)*2>this.slots.length)this.grow();let s=this.hash(x,y,z)&(this.slots.length-1);while(this.slots[s]){const id=this.slots[s]-1,o=id*3;if(this.keys[o]===x&&this.keys[o+1]===y&&this.keys[o+2]===z)return this.representatives[id];s=(s+1)&(this.slots.length-1);}const id=this.size++,o=id*3;this.slots[s]=id+1;this.keys[o]=x;this.keys[o+1]=y;this.keys[o+2]=z;this.representatives[id]=vertex;return vertex;}
  clear(){this.slots=this.keys=this.representatives=null;}
}

/** Generator so BOTH the worker and tests execute identical bounded units. */
export function* buildTopologyWork({positions, indices = null}, {batch = 2048, packedTables = false} = {}) {
  if (!(positions instanceof Float64Array || positions instanceof Float32Array) || positions.length % 3) throw Error('Packed floating xyz required');
  if (indices !== null && !(indices instanceof Uint32Array || indices instanceof Uint16Array)) throw Error('Unsigned index required');
  if (!Number.isSafeInteger(batch) || batch < 1) throw Error('Invalid topology batch');
  const n = positions.length / 3, nf = Math.floor((indices?.length ?? n) / 3);
  checkCount(n, 'Vertex count'); checkCount(nf, 'Face count');
  // n*n < 2^52, so raw/logical pair keys below are exact integers, not hash guesses.
  const pair = (a, b) => Math.min(a, b) * n + Math.max(a, b);
  const group = new Uint32Array(n), vp = new Uint32Array(n), vr = new Uint8Array(n);
  const fp = new Uint32Array(nf), fr = new Uint8Array(nf);
  let aliases = new Map(), triples = packedTables ? new topologyPackedTripleTable() : null;
  for (let i = 0; i < n; i++) {
    const x = positions[3 * i], y = positions[3 * i + 1], z = positions[3 * i + 2];
    if (![x, y, z].every(Number.isFinite)) throw Error('Nonfinite topology coordinate');
    const qx=Math.round(x*1e5),qy=Math.round(y*1e5),qz=Math.round(z*1e5);
    let g;
    if(triples && Number.isSafeInteger(qx) && Number.isSafeInteger(qy) && Number.isSafeInteger(qz)) {if((triples.size+1)*2>triples.slots.length)yield* triples.growWork(batch);g=triples.intern(qx,qy,qz,i);}
    else {
      // Preserve the original Number-to-string rule for finite coordinates whose
      // quantized values exceed exact integer range (including overflow).
      if(triples){for(let k=0;k<triples.size;k++){const o=k*3;aliases.set(`${triples.keys[o]},${triples.keys[o+1]},${triples.keys[o+2]}`,triples.representatives[k]);if((k+1)%batch===0)yield;}triples.clear();triples=null;}
      const key=`${qx},${qy},${qz}`;g=aliases.get(key);if(g===undefined){g=i;aliases.set(key,i);}
    }
    group[i] = g; vp[i] = i;
    if ((i + 1) % batch === 0) yield;
  }
  aliases.clear();triples?.clear();triples=null;
  for (let i = 0; i < nf; i++) { fp[i] = i; if ((i + 1) % batch === 0) yield; }
  if (indices) for (let i = 0; i < indices.length; i++) { if (indices[i] >= n) throw Error('Index outside topology positions'); if ((i + 1) % batch === 0) yield; }
  const root = (p, i) => { while (p[i] !== i) { p[i] = p[p[i]]; i = p[i]; } return i; };
  const join = (p, r, a, b) => { a = root(p, a); b = root(p, b); if (a === b) return; if (r[a] < r[b]) p[a] = b; else { p[b] = a; if (r[a] === r[b]) r[a]++; } };
  const incident=packedTables?null:new Map(),edgeIds=packedTables?new topologyPackedEdgeTable(Math.min(3*nf,3*n,4194304)):new Map(),edgeList=[];
  if(packedTables){
    const faceBatch=Math.max(1,Math.floor(batch/3));
    for(let f=0;f<nf;f++){
      const o=f*3,a=indices?indices[o]:o,b=indices?indices[o+1]:o+1,c=indices?indices[o+2]:o+2,ga=group[a],gb=group[b],gc=group[c];
      join(vp,vr,ga,gb);join(vp,vr,gb,gc);
      for(let j=0;j<3;j++){
        const ra=j===0?a:j===1?b:c,rb=j===0?b:j===1?c:a,la=j===0?ga:j===1?gb:gc,lb=j===0?gb:j===1?gc:ga;
        const logicalKey=pair(la,lb),rawKey=pair(ra,rb);if((edgeIds.size+1)*2>edgeIds.slots.length)yield* edgeIds.growWork(batch);const owner=edgeIds.intern(logicalKey,0),oldFace=edgeIds.values[owner];if(oldFace)join(fp,fr,f,oldFace-1);else edgeIds.values[owner]=f+1;
        if(logicalKey!==rawKey&&(edgeIds.size+1)*2>edgeIds.slots.length)yield* edgeIds.growWork(batch);const edge=logicalKey===rawKey?owner:edgeIds.intern(rawKey,0);edgeIds.edge(edge,rawKey,ra,rb);
      }
      if((f+1)%faceBatch===0)yield;
    }
  }else{
  for (let f = 0; f < nf; f++) {
    const raw = [0, 1, 2].map(j => indices ? indices[f * 3 + j] : f * 3 + j), logical = raw.map(v => group[v]);
    join(vp, vr, logical[0], logical[1]); join(vp, vr, logical[1], logical[2]);
    for (let j = 0; j < 3; j++) {
      const k = (j + 1) % 3, logicalKey = pair(logical[j], logical[k]), oldFace = incident.get(logicalKey);
      if (oldFace === undefined) incident.set(logicalKey, f); else join(fp, fr, f, oldFace);
      const key = pair(raw[j], raw[k]);
      if (!edgeIds.has(key)) { edgeIds.set(key, edgeList.length / 2); edgeList.push(Math.min(raw[j], raw[k]), Math.max(raw[j], raw[k])); }
    }
    if ((f + 1) % Math.max(1, Math.floor(batch / 3)) === 0) yield;
  }
  }
  incident?.clear();
  const vertexLabels = new Uint32Array(n), faceLabels = new Uint32Array(nf), vRoots = new Map(), fRoots = new Map();
  const compact = (map, key) => { let v = map.get(key); if (v === undefined) { v = map.size; map.set(key, v); } return v; };
  for (let i = 0; i < n; i++) { vertexLabels[i] = compact(vRoots, root(vp, group[i])); if ((i + 1) % batch === 0) yield; }
  for (let i = 0; i < nf; i++) { faceLabels[i] = compact(fRoots, root(fp, i)); if ((i + 1) % batch === 0) yield; }
  const edges = packedTables?yield* topologySliceWork(edgeIds.rawPairs,edgeIds.rawCount*2,batch):Uint32Array.from(edgeList), edgeLabels = new Uint32Array(edges.length / 2);
  for (let i = 0; i < edgeLabels.length; i++) { edgeLabels[i] = vertexLabels[edges[i * 2]]; if ((i + 1) % batch === 0) yield; }
  let edgeOrder,sortedEdgeKeys;
  if(packedTables){
    ({sortedEdgeKeys,edgeOrder}=yield* topologyPackedSortedEdges(edgeIds,batch));
    edgeIds.clear();
  }else{
  const edgeLookup = new Float64Array(edgeLabels.length);edgeOrder=new Uint32Array(edgeLabels.length);
  for (let i=0;i<edgeLabels.length;i++) { edgeLookup[i]=pair(edges[i*2],edges[i*2+1]);edgeOrder[i]=i;if((i+1)%batch===0)yield; }
  // Native typed-array sort runs inside the background worker, not a UI pointer handler.
  edgeOrder.sort((a,b)=>edgeLookup[a]-edgeLookup[b]);
  sortedEdgeKeys=new Float64Array(edgeLabels.length);
  for(let i=0;i<edgeLabels.length;i++){sortedEdgeKeys[i]=edgeLookup[edgeOrder[i]];if((i+1)%batch===0)yield;}
  }
  const vertices = yield* csrFromLabels(vertexLabels, vRoots.size, batch);
  const faces = yield* csrFromLabels(faceLabels, fRoots.size, batch);
  const edgeComponents = yield* csrFromLabels(edgeLabels, vRoots.size, batch);
  // GPU marquee tables are derived once in this worker, not in a pointer handler.
  const representativesList=packedTables?new Uint32Array(n):[],vertexGroups=new Uint32Array(n);let representativeCount=0;
  for(let i=0;i<n;i++){if(group[i]===i){vertexGroups[i]=representativeCount++;if(packedTables)representativesList[vertexGroups[i]]=i;else representativesList.push(i);}else vertexGroups[i]=vertexGroups[group[i]];if((i+1)%batch===0)yield;}
  const representatives=packedTables?yield* topologySliceWork(representativesList,representativeCount,batch):Uint32Array.from(representativesList),faceOffsets=new Uint32Array(nf+1),faceCorners=new Uint32Array(nf*3),edgeOffsets=new Uint32Array(edgeLabels.length+1),edgeCorners=new Uint32Array(edges.length);
  for(let i=0;i<nf;i++){faceOffsets[i]=i*3;for(let j=0;j<3;j++)faceCorners[i*3+j]=vertexGroups[indices?indices[i*3+j]:i*3+j];if((i+1)%batch===0)yield;}faceOffsets[nf]=nf*3;
  for(let i=0;i<edgeLabels.length;i++){edgeOffsets[i]=i*2;edgeCorners[i*2]=vertexGroups[edges[i*2]];edgeCorners[i*2+1]=vertexGroups[edges[i*2+1]];if((i+1)%batch===0)yield;}edgeOffsets[edgeLabels.length]=edges.length;
  const vertexAliases=yield* csrFromLabels(vertexGroups,representatives.length,batch);
  const selection={representatives,vertexGroups,vertexAliases,faces:{offsets:faceOffsets,indices:faceCorners},edges:{offsets:edgeOffsets,indices:edgeCorners}};
  return {selection,vertexCount: n, faceCount: nf, edgeCount: edgeLabels.length, vertexComponentCount: vRoots.size, faceComponentCount: fRoots.size,
    group, vertexLabels, faceLabels, edgeLabels, edges, sortedEdgeKeys, edgeOrder, vertices, faces, edgeComponents};
}
export function topologyTransfer(result) {
  const buffers=new Set();const visit=x=>{if(ArrayBuffer.isView(x)){buffers.add(x.buffer);return;}if(x&&typeof x==='object')for(const v of Object.values(x))visit(v);};visit(result);return [...buffers];
}
/** Query is output-sensitive and can yield while materialising very large results. */
export function* connectedMaskWork(topology, domain, seedIds, {batch = 4096} = {}) {
  const fields = domain === 'vertex' ? [topology.vertexLabels, topology.vertices] : domain === 'edge' ? [topology.edgeLabels, topology.edgeComponents] : domain === 'face' ? [topology.faceLabels, topology.faces] : null;
  if (!fields) throw Error('Unknown connected domain');
  // Materialise arbitrary iterables cooperatively; do not synchronously clone a million seeds.
  if(!Array.isArray(seedIds)&&!ArrayBuffer.isView(seedIds)){const copy=[];let copied=0;for(const id of seedIds){copy.push(id);if(++copied%batch===0)yield;}seedIds=copy;}
  const [labels, csr] = fields, components = new Set();
  let k = 0;
  for (const id of seedIds) { if (Number.isInteger(id) && id >= 0 && id < labels.length) components.add(labels[id]); if (++k % batch === 0) yield; }
  let size = 0; for (const c of components) size += csr.offsets[c + 1] - csr.offsets[c];
  const ids = new Uint32Array(size), seeds=new Set(); k = 0;
  let seedWork=0;for(const id of seedIds){if(Number.isInteger(id)&&id>=0&&id<labels.length&&!seeds.has(id)){seeds.add(id);ids[k++]=id;}if(++seedWork%batch===0)yield;}
  // Merge sorted component members, preserving the existing valid seed order first.
  const heap=[];
  const push=node=>{let i=heap.length;heap.push(node);while(i){const parent=(i-1)>>>1;if(heap[parent].value<=node.value)break;heap[i]=heap[parent];i=parent;}heap[i]=node;};
  const pop=()=>{const first=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let child=i*2+1;if(child+1<heap.length&&heap[child+1].value<heap[child].value)child++;if(heap[child].value>=last.value)break;heap[i]=heap[child];i=child;}heap[i]=last;}return first;};
  for(const c of components){const j=csr.offsets[c],end=csr.offsets[c+1];if(j<end)push({j,end,value:csr.members[j]});}
  let work=0;while(heap.length){const n=pop();if(!seeds.has(n.value))ids[k++]=n.value;n.j++;if(n.j<n.end){n.value=csr.members[n.j];push(n);}if(++work%batch===0)yield;}
  return {domain, ids, components: Uint32Array.from(components), total: labels.length};
}
export function edgeIdFromRaw(topology,a,b){
  if(!Number.isInteger(a)||!Number.isInteger(b)||a<0||b<0||a>=topology.vertexCount||b>=topology.vertexCount)return -1;
  const key=Math.min(a,b)*topology.vertexCount+Math.max(a,b),keys=topology.sortedEdgeKeys;let lo=0,hi=keys.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(keys[mid]<key)lo=mid+1;else hi=mid;}
  return lo<keys.length&&keys[lo]===key?topology.edgeOrder[lo]:-1;
}

export async function drainCooperatively(work, {signal, isCurrent = () => true, sliceMs = 3, yieldTask = () => new Promise(r => setTimeout(r, 4))} = {}) {
  if (!(sliceMs > 0 && sliceMs <= 16)) throw Error('Invalid cooperative budget');
  for (;;) {
    if (signal?.aborted || !isCurrent()) { work.return?.(); throw abort(); }
    const end = performance.now() + sliceMs;
    do { const s = work.next(); if (s.done) { if (signal?.aborted || !isCurrent()) throw abort(); return s.value; } } while (performance.now() < end);
    await yieldTask();
  }
}
