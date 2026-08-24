// Fast planar overlay for frozen R2 coplanar contract.
// It nodes only source boundaries, extracts the Boolean result boundary directly,
// triangulates only final polygon components, and falls back on branchy degeneracies.
import {triangulatePSLGCore} from './frame-boolean-pslg-r2-js.js?v=production-6-js-r2';
import {FeatureKind} from './frame-boolean-topology-r2-js.js?v=production-6-js-r2';
export const CoplanarVertexKind={SourceVertexA:0,SourceVertexB:1,FeaturePair:2};
const uk=(a,b)=>a<b?`${a},${b}`:`${b},${a}`;
function frame(M,patch,normal){if(patch.outer.vertices.length<2)return null;const p=M.pos,o0=patch.outer.vertices[0]*3,ox=p[o0],oy=p[o0+1],oz=p[o0+2],n=normal,Ln=Math.hypot(...n);if(Ln<1e-20)return null;const nx=n[0]/Ln,ny=n[1]/Ln,nz=n[2]/Ln;let ux=0,uy=0,uz=0,ul=0;for(let i=1;i<patch.outer.vertices.length;i++){const q=patch.outer.vertices[i]*3,dx=p[q]-ox,dy=p[q+1]-oy,dz=p[q+2]-oz,dot=dx*nx+dy*ny+dz*nz;ux=dx-dot*nx;uy=dy-dot*ny;uz=dz-dot*nz;ul=Math.hypot(ux,uy,uz);if(ul>1e-20)break;}if(ul<1e-20)return null;ux/=ul;uy/=ul;uz/=ul;let vx=ny*uz-nz*uy,vy=nz*ux-nx*uz,vz=nx*uy-ny*ux,vl=Math.hypot(vx,vy,vz);if(vl<.5)return null;vx/=vl;vy/=vl;vz/=vl;ux=vy*nz-vz*ny;uy=vz*nx-vx*nz;uz=vx*ny-vy*nx;return{ox,oy,oz,ux,uy,uz,vx,vy,vz};}
const proj=(F,p,i)=>{const o=i*3,dx=p[o]-F.ox,dy=p[o+1]-F.oy,dz=p[o+2]-F.oz;return{x:dx*F.ux+dy*F.uy+dz*F.uz,y:dx*F.vx+dy*F.vy+dz*F.vz};};
const unproj=(F,q)=>[F.ox+F.ux*q.x+F.vx*q.y,F.oy+F.uy*q.x+F.vy*q.y,F.oz+F.uz*q.x+F.vz*q.y];
function segD2(p,a,b){const x=b.x-a.x,y=b.y-a.y,L=x*x+y*y;if(L<1e-30)return{d:(p.x-a.x)**2+(p.y-a.y)**2,t:0};const t=((p.x-a.x)*x+(p.y-a.y)*y)/L,tc=Math.max(0,Math.min(1,t)),qx=a.x+x*tc,qy=a.y+y*tc;return{d:(p.x-qx)**2+(p.y-qy)**2,t};}
function loopClass(q,loop,eps2){let inside=false;for(let i=0,j=loop.length-1;i<loop.length;j=i++){const a=loop[j],b=loop[i],d=segD2(q,a,b);if(d.d<=eps2)return 0;const hit=((a.y>q.y)!==(b.y>q.y))&&(q.x<(b.x-a.x)*(q.y-a.y)/(b.y-a.y)+a.x);if(hit)inside=!inside;}return inside?1:-1;}
function patch2(M,p,F){const loop=L=>L.vertices.map(v=>proj(F,M.pos,v));return{outer:loop(p.outer),holes:p.holes.map(loop)};}
function inPatch(q,p,eps2){const o=loopClass(q,p.outer,eps2);if(o<0)return false;if(o===0)return true;for(const h of p.holes){const z=loopClass(q,h,eps2);if(z>=0)return false;}return true;}
function inUnion(q,ps,eps2){for(const p of ps)if(inPatch(q,p,eps2))return true;return false;}
function addEdges(M,patch,F,owner,patchId,out){const add=L=>{for(let i=0;i<L.vertices.length;i++){const a=L.vertices[i],b=L.vertices[(i+1)%L.vertices.length];out.push({owner,patchId,id:L.edges[i],a,b,p:proj(F,M.pos,a),q:proj(F,M.pos,b)});}};add(patch.outer);for(const h of patch.holes)add(h);}
function addNodeFactory(eps,eps2){const nodes=[],buckets=new Map(),inv=1/eps;function add(p){const ix=Math.round(p.x*inv),iy=Math.round(p.y*inv);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const a=buckets.get(`${ix+dx},${iy+dy}`);if(!a)continue;for(const id of a){const q=nodes[id],x=q.x-p.x,y=q.y-p.y;if(x*x+y*y<=eps2)return id;}}const id=nodes.length;nodes.push({x:p.x,y:p.y,inc:[]});const k=`${ix},${iy}`;let a=buckets.get(k);if(!a)buckets.set(k,a=[]);a.push(id);return id;}return{nodes,add};}
function nodeEdges(edges,scale){const eps=Math.max(1e-14,scale*1e-12),eps2=Math.max(1e-30,scale*scale*1e-24),N=addNodeFactory(eps,eps2),cuts=edges.map(()=>[]);for(let e=0;e<edges.length;e++){const a=N.add(edges[e].p),b=N.add(edges[e].q);cuts[e].push([0,a],[1,b]);}
 const addCut=(e,t,p)=>{if(t< -eps||t>1+eps)return;cuts[e].push([Math.max(0,Math.min(1,t)),N.add(p)]);};
 const A=[],B=[];for(let i=0;i<edges.length;i++)(edges[i].owner?B:A).push(i);
 for(const i of A)for(const j of B){const E=edges[i],Q=edges[j],ax=E.q.x-E.p.x,ay=E.q.y-E.p.y,bx=Q.q.x-Q.p.x,by=Q.q.y-Q.p.y,rx=Q.p.x-E.p.x,ry=Q.p.y-E.p.y,den=ax*by-ay*bx;if(Math.abs(den)>eps){const t=(rx*by-ry*bx)/den,u=(rx*ay-ry*ax)/den;if(t>=-eps&&t<=1+eps&&u>=-eps&&u<=1+eps){const p={x:E.p.x+ax*t,y:E.p.y+ay*t};addCut(i,t,p);addCut(j,u,p);}}else if(Math.abs(rx*ay-ry*ax)<=eps*Math.max(1,Math.hypot(ax,ay))){for(const [p,e0,e1] of [[E.p,i,j],[E.q,i,j],[Q.p,j,i],[Q.q,j,i]]){const q=segD2(p,edges[e1].p,edges[e1].q);if(q.d<=eps2&&q.t>=-eps&&q.t<=1+eps){addCut(e0,segD2(p,edges[e0].p,edges[e0].q).t,p);addCut(e1,q.t,p);}}}}
 const segMap=new Map(),segments=[];for(let e=0;e<edges.length;e++){cuts[e].sort((a,b)=>a[0]-b[0]);const q=[];for(const x of cuts[e])if(!q.length||x[1]!==q[q.length-1][1])q.push(x);for(const x of q){const inc=N.nodes[x[1]].inc;if(!inc.includes(e))inc.push(e);}for(let k=1;k<q.length;k++){const u=q[k-1][1],v=q[k][1];if(u===v)continue;const key=uk(u,v);let s=segMap.get(key);if(!s){s={a:u,b:v,mask:0,leftA:-1,leftB:-1,confA:false,confB:false};segMap.set(key,s);segments.push(s);}const src=edges[e],same=s.a===u&&s.b===v,insideLeftSrc=src.owner===0?true:null; // B filled per group orientation later
 s.mask|=1<<src.owner;const dir=same?1:0;if(src.owner===0){const z=dir?1:0;if(s.leftA<0)s.leftA=z;else if(s.leftA!==z)s.confA=true;}else{s._bDirs??=[];s._bDirs.push(dir);}}}
 return{nodes:N.nodes,segments,eps2,eps};}
function groupPairs(pairs,nA,nB){const byA=Array.from({length:nA},()=>[]),byB=Array.from({length:nB},()=>[]);for(let i=0;i<pairs.length;i++){byA[pairs[i].patchA].push(i);byB[pairs[i].patchB].push(i);}const seen=new Uint8Array(pairs.length),groups=[];for(let root=0;root<pairs.length;root++)if(!seen[root]){const orient0=pairs[root].sameOrientation,plane=pairs[root].planeKey,q=[root],aids=[],bids=[],sa=new Uint8Array(nA),sb=new Uint8Array(nB);seen[root]=1;let valid=true;for(let qi=0;qi<q.length;qi++){const pr=pairs[q[qi]];if(pr.planeKey!==plane||pr.sameOrientation!==orient0){valid=false;break;}if(!sa[pr.patchA]){sa[pr.patchA]=1;aids.push(pr.patchA);for(const e of byA[pr.patchA])if(!seen[e]){seen[e]=1;q.push(e);}}if(!sb[pr.patchB]){sb[pr.patchB]=1;bids.push(pr.patchB);for(const e of byB[pr.patchB])if(!seen[e]){seen[e]=1;q.push(e);}}}groups.push({valid,orient:orient0,plane,aids,bids});}return groups;}

function displayCandidateSegments(ar,pa,pb,op){
  const out=[];
  for(const s of ar.segments){
    // Coincident source boundaries are inherited geometry, not a new Boolean cut line.
    // Only a boundary owned by exactly one operand can delimit the planar overlap.
    if(s.mask!==1&&s.mask!==2)continue;
    const A=ar.nodes[s.a],B=ar.nodes[s.b],mid={x:(A.x+B.x)*.5,y:(A.y+B.y)*.5};
    if(s.mask===1){
      if(op==='difference')continue; // A-B: only B's boundary can cut surviving A.
      if(!inUnion(mid,pb,ar.eps2))continue;
      out.push({a:s.a,b:s.b,owner:0});
    }else{
      if(!inUnion(mid,pa,ar.eps2))continue;
      out.push({a:s.a,b:s.b,owner:1});
    }
  }
  return out;
}
function mergeCollinearDisplay(nodes,segs,scale){
  if(segs.length<2)return segs.slice();
  const result=[];
  for(const owner of [0,1]){
    const src=segs.filter(s=>s.owner===owner);if(!src.length)continue;
    const inc=Array.from({length:nodes.length},()=>[]);
    for(let i=0;i<src.length;i++){inc[src[i].a].push(i);inc[src[i].b].push(i);}
    const used=new Uint8Array(src.length);
    const col=(i,j,v)=>{const a=src[i].a===v?src[i].b:src[i].a,b=src[j].a===v?src[j].b:src[j].a,A=nodes[a],V=nodes[v],B=nodes[b],x1=A.x-V.x,y1=A.y-V.y,x2=B.x-V.x,y2=B.y-V.y,l1=x1*x1+y1*y1,l2=x2*x2+y2*y2;if(l1<=1e-30||l2<=1e-30)return false;const cr=x1*y2-y1*x2;return cr*cr<=Math.max(1e-30,l1*l2*1e-24);};
    const walk=(startEdge,startNode)=>{let e=startEdge,v=startNode,first=startNode,last=startNode;while(true){if(used[e])break;used[e]=1;const z=src[e],w=z.a===v?z.b:z.a;last=w;const q=inc[w];if(q.length!==2)break;const ne=q[0]===e?q[1]:q[0];if(used[ne]||!col(e,ne,w))break;v=w;e=ne;}return{a:first,b:last,owner};};
    // Start chains at endpoints, branches, and corners.
    for(let i=0;i<src.length;i++)if(!used[i]){const z=src[i],da=inc[z.a],db=inc[z.b],start=(da.length!==2||(da.length===2&&!col(da[0],da[1],z.a)))?z.a:((db.length!==2||(db.length===2&&!col(db[0],db[1],z.b)))?z.b:-1);if(start>=0){const q=walk(i,start);if(q.a!==q.b)result.push(q);}}
    // Remaining components are closed/fully collinear cycles or numerical edge cases; preserve atoms.
    for(let i=0;i<src.length;i++)if(!used[i]){used[i]=1;result.push(src[i]);}
  }
  return result;
}
function areaLoop(nodes,L){let a=0;for(let i=0;i<L.length;i++){const p=nodes[L[i]],q=nodes[L[(i+1)%L.length]];a+=p.x*q.y-p.y*q.x;}return a*.5;}
function centroidLoop(nodes,L){let x=0,y=0;for(const i of L){x+=nodes[i].x;y+=nodes[i].y;}return{x:x/L.length,y:y/L.length};}
function extractLoops(nodes,dir){const out=Array.from({length:nodes.length},()=>[]),indeg=new Uint16Array(nodes.length);for(let i=0;i<dir.length;i++){const e=dir[i];out[e.a].push(i);indeg[e.b]++;}for(let i=0;i<nodes.length;i++)if(out[i].length!==indeg[i]||(out[i].length>1))return null;const used=new Uint8Array(dir.length),loops=[];for(let r=0;r<dir.length;r++)if(!used[r]){const L=[],start=dir[r].a;let e=r;for(let guard=0;guard<=dir.length;guard++){if(used[e])return null;used[e]=1;const z=dir[e];L.push(z.a);if(z.b===start)break;const nx=out[z.b];if(nx.length!==1)return null;e=nx[0];if(guard===dir.length)return null;}if(L.length<3)return null;loops.push(L);}return loops;}
function boolPred(kind,a,b){if(kind===0)return a||b;if(kind===1)return a&&!b;if(kind===2)return a&&b;if(kind===3)return a&&!b;if(kind===4)return b&&!a;if(kind===5)return a;return false;}
function triangulateSimpleLoop(nodes,L){
  const n=L.length;if(n<3)return null;
  let scale=1;for(const id of L){const q=nodes[id];scale=Math.max(scale,Math.abs(q.x),Math.abs(q.y));}
  const eps=scale*scale*1e-14,poly=L.slice(),out=[];
  if(areaLoop(nodes,poly)<0)poly.reverse();
  const ori=(a,b,c)=>{const A=nodes[a],B=nodes[b],C=nodes[c];return(B.x-A.x)*(C.y-A.y)-(B.y-A.y)*(C.x-A.x);};
  const inTri=(q,a,b,c)=>{const Q=nodes[q],A=nodes[a],B=nodes[b],C=nodes[c],o0=(B.x-A.x)*(Q.y-A.y)-(B.y-A.y)*(Q.x-A.x),o1=(C.x-B.x)*(Q.y-B.y)-(C.y-B.y)*(Q.x-B.x),o2=(A.x-C.x)*(Q.y-C.y)-(A.y-C.y)*(Q.x-C.x);return o0>=-eps&&o1>=-eps&&o2>=-eps;};
  let guard=0;
  while(poly.length>3&&guard++<n*n*4+32){
    let cut=false;
    for(let i=0;i<poly.length;i++){
      const a=poly[(i+poly.length-1)%poly.length],b=poly[i],c=poly[(i+1)%poly.length];
      if(ori(a,b,c)<=eps)continue;
      let blocked=false;
      for(let j=0;j<poly.length;j++){const q=poly[j];if(q===a||q===b||q===c)continue;if(inTri(q,a,b,c)){blocked=true;break;}}
      if(blocked)continue;
      out.push([a,b,c]);poly.splice(i,1);cut=true;break;
    }
    if(!cut){
      // A purely collinear boundary vertex can become the only blocker after neighboring ears
      // are removed. Drop it from the active ring, but keep it for a later edge split so every
      // original boundary node remains represented by the final triangulation.
      let ci=-1;
      for(let i=0;i<poly.length;i++){const a=poly[(i+poly.length-1)%poly.length],b=poly[i],c=poly[(i+1)%poly.length];if(Math.abs(ori(a,b,c))<=eps){ci=i;break;}}
      if(ci<0)return null;
      const removed=poly[ci],a=poly[(ci+poly.length-1)%poly.length],c=poly[(ci+1)%poly.length];poly.splice(ci,1);
      // Defer reinsertion. Store negative marker in output side list.
      out._removed??=[];out._removed.push([removed,a,c]);
    }
  }
  if(poly.length!==3||ori(poly[0],poly[1],poly[2])<=eps)return null;out.push([poly[0],poly[1],poly[2]]);
  // Reinsert any removed collinear boundary points by splitting the triangle incident to edge a-c.
  for(const [q,a,c] of out._removed??[]){let ti=-1,rev=false;for(let i=0;i<out.length;i++){const t=out[i];for(let e=0;e<3;e++){const u=t[e],v=t[(e+1)%3];if(u===a&&v===c){ti=i;rev=false;break;}if(u===c&&v===a){ti=i;rev=true;break;}}if(ti>=0)break;}if(ti<0)return null;const t=out[ti],x=t.find(v=>v!==a&&v!==c);if(x===undefined)return null;out[ti]=[a,q,x];out.push([q,c,x]);if(ori(...out[ti])<=eps){const z=out[ti][1];out[ti][1]=out[ti][2];out[ti][2]=z;}const nt=out[out.length-1];if(ori(...nt)<=eps){const z=nt[1];nt[1]=nt[2];nt[2]=z;}}
  delete out._removed;return out;
}
function selectBoundary(ar,pa,pb,kind,orient,scale){const dir=[],eps2=Math.max(ar.eps2,scale*scale*1e-22);for(const s of ar.segments){if(s.mask&2){let val=-1,conf=false;for(const d of s._bDirs??[]){const z=(orient?d:1-d);if(val<0)val=z;else if(val!==z)conf=true;}s.leftB=val;s.confB=conf;}const A=ar.nodes[s.a],B=ar.nodes[s.b],mid={x:(A.x+B.x)*.5,y:(A.y+B.y)*.5};let la,ra,lb,rb;if((s.mask&1)&&!s.confA){la=!!s.leftA;ra=!la;}else{const dx=B.x-A.x,dy=B.y-A.y,L=Math.hypot(dx,dy),h=Math.min(L*.1,Math.max(scale*1e-10,L*1e-6)),nx=L?-dy/L:0,ny=L?dx/L:0;la=inUnion({x:mid.x+nx*h,y:mid.y+ny*h},pa,eps2);ra=inUnion({x:mid.x-nx*h,y:mid.y-ny*h},pa,eps2);}if((s.mask&2)&&!s.confB){lb=!!s.leftB;rb=!lb;}else{const dx=B.x-A.x,dy=B.y-A.y,L=Math.hypot(dx,dy),h=Math.min(L*.1,Math.max(scale*1e-10,L*1e-6)),nx=L?-dy/L:0,ny=L?dx/L:0;lb=inUnion({x:mid.x+nx*h,y:mid.y+ny*h},pb,eps2);rb=inUnion({x:mid.x-nx*h,y:mid.y-ny*h},pb,eps2);}const l=boolPred(kind,la,lb),r=boolPred(kind,ra,rb);if(l===r)continue;const seamB=!!(s.mask&2);dir.push(l?{a:s.a,b:s.b,mask:s.mask,seamB}:{a:s.b,b:s.a,mask:s.mask,seamB});}return dir;}
function triangulateLoops(nodes,loops,flip,emit,out){const outer=[],holes=[];for(const L of loops){const a=areaLoop(nodes,L);if(Math.abs(a)<1e-20)return false;(a>0?outer:holes).push(L);}if(!outer.length&&loops.length)return false;const assigns=outer.map(()=>[]);for(const H of holes){const q=centroidLoop(nodes,H);let best=-1,bestArea=Infinity;for(let i=0;i<outer.length;i++){const poly=outer[i].map(id=>nodes[id]);if(loopClass(q,poly,1e-28)>=0){const a=Math.abs(areaLoop(nodes,outer[i]));if(a<bestArea){bestArea=a;best=i;}}}if(best<0)return false;assigns[best].push(H);}for(let oi=0;oi<outer.length;oi++){const O=outer[oi],Hs=assigns[oi];let kept=[],ids,pts;
 if(Hs.length===0){const direct=triangulateSimpleLoop(nodes,O);if(!direct)return false;ids=O.slice();const loc=new Map(ids.map((id,i)=>[id,i]));pts=ids.map(id=>nodes[id]);for(const t of direct){const a=loc.get(t[0]),b=loc.get(t[1]),c=loc.get(t[2]);if(a===undefined||b===undefined||c===undefined)return false;kept.push([a,b,c]);}}
 else {ids=[];const local=new Map();const add=n=>{let i=local.get(n);if(i===undefined){i=ids.length;ids.push(n);local.set(n,i);}return i;};const o=O.map(add),seg=[];for(const H of Hs)for(let i=0;i<H.length;i++)seg.push([add(H[i]),add(H[(i+1)%H.length])]);pts=ids.map(id=>nodes[id]);const tr=triangulatePSLGCore(pts,o,seg);if(!tr.ok)return false;const hp=Hs.map(H=>H.map(id=>nodes[id])),op=O.map(id=>nodes[id]);for(const t of tr.tris){const c={x:(pts[t[0]].x+pts[t[1]].x+pts[t[2]].x)/3,y:(pts[t[0]].y+pts[t[1]].y+pts[t[2]].y)/3};if(loopClass(c,op,1e-28)<0)continue;let hole=false;for(const H of hp)if(loopClass(c,H,1e-28)>=0){hole=true;break;}if(!hole)kept.push(t);}}
 let gotArea=0;for(const t of kept){const a=pts[t[0]],b=pts[t[1]],z=pts[t[2]];gotArea+=Math.abs((b.x-a.x)*(z.y-a.y)-(b.y-a.y)*(z.x-a.x))*.5;}const wantArea=Math.abs(areaLoop(nodes,O))-Hs.reduce((q,H)=>q+Math.abs(areaLoop(nodes,H)),0),tol=Math.max(1e-12,wantArea*1e-10);if(Math.abs(gotArea-wantArea)>tol)return false;for(const t of kept){const a=emit(ids[t[0]]),b=emit(ids[t[1]]),c0=emit(ids[t[2]]);if(a<0||b<0||c0<0)return false;if(flip)out.indices.push(a,c0,b);else out.indices.push(a,b,c0);}}return true;}
export function buildCoplanarDisplaySeam(A,B,ca,cb,op,pairs){
  const positions=[],indices=[];
  if(!pairs.length)return{positions:Float64Array.from(positions),indices:Uint32Array.from(indices)};
  for(const G of groupPairs(pairs,ca.patches.length,cb.patches.length)){
    if(!G.valid||!G.aids.length||!G.bids.length)return null;
    const F=frame(A,ca.patches[G.aids[0]],ca.normal[G.aids[0]]);if(!F)return null;
    const pa=G.aids.map(id=>patch2(A,ca.patches[id],F)),pb=G.bids.map(id=>patch2(B,cb.patches[id],F)),edges=[];
    for(const id of G.aids)addEdges(A,ca.patches[id],F,0,id,edges);
    for(const id of G.bids)addEdges(B,cb.patches[id],F,1,id,edges);
    let scale=1;for(const e of edges)scale=Math.max(scale,Math.abs(e.p.x),Math.abs(e.p.y),Math.abs(e.q.x),Math.abs(e.q.y));
    const ar=nodeEdges(edges,scale),display=mergeCollinearDisplay(ar.nodes,displayCandidateSegments(ar,pa,pb,op),scale);
    for(const e of display){const base=positions.length/3,a=unproj(F,ar.nodes[e.a]),b=unproj(F,ar.nodes[e.b]);positions.push(...a,...b);indices.push(base,base+1);}
  }
  return{positions:Float64Array.from(positions),indices:Uint32Array.from(indices)};
}
export function buildCoplanarPairs(A,B,ca,cb,triPairs){const seen=new Set(),out=[];for(let i=0;i<triPairs.length;i+=2){const ta=triPairs[i],tb=triPairs[i+1],fa=A.triFace[ta],fb=B.triFace[tb],pa=ca.facePatch[fa],pb=cb.facePatch[fb];if(pa<0||pb<0)continue;const k=`${pa},${pb}`;if(seen.has(k))continue;seen.add(k);const na=ca.normal[pa],nb=cb.normal[pb];out.push({patchA:pa,patchB:pb,planeKey:ca.planeKey[pa],sameOrientation:na[0]*nb[0]+na[1]*nb[1]+na[2]*nb[2]>0});}out.sort((x,y)=>x.patchA-y.patchA||x.patchB-y.patchB);return out;}
export function resolveCoplanarFast(A,B,ca,cb,op,pairs){const out={vertices:[],indices:[],consumedFacesA:[],consumedFacesB:[],edgeSplits:[],seamAtoms:[],displaySeamPositions:[],displaySeamIndices:[],ambiguous:false};if(!pairs.length)return{ok:true,out,fast:true};for(const G of groupPairs(pairs,ca.patches.length,cb.patches.length)){if(!G.valid||!G.aids.length||!G.bids.length)return{ok:false,out,fast:false};const F=frame(A,ca.patches[G.aids[0]],ca.normal[G.aids[0]]);if(!F)return{ok:false,out,fast:false};const pa=G.aids.map(id=>patch2(A,ca.patches[id],F)),pb=G.bids.map(id=>patch2(B,cb.patches[id],F)),edges=[];for(const id of G.aids){out.consumedFacesA.push(...ca.patches[id].faces);addEdges(A,ca.patches[id],F,0,id,edges);}for(const id of G.bids){out.consumedFacesB.push(...cb.patches[id].faces);addEdges(B,cb.patches[id],F,1,id,edges);}let scale=1;for(const e of edges)scale=Math.max(scale,Math.abs(e.p.x),Math.abs(e.p.y),Math.abs(e.q.x),Math.abs(e.q.y));const ar=nodeEdges(edges,scale),emitCache=new Int32Array(ar.nodes.length),splitSeen=new Set();emitCache.fill(-1);
 const display=mergeCollinearDisplay(ar.nodes,displayCandidateSegments(ar,pa,pb,op),scale);for(const e of display){const base=out.displaySeamPositions.length/3,a=unproj(F,ar.nodes[e.a]),b=unproj(F,ar.nodes[e.b]);out.displaySeamPositions.push(...a,...b);out.displaySeamIndices.push(base,base+1);}
 function emitNode(ni){if(emitCache[ni]>=0)return emitCache[ni];const p=ar.nodes[ni],on=p.inc,ea=on.find(i=>edges[i].owner===0),eb=on.find(i=>edges[i].owner===1);let va=-1,vb=-1,Ea=ea===undefined?null:edges[ea],Eb=eb===undefined?null:edges[eb];for(const i of on){const e=edges[i],t=segD2(p,e.p,e.q).t;if(e.owner===0){Ea=e;if(Math.abs(t)<1e-9)va=e.a;else if(Math.abs(t-1)<1e-9)va=e.b;}else{Eb=e;if(Math.abs(t)<1e-9)vb=e.a;else if(Math.abs(t-1)<1e-9)vb=e.b;}}const xyz=unproj(F,p);let r;if(va>=0&&vb>=0)r={kind:CoplanarVertexKind.FeaturePair,featurePair:{approxPosition:xyz,featureA:{kind:FeatureKind.Vertex,id:va},featureB:{kind:FeatureKind.Vertex,id:vb}}};else if(va>=0&&Eb)r={kind:CoplanarVertexKind.FeaturePair,featurePair:{approxPosition:xyz,featureA:{kind:FeatureKind.Vertex,id:va},featureB:{kind:FeatureKind.Edge,id:Eb.id}}};else if(vb>=0&&Ea)r={kind:CoplanarVertexKind.FeaturePair,featurePair:{approxPosition:xyz,featureA:{kind:FeatureKind.Edge,id:Ea.id},featureB:{kind:FeatureKind.Vertex,id:vb}}};else if(Ea&&Eb)r={kind:CoplanarVertexKind.FeaturePair,featurePair:{approxPosition:xyz,featureA:{kind:FeatureKind.Edge,id:Ea.id},featureB:{kind:FeatureKind.Edge,id:Eb.id}}};else if(va>=0)r={kind:CoplanarVertexKind.SourceVertexA,sourceVertex:va};else if(vb>=0)r={kind:CoplanarVertexKind.SourceVertexB,sourceVertex:vb};else return -1;const id=out.vertices.length;out.vertices.push(r);emitCache[ni]=id;for(const i of on){const e=edges[i],t=segD2(p,e.p,e.q).t;if(t>1e-9&&t<1-1e-9){const k=`${e.owner},${e.id},${id}`;if(!splitSeen.has(k)){splitSeen.add(k);out.edgeSplits.push({operand:e.owner,sourceEdge:e.id,vertex:id});}}}return id;}
 function pass(kind,flip){const dir=selectBoundary(ar,pa,pb,kind,G.orient,scale),loops=extractLoops(ar.nodes,dir);if(!loops)return 'loops';if(!triangulateLoops(ar.nodes,loops,flip,emitNode,out))return 'triangulate';for(const e of dir)if(e.seamB){const a=emitNode(e.a),b=emitNode(e.b);if(a>=0&&b>=0&&a!==b)out.seamAtoms.push({a,b});}return null;}
 if(G.orient){const kind=op==='union'?0:(op==='difference'?1:2),why=pass(kind,false);if(why)return{ok:false,out,fast:false,reason:why};}else if(op==='union'){let why=pass(3,false);if(why)return{ok:false,out,fast:false,reason:'oppA:'+why};why=pass(4,true);if(why)return{ok:false,out,fast:false,reason:'oppB:'+why};}else if(op==='difference'){const why=pass(5,false);if(why)return{ok:false,out,fast:false,reason:why};}else{/* opposite intersection empty */}
 }
 out.consumedFacesA=[...new Set(out.consumedFacesA)].sort((a,b)=>a-b);out.consumedFacesB=[...new Set(out.consumedFacesB)].sort((a,b)=>a-b);return{ok:true,out,fast:true};}
