// Data-oriented frozen R2 planar patch cache port.
// Semantics match frame_boolean_planar_cache_ref.hpp; hot-path storage uses TypedArrays.
function planeKey(nx,ny,nz,d,eps){
  let x=nx,y=ny,z=nz,dd=d;
  const ax=Math.abs(x)>.5?0:(Math.abs(y)>.5?1:2),s=ax===0?x:(ax===1?y:z);
  if(s<0){x=-x;y=-y;z=-z;dd=-dd;}
  const vals=[Math.round(x/1e-8),Math.round(y/1e-8),Math.round(z/1e-8),Math.round(dd/eps)];
  let h=1469598103934665603n;
  for(const q of vals){h^=BigInt.asUintN(64,BigInt(q));h=BigInt.asUintN(64,h*1099511628211n);}
  return Number(BigInt.asUintN(32,h^(h>>32n)));
}

export function buildPlanarCacheFast(m){
  const n=m.faceCount>>>0, ec=m.edgeCount>>>0, tv=m.triV, te=m.triE, p=m.pos;
  const facePatch=new Int32Array(n); facePatch.fill(-1);
  let scale=1; for(let i=0;i<p.length;i++){const x=Math.abs(p[i]);if(x>scale)scale=x;}
  const eps=scale*1e-9;

  // Face planes, SoA. R2 prepared faces are triangles.
  const nx=new Float64Array(n),ny=new Float64Array(n),nz=new Float64Array(n),pd=new Float64Array(n),valid=new Uint8Array(n);
  for(let f=0;f<n;f++){
    const o=f*3,ia=tv[o]*3,ib=tv[o+1]*3,ic=tv[o+2]*3;
    const ax=p[ia],ay=p[ia+1],az=p[ia+2],ux=p[ib]-ax,uy=p[ib+1]-ay,uz=p[ib+2]-az,vx=p[ic]-ax,vy=p[ic+1]-ay,vz=p[ic+2]-az;
    let x=uy*vz-uz*vy,y=uz*vx-ux*vz,z=ux*vy-uy*vx,L=Math.hypot(x,y,z);
    if(L>1e-14){L=1/L;x*=L;y*=L;z*=L;nx[f]=x;ny[f]=y;nz[f]=z;pd[f]=x*ax+y*ay+z*az;valid[f]=1;}
  }
  const sameRoot=(r,g)=>valid[g]&&nx[r]*nx[g]+ny[r]*ny[g]+nz[r]*nz[g]>1-1e-10&&Math.abs(pd[r]-pd[g])<=eps;

  // edge -> incident face CSR. Equivalent to unordered edge map + all-pairs neighbor graph,
  // but BFS can visit all incident faces directly and avoids materializing O(k^2) adjacency.
  const edgeDeg=new Uint32Array(ec);
  for(let i=0;i<te.length;i++)edgeDeg[te[i]]++;
  const eoff=new Uint32Array(ec+1);for(let e=0;e<ec;e++)eoff[e+1]=eoff[e]+edgeDeg[e];
  const ecur=eoff.slice(0,ec),eface=new Uint32Array(te.length);
  for(let f=0;f<n;f++){const o=f*3;eface[ecur[te[o]]++]=f;eface[ecur[te[o+1]]++]=f;eface[ecur[te[o+2]]++]=f;}

  const patches=[],normal=[],planeKeys=[];let ambiguous=false;
  const queue=new Uint32Array(n),facesBuf=new Uint32Array(n);
  // Component-local edge incidence with generation stamps: O(component boundary), no table clearing.
  const edgeStamp=new Uint32Array(ec),edgeCnt=new Uint32Array(ec),touchedEdges=new Uint32Array(Math.min(te.length,ec||1));let gen=0;
  // Boundary working storage max = 3*component faces.
  const bdA=new Uint32Array(n*3),bdB=new Uint32Array(n*3),bdE=new Uint32Array(n*3),bdNext=new Int32Array(n*3),bdUsed=new Uint8Array(n*3);
  const vcount=(p.length/3)>>>0,head=new Int32Array(vcount),headStamp=new Uint32Array(vcount);let hgen=0;

  for(let root=0;root<n;root++){
    if(facePatch[root]!==-1||!valid[root])continue;
    const pid=patches.length;let qh=0,qt=0,fc=0;queue[qt++]=root;facePatch[root]=pid;
    while(qh<qt){
      const f=queue[qh++];facesBuf[fc++]=f;const o=f*3;
      for(let le=0;le<3;le++){
        const e=te[o+le];
        for(let k=eoff[e];k<eoff[e+1];k++){
          const g=eface[k];
          if(facePatch[g]===-1&&sameRoot(root,g)){facePatch[g]=pid;queue[qt++]=g;}
        }
      }
    }

    if(++gen===0xffffffff){edgeStamp.fill(0);gen=1;}
    let nt=0;
    for(let fi=0;fi<fc;fi++){
      const f=facesBuf[fi],o=f*3;
      for(let le=0;le<3;le++){
        const e=te[o+le];
        if(edgeStamp[e]!==gen){edgeStamp[e]=gen;edgeCnt[e]=1;touchedEdges[nt++]=e;}else edgeCnt[e]++;
      }
    }

    let bdn=0,bad=false;
    for(let fi=0;fi<fc&&!bad;fi++){
      const f=facesBuf[fi],o=f*3;
      for(let le=0;le<3;le++){
        const e=te[o+le];if(edgeCnt[e]!==1)continue;
        bdA[bdn]=tv[o+le];bdB[bdn]=tv[o+(le+1)%3];bdE[bdn]=e;bdn++;
      }
    }
    if(bad||bdn===0){ambiguous=true;for(let fi=0;fi<fc;fi++)facePatch[facesBuf[fi]]=-2;continue;}

    if(++hgen===0xffffffff){headStamp.fill(0);hgen=1;}
    bdUsed.fill(0,0,bdn);
    for(let i=0;i<bdn;i++){
      const a=bdA[i];
      if(headStamp[a]!==hgen){headStamp[a]=hgen;head[a]=-1;}
      bdNext[i]=head[a];head[a]=i;
    }

    const loopStarts=new Uint32Array(bdn),loopLens=new Uint32Array(bdn);let loopCount=0,loopStoreN=0;
    const loopStore=new Uint32Array(bdn);
    for(let si=0;si<bdn;si++)if(!bdUsed[si]){
      const ls=loopStoreN;let cur=si,start=bdA[cur],closed=false;
      for(let guard=0;guard<=bdn;guard++){
        if(bdUsed[cur])break;bdUsed[cur]=1;loopStore[loopStoreN++]=cur;
        const v=bdB[cur];if(v===start){closed=true;break;}
        let nxidx=-1;
        if(headStamp[v]===hgen){for(let z=head[v];z>=0;z=bdNext[z])if(!bdUsed[z]){if(nxidx!==-1){nxidx=-2;break;}nxidx=z;}}
        if(nxidx<0)break;cur=nxidx;
      }
      const ll=loopStoreN-ls;
      if(closed&&ll>=3){loopStarts[loopCount]=ls;loopLens[loopCount]=ll;loopCount++;}else bad=true;
    }
    if(bad||loopCount===0){ambiguous=true;for(let fi=0;fi<fc;fi++)facePatch[facesBuf[fi]]=-2;continue;}

    const anx=Math.abs(nx[root]),any=Math.abs(ny[root]),anz=Math.abs(nz[root]),drop=anx>=any&&anx>=anz?0:(any>=anz?1:2);
    let outer=0,best=-1;
    for(let li=0;li<loopCount;li++){
      const ls=loopStarts[li],ll=loopLens[li];let ar=0;
      for(let j=0;j<ll;j++){
        const be=loopStore[ls+j],ia=bdA[be]*3,ib=bdB[be]*3;
        const x=p[ia],y=p[ia+1],z=p[ia+2],X=p[ib],Y=p[ib+1],Z=p[ib+2],pu=drop===0?y:x,pv=drop===2?y:z,ru=drop===0?Y:X,rv=drop===2?Y:Z;
        ar+=pu*rv-pv*ru;
      }
      ar=Math.abs(ar);if(ar>best){best=ar;outer=li;}
    }
    const mkLoop=li=>{
      const ls=loopStarts[li],ll=loopLens[li],vertices=new Array(ll),edges=new Array(ll);
      for(let j=0;j<ll;j++){const be=loopStore[ls+j];vertices[j]=bdA[be];edges[j]=bdE[be];}
      return{vertices,edges};
    };
    const faces=new Array(fc);for(let i=0;i<fc;i++)faces[i]=facesBuf[i];
    const patch={faces,outer:mkLoop(outer),holes:[]};
    for(let li=0;li<loopCount;li++)if(li!==outer)patch.holes.push(mkLoop(li));
    patches.push(patch);normal.push([nx[root],ny[root],nz[root]]);planeKeys.push(planeKey(nx[root],ny[root],nz[root],pd[root],eps));
  }
  return{patches,facePatch,normal,planeKey:Uint32Array.from(planeKeys),ambiguous,eps};
}

export const buildPlanarCache=buildPlanarCacheFast;
