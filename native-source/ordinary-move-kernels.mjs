import * as THREE2 from '../modules/frame-three-core.9edde002b066a9a05676.js';
import {ordinarySelectedIDs} from './ordinary-move-core.mjs';
export function moveReadPacket(snapshot,input,context={}) {
 const h='owned',g=new THREE2.BufferGeometry();
 g.setAttribute('position',new THREE2.BufferAttribute(snapshot.positions,3));
 g.setAttribute('normal',new THREE2.BufferAttribute(snapshot.normals,3));
 g.setIndex(new THREE2.BufferAttribute(snapshot.indices,1));
 const mesh=new THREE2.Mesh(g); mesh.matrixAutoUpdate=false;mesh.matrix.fromArray(context.world);mesh.updateMatrixWorld(true);
 const items=new Map([[h,{vertices:new Set(input.vertices||[]),edges:new Set(input.edges||[]),faces:new Set(input.faces||[])}]]);
 const pickMeshes=new Map([[h,mesh]]),selNodes=new Set([h]),polySelection={items},polyElementMode=context.domain||'vertex',coordMode=context.space||'world';
 const polyExactEdgeVertices=null,uvEdit=false,vertexTools={soft:{active:false}},polyFocusActive=()=>true,splineFocusActive=()=>false;
 const vertexGroupCache=new WeakMap(),vertexGroupOfCache=new WeakMap(),logicalEdgeCache=new WeakMap();
 const _rotX=new THREE2.Vector3(),_rotY=new THREE2.Vector3(),_rotZ=new THREE2.Vector3();
 const frameRigidSelectedIDs=()=>null,pureWorldFrame=()=>new THREE2.Matrix4().fromArray(context.ownerFrame||context.world);
 function polyEdgeKey(a, b) {
  return a < b ? a + ":" + b : b + ":" + a;
}
function rotMatOfLin(linM4, outM4) {
  let e = linM4.elements;
  _rotX.set(e[0], e[1], e[2]), _rotY.set(e[4], e[5], e[6]), _rotZ.set(e[8], e[9], e[10]), _rotX.lengthSq() < 1e-18 ? _rotX.set(1, 0, 0) : _rotX.normalize(), _rotY.addScaledVector(_rotX, -_rotY.dot(_rotX)), _rotY.lengthSq() < 1e-18 && (_rotY.set(0, 1, 0).addScaledVector(_rotX, -_rotX.y), _rotY.lengthSq() < 1e-18 && _rotY.set(0, 0, 1).addScaledVector(_rotX, -_rotX.z)), _rotY.normalize();
  let handedness = _rotX.clone().cross(_rotY).dot(_rotZ);
  return _rotZ.crossVectors(_rotX, _rotY), handedness < 0 && _rotZ.negate(), outM4.makeBasis(_rotX, _rotY, _rotZ), outM4;
}
function basisFromNormal(normal, ownerRot) {
  let z = normal.clone().normalize(), oe = ownerRot.elements, candidates = [new THREE2.Vector3(oe[0], oe[1], oe[2]), new THREE2.Vector3(oe[4], oe[5], oe[6]), new THREE2.Vector3(oe[8], oe[9], oe[10])], x = null, best = -1;
  for (let a of candidates) {
    let q = a.clone().addScaledVector(z, -a.dot(z)), d = q.lengthSq();
    d > best && (best = d, x = q);
  }
  x.normalize();
  let y = z.clone().cross(x).normalize();
  return x.copy(y).cross(z).normalize(), new THREE2.Matrix4().makeBasis(x, y, z);
}
function* frameFaceSelectionBasisWork(h,ownerRot,items=polySelection.items,meshes=pickMeshes) {
  if(polyElementMode!=='face'||items.size!==1)return null;
  const s=items.get(h),mesh=meshes.get(h),g=mesh?.geometry,pos=g?.attributes.position,idx=g?.index;
  if(!s?.faces.size||!pos)return null;mesh.updateMatrixWorld(true);
  const a=new THREE2.Vector3(),b=new THREE2.Vector3(),c=new THREE2.Vector3(),ab=new THREE2.Vector3(),ac=new THREE2.Vector3(),normal=new THREE2.Vector3(),delta=new THREE2.Vector3();let refNormal=null,refPoint=null,span=0,deviation=0,work=0;
  for(const fi of s.faces){
    if((++work&1023)===0)yield;
    const ia=idx?idx.getX(fi*3):fi*3,ib=idx?idx.getX(fi*3+1):fi*3+1,ic=idx?idx.getX(fi*3+2):fi*3+2;
    a.fromBufferAttribute(pos,ia).applyMatrix4(mesh.matrixWorld);b.fromBufferAttribute(pos,ib).applyMatrix4(mesh.matrixWorld);c.fromBufferAttribute(pos,ic).applyMatrix4(mesh.matrixWorld);
    normal.copy(ab.subVectors(b,a)).cross(ac.subVectors(c,a));if(normal.lengthSq()<1e-16)return null;normal.normalize();
    if(!refNormal){refNormal=normal.clone();refPoint=a.clone();}else{if(normal.dot(refNormal)<0)normal.negate();if(normal.dot(refNormal)<.9999)return null;}
    for(const point of [a,b,c]){span=Math.max(span,point.distanceTo(refPoint));const distance=Math.abs(delta.copy(point).sub(refPoint).dot(refNormal));if(distance>deviation)deviation=distance;}
  }
  if(deviation>Math.max(1e-5,span*1e-5))return null;
  return basisFromNormal(refNormal,ownerRot);
}
function* frameEdgeSelectionBasisWork(h,ownerRot,items=polySelection.items,meshes=pickMeshes) {
  if (polyElementMode !== "edge" || items.size !== 1) return null;
  let s = items.get(h), mesh = meshes.get(h), pos = mesh?.geometry?.attributes.position;
  if (!s?.edges.size || !pos) return null;
  mesh.updateMatrixWorld(!0);
  const chosen=[];let work=0;
  for(const edge of yield* frameLogicalEdgesWork(mesh.geometry)){
    let take=false;for(const key of edge.keys){if(s.edges.has(key)){take=true;break;}if((++work&1023)===0)yield;}
    if(take)chosen.push(edge);if((++work&1023)===0)yield;
  }
  if (!chosen.length) return null;
  let a = new THREE2.Vector3(), b = new THREE2.Vector3(), dir = new THREE2.Vector3(), points = [], refDir = null, refPoint = null;
  for (let edge of chosen){
    if((++work&1023)===0)yield;
    if (a.fromBufferAttribute(pos, edge.a).applyMatrix4(mesh.matrixWorld), b.fromBufferAttribute(pos, edge.b).applyMatrix4(mesh.matrixWorld), dir.subVectors(b, a), !(dir.lengthSq() < 1e-16)) {
      if (dir.normalize(), !refDir)
        refDir = dir.clone(), refPoint = a.clone();
      else if (dir.dot(refDir) < 0 && dir.negate(), dir.dot(refDir) < 0.9999) return null;
      points.push(a.clone(), b.clone());
    }
  }
  if (!refDir) return null;
  let oe = ownerRot.elements, ownerX = new THREE2.Vector3(oe[0], oe[1], oe[2]);
  refDir.dot(ownerX) < 0 && refDir.negate();
  let span = 0;
  for (let p of points){span = Math.max(span, p.distanceTo(refPoint));if((++work&1023)===0)yield;}
  let tol = Math.max(1e-5, span * 1e-5);
  for (let p of points) {
    let d = p.clone().sub(refPoint), along = refDir.clone().multiplyScalar(d.dot(refDir));
    if (d.sub(along).length() > tol) return null;
    if((++work&1023)===0)yield;
  }
  let ownerY = new THREE2.Vector3(oe[4], oe[5], oe[6]), ownerZ = new THREE2.Vector3(oe[8], oe[9], oe[10]), y = ownerY.addScaledVector(refDir, -ownerY.dot(refDir));
  y.lengthSq() < 1e-10 && (y = ownerZ.addScaledVector(refDir, -ownerZ.dot(refDir))), y.normalize();
  let z = refDir.clone().cross(y).normalize();
  return y = z.clone().cross(refDir).normalize(), new THREE2.Matrix4().makeBasis(refDir, y, z);
}
function* frameLogicalEdgesWork(geometry) {
  let edges = logicalEdgeCache.get(geometry);
  if (edges) return edges;
  let pos = geometry.attributes.position, index = geometry.index, triangles = index ? index.count / 3 : pos.count / 3, byPosition = /* @__PURE__ */ new Map();
  edges = [];let work=0;
  let positionKey = (i) => `${Math.round(pos.getX(i) * 1e5)},${Math.round(pos.getY(i) * 1e5)},${Math.round(pos.getZ(i) * 1e5)}`;
  for (let fi = 0; fi < triangles; fi++) for (let j = 0; j < 3; j++) {
    let a = index ? index.getX(fi * 3 + j) : fi * 3 + j, b = index ? index.getX(fi * 3 + (j + 1) % 3) : fi * 3 + (j + 1) % 3, ka = positionKey(a), kb = positionKey(b), logicalKey = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`, edge = byPosition.get(logicalKey);
    edge || (edge = { a, b, keys: [] }, byPosition.set(logicalKey, edge), edges.push(edge));
    let key = polyEdgeKey(a, b);
    edge.keys.includes(key) || edge.keys.push(key);if((++work&1023)===0)yield;
  }
  return logicalEdgeCache.set(geometry, edges), edges;
}
function* frameLogicalVertexGroupsWork(geometry) {
  let groups = vertexGroupCache.get(geometry);
  if (groups) return groups;
  let pos = geometry.attributes.position, byPosition = /* @__PURE__ */ new Map();
  groups = [];
  for (let i = 0; i < pos.count; i++) {
    let key = `${Math.round(pos.getX(i) * 1e5)},${Math.round(pos.getY(i) * 1e5)},${Math.round(pos.getZ(i) * 1e5)}`, group = byPosition.get(key);
    group || (group = [], byPosition.set(key, group), groups.push(group)), group.push(i);if((i&1023)===1023)yield;
  }
  let groupOf = new Array(pos.count);
  let work=0;for (let group of groups) for (let vi of group){groupOf[vi] = group;if((++work&1023)===0)yield;}
  return vertexGroupCache.set(geometry, groups), vertexGroupOfCache.set(geometry, groupOf), groups;
}
function* framePolySelectionBuffers(items,meshes=pickMeshes) {
  let workCount=0;
  let nf=0,ne=0,nv=0;
  for(const [h,s] of items)if(selNodes.has(h)&&meshes.get(h)?.geometry?.attributes.position){nf+=s.faces.size*9;ne+=s.edges.size*6;nv+=s.vertices.size*3;}
  const fp=new Float32Array(nf),ep=new Float32Array(ne),vp=new Float32Array(nv);let fiOut=0,eiOut=0,viOut=0;
  let a = new THREE2.Vector3(), b = new THREE2.Vector3(), c = new THREE2.Vector3();
  for (let [h, s] of items) {
    if (!selNodes.has(h)) continue;
    let mesh = meshes.get(h), g = mesh && mesh.geometry, pos = g && g.attributes.position, idx = g && g.index;
    if (pos) {
      mesh.updateMatrixWorld(!0);
      for (let i of s.vertices){
        a.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld), vp[viOut++]=a.x, vp[viOut++]=a.y, vp[viOut++]=a.z;if((++workCount&1023)===0)yield;
      }
      for (let key of s.edges) {
        let i,j;
        const separator=typeof key==='string'?key.indexOf(':'):-1;
        if(separator>=0&&key.indexOf(':',separator+1)<0){i=Number(key.slice(0,separator));j=Number(key.slice(separator+1));}
        else [i,j]=key.split(':').map(Number);
        a.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld), b.fromBufferAttribute(pos, j).applyMatrix4(mesh.matrixWorld), ep[eiOut++]=a.x, ep[eiOut++]=a.y, ep[eiOut++]=a.z, ep[eiOut++]=b.x, ep[eiOut++]=b.y, ep[eiOut++]=b.z;if((++workCount&1023)===0)yield;
      }
      for (let fi of s.faces) {
        let ia = idx ? idx.getX(fi * 3) : fi * 3, ib = idx ? idx.getX(fi * 3 + 1) : fi * 3 + 1, ic = idx ? idx.getX(fi * 3 + 2) : fi * 3 + 2;
        a.fromBufferAttribute(pos, ia).applyMatrix4(mesh.matrixWorld), b.fromBufferAttribute(pos, ib).applyMatrix4(mesh.matrixWorld), c.fromBufferAttribute(pos, ic).applyMatrix4(mesh.matrixWorld), fp[fiOut++]=a.x, fp[fiOut++]=a.y, fp[fiOut++]=a.z, fp[fiOut++]=b.x, fp[fiOut++]=b.y, fp[fiOut++]=b.z, fp[fiOut++]=c.x, fp[fiOut++]=c.y, fp[fiOut++]=c.z;if((++workCount&1023)===0)yield;
      }
    }
  }
  return {fp,ep,vp};
}
function* framePolySelectionMeasurements(items,exact=polyExactEdgeVertices,meshes=pickMeshes,pivot=null,rigidIDs=null){
  if(!['vertex','edge','face'].includes(polyElementMode)||!polyFocusActive()||splineFocusActive()||uvEdit||vertexTools.soft.active||!items.size)return null;
  const field=polyElementMode==='vertex'?'vertices':polyElementMode==='edge'?'edges':'faces';
  for(const [h,s] of items)if(exact?.has(h)||['vertices','edges','faces'].some(key=>key!==field&&s[key].size))return null;
  const selected=new Map(),mn=new THREE2.Vector3(Infinity,Infinity,Infinity),mx=new THREE2.Vector3(-Infinity,-Infinity,-Infinity),p=new THREE2.Vector3();let any=false,work=0;
  for(const [h] of items){
    const mesh=meshes.get(h),pos=mesh?.geometry?.attributes.position;if(!pos)continue;
    mesh.updateMatrixWorld(true);
    const ids=yield* framePolySelectedVertexIdsWork(h,items,exact,meshes,rigidIDs);selected.set(h,ids);
    for(const i of ids){p.fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld);mn.min(p);mx.max(p);any=true;if((++work&1023)===0)yield;}
  }
  if(!any)return null;
  let h=null;for(const key of items.keys())if(meshes.has(key)){h=key;break;}h??=selNodes.values().next().value||null;
  let frame;
  if(pivot&&coordMode==='object'){frame=new THREE2.Matrix4().fromArray(pivot);rotMatOfLin(frame,frame);frame.setPosition(0,0,0);}
  else if(coordMode==='world')frame=new THREE2.Matrix4();
  else{const owner=pureWorldFrame(h);frame=(yield* frameFaceSelectionBasisWork(h,owner,items,meshes))||(yield* frameEdgeSelectionBasisWork(h,owner,items,meshes))||owner;}
  frame.setPosition(pivot?new THREE2.Vector3().setFromMatrixPosition(new THREE2.Matrix4().fromArray(pivot)):mn.clone().add(mx).multiplyScalar(.5));
  const inv=frame.clone().invert(),lo=new THREE2.Vector3(Infinity,Infinity,Infinity),hi=new THREE2.Vector3(-Infinity,-Infinity,-Infinity);
  for(const [h,ids] of selected){
    const mesh=meshes.get(h),pos=mesh.geometry.attributes.position;mesh.updateMatrixWorld(true);
    for(const i of ids){p.fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld).applyMatrix4(inv);lo.min(p);hi.max(p);if((++work&1023)===0)yield;}
  }
  return {bounds:{min:mn,max:mx},frame,extent:hi.sub(lo)};
}
function* framePolySelectedVertexIdsWork(h,items=polySelection.items,exact=polyExactEdgeVertices,meshes=pickMeshes,rigidIDs=null) {
  const rigid=rigidIDs?.get(h)??(meshes===pickMeshes&&items===polySelection.items&&!exact?.has(h)?frameRigidSelectedIDs(h):null);if(rigid)return new Set(rigid);
  const s=items.get(h),mesh=meshes.get(h),g=mesh?.geometry,out=new Set();let work=0;
  if(!s||!g)return out;
  if(exact?.has(h)){for(const i of exact.get(h)){out.add(i);if((++work&1023)===0)yield;}return out;}
  for(const i of s.vertices){out.add(i);if((++work&1023)===0)yield;}
  if(!s.edges.size&&!s.faces.size)return out;
  yield* frameLogicalVertexGroupsWork(g);const groupOf=vertexGroupOfCache.get(g),expanded=new Set(),idx=g.index;
  const takeGroup=i=>{const group=groupOf?.[i];if(!group){out.add(i);return null;}if(expanded.has(group))return null;expanded.add(group);return group;};
  for(const key of s.edges){
    let a=0,b=0,split=-1,valid=typeof key==='string'&&key.length<=21;
    if(valid){for(let k=0;k<key.length;k++){const c=key.charCodeAt(k);if(c===58&&split<0&&k>0&&k<key.length-1){split=k;continue;}if(c<48||c>57){valid=false;break;}if(split<0)a=a*10+c-48;else b=b*10+c-48;}valid=valid&&split>0&&split<=10&&key.length-split-1<=10;}
    if(!valid)[a,b]=key.split(':').map(Number);
    let group=takeGroup(a);if(group)for(const v of group){out.add(v);if((++work&1023)===0)yield;}
    group=takeGroup(b);if(group)for(const v of group){out.add(v);if((++work&1023)===0)yield;}
    if((++work&1023)===0)yield;
  }
  for(const fi of s.faces){
    for(let j=0;j<3;j++){const group=takeGroup(idx?idx.getX(fi*3+j):fi*3+j);if(group)for(const v of group){out.add(v);if((++work&1023)===0)yield;}}
    if((++work&1023)===0)yield;
  }
  return out;
}
function frameDrainSelectionWork(work){let step;do{step=work.next();}while(!step.done);return step.value;}
function prepareSplineBVH(positions,indices){
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
function frameWireIndices(pos,idx){
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
 const ids=Uint32Array.from(ordinarySelectedIDs(snapshot,input)).sort(),mask=new Uint8Array(snapshot.positions.length/3);for(const id of ids)mask[id]=1;
 const buffers=frameDrainSelectionWork(framePolySelectionBuffers(items)),m=frameDrainSelectionWork(framePolySelectionMeasurements(items,null,pickMeshes,context.pivot||null));
 const measurements=m?{bounds:{min:m.bounds.min.toArray(),max:m.bounds.max.toArray()},frame:m.frame.toArray(),extent:m.extent.toArray()}:null;
 const overlayNumeric={};for(const [key,positions]of Object.entries(buffers)){const count=positions.length/3,extras=new Float32Array(count*9),indices=new Uint32Array(count);for(let i=0;i<count;i++){indices[i]=i;extras[i*9+2]=extras[i*9+5]=extras[i*9+6]=extras[i*9+7]=extras[i*9+8]=1;}overlayNumeric[key]={positions,extras,indices,vertexCount:count,hasNormals:false,hasUV:false,hasColors:false};}
 return {rawIDs:ids,rawMask:mask,buffers,measurements,overlayNumeric};
}
export function moveDerivedPacket(snapshot) {
 function prepareSplineBVH(positions,indices){
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
 function frameWireIndices(pos,idx){
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
 const p=snapshot.positions,ix=snapshot.indices;
 const pos={count:p.length/3},idx={count:ix.length,getX:i=>ix[i]};
 const bounds=new THREE2.Box3(),v=new THREE2.Vector3();for(let i=0;i<p.length;i+=3)bounds.expandByPoint(v.fromArray(p,i));
 const center=bounds.getCenter(new THREE2.Vector3());let radiusSq=0;for(let i=0;i<p.length;i+=3)radiusSq=Math.max(radiusSq,center.distanceToSquared(v.fromArray(p,i)));
 const wire=frameWireIndices(pos,idx),start=snapshot.drawRange?.start||0,end=Math.min(ix.length,start+(snapshot.drawRange?.count??Infinity));
 return {wire,wireElements:Uint32Array.from(wire),pointElements:Uint32Array.from(ix.subarray(start,end)),bvh:prepareSplineBVH(p,ix),bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},sphere:{center:center.toArray(),radius:Math.sqrt(radiusSq)}};
}
