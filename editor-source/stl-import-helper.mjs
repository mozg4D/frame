// Float32-only scalar classes. For |x|<1, x*1e7 is exact in binary64:
// Float32's <=24-bit significand times 78125 needs <=41 bits; 2^7 is exact.
// Integer decimal classes and raw |x|>=1 Float32 bits occupy disjoint ranges.
// Ambiguous/half boundaries, actual -0 and nonfinite use the stock formatter.
function frameSTLCoordinateHash(x,y,z=0) {
  let h=Math.imul(x,73856093)^Math.imul(y,19349663)^Math.imul(z,83492791);
  h^=h>>>16;h=Math.imul(h,0x7feb352d);h^=h>>>15;h=Math.imul(h,0x846ca68b);return (h^(h>>>16))>>>0;
}
function frameSTLScalarKey(value,raw,stats=null) {
  if(!Number.isFinite(value)){if(stats)stats.nonfinite++;const text=value.toFixed(7);return text==='NaN'?0x7fc00000:raw;}
  if(value===0){if(Object.is(value,-0)){if(stats)stats.signedZero++;value.toFixed(7);}return 0;}
  if(Math.abs(value)>=1)return raw;
  const scaled=Math.abs(value)*1e7,base=Math.floor(scaled),fraction=scaled-base;
  let rounded;
  if(Math.abs(fraction-.5)<=scaled*Number.EPSILON*4+1e-12){if(stats)stats.boundary++;rounded=Math.round(Math.abs(Number(value.toFixed(7)))*1e7);}
  else rounded=base+(fraction>=.5?1:0);
  return value<0?(rounded|0x80000000)>>>0:rounded;
}
function frameSTLCoordinateClasses(positions) {
  const vertexCount=positions.length/3,coords=new Uint32Array(vertexCount);
  if(!(positions instanceof Float32Array)){
    const classes=new Map();for(let v=0;v<vertexCount;v++){const o=v*3,key=`${positions[o].toFixed(7)},${positions[o+1].toFixed(7)},${positions[o+2].toFixed(7)}`;let id=classes.get(key);if(id===undefined){id=classes.size;classes.set(key,id);}coords[v]=id;}
    return{coords,count:classes.size,nonFloat32Fallback:true,tableCapacity:0};
  }
  const bits=new Uint32Array(positions.buffer,positions.byteOffset,positions.length),stats={boundary:0,signedZero:0,nonfinite:0};
  let capacity=1024,mask=capacity-1,xs=new Uint32Array(capacity),ys=new Uint32Array(capacity),zs=new Uint32Array(capacity),ids=new Uint32Array(capacity),count=0;
  const grow=()=>{const oldX=xs,oldY=ys,oldZ=zs,oldIds=ids;capacity*=2;mask=capacity-1;xs=new Uint32Array(capacity);ys=new Uint32Array(capacity);zs=new Uint32Array(capacity);ids=new Uint32Array(capacity);for(let i=0;i<oldIds.length;i++)if(oldIds[i]){let at=frameSTLCoordinateHash(oldX[i],oldY[i],oldZ[i])&mask;while(ids[at])at=(at+1)&mask;xs[at]=oldX[i];ys[at]=oldY[i];zs[at]=oldZ[i];ids[at]=oldIds[i];}};
  for(let v=0;v<vertexCount;v++){
    const o=v*3,x=frameSTLScalarKey(positions[o],bits[o],stats),y=frameSTLScalarKey(positions[o+1],bits[o+1],stats),z=frameSTLScalarKey(positions[o+2],bits[o+2],stats);
    let at=frameSTLCoordinateHash(x,y,z)&mask;while(ids[at]&&(xs[at]!==x||ys[at]!==y||zs[at]!==z))at=(at+1)&mask;
    if(!ids[at]){if((count+1)*10>capacity*7){grow();at=frameSTLCoordinateHash(x,y,z)&mask;while(ids[at])at=(at+1)&mask;}xs[at]=x;ys[at]=y;zs[at]=z;ids[at]=++count;}
    coords[v]=ids[at]-1;
  }
  return{coords,count,...stats,tableCapacity:capacity};
}

// Private STL edge table with exact full-key matching, bounded typed capacity,
// and stock Map fallback. Optional constructor overrides support contract tests.
function frameSTLEdgeHash(a, b) {
  let h = Math.imul(a, 0x9e3779b1) ^ Math.imul(b, 0x85ebca6b);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15;
  return (h ^ (h >>> 16)) >>> 0;
}
class frameSTLEdgeTable {
  constructor(coordCount, options = {}) {
    this.coordCount=coordCount; this.capacity=options.initialCapacity??16;
    this.maxCapacity=options.maxCapacity??4194304; this.hash=options.hash??frameSTLEdgeHash;
    if(this.capacity<2||(this.capacity&(this.capacity-1))||this.maxCapacity<this.capacity||(this.maxCapacity&(this.maxCapacity-1)))throw Error('power-of-two capacities required');
    this.count=0; this.map=null; this.stats={grows:0,probes:0,maxProbe:0,fallbacks:0,maxCapacity:this.capacity,entries:0};
    try {this.a=new Uint32Array(this.capacity);this.b=new Uint32Array(this.capacity);this.h=new Uint32Array(this.capacity);}
    catch(error){if(!(error instanceof RangeError))throw error;this.a=this.b=this.h=null;this.map=new Map();this.stats.fallbacks++;}
  }
  key(a,b) { return this.coordCount<=94906265?a*this.coordCount+b:a+':'+b; }
  seek(a,b) {
    let slot=this.hash(a,b)&(this.capacity-1), probes=0;
    while(this.h[slot]&&(this.a[slot]!==a||this.b[slot]!==b)) { slot=(slot+1)&(this.capacity-1); probes++; }
    this.stats.probes+=probes; this.stats.maxProbe=Math.max(this.stats.maxProbe,probes);
    return slot;
  }
  fallback() {
    const map=new Map();
    for(let i=0;i<this.capacity;i++)if(this.h[i])map.set(this.key(this.a[i],this.b[i]),this.h[i]-1);
    this.map=map; this.a=this.b=this.h=null; this.stats.fallbacks++;
  }
  grow() {
    if(this.capacity>=this.maxCapacity){this.fallback();return;}
    const oldA=this.a,oldB=this.b,oldH=this.h,capacity=this.capacity*2;
    // Allocate before changing the table; no partially published array set.
    let a,b,h;
    try {a=new Uint32Array(capacity);b=new Uint32Array(capacity);h=new Uint32Array(capacity);}
    catch(error){if(!(error instanceof RangeError))throw error;this.fallback();return;}
    this.capacity=capacity;this.a=a;this.b=b;this.h=h;this.stats.grows++;this.stats.maxCapacity=capacity;
    for(let i=0;i<oldH.length;i++)if(oldH[i]){const slot=this.seek(oldA[i],oldB[i]);a[slot]=oldA[i];b[slot]=oldB[i];h[slot]=oldH[i];}
  }
  locate(a,b) {
    if(a>b){const t=a;a=b;b=t;}
    if(this.map)return this.key(a,b);
    let slot=this.seek(a,b);
    if(!this.h[slot]){
      if((this.count+1)*10>this.capacity*7){this.grow();if(this.map)return this.key(a,b);slot=this.seek(a,b);}
      this.a[slot]=a;this.b[slot]=b;this.count++;this.stats.entries=this.count;
    }
    return slot;
  }
  head(slot) {return this.map?this.map.get(slot):this.h[slot]-1;}
  set(slot,corner) {if(!Number.isInteger(corner)||corner<0||corner>0x7fffffff)throw RangeError('corner exceeds existing signed Int32 index domain');if(this.map){this.map.set(slot,corner);this.stats.entries=this.map.size;}else this.h[slot]=corner+1;}
  clear() {if(this.map)this.map.clear();this.a=this.b=this.h=null;}
}

function frameSTLEdgeCapacity(faces) {let c=16;const estimate=Math.min(4194304,Math.ceil(faces*15/7));while(c<estimate)c*=2;return c;}
function frameSTLCreaseData(positions, index, creaseCos, seamIds = null, seamCount = 1, needRemap = false, preserveFaces = true) {
  if(seamIds!==null||seamCount!==1||needRemap!==false||preserveFaces!==true)throw Error("STL-only crease arguments required");
  const vertexCount=positions.length/3,count=index?index.length:vertexCount,faces=Math.floor(count/3);
  const coordinateClasses=frameSTLCoordinateClasses(positions),coords=coordinateClasses.coords,coordCount=coordinateClasses.count;
  const ids=index||Uint32Array.from({length:count},(_,i)=>i),parent=new Int32Array(count),next=new Int32Array(count),area=new Float64Array(faces*3),invLength=new Float64Array(faces),edges=new frameSTLEdgeTable(coordCount,{initialCapacity:frameSTLEdgeCapacity(faces)});
  next.fill(-1);for(let i=0;i<count;i++)parent[i]=i;
  const root=x=>{while(parent[x]!==x){parent[x]=parent[parent[x]];x=parent[x];}return x;};
  const join=(a,b)=>{a=root(a);b=root(b);if(a!==b)parent[b]=a;};
  const key=(a,b)=>{if(a>b){const t=a;a=b;b=t;}return coordCount<=94906265?a*coordCount+b:a+':'+b;};
   
  const threshold=creaseCos-1e-7;
  for(let f=0;f<faces;f++){
    const at=f*3,a=ids[at]*3,b=ids[at+1]*3,c=ids[at+2]*3,ax=positions[a],ay=positions[a+1],az=positions[a+2],bx=positions[b]-ax,by=positions[b+1]-ay,bz=positions[b+2]-az,cx=positions[c]-ax,cy=positions[c+1]-ay,cz=positions[c+2]-az;
    const nx=by*cz-bz*cy,ny=bz*cx-bx*cz,nz=bx*cy-by*cx,length=Math.hypot(nx,ny,nz);
    if(!(length>(preserveFaces?0:1e-8)))continue;
    area[at]=nx;area[at+1]=ny;area[at+2]=nz;invLength[f]=1/length;
    for(let k=0;k<3;k++){
      const i=at+k,j=at+(k+1)%3,ca=coords[ids[i]],cb=coords[ids[j]];if(ca===cb)continue;
      const edge=edges.locate(ca,cb),head=edges.head(edge);
      for(let e=head??-1;e!==-1;e=next[e]){
        const other=Math.floor(e/3),o=other*3;
        if((nx*area[o]+ny*area[o+1]+nz*area[o+2])*invLength[f]*invLength[other]<threshold)continue;
        const end=o+(e%3+1)%3;
        if(coords[ids[e]]===ca){join(i,e);join(j,end);}else{join(i,end);join(j,e);}
      }
      next[i]=head??-1;edges.set(edge,i);
    }
  }
  edges.clear();
  const sums=new Float64Array(count*3);
  for(let f=0;f<faces;f++)if(invLength[f])for(let k=0;k<3;k++){const at=f*3,r=root(at+k)*3;parent[at+k]=r/3;sums[r]+=area[at];sums[r+1]+=area[at+1];sums[r+2]+=area[at+2];}
  const outP=new Float32Array(count*3),outN=new Float32Array(count*3),outI=new Uint32Array(count),map=new Map();
  let vertices=0,used=0;
  for(let f=0;f<faces;f++)if(invLength[f]||preserveFaces){
    for(let k=0;k<3;k++){
      const i=f*3+k,v=ids[i],comp=parent[i],mapKey=comp*seamCount+(seamIds?seamIds[v]:0);let oi=map.get(mapKey);
      if(oi===undefined){
        oi=vertices++;map.set(mapKey,oi);const o=oi*3,r=comp*3,l=Math.hypot(sums[r],sums[r+1],sums[r+2]);
        outP[o]=positions[v*3];outP[o+1]=positions[v*3+1];outP[o+2]=positions[v*3+2];
        if(l>0){outN[o]=sums[r]/l;outN[o+1]=sums[r+1]/l;outN[o+2]=sums[r+2]/l;}
        else if(invLength[f]){outN[o]=area[f*3]*invLength[f];outN[o+1]=area[f*3+1]*invLength[f];outN[o+2]=area[f*3+2]*invLength[f];}
        else outN[o+1]=1;
      }
outI[used++]=oi;
    }
  }
  return {positions:outP.slice(0,vertices*3),normals:outN.slice(0,vertices*3),indices:outI.slice(0,used)};
}
