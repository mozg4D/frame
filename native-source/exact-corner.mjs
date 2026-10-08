/** Exact point visibility for native binary32 geometry/matrix inputs.
 * Linear transforms are evaluated as exact dyadics before final clip rounding.
 * All predicates use exact numbers, not sampled depth or an epsilon.
 * This is a proposed raw-geometry policy; display alpha/stencil are not modeled.
 */
const bits = new DataView(new ArrayBuffer(4));
const fail = m => { throw Error(m); };
export function f32Bits(v) { bits.setFloat32(0, v, true); return bits.getUint32(0, true); }
function floatBits(u) { bits.setUint32(0, u, true); return bits.getFloat32(0, true); }
export function nextF32(v, up = true) {
  if (Number.isNaN(v)) fail('NaN bound');
  if (v === (up ? Infinity : -Infinity)) return v;
  if (v === 0) return floatBits(up ? 1 : 0x80000001);
  let u = f32Bits(v); u = (u + ((v > 0) === up ? 1 : -1)) >>> 0;
  return floatBits(u);
}
function dyadic(v) {
  if (!Number.isFinite(v) || Math.fround(v) !== v) fail('Finite binary32 clip coordinate required');
  const u = f32Bits(v), e = (u >>> 23) & 255, f = u & 0x7fffff;
  return { n: BigInt(e ? f | 0x800000 : f) * (u >>> 31 ? -1n : 1n), e: e ? e - 150 : -149 };
}
function integers(values) {
  const d = values.map(dyadic), e = Math.min(...d.filter(x => x.n !== 0n).map(x => x.e), 0);
  return d.map(x => x.n << BigInt(x.e - e));
}
const exactVector=q=>q?.v?q:{v:integers(q),e:Math.min(...q.map(dyadic).filter(x=>x.n!==0n).map(x=>x.e),0)};
function commonVectors(points){
  const v=points.map(exactVector),e=Math.min(...v.map(p=>p.e));
  if(v.every(p=>p.e===e))return v.map(p=>p.v);
  return v.map(p=>p.v.map(n=>n<<BigInt(p.e-e)));
}
const component=(q,i)=>q?.v?q.v[i]:q[i];
const validClip=q=>{
 const [x,y,z,w]=q?.v??q;
 return w>0&&x>=-w&&x<=w&&y>=-w&&y<=w&&z>=0&&z<=w;
};
/** Exact mathematical mat4(binary32) * position(binary32). Source Float64
 * authoring arrays are neither converted nor mutated by this module. The packet
 * has already crossed the existing native Float32 upload boundary.
 */
export function exactProjectPacket(packet){
 const values=[...packet.positions,...packet.clipMatrices,1],cache=new Map(),d=values.map(v=>{let x=cache.get(v);if(x===undefined){x=dyadic(v);cache.set(v,x);}return x;});let e=0;for(const x of d)if(x.n!==0n)e=Math.min(e,x.e);
 const shifted=new Map(),ints=d.map(x=>{let n=shifted.get(x);if(n===undefined){n=x.n<<BigInt(x.e-e);shifted.set(x,n);}return n;}),vc=packet.positions.length/3,ic=packet.clipMatrices.length/16,unit=ints.at(-1),out=[];
 for(let instance=0;instance<ic;instance++)for(let vertex=0;vertex<vc;vertex++){
  const at=vertex*3,m=packet.positions.length+instance*16,v=[];
  for(let row=0;row<4;row++)v.push(ints[m+row]*ints[at]+ints[m+4+row]*ints[at+1]+ints[m+8+row]*ints[at+2]+ints[m+12+row]*unit);
  out.push({v,e:e*2});
 }return out;
}
const det = (a,b,c) => a[0]*(b[1]*c[3]-b[3]*c[1]) - a[1]*(b[0]*c[3]-b[3]*c[0]) + a[3]*(b[0]*c[1]-b[1]*c[0]);
const same = (a,b) => a.every((v,i) => v === b[i]);
const sign = n => n < 0n ? -1 : n > 0n ? 1 : 0;
/** Triangle covers the exact query ray AND intersects it in [near,corner).
 * Cramer's rule in homogeneous x,y,w avoids perspective division and clipping
 * interpolation. Nonnegative homogeneous barycentrics prove triangle membership.
 * Boundaries are closed: a true foreground edge blocks; exact contact does not.
 */
export function exactOccludes(q,a,b,c) {
  if (!validClip(q)) return false;
  // Exact equal dyadic tuples prove contact regardless of source identity.
  if(q?.v&&[a,b,c].some(p=>p?.v&&p.e===q.e&&p.v.every((n,i)=>n===q.v[i])))return false;
  // Only exact numeric vertex equality, never same object / welded proximity.
  const [Q,A,B,C]=commonVectors([q,a,b,c]);
  if ([A,B,C].some(p=>Q.every((n,i)=>n===p[i]))) return false;
  const D=det(A,B,C), s=sign(D); if (!s) return false;
  const ea=det(Q,B,C);if(sign(ea)&&sign(ea)!==s)return false;
  const eb=det(A,Q,C);if(sign(eb)&&sign(eb)!==s)return false;
  const ec=det(A,B,Q);if(sign(ec)&&sign(ec)!==s)return false;
  const N=ea*A[2]+eb*B[2]+ec*C[2];
  if (sign(N) && sign(N) !== s) return false; // hit before the near plane
  return sign(N-D*Q[2]) === -s; // strictly in front; no bias
}
function compareRatio(bound,numerator,denominator) {
  const [b,n,d,unit]=integers([bound,numerator,denominator,1]);
  return sign(b*d-n*unit);
}
/** Outward binary32 bounds, checked by integer cross multiplication. */
export function ratioBounds(n,d) {
  if(typeof n==='bigint'){
    if(!(d>0n))fail('Positive exact clip w required');
    if(n<=-d)return [-1,-1];if(n>=d)return [1,1];
    let lo=Math.fround(Number(n)/Number(d)),hi=lo;
    const cmp=b=>{const t=dyadic(b);return sign(t.e>=0?(t.n*d<<BigInt(t.e))-n:t.n*d-(n<<BigInt(-t.e)));};
    while(cmp(lo)>0)lo=nextF32(lo,false);while(cmp(hi)<0)hi=nextF32(hi,true);return [lo,hi];
  }
  if (!(d > 0) || !Number.isFinite(n)) fail('Positive finite clip w required');
  if (n <= -d) return [-1,-1]; if (n >= d) return [1,1];
  let lo=Math.fround(n/d), hi=lo;
  while (compareRatio(lo,n,d)>0) lo=nextF32(lo,false);
  while (compareRatio(hi,n,d)<0) hi=nextF32(hi,true);
  return [lo,hi];
}
export function pointBounds(q) {
  if (!validClip(q)) return null;
  const x=ratioBounds(component(q,0),component(q,3)),y=ratioBounds(component(q,1),component(q,3));return [x[0],y[0],x[1],y[1]];
}
function triangleBounds(a,b,c,projectionBounds) {
  // A near/eye-plane crossing may project outside the finite vertex bounds.
  if ([a,b,c].some(p=>!(component(p,3)>0))) return [-1,-1,1,1];
  const bounds=[a,b,c].map(p=>{
    let b=projectionBounds.get(p);
    if(b===undefined){
      const x=ratioBounds(component(p,0),component(p,3)),y=ratioBounds(component(p,1),component(p,3));
      b=[x[0],y[0],x[1],y[1]];projectionBounds.set(p,b);
    }
    return b;
  });
  return [Math.min(bounds[0][0],bounds[1][0],bounds[2][0]),Math.min(bounds[0][1],bounds[1][1],bounds[2][1]),Math.max(bounds[0][2],bounds[1][2],bounds[2][2]),Math.max(bounds[0][3],bounds[1][3],bounds[2][3])];
}
export const overlap=(a,b)=>a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];
/** WGSL may flush subnormal operands. GPU broadphase bounds must remain
 * conservative even then; this changes candidates only, never acceptance. */
export function gpuBounds(b) {
  const minNormal=2**-126;
  return b.map((v,i)=>v!==0&&Math.abs(v)<minNormal?(i<2?-minNormal:minNormal):v);
}
export const clipAt=(clips,i)=>Array.isArray(clips)?clips[i]:Array.from(clips.subarray(i*4,i*4+4));
/** Stackless preorder BVH. Bounds/meta GPU arrays share the CPU reference tree. */
export function buildCornerScene(captures,{leafSize=8}={}) {
  if(!Number.isInteger(leafSize)||leafSize<1)fail('Positive BVH leaf size required');
  const clips=[],triangles=[],bounds=[],projectionBounds=new WeakMap();let base=0;
  for(const {packet,clips:given} of captures){
    const captured=given??exactProjectPacket(packet);
    const vc=packet.positions.length/3,ic=packet.clipMatrices.length/16;
    if(Array.isArray(captured)?captured.length!==vc*ic:!(captured instanceof Float32Array)||captured.length!==vc*ic*4||Array.from(captured).some(v=>!Number.isFinite(v)))fail('Native clip capture mismatch/nonfinite');
    clips.push(captured);
    const index=packet.indices,total=index?.length??vc;
    // Raw authoring policy includes ALL triangles, independently of display ranges.
    if(total%3)fail('Complete raw triangles required');
    for(let instance=0;instance<ic;instance++)for(let j=0;j<total;j+=3){
      const t=[0,1,2].map(k=>base+instance*vc+(index?index[j+k]:j+k));
      triangles.push(t);bounds.push(triangleBounds(...t.map(i=>clipAt(captured,i-base)),projectionBounds));
    }
    base+=vc*ic;
  }
  const vertices=[];for(const c of clips)for(let i=0;i<(Array.isArray(c)?c.length:c.length/4);i++)vertices.push(clipAt(c,i));
  const order=[],nodes=[];
  function build(ids){
    const ni=nodes.length,b=[Infinity,Infinity,-Infinity,-Infinity];
    for(const id of ids){const t=bounds[id];b[0]=Math.min(b[0],t[0]);b[1]=Math.min(b[1],t[1]);b[2]=Math.max(b[2],t[2]);b[3]=Math.max(b[3],t[3]);}
    const node={bounds:b,first:0,count:0,escape:0};nodes.push(node);
    if(ids.length<=leafSize){node.first=order.length;node.count=ids.length;order.push(...ids);}
    else{const axis=b[2]-b[0]>=b[3]-b[1]?0:1;ids.sort((a,c)=>(bounds[a][axis]+bounds[a][axis+2])-(bounds[c][axis]+bounds[c][axis+2])||a-c);const m=ids.length>>1;build(ids.slice(0,m));build(ids.slice(m));}
    node.escape=nodes.length;return ni;
  }
  if(triangles.length)build(triangles.map((_,i)=>i));
  const nodeBounds=new Float32Array(nodes.length*4),nodeMeta=new Uint32Array(nodes.length*4),triangleBoundsArray=new Float32Array(bounds.length*4);
  nodes.forEach((n,i)=>{nodeBounds.set(gpuBounds(n.bounds),i*4);nodeMeta.set([n.first,n.count,n.escape,0],i*4);});bounds.forEach((b,i)=>triangleBoundsArray.set(gpuBounds(b),i*4));
  return {vertices,triangles,bounds,nodes,order:Uint32Array.from(order),nodeBounds,nodeMeta,triangleBounds:triangleBoundsArray};
}
export function* candidates(scene,point) {
  if(!point)return;let n=0;
  while(n<scene.nodes.length){const node=scene.nodes[n];if(!overlap(node.bounds,point)){n=node.escape;continue;}
    if(node.count)for(let j=node.first;j<node.first+node.count;j++){const id=scene.order[j];if(overlap(scene.bounds[id],point))yield id;}
    n++;
  }
}
export function cornerVisible(scene,q,stats={}) {
  const point=pointBounds(q);if(!point)return false;
  for(const id of candidates(scene,point)){stats.tests=(stats.tests??0)+1;const t=scene.triangles[id];if(exactOccludes(q,...t.map(i=>clipAt(scene.vertices,i))))return false;}
  return true;
}
export function allCornerElements(vertices,elements,vertexCount,instanceCount) {
  const count=elements?elements.offsets.length-1:0,result=new Uint32Array(count*instanceCount);
  for(let instance=0;instance<instanceCount;instance++)for(let e=0;e<count;e++){
    const begin=elements.offsets[e],end=elements.offsets[e+1];let yes=end>begin;
    for(let j=begin;j<end;j++)if(!vertices[instance*vertexCount+elements.indices[j]]){yes=false;break;}
    result[instance*count+e]=yes?1:0;
  }
  return result;
}
