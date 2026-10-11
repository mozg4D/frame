export function frameParseSTLPositions(buffer, report = () => {}) {
  const binary = buffer.byteLength >= 84 && 84 + new DataView(buffer).getUint32(80, true) * 50 === buffer.byteLength;
  let text = null, facets = 0;
  if (!binary) {
    const prefix = new TextDecoder().decode(buffer.slice(0, Math.min(buffer.byteLength, 256)));
    if (!/^\s*solid\b/i.test(prefix) || new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 256)).includes(0))
      throw Error('binary STL length does not match triangle count');
    report('Validating ASCII STL');
    text = new TextDecoder().decode(buffer);
    const tokenRE = /\b(?:facet|endfacet|vertex|endloop|endsolid)\b/gi;
    let token, vertices = 0, ends = 0, loops = 0, closed = false;
    while ((token = tokenRE.exec(text))) {
      switch (token[0].toLowerCase()) {
        case 'facet': facets++; break; case 'vertex': vertices++; break;
        case 'endfacet': ends++; break; case 'endloop': loops++; break; case 'endsolid': closed = true; break;
      }
    }
    if (!facets || vertices !== facets * 3 || ends !== facets || loops !== facets || !closed) throw Error('truncated or malformed ASCII STL');
  }
  let lastReport = -Infinity;
  const progress = (done, total) => {
    const now = performance.now();
    if (done === 0 || done === total || now - lastReport >= 40) { report('Parsing STL', done, total, 'triangles'); lastReport = now; }
  };
  if (binary) {
    const dv = new DataView(buffer), count = dv.getUint32(80, true);
    if (!count) throw Error('empty STL');
    const positions = new Float32Array(count * 9); progress(0, count);
    for (let face = 0; face < count; face++) {
      for (let j = 0; j < 9; j++) {
        const value = dv.getFloat32(84 + face * 50 + 12 + j * 4, true);
        if (!Number.isFinite(value)) throw Error('STL contains a non-finite vertex');
        positions[face * 9 + j] = value;
      }
      if ((face & 4095) === 4095) progress(face + 1, count);
    }
    progress(count, count); return positions;
  }
  const positions = new Float32Array(facets * 9), faceRE = /\bfacet\s+normal\s+([\s\S]*?)\bendfacet\b/gi, number = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[+-]?\\d+)?';
  const vertexRE = new RegExp('\\bvertex\\s+(' + number + ')\\s+(' + number + ')\\s+(' + number + ')', 'gi');
  let face, total = 0, at = 0; progress(0, facets);
  while ((face = faceRE.exec(text))) {
    let match, vertices = 0; vertexRE.lastIndex = 0;
    if (!/\bouter\s+loop\b/i.test(face[1]) || !/\bendloop\b/i.test(face[1])) throw Error('malformed ASCII STL loop');
    while ((match = vertexRE.exec(face[1]))) {
      vertices++;
      for (let k = 1; k <= 3; k++) {
        const value = Math.fround(Number(match[k]));
        if (!Number.isFinite(value)) throw Error('STL contains a non-finite vertex');
        positions[at++] = value;
      }
    }
    if (vertices !== 3) throw Error('ASCII STL facet must have three vertices');
    total++; if ((total & 4095) === 0) progress(total, facets);
  }
  if (!total) throw Error('STL contains no triangles');
  // Match the parser's accepted facets, including files with unused text records.
  progress(total, facets); return at === positions.length ? positions : positions.slice(0, at);
}
export function polygonCreaseData(positions, index, creaseCos, seamIds = null, seamCount = 1, needRemap = false, preserveFaces = true) {
  const vertexCount=positions.length/3,count=index?index.length:vertexCount,faces=Math.floor(count/3);
  const coords=new Uint32Array(vertexCount),coordIds=new Map();
  for(let v=0;v<vertexCount;v++){
    const o=v*3,key=`${positions[o].toFixed(7)},${positions[o+1].toFixed(7)},${positions[o+2].toFixed(7)}`;
    let id=coordIds.get(key);if(id===undefined){id=coordIds.size;coordIds.set(key,id);}coords[v]=id;
  }
  const coordCount=coordIds.size;coordIds.clear();
  const ids=index||Uint32Array.from({length:count},(_,i)=>i),parent=new Int32Array(count),next=new Int32Array(count),area=new Float64Array(faces*3),invLength=new Float64Array(faces),edges=new Map();
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
      const edge=key(ca,cb),head=edges.get(edge);
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
  const outP=new Float32Array(count*3),outN=new Float32Array(count*3),outI=new Uint32Array(count),source=new Uint32Array(count),map=new Map(),remap=needRemap?new Map():null,keptFaces=[];
  let vertices=0,used=0;
  for(let f=0;f<faces;f++)if(invLength[f]||preserveFaces){
    keptFaces.push(f);
    for(let k=0;k<3;k++){
      const i=f*3+k,v=ids[i],comp=parent[i],mapKey=comp*seamCount+(seamIds?seamIds[v]:0);let oi=map.get(mapKey);
      if(oi===undefined){
        oi=vertices++;map.set(mapKey,oi);const o=oi*3,r=comp*3,l=Math.hypot(sums[r],sums[r+1],sums[r+2]);source[oi]=v;
        outP[o]=positions[v*3];outP[o+1]=positions[v*3+1];outP[o+2]=positions[v*3+2];
        if(l>0){outN[o]=sums[r]/l;outN[o+1]=sums[r+1]/l;outN[o+2]=sums[r+2]/l;}
        else if(invLength[f]){outN[o]=area[f*3]*invLength[f];outN[o+1]=area[f*3+1]*invLength[f];outN[o+2]=area[f*3+2]*invLength[f];}
        else outN[o+1]=1;
      }
      if(remap){let set=remap.get(v);if(!set)remap.set(v,set=new Set());set.add(oi);}outI[used++]=oi;
    }
  }
  return {positions:outP.slice(0,vertices*3),normals:outN.slice(0,vertices*3),indices:outI.slice(0,used),source:source.slice(0,vertices),keptFaces,remap};
}
export function frameSTLGeometryBounds(positions) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], positions[i + k]); max[k] = Math.max(max[k], positions[i + k]); }
  const center = min.map((v, k) => (v + max[k]) * 0.5); let radiusSq = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const x = center[0] - positions[i], y = center[1] - positions[i + 1], z = center[2] - positions[i + 2];
    radiusSq = Math.max(radiusSq, x * x + y * y + z * z);
  }
  return { min, max, center, radius: Math.sqrt(radiusSq) };
}
export function prepareSplineBVH(positions,indices){
  const F=indices.length/3,order=Uint32Array.from({length:F},(_,i)=>i),faceBounds=new Float64Array(F*6),centers=new Float64Array(F*3);
  for(let f=0;f<F;f++)for(let k=0;k<3;k++){const a=positions[indices[f*3]*3+k],b=positions[indices[f*3+1]*3+k],c=positions[indices[f*3+2]*3+k];faceBounds[f*6+k]=Math.min(a,b,c);faceBounds[f*6+k+3]=Math.max(a,b,c);centers[f*3+k]=(a+b+c)/3;}
  const bounds=[],children=[];
  function build(start,end){const node=children.length/4;children.push(-1,-1,start,end);let lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(let i=start;i<end;i++){const f=order[i]*6;for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],faceBounds[f+k]);hi[k]=Math.max(hi[k],faceBounds[f+k+3]);}}bounds.push(...lo,...hi);
    if(end-start>8){let axis=0;for(let k=1;k<3;k++)if(hi[k]-lo[k]>hi[axis]-lo[axis])axis=k;const mid=(start+end)>>1;let l=start,r=end-1;
      while(l<r){const pivot=centers[order[(l+r)>>1]*3+axis];let i=l,j=r;while(i<=j){while(centers[order[i]*3+axis]<pivot)i++;while(centers[order[j]*3+axis]>pivot)j--;if(i<=j){const t=order[i];order[i++]=order[j];order[j--]=t;}}if(mid<=j)r=j;else if(mid>=i)l=i;else break;}
      children[node*4]=build(start,mid);children[node*4+1]=build(mid,end);
    }return node;
  }
  if(F)build(0,F);
  return {bvhBounds:new Float64Array(bounds),bvhChildren:new Int32Array(children),bvhOrder:order};
}
export function frameWireIndices(pos,idx){
  const count=idx?idx.count:pos.count,Index=pos.count<65536?Uint16Array:Uint32Array;
  if(!idx){const out=new Index(Math.floor(count/3)*6);for(let i=0,j=0;i+2<count;i+=3){out[j++]=i;out[j++]=i+1;out[j++]=i+1;out[j++]=i+2;out[j++]=i+2;out[j++]=i;}return out;}
  const base=pos.count;
   
   
  if(count>=100000&&base<=94906265){
    const keys=new Float64Array(Math.floor(count/3)*3);let used=0;
    const add=(a,b)=>{if(a!==b)keys[used++]=a<b?a*base+b:b*base+a;};
    for(let i=0;i+2<count;i+=3){const a=idx.getX(i),b=idx.getX(i+1),c=idx.getX(i+2);add(a,b);add(b,c);add(c,a);}
    const sorted=keys.subarray(0,used);sorted.sort();let unique=0,previous=-1;
    for(const key of sorted)if(key!==previous){unique++;previous=key;}
    const out=new Index(unique*2);let at=0;previous=-1;
    for(const key of sorted)if(key!==previous){const a=Math.floor(key/base);out[at++]=a;out[at++]=key-a*base;previous=key;}return out;
  }
  const out=new Index(count*2),seen=new Set();let used=0;
  const add=(a,b)=>{if(a===b)return;if(a>b){const t=a;a=b;b=t;}const key=base<=94906265?a*base+b:a+':'+b;if(!seen.has(key)){seen.add(key);out[used++]=a;out[used++]=b;}};
  for(let i=0;i+2<count;i+=3){const a=idx.getX(i),b=idx.getX(i+1),c=idx.getX(i+2);add(a,b);add(b,c);add(c,a);}return out.slice(0,used);
}
