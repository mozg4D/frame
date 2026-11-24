import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {launch,ready} from '../tools/browser.mjs';

const F=Math.fround;
const qadd=(a,b)=>F(F(a)+F(b)),qsub=(a,b)=>F(F(a)-F(b)),qmul=(a,b)=>F(F(a)*F(b)),qdiv=(a,b)=>F(F(a)/F(b)),qsqrt=a=>F(Math.sqrt(F(a)));
const ROW_START=[0,4,7,9],EIGHT_EPS=F(8*2**-23),ORTHO_TOL=F(2e-7);

function qhypot2(a,b){const s=Math.max(Math.abs(a),Math.abs(b));if(!s)return F(0);const x=qdiv(a,s),y=qdiv(b,s);return qmul(s,qsqrt(qadd(qmul(x,x),qmul(y,y))));}
function qhypot3(a,b,c){const s=Math.max(Math.abs(a),Math.abs(b),Math.abs(c));if(!s)return F(0);const x=qdiv(a,s),y=qdiv(b,s),z=qdiv(c,s);return qmul(s,qsqrt(qadd(qadd(qmul(x,x),qmul(y,y)),qmul(z,z))));}

function qefCreate(n){return {data:new Float32Array(n*16),count:new Uint32Array(n)};}
function qefReset(pool,id,cx=0,cy=0,cz=0){const b=id*16;pool.data.fill(0,b,b+16);pool.data[b+13]=F(cx);pool.data[b+14]=F(cy);pool.data[b+15]=F(cz);pool.count[id]=0;}
function qefAppend(data,base,work){
  for(let k=0;k<4;k++){
    const below=work[k];if(below===0)continue;
    const idx=base+ROW_START[k],diag=data[idx],r=qhypot2(diag,below),c=qdiv(diag,r),s=qdiv(below,r);
    data[idx]=r;work[k]=0;
    for(let j=k+1;j<4;j++){const e=idx+j-k,top=data[e],bot=work[j];data[e]=qadd(qmul(c,top),qmul(s,bot));work[j]=qsub(qmul(c,bot),qmul(s,top));}
  }
}
function qefAddPlane(pool,id,px,py,pz,nx,ny,nz,work){
  px=F(px);py=F(py);pz=F(pz);nx=F(nx);ny=F(ny);nz=F(nz);
  const b=id*16,d=pool.data,x=qsub(px,d[b+13]),y=qsub(py,d[b+14]),z=qsub(pz,d[b+15]),cnt=++pool.count[id];
  if(cnt===1){d[b+10]=x;d[b+11]=y;d[b+12]=z;}
  else{d[b+10]=qadd(d[b+10],qdiv(qsub(x,d[b+10]),cnt));d[b+11]=qadd(d[b+11],qdiv(qsub(y,d[b+11]),cnt));d[b+12]=qadd(d[b+12],qdiv(qsub(z,d[b+12]),cnt));}
  work[0]=nx;work[1]=ny;work[2]=nz;work[3]=qadd(qadd(qmul(nx,x),qmul(ny,y)),qmul(nz,z));
  qefAppend(d,b,work);
}
function qefMerge(dstPool,dstId,srcPool,srcId,work){
  const sCnt=srcPool.count[srcId];if(!sCnt)return;
  const dCnt=dstPool.count[dstId],tot=dCnt+sCnt;dstPool.count[dstId]=tot;
  const dd=dstPool.data,sd=srcPool.data,dst=dstId*16,src=srcId*16;
  const dx=qsub(sd[src+13],dd[dst+13]),dy=qsub(sd[src+14],dd[dst+14]),dz=qsub(sd[src+15],dd[dst+15]);
  const mx=qadd(sd[src+10],dx),my=qadd(sd[src+11],dy),mz=qadd(sd[src+12],dz);
  if(!dCnt){dd[dst+10]=mx;dd[dst+11]=my;dd[dst+12]=mz;}
  else{const w=qdiv(sCnt,tot);dd[dst+10]=qadd(dd[dst+10],qmul(w,qsub(mx,dd[dst+10])));dd[dst+11]=qadd(dd[dst+11],qmul(w,qsub(my,dd[dst+11])));dd[dst+12]=qadd(dd[dst+12],qmul(w,qsub(mz,dd[dst+12])));}
  for(let r=0;r<4;r++){
    work[0]=0;work[1]=0;work[2]=0;work[3]=0;
    const rb=src+ROW_START[r];for(let c=r;c<4;c++)work[c]=sd[rb+c-r];
    if(r<3)work[3]=qadd(work[3],qadd(qadd(qmul(work[0],dx),qmul(work[1],dy)),qmul(work[2],dz)));
    qefAppend(dd,dst,work);
  }
}
function qefEval(pool,id,x,y,z){
  const d=pool.data,b=id*16;
  const e0=qsub(qadd(qadd(qmul(d[b],x),qmul(d[b+1],y)),qmul(d[b+2],z)),d[b+3]);
  const e1=qsub(qadd(qmul(d[b+4],y),qmul(d[b+5],z)),d[b+6]);
  const e2=qsub(qmul(d[b+7],z),d[b+8]);
  return qadd(qadd(qmul(e0,e0),qmul(e1,e1)),qadd(qmul(e2,e2),qmul(d[b+9],d[b+9])));
}
function qefSolveCPU(pool,id,halfSize,relCutoff=1e-5){
  halfSize=F(halfSize);relCutoff=F(relCutoff);
  const count=pool.count[id];if(!count)return [0,0,0,0,0,0,0,0];
  const d=pool.data,base=id*16,w=new Float32Array(64);
  const A=4,V=13,RHS=22,SIGMA=25,CAND=28,DELTA=31,BEST=34,MEAN=37,BASE_R=40,BASE_B=49;
  const cdot=(p,q)=>qadd(qadd(qmul(w[A+p],w[A+q]),qmul(w[A+3+p],w[A+3+q])),qmul(w[A+6+p],w[A+6+q]));
  w[BASE_R]=d[base];w[BASE_R+1]=d[base+1];w[BASE_R+2]=d[base+2];
  w[BASE_R+3]=0;w[BASE_R+4]=d[base+4];w[BASE_R+5]=d[base+5];
  w[BASE_R+6]=0;w[BASE_R+7]=0;w[BASE_R+8]=d[base+7];
  w[BASE_B]=d[base+3];w[BASE_B+1]=d[base+6];w[BASE_B+2]=d[base+8];
  w[MEAN]=d[base+10];w[MEAN+1]=d[base+11];w[MEAN+2]=d[base+12];
  let scale=F(0);
  for(let r=0;r<3;r++){const k=BASE_R+r*3;scale=Math.max(scale,Math.abs(w[BASE_B+r]),qmul(qadd(qadd(Math.abs(w[k]),Math.abs(w[k+1])),Math.abs(w[k+2])),halfSize));}
  const tieAbs=qmul(qmul(EIGHT_EPS,scale),qmul(EIGHT_EPS,scale));
  let bestE=Infinity,bestD=Infinity,rank=0,sMax=0,sMin=0;
  for(let act=0;act<27;act++){
    const sx=act%3,sy=Math.floor(act/3)%3,sz=Math.floor(act/9);
    w[CAND]=sx===0?w[MEAN]:sx===1?F(-halfSize):halfSize;
    w[CAND+1]=sy===0?w[MEAN+1]:sy===1?F(-halfSize):halfSize;
    w[CAND+2]=sz===0?w[MEAN+2]:sz===1?F(-halfSize):halfSize;
    for(let r=0;r<3;r++){
      const k=BASE_R+r*3,a=A+r*3;
      w[a]=sx===0?w[k]:0;w[a+1]=sy===0?w[k+1]:0;w[a+2]=sz===0?w[k+2]:0;
      w[RHS+r]=qsub(w[BASE_B+r],qadd(qadd(qmul(w[k],w[CAND]),qmul(w[k+1],w[CAND+1])),qmul(w[k+2],w[CAND+2])));
    }
    w.fill(0,V,V+9);w[V]=1;w[V+4]=1;w[V+8]=1;
    for(let sweep=0;sweep<16;sweep++){
      let ch=false;
      for(let p=0;p<2;p++)for(let q=p+1;q<3;q++){
        const al=cdot(p,p),be=cdot(q,q);if(!al||!be)continue;
        const ga=cdot(p,q),lim=qmul(ORTHO_TOL,qmul(qsqrt(al),qsqrt(be)));if(Math.abs(ga)<=lim)continue;
        const de=qmul(qsub(be,al),F(0.5)),den=qadd(Math.abs(de),qhypot2(de,ga)),mag=qdiv(Math.abs(ga),den);
        const tan=de===0?F(1):((de>0)===(ga>0)?mag:F(-mag)),c=qdiv(1,qsqrt(qadd(1,qmul(tan,tan)))),s=qmul(c,tan);
        for(let r=0;r<3;r++){const ap=A+r*3+p,aq=A+r*3+q,x=w[ap],y=w[aq];w[ap]=qsub(qmul(c,x),qmul(s,y));w[aq]=qadd(qmul(s,x),qmul(c,y));const vp=V+r*3+p,vq=V+r*3+q,vx=w[vp],vy=w[vq];w[vp]=qsub(qmul(c,vx),qmul(s,vy));w[vq]=qadd(qmul(s,vx),qmul(c,vy));}
        ch=true;
      }
      if(!ch)break;
    }
    let m=F(0);for(let c=0;c<3;c++){w[SIGMA+c]=qhypot3(w[A+c],w[A+3+c],w[A+6+c]);m=Math.max(m,w[SIGMA+c]);}
    w[DELTA]=0;w[DELTA+1]=0;w[DELTA+2]=0;
    let rk=0;if(m>0){const cut=qmul(relCutoff,m);for(let c=0;c<3;c++){const s=w[SIGMA+c];if(!s||s<cut)continue;rk++;const proj=qadd(qadd(qmul(qdiv(w[A+c],s),w[RHS]),qmul(qdiv(w[A+3+c],s),w[RHS+1])),qmul(qdiv(w[A+6+c],s),w[RHS+2]));const coef=qdiv(proj,s);for(let r=0;r<3;r++)w[DELTA+r]=qadd(w[DELTA+r],qmul(w[V+r*3+c],coef));}}
    if(act===0){rank=rk;sMax=Math.max(w[SIGMA],w[SIGMA+1],w[SIGMA+2]);sMin=Math.min(w[SIGMA],w[SIGMA+1],w[SIGMA+2]);}
    if(sx===0)w[CAND]=qadd(w[CAND],w[DELTA]);if(sy===0)w[CAND+1]=qadd(w[CAND+1],w[DELTA+1]);if(sz===0)w[CAND+2]=qadd(w[CAND+2],w[DELTA+2]);
    const x=w[CAND],y=w[CAND+1],z=w[CAND+2];
    if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z)||Math.abs(x)>halfSize||Math.abs(y)>halfSize||Math.abs(z)>halfSize)continue;
    const e=qefEval(pool,id,x,y,z),dx=qsub(x,w[MEAN]),dy=qsub(y,w[MEAN+1]),dz=qsub(z,w[MEAN+2]),dist=qadd(qadd(qmul(dx,dx),qmul(dy,dy)),qmul(dz,dz));
    let take=bestE===Infinity;if(!take){const tie=qadd(tieAbs,qmul(EIGHT_EPS,Math.max(e,bestE)));take=e<qsub(bestE,tie)||(Math.abs(qsub(e,bestE))<=tie&&dist<bestD);}
    if(take){bestE=e;bestD=dist;w[BEST]=x;w[BEST+1]=y;w[BEST+2]=z;}
  }
  return [w[BEST],w[BEST+1],w[BEST+2],bestE,qsqrt(qdiv(bestE,count)),sMax,sMin,rank];
}

function unit(v){const l=Math.hypot(...v)||1;return [F(v[0]/l),F(v[1]/l),F(v[2]/l)];}

function rotatedBox(lo,hi,rx,ry,rz,tx=0,ty=0,tz=0){
  const cx=Math.cos(rx),sx=Math.sin(rx),cy=Math.cos(ry),sy=Math.sin(ry),cz=Math.cos(rz),sz=Math.sin(rz);
  const rot=([x,y,z])=>{
    const y1=cx*y-sx*z,z1=sx*y+cx*z;
    const x2=cy*x+sy*z1,z2=-sy*x+cy*z1;
    return [F(cz*x2-sz*y1+tx),F(sz*x2+cz*y1+ty),F(z2+tz)];
  };
  const corners=[];
  for(let k=0;k<2;k++)for(let j=0;j<2;j++)for(let i=0;i<2;i++)corners.push(...rot([i?hi[0]:lo[0],j?hi[1]:lo[1],k?hi[2]:lo[2]]));
  return {vertices:corners,indices:[0,2,3,0,3,1,4,5,7,4,7,6,0,1,5,0,5,4,2,6,7,2,7,3,0,4,6,0,6,2,1,3,7,1,7,5]};
}
function rotatedCylinder(radius,height,sides,rx,ry,tx=0,ty=0,tz=0){
  const vertices=[],indices=[];
  const cx=Math.cos(rx),sx=Math.sin(rx),cy=Math.cos(ry),sy=Math.sin(ry);
  const xform=([x,y,z])=>{const y1=cx*y-sx*z,z1=sx*y+cx*z;return [F(cy*x+sy*z1+tx),F(y1+ty),F(-sy*x+cy*z1+tz)];};
  for(const z of [0,height])for(let i=0;i<sides;i++){const a=2*Math.PI*i/sides;vertices.push(...xform([radius*Math.cos(a),radius*Math.sin(a),z]));}
  const c0=vertices.length/3;vertices.push(...xform([0,0,0]));
  const c1=vertices.length/3;vertices.push(...xform([0,0,height]));
  for(let i=0;i<sides;i++){
    const j=(i+1)%sides;
    indices.push(i,j,j+sides,i,j+sides,i+sides,c0,j,i,c1,i+sides,j+sides);
  }
  return {vertices,indices};
}
function sphereMesh(radius,subdivisions=2,tx=0,ty=0,tz=0){
  const verts=[0,0,-1, 1,0,0, 0,1,0, -1,0,0, 0,-1,0, 0,0,1];
  let tris=[0,2,1,0,3,2,0,4,3,0,1,4,5,1,2,5,2,3,5,3,4,5,4,1];
  for(let s=0;s<subdivisions;s++){
    const midCache=new Map(),next=[];
    const mid=(a,b)=>{
      const k=a<b?a+':'+b:b+':'+a;if(midCache.has(k))return midCache.get(k);
      const x=verts[3*a]+verts[3*b],y=verts[3*a+1]+verts[3*b+1],z=verts[3*a+2]+verts[3*b+2],l=Math.hypot(x,y,z);
      const id=verts.length/3;verts.push(x/l,y/l,z/l);midCache.set(k,id);return id;
    };
    for(let i=0;i<tris.length;i+=3){
      const a=tris[i],b=tris[i+1],c=tris[i+2],ab=mid(a,b),bc=mid(b,c),ca=mid(c,a);
      next.push(a,ab,ca,ab,b,bc,ca,bc,c,ab,bc,ca);
    }
    tris=next;
  }
  const vertices=[];for(let i=0;i<verts.length;i+=3)vertices.push(F(verts[i]*radius+tx),F(verts[i+1]*radius+ty),F(verts[i+2]*radius+tz));
  return {vertices,indices:tris};
}

function manifoldAudit(vertices,indices,probes=[]){
  const nv=vertices.length/3,slots=new Uint32Array(2**Math.ceil(Math.log2(Math.max(8,indices.length)))),mate=new Uint32Array(indices.length);
  const next=c=>c%3===2?c-2:c+1;
  let sixVol=0,minArea2=Infinity;
  for(let i=0;i<indices.length;i+=3){
    for(let j=0;j<3;j++){
      const c=i+j,a=indices[c],b=indices[next(c)],lo=Math.min(a,b),hi=Math.max(a,b);
      let h=(Math.imul(lo+1,0x9e3779b1)^Math.imul(hi+1,0x85ebca6b));h=Math.imul(h^(h>>>16),0x7feb352d);
      let k=(h^(h>>>15))&(slots.length-1);
      while(slots[k]){
        const p=slots[k]-1,x=indices[p],y=indices[next(p)];
        if(Math.min(x,y)===lo&&Math.max(x,y)===hi){if(mate[p]||x===a)mate[p]=0xffffffff;else{mate[p]=c+1;mate[c]=p+1;}break;}
        k=(k+1)&(slots.length-1);
      }
      if(!slots[k])slots[k]=c+1;
    }
    const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
    const ux=vertices[b]-vertices[a],uy=vertices[b+1]-vertices[a+1],uz=vertices[b+2]-vertices[a+2];
    const vx=vertices[c]-vertices[a],vy=vertices[c+1]-vertices[a+1],vz=vertices[c+2]-vertices[a+2];
    const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
    minArea2=Math.min(minArea2,nx*nx+ny*ny+nz*nz);
    sixVol+=(vertices[a]-vertices[0])*nx+(vertices[a+1]-vertices[1])*ny+(vertices[a+2]-vertices[2])*nz;
  }
  let badEdges=0,badVertexLinks=0;
  for(const e of slots)if(e&&(!mate[e-1]||mate[e-1]===0xffffffff))badEdges++;
  if(!badEdges){
    const seen=new Uint8Array(indices.length),fan=new Uint8Array(nv);
    for(let i=0;i<indices.length;i++)if(!seen[i]){
      const v=indices[i];if(fan[v])badVertexLinks++;fan[v]=1;
      let c=i;do{seen[c]=1;c=next(mate[c]-1);}while(!seen[c]);
    }
  }
  const inside=probes.map(([px,py,pz])=>{
    let w=0;
    for(let i=0;i<indices.length;i+=3){
      const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
      const ax=vertices[a]-px,ay=vertices[a+1]-py,az=vertices[a+2]-pz,bx=vertices[b]-px,by=vertices[b+1]-py,bz=vertices[b+2]-pz,cx=vertices[c]-px,cy=vertices[c+1]-py,cz=vertices[c+2]-pz;
      const la=Math.hypot(ax,ay,az),lb=Math.hypot(bx,by,bz),lc=Math.hypot(cx,cy,cz);
      const det=ax*(by*cz-bz*cy)+ay*(bz*cx-bx*cz)+az*(bx*cy-by*cx);
      const dotSum=la*lb*lc+lc*(ax*bx+ay*by+az*bz)+la*(bx*cx+by*cy+bz*cz)+lb*(cx*ax+cy*ay+cz*az);
      w+=Math.atan2(det,dotSum);
    }
    return w>Math.PI;
  });
  return {badEdges,badVertexLinks,minArea2,volume:sixVol/6,inside,manifold:badEdges===0&&badVertexLinks===0&&minArea2>0&&sixVol>0};
}

export async function uniteQualityGpuChecks(page){
  const checks=[],timings=[],errors=[];
  const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});if(!pass)throw Error(name+': '+JSON.stringify(detail));};
  const call=(name,args={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[name,args]);
  const onErr=e=>errors.push(e.message);
  page.on('pageerror',onErr);
  try{
    await page.evaluate(()=>{
      const d=frameEngine.renderer.device;
      if(d.adapterInfo.isFallbackAdapter)throw Error('Hardware WebGPU adapter required');
      window.__qGpuErrs=[];d.addEventListener('uncapturederror',e=>__qGpuErrs.push(e.error.message));
    });

    // 1. Differential GPU vs CPU QR-QEF test across 8 deterministic cases.
    const pool=qefCreate(8),work=new Float32Array(64),meta=new Uint32Array(8*4),metaView=new DataView(meta.buffer);
    const setMeta=(id,half,cut)=>{meta[4*id]=pool.count[id];metaView.setFloat32(4*(4*id+1),F(half),true);metaView.setFloat32(4*(4*id+2),F(cut),true);};
    // Case 0: Rank-1 plane
    qefReset(pool,0,0,0,0);qefAddPlane(pool,0,0,0,0.2,0,0,1,work);qefAddPlane(pool,0,0.2,0.1,0.2,0,0,1,work);setMeta(0,0.5,1e-5);
    // Case 1: Rank-2 crease
    qefReset(pool,1,0,0,0);qefAddPlane(pool,1,0.2,0,0,1,0,0,work);qefAddPlane(pool,1,0,-0.15,0,0,1,0,work);setMeta(1,0.5,1e-5);
    // Case 2: Rank-3 corner
    qefReset(pool,2,0,0,0);qefAddPlane(pool,2,0.2,0,0,1,0,0,work);qefAddPlane(pool,2,0,-0.15,0,0,1,0,work);qefAddPlane(pool,2,0,0,0.1,0,0,1,work);setMeta(2,0.5,1e-5);
    // Case 3: Antipodal normals
    qefReset(pool,3,0,0,0);qefAddPlane(pool,3,0.1,0,0,1,0,0,work);qefAddPlane(pool,3,-0.1,0,0,-1,0,0,work);setMeta(3,0.5,1e-5);
    // Case 4: Shallow feature (1e-5 tilt retained at cutoff=1e-5)
    const sn=unit([1,2e-4,0]);
    qefReset(pool,4,0,0,0);qefAddPlane(pool,4,0.1,0,0,1,0,0,work);qefAddPlane(pool,4,0.1,0.3,0,...sn,work);setMeta(4,0.5,1e-5);
    // Case 5: Active-set box boundary minimum (unconstrained minimizer outside [-0.5,0.5]^3)
    const nSlant=unit([1,0.2,0]),nSlant2=unit([1,-0.2,0]);
    qefReset(pool,5,0,0,0);qefAddPlane(pool,5,1.2,0,0,...nSlant,work);qefAddPlane(pool,5,1.2,0,0,...nSlant2,work);setMeta(5,0.5,1e-5);
    // Case 6: Large offset (500, -300, 200) mm
    qefReset(pool,6,500,-300,200);qefAddPlane(pool,6,500.25,-300,200,1,0,0,work);qefAddPlane(pool,6,500,-300.125,200,0,1,0,work);qefAddPlane(pool,6,500,-300,200.3,0,0,1,work);setMeta(6,0.5,1e-5);
    // Case 7: Shifted child qefMerge
    const child=qefCreate(2);
    qefReset(child,0,500.25,-299.75,200.25);qefAddPlane(child,0,500.35,-299.75,200.25,1,0,0,work);
    qefReset(child,1,499.75,-300.25,199.75);qefAddPlane(child,1,499.75,-300.125,199.75,0,1,0,work);qefAddPlane(child,1,499.75,-300.25,200.1,0,0,1,work);
    qefReset(pool,7,500,-300,200);qefMerge(pool,7,child,0,work);qefMerge(pool,7,child,1,work);setMeta(7,1.0,1e-5);

    const cpuQef=Array.from({length:8},(_,i)=>qefSolveCPU(pool,i,i===7?1.0:0.5,1e-5));
    const qefStart=performance.now();
    const gpuQef=await page.evaluate(async({d,m})=>{
      const r=await frameEngine.unite.solveQefGPU(new Float32Array(d),new Uint32Array(m),8);
      return Array.from(r.solutions);
    },{d:Array.from(pool.data),m:Array.from(meta)});
    timings.push({name:'GPU QR QEF batch (8 cases)',ms:performance.now()-qefStart});
    let maxPosDiff=0,maxErrDiff=0;
    for(let i=0;i<8;i++){
      const c=cpuQef[i],g=gpuQef.slice(8*i,8*i+8);
      const pd=Math.hypot(c[0]-g[0],c[1]-g[1],c[2]-g[2]),ed=Math.abs(c[4]-g[4]);
      maxPosDiff=Math.max(maxPosDiff,pd);maxErrDiff=Math.max(maxErrDiff,ed);
      check(`QEF differential case ${i} rank and position`,g[7]===c[7]&&pd<1e-4&&ed<1e-4,{i,cpu:c,gpu:g,pd,ed});
    }
    check('GPU QR QEF matches strict f32 CPU reference',maxPosDiff<1e-4&&maxErrDiff<1e-4,{maxPosDiff,maxErrDiff});

    // 2. Differential GPU SDF Relaxation tests (Newton raw grad, flip backtrack, rollback, thin wall, locks, curve, sphere).
    const relaxStart=performance.now();
    const relaxRes=await page.evaluate(async()=>{
      // A. Raw non-unit gradient phi=0.25*z -> 1-step projection lands at z=0.
      const patchP=new Float32Array([0,0,0, 2,0,0, 2,2,0, 0,2,0, 1,1,0.08]);
      const patchI=new Uint32Array([0,1,4, 1,2,4, 2,3,4, 3,0,4]);
      const newtonProp=new Float32Array(patchP);
      const newton=await frameEngine.unite.relaxMeshGPU({positions:patchP,indices:patchI,vertexLocks:new Uint8Array([1,1,1,1,0])},
        {fieldMode:2,origin:[0,0,0],pitch:1},{proposals:newtonProp,projectionIterations:1,epsilonMm:0.1,projectionToleranceMm:1e-5,maxStepMm:1});

      // B. Pure Jacobi flip backtrack (displacement 0.32 <= stepLimit 0.36, x=2.07 flips triangle across x=2) & 1-attempt rollback.
      const flipStart=new Float32Array([0,0,0, 2,0,0, 2,2,0, 0,2,0, 1.75,1,0]);
      const flipProp=new Float32Array(flipStart);flipProp[12]=2.07;
      const backtracked=await frameEngine.unite.relaxMeshGPU({positions:flipStart,indices:patchI,vertexLocks:new Uint8Array([1,1,1,1,0])},
        {fieldMode:2,origin:[0,0,0],pitch:1},{proposals:flipProp,projectionIterations:1,epsilonMm:0.2,maxBacktracks:6,maxStepMm:4,minAreaRatio:0.05});
      const rolledBack=await frameEngine.unite.relaxMeshGPU({positions:flipStart,indices:patchI,vertexLocks:new Uint8Array([1,1,1,1,0])},
        {fieldMode:2,origin:[0,0,0],pitch:1},{proposals:flipProp,projectionIterations:1,epsilonMm:0.2,maxBacktracks:1,maxStepMm:4,minAreaRatio:0.05});

      // C. Opposite thin-wall normal guard: center on +0.1 wall pushed to -0.15 across z=0.
      const wallP=new Float32Array([0,0,0.1, 2,0,0.1, 2,2,0.1, 0,2,0.1, 1,1,0.1]);
      const wallProp=new Float32Array(wallP);wallProp[14]=-0.15;
      const thinWall=await frameEngine.unite.relaxMeshGPU({positions:wallP,indices:patchI,vertexLocks:new Uint8Array([1,1,1,1,0])},
        {fieldMode:3,origin:[0,0,0],pitch:1,halfThickness:0.1},{proposals:wallProp,projectionIterations:2,epsilonMm:0.05,maxBacktracks:2,maxStepMm:2,retainFailedProposals:false});

      // D. Corner/crease freezing + retainFailedProposals with mixed valid/invalid vertex.
      const mixP=new Float32Array([0,0,0, 2,0,0, 2,2,0, 0,2,0, 0.7,1,0, 1.3,1,0]);
      const mixI=new Uint32Array([0,1,5, 0,5,4, 0,4,3, 3,4,2, 4,5,2, 1,2,5]);
      const mixCls=new Uint8Array([0,1,0,1,2,2]);
      const mixProp=new Float32Array(mixP);mixProp[12]=0.9;mixProp[15]=1.1;mixProp[17]=-0.5;
      const mixed=await frameEngine.unite.relaxMeshGPU({positions:mixP,indices:mixI,vertexClass:mixCls},
        {fieldMode:3,origin:[0,0,0],pitch:1,halfThickness:0},{proposals:mixProp,projectionIterations:1,epsilonMm:0.05,maxBacktracks:2,maxStepMm:2,retainFailedProposals:true});

      // E. Curve mode degree-2 circular rim invariance.
      const N=12,rimP=new Float32Array((N+1)*3),rimCls=new Uint8Array(N+1),edgeI=new Uint32Array(N*2),edgeF=new Uint8Array(N).fill(1),rimI=[];
      for(let i=0;i<N;i++){
        const a=2*Math.PI*i/N+(i===1?0.08:0);
        rimP[3*i]=10*Math.cos(a);rimP[3*i+1]=10*Math.sin(a);rimP[3*i+2]=0;rimCls[i]=1;
        edgeI[2*i]=i;edgeI[2*i+1]=(i+1)%N;rimI.push(N,i,(i+1)%N);
      }
      rimP[3*N]=3;rimP[3*N+1]=2;rimP[3*N+2]=0;rimCls[N]=0;
      const curve=await frameEngine.unite.relaxMeshGPU({positions:rimP,indices:new Uint32Array(rimI),vertexClass:rimCls,edgeConstraints:{indices:edgeI,flags:edgeF}},
        {fieldMode:2,origin:[0,0,0],pitch:1},{iterations:2,curveMode:1,curveRadius:10,validateCurveBypass:true,epsilonMm:0.05,damping:0.35});

      // F. Analytic sphere relaxation with tangential jitter -> accepted, watertight, low distance.
      const sv=[0,0,-1, 1,0,0, 0,1,0, -1,0,0, 0,-1,0, 0,0,1];
      let st=[0,2,1,0,3,2,0,4,3,0,1,4,5,1,2,5,2,3,5,3,4,5,4,1];
      for(let s=0;s<3;s++){
        const mc=new Map(),nxt=[];
        const mid=(a,b)=>{const k=a<b?a+':'+b:b+':'+a;if(mc.has(k))return mc.get(k);const x=sv[3*a]+sv[3*b],y=sv[3*a+1]+sv[3*b+1],z=sv[3*a+2]+sv[3*b+2],l=Math.hypot(x,y,z),id=sv.length/3;sv.push(x/l,y/l,z/l);mc.set(k,id);return id;};
        for(let i=0;i<st.length;i+=3){const a=st[i],b=st[i+1],c=st[i+2],ab=mid(a,b),bc=mid(b,c),ca=mid(c,a);nxt.push(a,ab,ca,ab,b,bc,ca,bc,c,ab,bc,ca);}
        st=nxt;
      }
      const sp=new Float32Array(sv.length);
      for(let i=0;i<sv.length;i+=3){
        const j=0.05*Math.sin(i*1.7),nx=sv[i]+j,ny=sv[i+1]-j,nz=sv[i+2],l=Math.hypot(nx,ny,nz);
        sp[i]=10*nx/l;sp[i+1]=10*ny/l;sp[i+2]=10*nz/l;
      }
      const sphereRelax=await frameEngine.unite.relaxMeshGPU({positions:sp,indices:new Uint32Array(st)},
        {fieldMode:1,origin:[0,0,0],pitch:1,radius:10},{iterations:3,damping:0.35,epsilonMm:0.25,maxBacktracks:6});

      return {
        newtonZ:newton.positions[14],newtonStats:newton.stats,
        btStats:backtracked.stats,rbStats:rolledBack.stats,rbSame:rolledBack.positions[12]===flipStart[12],
        thinStats:thinWall.stats,
        mixStats:mixed.stats,mixP12:mixed.positions[12],mixP15:mixed.positions[15],mixCornerMoved:mixed.positions[0]!==mixP[0]||mixed.positions[3]!==mixP[3],
        curveStats:curve.stats,curveRad:Math.hypot(curve.positions[3],curve.positions[4]),
        sphereStats:sphereRelax.stats
      };
    });
    timings.push({name:'GPU SDF relaxation kernel suite',ms:performance.now()-relaxStart});
    check('Raw-gradient Newton projects onto z=0 in 1 step',relaxRes.newtonStats.acceptedIterations===1&&Math.abs(relaxRes.newtonZ)<1e-5,relaxRes);
    check('Jacobi flip triggers half-step backtrack and accepts',relaxRes.btStats.acceptedIterations===1&&relaxRes.btStats.attempts===2&&relaxRes.btStats.failureCounts[3]>=1,relaxRes.btStats);
    check('1-attempt exhaustion rolls back to exact input and re-measures retained mesh',relaxRes.rbStats.acceptedIterations===0&&relaxRes.rbStats.rolledBackIterations===1&&relaxRes.rbSame&&relaxRes.rbStats.finalSampleValidationPassed,relaxRes.rbStats);
    check('Thin-wall opposite normal guard rejects cross-sheet snap',relaxRes.thinStats.acceptedIterations===0&&relaxRes.thinStats.rolledBackIterations===1,relaxRes.thinStats);
    check('Corners/creases freeze and retainFailedProposals keeps valid neighbor move',relaxRes.mixStats.frozenCorners===2&&relaxRes.mixStats.frozenCreases===2&&relaxRes.mixStats.retainedProjectionAttempts>=1&&!relaxRes.mixCornerMoved&&relaxRes.mixP12>0.7&&relaxRes.mixP15===Math.fround(1.3),relaxRes);
    check('Circular curve rim stays on R=10 circle under asymmetric cap fan',relaxRes.curveStats.acceptedIterations===2&&Math.abs(relaxRes.curveRad-10)<1e-3,relaxRes.curveStats);
    check('Smooth sphere relaxes cleanly on GPU within epsilonMm',relaxRes.sphereStats.acceptedIterations===3&&relaxRes.sphereStats.finalSampleValidationPassed&&!relaxRes.sphereStats.certifiedHausdorff,relaxRes.sphereStats);

    // 3. End-to-end Browser Frame Unite checks across rotated, offset, smooth-relaxed & thin/cavity/island scenes.
    await call('scene.new');
    const c1=await call('mesh.create',rotatedBox([-5,-5,-5],[5,5,5],0.47,0.33,0.19,0,0,0));
    const c2=await call('mesh.create',rotatedBox([-5,-5,-5],[5,5,5],-0.29,0.52,-0.11,4.5,1.2,-0.8));
    const t0=performance.now();
    const uCubes=await call('scene.create',{type:'unite',inputs:[c1.hash,c2.hash],params:{resolution:64,smoothing:0,optimize:0,fast:true}});
    timings.push({name:'Rotated intersecting cubes Unite (res 64, Hermite MDC)',ms:performance.now()-t0});
    assert.ifError(uCubes.buildError);
    const cubesMesh=await page.evaluate(async id=>({v:Array.from((await frameEngine.readGeometry(id)).vertices),i:Array.from((await frameEngine.readGeometry(id)).indices)}),uCubes.hash);
    const cubesAudit=manifoldAudit(cubesMesh.v,cubesMesh.i,[[0,0,0],[4.5,1.2,-0.8],[2.25,0.6,-0.4],[25,0,0]]);
    check('Rotated intersecting cubes use Hermite GPU QEF and are watertight',
      uCubes.evaluation.report.extraction==='hermite-mdc-gpu-qef'&&uCubes.evaluation.report.hermiteDirectHits>0&&cubesAudit.manifold,
      {report:uCubes.evaluation.report,audit:cubesAudit});
    assert.deepEqual(cubesAudit.inside,[true,true,true,false]);

    await call('scene.new');
    const cyl=await call('mesh.create',rotatedCylinder(6,14,24,0.38,-0.27,500,-300,200));
    const offsetBox=await call('mesh.create',rotatedBox([-4,-4,-4],[10,4,10],0.2,-0.15,0.4,500,-300,200));
    const uOffset=await call('scene.create',{type:'unite',inputs:[cyl.hash,offsetBox.hash],params:{resolution:64,smoothing:0,optimize:50,fast:true}});
    assert.ifError(uOffset.buildError);
    const offMesh=await page.evaluate(async id=>({v:Array.from((await frameEngine.readGeometry(id)).vertices),i:Array.from((await frameEngine.readGeometry(id)).indices)}),uOffset.hash);
    const offAudit=manifoldAudit(offMesh.v,offMesh.i,[[500,-300,202],[505,-298,203],[530,-300,200]]);
    check('Large-offset (500,-300,200) rotated cylinder + box stays accurate and manifold',
      uOffset.evaluation.report.extraction==='hermite-mdc-gpu-qef'&&offAudit.manifold&&offAudit.volume>1500,
      {report:uOffset.evaluation.report,audit:offAudit});
    assert.deepEqual(offAudit.inside,[true,true,false]);

    await call('scene.new');
    const sp=await call('mesh.create',sphereMesh(8,2,0,0,0));
    const sp2=await call('mesh.create',sphereMesh(7,2,8.5,0,0));
    const uSmooth=await call('scene.create',{type:'unite',inputs:[sp.hash,sp2.hash],params:{resolution:48,smoothing:1.5,optimize:25,fast:false}});
    assert.ifError(uSmooth.buildError);
    const smMesh=await page.evaluate(async id=>({v:Array.from((await frameEngine.readGeometry(id)).vertices),i:Array.from((await frameEngine.readGeometry(id)).indices)}),uSmooth.hash);
    const smAudit=manifoldAudit(smMesh.v,smMesh.i,[[0,0,0],[8.5,0,0],[4.5,0,0],[30,0,0]]);
    check('Smooth rounded union executes GPU relaxation in Quality mode cleanly',
      uSmooth.evaluation.report.relax?.backend==='WebGPU'&&uSmooth.evaluation.report.relax.acceptedIterations>=1&&uSmooth.evaluation.report.relax.finalSampleValidationPassed&&smAudit.manifold,
      {report:uSmooth.evaluation.report,audit:smAudit});
    assert.deepEqual(smAudit.inside,[true,true,true,false]);

    await call('scene.new');
    const outer=await call('mesh.create',rotatedBox([0,0,0],[20,16,10],0,0,0));
    const cavity=await call('mesh.create',rotatedBox([4,4,2],[12,12,8],0,0,0));
    const island=await call('mesh.create',rotatedBox([6,6,3.5],[10,10,6.5],0,0,0));
    const slit=await call('mesh.create',rotatedBox([14,6,2],[19,6.9,8],0,0,0));
    const wall=await call('mesh.create',rotatedBox([0,17.2,0],[20,18.1,10],0,0,0));
    const complex=await call('scene.create',{type:'unite',inputs:[outer.hash,cavity.hash,island.hash,slit.hash,wall.hash],params:{resolution:96,smoothing:0,optimize:0,fast:true}});
    assert.ifError(complex.buildError);
    const complexProbes=[[2,2,5],[5,5,5],[8,8,5],[16.5,6.45,5],[10,17.65,5],[10,16.6,5]];
    const cmpMesh=await page.evaluate(async id=>({v:Array.from((await frameEngine.readGeometry(id)).vertices),i:Array.from((await frameEngine.readGeometry(id)).indices)}),complex.hash);
    const cmpAudit=manifoldAudit(cmpMesh.v,cmpMesh.i,complexProbes);
    check('Cavity, island, thin wall and slit preserved cleanly',cmpAudit.manifold,[cmpAudit,complex.evaluation.report]);
    assert.deepEqual(cmpAudit.inside,[true,false,true,false,true,false]);
    const complexSmooth=await call('scene.update',{id:complex.hash,params:{smoothing:0.5,fast:false}});
    assert.ifError(complexSmooth.buildError);
    const inspected=(await call('scene.inspect')).objects.find(o=>o.hash===complex.hash);
    const cmsMesh=await page.evaluate(async id=>({v:Array.from((await frameEngine.readGeometry(id)).vertices),i:Array.from((await frameEngine.readGeometry(id)).indices)}),complex.hash);
    const cmsAudit=manifoldAudit(cmsMesh.v,cmsMesh.i,complexProbes);
    check('Complex scene Quality smooth remains watertight with report metadata',cmsAudit.manifold&&!!inspected.evaluation?.report?.backend,[cmsAudit,inspected.evaluation?.report]);
    assert.deepEqual(cmsAudit.inside,[true,false,true,false,true,false]);

    const gpuErrors=await page.evaluate(()=>__qGpuErrs);
    check('Zero GPU uncaptured errors and zero page errors',gpuErrors.length===0&&errors.length===0,{gpuErrors,errors});
    return {pass:true,checks,timings};
  }finally{page.off('pageerror',onErr);}
}

if(fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  const session=await launch({headless:process.argv.includes('--headless')});
  try{
    await ready(session.page);
    const res=await uniteQualityGpuChecks(session.page);
    console.log(JSON.stringify(res,null,2));
  }finally{await session.close();}
}
