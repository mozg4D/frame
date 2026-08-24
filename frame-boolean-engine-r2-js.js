// Frozen R2 JS engine — Stage 3 classification/band/assembly port.
// Consumes Stage 1/2 preflight, discovery, planar/coplanar and topology modules.
import {prepareMeshFlat} from './frame-boolean-preflight-r2-js.js?v=production-6-js-r2';
import {discover} from './frame-boolean-discovery-r2-js.js?v=production-6-js-r2';
import {buildPlanarCache} from './frame-boolean-planar-r2-js.js?v=production-6-js-r2';
import {resolveCoplanar} from './frame-boolean-coplanar-r2-js.js?v=production-6-js-r2';
import {buildDetailedHits,canonicalizeAndSplit} from './frame-boolean-topology-r2-js.js?v=production-6-js-r2';

export const Operation={Union:0,Difference:1,Intersection:2};
export const Label={Outside:0,Inside:1,Ambiguous:-1};
const UINT32_MAX=0xffffffff;
const DIRS=new Float64Array([
  1,.1732050807568877,.317837245195782, .2718281828459045,1,.4142135623730951, .6180339887498948,.233,1,
  -1,.3819660112501052,.271, .7071067811865476,-1,.2236067977499789, .347,.6180339887498948,-1,
  1,1,.5773502691896258, 1,-.7548776662466927,.5698402909980532, -.4384471871911697,1,.8982444017039272,
  .9238795325112867,.3826834323650898,-.611, -.8090169943749475,.5877852522924731,.431, .30901699437494745,-.9510565162951535,.733,
  .5773502691896258,.5773502691896258,.5773502691896258, -.2672612419124244,.5345224838248488,.8017837257372732, .8728715609439696,-.4364357804719848,.2182178902359924
]);
const nextPow2=n=>{let c=1;while(c<n)c*=2;return c;};
function hash2(a,b){let x=(Math.imul((a^0x9e3779b9)>>>0,0x85ebca6b)^Math.imul((b^0xc2b2ae35)>>>0,0x27d4eb2f))>>>0;x^=x>>>16;x=Math.imul(x,0x7feb352d);x^=x>>>15;return x>>>0;}
class EdgeSet{
  constructor(n=16){const c=nextPow2(Math.max(16,n*2));this.mask=c-1;this.used=new Uint8Array(c);this.a=new Uint32Array(c);this.b=new Uint32Array(c);}
  add(a,b){if(a>b){const t=a;a=b;b=t;}let s=hash2(a,b)&this.mask;while(this.used[s]&&!(this.a[s]===a&&this.b[s]===b))s=(s+1)&this.mask;if(this.used[s])return false;this.used[s]=1;this.a[s]=a;this.b[s]=b;return true;}
  has(a,b){if(a>b){const t=a;a=b;b=t;}let s=hash2(a,b)&this.mask;while(this.used[s]){if(this.a[s]===a&&this.b[s]===b)return true;s=(s+1)&this.mask;}return false;}
}
function seamToEdgeSet(seam,nHint){const S=new EdgeSet(nHint);for(const k of seam){const p=k.indexOf(','),a=Number(k.slice(0,p))>>>0,b=Number(k.slice(p+1))>>>0;S.add(a,b);}return S;}
function buildFaceTopo(M,off=0){
  // R2 source faces after preflight are triangles; triFace is identity, but keep mapping generic.
  const fc=M.faceCount,deg=new Uint32Array(fc),cap=nextPow2(fc*6+8),mask=cap-1,used=new Uint8Array(cap),ea=new Uint32Array(cap),eb=new Uint32Array(cap),f0=new Int32Array(cap),f1=new Int32Array(cap);f0.fill(-1);f1.fill(-1);
  const tv=M.triV;for(let f=0;f<fc;f++){const o=f*3;for(let e=0;e<3;e++){let a=off+tv[o+e],b=off+tv[o+(e+1)%3];if(a>b){const t=a;a=b;b=t;}let s=hash2(a,b)&mask;while(used[s]&&!(ea[s]===a&&eb[s]===b))s=(s+1)&mask;if(!used[s]){used[s]=1;ea[s]=a;eb[s]=b;f0[s]=f;}else if(f1[s]<0&&f0[s]!==f){f1[s]=f;deg[f0[s]]++;deg[f]++;}}
  }
  const adjOff=new Uint32Array(fc+1);for(let f=0;f<fc;f++)adjOff[f+1]=adjOff[f]+deg[f];const cur=adjOff.slice(0,fc),adj=new Uint32Array(adjOff[fc]);for(let s=0;s<cap;s++)if(used[s]&&f0[s]>=0&&f1[s]>=0){let w=cur[f0[s]]++;adj[w]=f1[s];w=cur[f1[s]]++;adj[w]=f0[s];}
  return{cap,mask,used,ea,eb,f0,f1,adjOff,adj};
}
function edgeNeighbor(T,a,b,face){if(a>b){const t=a;a=b;b=t;}let s=hash2(a,b)&T.mask;while(T.used[s]){if(T.ea[s]===a&&T.eb[s]===b){const x=T.f0[s]===face?T.f1[s]:(T.f1[s]===face?T.f0[s]:-1);return x;}s=(s+1)&T.mask;}return -1;}
function faceCent(M,f){const o=f*3,t=M.triV,p=M.pos,a=t[o]*3,b=t[o+1]*3,c=t[o+2]*3;return[(p[a]+p[b]+p[c])/3,(p[a+1]+p[b+1]+p[c+1])/3,(p[a+2]+p[b+2]+p[c+2])/3];}
function pieceCent(piece,pool){const a=piece[0]*3,b=piece[1]*3,c=piece[2]*3;return[(pool[a]+pool[b]+pool[c])/3,(pool[a+1]+pool[b+1]+pool[c+1])/3,(pool[a+2]+pool[b+2]+pool[c+2])/3];}

export function rayVote(M,ox,oy,oz,dx,dy,dz){
  const dl=Math.hypot(dx,dy,dz);dx/=Math.max(dl,1e-30);dy/=Math.max(dl,1e-30);dz/=Math.max(dl,1e-30);let hits=0;const eps=1e-11,tv=M.triV,p=M.pos;
  for(let t=0;t<M.triCount;t++){const o=t*3,ia=tv[o]*3,ib=tv[o+1]*3,ic=tv[o+2]*3,ax=p[ia],ay=p[ia+1],az=p[ia+2],e1x=p[ib]-ax,e1y=p[ib+1]-ay,e1z=p[ib+2]-az,e2x=p[ic]-ax,e2y=p[ic+1]-ay,e2z=p[ic+2]-az,px=dy*e2z-dz*e2y,py=dz*e2x-dx*e2z,pz=dx*e2y-dy*e2x,det=e1x*px+e1y*py+e1z*pz;if(Math.abs(det)<1e-14)continue;const inv=1/det,sx=ox-ax,sy=oy-ay,sz=oz-az,u=(sx*px+sy*py+sz*pz)*inv;if(u<-eps||u>1+eps)continue;const qx=sy*e1z-sz*e1y,qy=sz*e1x-sx*e1z,qz=sx*e1y-sy*e1x,v=(dx*qx+dy*qy+dz*qz)*inv;if(v<-eps||u+v>1+eps)continue;const tt=(e2x*qx+e2y*qy+e2z*qz)*inv;if(tt<=1e-10)continue;if(u<eps||v<eps||1-u-v<eps)return -1;hits++;}
  return hits&1;
}
export function classifyPoint(M,p){let yes=0,no=0;for(let i=0;i<DIRS.length;i+=3){const v=rayVote(M,p[0],p[1],p[2],DIRS[i],DIRS[i+1],DIRS[i+2]);if(v<0)continue;if(v)yes++;else no++;}const n=yes+no;if(n<5)return{label:Label.Ambiguous,confidence:0};const confidence=Math.abs(yes-no)/n;return{label:yes>no?Label.Inside:Label.Outside,confidence};}
function callClass(classifier,operand,p,minConf){const r=classifier(operand,p);return{inside:r.label===Label.Inside,ambiguous:r.label===Label.Ambiguous||r.confidence<minConf};}
function classifyActive(M,hit,T,activeFaces,complete,classifier,other,minConf){
  if(!complete){const id=new Int32Array(M.faceCount);id.fill(-1);const inside=[],q=new Uint32Array(M.faceCount);let seeds=0,ambiguous=false;for(let root=0;root<M.faceCount;root++){if(hit[root]||id[root]>=0)continue;const r=callClass(classifier,other,faceCent(M,root),minConf);ambiguous||=r.ambiguous;const ci=inside.length;inside.push(r.inside?1:0);seeds++;let h=0,n=0;q[n++]=root;id[root]=ci;while(h<n){const u=q[h++];for(let k=T.adjOff[u];k<T.adjOff[u+1];k++){const v=T.adj[k];if(!hit[v]&&id[v]<0){id[v]=ci;q[n++]=v;}}}}return{id,inside:Uint8Array.from(inside),seeds,ambiguous};}
  const id=new Int32Array(M.faceCount);id.fill(-2);const active=new Uint8Array(M.faceCount);for(const f of activeFaces)if(f<M.faceCount)active[f]=1;for(let f=0;f<M.faceCount;f++)if(hit[f])active[f]=1;for(let f=0;f<M.faceCount;f++)if(active[f]&&!hit[f])id[f]=-1;const inside=[],q=new Uint32Array(M.faceCount);let seeds=0,ambiguous=false;
  for(let root=0;root<M.faceCount;root++){if(id[root]!==-1)continue;let touchesOutside=false,h=0,n=0;const ci=inside.length;q[n++]=root;id[root]=ci;while(h<n){const u=q[h++];for(let k=T.adjOff[u];k<T.adjOff[u+1];k++){const v=T.adj[k];if(hit[v])continue;if(!active[v]){touchesOutside=true;continue;}if(id[v]===-1){id[v]=ci;q[n++]=v;}}}let lab=false;if(!touchesOutside){const r=callClass(classifier,other,faceCent(M,root),minConf);ambiguous||=r.ambiguous;lab=r.inside;seeds++;}inside.push(lab?1:0);}
  return{id,inside:Uint8Array.from(inside),seeds,ambiguous};
}

function labelBand(pieces,seam,T,hit,C,pool,classifier,other,minConf){
  const n=pieces.length;if(!n)return{labels:new Uint8Array(0),conflicts:0,seeds:0,ambiguous:false};const need=n*3,cap=nextPow2(Math.max(16,need*2)),mask=cap-1,used=new Uint8Array(cap),ea=new Uint32Array(cap),eb=new Uint32Array(cap),owner=new Int32Array(cap),oe=new Uint8Array(cap),cnt=new Uint8Array(cap),nb=new Int32Array(n*3),fl=new Uint8Array(n*3);nb.fill(-1);owner.fill(-1);let conflicts=0;
  for(let i=0;i<n;i++){const p=pieces[i];for(let e=0;e<3;e++){let a=p[e],b=p[(e+1)%3];if(a>b){const t=a;a=b;b=t;}let s=hash2(a,b)&mask;while(used[s]&&!(ea[s]===a&&eb[s]===b))s=(s+1)&mask;if(!used[s]){used[s]=1;ea[s]=a;eb[s]=b;owner[s]=i;oe[s]=e;cnt[s]=1;}else if(cnt[s]===1){const j=owner[s],je=oe[s],f=seam.has(a,b)?1:0;nb[i*3+e]=j;fl[i*3+e]=f;nb[j*3+je]=i;fl[j*3+je]=f;cnt[s]=2;}else{cnt[s]++;conflicts++;}}}
  const lab=new Int8Array(n);lab.fill(-1);const q=new Uint32Array(n);let seeds=0,ambiguous=false;
  for(let i=0;i<n;i++){const p=pieces[i],face=p[3];for(let e=0;e<3;e++)if(nb[i*3+e]<0){const nf=edgeNeighbor(T,p[e],p[(e+1)%3],face);if(nf>=0&&!hit[nf]){let x;if(C.id[nf]>=0)x=C.inside[C.id[nf]];else if(C.id[nf]===-2)x=0;else continue;if(lab[i]<0)lab[i]=x;else if(lab[i]!==x)conflicts++;}}}
  for(let root=0;root<n;root++)if(lab[root]>=0){let h=0,z=0;q[z++]=root;while(h<z){const u=q[h++];for(let e=0;e<3;e++){const v=nb[u*3+e];if(v<0)continue;const x=lab[u]^fl[u*3+e];if(lab[v]<0){lab[v]=x;q[z++]=v;}else if(lab[v]!==x)conflicts++;}}}
  for(let root=0;root<n;root++)if(lab[root]<0){const r=callClass(classifier,other,pieceCent(pieces[root],pool),minConf);ambiguous||=r.ambiguous;seeds++;lab[root]=r.inside?1:0;let h=0,z=0;q[z++]=root;while(h<z){const u=q[h++];for(let e=0;e<3;e++){const v=nb[u*3+e];if(v<0)continue;const x=lab[u]^fl[u*3+e];if(lab[v]<0){lab[v]=x;q[z++]=v;}else if(lab[v]!==x)conflicts++;}}}
  return{labels:Uint8Array.from(lab,x=>x>0?1:0),conflicts,seeds,ambiguous};
}
function boolOccupancy(op,a,b){return op===Operation.Difference?a&&!b:(op===Operation.Union?a||b:a&&b);}
function resolveTwoSided(pieces,pool,op,classifier,minConf,epsRel){const decision=new Uint8Array(pieces.length);let queries=0;for(let i=0;i<pieces.length;i++){const p=pieces[i],ao=p[0]*3,bo=p[1]*3,co=p[2]*3,abx=pool[bo]-pool[ao],aby=pool[bo+1]-pool[ao+1],abz=pool[bo+2]-pool[ao+2],acx=pool[co]-pool[ao],acy=pool[co+1]-pool[ao+1],acz=pool[co+2]-pool[ao+2],bcx=pool[co]-pool[bo],bcy=pool[co+1]-pool[bo+1],bcz=pool[co+2]-pool[bo+2],nx0=aby*acz-abz*acy,ny0=abz*acx-abx*acz,nz0=abx*acy-aby*acx,nl=Math.hypot(nx0,ny0,nz0);if(nl<=1e-24)return{ok:false,decision,queries};const nx=nx0/nl,ny=ny0/nl,nz=nz0/nl,scale=Math.max(Math.hypot(abx,aby,abz),Math.hypot(acx,acy,acz),Math.hypot(bcx,bcy,bcz));if(scale<=1e-15)return{ok:false,decision,queries};const eps=Math.max(1e-15,scale*epsRel),q=pieceCent(p,pool),qm=[q[0]-nx*eps,q[1]-ny*eps,q[2]-nz*eps],qp=[q[0]+nx*eps,q[1]+ny*eps,q[2]+nz*eps],am=classifier(0,qm),bm=classifier(1,qm),ap=classifier(0,qp),bp=classifier(1,qp);queries+=4;for(const r of [am,bm,ap,bp])if(r.label===Label.Ambiguous||r.confidence<minConf)return{ok:false,decision,queries};const fm=boolOccupancy(op,am.label===Label.Inside,bm.label===Label.Inside),fp=boolOccupancy(op,ap.label===Label.Inside,bp.label===Label.Inside);decision[i]=fm===fp?0:(fm&&!fp?1:2);}return{ok:true,decision,queries};}

function compactResult(pool,dsu,indices){const map=new Uint32Array(pool.length/3);map.fill(UINT32_MAX);const outPos=[],outIdx=new Uint32Array(indices.length);for(let i=0;i<indices.length;i++){const h=dsu?dsu.find(indices[i]):indices[i];let q=map[h];if(q===UINT32_MAX){q=outPos.length/3;map[h]=q;const o=h*3;outPos.push(pool[o],pool[o+1],pool[o+2]);}outIdx[i]=q;}return{positions:Float64Array.from(outPos),indices:outIdx};}
function compactSeam(pool,dsu,seamAtoms){if(!seamAtoms?.length)return{seamPositions:new Float64Array(0),seamIndices:new Uint32Array(0)};const map=new Uint32Array(pool.length/3);map.fill(UINT32_MAX);const pos=[],idx=new Uint32Array(seamAtoms.length);for(let i=0;i<seamAtoms.length;i++){const h=dsu?dsu.find(seamAtoms[i]):seamAtoms[i];let q=map[h];if(q===UINT32_MAX){q=pos.length/3;map[h]=q;const o=h*3;pos.push(pool[o],pool[o+1],pool[o+2]);}idx[i]=q;}return{seamPositions:Float64Array.from(pos),seamIndices:idx};}
function combineDisplaySeam(a,cp){
  const sources=[a,{seamPositions:cp?.displaySeamPositions??[],seamIndices:cp?.displaySeamIndices??[]}];
  let scale=1;for(const s of sources)for(const v of s.seamPositions??[])scale=Math.max(scale,Math.abs(v));
  const eps=Math.max(1e-12,scale*1e-10),eps2=eps*eps,inv=1/eps,pts=[],buckets=new Map(),seg=[],seen=new Set();
  const point=(x,y,z)=>{const ix=Math.round(x*inv),iy=Math.round(y*inv),iz=Math.round(z*inv);for(let dz=-1;dz<=1;dz++)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const q=buckets.get(`${ix+dx},${iy+dy},${iz+dz}`);if(!q)continue;for(const id of q){const p=pts[id],ax=p[0]-x,ay=p[1]-y,az=p[2]-z;if(ax*ax+ay*ay+az*az<=eps2)return id;}}const id=pts.length;pts.push([x,y,z]);const k=`${ix},${iy},${iz}`;let q=buckets.get(k);if(!q)buckets.set(k,q=[]);q.push(id);return id;};
  for(const s of sources){const p=s.seamPositions??[],ix=s.seamIndices??[];for(let i=0;i+1<ix.length;i+=2){const ao=ix[i]*3,bo=ix[i+1]*3;if(ao+2>=p.length||bo+2>=p.length)continue;let x=point(p[ao],p[ao+1],p[ao+2]),y=point(p[bo],p[bo+1],p[bo+2]);if(x===y)continue;const k=x<y?`${x},${y}`:`${y},${x}`;if(seen.has(k))continue;seen.add(k);seg.push({a:x,b:y});}}
  if(!seg.length)return{seamPositions:new Float64Array(0),seamIndices:new Uint32Array(0)};
  const inc=Array.from({length:pts.length},()=>[]);for(let i=0;i<seg.length;i++){inc[seg[i].a].push(i);inc[seg[i].b].push(i);}const used=new Uint8Array(seg.length),out=[];
  const col=(i,j,v)=>{const a=seg[i].a===v?seg[i].b:seg[i].a,b=seg[j].a===v?seg[j].b:seg[j].a,A=pts[a],V=pts[v],B=pts[b],x1=A[0]-V[0],y1=A[1]-V[1],z1=A[2]-V[2],x2=B[0]-V[0],y2=B[1]-V[1],z2=B[2]-V[2],l1=x1*x1+y1*y1+z1*z1,l2=x2*x2+y2*y2+z2*z2;if(l1<=eps2||l2<=eps2)return false;const cx=y1*z2-z1*y2,cy=z1*x2-x1*z2,cz=x1*y2-y1*x2;return cx*cx+cy*cy+cz*cz<=l1*l2*1e-20;};
  const walk=(ei,v)=>{const first=v;let e=ei,last=v;while(true){if(used[e])break;used[e]=1;const z=seg[e],w=z.a===v?z.b:z.a;last=w;const q=inc[w];if(q.length!==2)break;const ne=q[0]===e?q[1]:q[0];if(used[ne]||!col(e,ne,w))break;v=w;e=ne;}if(first!==last)out.push([first,last]);};
  for(let i=0;i<seg.length;i++)if(!used[i]){const z=seg[i],qa=inc[z.a],qb=inc[z.b],sa=qa.length!==2||(qa.length===2&&!col(qa[0],qa[1],z.a)),sb=qb.length!==2||(qb.length===2&&!col(qb[0],qb[1],z.b));if(sa||sb)walk(i,sa?z.a:z.b);}
  for(let i=0;i<seg.length;i++)if(!used[i]){used[i]=1;out.push([seg[i].a,seg[i].b]);}
  const remap=new Int32Array(pts.length);remap.fill(-1);const pos=[],idx=new Uint32Array(out.length*2);for(let i=0;i<out.length;i++)for(let e=0;e<2;e++){const h=out[i][e];let q=remap[h];if(q<0){q=pos.length/3;remap[h]=q;pos.push(...pts[h]);}idx[i*2+e]=q;}
  return{seamPositions:Float64Array.from(pos),seamIndices:idx};
}

export function evaluatePrepared(Aprep,Bprep,op,{profile=false,forceP32=-1,p32Policy='js',tolerantConfidence=.60,twoSidedEpsilonRel=1e-6,classifier=null}={}){
  const A=Aprep.mesh??Aprep,B=Bprep.mesh??Bprep,timing=profile?{}:null,t0=profile?performance.now():0;
  const pca=buildPlanarCache(A),pcb=buildPlanarCache(B),t1=profile?performance.now():0,disc=discover(A,B,{forceP32,p32Policy,profile,planarA:pca,planarB:pcb});disc.stats.coplanarPairs=disc.coplanarPairs.length;const t2=profile?performance.now():0,hits=buildDetailedHits(A,B,disc.hitPairs),t3=profile?performance.now():0;
  let cp=null;if(disc.coplanarPairs.length){const copOp=op===Operation.Union?'union':(op===Operation.Difference?'difference':'intersection');const rr=resolveCoplanar(A,B,pca,pcb,copOp,disc.coplanarPairs);if(!rr.ok)return{positions:new Float64Array(0),indices:new Uint32Array(0),ambiguous:true,topologyValid:false,stats:{coplanarFailed:true},preflightA:Aprep.stats,preflightB:Bprep.stats,discovery:disc.stats};cp=rr.out;}
  const topo=canonicalizeAndSplit(A,B,hits,{profile,coplanar:cp}),t4=profile?performance.now():0;if(!topo.ok){return{positions:new Float64Array(0),indices:new Uint32Array(0),ambiguous:true,topologyValid:false,stats:{...topo.stats},preflightA:Aprep.stats,preflightB:Bprep.stats,discovery:disc.stats,topology:topo};}
  const cl=classifier??((operand,p)=>classifyPoint(operand?B:A,p)),TA=buildFaceTopo(A,0),TB=buildFaceTopo(B,A.pos.length/3),t5=profile?performance.now():0,CA=classifyActive(A,topo.hitA,TA,disc.activeFacesA,true,cl,1,tolerantConfidence),CB=classifyActive(B,topo.hitB,TB,disc.activeFacesB,true,cl,0,tolerantConfidence),t6=profile?performance.now():0,seam=seamToEdgeSet(topo.seam,topo.seam.size+16),SA=labelBand(topo.piecesA,seam,TA,topo.hitA,CA,topo.pool,cl,1,tolerantConfidence),SB=labelBand(topo.piecesB,seam,TB,topo.hitB,CB,topo.pool,cl,0,tolerantConfidence),t7=profile?performance.now():0;
  let bandAmbiguous=SA.ambiguous||SB.ambiguous||SA.conflicts>0||SB.conflicts>0,useTwoSided=false,sideA=null,sideB=null,twoSidedFallbackPieces=0,queries=CA.seeds+CB.seeds+SA.seeds+SB.seeds;if(bandAmbiguous){const ra=resolveTwoSided(topo.piecesA,topo.pool,op,cl,tolerantConfidence,twoSidedEpsilonRel),rb=resolveTwoSided(topo.piecesB,topo.pool,op,cl,tolerantConfidence,twoSidedEpsilonRel);twoSidedFallbackPieces=topo.piecesA.length+topo.piecesB.length;queries+=ra.queries+rb.queries;if(ra.ok&&rb.ok){sideA=ra.decision;sideB=rb.decision;useTwoSided=true;bandAmbiguous=false;}}
  let ambiguous=!!topo.stats.ambiguous||CA.ambiguous||CB.ambiguous||bandAmbiguous;const pa=Aprep.stats,pb=Bprep.stats;if(pa&&pb)ambiguous||=!!(pa.nonManifoldEdges||pb.nonManifoldEdges||pa.windingConflicts||pb.windingConflicts||pa.shellNestingAmbiguous||pb.shellNestingAmbiguous);
  const out=[];const keepA=in0=>op===Operation.Intersection?in0:!in0,keepB=in0=>op===Operation.Difference?in0:(op===Operation.Union?!in0:in0),ds=topo.dsu,offB=A.pos.length/3;
  for(let t=0;t<A.triCount;t++){const f=A.triFace[t];if(topo.hitA[f])continue;let inside=false;if(CA.id[f]>=0)inside=!!CA.inside[CA.id[f]];else if(CA.id[f]===-2)inside=false;if(keepA(inside)){const o=t*3;out.push(ds.find(A.triV[o]),ds.find(A.triV[o+1]),ds.find(A.triV[o+2]));}}
  for(let t=0;t<B.triCount;t++){const f=B.triFace[t];if(topo.hitB[f])continue;let inside=false;if(CB.id[f]>=0)inside=!!CB.inside[CB.id[f]];else if(CB.id[f]===-2)inside=false;if(keepB(inside)){const o=t*3,a=ds.find(offB+B.triV[o]),b=ds.find(offB+B.triV[o+1]),c=ds.find(offB+B.triV[o+2]);if(op===Operation.Difference)out.push(a,c,b);else out.push(a,b,c);}}
  if(useTwoSided){for(let i=0;i<topo.piecesA.length;i++){const d=sideA[i];if(!d)continue;const p=topo.piecesA[i],a=ds.find(p[0]);let b=ds.find(p[1]),c=ds.find(p[2]);if(d===2){const z=b;b=c;c=z;}out.push(a,b,c);}for(let i=0;i<topo.piecesB.length;i++){const d=sideB[i];if(!d)continue;const p=topo.piecesB[i],a=ds.find(p[0]);let b=ds.find(p[1]),c=ds.find(p[2]);if(d===2){const z=b;b=c;c=z;}out.push(a,b,c);}}
  else{for(let i=0;i<topo.piecesA.length;i++)if(keepA(!!SA.labels[i])){const p=topo.piecesA[i];out.push(ds.find(p[0]),ds.find(p[1]),ds.find(p[2]));}for(let i=0;i<topo.piecesB.length;i++)if(keepB(!!SB.labels[i])){const p=topo.piecesB[i],a=ds.find(p[0]),b=ds.find(p[1]),c=ds.find(p[2]);if(op===Operation.Difference)out.push(a,c,b);else out.push(a,b,c);}}
  for(const t of topo.cpOut)out.push(t[0],t[1],t[2]);const compact=compactResult(topo.pool,ds,out),seamCompact=combineDisplaySeam(compactSeam(topo.pool,ds,topo.nonCoplanarSeamAtoms??topo.seamAtoms),cp),t8=profile?performance.now():0,stats={...topo.stats,classifierQueries:queries,twoSidedFallbackPieces,bandConflicts:SA.conflicts+SB.conflicts,outputTriangles:out.length/3,seamVertices:seamCompact.seamPositions.length/3,seamSegments:seamCompact.seamIndices.length/2,useTwoSided};if(profile){timing.planar=t1-t0;timing.discovery=t2-t1;timing.hits=t3-t2;timing.topology=t4-t3;timing.faceTopo=t5-t4;timing.classify=t6-t5;timing.band=t7-t6;timing.assembly=t8-t7;timing.total=t8-t0;stats.timing=timing;}
  return{...compact,...seamCompact,ambiguous,topologyValid:!ambiguous,stats,preflightA:Aprep.stats,preflightB:Bprep.stats,discovery:disc.stats,topology:topo};
}

export function evaluate(positionsA,indicesA,positionsB,indicesB,op,options={}){const A=prepareMeshFlat(positionsA,indicesA,{profile:options.profile}),B=prepareMeshFlat(positionsB,indicesB,{profile:options.profile});if(!A.mesh.faceCount||!B.mesh.faceCount)return{positions:new Float64Array(0),indices:new Uint32Array(0),ambiguous:true,topologyValid:false,preflightA:A.stats,preflightB:B.stats,stats:{emptyInput:true}};return evaluatePrepared(A,B,op,options);}
