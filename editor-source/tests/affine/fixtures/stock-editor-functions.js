function polygonCreaseData(positions, index, creaseCos, seamIds = null, seamCount = 1, needRemap = false, preserveFaces = true) {
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

function framePolygonHash(x,y,z=0) {
  let h=Math.imul(x,73856093)^Math.imul(y,19349663)^Math.imul(z,83492791);
  h^=h>>>16;h=Math.imul(h,0x7feb352d);h^=h>>>15;h=Math.imul(h,0x846ca68b);return (h^(h>>>16))>>>0;
}

function framePolygonWeldBits(value,bits,w) {
  if(value===0)return 0;
  if(Math.abs(value)>=1)return bits;
  let rounded=w.smallCoordinates.get(value);
  if(rounded===undefined){w.one[0]=Number(value.toFixed(7));rounded=w.oneBits[0];w.smallCoordinates.set(value,rounded);}
  return rounded;
}

function framePolygonNormalWorkspace(rec,vertices,count) {
  let w=rec._creaseWorkspace;
  if(w?.vertices===vertices&&w.count===count)return w;
  let rawSize=16,edgeSize=16;while(rawSize<vertices*2)rawSize*=2;while(edgeSize<count*2)edgeSize*=2;
  w={vertices,count,epoch:0,rawMask:rawSize-1,edgeMask:edgeSize-1,
    rawStamp:new Uint32Array(rawSize),rawFirst:new Uint32Array(rawSize),
    edgeStamp:new Uint32Array(edgeSize),edgeA:new Uint32Array(edgeSize),edgeB:new Uint32Array(edgeSize),edgeHead:new Int32Array(edgeSize),
    coords:new Uint32Array(vertices),indices:new Uint32Array(count),parent:new Int32Array(count),previous:new Int32Array(count),next:new Int32Array(count),valid:new Uint8Array(count/3),area:new Float64Array(count),inv:new Float64Array(count/3),sums:new Float64Array(count*3),
    normalStamp:new Uint32Array(count),normal:new Float32Array(count*3),quantized:new Uint32Array(vertices*3),last:new Float32Array(vertices*3),smallCoordinates:new Map(),one:new Float32Array(1)};
  w.oneBits=new Uint32Array(w.one.buffer);
  rec._creaseWorkspace=w;return w;
}

function frameFastPolygonDragNormals(mesh,rec) {
  if(!rec||!polygonShadingAllowed(mesh))return false;
  const g=mesh.geometry,pos=g.attributes.position,index=g.index,count=index?.count??pos.count;
  if(!count||count%3||pos.itemSize!==3||index&&(index.isInterleavedBufferAttribute||index.normalized||index.itemSize!==1||index.array.length!==count))return false;
  const positions=packedGeometryAttribute(pos),ids=index?index.array:null,w=framePolygonNormalWorkspace(rec,pos.count,count),bits=new Uint32Array(positions.buffer,positions.byteOffset,positions.length);
  let epoch=(w.epoch+1)>>>0;if(!epoch){w.rawStamp.fill(0);w.edgeStamp.fill(0);w.normalStamp.fill(0);epoch=1;}w.epoch=epoch;
  const {rawStamp,rawFirst,rawMask,edgeStamp,edgeA,edgeB,edgeHead,edgeMask,coords,indices,parent,previous,next,valid,area,inv,sums,normalStamp,normal,quantized,last}=w;
  let topologySame=!!w.topologyReady;
  w.smallCoordinates.clear();sums.fill(0);let coordinateCount=0;
  // Float32 spacing at |value|>=1 exceeds 1e-7: distinct values cannot share
  // toFixed(7), and narrowing its decimal back to Float32 returns that value.
  // Below 1, decimal steps exceed Float32 spacing, so narrowed decimal values
  // form an injective key. Keep signed rounded zero distinct from exact zero.
  // This replaces string triples, while preserving the current weld rule.
  for(let v=0;v<pos.count;v++){
    const o=v*3,x=positions[o],y=positions[o+1],z=positions[o+2];
    if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z)){w.topologyReady=false;return false;}
    const xb=w.coordinatesReady&&last[o]===x?quantized[o]:framePolygonWeldBits(x,bits[o],w),yb=w.coordinatesReady&&last[o+1]===y?quantized[o+1]:framePolygonWeldBits(y,bits[o+1],w),zb=w.coordinatesReady&&last[o+2]===z?quantized[o+2]:framePolygonWeldBits(z,bits[o+2],w);
    quantized[o]=xb;quantized[o+1]=yb;quantized[o+2]=zb;last[o]=x;last[o+1]=y;last[o+2]=z;
    let slot=framePolygonHash(xb,yb,zb)&rawMask,id;
    while(rawStamp[slot]===epoch){const p=rawFirst[slot]*3;
      if(quantized[p]===xb&&quantized[p+1]===yb&&quantized[p+2]===zb){id=coords[p/3];break;}slot=(slot+1)&rawMask;
    }
    if(id===undefined){id=coordinateCount++;rawStamp[slot]=epoch;rawFirst[slot]=v;}
    if(coords[v]!==id)topologySame=false;coords[v]=id;
  }
  w.coordinatesReady=true;
  for(let i=0;i<count;i++){const v=ids?ids[i]:i;if(indices[i]!==v)topologySame=false;indices[i]=v;parent[i]=i;}
  // A current coordinate equivalence and index comparison is required before
  // reusing adjacency. Include every face here; current degenerate faces are
  // filtered below, so degeneracy changes do not freeze the smoothing graph.
  if(!topologySame){
    for(let i=0;i<count;i++){
      const j=Math.floor(i/3)*3+(i%3+1)%3,ca=coords[indices[i]],cb=coords[indices[j]];
      if(ca===cb){previous[i]=next[i]=-1;continue;}
      const lo=Math.min(ca,cb),hi=Math.max(ca,cb);let slot=framePolygonHash(lo,hi)&edgeMask;
      while(edgeStamp[slot]===epoch&&(edgeA[slot]!==lo||edgeB[slot]!==hi))slot=(slot+1)&edgeMask;
      previous[i]=next[i]=edgeStamp[slot]===epoch?edgeHead[slot]:-1;
      edgeStamp[slot]=epoch;edgeA[slot]=lo;edgeB[slot]=hi;edgeHead[slot]=i;
    }
    w.topologyReady=true;
  }
  const root=x=>{while(parent[x]!==x){parent[x]=parent[parent[x]];x=parent[x];}return x;},join=(a,b)=>{a=root(a);b=root(b);if(a!==b)parent[b]=a;},threshold=CREASE_COS-1e-7;
  for(let f=0;f<count/3;f++){
    const at=f*3,a=(ids?ids[at]:at)*3,b=(ids?ids[at+1]:at+1)*3,c=(ids?ids[at+2]:at+2)*3,ax=positions[a],ay=positions[a+1],az=positions[a+2],bx=positions[b]-ax,by=positions[b+1]-ay,bz=positions[b+2]-az,cx=positions[c]-ax,cy=positions[c+1]-ay,cz=positions[c+2]-az;
    const nx=by*cz-bz*cy,ny=bz*cx-bx*cz,nz=bx*cy-by*cx,length=Math.hypot(nx,ny,nz);
    area[at]=area[at+1]=area[at+2]=0;inv[f]=0;valid[f]=length>0?1:0;if(!valid[f])continue;
    area[at]=nx;area[at+1]=ny;area[at+2]=nz;inv[f]=1/length;
    for(let k=0;k<3;k++){
      const i=at+k,j=at+(k+1)%3,ca=coords[ids?ids[i]:i],cb=coords[ids?ids[j]:j];if(ca===cb)continue;
      for(let e=previous[i];e!==-1;e=next[e]){
        const other=Math.floor(e/3),o=other*3;
        if(!valid[other])continue;
        if((nx*area[o]+ny*area[o+1]+nz*area[o+2])*inv[f]*inv[other]<threshold)continue;
        const end=o+(e%3+1)%3;
        if(coords[ids?ids[e]:e]===ca){join(i,e);join(j,end);}else{join(i,end);join(j,e);}
      }
    }
  }
  // Preserve the original parent updates and area accumulation operation order.
  for(let f=0;f<count/3;f++)if(inv[f])for(let k=0;k<3;k++){const at=f*3,r=root(at+k)*3;parent[at+k]=r/3;sums[r]+=area[at];sums[r+1]+=area[at+1];sums[r+2]+=area[at+2];}
  let n=g.attributes.normal;if(!n||n.count!==pos.count){n=new THREE2.BufferAttribute(new Float32Array(pos.count*3),3);g.setAttribute('normal',n);}
  for(let f=0;f<count/3;f++)for(let k=0;k<3;k++){
    const i=f*3+k,comp=parent[i],r=comp*3;
    if(normalStamp[comp]!==epoch){normalStamp[comp]=epoch;const l=Math.hypot(sums[r],sums[r+1],sums[r+2]);
      normal[r]=normal[r+1]=normal[r+2]=0;
      if(l>0){normal[r]=sums[r]/l;normal[r+1]=sums[r+1]/l;normal[r+2]=sums[r+2]/l;}
      else if(inv[f]){normal[r]=area[f*3]*inv[f];normal[r+1]=area[f*3+1]*inv[f];normal[r+2]=area[f*3+2]*inv[f];}
      else normal[r+1]=1;
    }
    n.setXYZ(index?index.getX(i):i,normal[r],normal[r+1],normal[r+2]);
  }
  n.needsUpdate=true;g.computeBoundingBox();g.computeBoundingSphere();markPolygonCreaseGeometry(g);return true;
}

function updatePolygonDragNormals(mesh,rec=null){
  if(frameFastPolygonDragNormals(mesh,rec))return;
  if(!polygonShadingAllowed(mesh))return;
  const g=mesh.geometry,pos=g.attributes.position,index=g.index,count=index?.count??pos.count;
  if(!count)return;
  const built=polygonCreaseData(packedGeometryAttribute(pos),index?index.array:null,CREASE_COS);
  let n=g.attributes.normal;if(!n||n.count!==pos.count){n=new THREE2.BufferAttribute(new Float32Array(pos.count*3),3);g.setAttribute('normal',n);}
  for(let i=0;i<count;i++){const source=built.indices[i]*3,v=index?index.getX(i):i;n.setXYZ(v,built.normals[source],built.normals[source+1],built.normals[source+2]);}
  n.needsUpdate=true;g.computeBoundingBox();g.computeBoundingSphere();markPolygonCreaseGeometry(g);
}

function applyPolyDelta(delta, snap) {
  if(frameRigidApplyDelta(delta))return;
  let p = new THREE2.Vector3();
  for (let [h, rec2] of snap) {
    let mesh = pickMeshes.get(h), g = mesh && mesh.geometry, pos = g && g.attributes.position;
    if (!pos) continue;
    mesh.updateMatrixWorld(!0);
    if(frameMorphInterceptPoly(h,rec2,delta,mesh))continue;
    let inv = mesh.matrixWorld.clone().invert(), base = new THREE2.Vector3(), moved = new THREE2.Vector3();
    rec2.ids.forEach((i, k) => {
      base.set(rec2.values[k * 3], rec2.values[k * 3 + 1], rec2.values[k * 3 + 2]), moved.copy(base).applyMatrix4(mesh.matrixWorld).applyMatrix4(delta).applyMatrix4(inv), p.copy(base).lerp(moved, rec2.weights ? rec2.weights[k] : 1), pos.setXYZ(i, p.x, p.y, p.z);
    }), pos.needsUpdate = !0, updatePolygonDragNormals(mesh,rec2), refreshWireOverlay(mesh);
    frameMorphModelChanged(h);
  }
  vertexTools.soft.active && updateSoftPreview(), rebuildPolySelection(!1);
}
