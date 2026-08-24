// Frozen R2 preflight port — data-oriented JS implementation.
// Semantics follow frame_boolean_engine.cpp::prepare + frame_boolean_preflight.hpp.
const UINT32_MAX=0xffffffff;
const DIRS_RAW=[
  [1,.1732050807568877,.317837245195782],[.2718281828459045,1,.4142135623730951],[.6180339887498948,.233,1],[-1,.3819660112501052,.271],[.7071067811865476,-1,.2236067977499789],[.347,.6180339887498948,-1],[1,1,.5773502691896258]
];
const DIRS=new Float64Array(DIRS_RAW.length*3);
for(let i=0;i<DIRS_RAW.length;i++){const d=DIRS_RAW[i],n=Math.hypot(d[0],d[1],d[2])||1;DIRS[i*3]=d[0]/n;DIRS[i*3+1]=d[1]/n;DIRS[i*3+2]=d[2]/n;}
const BIT_BUF=new ArrayBuffer(8),BIT_F64=new Float64Array(BIT_BUF),BIT_U32=new Uint32Array(BIT_BUF);
function nextPow2(n){let x=16;while(x<n)x*=2;return x;}
function mix32(h,x){h^=x>>>0;h=Math.imul(h,0x85ebca6b);h^=h>>>13;h=Math.imul(h,0xc2b2ae35);return h>>>0;}
function hashPoint(x,y,z){let h=0x9e3779b9;BIT_F64[0]=x;h=mix32(h,BIT_U32[0]);h=mix32(h,BIT_U32[1]);BIT_F64[0]=y;h=mix32(h,BIT_U32[0]);h=mix32(h,BIT_U32[1]);BIT_F64[0]=z;h=mix32(h,BIT_U32[0]);return mix32(h,BIT_U32[1]);}
function hash3u(a,b,c){let h=Math.imul((a^0x9e3779b9)>>>0,0x85ebca6b);h=mix32(h,b);return mix32(h,c);}
function hash2u(a,b){let h=Math.imul((a^0x9e3779b9)>>>0,0x85ebca6b);return mix32(h,b);}
function sort3(a,b,c){let t;if(a>b){t=a;a=b;b=t;}if(b>c){t=b;b=c;c=t;}if(a>b){t=a;a=b;b=t;}return [a,b,c];}

function shellRayVoteFlat(pos,faceV,compFaces,start,end,ox,oy,oz,dx,dy,dz){let hits=0;const eps=1e-11;for(let q=start;q<end;q++){const fi=compFaces[q],o=fi*3,ia=faceV[o]*3,ib=faceV[o+1]*3,ic=faceV[o+2]*3,ax=pos[ia],ay=pos[ia+1],az=pos[ia+2],e1x=pos[ib]-ax,e1y=pos[ib+1]-ay,e1z=pos[ib+2]-az,e2x=pos[ic]-ax,e2y=pos[ic+1]-ay,e2z=pos[ic+2]-az,px=dy*e2z-dz*e2y,py=dz*e2x-dx*e2z,pz=dx*e2y-dy*e2x,det=e1x*px+e1y*py+e1z*pz;if(Math.abs(det)<1e-14)continue;const inv=1/det,sx=ox-ax,sy=oy-ay,sz=oz-az,u=(sx*px+sy*py+sz*pz)*inv;if(u<-eps||u>1+eps)continue;const qx=sy*e1z-sz*e1y,qy=sz*e1x-sx*e1z,qz=sx*e1y-sy*e1x,v=(dx*qx+dy*qy+dz*qz)*inv;if(v<-eps||u+v>1+eps)continue;const t=(e2x*qx+e2y*qy+e2z*qz)*inv;if(t<=1e-10)continue;if(u<eps||v<eps||1-u-v<eps)return -1;hits++;}return hits&1;}
function pointInsideShellFlat(pos,faceV,compFaces,start,end,px,py,pz){let yes=0,no=0;for(let i=0;i<DIRS.length;i+=3){const r=shellRayVoteFlat(pos,faceV,compFaces,start,end,px,py,pz,DIRS[i],DIRS[i+1],DIRS[i+2]);if(r<0)continue;if(r)yes++;else no++;}return {inside:yes>no,certain:(yes+no)>=3&&yes!==no};}

function buildEdgeIncidence(faceV,faceCount,stats){
  const cap=nextPow2(faceCount*6+8),mask=cap-1,ea=new Uint32Array(cap),eb=new Uint32Array(cap),count=new Uint8Array(cap),f0=new Uint32Array(cap),f1=new Uint32Array(cap),d0=new Int8Array(cap),d1=new Int8Array(cap);
  for(let fi=0;fi<faceCount;fi++){const o=fi*3,a0=faceV[o],a1=faceV[o+1],a2=faceV[o+2];let a=a0,b=a1;for(let e=0;e<3;e++){if(e===1){a=a1;b=a2;}else if(e===2){a=a2;b=a0;}let lo=a,hi=b,dir=1;if(lo>hi){const t=lo;lo=hi;hi=t;dir=-1;}let s=hash2u(lo,hi)&mask;while(count[s]&&!(ea[s]===lo&&eb[s]===hi))s=(s+1)&mask;if(!count[s]){ea[s]=lo;eb[s]=hi;count[s]=1;f0[s]=fi;d0[s]=dir;}else{if(count[s]===1){f1[s]=fi;d1[s]=dir;}if(count[s]<3)count[s]++;}}
  }
  const degree=new Uint32Array(faceCount);let manifold=0;for(let s=0;s<cap;s++){const c=count[s];if(!c)continue;if(c===1)stats.boundaryEdges++;else if(c!==2)stats.nonManifoldEdges++;else{degree[f0[s]]++;degree[f1[s]]++;manifold++;}}
  const off=new Uint32Array(faceCount+1);for(let i=0;i<faceCount;i++)off[i+1]=off[i]+degree[i];const cur=off.slice(0,faceCount),adjFace=new Uint32Array(manifold*2),adjDiff=new Uint8Array(manifold*2);
  for(let s=0;s<cap;s++)if(count[s]===2){const a=f0[s],b=f1[s],diff=d0[s]===d1[s]?1:0;let w=cur[a]++;adjFace[w]=b;adjDiff[w]=diff;w=cur[b]++;adjFace[w]=a;adjDiff[w]=diff;}
  return {cap,ea,eb,count,off,adjFace,adjDiff};
}

function analyzeAndRepairFlat(pos,faceV,faceCount,stats){
  const edges=buildEdgeIncidence(faceV,faceCount,stats),flip=new Int8Array(faceCount);flip.fill(-1);const queue=new Uint32Array(faceCount),compFaces=new Uint32Array(faceCount),compOff=new Uint32Array(faceCount+1);let compCount=0,write=0;
  for(let root=0;root<faceCount;root++)if(flip[root]<0){const start=write;let qh=0,qt=0,ones=0;queue[qt++]=root;flip[root]=0;while(qh<qt){const f=queue[qh++];compFaces[write++]=f;if(flip[f])ones++;for(let k=edges.off[f];k<edges.off[f+1];k++){const g=edges.adjFace[k],want=flip[f]^edges.adjDiff[k];if(flip[g]<0){flip[g]=want;queue[qt++]=g;}else if(flip[g]!==want)stats.windingConflicts++;}}if(ones*2>(write-start))for(let k=start;k<write;k++)flip[compFaces[k]]^=1;compOff[compCount++]=start;compOff[compCount]=write;}
  for(let f=0;f<faceCount;f++)if(flip[f]>0){const o=f*3,t=faceV[o+1];faceV[o+1]=faceV[o+2];faceV[o+2]=t;stats.windingRepairs++;}
  stats.quality=(stats.boundaryEdges||stats.nonManifoldEdges||stats.windingConflicts)?1:0;
  if(stats.quality===0&&compCount){const lo=new Float64Array(compCount*3),hi=new Float64Array(compCount*3),probe=new Float64Array(compCount*3),v6=new Float64Array(compCount);lo.fill(Infinity);hi.fill(-Infinity);
    for(let ci=0;ci<compCount;ci++){let have=false,sv=0;for(let k=compOff[ci];k<compOff[ci+1];k++){const fi=compFaces[k],o=fi*3,ia=faceV[o]*3,ib=faceV[o+1]*3,ic=faceV[o+2]*3;if(!have){probe[ci*3]=(pos[ia]+pos[ib]+pos[ic])/3;probe[ci*3+1]=(pos[ia+1]+pos[ib+1]+pos[ic+1])/3;probe[ci*3+2]=(pos[ia+2]+pos[ib+2]+pos[ic+2])/3;have=true;}const ax=pos[ia],ay=pos[ia+1],az=pos[ia+2],bx=pos[ib],by=pos[ib+1],bz=pos[ib+2],cx=pos[ic],cy=pos[ic+1],cz=pos[ic+2];sv+=ax*(by*cz-bz*cy)+ay*(bz*cx-bx*cz)+az*(bx*cy-by*cx);const ids=[ia,ib,ic];for(let z=0;z<3;z++){const q=ids[z],x=pos[q],y=pos[q+1],zz=pos[q+2],b=ci*3;if(x<lo[b])lo[b]=x;if(y<lo[b+1])lo[b+1]=y;if(zz<lo[b+2])lo[b+2]=zz;if(x>hi[b])hi[b]=x;if(y>hi[b+1])hi[b+1]=y;if(zz>hi[b+2])hi[b+2]=zz;}}v6[ci]=sv;}
    for(let ci=0;ci<compCount;ci++){let depth=0;const b0=ci*3,px=probe[b0],py=probe[b0+1],pz=probe[b0+2];for(let cj=0;cj<compCount;cj++)if(ci!==cj){const b=cj*3,sc=Math.max(1,Math.abs(lo[b]),Math.abs(lo[b+1]),Math.abs(lo[b+2]),Math.abs(hi[b]),Math.abs(hi[b+1]),Math.abs(hi[b+2])),eps=sc*1e-12;if(px<=lo[b]-eps||px>=hi[b]+eps||py<=lo[b+1]-eps||py>=hi[b+1]+eps||pz<=lo[b+2]-eps||pz>=hi[b+2]+eps)continue;const r=pointInsideShellFlat(pos,faceV,compFaces,compOff[cj],compOff[cj+1],px,py,pz);if(r.inside)depth++;if(!r.certain)stats.shellNestingAmbiguous++;}const wantNegative=(depth&1)!==0,haveNegative=v6[ci]<0;if(wantNegative!==haveNegative){for(let k=compOff[ci];k<compOff[ci+1];k++){const o=compFaces[k]*3,t=faceV[o+1];faceV[o+1]=faceV[o+2];faceV[o+2]=t;}stats.windingRepairs+=compOff[ci+1]-compOff[ci];}}
    if(stats.shellNestingAmbiguous)stats.quality=1;
  }
  return {edges,compFaces:compFaces.subarray(0,faceCount),compOff:compOff.subarray(0,compCount+1),compCount};
}

function buildRenderFlat(pos,faceV,faceCount){
  const triV=faceV;const triE=new Uint32Array(faceCount*3),triFace=new Uint32Array(faceCount);const cap=nextPow2(faceCount*6+8),mask=cap-1,ea=new Uint32Array(cap),eb=new Uint32Array(cap),eid=new Uint32Array(cap);let nextE=0;
  function edge(a,b){let lo=a,hi=b;if(lo>hi){const t=lo;lo=hi;hi=t;}let s=hash2u(lo,hi)&mask;while(eid[s]&&!(ea[s]===lo&&eb[s]===hi))s=(s+1)&mask;if(!eid[s]){ea[s]=lo;eb[s]=hi;eid[s]=++nextE;}return eid[s]-1;}
  for(let fi=0;fi<faceCount;fi++){const o=fi*3,a=triV[o],b=triV[o+1],c=triV[o+2];triE[o]=edge(a,b);triE[o+1]=edge(b,c);triE[o+2]=edge(c,a);triFace[fi]=fi;}
  return {pos,triV,triE,triFace,triCount:faceCount,faceCount,edgeCount:nextE};
}

export function prepareMeshFlat(positions,indices,{profile=false}={}){
  const timing=profile?{}:null,t0=profile?performance.now():0,inputVertices=Math.floor(positions.length/3),inputTriangles=Math.floor(indices.length/3),stats={inputVertices,inputTriangles,weldedVertices:0,keptTriangles:0,droppedDegenerate:0,droppedDuplicate:0,boundaryEdges:0,nonManifoldEdges:0,windingRepairs:0,windingConflicts:0,shellNestingAmbiguous:0,quality:0};
  const remap=new Uint32Array(inputVertices);remap.fill(UINT32_MAX);const posStore=new Float64Array(inputVertices*3),pcap=nextPow2(inputVertices*2+8),pmask=pcap-1,pslot=new Uint32Array(pcap);let pcount=0,scale=1;
  for(let i=0;i<inputVertices;i++){let x=+positions[i*3],y=+positions[i*3+1],z=+positions[i*3+2];if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z))continue;if(x===0)x=0;if(y===0)y=0;if(z===0)z=0;let s=hashPoint(x,y,z)&pmask,id=-1;while(pslot[s]){const q=(pslot[s]-1)*3;if(posStore[q]===x&&posStore[q+1]===y&&posStore[q+2]===z){id=pslot[s]-1;break;}s=(s+1)&pmask;}if(id<0){id=pcount++;const q=id*3;posStore[q]=x;posStore[q+1]=y;posStore[q+2]=z;pslot[s]=id+1;if(Math.abs(x)>scale)scale=Math.abs(x);if(Math.abs(y)>scale)scale=Math.abs(y);if(Math.abs(z)>scale)scale=Math.abs(z);}remap[i]=id;}
  stats.weldedVertices=pcount;const t1=profile?performance.now():0,areaEps2=Math.pow(scale*scale*1e-14,2),faceStore=new Uint32Array(inputTriangles*3),tcap=nextPow2(inputTriangles*2+8),tmask=tcap-1,used=new Uint8Array(tcap),ka=new Uint32Array(tcap),kb=new Uint32Array(tcap),kc=new Uint32Array(tcap);let faceCount=0;
  for(let t=0;t<inputTriangles;t++){const io=t*3,ia=indices[io]>>>0,ib=indices[io+1]>>>0,ic=indices[io+2]>>>0;if(ia>=inputVertices||ib>=inputVertices||ic>=inputVertices||remap[ia]===UINT32_MAX||remap[ib]===UINT32_MAX||remap[ic]===UINT32_MAX){stats.droppedDegenerate++;continue;}const a=remap[ia],b=remap[ib],c=remap[ic];if(a===b||b===c||c===a){stats.droppedDegenerate++;continue;}const ao=a*3,bo=b*3,co=c*3,abx=posStore[bo]-posStore[ao],aby=posStore[bo+1]-posStore[ao+1],abz=posStore[bo+2]-posStore[ao+2],acx=posStore[co]-posStore[ao],acy=posStore[co+1]-posStore[ao+1],acz=posStore[co+2]-posStore[ao+2],nx=aby*acz-abz*acy,ny=abz*acx-abx*acz,nz=abx*acy-aby*acx;if(nx*nx+ny*ny+nz*nz<=areaEps2){stats.droppedDegenerate++;continue;}let sa=a,sb=b,sc=c,tmp;if(sa>sb){tmp=sa;sa=sb;sb=tmp;}if(sb>sc){tmp=sb;sb=sc;sc=tmp;}if(sa>sb){tmp=sa;sa=sb;sb=tmp;}let s=hash3u(sa,sb,sc)&tmask;while(used[s]&&!(ka[s]===sa&&kb[s]===sb&&kc[s]===sc))s=(s+1)&tmask;if(used[s]){stats.droppedDuplicate++;continue;}used[s]=1;ka[s]=sa;kb[s]=sb;kc[s]=sc;const fo=faceCount*3;faceStore[fo]=a;faceStore[fo+1]=b;faceStore[fo+2]=c;faceCount++;}
  stats.keptTriangles=faceCount;const t2=profile?performance.now():0,pos=posStore.subarray(0,pcount*3),faceV=faceStore.subarray(0,faceCount*3),analysis=analyzeAndRepairFlat(pos,faceV,faceCount,stats),t3=profile?performance.now():0,mesh=buildRenderFlat(pos,faceV,faceCount),t4=profile?performance.now():0;if(profile){timing.weld=t1-t0;timing.cleanup=t2-t1;timing.topology=t3-t2;timing.render=t4-t3;timing.total=t4-t0;stats.timing=timing;}return {mesh,stats,analysis};
}

export function materializePrepared(prepared){const m=prepared.mesh,p=new Array(m.pos.length/3),face=new Array(m.faceCount);for(let i=0;i<p.length;i++){const o=i*3;p[i]=[m.pos[o],m.pos[o+1],m.pos[o+2]];}for(let i=0;i<face.length;i++){const o=i*3;face[i]=[m.triV[o],m.triV[o+1],m.triV[o+2]];}return {p,face,tri:[]};}
export function prepareMeshInput(positions,indices,options={}){const r=prepareMeshFlat(positions,indices,options);return {mesh:materializePrepared(r),flat:r.mesh,stats:r.stats,analysis:r.analysis};}

// Conservative cache: only reuses exact same mathematical mesh version.
// Transform reuse is intentionally NOT claimed here because frozen R2 preflight welds exact
// transformed coordinates; changing that boundary requires an integration-level parity proof.
export class PreparedMeshCache{
  constructor(){this.map=new Map();this.hits=0;this.misses=0;}
  get(key,version){const r=this.map.get(key);if(r&&r.version===version){this.hits++;return r.prepared;}this.misses++;return null;}
  set(key,version,prepared){this.map.set(key,{version,prepared});return prepared;}
  prepare(key,version,positions,indices,options){return this.get(key,version)??this.set(key,version,prepareMeshFlat(positions,indices,options));}
  invalidate(key){this.map.delete(key);}
  clear(){this.map.clear();}
  stats(){return {entries:this.map.size,hits:this.hits,misses:this.misses};}
}
