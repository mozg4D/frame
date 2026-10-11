// Exact production crease routines extracted from the frozen r233 editor.
const CREASE_COS=Math.cos(46*Math.PI/180);
class WorkerAttribute{constructor(array,itemSize){this.array=array;this.itemSize=itemSize;this.count=array.length/itemSize;}setXYZ(i,x,y,z){const at=i*3;this.array[at]=x;this.array[at+1]=y;this.array[at+2]=z;}getX(i){return this.array[i*this.itemSize];}getY(i){return this.array[i*this.itemSize+1];}getZ(i){return this.array[i*this.itemSize+2];}}
const THREE2={BufferAttribute:WorkerAttribute},polygonShadingAllowed=()=>true,packedGeometryAttribute=a=>a.array,markPolygonCreaseGeometry=()=>{};
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

function finiteMatrix(value,label){if(!value||value.length!==16||!Array.from(value).every(Number.isFinite))throw Error(label+' matrix required');return Float64Array.from(value);}
export function orderedAffinePositions(source,world,delta,inverse){
 if(!(source instanceof Float32Array)||source.length%3)throw Error('Float32 ordered source required');const w=finiteMatrix(world,'world'),d=finiteMatrix(delta,'delta'),r=finiteMatrix(inverse,'inverse'),out=new Float32Array(source.length);
 for(let i=0;i<source.length;i+=3){const bx=source[i],by=source[i+1],bz=source[i+2];if(![bx,by,bz].every(Number.isFinite))throw Error('Nonfinite ordered source');let x=bx,y=by,z=bz;
  for(const e of[w,d,r]){const v=1/(e[3]*x+e[7]*y+e[11]*z+e[15]),a=(e[0]*x+e[4]*y+e[8]*z+e[12])*v,b=(e[1]*x+e[5]*y+e[9]*z+e[13])*v,c=(e[2]*x+e[6]*y+e[10]*z+e[14])*v;x=a;y=b;z=c;}
  out[i]=bx+(x-bx)*1;out[i+1]=by+(y-by)*1;out[i+2]=bz+(z-bz)*1;if(!Number.isFinite(out[i])||!Number.isFinite(out[i+1])||!Number.isFinite(out[i+2]))throw Error('Nonfinite affine result');
 }return out;
}
export class AffineCornerWorkspace{
 constructor(source,indices){if(!(source instanceof Float32Array)||source.length%3||!(indices instanceof Uint32Array)||indices.length%3||!indices.length)throw Error('Indexed component source required');for(const id of indices)if(id>=source.length/3)throw Error('Corner source index out of range');if(indices.length>1572864)throw Error('Affine selected-corner budget');this.source=source.slice();this.indices=indices.slice();this.corners=new Float32Array(indices.length*3);this.normals=new Float32Array(this.corners.length);this.position=new WorkerAttribute(this.corners,3);this.normal=new WorkerAttribute(this.normals,3);this.geometry={attributes:{position:this.position,normal:this.normal},index:null,setAttribute:(name,a)=>this.geometry.attributes[name]=a,computeBoundingBox(){},computeBoundingSphere(){}};this.mesh={geometry:this.geometry};this.record={};this.last=null;}
 rebase(source){if(!(source instanceof Float32Array)||source.length!==this.source.length)throw Error('Affine rebase layout changed');this.source.set(source);}
 compute(world,delta,inverse){const began=performance.now(),positions=orderedAffinePositions(this.source,world,delta,inverse),positionMs=performance.now()-began;for(let k=0;k<this.indices.length;k++){const from=this.indices[k]*3,at=k*3;this.corners[at]=positions[from];this.corners[at+1]=positions[from+1];this.corners[at+2]=positions[from+2];}const normalsBegin=performance.now();if(!frameFastPolygonDragNormals(this.mesh,this.record))throw Error('Exact crease normal workspace declined');this.last=positions.slice();return{positions,cornerPositions:this.corners.slice(),cornerNormals:this.normals.slice(),timings:{positionMs,normalMs:performance.now()-normalsBegin,totalMs:performance.now()-began},normalPolicy:'stock-rounded-corner-weld-and-crease; no authored inverse-transpose approximation'};}
 compact(){if(!this.last)throw Error('Affine pose required');return polygonCreaseData(this.last,this.indices,CREASE_COS,null,1,false,true);}
}
export function installAffineWorker(scope){let state=null,gesture=0;scope.onmessage=({data:m})=>{try{if(m.kind==='prepare'){state=new AffineCornerWorkspace(m.source,m.indices);scope.postMessage({kind:'prepared',id:m.id,vertices:state.source.length/3,faces:state.indices.length/3});return;}if(!state)throw Error('Affine prepare required');if(m.kind==='begin'){state.rebase(m.source);gesture=m.gesture;scope.postMessage({kind:'began',id:m.id,gesture});return;}if(m.kind==='pose'){if(m.gesture!==gesture)throw Error('Affine gesture changed');const q=state.compute(m.world,m.delta,m.inverse);scope.postMessage({kind:'posed',id:m.id,gesture,revision:m.revision,...q},[q.positions.buffer,q.cornerPositions.buffer,q.cornerNormals.buffer]);return;}if(m.kind==='compact'){if(m.gesture!==gesture)throw Error('Affine gesture changed');const q=state.compact();scope.postMessage({kind:'compacted',id:m.id,gesture,...q},[q.positions.buffer,q.normals.buffer,q.indices.buffer,q.source.buffer]);return;}throw Error('Unknown affine operation');}catch(e){scope.postMessage({kind:'error',id:m.id,error:String(e)});}};}
export const stockCreaseReference=polygonCreaseData;
