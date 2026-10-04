 
 
 
function alignPlanarCurveSamples(contoursA,contoursB,source){
  const started=performance.now(),curves=source.curves,N=curves.length;
  const unchanged=()=>({contoursA,contoursB,source,stats:{coincidentPairs:0,addedSamples:0,milliseconds:performance.now()-started}});
  if(N<2)return unchanged();
  let low=[Infinity,Infinity],high=[-Infinity,-Infinity];
  for(const c of curves)for(const p of c.cp)for(let k=0;k<2;k++){low[k]=Math.min(low[k],p[k]);high[k]=Math.max(high[k],p[k]);}
  const scale=Math.max(high[0]-low[0],high[1]-low[1],1e-30),eps=2e-11,C=curves.map(c=>c.cp.map(p=>p.map((x,k)=>(x-low[k])/scale)));
  const val=(c,t)=>{const s=1-t;return [0,1].map(k=>s*s*s*c[0][k]+3*s*s*t*c[1][k]+3*s*t*t*c[2][k]+t*t*t*c[3][k]);};
  const derivative=(c,t)=>{const s=1-t;return [0,1].map(k=>3*(s*s*(c[1][k]-c[0][k])+2*s*t*(c[2][k]-c[1][k])+t*t*(c[3][k]-c[2][k])));};
  const second=(c,t)=>[0,1].map(k=>6*((1-t)*(c[2][k]-2*c[1][k]+c[0][k])+t*(c[3][k]-2*c[2][k]+c[1][k])));
  const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
  const mix=(a,b,t)=>a.map((x,k)=>x+(b[k]-x)*t);
  function split(c,t){const a=mix(c[0],c[1],t),b=mix(c[1],c[2],t),d=mix(c[2],c[3],t),e=mix(a,b,t),f=mix(b,d,t),g=mix(e,f,t);return [[c[0],a,e,g],[g,f,d,c[3]]];}
  function slice(c,a,b){if(b<a)return slice(c,b,a).reverse();if(b<1)c=split(c,b)[0];if(a>0)c=split(c,a/b)[1];return c;}
  const bounds=C.map(c=>[Math.min(...c.map(p=>p[0])),Math.min(...c.map(p=>p[1])),Math.max(...c.map(p=>p[0])),Math.max(...c.map(p=>p[1]))]);
  function parameters(id,p){const box=bounds[id],c=C[id],found=[];
    if(p[0]<box[0]-eps||p[0]>box[2]+eps||p[1]<box[1]-eps||p[1]>box[3]+eps)return found;
    const add=t=>{if(!found.some(x=>Math.abs(x-t)<1e-9))found.push(t);};
    if(distance(c[0],p)<eps)add(0);if(distance(c[3],p)<eps)add(1);
    const samples=Array.from({length:17},(_,i)=>distance(val(c,i/16),p));
    for(let j=0;j<=16;j++){
      if(j&&samples[j]>samples[j-1]||j<16&&samples[j]>samples[j+1])continue;
      let t=j/16,error=samples[j];
      for(let k=0;k<24&&error>eps;k++){
        const q=val(c,t),d=derivative(c,t),dd=second(c,t),x=q[0]-p[0],y=q[1]-p[1],den=d[0]*d[0]+d[1]*d[1]+x*dd[0]+y*dd[1];if(Math.abs(den)<1e-30)break;
        const delta=-(x*d[0]+y*d[1])/den;let ok=false;
        for(let f=1;f>1/256;f*=.5){const u=Math.max(0,Math.min(1,t+delta*f)),e=distance(val(c,u),p);if(e<error){t=u;error=e;ok=true;break;}}
        if(!ok)break;
      }
      if(error<eps)add(t);
    }
    return found;
  }
  const adjacent=Array.from({length:N},()=>[]),sorted=Array.from({length:N},(_,i)=>i).sort((a,b)=>bounds[a][0]-bounds[b][0]);let pairs=0;
  for(let i=0;i<N;i++)for(let j=i+1;j<N&&bounds[sorted[j]][0]<=bounds[sorted[i]][2]+eps;j++){
    const a=sorted[i],b=sorted[j],A=bounds[a],B=bounds[b];
    if(curves[a].path===curves[b].path||A[3]<B[1]-eps||B[3]<A[1]-eps)continue;
    const matched=[];for(const t of [0,1])for(const u of parameters(b,C[a][t?3:0]))matched.push([t,u]);for(const u of [0,1])for(const t of parameters(a,C[b][u?3:0]))matched.push([t,u]);
    let best=null,length=0;
    for(let p=0;p<matched.length;p++)for(let q=p+1;q<matched.length;q++){
      const [ta,ua]=matched[p],[tb,ub]=matched[q];if(Math.abs(ta-tb)<1e-9||Math.abs(ua-ub)<1e-9)continue;
      const ca=slice(C[a],ta,tb),cb=slice(C[b],ua,ub);
      if(ca.every((v,k)=>distance(v,cb[k])<eps*4)&&Math.abs(tb-ta)>length){best={ta,tb,ua,ub};length=Math.abs(tb-ta);}
    }
    if(!best)continue;const {ta,tb,ua,ub}=best,alpha=(ub-ua)/(tb-ta),beta=ua-alpha*ta;
    adjacent[a].push({other:b,lo:Math.min(ta,tb),hi:Math.max(ta,tb),alpha,beta});adjacent[b].push({other:a,lo:Math.min(ua,ub),hi:Math.max(ua,ub),alpha:1/alpha,beta:-beta/alpha});pairs++;
  }
  if(!pairs)return unchanged();
  const parametersByCurve=Array.from({length:N},()=>[]),queue=[];let cursor=0,added=0;
  function add(id,t){t=Math.max(0,Math.min(1,t));const values=parametersByCurve[id];let lo=0,hi=values.length;while(lo<hi){const m=(lo+hi)>>1;if(values[m]<t)lo=m+1;else hi=m;}
    if(lo<values.length&&Math.abs(values[lo]-t)<1e-10||lo>0&&Math.abs(values[lo-1]-t)<1e-10)return;
    if(queue.length>=200000)throw Error('Coincident spline Boolean sample budget exceeded');values.splice(lo,0,t);queue.push([id,t]);}
  for(const loops of source.edges)for(const loop of loops)for(const e of loop){add(e.curve,e.t0);add(e.curve,e.t1);}
  const initial=queue.length;for(let id=0;id<N;id++)for(const r of adjacent[id]){add(id,r.lo);add(id,r.hi);}
  while(cursor<queue.length){const [id,t]=queue[cursor++];for(const r of adjacent[id])if(t>=r.lo-1e-10&&t<=r.hi+1e-10)add(r.other,r.alpha*t+r.beta);}
  added=queue.length-initial;
  const contours=[[],[]],edges=[[],[]];
  source.edges.forEach((loops,operand)=>loops.forEach(loop=>{
    const points=[],spans=[];
    for(const e of loop){const params=parametersByCurve[e.curve].filter(t=>t>=e.t0-1e-10&&t<=e.t1+1e-10);
      for(let j=0;j+1<params.length;j++){points.push(val(curves[e.curve].cp,params[j]));spans.push({curve:e.curve,t0:params[j],t1:params[j+1]});}}
    contours[operand].push(points);edges[operand].push(spans);
  }));
   
  const fine=curves.map(c=>c.angle||10);for(let pass=0;pass<N;pass++){let changed=false;for(let i=0;i<N;i++)for(const e of adjacent[i])if(fine[e.other]<fine[i]){fine[i]=fine[e.other];changed=true;}if(!changed)break;}
  return {contoursA:contours[0],contoursB:contours[1],source:{...source,curves:curves.map((c,i)=>({...c,angle:fine[i]})),edges},stats:{coincidentPairs:pairs,addedSamples:added,milliseconds:performance.now()-started}};
}

 
 
 
function planarCurveFragments(walks, source, scale, ox, oy) {
  const curves=source.curves.map(c=>c.cp.map(p=>[(p[0]-ox)/scale,(p[1]-oy)/scale]));
  const paths=[];
  source.curves.forEach((c,i)=>{const path=c.path??i,piece=c.piece??0;(paths[path]||=[])[piece]=i;});
  const mix=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
  function split(c,t){const a=mix(c[0],c[1],t),b=mix(c[1],c[2],t),d=mix(c[2],c[3],t),e=mix(a,b,t),f=mix(b,d,t),g=mix(e,f,t);return [[c[0],a,e,g],[g,f,d,c[3]]];}
  function slice(c,a,b){if(b<a)return slice(c,b,a).reverse();let q=c;if(b<1)q=split(q,b)[0];if(a>0)q=split(q,a/b)[1];return q.map(p=>p.slice());}
  function bezValue(c,t){const s=1-t;return [0,1].map(k=>s*s*s*c[0][k]+3*s*s*t*c[1][k]+3*s*t*t*c[2][k]+t*t*t*c[3][k]);}
  function bezDeriv(c,t){const s=1-t;return [0,1].map(k=>3*(s*s*(c[1][k]-c[0][k])+2*s*t*(c[2][k]-c[1][k])+t*t*(c[3][k]-c[2][k])));}
  const cycle=(t,n)=>((t%n)+n)%n;
  function piece(path,t){const k=Math.floor(t),index=cycle(k,path.length);return {c:curves[path[index]],t:t-k,index};}
  function value(path,t){const q=piece(path,t);return bezValue(q.c,q.t);}
  function deriv(path,t){const q=piece(path,t);return bezDeriv(q.c,q.t);}
   
  function interval(path,a,b){const k=Math.floor((a+b)/2),c=curves[path[cycle(k,path.length)]];return slice(c,a-k,b-k);}
  function windows(range){const q=[range[0]];for(let k=Math.floor(range[0])+1;k<range[1]-1e-13;k++)q.push(k);q.push(range[1]);return q.slice(0,-1).map((a,i)=>[a,q[i+1]]);}
  const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
  const clampT=(t,r)=>Math.max(r[0],Math.min(r[1],t));
  const limits=r=>{const a=Math.min(...r),b=Math.max(...r),pad=Math.max(1e-6,(b-a)*1.5);return [a-pad,b+pad];};
  let refined=0,maxResidual=0;
  function junction(c,d,t,u,rt,ru){
     
     
    let p=value(c,t),q=value(d,u);if(dist(p,q)<=2e-12)return {t,u,p:p.slice(),residual:dist(p,q)};
    const seedT=t,seedU=u;
    function newton(t,u){
      let p=value(c,t),q=value(d,u),error=dist(p,q);
      for(let it=0;it<40&&error>2e-12;it++){
        const a=deriv(c,t),b=deriv(d,u),fx=p[0]-q[0],fy=p[1]-q[1],det=a[0]*b[1]-a[1]*b[0];
        if(Math.abs(det)<=1e-15*Math.max(1e-30,Math.hypot(...a)*Math.hypot(...b)))break;
        let dt=(-fx*b[1]+fy*b[0])/det,du=(a[0]*fy-a[1]*fx)/det;
        const f=Math.min(1,.25/Math.max(Math.abs(dt),Math.abs(du),1e-30));dt*=f;du*=f;
        let accepted=false;
        for(let damping=1;damping>=1/1024;damping*=.5){const nt=clampT(t+dt*damping,rt),nu=clampT(u+du*damping,ru),np=value(c,nt),nq=value(d,nu),ne=dist(np,nq);
          if(ne<error){t=nt;u=nu;p=np;q=nq;error=ne;accepted=true;break;}}
        if(!accepted)break;
      }
      return {t,u,p,residual:error};
    }
    let best=newton(t,u);
     
     
    if(best.residual>2e-10){
      const box=c=>[Math.min(...c.map(p=>p[0])),Math.min(...c.map(p=>p[1])),Math.max(...c.map(p=>p[0])),Math.max(...c.map(p=>p[1]))];
      const stack=[];for(const [a,b]of windows(rt))for(const [s,e]of windows(ru))stack.push({a,b,s,e,c:interval(c,a,b),d:interval(d,s,e),depth:0});
      stack.sort((a,b)=>(Math.abs((b.a+b.b)/2-seedT)+Math.abs((b.s+b.e)/2-seedU))-(Math.abs((a.a+a.b)/2-seedT)+Math.abs((a.s+a.e)/2-seedU)));let visits=0;
      while(stack.length&&visits++<4096){const n=stack.pop(),A=box(n.c),B=box(n.d);
        if(A[2]<B[0]-2e-12||B[2]<A[0]-2e-12||A[3]<B[1]-2e-12||B[3]<A[1]-2e-12)continue;
        if(n.depth>=26||Math.max(n.b-n.a,n.e-n.s)<1e-6){const r=newton((n.a+n.b)/2,(n.s+n.e)/2);if(r.residual<best.residual)best=r;if(best.residual<=2e-12)break;continue;}
        let children;
        if(Math.hypot(A[2]-A[0],A[3]-A[1])>=Math.hypot(B[2]-B[0],B[3]-B[1])){const h=(n.a+n.b)/2,[l,r]=split(n.c,.5);children=[{...n,b:h,c:l},{...n,a:h,c:r}];}
        else{const h=(n.s+n.e)/2,[l,r]=split(n.d,.5);children=[{...n,e:h,d:l},{...n,s:h,d:r}];}
        children.sort((a,b)=>(Math.abs((b.a+b.b)/2-seedT)+Math.abs((b.s+b.e)/2-seedU))-(Math.abs((a.a+a.b)/2-seedT)+Math.abs((a.s+a.e)/2-seedU)));
        for(const child of children)stack.push({...child,depth:n.depth+1});
      }
    }
    if(best.residual>2e-10)throw Error('Spline Boolean: sampled crossing could not be resolved on the source curves');
    refined++;maxResidual=Math.max(maxResidual,best.residual);return best;
  }
  const result=[];
  for(const walk of walks){
    const runs=[];
    for(const trace of walk){if(!trace)throw Error('Spline Boolean lost curve provenance');
      const src=source.curves[trace.curve],path=src.path??trace.curve,k=src.piece??0;
      const s={path,t0:k+trace.t0,t1:k+trace.t1,start:trace.start.map(v=>v+k),end:trace.end.map(v=>v+k)},prev=runs.at(-1),N=paths[path].length;
      const offset=prev&&prev.path===path?Math.round((prev.t1-s.t0)/N)*N:0;
      if(prev&&prev.path===path&&Math.abs(prev.t1-s.t0-offset)<1e-11&&(prev.t1-prev.t0)*(s.t1-s.t0)>0){prev.t1=s.t1+offset;prev.end=s.end.map(v=>v+offset);}
      else runs.push(s);
    }
    if(runs.length>1){const first=runs[0],last=runs.at(-1),N=paths[first.path].length,offset=Math.round((last.t1-first.t0)/N)*N;
      if(first.path===last.path&&Math.abs(last.t1-first.t0-offset)<1e-11&&(last.t1-last.t0)*(first.t1-first.t0)>0){first.t0=last.t0-offset;first.start=last.start.map(v=>v-offset);runs.pop();}}
    const signs=runs.map(r=>Math.sign(r.t1-r.t0)),joins=[];
    if(runs.length===1){const r=runs[0];if(Math.abs(Math.abs(r.t1-r.t0)-paths[r.path].length)<=1e-9)joins.push(value(paths[r.path],r.t0));
      else{const q=junction(paths[r.path],paths[r.path],r.t1,r.t0,limits(r.end),limits(r.start));r.t1=q.t;r.t0=q.u;joins.push(q.p);}}
    else for(let i=0;i<runs.length;i++){
      const a=runs[(i+runs.length-1)%runs.length],b=runs[i],r=junction(paths[a.path],paths[b.path],a.t1,b.t0,limits(a.end),limits(b.start));
      a.t1=r.t;b.t0=r.u;joins.push(r.p);
    }
    const loop=[];
    for(let i=0;i<runs.length;i++){
      const r=runs[i],path=paths[r.path],forward=signs[i]>0;
      if((r.t1-r.t0)*signs[i]<=1e-13)throw Error('Spline Boolean: refined crossing changed the sampled contour topology');
      const cuts=windows([Math.min(r.t0,r.t1),Math.max(r.t0,r.t1)]);
      if(!forward)cuts.reverse();
      for(let j=0;j<cuts.length;j++){
        const [lo,hi]=cuts[j],k=Math.floor((lo+hi)/2),curve=path[cycle(k,path.length)],src=source.curves[curve];
        const c=interval(path,lo,hi);if(!forward)c.reverse();
        const a=j===0?joins[i]:c[0],b=j===cuts.length-1?joins[(i+1)%runs.length]:c[3];
         
        for(let axis=0;axis<2;axis++){c[1][axis]+=a[axis]-c[0][axis];c[2][axis]+=b[axis]-c[3][axis];}c[0]=a;c[3]=b;
        loop.push({cp:c.map(p=>[p[0]*scale+ox,p[1]*scale+oy]),curve,t0:(forward?lo:hi)-k,t1:(forward?hi:lo)-k,angle:src.angle,soft:!!src.soft});
      }
    }
     
     
    if(loop.length===1){const c=loop.pop(),[a,b]=split(c.cp,.5),t=(c.t0+c.t1)/2;loop.push({...c,cp:a,t1:t},{...c,cp:b,t0:t});}
    if(loop.length<2)throw Error('Spline Boolean has a collapsed curve contour');
    result.push(loop);
  }
  return {curveContours:result,curveReport:{method:'source-cubic-spans',editableSegments:result.reduce((n,c)=>n+c.length,0),refinedJunctions:refined,maxJunctionResidual:maxResidual*scale}};
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

 
function prepareBooleanRender(positions,indices,triangleMaterials=null,triangleSources=null,sourceA=null,sourceB=null,creaseCos=Math.cos(46*Math.PI/180)) {
  const built=polygonCreaseData(positions,indices,creaseCos),bounds=new Float64Array([Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity]);
  for(let i=0;i<built.positions.length;i++){const axis=i%3,v=built.positions[i];bounds[axis]=Math.min(bounds[axis],v);bounds[axis+3]=Math.max(bounds[axis+3],v);}
  const wire=[],seen=new Set(),V=positions.length/3,numericEdges=V*V<=Number.MAX_SAFE_INTEGER;
  for(let i=0;i<indices.length;i+=3)for(let k=0;k<3;k++){
    const a=indices[i+k],b=indices[i+(k+1)%3],lo=Math.min(a,b),hi=Math.max(a,b),key=numericEdges?lo*V+hi:lo+':'+hi;
    if(seen.has(key))continue;seen.add(key);
    wire.push(positions[a*3],positions[a*3+1],positions[a*3+2],positions[b*3],positions[b*3+1],positions[b*3+2]);
  }
  return {positions:built.positions,normals:built.normals,indices:built.indices,source:built.source,materialIds:triangleMaterials?.length===indices.length/3?Uint32Array.from(triangleMaterials):new Uint32Array(indices.length/3),bounds,wire:Float32Array.from(wire),creaseCos,backend:'worker-polygon-46-degree-area'};
}

 
 
function booleanFloatMeshCheck(positions,indices,expectsClosed){
 const V=positions.length/3,coords=new Set(),edges=new Map(),faces=new Set();let min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 for(let i=0;i<V;i++){const x=positions[i*3],y=positions[i*3+1],z=positions[i*3+2];if(![x,y,z].every(Number.isFinite))return null;
  const key=x+','+y+','+z;if(coords.has(key))return null;coords.add(key);for(let k=0;k<3;k++){min[k]=Math.min(min[k],positions[i*3+k]);max[k]=Math.max(max[k],positions[i*3+k]);}}
 for(let i=0;i<indices.length;i+=3){const a=indices[i],b=indices[i+1],c=indices[i+2];if(a===b||b===c||c===a||a>=V||b>=V||c>=V)return null;
  const x=positions[b*3]-positions[a*3],y=positions[b*3+1]-positions[a*3+1],z=positions[b*3+2]-positions[a*3+2],X=positions[c*3]-positions[a*3],Y=positions[c*3+1]-positions[a*3+1],Z=positions[c*3+2]-positions[a*3+2];
  if(y*Z-z*Y===0&&z*X-x*Z===0&&x*Y-y*X===0)return null;
  const f=[a,b,c].sort((a,b)=>a-b).join(':');if(faces.has(f))return null;faces.add(f);
  for(let k=0;k<3;k++){const a=indices[i+k],b=indices[i+(k+1)%3],key=Math.min(a,b)*V+Math.max(a,b),e=edges.get(key)||[0,0];e[0]++;e[1]+=a<b?1:-1;edges.set(key,e);}
 }
 let boundaryEdges=0,nonManifoldEdges=0,windingErrors=0;
 for(const [count,sign] of edges.values()){if(count===1)boundaryEdges++;else if(count>2)nonManifoldEdges++;else if(sign)windingErrors++;}
 if(nonManifoldEdges||windingErrors||(expectsClosed&&boundaryEdges))return null;
 const extent=Math.max(1,max[0]-min[0],max[1]-min[1],max[2]-min[2]);
 return {positions,indices,weldedVertices:0,droppedDegenerate:0,droppedDuplicate:0,boundaryEdges,nonManifoldEdges,windingErrors,tolerance:Math.max(1e-7,extent*5e-6),topologyValid:!boundaryEdges&&!nonManifoldEdges,fastPath:true};
}

function cleanBooleanFloatMesh(positions, indices, expectsClosed=true, triangleMaterials=null, triangleSources=null) {
  const exact=booleanFloatMeshCheck(positions,indices,expectsClosed);if(exact){exact.triangleMaterials=triangleMaterials?.length===indices.length/3?Uint32Array.from(triangleMaterials):new Uint32Array(indices.length/3);exact.triangleSources=triangleSources;return exact;}
  let count = positions.length / 3, min = [1 / 0, 1 / 0, 1 / 0], max = [-1 / 0, -1 / 0, -1 / 0];
  for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) {
    let value = positions[i * 3 + k];
    min[k] = Math.min(min[k], value), max[k] = Math.max(max[k], value);
  }
  let extent = Math.max(1, max[0] - min[0], max[1] - min[1], max[2] - min[2]), cellKey = (x, y, z) => `${x}:${y}:${z}`, attempt = (tolerance) => {
    let remap = new Uint32Array(count), cleanPositions = [], cells = /* @__PURE__ */ new Map(), toleranceSq = tolerance * tolerance;
    for (let i = 0; i < count; i++) {
      let x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2], cx = Math.floor(x / tolerance), cy = Math.floor(y / tolerance), cz = Math.floor(z / tolerance), representative = -1, best2 = toleranceSq;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (let q of cells.get(cellKey(cx + dx, cy + dy, cz + dz)) || []) {
        let at = q * 3, d = (cleanPositions[at] - x) ** 2 + (cleanPositions[at + 1] - y) ** 2 + (cleanPositions[at + 2] - z) ** 2;
        d <= best2 && (best2 = d, representative = q);
      }
      if (representative < 0) {
        representative = cleanPositions.length / 3, cleanPositions.push(x, y, z);
        let key = cellKey(cx, cy, cz), bucket = cells.get(key) || [];
        bucket.push(representative), cells.set(key, bucket);
      }
      remap[i] = representative;
    }
    let cleanIndices = [], cleanMaterials=[], cleanSources=[], triangles = /* @__PURE__ */ new Set(), droppedDegenerate = 0, droppedDuplicate = 0;
    for (let i = 0; i < indices.length; i += 3) {
      let a = remap[indices[i]], b = remap[indices[i + 1]], c = remap[indices[i + 2]];
      if (a === b || b === c || c === a) {
        droppedDegenerate++;
        continue;
      }
      let key = [a, b, c].sort((x, y) => x - y).join(":");
      if (triangles.has(key)) {
        droppedDuplicate++;
        continue;
      }
      triangles.add(key), cleanIndices.push(a, b, c),cleanMaterials.push(triangleMaterials?.[i/3]??0);cleanSources.push(triangleSources?.[i/3]??0);
    }
    let used = new Uint8Array(cleanPositions.length / 3);
    for (let i of cleanIndices) used[i] = 1;
    let compactMap = new Uint32Array(used.length), compactPositions = [];
    for (let i = 0; i < used.length; i++) used[i] && (compactMap[i] = compactPositions.length / 3, compactPositions.push(cleanPositions[i * 3], cleanPositions[i * 3 + 1], cleanPositions[i * 3 + 2]));
    for (let i = 0; i < cleanIndices.length; i++) cleanIndices[i] = compactMap[cleanIndices[i]];
    let edges = /* @__PURE__ */ new Map();
    for (let i = 0; i < cleanIndices.length; i += 3) for (let e = 0; e < 3; e++) {
      let a = cleanIndices[i + e], b = cleanIndices[i + (e + 1) % 3], key = a < b ? `${a}:${b}` : `${b}:${a}`;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
    let boundaryEdges = 0, nonManifoldEdges = 0;
    for (let edgeCount of edges.values())
      edgeCount === 1 ? boundaryEdges++ : edgeCount > 2 && nonManifoldEdges++;
    return { positions: new Float32Array(compactPositions), indices: new Uint32Array(cleanIndices), triangleMaterials:new Uint32Array(cleanMaterials), triangleSources:new Int32Array(cleanSources), weldedVertices: count - compactPositions.length / 3, droppedDegenerate, droppedDuplicate, boundaryEdges, nonManifoldEdges, tolerance, topologyValid: !boundaryEdges && !nonManifoldEdges };
  }, best = null;
  for (let factor of [5e-6, 1e-5, 2e-5, 5e-5, 1e-4]) {
    let candidate = attempt(Math.max(1e-7, extent * factor));
     
    if(indices.length&&!candidate.indices.length)continue;
    if ((!best || candidate.nonManifoldEdges * 1e6 + candidate.boundaryEdges < best.nonManifoldEdges * 1e6 + best.boundaryEdges) && (best = candidate), candidate.topologyValid) return candidate;
  }
  if(!best)throw Error('Boolean Float32 cleanup would collapse the entire surface');
  return best;
}

 
 
 
function planarContourBoolean(contoursA, contoursB, op, curveSource=null) {
  const started=performance.now();
  if (![0,1,2].includes(op)) throw Error('Unknown planar Boolean operation');
  let alignment=null;if(curveSource){const q=alignPlanarCurveSamples(contoursA,contoursB,curveSource);contoursA=q.contoursA;contoursB=q.contoursB;curveSource=q.source;alignment=q.stats;}
  let minx=Infinity,miny=Infinity,maxx=-Infinity,maxy=-Infinity,total=0;
  for(const loops of [contoursA,contoursB]) {
    if(!Array.isArray(loops))throw Error('Planar Boolean contours are invalid');
    for(const loop of loops){
      if(!Array.isArray(loop)||loop.length<3)throw Error('Planar Boolean needs closed contours with at least three points');
      total+=loop.length;if(total>200000)throw Error('Planar Boolean boundary budget exceeded');
      for(const p of loop){if(!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite))throw Error('Invalid planar Boolean point');minx=Math.min(minx,p[0]);miny=Math.min(miny,p[1]);maxx=Math.max(maxx,p[0]);maxy=Math.max(maxy,p[1]);}
    }
  }
  if(!total)return {contours:[],...(curveSource?{curveContours:[]}:{}),report:{backend:'planar-boundary-r6',planar:true,empty:true,trusted:true,inputEdges:0,outputEdges:0,wallMilliseconds:performance.now()-started}};
  const scale=Math.max(maxx-minx,maxy-miny,1e-30),ox=minx+(maxx-minx)*.5,oy=miny+(maxy-miny)*.5,eps=1e-9,edges=[],byOperand=[[],[]];
  for(const [operand,loops] of [contoursA,contoursB].entries())for(let li=0;li<loops.length;li++){
    const loop=loops[li];
    for(let i=0;i<loop.length;i++){
      const p=loop[i],q=loop[(i+1)%loop.length],ax=(p[0]-ox)/scale,ay=(p[1]-oy)/scale,bx=(q[0]-ox)/scale,by=(q[1]-oy)/scale,dx=bx-ax,dy=by-ay,len=Math.hypot(dx,dy);
      if(len<=eps)continue;
      const e={ax,ay,bx,by,dx,dy,len,l2:len*len,loX:Math.min(ax,bx),hiX:Math.max(ax,bx),loY:Math.min(ay,by),hiY:Math.max(ay,by),cuts:[0,1],operand,source:curveSource?.edges[operand]?.[li]?.[i]};
      edges.push(e);byOperand[operand].push(e);
    }
  }
  const add=(e,t)=>{const d=eps/e.len;if(t>d&&t<1-d)e.cuts.push(t);},cross=(ax,ay,bx,by)=>ax*by-ay*bx;
  let pairTests=0,intersections=0;
  const sorted=edges.slice().sort((a,b)=>a.loX-b.loX);
  for(let i=0;i<sorted.length;i++){
    const a=sorted[i];
    for(let j=i+1;j<sorted.length&&sorted[j].loX<=a.hiX+eps;j++){
      const b=sorted[j];if(b.hiY<a.loY-eps||b.loY>a.hiY+eps)continue;pairTests++;
      const den=cross(a.dx,a.dy,b.dx,b.dy),x=b.ax-a.ax,y=b.ay-a.ay;
      if(Math.abs(den)>1e-12*a.len*b.len){
        const t=cross(x,y,b.dx,b.dy)/den,u=cross(x,y,a.dx,a.dy)/den;
        if(t>=-eps/a.len&&t<=1+eps/a.len&&u>=-eps/b.len&&u<=1+eps/b.len){add(a,t);add(b,u);intersections++;}
      }else if(Math.abs(cross(x,y,a.dx,a.dy))<=eps*a.len&&Math.abs(cross(b.bx-a.ax,b.by-a.ay,a.dx,a.dy))<=eps*a.len){
        add(a,(x*a.dx+y*a.dy)/a.l2);add(a,((b.bx-a.ax)*a.dx+(b.by-a.ay)*a.dy)/a.l2);
        add(b,(-x*b.dx-y*b.dy)/b.l2);add(b,((a.bx-b.ax)*b.dx+(a.by-b.ay)*b.dy)/b.l2);
      }
    }
  }
  function inside(x,y,es){let v=false;for(const e of es)if((e.ay>y)!==(e.by>y)&&x<e.ax+(y-e.ay)*e.dx/e.dy)v=!v;return v;}
  function resultInside(x,y){const a=inside(x,y,byOperand[0]),b=inside(x,y,byOperand[1]);return op===0?a||b:op===1?a&&!b:a&&b;}
  const points=[],buckets=new Map(),segments=[],unique=new Map(),cell=eps*4;
  function vertex(x,y){const ix=Math.floor(x/cell),iy=Math.floor(y/cell);let id=-1,best=cell*cell;
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const i of buckets.get((ix+dx)+','+(iy+dy))||[]){const p=points[i],d=(p[0]-x)**2+(p[1]-y)**2;if(d<=best){id=i;best=d;}}
    if(id>=0)return id;id=points.length;points.push([x,y]);const k=ix+','+iy,list=buckets.get(k)||[];list.push(id);buckets.set(k,list);return id;
  }
  let testedSegments=0;
  for(const e of edges){
    const cuts=e.cuts.sort((a,b)=>a-b).filter((t,i,a)=>!i||t-a[i-1]>eps/e.len);
    for(let i=0;i+1<cuts.length;i++){
      const a=cuts[i],b=cuts[i+1],len=(b-a)*e.len;if(len<=eps)continue;testedSegments++;
      const mx=e.ax+e.dx*(a+b)*.5,my=e.ay+e.dy*(a+b)*.5,d=Math.min(eps*8,len*.05),nx=-e.dy/e.len*d,ny=e.dx/e.len*d;
      const left=resultInside(mx+nx,my+ny),right=resultInside(mx-nx,my-ny);if(left===right)continue;
      let p=vertex(e.ax+e.dx*a,e.ay+e.dy*a),q=vertex(e.ax+e.dx*b,e.ay+e.dy*b);if(p===q)continue;
      if(!left){const t=p;p=q;q=t;}
      const key=p<q?p+':'+q:q+':'+p,old=unique.get(key);
      if(old!==undefined){const s=segments[old];if(s[0]!==p)throw Error('Planar Boolean has conflicting coincident boundaries');continue;}
      unique.set(key,segments.length);segments.push([p,q]);
      if(curveSource){const src=e.source;if(!src||!curveSource.curves[src.curve])throw Error("Spline Boolean curve provenance is invalid");const ta=src.t0+(src.t1-src.t0)*a,tb=src.t0+(src.t1-src.t0)*b;segments.at(-1).trace={curve:src.curve,t0:left?ta:tb,t1:left?tb:ta,start:[src.t0,src.t1],end:[src.t0,src.t1]};}
    }
  }
  const out=points.map(()=>[]),inCount=new Uint32Array(points.length);
  segments.forEach(([a,b],i)=>{out[a].push(i);inCount[b]++;});
  for(let i=0;i<points.length;i++)if(inCount[i]!==out[i].length)throw Error('Planar Boolean boundary did not close at vertex '+i);
  const next=new Int32Array(segments.length),tau=2*Math.PI;
  for(let i=0;i<segments.length;i++){
    const [a,b]=segments[i],p=points[a],q=points[b],back=Math.atan2(p[1]-q[1],p[0]-q[0]);let best=Infinity,chosen=-1;
    for(const j of out[b]){const r=points[segments[j][1]],angle=(back-Math.atan2(r[1]-q[1],r[0]-q[0])+tau)%tau;if(angle<best){best=angle;chosen=j;}}
    if(chosen<0)throw Error('Planar Boolean produced an open contour');next[i]=chosen;
  }
  const used=new Uint8Array(segments.length),contours=[],curveWalks=[];
  for(let seed=0;seed<segments.length;seed++){
    if(used[seed])continue;let i=seed;const loop=[],traces=[];
    do{if(used[i])throw Error('Planar Boolean boundary walk is ambiguous');used[i]=1;loop.push(points[segments[i][0]]);if(curveSource)traces.push(segments[i].trace);i=next[i];}while(i!==seed);
    let clean=loop.filter((b,j)=>{const a=loop[(j+loop.length-1)%loop.length],c=loop[(j+1)%loop.length],x=b[0]-a[0],y=b[1]-a[1],X=c[0]-b[0],Y=c[1]-b[1];return Math.abs(cross(x,y,X,Y))>eps*Math.min(Math.hypot(x,y),Math.hypot(X,Y))||x*X+y*Y<0;});
    if(clean.length<3)continue;let area=0;for(let j=0;j<clean.length;j++){const a=clean[j],b=clean[(j+1)%clean.length];area+=a[0]*b[1]-b[0]*a[1];}
    if(Math.abs(area)<=eps*eps)continue;
    contours.push(clean.map(p=>[p[0]*scale+ox,p[1]*scale+oy]));if(curveSource)curveWalks.push(traces);
  }
  const restored=curveSource?planarCurveFragments(curveWalks,curveSource,scale,ox,oy):{};
  return {contours,...restored,report:{backend:'planar-boundary-r6',planar:true,empty:!contours.length,trusted:true,curveAlignment:alignment,inputEdges:edges.length,pairTests,intersections,testedSegments,outputEdges:contours.reduce((n,c)=>n+c.length,0),outputContours:contours.length,tolerance:eps*scale,wallMilliseconds:performance.now()-started}};
}

 
var clamp = (v, a, b) => v < a ? a : v > b ? b : v;
function pointTriangleDistanceSq(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  let abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az, apx = px - ax, apy = py - ay, apz = pz - az, d1 = abx * apx + aby * apy + abz * apz, d22 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d22 <= 0) return apx * apx + apy * apy + apz * apz;
  let bpx = px - bx, bpy = py - by, bpz = pz - bz, d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return bpx * bpx + bpy * bpy + bpz * bpz;
  let vc = d1 * d4 - d3 * d22;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    let v2 = d1 / (d1 - d3), qx2 = ax + v2 * abx, qy2 = ay + v2 * aby, qz2 = az + v2 * abz, dx2 = px - qx2, dy2 = py - qy2, dz2 = pz - qz2;
    return dx2 * dx2 + dy2 * dy2 + dz2 * dz2;
  }
  let cpx = px - cx, cpy = py - cy, cpz = pz - cz, d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return cpx * cpx + cpy * cpy + cpz * cpz;
  let vb = d5 * d22 - d1 * d6;
  if (vb <= 0 && d22 >= 0 && d6 <= 0) {
    let w2 = d22 / (d22 - d6), qx2 = ax + w2 * acx, qy2 = ay + w2 * acy, qz2 = az + w2 * acz, dx2 = px - qx2, dy2 = py - qy2, dz2 = pz - qz2;
    return dx2 * dx2 + dy2 * dy2 + dz2 * dz2;
  }
  let va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    let w2 = (d4 - d3) / (d4 - d3 + (d5 - d6)), qx2 = bx + w2 * (cx - bx), qy2 = by + w2 * (cy - by), qz2 = bz + w2 * (cz - bz), dx2 = px - qx2, dy2 = py - qy2, dz2 = pz - qz2;
    return dx2 * dx2 + dy2 * dy2 + dz2 * dz2;
  }
  let den = 1 / (va + vb + vc), v = vb * den, w = vc * den, qx = ax + abx * v + acx * w, qy = ay + aby * v + acy * w, qz = az + abz * v + acz * w, dx = px - qx, dy = py - qy, dz = pz - qz;
  return dx * dx + dy * dy + dz * dz;
}
function bounds(pos) {
  let minx = 1 / 0, miny = 1 / 0, minz = 1 / 0, maxx = -1 / 0, maxy = -1 / 0, maxz = -1 / 0;
  for (let i = 0; i < pos.length; i += 3) {
    let x = pos[i], y = pos[i + 1], z = pos[i + 2];
    x < minx && (minx = x), y < miny && (miny = y), z < minz && (minz = z), x > maxx && (maxx = x), y > maxy && (maxy = y), z > maxz && (maxz = z);
  }
  return { minx, miny, minz, maxx, maxy, maxz };
}
function chooseGrid(triCount) {
  return clamp(Math.ceil(Math.cbrt(Math.max(1, triCount)) * 1.6), 8, 96);
}
function rangesFor(pos, idx2, g, B, pad, out) {
  let sx = g / Math.max(B.maxx - B.minx, 1e-30), sy = g / Math.max(B.maxy - B.miny, 1e-30), sz = g / Math.max(B.maxz - B.minz, 1e-30), postings = 0, maxCells = 0;
  for (let t = 0; t < idx2.length; t += 3) {
    let ax = 1 / 0, ay = 1 / 0, az = 1 / 0, bx = -1 / 0, by = -1 / 0, bz = -1 / 0;
    for (let k = 0; k < 3; k++) {
      let o2 = idx2[t + k] * 3, x = pos[o2], y = pos[o2 + 1], z = pos[o2 + 2];
      x < ax && (ax = x), y < ay && (ay = y), z < az && (az = z), x > bx && (bx = x), y > by && (by = y), z > bz && (bz = z);
    }
    let ti = t / 3, r = ti * 6, x0 = clamp(Math.floor((ax - pad - B.minx) * sx), 0, g - 1), x1 = clamp(Math.floor((bx + pad - B.minx) * sx), 0, g - 1), y0 = clamp(Math.floor((ay - pad - B.miny) * sy), 0, g - 1), y1 = clamp(Math.floor((by + pad - B.miny) * sy), 0, g - 1), z0 = clamp(Math.floor((az - pad - B.minz) * sz), 0, g - 1), z1 = clamp(Math.floor((bz + pad - B.minz) * sz), 0, g - 1), n = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1);
    out[r] = x0, out[r + 1] = x1, out[r + 2] = y0, out[r + 3] = y1, out[r + 4] = z0, out[r + 5] = z1, postings += n, n > maxCells && (maxCells = n);
  }
  return { postings, maxCells, sx, sy, sz };
}
function buildSurfaceIndex(positions, indices, tolerance = 0) {
  let triCount = indices.length / 3, B = bounds(positions), extent = Math.max(1, B.maxx - B.minx, B.maxy - B.miny, B.maxz - B.minz), tol = Math.max(1e-7, Number.isFinite(tolerance) ? tolerance : 0, extent * 1e-7), pad = tol * 1.01;
  B.minx -= pad, B.miny -= pad, B.minz -= pad, B.maxx += pad, B.maxy += pad, B.maxz += pad;
  let g = chooseGrid(triCount), ranges2 = new Uint16Array(triCount * 6), meta2;
  for (; ; ) {
    meta2 = rangesFor(positions, indices, g, B, pad, ranges2);
    let cap = Math.max(2e6, triCount * 96);
    if (meta2.postings <= cap || g <= 8) break;
    g = Math.max(8, Math.floor(g * 0.7));
  }
  let N = g * g * g, count2 = new Uint32Array(N), G2 = g * g;
  for (let t = 0; t < triCount; t++) {
    let r = t * 6;
    for (let z = ranges2[r + 4]; z <= ranges2[r + 5]; z++) for (let y = ranges2[r + 2]; y <= ranges2[r + 3]; y++) {
      let c = z * G2 + y * g + ranges2[r];
      for (let x = ranges2[r]; x <= ranges2[r + 1]; x++, c++) count2[c]++;
    }
  }
  let off = new Uint32Array(N + 1);
  for (let i = 0; i < N; i++) off[i + 1] = off[i] + count2[i];
  let cur = off.slice(0, N), post = new Uint32Array(off[N]);
  for (let t = 0; t < triCount; t++) {
    let r = t * 6;
    for (let z = ranges2[r + 4]; z <= ranges2[r + 5]; z++) for (let y = ranges2[r + 2]; y <= ranges2[r + 3]; y++) {
      let c = z * G2 + y * g + ranges2[r];
      for (let x = ranges2[r]; x <= ranges2[r + 1]; x++, c++) post[cur[c]++] = t;
    }
  }
  return { positions, indices, triCount, g, G2, B, sx: meta2.sx, sy: meta2.sy, sz: meta2.sz, off, post, tolerance: tol, tol2: tol * tol, postings: post.length };
}
function surfaceContainsPoint(S, px, py, pz) {
  let B = S.B;
  if (px < B.minx || px > B.maxx || py < B.miny || py > B.maxy || pz < B.minz || pz > B.maxz) return !1;
  let x = clamp(Math.floor((px - B.minx) * S.sx), 0, S.g - 1), y = clamp(Math.floor((py - B.miny) * S.sy), 0, S.g - 1), z = clamp(Math.floor((pz - B.minz) * S.sz), 0, S.g - 1), cell = z * S.G2 + y * S.g + x, p = S.positions, ix = S.indices;
  for (let q = S.off[cell]; q < S.off[cell + 1]; q++) {
    let t = S.post[q] * 3, ia = ix[t] * 3, ib = ix[t + 1] * 3, ic = ix[t + 2] * 3;
    if (pointTriangleDistanceSq(px, py, pz, p[ia], p[ia + 1], p[ia + 2], p[ib], p[ib + 1], p[ib + 2], p[ic], p[ic + 1], p[ic + 2]) <= S.tol2) return !0;
  }
  return !1;
}
function lerp3(points, a, b, t) {
  let ao = a * 3, bo = b * 3, s = 1 - t;
  return [points[ao] * s + points[bo] * t, points[ao + 1] * s + points[bo + 1] * t, points[ao + 2] * s + points[bo + 2] * t];
}
function stateAt(S, points, a, b, t) {
  let p = lerp3(points, a, b, t);
  return surfaceContainsPoint(S, p[0], p[1], p[2]);
}
function transitionT(S, points, a, b, lo, hi, stateLo, iterations) {
  for (let i = 0; i < iterations; i++) {
    let m = (lo + hi) * 0.5;
    stateAt(S, points, a, b, m) === stateLo ? lo = m : hi = m;
  }
  return (lo + hi) * 0.5;
}
function clipPolylineSegments(positions, indices, points, lines, tolerance = 0, { steps = 32, refine = 16 } = {}) {
  if (!(points instanceof Float32Array) || points.length % 3) throw new Error("Surface clip points are invalid");
  if (!(lines instanceof Uint32Array) || lines.length % 2) throw new Error("Surface clip line ranges are invalid");
  let S = buildSurfaceIndex(positions, indices, tolerance), lineIds = [], edgeIds = [], ts = [], probes = 0, transitions = 0;
  for (let li = 0; li < lines.length; li += 2) {
    let line = li / 2, start = lines[li], count2 = lines[li + 1];
    if (!(count2 < 2 || start + count2 > points.length / 3))
      for (let e = 0; e < count2 - 1; e++) {
        let a = start + e, b = a + 1, st = new Uint8Array(steps + 1);
        for (let k = 0; k <= steps; k++)
          st[k] = stateAt(S, points, a, b, k / steps) ? 1 : 0, probes++;
        for (let k = 0; k < steps; k++) {
          let t0 = k / steps, t1 = (k + 1) / steps, s0 = !!st[k], s1 = !!st[k + 1];
          !s0 && !s1 || (!s0 && s1 ? (t0 = transitionT(S, points, a, b, t0, t1, !1, refine), transitions++) : s0 && !s1 && (t1 = transitionT(S, points, a, b, t0, t1, !0, refine), transitions++), t1 > t0 && (lineIds.length&&lineIds.at(-1)===line&&edgeIds.at(-1)===e&&Math.abs(ts.at(-1)-t0)<1e-12 ? ts[ts.length-1]=t1 : (lineIds.push(line), edgeIds.push(e), ts.push(t0, t1))));
        }
      }
  }
  return { lineIds: Uint32Array.from(lineIds), edgeIds: Uint32Array.from(edgeIds), t: Float32Array.from(ts), grid: S.g, postings: S.postings, tolerance: S.tolerance, probes, transitions };
}

 
var DIRS_RAW = [
  [1, 0.1732050807568877, 0.317837245195782],
  [0.2718281828459045, 1, 0.4142135623730951],
  [0.6180339887498948, 0.233, 1],
  [-1, 0.3819660112501052, 0.271],
  [0.7071067811865476, -1, 0.2236067977499789],
  [0.347, 0.6180339887498948, -1],
  [1, 1, 0.5773502691896258]
], DIRS = new Float64Array(DIRS_RAW.length * 3);
for (let i = 0; i < DIRS_RAW.length; i++) {
  let d = DIRS_RAW[i], n = Math.hypot(d[0], d[1], d[2]) || 1;
  DIRS[i * 3] = d[0] / n, DIRS[i * 3 + 1] = d[1] / n, DIRS[i * 3 + 2] = d[2] / n;
}
var BIT_BUF = new ArrayBuffer(8), BIT_F64 = new Float64Array(BIT_BUF), BIT_U32 = new Uint32Array(BIT_BUF);
function nextPow2(n) {
  let x = 16;
  for (; x < n; ) x *= 2;
  return x;
}
function mix32(h, x) {
  return h ^= x >>> 0, h = Math.imul(h, 2246822507), h ^= h >>> 13, h = Math.imul(h, 3266489909), h >>> 0;
}
function hashPoint(x, y, z) {
  let h = 2654435769;
  return BIT_F64[0] = x, h = mix32(h, BIT_U32[0]), h = mix32(h, BIT_U32[1]), BIT_F64[0] = y, h = mix32(h, BIT_U32[0]), h = mix32(h, BIT_U32[1]), BIT_F64[0] = z, h = mix32(h, BIT_U32[0]), mix32(h, BIT_U32[1]);
}
function hash3u(a, b, c) {
  let h = Math.imul((a ^ 2654435769) >>> 0, 2246822507);
  return h = mix32(h, b), mix32(h, c);
}
function hash2u(a, b) {
  let h = Math.imul((a ^ 2654435769) >>> 0, 2246822507);
  return mix32(h, b);
}
function shellRayVoteFlat(pos, faceV, compFaces, start, end, ox, oy, oz, dx, dy, dz) {
  let hits = 0, eps = 1e-11;
  for (let q = start; q < end; q++) {
    let fi = compFaces[q], o = fi * 3, ia = faceV[o] * 3, ib = faceV[o + 1] * 3, ic = faceV[o + 2] * 3, ax = pos[ia], ay = pos[ia + 1], az = pos[ia + 2], e1x = pos[ib] - ax, e1y = pos[ib + 1] - ay, e1z = pos[ib + 2] - az, e2x = pos[ic] - ax, e2y = pos[ic + 1] - ay, e2z = pos[ic + 2] - az, px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x, det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-14) continue;
    let inv = 1 / det, sx = ox - ax, sy = oy - ay, sz = oz - az, u = (sx * px + sy * py + sz * pz) * inv;
    if (u < -eps || u > 1 + eps) continue;
    let qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x, v = (dx * qx + dy * qy + dz * qz) * inv;
    if (!(v < -eps || u + v > 1 + eps || (e2x * qx + e2y * qy + e2z * qz) * inv <= 1e-10)) {
      if (u < eps || v < eps || 1 - u - v < eps) return -1;
      hits++;
    }
  }
  return hits & 1;
}
function pointInsideShellFlat(pos, faceV, compFaces, start, end, px, py, pz) {
  let yes = 0, no = 0;
  for (let i = 0; i < DIRS.length; i += 3) {
    let r = shellRayVoteFlat(pos, faceV, compFaces, start, end, px, py, pz, DIRS[i], DIRS[i + 1], DIRS[i + 2]);
    r < 0 || (r ? yes++ : no++);
  }
  return { inside: yes > no, certain: yes + no >= 3 && yes !== no };
}
function buildEdgeIncidence(faceV, faceCount, stats) {
  let cap = nextPow2(faceCount * 6 + 8), mask = cap - 1, ea = new Uint32Array(cap), eb = new Uint32Array(cap), count2 = new Uint8Array(cap), f0 = new Uint32Array(cap), f1 = new Uint32Array(cap), d0 = new Int8Array(cap), d1 = new Int8Array(cap);
  for (let fi = 0; fi < faceCount; fi++) {
    let o = fi * 3, a0 = faceV[o], a1 = faceV[o + 1], a2 = faceV[o + 2], a = a0, b = a1;
    for (let e = 0; e < 3; e++) {
      e === 1 ? (a = a1, b = a2) : e === 2 && (a = a2, b = a0);
      let lo = a, hi = b, dir = 1;
      if (lo > hi) {
        let t = lo;
        lo = hi, hi = t, dir = -1;
      }
      let s = hash2u(lo, hi) & mask;
      for (; count2[s] && !(ea[s] === lo && eb[s] === hi); ) s = s + 1 & mask;
      count2[s] ? (count2[s] === 1 && (f1[s] = fi, d1[s] = dir), count2[s] < 3 && count2[s]++) : (ea[s] = lo, eb[s] = hi, count2[s] = 1, f0[s] = fi, d0[s] = dir);
    }
  }
  let degree = new Uint32Array(faceCount), manifold = 0;
  for (let s = 0; s < cap; s++) {
    let c = count2[s];
    c && (c === 1 ? stats.boundaryEdges++ : c !== 2 ? stats.nonManifoldEdges++ : (degree[f0[s]]++, degree[f1[s]]++, manifold++));
  }
  let off = new Uint32Array(faceCount + 1);
  for (let i = 0; i < faceCount; i++) off[i + 1] = off[i] + degree[i];
  let cur = off.slice(0, faceCount), adjFace = new Uint32Array(manifold * 2), adjDiff = new Uint8Array(manifold * 2);
  for (let s = 0; s < cap; s++) if (count2[s] === 2) {
    let a = f0[s], b = f1[s], diff = d0[s] === d1[s] ? 1 : 0, w = cur[a]++;
    adjFace[w] = b, adjDiff[w] = diff, w = cur[b]++, adjFace[w] = a, adjDiff[w] = diff;
  }
  return { cap, ea, eb, count: count2, off, adjFace, adjDiff };
}
function analyzeAndRepairFlat(pos, faceV, faceCount, stats) {
  let edges = buildEdgeIncidence(faceV, faceCount, stats), flip = new Int8Array(faceCount);
  flip.fill(-1);
  let queue = new Uint32Array(faceCount), compFaces = new Uint32Array(faceCount), compOff = new Uint32Array(faceCount + 1), compCount = 0, write = 0;
  for (let root = 0; root < faceCount; root++) if (flip[root] < 0) {
    let start = write, qh = 0, qt = 0, ones = 0;
    for (queue[qt++] = root, flip[root] = 0; qh < qt; ) {
      let f = queue[qh++];
      compFaces[write++] = f, flip[f] && ones++;
      for (let k = edges.off[f]; k < edges.off[f + 1]; k++) {
        let g = edges.adjFace[k], want = flip[f] ^ edges.adjDiff[k];
        flip[g] < 0 ? (flip[g] = want, queue[qt++] = g) : flip[g] !== want && stats.windingConflicts++;
      }
    }
    if (ones * 2 > write - start) for (let k = start; k < write; k++) flip[compFaces[k]] ^= 1;
    compOff[compCount++] = start, compOff[compCount] = write;
  }
  for (let f = 0; f < faceCount; f++) if (flip[f] > 0) {
    let o = f * 3, t = faceV[o + 1];
    faceV[o + 1] = faceV[o + 2], faceV[o + 2] = t, stats.windingRepairs++;
  }
  if (stats.quality = stats.boundaryEdges || stats.nonManifoldEdges || stats.windingConflicts ? 1 : 0, stats.quality === 0 && compCount) {
    let lo = new Float64Array(compCount * 3), hi = new Float64Array(compCount * 3), probe = new Float64Array(compCount * 3), v6 = new Float64Array(compCount);
    lo.fill(1 / 0), hi.fill(-1 / 0);
    for (let ci = 0; ci < compCount; ci++) {
      let have = !1, sv = 0;
      for (let k = compOff[ci]; k < compOff[ci + 1]; k++) {
        let fi = compFaces[k], o = fi * 3, ia = faceV[o] * 3, ib = faceV[o + 1] * 3, ic = faceV[o + 2] * 3;
        have || (probe[ci * 3] = (pos[ia] + pos[ib] + pos[ic]) / 3, probe[ci * 3 + 1] = (pos[ia + 1] + pos[ib + 1] + pos[ic + 1]) / 3, probe[ci * 3 + 2] = (pos[ia + 2] + pos[ib + 2] + pos[ic + 2]) / 3, have = !0);
        let ax = pos[ia], ay = pos[ia + 1], az = pos[ia + 2], bx = pos[ib], by = pos[ib + 1], bz = pos[ib + 2], cx = pos[ic], cy = pos[ic + 1], cz = pos[ic + 2];
        sv += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
        let ids = [ia, ib, ic];
        for (let z = 0; z < 3; z++) {
          let q = ids[z], x = pos[q], y = pos[q + 1], zz = pos[q + 2], b = ci * 3;
          x < lo[b] && (lo[b] = x), y < lo[b + 1] && (lo[b + 1] = y), zz < lo[b + 2] && (lo[b + 2] = zz), x > hi[b] && (hi[b] = x), y > hi[b + 1] && (hi[b + 1] = y), zz > hi[b + 2] && (hi[b + 2] = zz);
        }
      }
      v6[ci] = sv;
    }
    for (let ci = 0; ci < compCount; ci++) {
      let depth = 0, b0 = ci * 3, px = probe[b0], py = probe[b0 + 1], pz = probe[b0 + 2];
      for (let cj = 0; cj < compCount; cj++) if (ci !== cj) {
        let b = cj * 3, sc = Math.max(1, Math.abs(lo[b]), Math.abs(lo[b + 1]), Math.abs(lo[b + 2]), Math.abs(hi[b]), Math.abs(hi[b + 1]), Math.abs(hi[b + 2])), eps = sc * 1e-12;
        if (px <= lo[b] - eps || px >= hi[b] + eps || py <= lo[b + 1] - eps || py >= hi[b + 1] + eps || pz <= lo[b + 2] - eps || pz >= hi[b + 2] + eps) continue;
        let r = pointInsideShellFlat(pos, faceV, compFaces, compOff[cj], compOff[cj + 1], px, py, pz);
        r.inside && depth++, r.certain || stats.shellNestingAmbiguous++;
      }
      let wantNegative = (depth & 1) !== 0, haveNegative = v6[ci] < 0;
      if (wantNegative !== haveNegative) {
        for (let k = compOff[ci]; k < compOff[ci + 1]; k++) {
          let o = compFaces[k] * 3, t = faceV[o + 1];
          faceV[o + 1] = faceV[o + 2], faceV[o + 2] = t;
        }
        stats.windingRepairs += compOff[ci + 1] - compOff[ci];
      }
    }
    stats.shellNestingAmbiguous && (stats.quality = 1);
  }
  return { edges, compFaces: compFaces.subarray(0, faceCount), compOff: compOff.subarray(0, compCount + 1), compCount };
}
function buildRenderFlat(pos, faceV, faceCount, faceMaterial=null) {
  let triV = faceV, triE = new Uint32Array(faceCount * 3), triFace = new Uint32Array(faceCount), cap = nextPow2(faceCount * 6 + 8), mask = cap - 1, ea = new Uint32Array(cap), eb = new Uint32Array(cap), eid = new Uint32Array(cap), nextE = 0;
  function edge(a, b) {
    let lo = a, hi = b;
    if (lo > hi) {
      let t = lo;
      lo = hi, hi = t;
    }
    let s = hash2u(lo, hi) & mask;
    for (; eid[s] && !(ea[s] === lo && eb[s] === hi); ) s = s + 1 & mask;
    return eid[s] || (ea[s] = lo, eb[s] = hi, eid[s] = ++nextE), eid[s] - 1;
  }
  for (let fi = 0; fi < faceCount; fi++) {
    let o = fi * 3, a = triV[o], b = triV[o + 1], c = triV[o + 2];
    triE[o] = edge(a, b), triE[o + 1] = edge(b, c), triE[o + 2] = edge(c, a), triFace[fi] = fi;
  }
  return { pos, triV, triE, triFace, triCount: faceCount, faceCount, edgeCount: nextE, faceMaterial:faceMaterial||new Uint32Array(faceCount) };
}
function prepareMeshFlat(positions, indices, { profile = !1, faceMaterials = null } = {}) {
  let timing = profile ? {} : null, t0 = profile ? performance.now() : 0, inputVertices = Math.floor(positions.length / 3), inputTriangles = Math.floor(indices.length / 3), stats = { inputVertices, inputTriangles, weldedVertices: 0, keptTriangles: 0, droppedDegenerate: 0, droppedDuplicate: 0, boundaryEdges: 0, nonManifoldEdges: 0, windingRepairs: 0, windingConflicts: 0, shellNestingAmbiguous: 0, quality: 0 }, remap = new Uint32Array(inputVertices);
  remap.fill(4294967295);
  let posStore = new Float64Array(inputVertices * 3), pcap = nextPow2(inputVertices * 2 + 8), pmask = pcap - 1, pslot = new Uint32Array(pcap), pcount = 0, scale = 1;
  for (let i = 0; i < inputVertices; i++) {
    let x = +positions[i * 3], y = +positions[i * 3 + 1], z = +positions[i * 3 + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    x === 0 && (x = 0), y === 0 && (y = 0), z === 0 && (z = 0);
    let s = hashPoint(x, y, z) & pmask, id = -1;
    for (; pslot[s]; ) {
      let q = (pslot[s] - 1) * 3;
      if (posStore[q] === x && posStore[q + 1] === y && posStore[q + 2] === z) {
        id = pslot[s] - 1;
        break;
      }
      s = s + 1 & pmask;
    }
    if (id < 0) {
      id = pcount++;
      let q = id * 3;
      posStore[q] = x, posStore[q + 1] = y, posStore[q + 2] = z, pslot[s] = id + 1, Math.abs(x) > scale && (scale = Math.abs(x)), Math.abs(y) > scale && (scale = Math.abs(y)), Math.abs(z) > scale && (scale = Math.abs(z));
    }
    remap[i] = id;
  }
  stats.weldedVertices = pcount;
  let t1 = profile ? performance.now() : 0, areaEps2 = Math.pow(scale * scale * 1e-14, 2), faceStore = new Uint32Array(inputTriangles * 3), faceMaterialStore=new Uint32Array(inputTriangles), sourceFaces=new Uint32Array(inputTriangles), tcap = nextPow2(inputTriangles * 2 + 8), tmask = tcap - 1, used = new Uint8Array(tcap), ka = new Uint32Array(tcap), kb = new Uint32Array(tcap), kc = new Uint32Array(tcap), faceCount = 0;
  for (let t = 0; t < inputTriangles; t++) {
    let io = t * 3, ia = indices[io] >>> 0, ib = indices[io + 1] >>> 0, ic = indices[io + 2] >>> 0;
    if (ia >= inputVertices || ib >= inputVertices || ic >= inputVertices || remap[ia] === 4294967295 || remap[ib] === 4294967295 || remap[ic] === 4294967295) {
      stats.droppedDegenerate++;
      continue;
    }
    let a = remap[ia], b = remap[ib], c = remap[ic];
    if (a === b || b === c || c === a) {
      stats.droppedDegenerate++;
      continue;
    }
    let ao = a * 3, bo = b * 3, co = c * 3, abx = posStore[bo] - posStore[ao], aby = posStore[bo + 1] - posStore[ao + 1], abz = posStore[bo + 2] - posStore[ao + 2], acx = posStore[co] - posStore[ao], acy = posStore[co + 1] - posStore[ao + 1], acz = posStore[co + 2] - posStore[ao + 2], nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
    if (nx * nx + ny * ny + nz * nz <= areaEps2) {
      stats.droppedDegenerate++;
      continue;
    }
    let sa = a, sb = b, sc = c, tmp;
    sa > sb && (tmp = sa, sa = sb, sb = tmp), sb > sc && (tmp = sb, sb = sc, sc = tmp), sa > sb && (tmp = sa, sa = sb, sb = tmp);
    let s = hash3u(sa, sb, sc) & tmask;
    for (; used[s] && !(ka[s] === sa && kb[s] === sb && kc[s] === sc); ) s = s + 1 & tmask;
    if (used[s]) {
      stats.droppedDuplicate++;
      continue;
    }
    used[s] = 1, ka[s] = sa, kb[s] = sb, kc[s] = sc;
    let fo = faceCount * 3;
    faceStore[fo] = a, faceStore[fo + 1] = b, faceStore[fo + 2] = c, faceMaterialStore[faceCount]=faceMaterials?.[t]??0, sourceFaces[faceCount]=t, faceCount++;
  }
  stats.keptTriangles = faceCount;
  let t2 = profile ? performance.now() : 0, pos = posStore.subarray(0, pcount * 3), faceV = faceStore.subarray(0, faceCount * 3), faceMaterial=faceMaterialStore.subarray(0,faceCount), analysis = analyzeAndRepairFlat(pos, faceV, faceCount, stats), t3 = profile ? performance.now() : 0, mesh = buildRenderFlat(pos, faceV, faceCount,faceMaterial), t4 = profile ? performance.now() : 0;
  mesh.sourceFaces=sourceFaces.subarray(0,faceCount);
  return profile && (timing.weld = t1 - t0, timing.cleanup = t2 - t1, timing.topology = t3 - t2, timing.render = t4 - t3, timing.total = t4 - t0, stats.timing = timing), { mesh, stats, analysis };
}

 
var GL = new Uint32Array([12, 16, 20, 24, 28, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192]), F32 = Math.fround;
function clampCell(x, g) {
  return x < 0 ? 0 : x >= g ? g - 1 : x;
}
var PairSet32 = class {
  constructor(cap = 64) {
    cap = 1 << Math.ceil(Math.log2(Math.max(16, cap))), this.a = new Uint32Array(cap), this.b = new Uint32Array(cap), this.u = new Uint8Array(cap), this.mask = cap - 1, this.n = 0;
  }
  _h(a, b) {
    return (Math.imul(a ^ 2654435769, 2246822507) ^ Math.imul(b ^ 3266489909, 668265263)) >>> 0;
  }
  has(a, b) {
    let s = this._h(a, b) & this.mask;
    for (; this.u[s]; ) {
      if (this.a[s] === a && this.b[s] === b) return !0;
      s = s + 1 & this.mask;
    }
    return !1;
  }
  add(a, b) {
    (this.n + 1) * 10 > this.u.length * 7 && this._grow();
    let s = this._h(a, b) & this.mask;
    for (; this.u[s]; ) {
      if (this.a[s] === a && this.b[s] === b) return !1;
      s = s + 1 & this.mask;
    }
    return this.u[s] = 1, this.a[s] = a, this.b[s] = b, this.n++, !0;
  }
  _grow() {
    let oa = this.a, ob = this.b, ou = this.u, cap = ou.length << 1;
    this.a = new Uint32Array(cap), this.b = new Uint32Array(cap), this.u = new Uint8Array(cap), this.mask = cap - 1, this.n = 0;
    for (let i = 0; i < ou.length; i++) ou[i] && this.add(oa[i], ob[i]);
  }
};
function makeU32Grow(cap = 1024) {
  let a = new Uint32Array(cap), n = 0;
  return { push(v) {
    if (n === a.length) {
      let b = new Uint32Array(Math.max(16, a.length << 1));
      b.set(a), a = b;
    }
    a[n++] = v >>> 0;
  }, finish() {
    return a.subarray(0, n);
  }, get n() {
    return n;
  } };
}
function pairFrame(A, B) {
  let lo0 = [1e300, 1e300, 1e300], hi0 = [-1e300, -1e300, -1e300];
  for (let M of [A, B]) {
    let p = M.pos;
    for (let i = 0; i < p.length; i += 3) {
      let x = p[i], y = p[i + 1], z = p[i + 2];
      x < lo0[0] && (lo0[0] = x), x > hi0[0] && (hi0[0] = x), y < lo0[1] && (lo0[1] = y), y > hi0[1] && (hi0[1] = y), z < lo0[2] && (lo0[2] = z), z > hi0[2] && (hi0[2] = z);
    }
  }
  let mid = new Float64Array(3), half = new Float64Array(3);
  for (let d = 0; d < 3; d++)
    mid[d] = (lo0[d] + hi0[d]) * 0.5, half[d] = Math.max(1e-12, (hi0[d] - lo0[d]) * 0.5);
  return { mid, half };
}
function encode(m, f) {
  let n = m.triCount, p = new Float64Array(n * 9), ed = new Float64Array(n * 9), nr = new Float64Array(n * 3), lo = new Float32Array(n * 3), hi = new Float32Array(n * 3), s24 = new Uint16Array(n), planeLo = new Float64Array(n), planeHi = new Float64Array(n), glo = new Float64Array([1e300, 1e300, 1e300]), ghi = new Float64Array([-1e300, -1e300, -1e300]), thin = 0, src = m.pos, tv = m.triV, m0 = f.mid, h0 = f.half;
  for (let i = 0; i < n; i++) {
    let to = i * 3, k = i * 9, ia = tv[to] * 3, ib = tv[to + 1] * 3, ic = tv[to + 2] * 3, x0 = (src[ia] - m0[0]) / h0[0], y0 = (src[ia + 1] - m0[1]) / h0[1], z0 = (src[ia + 2] - m0[2]) / h0[2], x1 = (src[ib] - m0[0]) / h0[0], y1 = (src[ib + 1] - m0[1]) / h0[1], z1 = (src[ib + 2] - m0[2]) / h0[2], x2 = (src[ic] - m0[0]) / h0[0], y2 = (src[ic + 1] - m0[1]) / h0[1], z2 = (src[ic + 2] - m0[2]) / h0[2];
    p[k] = x0, p[k + 1] = y0, p[k + 2] = z0, p[k + 3] = x1, p[k + 4] = y1, p[k + 5] = z1, p[k + 6] = x2, p[k + 7] = y2, p[k + 8] = z2;
    let l = Math.min(x0, x1, x2) - 2e-7, h = Math.max(x0, x1, x2) + 2e-7;
    lo[to] = F32(l), hi[to] = F32(h), l < glo[0] && (glo[0] = l), h > ghi[0] && (ghi[0] = h), l = Math.min(y0, y1, y2) - 2e-7, h = Math.max(y0, y1, y2) + 2e-7, lo[to + 1] = F32(l), hi[to + 1] = F32(h), l < glo[1] && (glo[1] = l), h > ghi[1] && (ghi[1] = h), l = Math.min(z0, z1, z2) - 2e-7, h = Math.max(z0, z1, z2) + 2e-7, lo[to + 2] = F32(l), hi[to + 2] = F32(h), l < glo[2] && (glo[2] = l), h > ghi[2] && (ghi[2] = h);
    let ax = x1 - x0, ay = y1 - y0, az = z1 - z0, bx = x2 - x0, by = y2 - y0, bz = z2 - z0, nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    nr[to] = nx, nr[to + 1] = ny, nr[to + 2] = nz;
    let dx = x2 - x1, dy = y2 - y1, dz = z2 - z1, ex = x0 - x2, ey = y0 - y2, ez = z0 - z2;
    ed[k] = ax, ed[k + 1] = ay, ed[k + 2] = az, ed[k + 3] = dx, ed[k + 4] = dy, ed[k + 5] = dz, ed[k + 6] = ex, ed[k + 7] = ey, ed[k + 8] = ez;
    let e0 = ax * ax + ay * ay + az * az, e1 = dx * dx + dy * dy + dz * dz, e2 = ex * ex + ey * ey + ez * ez;
    thin += Math.sqrt(nx * nx + ny * ny + nz * nz) / Math.max(1e-30, e0, e1, e2);
    let gx0 = clampCell(Math.floor((lo[to] + 1) * 12), 24), gx1 = clampCell(Math.floor((hi[to] + 1) * 12), 24), gy0 = clampCell(Math.floor((lo[to + 1] + 1) * 12), 24), gy1 = clampCell(Math.floor((hi[to + 1] + 1) * 12), 24), gz0 = clampCell(Math.floor((lo[to + 2] + 1) * 12), 24), gz1 = clampCell(Math.floor((hi[to + 2] + 1) * 12), 24);
    s24[i] = (gx1 - gx0 + 1) * (gy1 - gy0 + 1) * (gz1 - gz0 + 1);
    let l2 = nx * nx + ny * ny + nz * nz, ep = 1e-11 * Math.sqrt(l2), q0 = x0 * nx + y0 * ny + z0 * nz, q1 = x1 * nx + y1 * ny + z1 * nz, q2 = x2 * nx + y2 * ny + z2 * nz;
    planeLo[i] = Math.min(q0, q1, q2) - ep, planeHi[i] = Math.max(q0, q1, q2) + ep;
  }
  return { n, p, ed, nr, lo, hi, s24, planeLo, planeHi, thinMean: n ? thin / n : 0, glo, ghi };
}
function objectOverlap(A, B) {
  return !(A.ghi[0] < B.glo[0] || B.ghi[0] < A.glo[0] || A.ghi[1] < B.glo[1] || B.ghi[1] < A.glo[1] || A.ghi[2] < B.glo[2] || B.ghi[2] < A.glo[2]);
}
function med24(E) {
  let h = new Uint32Array(13825);
  for (let i = 0; i < E.n; i++) h[E.s24[i]]++;
  let target = E.n + 1 >>> 1, s = 0;
  for (let v = 1; v < 13825; v++)
    if (s += h[v], s >= target) return v;
  return 1;
}
function meta(A, B) {
  let medA = med24(A), medB = med24(B), ba = 0, bb = 0;
  for (let i = 0; i < A.n; i++) ba += A.s24[i] > 8 * medA;
  for (let i = 0; i < B.n; i++) bb += B.s24[i] > 8 * medB;
  let n = A.n + B.n, outFrac = n ? (ba + bb) / n : 0, rho = n ? (A.thinMean * A.n + B.thinMean * B.n) / n : 0;
  return { cls: rho < 0.3 ? "S" : outFrac > 6e-3 ? "M" : "N", medA, medB, outFrac, rho, nEff: Math.sqrt(A.n * B.n) };
}
function qg(x) {
  let best = GL[0], d = 1e300;
  for (let i = 0; i < GL.length; i++) {
    let g = GL[i], z = Math.abs(Math.log(g / x));
    z < d && (d = z, best = g);
  }
  return best;
}
function chooseG(A, B, m) {
  let ratio = Math.max(A.n, B.n) / Math.max(1, Math.min(A.n, B.n)), asym = Math.pow(ratio, -0.05);
  return m.cls === "N" ? qg(23.43 * Math.pow(m.nEff / 6400, 0.297) * asym) : m.cls === "M" ? qg(51.69 * Math.pow(m.nEff / 6400, 0.83) * Math.pow(Math.min(0.3, Math.max(6e-3, m.outFrac)) / 0.04, -0.25) * asym) : qg(85.61 * Math.pow(m.nEff / 6400, 0.491));
}
function ranges(E, g) {
  let r = new Uint16Array(E.n * 6), s = g / 2;
  for (let i = 0; i < E.n; i++) {
    let o = i * 3, q = i * 6;
    r[q] = clampCell(Math.floor((E.lo[o] + 1) * s), g), r[q + 3] = clampCell(Math.floor((E.hi[o] + 1) * s), g), r[q + 1] = clampCell(Math.floor((E.lo[o + 1] + 1) * s), g), r[q + 4] = clampCell(Math.floor((E.hi[o + 1] + 1) * s), g), r[q + 2] = clampCell(Math.floor((E.lo[o + 2] + 1) * s), g), r[q + 5] = clampCell(Math.floor((E.hi[o + 2] + 1) * s), g);
  }
  return r;
}
function emitAABB(R, i, g, out) {
  let o = i * 6, x0 = R[o], x1 = R[o + 3];
  for (let z = R[o + 2]; z <= R[o + 5]; z++) for (let y = R[o + 1]; y <= R[o + 4]; y++) {
    let c = z * g * g + y * g + x0;
    for (let x = x0; x <= x1; x++) out.push(c++);
  }
}
function emitSorted(E, R, i, g, out) {
  let o3 = i * 3, k = i * 9, nx = E.nr[o3], ny = E.nr[o3 + 1], nz = E.nr[o3 + 2], anx = Math.abs(nx), any = Math.abs(ny), anz = Math.abs(nz), w, u, v, nw, nu, nv;
  if (anx >= any && anx >= anz ? (w = 0, u = 1, v = 2, nw = nx, nu = ny, nv = nz) : any >= anz ? (w = 1, u = 0, v = 2, nw = ny, nu = nx, nv = nz) : (w = 2, u = 0, v = 1, nw = nz, nu = nx, nv = ny), Math.abs(nw) < 1e-15) {
    emitAABB(R, i, g, out);
    return;
  }
  let U0 = E.p[k + u], V0 = E.p[k + v], U1 = E.p[k + 3 + u], V1 = E.p[k + 3 + v], U2 = E.p[k + 6 + u], V2 = E.p[k + 6 + v];
  if (V0 > V1) {
    let t = V0;
    V0 = V1, V1 = t, t = U0, U0 = U1, U1 = t;
  }
  if (V1 > V2) {
    let t = V1;
    V1 = V2, V2 = t, t = U1, U1 = U2, U2 = t;
  }
  if (V0 > V1) {
    let t = V0;
    V0 = V1, V1 = t, t = U0, U0 = U1, U1 = t;
  }
  let d02 = V2 - V0, s02 = Math.abs(d02) > 1e-30 ? (U2 - U0) / d02 : 0, s01 = Math.abs(V1 - V0) > 1e-30 ? (U1 - U0) / (V1 - V0) : 0, s12 = Math.abs(V2 - V1) > 1e-30 ? (U2 - U1) / (V2 - V1) : 0, iv = 1 / nw, au = -nu * iv, av = -nv * iv, cc = (nx * E.p[k] + ny * E.p[k + 1] + nz * E.p[k + 2]) * iv, h = 1 / g, ww = 2 / g, sc = g / 2, e = 1e-7, rad = h * (Math.abs(au) + Math.abs(av)) + e, lw = E.lo[o3 + w], hw = E.hi[o3 + w], v0 = clampCell(Math.floor((V0 - e + 1) * sc), g), v1 = clampCell(Math.floor((V2 + e + 1) * sc), g), z0 = clampCell(Math.floor((lw + 1) * sc), g), z1 = clampCell(Math.floor((hw + 1) * sc), g);
  for (let vv = v0; vv <= v1; vv++) {
    let cv = -1 + (vv + 0.5) * ww, ya = Math.max(V0, cv - h - e), yb = Math.min(V2, cv + h + e);
    if (ya > yb) continue;
    let la = U0 + (ya - V0) * s02, sa = ya <= V1 ? U0 + (ya - V0) * s01 : U1 + (ya - V1) * s12, lb = U0 + (yb - V0) * s02, sb = yb <= V1 ? U0 + (yb - V0) * s01 : U1 + (yb - V1) * s12, mn = Math.min(la, sa, lb, sb), mx = Math.max(la, sa, lb, sb);
    ya <= V1 && V1 <= yb && (U1 < mn && (mn = U1), U1 > mx && (mx = U1));
    let a = clampCell(Math.floor((mn - e + 1) * sc), g), b = clampCell(Math.floor((mx + e + 1) * sc), g);
    for (let uu = a; uu <= b; uu++) {
      let cu = -1 + (uu + 0.5) * ww, wc = cc + au * cu + av * cv, AA = Math.floor((Math.max(lw, wc - rad) + 1) * sc), BB = Math.floor((Math.min(hw, wc + rad) + 1) * sc), A = Math.max(z0, Math.min(z1, AA)), B = Math.max(z0, Math.min(z1, BB));
      if (A > B) continue;
      let step, base;
      w === 0 ? (step = 1, base = vv * g * g + uu * g + A) : w === 1 ? (step = g, base = vv * g * g + A * g + uu) : (step = g * g, base = A * g * g + vv * g + uu);
      for (let ww0 = A, c = base; ww0 <= B; ww0++, c += step) out.push(c);
    }
  }
}
function cells(E, g, mode, med) {
  let b = new Uint32Array(E.n + 1), R = ranges(E, g), out = makeU32Grow(Math.max(1024, E.n * 12));
  for (let i = 0; i < E.n; i++)
    mode === "ALL" || mode === "R8" && E.s24[i] > 8 * med ? emitSorted(E, R, i, g, out) : emitAABB(R, i, g, out), b[i + 1] = out.n;
  let c = out.finish();
  return { c, b, n: c.length };
}
function aabbOv(A, a, B, b) {
  let x = a * 3, y = b * 3;
  return !(A.hi[x] < B.lo[y] || B.hi[y] < A.lo[x] || A.hi[x + 1] < B.lo[y + 1] || B.hi[y + 1] < A.lo[x + 1] || A.hi[x + 2] < B.lo[y + 2] || B.hi[y + 2] < A.lo[x + 2]);
}
function sepCached(ax, ay, az, lo, hi, B, b) {
  if (ax * ax + ay * ay + az * az < 1e-30) return !1;
  let o = b * 9, q = B.p[o] * ax + B.p[o + 1] * ay + B.p[o + 2] * az, mn = q, mx = q;
  return q = B.p[o + 3] * ax + B.p[o + 4] * ay + B.p[o + 5] * az, q < mn && (mn = q), q > mx && (mx = q), q = B.p[o + 6] * ax + B.p[o + 7] * ay + B.p[o + 8] * az, q < mn && (mn = q), q > mx && (mx = q), mx < lo || mn > hi;
}
function faceReject(A, a, B, b) {
  let n = a * 3;
  return sepCached(A.nr[n], A.nr[n + 1], A.nr[n + 2], A.planeLo[a], A.planeHi[a], B, b) ? !0 : (n = b * 3, sepCached(B.nr[n], B.nr[n + 1], B.nr[n + 2], B.planeLo[b], B.planeHi[b], A, a));
}
function sepExact(A, a, B, b, ax, ay, az) {
  let l2 = ax * ax + ay * ay + az * az;
  if (l2 < 1e-24) return !1;
  let oa = a * 9, ob = b * 9, x = A.p[oa] * ax + A.p[oa + 1] * ay + A.p[oa + 2] * az, amin = x, amax = x;
  x = A.p[oa + 3] * ax + A.p[oa + 4] * ay + A.p[oa + 5] * az, x < amin && (amin = x), x > amax && (amax = x), x = A.p[oa + 6] * ax + A.p[oa + 7] * ay + A.p[oa + 8] * az, x < amin && (amin = x), x > amax && (amax = x), x = B.p[ob] * ax + B.p[ob + 1] * ay + B.p[ob + 2] * az;
  let bmin = x, bmax = x;
  x = B.p[ob + 3] * ax + B.p[ob + 4] * ay + B.p[ob + 5] * az, x < bmin && (bmin = x), x > bmax && (bmax = x), x = B.p[ob + 6] * ax + B.p[ob + 7] * ay + B.p[ob + 8] * az, x < bmin && (bmin = x), x > bmax && (bmax = x);
  let eps = 1e-11 * Math.sqrt(l2);
  return amax < bmin - eps || bmax < amin - eps;
}
function exactE4D(A, a, B, b) {
  let ba = a * 9, bb = b * 9;
  for (let i = 0; i < 3; i++) {
    let ea2 = ba + i * 3, ax = A.ed[ea2], ay = A.ed[ea2 + 1], az = A.ed[ea2 + 2], ao = (i + 2) % 3, aa = ba + i * 3, aoo = ba + ao * 3;
    for (let j = 0; j < 3; j++) {
      let eb2 = bb + j * 3, bx = B.ed[eb2], by = B.ed[eb2 + 1], bz = B.ed[eb2 + 2], cx2 = ay * bz - az * by, cy2 = az * bx - ax * bz, cz2 = ax * by - ay * bx, l2 = cx2 * cx2 + cy2 * cy2 + cz2 * cz2;
      if (l2 < 1e-24) continue;
      let bo = (j + 2) % 3, b0 = bb + j * 3, b1 = bb + bo * 3, q0 = A.p[aa] * cx2 + A.p[aa + 1] * cy2 + A.p[aa + 2] * cz2, q1 = A.p[aoo] * cx2 + A.p[aoo + 1] * cy2 + A.p[aoo + 2] * cz2, r0 = B.p[b0] * cx2 + B.p[b0 + 1] * cy2 + B.p[b0 + 2] * cz2, r1 = B.p[b1] * cx2 + B.p[b1 + 1] * cy2 + B.p[b1 + 2] * cz2, eps = 1e-11 * Math.sqrt(l2);
      if (Math.max(q0, q1) < Math.min(r0, r1) - eps || Math.max(r0, r1) < Math.min(q0, q1) - eps) return 0;
    }
  }
  let ea = ba, eb = bb, na = a * 3, nb = b * 3, anx = A.nr[na], any = A.nr[na + 1], anz = A.nr[na + 2], bnx = B.nr[nb], bny = B.nr[nb + 1], bnz = B.nr[nb + 2], cx = any * bnz - anz * bny, cy = anz * bnx - anx * bnz, cz = anx * bny - any * bnx, n2a = anx * anx + any * any + anz * anz, n2b = bnx * bnx + bny * bny + bnz * bnz;
  if (cx * cx + cy * cy + cz * cz <= 1e-18 * n2a * n2b) {
    let dx = B.p[bb] - A.p[ba], dy = B.p[bb + 1] - A.p[ba + 1], dz = B.p[bb + 2] - A.p[ba + 2];
    if (Math.abs(anx * dx + any * dy + anz * dz) <= 1e-10 * Math.sqrt(n2a)) {
      for (let i = 0; i < 3; i++) {
        let q = ea + i * 3, ex = A.ed[q], ey = A.ed[q + 1], ez = A.ed[q + 2], sx = any * ez - anz * ey, sy = anz * ex - anx * ez, sz = anx * ey - any * ex;
        if (sepExact(A, a, B, b, sx, sy, sz) || (q = eb + i * 3, ex = B.ed[q], ey = B.ed[q + 1], ez = B.ed[q + 2], sx = bny * ez - bnz * ey, sy = bnz * ex - bnx * ez, sz = bnx * ey - bny * ex, sepExact(A, a, B, b, sx, sy, sz))) return 0;
      }
      return 2;
    }
  }
  return 1;
}
function inTriRaw(M, tri, px, py, pz) {
  let o = tri * 3, tv = M.triV, pos = M.pos, ia = tv[o] * 3, ib = tv[o + 1] * 3, ic = tv[o + 2] * 3, ax = pos[ia], ay = pos[ia + 1], az = pos[ia + 2], v0x = pos[ib] - ax, v0y = pos[ib + 1] - ay, v0z = pos[ib + 2] - az, v1x = pos[ic] - ax, v1y = pos[ic + 1] - ay, v1z = pos[ic + 2] - az, v2x = px - ax, v2y = py - ay, v2z = pz - az, d00 = v0x * v0x + v0y * v0y + v0z * v0z, d01 = v0x * v1x + v0y * v1y + v0z * v1z, d11 = v1x * v1x + v1y * v1y + v1z * v1z, d20 = v2x * v0x + v2y * v0y + v2z * v0z, d21 = v2x * v1x + v2y * v1y + v2z * v1z, den = d00 * d11 - d01 * d01;
  if (Math.abs(den) < 1e-30) return !1;
  let v = (d11 * d20 - d01 * d21) / den, w = (d00 * d21 - d01 * d20) / den, u = 1 - v - w, eps = 1e-8;
  return u >= -eps && v >= -eps && w >= -eps && u <= 1 + eps && v <= 1 + eps && w <= 1 + eps;
}
function featurePacked(M, tri, px, py, pz) {
  let o = tri * 3, tv = M.triV, pos = M.pos, ia = tv[o] * 3, ib = tv[o + 1] * 3, ic = tv[o + 2] * 3, ax = pos[ia], ay = pos[ia + 1], az = pos[ia + 2], v0x = pos[ib] - ax, v0y = pos[ib + 1] - ay, v0z = pos[ib + 2] - az, v1x = pos[ic] - ax, v1y = pos[ic + 1] - ay, v1z = pos[ic + 2] - az, v2x = px - ax, v2y = py - ay, v2z = pz - az, d00 = v0x * v0x + v0y * v0y + v0z * v0z, d01 = v0x * v1x + v0y * v1y + v0z * v1z, d11 = v1x * v1x + v1y * v1y + v1z * v1z, d20 = v2x * v0x + v2y * v0y + v2z * v0z, d21 = v2x * v1x + v2y * v1y + v2z * v1z, den = d00 * d11 - d01 * d01;
  if (Math.abs(den) < 1e-30) return 2 + tri * 4;
  let v = (d11 * d20 - d01 * d21) / den, w = (d00 * d21 - d01 * d20) / den, u = 1 - v - w, eps = 3e-8, z0 = Math.abs(u) < eps, z1 = Math.abs(v) < eps, z2 = Math.abs(w) < eps, z = (z0 ? 1 : 0) + (z1 ? 1 : 0) + (z2 ? 1 : 0);
  if (z >= 2) {
    let vi = u >= v && u >= w ? 0 : v >= w ? 1 : 2;
    return M.triV[o + vi] * 4;
  }
  if (z === 1) {
    let eid;
    return z0 ? eid = M.triE[o + 1] : z1 ? eid = M.triE[o + 2] : eid = M.triE[o], eid * 4 + 1;
  }
  return tri * 4 + 2;
}
function makeTriWorkspace() {
  return { x: new Float64Array(16), y: new Float64Array(16), z: new Float64Array(16), ka: new Float64Array(16), kb: new Float64Array(16) };
}
function triSegmentFast(A, ia, B, ib, W) {
  let oa = ia * 3, ob = ib * 3, av = A.triV, bv = B.triV, ap = A.pos, bp = B.pos, a0 = av[oa] * 3, a1 = av[oa + 1] * 3, a2 = av[oa + 2] * 3, b0 = bv[ob] * 3, b1 = bv[ob + 1] * 3, b2 = bv[ob + 2] * 3, a0x = ap[a0], a0y = ap[a0 + 1], a0z = ap[a0 + 2], a1x = ap[a1], a1y = ap[a1 + 1], a1z = ap[a1 + 2], a2x = ap[a2], a2y = ap[a2 + 1], a2z = ap[a2 + 2], b0x = bp[b0], b0y = bp[b0 + 1], b0z = bp[b0 + 2], b1x = bp[b1], b1y = bp[b1 + 1], b1z = bp[b1 + 2], b2x = bp[b2], b2y = bp[b2 + 1], b2z = bp[b2 + 2], ae1x = a1x - a0x, ae1y = a1y - a0y, ae1z = a1z - a0z, ae2x = a2x - a0x, ae2y = a2y - a0y, ae2z = a2z - a0z, naX = ae1y * ae2z - ae1z * ae2y, naY = ae1z * ae2x - ae1x * ae2z, naZ = ae1x * ae2y - ae1y * ae2x, be1x = b1x - b0x, be1y = b1y - b0y, be1z = b1z - b0z, be2x = b2x - b0x, be2y = b2y - b0y, be2z = b2z - b0z, nbX = be1y * be2z - be1z * be2y, nbY = be1z * be2x - be1x * be2z, nbZ = be1x * be2y - be1y * be2x, nla = Math.sqrt(naX * naX + naY * naY + naZ * naZ), nlb = Math.sqrt(nbX * nbX + nbY * nbY + nbZ * nbZ);
  if (nla < 1e-14 || nlb < 1e-14) return !1;
  let cx = naY * nbZ - naZ * nbY, cy = naZ * nbX - naX * nbZ, cz = naX * nbY - naY * nbX;
  if (Math.sqrt(cx * cx + cy * cy + cz * cz) / (nla * nlb) < 1e-10) return !1;
  let n = 0;
  function addCand(px, py, pz) {
    let ka = featurePacked(A, ia, px, py, pz), kb = featurePacked(B, ib, px, py, pz);
    for (let j = 0; j < n; j++) if (W.ka[j] === ka && W.kb[j] === kb) return;
    W.x[n] = px, W.y[n] = py, W.z[n] = pz, W.ka[n] = ka, W.kb[n] = kb, n++;
  }
  function edgePlane(px, py, pz, qx, qy, qz, rx, ry, rz, nx, ny, nz, other, ot) {
    let dx = px - rx, dy = py - ry, dz = pz - rz, ex = qx - rx, ey = qy - ry, ez = qz - rz, dp = nx * dx + ny * dy + nz * dz, dq = nx * ex + ny * ey + nz * ez, eps = 1e-10 * Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (Math.abs(dp) < eps && inTriRaw(other, ot, px, py, pz) && addCand(px, py, pz), dp * dq < 0 || Math.abs(dp) < eps || Math.abs(dq) < eps) {
      let den = dp - dq;
      if (Math.abs(den) > eps * 1e-3) {
        let t = dp / den;
        if (t >= -1e-10 && t <= 1 + 1e-10) {
          let xx = px + (qx - px) * t, yy = py + (qy - py) * t, zz = pz + (qz - pz) * t;
          inTriRaw(other, ot, xx, yy, zz) && addCand(xx, yy, zz);
        }
      }
    }
  }
  if (edgePlane(a0x, a0y, a0z, a1x, a1y, a1z, b0x, b0y, b0z, nbX, nbY, nbZ, B, ib), edgePlane(a1x, a1y, a1z, a2x, a2y, a2z, b0x, b0y, b0z, nbX, nbY, nbZ, B, ib), edgePlane(a2x, a2y, a2z, a0x, a0y, a0z, b0x, b0y, b0z, nbX, nbY, nbZ, B, ib), edgePlane(b0x, b0y, b0z, b1x, b1y, b1z, a0x, a0y, a0z, naX, naY, naZ, A, ia), edgePlane(b1x, b1y, b1z, b2x, b2y, b2z, a0x, a0y, a0z, naX, naY, naZ, A, ia), edgePlane(b2x, b2y, b2z, b0x, b0y, b0z, a0x, a0y, a0z, naX, naY, naZ, A, ia), n < 2) return !1;
  let best = -1;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    let dx = W.x[i] - W.x[j], dy = W.y[i] - W.y[j], dz = W.z[i] - W.z[j], dd = dx * dx + dy * dy + dz * dz;
    dd > best && (best = dd);
  }
  return best >= 1e-18;
}
function discover(A0, B0, { forceP32 = -1, profile = !1, p32Policy = "js", maxDenseOffsetBytes = 64 * 1024 * 1024, planarA = null, planarB = null } = {}) {
  let timing = profile ? {} : null, t0 = profile ? performance.now() : 0, f = pairFrame(A0, B0), t1 = profile ? performance.now() : 0, A = encode(A0, f), B = encode(B0, f), t2 = profile ? performance.now() : 0, stats = { class: "N", mode: "AABB", g: 0, postingsA: 0, postingsB: 0, rawVisits: 0, uniquePairs: 0, aabbPairs: 0, facePairs: 0, exactPairs: 0, segmentHits: 0, coplanarExact: 0, coplanarSuppressed: 0, p32: !1, ids16: !1, stampResets: 0, activePages: 0 };
  if (!objectOverlap(A, B)) return { hitPairs: new Uint32Array(0), coplanarTriPairs: new Uint32Array(0), coplanarPairs: [], activeFacesA: new Uint32Array(0), activeFacesB: new Uint32Array(0), stats };
  let m = meta(A, B);
  stats.class = m.cls, stats.mode = m.cls === "N" ? "AABB" : m.cls === "M" ? "R8" : "ALL", stats.g = chooseG(A, B, m);
  let ca = cells(A, stats.g, stats.mode, m.medA), cb = cells(B, stats.g, stats.mode, m.medB), t3 = profile ? performance.now() : 0;
  stats.postingsA = ca.n, stats.postingsB = cb.n;
  let rev = cb.n < ca.n, I = rev ? B : A, Q = rev ? A : B, ci = rev ? cb : ca, cq = rev ? ca : cb, N = stats.g * stats.g * stats.g, r2PolicyP32 = N >= 1e6 && ci.n / N < 0.32, denseOffsetBytes = (N + 2) * 4, jsPolicyP32 = denseOffsetBytes > maxDenseOffsetBytes, policyP32 = p32Policy === "r2" ? r2PolicyP32 : jsPolicyP32;
  stats.p32 = forceP32 < 0 ? policyP32 : forceP32 !== 0, stats.r2PolicyP32 = r2PolicyP32, stats.denseOffsetBytes = denseOffsetBytes;
  let ids16 = I.n <= 65535;
  stats.ids16 = ids16;
  let denseOff, ids, pageMap, pageBase, pageOff;
  if (stats.p32) {
    let pages = N + 31 >>> 5;
    pageMap = new Uint32Array(pages);
    let activePages = 0;
    for (let k = 0; k < ci.c.length; k++) {
      let pg = ci.c[k] >>> 5;
      pageMap[pg] || (pageMap[pg] = ++activePages);
    }
    stats.activePages = activePages, pageOff = new Uint32Array(activePages * 33);
    for (let k = 0; k < ci.c.length; k++) {
      let c = ci.c[k], pi = pageMap[c >>> 5] - 1;
      pageOff[pi * 33 + (c & 31) + 1]++;
    }
    pageBase = new Uint32Array(activePages + 1);
    for (let p = 0; p < activePages; p++) {
      let po = p * 33;
      for (let j = 0; j < 32; j++) pageOff[po + j + 1] += pageOff[po + j];
      pageBase[p + 1] = pageBase[p] + pageOff[po + 32];
    }
    let wr = new Uint32Array(activePages * 32);
    for (let p = 0; p < activePages; p++) {
      let po = p * 33, wo = p * 32;
      for (let j = 0; j < 32; j++) wr[wo + j] = pageOff[po + j];
    }
    ids = ids16 ? new Uint16Array(ci.c.length) : new Uint32Array(ci.c.length);
    for (let i = 0; i < I.n; i++) for (let k = ci.b[i]; k < ci.b[i + 1]; k++) {
      let c = ci.c[k], pi = pageMap[c >>> 5] - 1, lc = c & 31, wi = pi * 32 + lc;
      ids[pageBase[pi] + wr[wi]++] = i;
    }
  } else {
    denseOff = new Uint32Array(N + 2);
    for (let k = 0; k < ci.c.length; k++) denseOff[ci.c[k] + 1]++;
    for (let c = 0; c < N; c++) denseOff[c + 1] += denseOff[c];
    ids = ids16 ? new Uint16Array(ci.c.length) : new Uint32Array(ci.c.length);
    for (let i = 0; i < I.n; i++) for (let k = ci.b[i]; k < ci.b[i + 1]; k++) {
      let c = ci.c[k];
      ids[--denseOff[c + 1]] = i;
    }
    denseOff[N + 1] = ids.length;
  }
  let t4 = profile ? performance.now() : 0, stamp = ids16 ? new Uint16Array(I.n) : new Uint32Array(I.n), mark = 0, pairs = makeU32Grow(4096), copPairs = makeU32Grow(256), coplanarPairs = [], usePlanar = !!(planarA && planarB), cpSeen = usePlanar ? new PairSet32(64) : null, W = makeTriWorkspace();
  for (let q = 0; q < Q.n; q++) {
    ids16 ? mark >= 65534 ? (stamp.fill(0), mark = 1, stats.stampResets++) : mark++ : (mark = mark + 1 >>> 0, mark === 0 && (stamp.fill(0), mark = 1));
    for (let k = cq.b[q]; k < cq.b[q + 1]; k++) {
      let c = cq.c[k], lo, hi;
      if (!stats.p32)
        lo = denseOff[c + 1], hi = denseOff[c + 2];
      else {
        let tag = pageMap[c >>> 5];
        if (!tag) continue;
        let pi = tag - 1, lc = c & 31, po = pi * 33;
        lo = pageBase[pi] + pageOff[po + lc], hi = pageBase[pi] + pageOff[po + lc + 1];
      }
      for (let pp = usePlanar ? hi - 1 : lo, end = usePlanar ? lo - 1 : hi, step = usePlanar ? -1 : 1; pp !== end; pp += step) {
        stats.rawVisits++;
        let id = ids[pp];
        if (stamp[id] === mark) continue;
        stamp[id] = mark, stats.uniquePairs++;
        let a = rev ? q : id, b = rev ? id : q;
        if (!aabbOv(A, a, B, b)) continue;
        stats.aabbPairs++;
        let pa = -1, pb = -1;
        if (usePlanar) {
          let fa = A0.triFace[a], fb = B0.triFace[b];
          if (fa < planarA.facePatch.length && fb < planarB.facePatch.length && (pa = planarA.facePatch[fa], pb = planarB.facePatch[fb], pa >= 0 && pb >= 0 && cpSeen.has(pa, pb))) {
            stats.coplanarSuppressed++;
            continue;
          }
        }
        if (faceReject(A, a, B, b)) continue;
        stats.facePairs++;
        let ex = exactE4D(A, a, B, b);
        if (ex) {
          if (stats.exactPairs++, ex === 2) {
            if (stats.coplanarExact++, usePlanar) {
              if (pa >= 0 && pb >= 0 && cpSeen.add(pa, pb)) {
                let na = planarA.normal[pa], nb = planarB.normal[pb];
                coplanarPairs.push({ patchA: pa, patchB: pb, planeKey: planarA.planeKey[pa], sameOrientation: na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2] > 0 });
              }
            } else
              copPairs.push(a), copPairs.push(b);
            continue;
          }
          triSegmentFast(A0, a, B0, b, W) && (pairs.push(a), pairs.push(b), stats.segmentHits++);
        }
      }
    }
  }
  let t5 = profile ? performance.now() : 0, rawPairs = pairs.finish(), order = new Array(stats.segmentHits);
  for (let i = 0; i < order.length; i++) order[i] = i;
  order.sort((i, j) => rawPairs[i * 2] - rawPairs[j * 2] || rawPairs[i * 2 + 1] - rawPairs[j * 2 + 1]);
  let hitPairs = new Uint32Array(rawPairs.length);
  for (let k = 0; k < order.length; k++) {
    let i = order[k] * 2;
    hitPairs[k * 2] = rawPairs[i], hitPairs[k * 2 + 1] = rawPairs[i + 1];
  }
  let activeA = makeU32Grow(Math.min(A0.faceCount, 1024)), activeB = makeU32Grow(Math.min(B0.faceCount, 1024));
  function active(M, E, O, dst) {
    let seen = new Uint8Array(M.faceCount);
    for (let ti = 0; ti < E.n; ti++) {
      let o = ti * 3;
      if (!(E.hi[o] < O.glo[0] || E.lo[o] > O.ghi[0] || E.hi[o + 1] < O.glo[1] || E.lo[o + 1] > O.ghi[1] || E.hi[o + 2] < O.glo[2] || E.lo[o + 2] > O.ghi[2])) {
        let f2 = M.triFace[ti];
        seen[f2] || (seen[f2] = 1, dst.push(f2));
      }
    }
  }
  active(A0, A, B, activeA), active(B0, B, A, activeB);
  let t6 = profile ? performance.now() : 0;
  return profile && (timing.frame = t1 - t0, timing.encode = t2 - t1, timing.cells = t3 - t2, timing.postings = t4 - t3, timing.query = t5 - t4, timing.tail = t6 - t5, timing.total = t6 - t0, stats.timing = timing), coplanarPairs.length && coplanarPairs.sort((x, y) => x.patchA - y.patchA || x.patchB - y.patchB), { hitPairs, coplanarTriPairs: copPairs.finish(), coplanarPairs, activeFacesA: activeA.finish(), activeFacesB: activeB.finish(), stats };
}

 
function planeKey(nx, ny, nz, d, eps) {
  let x = nx, y = ny, z = nz, dd = d, ax = Math.abs(x) > 0.5 ? 0 : Math.abs(y) > 0.5 ? 1 : 2;
  (ax === 0 ? x : ax === 1 ? y : z) < 0 && (x = -x, y = -y, z = -z, dd = -dd);
  let vals = [Math.round(x / 1e-8), Math.round(y / 1e-8), Math.round(z / 1e-8), Math.round(dd / eps)], h = 1469598103934665603n;
  for (let q of vals)
    h ^= BigInt.asUintN(64, BigInt(q)), h = BigInt.asUintN(64, h * 1099511628211n);
  return Number(BigInt.asUintN(32, h ^ h >> 32n));
}
function buildPlanarCacheFast(m) {
  let n = m.faceCount >>> 0, ec = m.edgeCount >>> 0, tv = m.triV, te = m.triE, p = m.pos, facePatch = new Int32Array(n);
  facePatch.fill(-1);
  let scale = 1;
  for (let i = 0; i < p.length; i++) {
    let x = Math.abs(p[i]);
    x > scale && (scale = x);
  }
  let eps = scale * 1e-9, nx = new Float64Array(n), ny = new Float64Array(n), nz = new Float64Array(n), pd = new Float64Array(n), valid = new Uint8Array(n);
  for (let f = 0; f < n; f++) {
    let o = f * 3, ia = tv[o] * 3, ib = tv[o + 1] * 3, ic = tv[o + 2] * 3, ax = p[ia], ay = p[ia + 1], az = p[ia + 2], ux = p[ib] - ax, uy = p[ib + 1] - ay, uz = p[ib + 2] - az, vx = p[ic] - ax, vy = p[ic + 1] - ay, vz = p[ic + 2] - az, x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx, L = Math.hypot(x, y, z);
    L > 1e-14 && (L = 1 / L, x *= L, y *= L, z *= L, nx[f] = x, ny[f] = y, nz[f] = z, pd[f] = x * ax + y * ay + z * az, valid[f] = 1);
  }
  let sameRoot = (r, g) => valid[g] && nx[r] * nx[g] + ny[r] * ny[g] + nz[r] * nz[g] > 1 - 1e-10 && Math.abs(pd[r] - pd[g]) <= eps, edgeDeg = new Uint32Array(ec);
  for (let i = 0; i < te.length; i++) edgeDeg[te[i]]++;
  let eoff = new Uint32Array(ec + 1);
  for (let e = 0; e < ec; e++) eoff[e + 1] = eoff[e] + edgeDeg[e];
  let ecur = eoff.slice(0, ec), eface = new Uint32Array(te.length);
  for (let f = 0; f < n; f++) {
    let o = f * 3;
    eface[ecur[te[o]]++] = f, eface[ecur[te[o + 1]]++] = f, eface[ecur[te[o + 2]]++] = f;
  }
  let patches = [], normal = [], planeKeys = [], ambiguous = !1, queue = new Uint32Array(n), facesBuf = new Uint32Array(n), edgeStamp = new Uint32Array(ec), edgeCnt = new Uint32Array(ec), touchedEdges = new Uint32Array(Math.min(te.length, ec || 1)), gen = 0, bdA = new Uint32Array(n * 3), bdB = new Uint32Array(n * 3), bdE = new Uint32Array(n * 3), bdNext = new Int32Array(n * 3), bdUsed = new Uint8Array(n * 3), vcount = p.length / 3 >>> 0, head = new Int32Array(vcount), headStamp = new Uint32Array(vcount), hgen = 0;
  for (let root = 0; root < n; root++) {
    if (facePatch[root] !== -1 || !valid[root]) continue;
    let pid = patches.length, qh = 0, qt = 0, fc = 0;
    for (queue[qt++] = root, facePatch[root] = pid; qh < qt; ) {
      let f = queue[qh++];
      facesBuf[fc++] = f;
      let o = f * 3;
      for (let le = 0; le < 3; le++) {
        let e = te[o + le];
        for (let k = eoff[e]; k < eoff[e + 1]; k++) {
          let g = eface[k];
          facePatch[g] === -1 && sameRoot(root, g) && (facePatch[g] = pid, queue[qt++] = g);
        }
      }
    }
    ++gen === 4294967295 && (edgeStamp.fill(0), gen = 1);
    let nt = 0;
    for (let fi = 0; fi < fc; fi++) {
      let f = facesBuf[fi], o = f * 3;
      for (let le = 0; le < 3; le++) {
        let e = te[o + le];
        edgeStamp[e] !== gen ? (edgeStamp[e] = gen, edgeCnt[e] = 1, touchedEdges[nt++] = e) : edgeCnt[e]++;
      }
    }
    let bdn = 0, bad = !1;
    for (let fi = 0; fi < fc && !bad; fi++) {
      let f = facesBuf[fi], o = f * 3;
      for (let le = 0; le < 3; le++) {
        let e = te[o + le];
        edgeCnt[e] === 1 && (bdA[bdn] = tv[o + le], bdB[bdn] = tv[o + (le + 1) % 3], bdE[bdn] = e, bdn++);
      }
    }
    if (bad || bdn === 0) {
      ambiguous = !0;
      for (let fi = 0; fi < fc; fi++) facePatch[facesBuf[fi]] = -2;
      continue;
    }
    ++hgen === 4294967295 && (headStamp.fill(0), hgen = 1), bdUsed.fill(0, 0, bdn);
    for (let i = 0; i < bdn; i++) {
      let a = bdA[i];
      headStamp[a] !== hgen && (headStamp[a] = hgen, head[a] = -1), bdNext[i] = head[a], head[a] = i;
    }
    let loopStarts = new Uint32Array(bdn), loopLens = new Uint32Array(bdn), loopCount = 0, loopStoreN = 0, loopStore = new Uint32Array(bdn);
    for (let si = 0; si < bdn; si++) if (!bdUsed[si]) {
      let ls = loopStoreN, cur = si, start = bdA[cur], closed = !1;
      for (let guard = 0; guard <= bdn && !bdUsed[cur]; guard++) {
        bdUsed[cur] = 1, loopStore[loopStoreN++] = cur;
        let v = bdB[cur];
        if (v === start) {
          closed = !0;
          break;
        }
        let nxidx = -1;
        if (headStamp[v] === hgen) {
          for (let z = head[v]; z >= 0; z = bdNext[z]) if (!bdUsed[z]) {
            if (nxidx !== -1) {
              nxidx = -2;
              break;
            }
            nxidx = z;
          }
        }
        if (nxidx < 0) break;
        cur = nxidx;
      }
      let ll = loopStoreN - ls;
      closed && ll >= 3 ? (loopStarts[loopCount] = ls, loopLens[loopCount] = ll, loopCount++) : bad = !0;
    }
    if (bad || loopCount === 0) {
      ambiguous = !0;
      for (let fi = 0; fi < fc; fi++) facePatch[facesBuf[fi]] = -2;
      continue;
    }
    let anx = Math.abs(nx[root]), any = Math.abs(ny[root]), anz = Math.abs(nz[root]), drop = anx >= any && anx >= anz ? 0 : any >= anz ? 1 : 2, outer = 0, best = -1;
    for (let li = 0; li < loopCount; li++) {
      let ls = loopStarts[li], ll = loopLens[li], ar = 0;
      for (let j = 0; j < ll; j++) {
        let be = loopStore[ls + j], ia = bdA[be] * 3, ib = bdB[be] * 3, x = p[ia], y = p[ia + 1], z = p[ia + 2], X = p[ib], Y = p[ib + 1], Z = p[ib + 2], pu = drop === 0 ? y : x, pv = drop === 2 ? y : z, ru = drop === 0 ? Y : X;
        ar += pu * (drop === 2 ? Y : Z) - pv * ru;
      }
      ar = Math.abs(ar), ar > best && (best = ar, outer = li);
    }
    let mkLoop = (li) => {
      let ls = loopStarts[li], ll = loopLens[li], vertices = new Array(ll), edges = new Array(ll);
      for (let j = 0; j < ll; j++) {
        let be = loopStore[ls + j];
        vertices[j] = bdA[be], edges[j] = bdE[be];
      }
      return { vertices, edges };
    }, faces = new Array(fc);
    for (let i = 0; i < fc; i++) faces[i] = facesBuf[i];
    let patch = { faces, outer: mkLoop(outer), holes: [] };
    for (let li = 0; li < loopCount; li++) li !== outer && patch.holes.push(mkLoop(li));
    patches.push(patch), normal.push([nx[root], ny[root], nz[root]]), planeKeys.push(planeKey(nx[root], ny[root], nz[root], pd[root], eps));
  }
  return { patches, facePatch, normal, planeKey: Uint32Array.from(planeKeys), ambiguous, eps };
}

 
var orient = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x), key = (a, b) => a < b ? `${a},${b}` : `${b},${a}`;
function area2(p, poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    let a = p[poly[i]], b = p[poly[(i + 1) % poly.length]];
    s += a.x * b.y - a.y * b.x;
  }
  return s;
}
function properIntersect(a, b, c, d, eps = 1e-12) {
  let o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  return (o1 > eps && o2 < -eps || o1 < -eps && o2 > eps) && (o3 > eps && o4 < -eps || o3 < -eps && o4 > eps);
}
function pointInPoly(q, p, poly) {
  let inside = !1, eps = 1e-13;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    let a = p[poly[j]], b = p[poly[i]];
    if (Math.abs(orient(a, b, q)) < eps && q.x >= Math.min(a.x, b.x) - eps && q.x <= Math.max(a.x, b.x) + eps && q.y >= Math.min(a.y, b.y) - eps && q.y <= Math.max(a.y, b.y) + eps) return !0;
    a.y > q.y != b.y > q.y && q.x < (b.x - a.x) * (q.y - a.y) / (b.y - a.y) + a.x && (inside = !inside);
  }
  return inside;
}
function ccwTri(a, b, c, p) {
  if (orient(p[a], p[b], p[c]) < 0) {
    let t = b;
    b = c, c = t;
  }
  return [a, b, c];
}
function edgeMap(ts) {
  let m = /* @__PURE__ */ new Map();
  for (let ti = 0; ti < ts.length; ti++) {
    let t = ts[ti], es = [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]];
    for (let e of es) {
      let k = key(e[0], e[1]), a = m.get(k);
      a || m.set(k, a = { t0: -1, t1: -1, count: 0, u: Math.min(e[0], e[1]), v: Math.max(e[0], e[1]) }), a.count === 0 ? a.t0 = ti : a.count === 1 && (a.t1 = ti), a.count++;
    }
  }
  return m;
}
var opp = (t, u, v) => t[0] !== u && t[0] !== v ? t[0] : t[1] !== u && t[1] !== v ? t[1] : t[2];
function pointOnSegment2(q, a, b, eps) {
  return Math.abs(orient(a, b, q)) <= eps && q.x >= Math.min(a.x, b.x) - eps && q.x <= Math.max(a.x, b.x) + eps && q.y >= Math.min(a.y, b.y) - eps && q.y <= Math.max(a.y, b.y) + eps;
}
function pointInTriInclusive2(q, a, b, c, eps) {
  let o0 = orient(a, b, q), o1 = orient(b, c, q), o2 = orient(c, a, q);
  return o0 >= -eps && o1 >= -eps && o2 >= -eps;
}
function earClipSimpleOuter(p, poly, eps) {
  poly = poly.slice();
  let out = [];
  if (poly.length < 3) return out;
  area2(p, poly) < 0 && poly.reverse();
  let guard = 0;
  for (; poly.length > 3 && guard++ < 1e5; ) {
    let cut = !1;
    for (let i = 0; i < poly.length; i++) {
      let a = poly[(i + poly.length - 1) % poly.length], b = poly[i], c = poly[(i + 1) % poly.length];
      if (orient(p[a], p[b], p[c]) <= eps) continue;
      let contains = !1;
      for (let q of poly) if (q !== a && q !== b && q !== c) {
        let o0 = orient(p[a], p[b], p[q]), o1 = orient(p[b], p[c], p[q]), o2 = orient(p[c], p[a], p[q]);
        if (o0 > eps && o1 > eps && o2 > eps) {
          contains = !0;
          break;
        }
      }
      if (!contains) {
        out.push(ccwTri(a, b, c, p)), poly.splice(i, 1), cut = !0;
        break;
      }
    }
    if (!cut) return [];
  }
  return poly.length === 3 && Math.abs(orient(p[poly[0]], p[poly[1]], p[poly[2]])) > eps && out.push(ccwTri(poly[0], poly[1], poly[2], p)), out;
}
function insertPoint(ts, p, pi, eps) {
  let em = edgeMap(ts);
  for (let a of em.values()) {
    let u = a.u, v = a.v;
    if (u === pi || v === pi || !pointOnSegment2(p[pi], p[u], p[v], eps)) continue;
    if (a.count < 1 || a.count > 2) return !1;
    if (a.count === 1) {
      let old = ts[a.t0], x2 = opp(old, u, v);
      return ts[a.t0] = ccwTri(u, pi, x2, p), ts.push(ccwTri(pi, v, x2, p)), !0;
    }
    let t0 = ts[a.t0], t1 = ts[a.t1], x = opp(t0, u, v), y = opp(t1, u, v);
    return ts[a.t0] = ccwTri(u, pi, x, p), ts[a.t1] = ccwTri(pi, u, y, p), ts.push(ccwTri(pi, v, x, p)), ts.push(ccwTri(v, pi, y, p)), !0;
  }
  for (let ti = 0; ti < ts.length; ti++) {
    let t = ts[ti];
    if (!pointInTriInclusive2(p[pi], p[t[0]], p[t[1]], p[t[2]], eps)) continue;
    let o0 = Math.abs(orient(p[t[0]], p[t[1]], p[pi])), o1 = Math.abs(orient(p[t[1]], p[t[2]], p[pi])), o2 = Math.abs(orient(p[t[2]], p[t[0]], p[pi]));
    if (!(o0 <= eps || o1 <= eps || o2 <= eps))
      return ts[ti] = ccwTri(t[0], t[1], pi, p), ts.push(ccwTri(t[1], t[2], pi, p)), ts.push(ccwTri(t[2], t[0], pi, p)), !0;
  }
  return !1;
}
function seedFromOuterAndPoints(p, outer) {
  if (outer.length < 3) return [];
  let minx = p[outer[0]].x, maxx = minx, miny = p[outer[0]].y, maxy = miny;
  for (let q of outer)
    minx = Math.min(minx, p[q].x), maxx = Math.max(maxx, p[q].x), miny = Math.min(miny, p[q].y), maxy = Math.max(maxy, p[q].y);
  let scale = Math.max(maxx - minx, maxy - miny);
  scale <= 0 && (scale = 1);
  let eps = scale * scale * 1e-13, simple = outer.slice(), changed = !0, guard = 0;
  for (; changed && simple.length > 3 && guard++ < 1e4; ) {
    changed = !1;
    for (let i = 0; i < simple.length; i++) {
      let a = simple[(i + simple.length - 1) % simple.length], b = simple[i], c = simple[(i + 1) % simple.length];
      if (Math.abs(orient(p[a], p[b], p[c])) <= eps) {
        simple.splice(i, 1), changed = !0;
        break;
      }
    }
  }
  let ts = earClipSimpleOuter(p, simple, eps);
  if (!ts.length) return [];
  let used = new Uint8Array(p.length);
  for (let t of ts) used[t[0]] = used[t[1]] = used[t[2]] = 1;
  for (let q of outer) if (!used[q]) {
    if (!insertPoint(ts, p, q, eps)) return [];
    used[q] = 1;
  }
  for (let q = 0; q < p.length; q++) if (!used[q]) {
    if (!insertPoint(ts, p, q, eps)) return [];
    used[q] = 1;
  }
  return ts;
}
function insertConstraint(ts, p, a, b, constraints) {
  const target=key(a,b);
  if(a===b)return false;
  let em=edgeMap(ts);
  if(em.has(target)){constraints.add(target);return true;}
  const crossesTarget=(u,v)=>u!==a&&u!==b&&v!==a&&v!==b&&properIntersect(p[a],p[b],p[u],p[v]);
  const queue=[];
  for(const e of em.values())if(e.count===2&&!constraints.has(key(e.u,e.v))&&crossesTarget(e.u,e.v))queue.push([e.u,e.v]);
  const limit=Math.max(64,ts.length*ts.length*2);
   
   
   
  for(let head=0;head<queue.length&&head<limit;head++){
    em=edgeMap(ts);
    if(em.has(target)){constraints.add(target);return true;}
    const [u,v]=queue[head],e=em.get(key(u,v));
    if(!e||e.count!==2||constraints.has(key(u,v))||!crossesTarget(u,v))continue;
    const x=opp(ts[e.t0],u,v),y=opp(ts[e.t1],u,v),nk=key(x,y);
    if(x===y||constraints.has(nk)||em.has(nk)||!properIntersect(p[u],p[v],p[x],p[y])){
      queue.push([u,v]);continue;
    }
    let crosses=false;
    for(const ck of constraints){
      const z=ck.indexOf(','),q=+ck.slice(0,z),r=+ck.slice(z+1);
      if(q!==x&&q!==y&&r!==x&&r!==y&&properIntersect(p[x],p[y],p[q],p[r])){crosses=true;break;}
    }
    if(crosses){queue.push([u,v]);continue;}
    ts[e.t0]=ccwTri(x,y,u,p);ts[e.t1]=ccwTri(y,x,v,p);
    if(crossesTarget(x,y))queue.push([x,y]);
  }
  if(edgeMap(ts).has(target)){constraints.add(target);return true;}
  return false;
}
function triangulatePSLGCore(input, outer, seg) {
  if (input.length < 3 || outer.length < 3) return { ok: !1, tris: [] };
  let p = input.map((q) => ({ x: +q.x, y: +q.y })), ts = seedFromOuterAndPoints(p, outer);
  if (!ts.length) return { ok: !1, tris: [] };
  let constraints = /* @__PURE__ */ new Set();
  for (let i = 0; i < outer.length; i++) constraints.add(key(outer[i], outer[(i + 1) % outer.length]));
  for (let e of seg) if (!insertConstraint(ts, p, e[0], e[1], constraints)) return { ok: !1, tris: [] };
  let tris = [];
  for (let t of ts) {
    let c = { x: (p[t[0]].x + p[t[1]].x + p[t[2]].x) / 3, y: (p[t[0]].y + p[t[1]].y + p[t[2]].y) / 3 };
    pointInPoly(c, p, outer) && tris.push(t);
  }
  return { ok: !0, tris };
}

 
var orient2 = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x), d2 = (a, b) => {
  let x = a.x - b.x, y = a.y - b.y;
  return x * x + y * y;
}, on = (p, a, b, e) => Math.abs(orient2(a, b, p)) <= e && p.x >= Math.min(a.x, b.x) - e && p.x <= Math.max(a.x, b.x) + e && p.y >= Math.min(a.y, b.y) - e && p.y <= Math.max(a.y, b.y) + e;
function unsafe(a, b, c, d, e) {
  let a1 = orient2(a, b, c), a2 = orient2(a, b, d), c1 = orient2(c, d, a), c2 = orient2(c, d, b);
  return (a1 > e && a2 < -e || a1 < -e && a2 > e) && (c1 > e && c2 < -e || c1 < -e && c2 > e) ? !0 : on(c, a, b, e) || on(d, a, b, e) || on(a, c, d, e) || on(b, c, d, e);
}
var idx = (p, x) => p.indexOf(x);
function splitChord(ps, a, b) {
  if (ps.length < 1 || ps.length >= 8) return !1;
  let f = -1, ia = -1, ib = -1;
  for (let k = 0; k < ps.length; k++) {
    let x2 = idx(ps[k], a), y2 = idx(ps[k], b);
    if (x2 < 0 || y2 < 0) continue;
    let n = ps[k].length, d = (x2 - y2 + n) % n;
    if (!(d === 1 || d === n - 1)) {
      if (f >= 0) return !1;
      f = k, ia = x2, ib = y2;
    }
  }
  if (f < 0) return !1;
  let q = ps[f], x = [], y = [], i = ia;
  for (x.push(q[i]); i !== ib; )
    i = (i + 1) % q.length, x.push(q[i]);
  for (i = ib, y.push(q[i]); i !== ia; )
    i = (i + 1) % q.length, y.push(q[i]);
  return ps[f] = x, ps.push(y), !0;
}
function fan(p, input, out) {
  if (p.length < 3) return !1;
  if (p.length === 3)
    return orient2(input.node[p[0]], input.node[p[1]], input.node[p[2]]) <= 1e-13 ? !1 : (out.push([p[0], p[1], p[2]]), !0);
  let root = -1, best = -1e300;
  for (let z = 0; z < p.length; z++) {
    let mn = 1e300;
    for (let j = 1; j + 1 < p.length; j++) mn = Math.min(mn, orient2(input.node[p[z]], input.node[p[(z + j) % p.length]], input.node[p[(z + j + 1) % p.length]]));
    mn > best && (best = mn, root = z);
  }
  if (best <= 1e-13) return !1;
  for (let j = 1; j + 1 < p.length; j++) out.push([p[root], p[(root + j) % p.length], p[(root + j + 1) % p.length]]);
  return !0;
}
function polyArea(p, input) {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    let a = input.node[p[i]], b = input.node[p[(i + 1) % p.length]];
    s += a.x * b.y - a.y * b.x;
  }
  return s;
}
var pit = (p, a, b, c, e) => orient2(a, b, p) >= -e && orient2(b, c, p) >= -e && orient2(c, a, p) >= -e;
function ear(poly, input, out) {
  let p = poly.slice();
  if (p.length < 3 || p.length > 16) return !1;
  polyArea(p, input) < 0 && p.reverse();
  let g = 0;
  for (; p.length > 3 && g++ < 64; ) {
    let cut = !1;
    for (let i = 0; i < p.length; i++) {
      let a = p[(i + p.length - 1) % p.length], b = p[i], c = p[(i + 1) % p.length], A = input.node[a], B = input.node[b], C = input.node[c];
      if (orient2(A, B, C) <= 1e-13) continue;
      let block = !1;
      for (let j = 0; j < p.length; j++) {
        let q = p[j];
        if (!(q === a || q === b || q === c) && pit(input.node[q], A, B, C, 1e-13)) {
          block = !0;
          break;
        }
      }
      if (!block) {
        out.push([a, b, c]), p.splice(i, 1), cut = !0;
        break;
      }
    }
    if (!cut) return !1;
  }
  return p.length !== 3 || orient2(input.node[p[0]], input.node[p[1]], input.node[p[2]]) <= 1e-13 ? !1 : (out.push([p[0], p[1], p[2]]), !0);
}
function arc(p, a, b) {
  let i = idx(p, a), ib = idx(p, b);
  if (p.length < 2 || i < 0 || ib < 0) return null;
  let x = [a];
  for (let g = 0; i !== ib && g <= p.length; g++)
    i = (i + 1) % p.length, x.push(p[i]);
  return i === ib ? x : null;
}
function splitPath(ps, path) {
  if (path.length < 2 || path.length > 6 || ps.length < 1 || ps.length >= 8) return !1;
  let a = path[0], b = path[path.length - 1], f = -1;
  for (let i = 0; i < ps.length; i++) if (idx(ps[i], a) >= 0 && idx(ps[i], b) >= 0) {
    if (f >= 0) return !1;
    f = i;
  }
  if (f < 0) return !1;
  let q = ps[f], ab = arc(q, a, b), ba = arc(q, b, a);
  if (!ab || !ba) return !1;
  if (path.length === 2) {
    let ia = idx(q, a), ib = idx(q, b), d = (ia - ib + q.length) % q.length;
    if (d === 1 || d === q.length - 1) return !1;
  }
  for (let i = path.length - 2; i >= 1; i--) ab.push(path[i]);
  for (let i = 1; i < path.length - 1; i++) ba.push(path[i]);
  return ps[f] = ab, ps.push(ba), !0;
}
function boundaryCycle(input, used) {
  let bo = [[0, 0], [1, 1], [2, 2]];
  for (let i = 3; i < input.n; i++) used[i] && input.node[i].boundary && bo.push([input.node[i].s, i]);
  return bo.sort((a, b) => a[0] - b[0]), bo.map((x) => x[1]);
}
function splitPrepared(input) {
  let K = input.K | 0, out = [];
  if (K < 1 || K > 4) return { ok: !1, tris: out };
  for (let i = 0; i < K; i++) {
    let s = input.seg[i];
    if (s.a === s.b || d2(input.node[s.a], input.node[s.b]) <= 1e-22) return { ok: !1, tris: out };
    for (let j = 0; j < i; j++) {
      let t = input.seg[j];
      if (s.a === t.a && s.b === t.b || s.a === t.b && s.b === t.a) return { ok: !1, tris: out };
    }
  }
  let used = new Uint8Array(11);
  for (let i = 0; i < K; i++) used[input.seg[i].a] = used[input.seg[i].b] = 1;
  for (let i = 0; i < input.n; i++) if (used[i]) {
    for (let j = i + 1; j < input.n; j++) if (used[j] && d2(input.node[i], input.node[j]) <= 1e-22) return { ok: !1, tris: out };
  }
  for (let i = 0; i < K; i++) for (let j = i + 1; j < K; j++) {
    let s = input.seg[i], t = input.seg[j], ns = 0, sh = 255;
    if ((s.a === t.a || s.a === t.b) && (ns++, sh = s.a), (s.b === t.a || s.b === t.b) && (ns++, sh = s.b), ns > 1) return { ok: !1, tris: out };
    if (ns) {
      let a = s.a === sh ? s.b : s.a, b = t.a === sh ? t.b : t.a, S = input.node[sh], A = input.node[a], B = input.node[b];
      if (Math.abs(orient2(S, A, B)) <= 1e-11) {
        let x0 = A.x - S.x, x1 = A.y - S.y, y0 = B.x - S.x, y1 = B.y - S.y;
        if (x0 * y0 + x1 * y1 > 0) return { ok: !1, tris: out };
      }
    } else if (unsafe(input.node[s.a], input.node[s.b], input.node[t.a], input.node[t.b], 1e-11)) return { ok: !1, tris: out };
  }
  let cyc = boundaryCycle(input, used), deg = new Uint8Array(11), adj = Array.from({ length: 11 }, () => []);
  for (let i = 0; i < K; i++) {
    let a = input.seg[i].a, b = input.seg[i].b;
    deg[a]++, deg[b]++, adj[a].push(b), adj[b].push(a);
  }
  let allB = !0;
  for (let i = 0; i < input.n; i++) used[i] && (allB = allB && !!input.node[i].boundary);
  if (allB) {
    let ps2 = [cyc.slice()];
    for (let i = 0; i < K; i++) if (!splitChord(ps2, input.seg[i].a, input.seg[i].b)) return { ok: !1, tris: [] };
    for (let p of ps2) if (!fan(p, input, out)) return { ok: !1, tris: [] };
    return { ok: ps2.length === K + 1, tris: out };
  }
  if (K >= 3) {
    let h = -1, nh = 0, nused = 0;
    for (let i = 0; i < input.n; i++) used[i] && (nused++, deg[i] === K && (h = i, nh++));
    if (nh === 1 && nused === K + 1 && !input.node[h].boundary) {
      let ok = !0;
      for (let i = 0; i < input.n; i++) used[i] && i !== h && (ok = ok && deg[i] === 1 && !!input.node[i].boundary);
      if (ok) {
        for (let i = 0; i < cyc.length; i++) out.push([cyc[i], cyc[(i + 1) % cyc.length], h]);
        return { ok: !0, tris: out };
      }
    }
  }
  for (let i = 0; i < input.n; i++) if (used[i] && (deg[i] > 2 || !input.node[i].boundary && deg[i] !== 2 || deg[i] === 1 && !input.node[i].boundary)) return { ok: !1, tris: [] };
  let seen = new Uint8Array(11), paths = [];
  for (let root = 0; root < input.n; root++) if (used[root] && !seen[root]) {
    let st = [root], comp = [];
    for (seen[root] = 1; st.length; ) {
      let x = st.pop();
      comp.push(x);
      for (let y of adj[x]) seen[y] || (seen[y] = 1, st.push(y));
    }
    let start = -1, ends = 0;
    for (let x of comp) deg[x] === 1 && (start = x, ends++);
    if (ends !== 2) return { ok: !1, tris: [] };
    let p = [], prev = -1, cur = start;
    for (; ; ) {
      p.push(cur);
      let nx = -1, nc = 0;
      for (let y of adj[cur]) y !== prev && (nx = y, nc++);
      if (!nc) break;
      if (nc !== 1) return { ok: !1, tris: [] };
      prev = cur, cur = nx;
    }
    if (p.length !== comp.length || !input.node[p[0]].boundary || !input.node[p[p.length - 1]].boundary) return { ok: !1, tris: [] };
    for (let z = 1; z + 1 < p.length; z++) if (input.node[p[z]].boundary) return { ok: !1, tris: [] };
    paths.push(p);
  }
  let rank = (id) => idx(cyc, id);
  if (paths.sort((a, b) => {
    let a0 = rank(a[0]), a1 = rank(a[a.length - 1]), b0 = rank(b[0]), b1 = rank(b[b.length - 1]);
    return a0 > a1 && ([a0, a1] = [a1, a0]), b0 > b1 && ([b0, b1] = [b1, b0]), a0 === b0 ? a1 - b1 : a0 - b0;
  }), paths.length > 4) return { ok: !1, tris: [] };
  let ps = [cyc.slice()];
  for (let p of paths) if (!splitPath(ps, p)) return { ok: !1, tris: [] };
  for (let p of ps) if (!ear(p, input, out)) return { ok: !1, tris: [] };
  return { ok: ps.length === paths.length + 1, tris: out };
}
function splitPreparedK2(input) {
  let out = [];
  if (input.K !== 2) return { ok: !1, tris: out };
  let s0 = input.seg[0], s1 = input.seg[1];
  if (s0.a === s0.b || s1.a === s1.b || d2(input.node[s0.a], input.node[s0.b]) <= 1e-22 || d2(input.node[s1.a], input.node[s1.b]) <= 1e-22) return { ok: !1, tris: out };
  if (s0.a === s1.a && s0.b === s1.b || s0.a === s1.b && s0.b === s1.a) return { ok: !1, tris: out };
  let ep = [s0.a, s0.b, s1.a, s1.b], uniq = [];
  for (let q of ep) uniq.includes(q) || uniq.push(q);
  for (let i = 0; i < uniq.length; i++) for (let j = i + 1; j < uniq.length; j++) if (d2(input.node[uniq[i]], input.node[uniq[j]]) <= 1e-22) return { ok: !1, tris: out };
  let sh = 255, ns = 0;
  if ((s0.a === s1.a || s0.a === s1.b) && (sh = s0.a, ns++), (s0.b === s1.a || s0.b === s1.b) && (sh = s0.b, ns++), ns > 1) return { ok: !1, tris: out };
  if (ns) {
    let a = s0.a === sh ? s0.b : s0.a, b = s1.a === sh ? s1.b : s1.a, S = input.node[sh], A = input.node[a], B = input.node[b];
    if (Math.abs(orient2(S, A, B)) <= 1e-11) {
      let x0 = A.x - S.x, x1 = A.y - S.y, y0 = B.x - S.x, y1 = B.y - S.y;
      if (x0 * y0 + x1 * y1 > 0) return { ok: !1, tris: out };
    }
  } else if (unsafe(input.node[s0.a], input.node[s0.b], input.node[s1.a], input.node[s1.b], 1e-11)) return { ok: !1, tris: out };
  if (uniq.length === 3 && ns === 1 && !input.node[sh].boundary) {
    let a = s0.a === sh ? s0.b : s0.a, b = s1.a === sh ? s1.b : s1.a;
    if (!input.node[a].boundary || !input.node[b].boundary) return { ok: !1, tris: out };
    let bo2 = [[0, 0], [1, 1], [2, 2]];
    for (let q of [a, b]) q > 2 && bo2.push([input.node[q].s, q]);
    bo2.sort((x, y) => x[0] - y[0]);
    for (let i = 0; i < bo2.length; i++) out.push([bo2[i][1], bo2[(i + 1) % bo2.length][1], sh]);
    return { ok: !0, tris: out };
  }
  for (let q of uniq) if (!input.node[q].boundary) return { ok: !1, tris: out };
  let bo = [[0, 0], [1, 1], [2, 2]];
  for (let q of uniq) q > 2 && bo.push([input.node[q].s, q]);
  bo.sort((x, y) => x[0] - y[0]);
  let cyc = bo.map((x) => x[1]), ps = [cyc];
  if (!splitChord(ps, s0.a, s0.b) || !splitChord(ps, s1.a, s1.b) || ps.length !== 3) return { ok: !1, tris: [] };
  for (let p of ps) if (!fan(p, input, out)) return { ok: !1, tris: [] };
  return { ok: !0, tris: out };
}

 
var FeatureKind = { Vertex: 0, Edge: 1, Face: 2 }, UINT32_MAX = 4294967295, nextPow22 = (n) => {
  let c = 1;
  for (; c < n; ) c *= 2;
  return c;
}, mix322 = (x) => (x ^= x >>> 16, x = Math.imul(x, 2146121005), x ^= x >>> 15, x = Math.imul(x, 2221713035), x ^= x >>> 16, x >>> 0), hashFeature = (ka, ia, kb, ib) => mix322((Math.imul(ia >>> 0, 2654435761) ^ Math.imul(ib >>> 0, 2246822507) ^ Math.imul(ka + 1, 3266489909) ^ Math.imul(kb + 1, 668265263)) >>> 0), edgeKey = (a, b) => a < b ? `${a},${b}` : `${b},${a}`;
function buildEdgeVertices(M) {
  let n = M.edgeCount ?? (M.triE.length ? Math.max(...M.triE) + 1 : 0), ev = new Uint32Array(n * 2);
  ev.fill(UINT32_MAX);
  for (let t = 0; t < M.triCount; t++) {
    let o = t * 3;
    for (let e = 0; e < 3; e++) {
      let id = M.triE[o + e];
      ev[id * 2] === UINT32_MAX && (ev[id * 2] = M.triV[o + e], ev[id * 2 + 1] = M.triV[o + (e + 1) % 3]);
    }
  }
  return ev;
}
function bary(M, tri, px, py, pz) {
  let o = tri * 3, tv = M.triV, p = M.pos, ia = tv[o] * 3, ib = tv[o + 1] * 3, ic = tv[o + 2] * 3, ax = p[ia], ay = p[ia + 1], az = p[ia + 2], v0x = p[ib] - ax, v0y = p[ib + 1] - ay, v0z = p[ib + 2] - az, v1x = p[ic] - ax, v1y = p[ic + 1] - ay, v1z = p[ic + 2] - az, v2x = px - ax, v2y = py - ay, v2z = pz - az, d00 = v0x * v0x + v0y * v0y + v0z * v0z, d01 = v0x * v1x + v0y * v1y + v0z * v1z, d11 = v1x * v1x + v1y * v1y + v1z * v1z, d20 = v2x * v0x + v2y * v0y + v2z * v0z, d21 = v2x * v1x + v2y * v1y + v2z * v1z, den = d00 * d11 - d01 * d01;
  if (Math.abs(den) < 1e-30) return [-1, -1, -1];
  let v = (d11 * d20 - d01 * d21) / den, w = (d00 * d21 - d01 * d20) / den;
  return [1 - v - w, v, w];
}
function inTri(M, tri, x, y, z, eps = 1e-8) {
  let q = bary(M, tri, x, y, z);
  return q[0] >= -eps && q[1] >= -eps && q[2] >= -eps && q[0] <= 1 + eps && q[1] <= 1 + eps && q[2] <= 1 + eps;
}
function feature(M, tri, x, y, z) {
  let q = bary(M, tri, x, y, z), eps = 3e-8, z0 = Math.abs(q[0]) < eps, z1 = Math.abs(q[1]) < eps, z2 = Math.abs(q[2]) < eps, n = (z0 ? 1 : 0) + (z1 ? 1 : 0) + (z2 ? 1 : 0), o = tri * 3;
  if (n >= 2) {
    let vi = q[0] >= q[1] && q[0] >= q[2] ? 0 : q[1] >= q[2] ? 1 : 2;
    return [FeatureKind.Vertex, M.triV[o + vi]];
  }
  if (n === 1) {
    let eid = z0 ? M.triE[o + 1] : z1 ? M.triE[o + 2] : M.triE[o];
    return [FeatureKind.Edge, eid];
  }
  return [FeatureKind.Face, tri];
}
function buildDetailedHits(A, B, hitPairs) {
  let n = hitPairs.length >>> 1, triA = new Uint32Array(n), triB = new Uint32Array(n), pos = new Float64Array(n * 6), kindA = new Uint8Array(n * 2), kindB = new Uint8Array(n * 2), idA = new Uint32Array(n * 2), idB = new Uint32Array(n * 2), WX = new Float64Array(16), WY = new Float64Array(16), WZ = new Float64Array(16), WKA = new Uint8Array(16), WKB = new Uint8Array(16), WIA = new Uint32Array(16), WIB = new Uint32Array(16), wn = 0;
  function one(ta, tb, row) {
    let ao = ta * 3, bo = tb * 3, av = A.triV, bv = B.triV, ap = A.pos, bp = B.pos, a0 = av[ao] * 3, a1 = av[ao + 1] * 3, a2 = av[ao + 2] * 3, b0 = bv[bo] * 3, b1 = bv[bo + 1] * 3, b2 = bv[bo + 2] * 3, a0x = ap[a0], a0y = ap[a0 + 1], a0z = ap[a0 + 2], a1x = ap[a1], a1y = ap[a1 + 1], a1z = ap[a1 + 2], a2x = ap[a2], a2y = ap[a2 + 1], a2z = ap[a2 + 2], b0x = bp[b0], b0y = bp[b0 + 1], b0z = bp[b0 + 2], b1x = bp[b1], b1y = bp[b1 + 1], b1z = bp[b1 + 2], b2x = bp[b2], b2y = bp[b2 + 1], b2z = bp[b2 + 2], ae1x = a1x - a0x, ae1y = a1y - a0y, ae1z = a1z - a0z, ae2x = a2x - a0x, ae2y = a2y - a0y, ae2z = a2z - a0z, naX = ae1y * ae2z - ae1z * ae2y, naY = ae1z * ae2x - ae1x * ae2z, naZ = ae1x * ae2y - ae1y * ae2x, be1x = b1x - b0x, be1y = b1y - b0y, be1z = b1z - b0z, be2x = b2x - b0x, be2y = b2y - b0y, be2z = b2z - b0z, nbX = be1y * be2z - be1z * be2y, nbY = be1z * be2x - be1x * be2z, nbZ = be1x * be2y - be1y * be2x;
    wn = 0;
    function add(x, y, z) {
      let fa = feature(A, ta, x, y, z), fb = feature(B, tb, x, y, z);
      for (let j = 0; j < wn; j++) if (WKA[j] === fa[0] && WIA[j] === fa[1] && WKB[j] === fb[0] && WIB[j] === fb[1]) return;
      WX[wn] = x, WY[wn] = y, WZ[wn] = z, WKA[wn] = fa[0], WIA[wn] = fa[1], WKB[wn] = fb[0], WIB[wn] = fb[1], wn++;
    }
    function edgePlane(px, py, pz, qx, qy, qz, rx, ry, rz, nx, ny, nz, M, t) {
      let dp = nx * (px - rx) + ny * (py - ry) + nz * (pz - rz), dq = nx * (qx - rx) + ny * (qy - ry) + nz * (qz - rz), eps = 1e-10 * Math.hypot(nx, ny, nz);
      if (Math.abs(dp) < eps && inTri(M, t, px, py, pz) && add(px, py, pz), dp * dq < 0 || Math.abs(dp) < eps || Math.abs(dq) < eps) {
        let den = dp - dq;
        if (Math.abs(den) > eps * 1e-3) {
          let u = dp / den;
          if (u >= -1e-10 && u <= 1 + 1e-10) {
            let x = px + (qx - px) * u, y = py + (qy - py) * u, z = pz + (qz - pz) * u;
            inTri(M, t, x, y, z) && add(x, y, z);
          }
        }
      }
    }
    if (edgePlane(a0x, a0y, a0z, a1x, a1y, a1z, b0x, b0y, b0z, nbX, nbY, nbZ, B, tb), edgePlane(a1x, a1y, a1z, a2x, a2y, a2z, b0x, b0y, b0z, nbX, nbY, nbZ, B, tb), edgePlane(a2x, a2y, a2z, a0x, a0y, a0z, b0x, b0y, b0z, nbX, nbY, nbZ, B, tb), edgePlane(b0x, b0y, b0z, b1x, b1y, b1z, a0x, a0y, a0z, naX, naY, naZ, A, ta), edgePlane(b1x, b1y, b1z, b2x, b2y, b2z, a0x, a0y, a0z, naX, naY, naZ, A, ta), edgePlane(b2x, b2y, b2z, b0x, b0y, b0z, a0x, a0y, a0z, naX, naY, naZ, A, ta), wn < 2) return !1;
    let best = -1, ii = 0, jj = 1;
    for (let i = 0; i < wn; i++) for (let j = i + 1; j < wn; j++) {
      let dx = WX[i] - WX[j], dy = WY[i] - WY[j], dz = WZ[i] - WZ[j], dd = dx * dx + dy * dy + dz * dz;
      dd > best && (best = dd, ii = i, jj = j);
    }
    if (best < 1e-18) return !1;
    triA[row] = ta, triB[row] = tb;
    for (let e = 0; e < 2; e++) {
      let k = e ? jj : ii, po = row * 6 + e * 3, fo = row * 2 + e;
      pos[po] = WX[k], pos[po + 1] = WY[k], pos[po + 2] = WZ[k], kindA[fo] = WKA[k], idA[fo] = WIA[k], kindB[fo] = WKB[k], idB[fo] = WIB[k];
    }
    return !0;
  }
  let out = 0;
  for (let i = 0; i < n; i++) one(hitPairs[i * 2], hitPairs[i * 2 + 1], out) && out++;
  return { count: out, triA: triA.subarray(0, out), triB: triB.subarray(0, out), pos: pos.subarray(0, out * 6), kindA: kindA.subarray(0, out * 2), kindB: kindB.subarray(0, out * 2), idA: idA.subarray(0, out * 2), idB: idB.subarray(0, out * 2) };
}
var DSU = class {
  constructor(cap, n) {
    this.p = new Uint32Array(cap), this.n = n;
    for (let i = 0; i < n; i++) this.p[i] = i;
  }
  add() {
    let i = this.n++;
    return this.p[i] = i, i;
  }
  find(x) {
    let p = this.p;
    for (; p[x] !== x; )
      p[x] = p[p[x]], x = p[x];
    return x;
  }
  union(a, b) {
    if (a = this.find(a), b = this.find(b), a !== b) {
      if (a > b) {
        let t = a;
        a = b, b = t;
      }
      this.p[b] = a;
    }
  }
}, FeatureMap = class {
  constructor(n) {
    let c = nextPow22(Math.max(16, n * 2));
    this.mask = c - 1, this.used = new Uint8Array(c), this.ka = new Uint8Array(c), this.kb = new Uint8Array(c), this.ia = new Uint32Array(c), this.ib = new Uint32Array(c), this.val = new Uint32Array(c);
  }
  get(ka, ia, kb, ib) {
    let s = hashFeature(ka, ia, kb, ib) & this.mask;
    for (; this.used[s]; ) {
      if (this.ka[s] === ka && this.kb[s] === kb && this.ia[s] === ia && this.ib[s] === ib) return this.val[s];
      s = s + 1 & this.mask;
    }
    return UINT32_MAX;
  }
  put(ka, ia, kb, ib, v) {
    let s = hashFeature(ka, ia, kb, ib) & this.mask;
    for (; this.used[s] && !(this.ka[s] === ka && this.kb[s] === kb && this.ia[s] === ia && this.ib[s] === ib); ) s = s + 1 & this.mask;
    this.used[s] = 1, this.ka[s] = ka, this.kb[s] = kb, this.ia[s] = ia, this.ib[s] = ib, this.val[s] = v;
  }
};
function pointOnSeg3(pool, p, a, b) {
  let ao = a * 3, bo = b * 3, px = pool[p * 3], py = pool[p * 3 + 1], pz = pool[p * 3 + 2], dx = pool[bo] - pool[ao], dy = pool[bo + 1] - pool[ao + 1], dz = pool[bo + 2] - pool[ao + 2], L = dx * dx + dy * dy + dz * dz;
  if (L < 1e-30) return null;
  let t = ((px - pool[ao]) * dx + (py - pool[ao + 1]) * dy + (pz - pool[ao + 2]) * dz) / L, qx = pool[ao] + dx * t, qy = pool[ao + 1] + dy * t, qz = pool[ao + 2] + dz * t;
  return t >= -1e-9 && t <= 1 + 1e-9 && Math.hypot(px - qx, py - qy, pz - qz) < 2e-8 ? t : null;
}
function refineEdgeFace(edgeM, ev, eid, faceM, tid) {
  let k = eid * 2;
  if (k + 1 >= ev.length) return null;
  let va = ev[k], vb = ev[k + 1];
  if (va === UINT32_MAX || vb === UINT32_MAX) return null;
  let a = va * 3, b = vb * 3, to = tid * 3, tv = faceM.triV;
  if (to + 2 >= tv.length) return null;
  let ia = tv[to] * 3, ib = tv[to + 1] * 3, ic = tv[to + 2] * 3, p = faceM.pos, ex = p[ib] - p[ia], ey = p[ib + 1] - p[ia + 1], ez = p[ib + 2] - p[ia + 2], fx = p[ic] - p[ia], fy = p[ic + 1] - p[ia + 1], fz = p[ic + 2] - p[ia + 2], nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx, dx = edgeM.pos[b] - edgeM.pos[a], dy = edgeM.pos[b + 1] - edgeM.pos[a + 1], dz = edgeM.pos[b + 2] - edgeM.pos[a + 2], den = nx * dx + ny * dy + nz * dz;
  if (nx * nx + ny * ny + nz * nz <= 1e-28 || Math.abs(den) < 1e-20 * Math.sqrt((nx * nx + ny * ny + nz * nz) * Math.max(1e-30, dx * dx + dy * dy + dz * dz))) return null;
  let t = (nx * (p[ia] - edgeM.pos[a]) + ny * (p[ia + 1] - edgeM.pos[a + 1]) + nz * (p[ia + 2] - edgeM.pos[a + 2])) / den;
  return t < -1e-8 || t > 1 + 1e-8 ? null : [edgeM.pos[a] + dx * t, edgeM.pos[a + 1] + dy * t, edgeM.pos[a + 2] + dz * t];
}
function refineEdgeEdge(A, evA, ea, B, evB, eb) {
  let ka = ea * 2, kb = eb * 2;
  if (ka + 1 >= evA.length || kb + 1 >= evB.length) return null;
  let ai0 = evA[ka], ai1 = evA[ka + 1], bi0 = evB[kb], bi1 = evB[kb + 1];
  if (ai0 === UINT32_MAX || ai1 === UINT32_MAX || bi0 === UINT32_MAX || bi1 === UINT32_MAX) return null;
  let a0 = ai0 * 3, a1 = ai1 * 3, b0 = bi0 * 3, b1 = bi1 * 3, ux = A.pos[a1] - A.pos[a0], uy = A.pos[a1 + 1] - A.pos[a0 + 1], uz = A.pos[a1 + 2] - A.pos[a0 + 2], vx = B.pos[b1] - B.pos[b0], vy = B.pos[b1 + 1] - B.pos[b0 + 1], vz = B.pos[b1 + 2] - B.pos[b0 + 2], wx = A.pos[a0] - B.pos[b0], wy = A.pos[a0 + 1] - B.pos[b0 + 1], wz = A.pos[a0 + 2] - B.pos[b0 + 2], aa = ux * ux + uy * uy + uz * uz, bb = ux * vx + uy * vy + uz * vz, cc = vx * vx + vy * vy + vz * vz, dd = ux * wx + uy * wy + uz * wz, ee = vx * wx + vy * wy + vz * wz, den = aa * cc - bb * bb;
  if (aa < 1e-28 || cc < 1e-28 || Math.abs(den) < 1e-24 * Math.max(1, aa * cc)) return null;
  let s = (bb * ee - cc * dd) / den, t = (aa * ee - bb * dd) / den;
  if (s < -1e-7 || s > 1 + 1e-7 || t < -1e-7 || t > 1 + 1e-7) return null;
  let pax = A.pos[a0] + ux * s, pay = A.pos[a0 + 1] + uy * s, paz = A.pos[a0 + 2] + uz * s, pbx = B.pos[b0] + vx * t, pby = B.pos[b0 + 1] + vy * t, pbz = B.pos[b0 + 2] + vz * t, scale = 1 + Math.sqrt(aa) + Math.sqrt(cc);
  return Math.hypot(pax - pbx, pay - pby, paz - pbz) > 1e-8 * scale ? null : [(pax + pbx) * 0.5, (pay + pby) * 0.5, (paz + pbz) * 0.5];
}
function faceFrame(M, fi) {
  let o = fi * 3, tv = M.triV, p = M.pos, a = tv[o] * 3, b = tv[o + 1] * 3, c = tv[o + 2] * 3, ox = p[a], oy = p[a + 1], oz = p[a + 2], ux0 = p[b] - ox, uy0 = p[b + 1] - oy, uz0 = p[b + 2] - oz, ul = Math.hypot(ux0, uy0, uz0), ux = ul ? ux0 / ul : 1, uy = ul ? uy0 / ul : 0, uz = ul ? uz0 / ul : 0, ax = p[b] - ox, ay = p[b + 1] - oy, az = p[b + 2] - oz, bx = p[c] - ox, by = p[c + 1] - oy, bz = p[c + 2] - oz, nx0 = ay * bz - az * by, ny0 = az * bx - ax * bz, nz0 = ax * by - ay * bx, nl = Math.hypot(nx0, ny0, nz0), nx = nl ? nx0 / nl : 1, ny = nl ? ny0 / nl : 0, nz = nl ? nz0 / nl : 0, vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
  return { ox, oy, oz, ux, uy, uz, vx, vy, vz };
}
function project(pool, h, F) {
  let o = h * 3, dx = pool[o] - F.ox, dy = pool[o + 1] - F.oy, dz = pool[o + 2] - F.oz;
  return { x: dx * F.ux + dy * F.uy + dz * F.uz, y: dx * F.vx + dy * F.vy + dz * F.vz };
}
function splitFace(M, operand, fi, cuts, pool, sourceOffset, stats, pieces) {
  if (!cuts.length) {
    let o2 = fi * 3;
    return pieces.push([sourceOffset + M.triV[o2], sourceOffset + M.triV[o2 + 1], sourceOffset + M.triV[o2 + 2], fi, operand]), !0;
  }
  let o = fi * 3, f = [M.triV[o], M.triV[o + 1], M.triV[o + 2]], handles = [], addh = (h) => {
    let i = handles.indexOf(h);
    return i < 0 && (i = handles.length, handles.push(h)), i;
  };
  for (let v of f) addh(sourceOffset + v);
  for (let s of cuts)
    addh(s[0]), addh(s[1]);
  let F = faceFrame(M, fi), lp = handles.map((h) => project(pool, h, F));
  if (cuts.length >= 1 && cuts.length <= 4 && handles.length <= 11) {
    let input = { n: handles.length, K: cuts.length, node: lp.map((p, i) => ({ x: p.x, y: p.y, boundary: i < 3, s: i < 3 ? i : 0 })), seg: [] }, prep = !0;
    for (let i = 3; i < handles.length; i++) {
      let bd = !1, bestS = 0;
      for (let e = 0; e < 3; e++) {
        let t = pointOnSeg3(pool, handles[i], sourceOffset + f[e], sourceOffset + f[(e + 1) % 3]);
        if (t !== null) {
          if (t < 1e-10 || t > 1 - 1e-10) {
            prep = !1;
            break;
          }
          bd = !0, bestS = e + t;
          break;
        }
      }
      if (input.node[i].boundary = bd, input.node[i].s = bestS, !prep) break;
    }
    for (let k = 0; k < cuts.length && prep; k++) {
      let a = handles.indexOf(cuts[k][0]), b = handles.indexOf(cuts[k][1]);
      if (a < 0 || b < 0) {
        prep = !1;
        break;
      }
      input.seg.push({ a, b });
    }
    if (prep) {
      let rr = input.K === 2 ? splitPreparedK2(input) : splitPrepared(input);
      if (rr.ok) {
        for (let t of rr.tris) pieces.push([handles[t[0]], handles[t[1]], handles[t[2]], fi, operand]);
        return stats.fastK[input.K]++, !0;
      }
    }
  }
  stats.genericFaces++;
  let outer = [];
  for (let e = 0; e < 3; e++) {
    let ha = sourceOffset + f[e], hb = sourceOffset + f[(e + 1) % 3], ia = addh(ha), mid = [];
    for (let li = 0; li < handles.length; li++) {
      if (handles[li] === ha || handles[li] === hb) continue;
      let t = pointOnSeg3(pool, handles[li], ha, hb);
      t !== null && t > 1e-8 && t < 1 - 1e-8 && mid.push([t, li]);
    }
    mid.sort((a, b) => a[0] - b[0]), outer.push(ia);
    for (let q of mid) outer.push(q[1]);
  }
  let seg = [], seen = /* @__PURE__ */ new Set();
  for (let s of cuts) {
    let a = addh(s[0]), b = addh(s[1]), k = edgeKey(a, b);
    a !== b && !seen.has(k) && (seen.add(k), seg.push([a, b]));
  }
  let r = triangulatePSLGCore(lp, outer, seg);
  if (!r.ok) return !1;
  for (let t of r.tris) pieces.push([handles[t[0]], handles[t[1]], handles[t[2]], fi, operand]);
  return !0;
}
function canonicalizeAndSplit(A, B, hits, { profile = !1, coplanar = null } = {}) {
  let cp = coplanar?.out ?? coplanar ?? null, t0 = profile ? performance.now() : 0, nA = A.pos.length / 3, nB = B.pos.length / 3, offB = nA, cpN = cp?.vertices?.length ?? 0, cap = nA + nB + hits.count * 2 + cpN + 32, pool = new Float64Array(cap * 3);
  pool.set(A.pos, 0), pool.set(B.pos, nA * 3);
  let ds = new DSU(cap, nA + nB), evA = buildEdgeVertices(A), evB = buildEdgeVertices(B), stats = { hitRecords: hits.count, canonicalVertices: 0, atomicSegments: 0, cutFaces: 0, fastK: [0, 0, 0, 0, 0], genericFaces: 0, bandPieces: 0, ambiguous: !1, coplanarVertices: cpN, coplanarTriangles: cp ? Math.floor(cp.indices.length / 3) : 0, coplanarEdgeSplits: cp?.edgeSplits?.length ?? 0, coplanarSeamAtoms: cp?.seamAtoms?.length ?? 0, consumedFacesA: 0, consumedFacesB: 0 }, epCount = hits.count * 2;
  for (let e = 0; e < epCount; e++) hits.kindA[e] === FeatureKind.Vertex && hits.kindB[e] === FeatureKind.Vertex && hits.idA[e] < nA && hits.idB[e] < nB && ds.union(hits.idA[e], offB + hits.idB[e]);
  if (cp) {
    for (let v of cp.vertices) if (v.kind === 2) {
      let e = v.featurePair;
      e?.featureA?.kind === FeatureKind.Vertex && e?.featureB?.kind === FeatureKind.Vertex && e.featureA.id < nA && e.featureB.id < nB && ds.union(e.featureA.id, offB + e.featureB.id);
    }
  }
  let canon = new FeatureMap(epCount + cpN + 16), cutsA = new Array(A.faceCount), cutsB = new Array(B.faceCount), hitA = new Uint8Array(A.faceCount), hitB = new Uint8Array(B.faceCount), consA = new Uint8Array(A.faceCount), consB = new Uint8Array(B.faceCount), seam = /* @__PURE__ */ new Set();
  function getBy(ka, ia, kb, ib, q) {
    let old = canon.get(ka, ia, kb, ib);
    if (old !== UINT32_MAX) return ds.find(old);
    let h = UINT32_MAX;
    if (ka === FeatureKind.Vertex && ia < nA ? h = ds.find(ia) : kb === FeatureKind.Vertex && ib < nB && (h = ds.find(offB + ib)), h === UINT32_MAX) {
      let z = null;
      ka === FeatureKind.Edge && kb === FeatureKind.Face ? z = refineEdgeFace(A, evA, ia, B, ib) : ka === FeatureKind.Face && kb === FeatureKind.Edge ? z = refineEdgeFace(B, evB, ib, A, ia) : ka === FeatureKind.Edge && kb === FeatureKind.Edge && (z = refineEdgeEdge(A, evA, ia, B, evB, ib)), z || (stats.ambiguous = !0, z = q), h = ds.add();
      let o = h * 3;
      pool[o] = z[0], pool[o + 1] = z[1], pool[o + 2] = z[2], stats.canonicalVertices++;
    }
    return canon.put(ka, ia, kb, ib, h), ds.find(h);
  }
  function getHit(e) {
    let po = e * 3;
    return getBy(hits.kindA[e], hits.idA[e], hits.kindB[e], hits.idB[e], [hits.pos[po], hits.pos[po + 1], hits.pos[po + 2]]);
  }
  let cpH = cp ? new Uint32Array(cpN) : null, cpOut = [], cpSeamPairs = [];
  if (cp) {
    for (let i = 0; i < cpN; i++) {
      let v = cp.vertices[i];
      if (v.kind === 0) {
        if (v.sourceVertex >= nA) {
          stats.ambiguous = !0;
          continue;
        }
        cpH[i] = ds.find(v.sourceVertex);
      } else if (v.kind === 1) {
        if (v.sourceVertex >= nB) {
          stats.ambiguous = !0;
          continue;
        }
        cpH[i] = ds.find(offB + v.sourceVertex);
      } else if (v.kind === 2) {
        let e = v.featurePair, q = e.approxPosition ?? e.pos;
        if (!e?.featureA || !e?.featureB || !q) {
          stats.ambiguous = !0;
          continue;
        }
        cpH[i] = getBy(e.featureA.kind, e.featureA.id, e.featureB.kind, e.featureB.id, q);
      } else
        stats.ambiguous = !0;
    }
    for (let f of cp.consumedFacesA ?? [])
      f < A.faceCount ? (consA[f] = 1, hitA[f] = 1) : stats.ambiguous = !0;
    for (let f of cp.consumedFacesB ?? [])
      f < B.faceCount ? (consB[f] = 1, hitB[f] = 1) : stats.ambiguous = !0;
    stats.consumedFacesA = cp.consumedFacesA?.length ?? 0, stats.consumedFacesB = cp.consumedFacesB?.length ?? 0;
    for (let i = 0; i + 2 < (cp.indices?.length ?? 0); i += 3) {
      let a = cp.indices[i], b = cp.indices[i + 1], c = cp.indices[i + 2];
      if (a >= cpN || b >= cpN || c >= cpN) {
        stats.ambiguous = !0;
        continue;
      }
      cpOut.push([ds.find(cpH[a]), ds.find(cpH[b]), ds.find(cpH[c]),cp.faceCandidates?.[i/3]]);
    }
    for (let z of cp.seamAtoms ?? []) {
      if (z.a >= cpN || z.b >= cpN) {
        stats.ambiguous = !0;
        continue;
      }
      let a = ds.find(cpH[z.a]), b = ds.find(cpH[z.b]);
      a !== b && (seam.add(edgeKey(a, b)), cpSeamPairs.push([a, b]));
    }
  }
  for (let i = 0; i < hits.count; i++) {
    let fa = A.triFace[hits.triA[i]], fb = B.triFace[hits.triB[i]];
    if (consA[fa] || consB[fb]) continue;
    let a = getHit(i * 2), b = getHit(i * 2 + 1);
    a !== b && (seam.add(edgeKey(a, b)), hitA[fa] = 1, hitB[fb] = 1, (cutsA[fa] ??= []).push([a, b]), (cutsB[fb] ??= []).push([a, b]));
  }
  function atom(all) {
    for (let fi = 0; fi < all.length; fi++) {
      let fc = all[fi];
      if (!fc?.length) continue;
      let ids = [];
      for (let s of fc)
        ids.push(ds.find(s[0]), ds.find(s[1]));
      ids.sort((a, b) => a - b);
      let w = 0;
      for (let i = 0; i < ids.length; i++) (!i || ids[i] !== ids[i - 1]) && (ids[w++] = ids[i]);
      ids.length = w;
      let out = [], seen = /* @__PURE__ */ new Set();
      for (let s0 of fc) {
        let sa = ds.find(s0[0]), sb = ds.find(s0[1]), ao = sa * 3, bo = sb * 3, dx = pool[bo] - pool[ao], dy = pool[bo + 1] - pool[ao + 1], dz = pool[bo + 2] - pool[ao + 2], L = dx * dx + dy * dy + dz * dz;
        if (L < 1e-28) {
          stats.ambiguous = !0;
          continue;
        }
        let cut = [[0, sa], [1, sb]];
        for (let id of ids) if (id !== sa && id !== sb) {
          let io = id * 3, t = ((pool[io] - pool[ao]) * dx + (pool[io + 1] - pool[ao + 1]) * dy + (pool[io + 2] - pool[ao + 2]) * dz) / L, qx = pool[ao] + dx * t, qy = pool[ao + 1] + dy * t, qz = pool[ao + 2] + dz * t;
          t > 1e-10 && t < 1 - 1e-10 && t >= -1e-9 && t <= 1 + 1e-9 && Math.hypot(pool[io] - qx, pool[io + 1] - qy, pool[io + 2] - qz) < 2e-8 && cut.push([t, id]);
        }
        cut.sort((a, b) => a[0] - b[0]);
        for (let i = 1; i < cut.length; i++) {
          let x = cut[i - 1][1], y = cut[i][1];
          if (x === y) continue;
          let k = edgeKey(x, y);
          seen.has(k) || (seen.add(k), out.push([x, y]), stats.atomicSegments++);
        }
      }
      all[fi] = out;
    }
  }
  if (atom(cutsA), atom(cutsB), cp?.edgeSplits?.length) {
    let edgeFaces = function(M) {
      let a = new Int32Array(M.edgeCount), b = new Int32Array(M.edgeCount);
      a.fill(-1), b.fill(-1);
      for (let t = 0; t < M.triCount; t++) {
        let o = t * 3, f = M.triFace[t];
        for (let e = 0; e < 3; e++) {
          let id = M.triE[o + e];
          a[id] === -1 ? a[id] = f : a[id] !== f && b[id] === -1 && (b[id] = f);
        }
      }
      return [a, b];
    }, [a0, a1] = edgeFaces(A), [b0, b1] = edgeFaces(B);
    for (let s of cp.edgeSplits) {
      if (s.vertex >= cpN) {
        stats.ambiguous = !0;
        continue;
      }
      let M = s.operand ? B : A, cons = s.operand ? consB : consA, hit = s.operand ? hitB : hitA, cuts = s.operand ? cutsB : cutsA, E0 = s.operand ? b0 : a0, E1 = s.operand ? b1 : a1;
      if (s.sourceEdge >= M.edgeCount) {
        stats.ambiguous = !0;
        continue;
      }
      let h = ds.find(cpH[s.vertex]);
      for (let f of [E0[s.sourceEdge], E1[s.sourceEdge]]) f >= 0 && !cons[f] && (hit[f] = 1, (cuts[f] ??= []).push([h, h]));
    }
  }
  let finalSeamMap = /* @__PURE__ */ new Map(), nonCoplanarSeamMap = /* @__PURE__ */ new Map(), addFinalSeam = (map, a, b) => {
    if (a = ds.find(a), b = ds.find(b), a !== b) {
      if (a > b) {
        let t = a;
        a = b, b = t;
      }
      map.set(a + "," + b, [a, b]);
    }
  };
  for (let [a, b] of cpSeamPairs) addFinalSeam(finalSeamMap, a, b);
  for (let all of [cutsA, cutsB]) for (let fc of all) if (fc) for (let s of fc) s[0] !== s[1] && (addFinalSeam(finalSeamMap, s[0], s[1]), addFinalSeam(nonCoplanarSeamMap, s[0], s[1]));
  let packSeam = (map) => {
    let pairs = [...map.values()].sort((x, y) => x[0] - y[0] || x[1] - y[1]), out = new Uint32Array(pairs.length * 2);
    for (let i = 0; i < pairs.length; i++)
      out[i * 2] = pairs[i][0], out[i * 2 + 1] = pairs[i][1];
    return out;
  }, seamAtoms = packSeam(finalSeamMap), nonCoplanarSeamAtoms = packSeam(nonCoplanarSeamMap);
  stats.seamSegments = seamAtoms.length / 2;
  let t1 = profile ? performance.now() : 0, piecesA = [], piecesB = [];
  for (let f = 0; f < A.faceCount; f++) if (hitA[f] && !consA[f] && (stats.cutFaces++, !splitFace(A, 0, f, cutsA[f] ?? [], pool, 0, stats, piecesA)))
    return stats.ambiguous = !0, { ok: !1, stats, pool: pool.subarray(0, ds.n * 3), piecesA, piecesB, cpOut, seam, seamAtoms, nonCoplanarSeamAtoms, hitA, hitB, consA, consB, cutsA, cutsB };
  for (let f = 0; f < B.faceCount; f++) if (hitB[f] && !consB[f] && (stats.cutFaces++, !splitFace(B, 1, f, cutsB[f] ?? [], pool, offB, stats, piecesB)))
    return stats.ambiguous = !0, { ok: !1, stats, pool: pool.subarray(0, ds.n * 3), piecesA, piecesB, cpOut, seam, seamAtoms, nonCoplanarSeamAtoms, hitA, hitB, consA, consB, cutsA, cutsB };
  return stats.bandPieces = piecesA.length + piecesB.length, profile && (stats.timing = { canonicalize: t1 - t0, split: performance.now() - t1, total: performance.now() - t0 }), { ok: !stats.ambiguous, stats, pool: pool.subarray(0, ds.n * 3), piecesA, piecesB, cpOut, seam, seamAtoms, nonCoplanarSeamAtoms, hitA, hitB, consA, consB, cutsA, cutsB, dsu: ds, cpH };
}

 
var CoplanarVertexKind = { SourceVertexA: 0, SourceVertexB: 1, FeaturePair: 2 }, uk = (a, b) => a < b ? `${a},${b}` : `${b},${a}`;
function frame(M, patch, normal) {
  if (patch.outer.vertices.length < 2) return null;
  let p = M.pos, o0 = patch.outer.vertices[0] * 3, ox = p[o0], oy = p[o0 + 1], oz = p[o0 + 2], n = normal, Ln = Math.hypot(...n);
  if (Ln < 1e-20) return null;
  let nx = n[0] / Ln, ny = n[1] / Ln, nz = n[2] / Ln, ux = 0, uy = 0, uz = 0, ul = 0;
  for (let i = 1; i < patch.outer.vertices.length; i++) {
    let q = patch.outer.vertices[i] * 3, dx = p[q] - ox, dy = p[q + 1] - oy, dz = p[q + 2] - oz, dot = dx * nx + dy * ny + dz * nz;
    if (ux = dx - dot * nx, uy = dy - dot * ny, uz = dz - dot * nz, ul = Math.hypot(ux, uy, uz), ul > 1e-20) break;
  }
  if (ul < 1e-20) return null;
  ux /= ul, uy /= ul, uz /= ul;
  let vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux, vl = Math.hypot(vx, vy, vz);
  return vl < 0.5 ? null : (vx /= vl, vy /= vl, vz /= vl, ux = vy * nz - vz * ny, uy = vz * nx - vx * nz, uz = vx * ny - vy * nx, { ox, oy, oz, ux, uy, uz, vx, vy, vz });
}
var proj = (F, p, i) => {
  let o = i * 3, dx = p[o] - F.ox, dy = p[o + 1] - F.oy, dz = p[o + 2] - F.oz;
  return { x: dx * F.ux + dy * F.uy + dz * F.uz, y: dx * F.vx + dy * F.vy + dz * F.vz };
}, unproj = (F, q) => [F.ox + F.ux * q.x + F.vx * q.y, F.oy + F.uy * q.x + F.vy * q.y, F.oz + F.uz * q.x + F.vz * q.y];
function segD2(p, a, b) {
  let x = b.x - a.x, y = b.y - a.y, L = x * x + y * y;
  if (L < 1e-30) return { d: (p.x - a.x) ** 2 + (p.y - a.y) ** 2, t: 0 };
  let t = ((p.x - a.x) * x + (p.y - a.y) * y) / L, tc = Math.max(0, Math.min(1, t)), qx = a.x + x * tc, qy = a.y + y * tc;
  return { d: (p.x - qx) ** 2 + (p.y - qy) ** 2, t };
}
function loopClass(q, loop, eps2) {
  let inside = !1;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    let a = loop[j], b = loop[i];
    if (segD2(q, a, b).d <= eps2) return 0;
    a.y > q.y != b.y > q.y && q.x < (b.x - a.x) * (q.y - a.y) / (b.y - a.y) + a.x && (inside = !inside);
  }
  return inside ? 1 : -1;
}
function patch2(M, p, F) {
  let loop = (L) => L.vertices.map((v) => proj(F, M.pos, v));
  return { outer: loop(p.outer), holes: p.holes.map(loop) };
}
function inPatch(q, p, eps2) {
  let o = loopClass(q, p.outer, eps2);
  if (o < 0) return !1;
  if (o === 0) return !0;
  for (let h of p.holes)
    if (loopClass(q, h, eps2) >= 0) return !1;
  return !0;
}
function inUnion(q, ps, eps2) {
  for (let p of ps) if (inPatch(q, p, eps2)) return !0;
  return !1;
}
function addEdges(M, patch, F, owner, patchId, out) {
  let add = (L) => {
    for (let i = 0; i < L.vertices.length; i++) {
      let a = L.vertices[i], b = L.vertices[(i + 1) % L.vertices.length];
      out.push({ owner, patchId, id: L.edges[i], a, b, p: proj(F, M.pos, a), q: proj(F, M.pos, b) });
    }
  };
  add(patch.outer);
  for (let h of patch.holes) add(h);
}
function addNodeFactory(eps, eps2) {
  let nodes = [], buckets = /* @__PURE__ */ new Map(), inv = 1 / eps;
  function add(p) {
    let ix = Math.round(p.x * inv), iy = Math.round(p.y * inv);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      let a2 = buckets.get(`${ix + dx},${iy + dy}`);
      if (a2)
        for (let id2 of a2) {
          let q = nodes[id2], x = q.x - p.x, y = q.y - p.y;
          if (x * x + y * y <= eps2) return id2;
        }
    }
    let id = nodes.length;
    nodes.push({ x: p.x, y: p.y, inc: [] });
    let k = `${ix},${iy}`, a = buckets.get(k);
    return a || buckets.set(k, a = []), a.push(id), id;
  }
  return { nodes, add };
}
function nodeEdges(edges, scale) {
  let eps = Math.max(1e-14, scale * 1e-12), eps2 = Math.max(1e-30, scale * scale * 1e-24), N = addNodeFactory(eps, eps2), cuts = edges.map(() => []);
  for (let e = 0; e < edges.length; e++) {
    let a = N.add(edges[e].p), b = N.add(edges[e].q);
    cuts[e].push([0, a], [1, b]);
  }
  let addCut = (e, t, p) => {
    t < -eps || t > 1 + eps || cuts[e].push([Math.max(0, Math.min(1, t)), N.add(p)]);
  }, A = [], B = [];
  for (let i = 0; i < edges.length; i++) (edges[i].owner ? B : A).push(i);
  for (let i of A) for (let j of B) {
    let E = edges[i], Q = edges[j], ax = E.q.x - E.p.x, ay = E.q.y - E.p.y, bx = Q.q.x - Q.p.x, by = Q.q.y - Q.p.y, rx = Q.p.x - E.p.x, ry = Q.p.y - E.p.y, den = ax * by - ay * bx;
    if (Math.abs(den) > eps) {
      let t = (rx * by - ry * bx) / den, u = (rx * ay - ry * ax) / den;
      if (t >= -eps && t <= 1 + eps && u >= -eps && u <= 1 + eps) {
        let p = { x: E.p.x + ax * t, y: E.p.y + ay * t };
        addCut(i, t, p), addCut(j, u, p);
      }
    } else if (Math.abs(rx * ay - ry * ax) <= eps * Math.max(1, Math.hypot(ax, ay)))
      for (let [p, e0, e1] of [[E.p, i, j], [E.q, i, j], [Q.p, j, i], [Q.q, j, i]]) {
        let q = segD2(p, edges[e1].p, edges[e1].q);
        q.d <= eps2 && q.t >= -eps && q.t <= 1 + eps && (addCut(e0, segD2(p, edges[e0].p, edges[e0].q).t, p), addCut(e1, q.t, p));
      }
  }
  let segMap = /* @__PURE__ */ new Map(), segments = [];
  for (let e = 0; e < edges.length; e++) {
    cuts[e].sort((a, b) => a[0] - b[0]);
    let q = [];
    for (let x of cuts[e]) (!q.length || x[1] !== q[q.length - 1][1]) && q.push(x);
    for (let x of q) {
      let inc = N.nodes[x[1]].inc;
      inc.includes(e) || inc.push(e);
    }
    for (let k = 1; k < q.length; k++) {
      let u = q[k - 1][1], v = q[k][1];
      if (u === v) continue;
      let key2 = uk(u, v), s = segMap.get(key2);
      s || (s = { a: u, b: v, mask: 0, leftA: -1, leftB: -1, confA: !1, confB: !1 }, segMap.set(key2, s), segments.push(s));
      let src = edges[e], same = s.a === u && s.b === v;
      s.mask |= 1 << src.owner;
      let dir = same ? 1 : 0;
      if (src.owner === 0) {
        let z = dir ? 1 : 0;
        s.leftA < 0 ? s.leftA = z : s.leftA !== z && (s.confA = !0);
      } else
        s._bDirs ??= [], s._bDirs.push(dir);
    }
  }
  return { nodes: N.nodes, segments, eps2, eps };
}
function groupPairs(pairs, nA, nB) {
  let byA = Array.from({ length: nA }, () => []), byB = Array.from({ length: nB }, () => []);
  for (let i = 0; i < pairs.length; i++)
    byA[pairs[i].patchA].push(i), byB[pairs[i].patchB].push(i);
  let seen = new Uint8Array(pairs.length), groups = [];
  for (let root = 0; root < pairs.length; root++) if (!seen[root]) {
    let orient0 = pairs[root].sameOrientation, plane = pairs[root].planeKey, q = [root], aids = [], bids = [], sa = new Uint8Array(nA), sb = new Uint8Array(nB);
    seen[root] = 1;
    let valid = !0;
    for (let qi = 0; qi < q.length; qi++) {
      let pr = pairs[q[qi]];
      if (pr.planeKey !== plane || pr.sameOrientation !== orient0) {
        valid = !1;
        break;
      }
      if (!sa[pr.patchA]) {
        sa[pr.patchA] = 1, aids.push(pr.patchA);
        for (let e of byA[pr.patchA]) seen[e] || (seen[e] = 1, q.push(e));
      }
      if (!sb[pr.patchB]) {
        sb[pr.patchB] = 1, bids.push(pr.patchB);
        for (let e of byB[pr.patchB]) seen[e] || (seen[e] = 1, q.push(e));
      }
    }
    groups.push({ valid, orient: orient0, plane, aids, bids });
  }
  return groups;
}
function displayCandidateSegments(ar, pa, pb, op) {
  let out = [];
  for (let s of ar.segments) {
    if (s.mask !== 1 && s.mask !== 2) continue;
    let A = ar.nodes[s.a], B = ar.nodes[s.b], mid = { x: (A.x + B.x) * 0.5, y: (A.y + B.y) * 0.5 };
    if (s.mask === 1) {
      if (op === "difference" || !inUnion(mid, pb, ar.eps2)) continue;
      out.push({ a: s.a, b: s.b, owner: 0 });
    } else {
      if (!inUnion(mid, pa, ar.eps2)) continue;
      out.push({ a: s.a, b: s.b, owner: 1 });
    }
  }
  return out;
}
function mergeCollinearDisplay(nodes, segs, scale) {
  if (segs.length < 2) return segs.slice();
  let result = [];
  for (let owner of [0, 1]) {
    let src = segs.filter((s) => s.owner === owner);
    if (!src.length) continue;
    let inc = Array.from({ length: nodes.length }, () => []);
    for (let i = 0; i < src.length; i++)
      inc[src[i].a].push(i), inc[src[i].b].push(i);
    let used = new Uint8Array(src.length), col = (i, j, v) => {
      let a = src[i].a === v ? src[i].b : src[i].a, b = src[j].a === v ? src[j].b : src[j].a, A = nodes[a], V = nodes[v], B = nodes[b], x1 = A.x - V.x, y1 = A.y - V.y, x2 = B.x - V.x, y2 = B.y - V.y, l1 = x1 * x1 + y1 * y1, l2 = x2 * x2 + y2 * y2;
      if (l1 <= 1e-30 || l2 <= 1e-30) return !1;
      let cr = x1 * y2 - y1 * x2;
      return cr * cr <= Math.max(1e-30, l1 * l2 * 1e-24);
    }, walk = (startEdge, startNode) => {
      let e = startEdge, v = startNode, first = startNode, last = startNode;
      for (; !used[e]; ) {
        used[e] = 1;
        let z = src[e], w = z.a === v ? z.b : z.a;
        last = w;
        let q = inc[w];
        if (q.length !== 2) break;
        let ne = q[0] === e ? q[1] : q[0];
        if (used[ne] || !col(e, ne, w)) break;
        v = w, e = ne;
      }
      return { a: first, b: last, owner };
    };
    for (let i = 0; i < src.length; i++) if (!used[i]) {
      let z = src[i], da = inc[z.a], db = inc[z.b], start = da.length !== 2 || da.length === 2 && !col(da[0], da[1], z.a) ? z.a : db.length !== 2 || db.length === 2 && !col(db[0], db[1], z.b) ? z.b : -1;
      if (start >= 0) {
        let q = walk(i, start);
        q.a !== q.b && result.push(q);
      }
    }
    for (let i = 0; i < src.length; i++) used[i] || (used[i] = 1, result.push(src[i]));
  }
  return result;
}
function areaLoop(nodes, L) {
  let a = 0;
  for (let i = 0; i < L.length; i++) {
    let p = nodes[L[i]], q = nodes[L[(i + 1) % L.length]];
    a += p.x * q.y - p.y * q.x;
  }
  return a * 0.5;
}
function centroidLoop(nodes, L) {
  let x = 0, y = 0;
  for (let i of L)
    x += nodes[i].x, y += nodes[i].y;
  return { x: x / L.length, y: y / L.length };
}
function extractLoops(nodes, dir) {
  let out = Array.from({ length: nodes.length }, () => []), indeg = new Uint16Array(nodes.length);
  for (let i = 0; i < dir.length; i++) {
    let e = dir[i];
    out[e.a].push(i), indeg[e.b]++;
  }
  for (let i = 0; i < nodes.length; i++) if (out[i].length !== indeg[i] || out[i].length > 1) return null;
  let used = new Uint8Array(dir.length), loops = [];
  for (let r = 0; r < dir.length; r++) if (!used[r]) {
    let L = [], start = dir[r].a, e = r;
    for (let guard = 0; guard <= dir.length; guard++) {
      if (used[e]) return null;
      used[e] = 1;
      let z = dir[e];
      if (L.push(z.a), z.b === start) break;
      let nx = out[z.b];
      if (nx.length !== 1 || (e = nx[0], guard === dir.length)) return null;
    }
    if (L.length < 3) return null;
    loops.push(L);
  }
  return loops;
}
function boolPred(kind, a, b) {
  return kind === 0 ? a || b : kind === 1 ? a && !b : kind === 2 ? a && b : kind === 3 ? a && !b : kind === 4 ? b && !a : kind === 5 ? a : !1;
}
function triangulateSimpleLoop(nodes, L) {
  let n = L.length;
  if (n < 3) return null;
  let scale = 1;
  for (let id of L) {
    let q = nodes[id];
    scale = Math.max(scale, Math.abs(q.x), Math.abs(q.y));
  }
  let eps = scale * scale * 1e-14, poly = L.slice(), out = [];
  areaLoop(nodes, poly) < 0 && poly.reverse();
  let ori = (a, b, c) => {
    let A = nodes[a], B = nodes[b], C = nodes[c];
    return (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x);
  }, inTri2 = (q, a, b, c) => {
    let Q = nodes[q], A = nodes[a], B = nodes[b], C = nodes[c], o0 = (B.x - A.x) * (Q.y - A.y) - (B.y - A.y) * (Q.x - A.x), o1 = (C.x - B.x) * (Q.y - B.y) - (C.y - B.y) * (Q.x - B.x), o2 = (A.x - C.x) * (Q.y - C.y) - (A.y - C.y) * (Q.x - C.x);
    return o0 >= -eps && o1 >= -eps && o2 >= -eps;
  }, guard = 0;
  for (; poly.length > 3 && guard++ < n * n * 4 + 32; ) {
    let cut = !1;
    for (let i = 0; i < poly.length; i++) {
      let a = poly[(i + poly.length - 1) % poly.length], b = poly[i], c = poly[(i + 1) % poly.length];
      if (ori(a, b, c) <= eps) continue;
      let blocked = !1;
      for (let j = 0; j < poly.length; j++) {
        let q = poly[j];
        if (!(q === a || q === b || q === c) && inTri2(q, a, b, c)) {
          blocked = !0;
          break;
        }
      }
      if (!blocked) {
        out.push([a, b, c]), poly.splice(i, 1), cut = !0;
        break;
      }
    }
    if (!cut) {
      let ci = -1;
      for (let i = 0; i < poly.length; i++) {
        let a2 = poly[(i + poly.length - 1) % poly.length], b = poly[i], c2 = poly[(i + 1) % poly.length];
        if (Math.abs(ori(a2, b, c2)) <= eps) {
          ci = i;
          break;
        }
      }
      if (ci < 0) return null;
      let removed = poly[ci], a = poly[(ci + poly.length - 1) % poly.length], c = poly[(ci + 1) % poly.length];
      poly.splice(ci, 1), out._removed ??= [], out._removed.push([removed, a, c]);
    }
  }
  if (poly.length !== 3 || ori(poly[0], poly[1], poly[2]) <= eps) return null;
  out.push([poly[0], poly[1], poly[2]]);
  for (let [q, a, c] of out._removed ?? []) {
    let ti = -1;
    for (let i = 0; i < out.length; i++) {
      let t2 = out[i];
      for (let e = 0; e < 3; e++) {
        let u = t2[e], v = t2[(e + 1) % 3];
        if (u === a && v === c) {
          ti = i;
          break;
        }
        if (u === c && v === a) {
          ti = i;
          break;
        }
      }
      if (ti >= 0) break;
    }
    if (ti < 0) return null;
    let t = out[ti], x = t.find((v) => v !== a && v !== c);
    if (x === void 0) return null;
    if (out[ti] = [a, q, x], out.push([q, c, x]), ori(...out[ti]) <= eps) {
      let z = out[ti][1];
      out[ti][1] = out[ti][2], out[ti][2] = z;
    }
    let nt = out[out.length - 1];
    if (ori(...nt) <= eps) {
      let z = nt[1];
      nt[1] = nt[2], nt[2] = z;
    }
  }
  return delete out._removed, out;
}
function selectBoundary(ar, pa, pb, kind, orient3, scale) {
  let dir = [], eps2 = Math.max(ar.eps2, scale * scale * 1e-22);
  for (let s of ar.segments) {
    if (s.mask & 2) {
      let val = -1, conf = !1;
      for (let d of s._bDirs ?? []) {
        let z = orient3 ? d : 1 - d;
        val < 0 ? val = z : val !== z && (conf = !0);
      }
      s.leftB = val, s.confB = conf;
    }
    let A = ar.nodes[s.a], B = ar.nodes[s.b], mid = { x: (A.x + B.x) * 0.5, y: (A.y + B.y) * 0.5 }, la, ra, lb, rb;
    if (s.mask & 1 && !s.confA)
      la = !!s.leftA, ra = !la;
    else {
      let dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy), h = Math.min(L * 0.1, Math.max(scale * 1e-10, L * 1e-6)), nx = L ? -dy / L : 0, ny = L ? dx / L : 0;
      la = inUnion({ x: mid.x + nx * h, y: mid.y + ny * h }, pa, eps2), ra = inUnion({ x: mid.x - nx * h, y: mid.y - ny * h }, pa, eps2);
    }
    if (s.mask & 2 && !s.confB)
      lb = !!s.leftB, rb = !lb;
    else {
      let dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy), h = Math.min(L * 0.1, Math.max(scale * 1e-10, L * 1e-6)), nx = L ? -dy / L : 0, ny = L ? dx / L : 0;
      lb = inUnion({ x: mid.x + nx * h, y: mid.y + ny * h }, pb, eps2), rb = inUnion({ x: mid.x - nx * h, y: mid.y - ny * h }, pb, eps2);
    }
    let l = boolPred(kind, la, lb), r = boolPred(kind, ra, rb);
    if (l === r) continue;
    let seamB = !!(s.mask & 2);
    dir.push(l ? { a: s.a, b: s.b, mask: s.mask, seamB } : { a: s.b, b: s.a, mask: s.mask, seamB });
  }
  return dir;
}
function triangulateLoops(nodes, loops, flip, emit, out) {
  let outer = [], holes = [];
  for (let L of loops) {
    let a = areaLoop(nodes, L);
    if (Math.abs(a) < 1e-20) return !1;
    (a > 0 ? outer : holes).push(L);
  }
  if (!outer.length && loops.length) return !1;
  let assigns = outer.map(() => []);
  for (let H of holes) {
    let q = centroidLoop(nodes, H), best = -1, bestArea = 1 / 0;
    for (let i = 0; i < outer.length; i++) {
      let poly = outer[i].map((id) => nodes[id]);
      if (loopClass(q, poly, 1e-28) >= 0) {
        let a = Math.abs(areaLoop(nodes, outer[i]));
        a < bestArea && (bestArea = a, best = i);
      }
    }
    if (best < 0) return !1;
    assigns[best].push(H);
  }
  for (let oi = 0; oi < outer.length; oi++) {
    let O = outer[oi], Hs = assigns[oi], kept = [], ids, pts;
    if (Hs.length === 0) {
      let direct = triangulateSimpleLoop(nodes, O);
      if (!direct) return !1;
      ids = O.slice();
      let loc = new Map(ids.map((id, i) => [id, i]));
      pts = ids.map((id) => nodes[id]);
      for (let t of direct) {
        let a = loc.get(t[0]), b = loc.get(t[1]), c = loc.get(t[2]);
        if (a === void 0 || b === void 0 || c === void 0) return !1;
        kept.push([a, b, c]);
      }
    } else {
      ids = [];
      let local = /* @__PURE__ */ new Map(), add = (n) => {
        let i = local.get(n);
        return i === void 0 && (i = ids.length, ids.push(n), local.set(n, i)), i;
      }, o = O.map(add), seg = [];
      for (let H of Hs) for (let i = 0; i < H.length; i++) seg.push([add(H[i]), add(H[(i + 1) % H.length])]);
      pts = ids.map((id) => nodes[id]);
      let tr = triangulatePSLGCore(pts, o, seg);
      if (!tr.ok) return !1;
      let hp = Hs.map((H) => H.map((id) => nodes[id])), op = O.map((id) => nodes[id]);
      for (let t of tr.tris) {
        let c = { x: (pts[t[0]].x + pts[t[1]].x + pts[t[2]].x) / 3, y: (pts[t[0]].y + pts[t[1]].y + pts[t[2]].y) / 3 };
        if (loopClass(c, op, 1e-28) < 0) continue;
        let hole = !1;
        for (let H of hp) if (loopClass(c, H, 1e-28) >= 0) {
          hole = !0;
          break;
        }
        hole || kept.push(t);
      }
    }
    let gotArea = 0;
    for (let t of kept) {
      let a = pts[t[0]], b = pts[t[1]], z = pts[t[2]];
      gotArea += Math.abs((b.x - a.x) * (z.y - a.y) - (b.y - a.y) * (z.x - a.x)) * 0.5;
    }
    let wantArea = Math.abs(areaLoop(nodes, O)) - Hs.reduce((q, H) => q + Math.abs(areaLoop(nodes, H)), 0), tol = Math.max(1e-12, wantArea * 1e-10);
    if (Math.abs(gotArea - wantArea) > tol) return !1;
    for (let t of kept) {
      let a = emit(ids[t[0]]), b = emit(ids[t[1]]), c0 = emit(ids[t[2]]);
      if (a < 0 || b < 0 || c0 < 0) return !1;
      flip ? out.indices.push(a, c0, b) : out.indices.push(a, b, c0);
    }
  }
  return !0;
}
function buildCoplanarDisplaySeam(A, B, ca, cb, op, pairs) {
  let positions = [], indices = [];
  if (!pairs.length) return { positions: Float64Array.from(positions), indices: Uint32Array.from(indices) };
  for (let G of groupPairs(pairs, ca.patches.length, cb.patches.length)) {
    if (!G.valid || !G.aids.length || !G.bids.length) return null;
    let F = frame(A, ca.patches[G.aids[0]], ca.normal[G.aids[0]]);
    if (!F) return null;
    let pa = G.aids.map((id) => patch2(A, ca.patches[id], F)), pb = G.bids.map((id) => patch2(B, cb.patches[id], F)), edges = [];
    for (let id of G.aids) addEdges(A, ca.patches[id], F, 0, id, edges);
    for (let id of G.bids) addEdges(B, cb.patches[id], F, 1, id, edges);
    let scale = 1;
    for (let e of edges) scale = Math.max(scale, Math.abs(e.p.x), Math.abs(e.p.y), Math.abs(e.q.x), Math.abs(e.q.y));
    let ar = nodeEdges(edges, scale), display = mergeCollinearDisplay(ar.nodes, displayCandidateSegments(ar, pa, pb, op), scale);
    for (let e of display) {
      let base = positions.length / 3, a = unproj(F, ar.nodes[e.a]), b = unproj(F, ar.nodes[e.b]);
      positions.push(...a, ...b), indices.push(base, base + 1);
    }
  }
  return { positions: Float64Array.from(positions), indices: Uint32Array.from(indices) };
}
function resolveCoplanarFast(A, B, ca, cb, op, pairs) {
  let out = { vertices: [], indices: [], consumedFacesA: [], consumedFacesB: [], edgeSplits: [], seamAtoms: [], displaySeamPositions: [], displaySeamIndices: [], ambiguous: !1 };
  if (!pairs.length) return { ok: !0, out, fast: !0 };
  for (let G of groupPairs(pairs, ca.patches.length, cb.patches.length)) {
    let emitNode = function(ni) {
      if (emitCache[ni] >= 0) return emitCache[ni];
      let p = ar.nodes[ni], on2 = p.inc, ea = on2.find((i) => edges[i].owner === 0), eb = on2.find((i) => edges[i].owner === 1), va = -1, vb = -1, Ea = ea === void 0 ? null : edges[ea], Eb = eb === void 0 ? null : edges[eb];
      for (let i of on2) {
        let e = edges[i], t = segD2(p, e.p, e.q).t;
        e.owner === 0 ? (Ea = e, Math.abs(t) < 1e-9 ? va = e.a : Math.abs(t - 1) < 1e-9 && (va = e.b)) : (Eb = e, Math.abs(t) < 1e-9 ? vb = e.a : Math.abs(t - 1) < 1e-9 && (vb = e.b));
      }
      let xyz = unproj(F, p), r;
      if (va >= 0 && vb >= 0) r = { kind: CoplanarVertexKind.FeaturePair, featurePair: { approxPosition: xyz, featureA: { kind: FeatureKind.Vertex, id: va }, featureB: { kind: FeatureKind.Vertex, id: vb } } };
      else if (va >= 0 && Eb) r = { kind: CoplanarVertexKind.FeaturePair, featurePair: { approxPosition: xyz, featureA: { kind: FeatureKind.Vertex, id: va }, featureB: { kind: FeatureKind.Edge, id: Eb.id } } };
      else if (vb >= 0 && Ea) r = { kind: CoplanarVertexKind.FeaturePair, featurePair: { approxPosition: xyz, featureA: { kind: FeatureKind.Edge, id: Ea.id }, featureB: { kind: FeatureKind.Vertex, id: vb } } };
      else if (Ea && Eb) r = { kind: CoplanarVertexKind.FeaturePair, featurePair: { approxPosition: xyz, featureA: { kind: FeatureKind.Edge, id: Ea.id }, featureB: { kind: FeatureKind.Edge, id: Eb.id } } };
      else if (va >= 0) r = { kind: CoplanarVertexKind.SourceVertexA, sourceVertex: va };
      else if (vb >= 0) r = { kind: CoplanarVertexKind.SourceVertexB, sourceVertex: vb };
      else return -1;
      let id = out.vertices.length;
      out.vertices.push(r), emitCache[ni] = id;
      for (let i of on2) {
        let e = edges[i], t = segD2(p, e.p, e.q).t;
        if (t > 1e-9 && t < 1 - 1e-9) {
          let k = `${e.owner},${e.id},${id}`;
          splitSeen.has(k) || (splitSeen.add(k), out.edgeSplits.push({ operand: e.owner, sourceEdge: e.id, vertex: id }));
        }
      }
      return id;
    }, pass = function(kind, flip) {
      let dir = selectBoundary(ar, pa, pb, kind, G.orient, scale), loops = extractLoops(ar.nodes, dir);
      if (!loops) return "loops";
      const start=out.indices.length/3;
      if (!triangulateLoops(ar.nodes, loops, flip, emitNode, out)) return "triangulate";
      const candidates=[G.aids.flatMap(id=>ca.patches[id].faces),G.bids.flatMap(id=>cb.patches[id].faces)];
      out.faceCandidates??=[];for(let i=start;i<out.indices.length/3;i++)out.faceCandidates[i]=candidates;
      for (let e of dir) if (e.seamB) {
        let a = emitNode(e.a), b = emitNode(e.b);
        a >= 0 && b >= 0 && a !== b && out.seamAtoms.push({ a, b });
      }
      return null;
    };
    if (!G.valid || !G.aids.length || !G.bids.length) return { ok: !1, out, fast: !1 };
    let F = frame(A, ca.patches[G.aids[0]], ca.normal[G.aids[0]]);
    if (!F) return { ok: !1, out, fast: !1 };
    let pa = G.aids.map((id) => patch2(A, ca.patches[id], F)), pb = G.bids.map((id) => patch2(B, cb.patches[id], F)), edges = [];
    for (let id of G.aids)
      out.consumedFacesA.push(...ca.patches[id].faces), addEdges(A, ca.patches[id], F, 0, id, edges);
    for (let id of G.bids)
      out.consumedFacesB.push(...cb.patches[id].faces), addEdges(B, cb.patches[id], F, 1, id, edges);
    let scale = 1;
    for (let e of edges) scale = Math.max(scale, Math.abs(e.p.x), Math.abs(e.p.y), Math.abs(e.q.x), Math.abs(e.q.y));
    let ar = nodeEdges(edges, scale), emitCache = new Int32Array(ar.nodes.length), splitSeen = /* @__PURE__ */ new Set();
    emitCache.fill(-1);
    let display = mergeCollinearDisplay(ar.nodes, displayCandidateSegments(ar, pa, pb, op), scale);
    for (let e of display) {
      let base = out.displaySeamPositions.length / 3, a = unproj(F, ar.nodes[e.a]), b = unproj(F, ar.nodes[e.b]);
      out.displaySeamPositions.push(...a, ...b), out.displaySeamIndices.push(base, base + 1);
    }
    if (G.orient) {
      let kind = op === "union" ? 0 : op === "difference" ? 1 : 2, why = pass(kind, !1);
      if (why) return { ok: !1, out, fast: !1, reason: why };
    } else if (op === "union") {
      let why = pass(3, !1);
      if (why) return { ok: !1, out, fast: !1, reason: "oppA:" + why };
      if (why = pass(4, !0), why) return { ok: !1, out, fast: !1, reason: "oppB:" + why };
    } else if (op === "difference") {
      let why = pass(5, !1);
      if (why) return { ok: !1, out, fast: !1, reason: why };
    }
  }
  return out.consumedFacesA = [...new Set(out.consumedFacesA)].sort((a, b) => a - b), out.consumedFacesB = [...new Set(out.consumedFacesB)].sort((a, b) => a - b), { ok: !0, out, fast: !0 };
}

 
var CoplanarVertexKind2 = { SourceVertexA: 0, SourceVertexB: 1, FeaturePair: 2 }, edgeKey2 = (a, b) => a < b ? `${a},${b}` : `${b},${a}`;
function frame2(M, patch, normal) {
  if (patch.outer.vertices.length < 2) return null;
  let p = M.pos, o0 = patch.outer.vertices[0] * 3, ox = p[o0], oy = p[o0 + 1], oz = p[o0 + 2], n = normal, Ln = Math.hypot(...n);
  if (Ln < 1e-20) return null;
  let nx = n[0] / Ln, ny = n[1] / Ln, nz = n[2] / Ln, ux = 0, uy = 0, uz = 0, ul = 0;
  for (let i = 1; i < patch.outer.vertices.length; i++) {
    let q = patch.outer.vertices[i] * 3, dx = p[q] - ox, dy = p[q + 1] - oy, dz = p[q + 2] - oz, dot = dx * nx + dy * ny + dz * nz;
    if (ux = dx - dot * nx, uy = dy - dot * ny, uz = dz - dot * nz, ul = Math.hypot(ux, uy, uz), ul > 1e-20) break;
  }
  if (ul < 1e-20) return null;
  ux /= ul, uy /= ul, uz /= ul;
  let vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux, vl = Math.hypot(vx, vy, vz);
  return vl < 0.5 ? null : (vx /= vl, vy /= vl, vz /= vl, ux = vy * nz - vz * ny, uy = vz * nx - vx * nz, uz = vx * ny - vy * nx, { ox, oy, oz, ux, uy, uz, vx, vy, vz, nx, ny, nz });
}
var proj2 = (F, p, i) => {
  let o = i * 3, dx = p[o] - F.ox, dy = p[o + 1] - F.oy, dz = p[o + 2] - F.oz;
  return { x: dx * F.ux + dy * F.uy + dz * F.uz, y: dx * F.vx + dy * F.vy + dz * F.vz };
}, unproj2 = (F, q) => [F.ox + F.ux * q.x + F.vx * q.y, F.oy + F.uy * q.x + F.vy * q.y, F.oz + F.uz * q.x + F.vz * q.y];
function segD22(p, a, b) {
  let x = b.x - a.x, y = b.y - a.y, L = x * x + y * y;
  if (L < 1e-30) return { d: (p.x - a.x) ** 2 + (p.y - a.y) ** 2, t: 0 };
  let t = ((p.x - a.x) * x + (p.y - a.y) * y) / L, tc = Math.max(0, Math.min(1, t)), qx = a.x + x * tc, qy = a.y + y * tc;
  return { d: (p.x - qx) ** 2 + (p.y - qy) ** 2, t };
}
function pointInLoop(q, loop) {
  let inside = !1;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    let a = loop[j], b = loop[i];
    if (segD22(q, a, b).d <= 1e-24) return !0;
    a.y > q.y != b.y > q.y && q.x < (b.x - a.x) * (q.y - a.y) / (b.y - a.y) + a.x && (inside = !inside);
  }
  return inside;
}
function patch22(M, p, F) {
  let loop = (L) => L.vertices.map((v) => proj2(F, M.pos, v));
  return { outer: loop(p.outer), holes: p.holes.map(loop) };
}
function inPatch2(q, p) {
  if (!pointInLoop(q, p.outer)) return !1;
  for (let h of p.holes) if (pointInLoop(q, h)) return !1;
  return !0;
}
function addEdges2(M, patch, F, owner, out) {
  let add = (L) => {
    for (let i = 0; i < L.vertices.length; i++) {
      let a = L.vertices[i], b = L.vertices[(i + 1) % L.vertices.length];
      out.push({ owner, id: L.edges[i], a, b, p: proj2(F, M.pos, a), q: proj2(F, M.pos, b) });
    }
  };
  add(patch.outer);
  for (let h of patch.holes) add(h);
}
function nodeArrangement(edges, scale) {
  let eps = Math.max(1e-14, scale * 1e-12), eps2 = Math.max(1e-30, scale * scale * 1e-24), cuts = edges.map(() => [[0, null], [1, null]]), nodes = [];
  function addNode(p) {
    for (let i = 0; i < nodes.length; i++) {
      let dx = nodes[i].x - p.x, dy = nodes[i].y - p.y;
      if (dx * dx + dy * dy <= eps2) return i;
    }
    return nodes.push({ x: p.x, y: p.y }), nodes.length - 1;
  }
  for (let e = 0; e < edges.length; e++)
    cuts[e][0][1] = addNode(edges[e].p), cuts[e][1][1] = addNode(edges[e].q);
  function addCut(e, t, p) {
    t < -eps || t > 1 + eps || cuts[e].push([Math.max(0, Math.min(1, t)), addNode(p)]);
  }
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    let A = edges[i], B = edges[j];
    if (A.owner === B.owner) continue;
    let ax = A.q.x - A.p.x, ay = A.q.y - A.p.y, bx = B.q.x - B.p.x, by = B.q.y - B.p.y, rx = B.p.x - A.p.x, ry = B.p.y - A.p.y, den = ax * by - ay * bx;
    if (Math.abs(den) > eps) {
      let t = (rx * by - ry * bx) / den, u = (rx * ay - ry * ax) / den;
      if (t >= -eps && t <= 1 + eps && u >= -eps && u <= 1 + eps) {
        let p = { x: A.p.x + ax * t, y: A.p.y + ay * t };
        addCut(i, t, p), addCut(j, u, p);
      }
    } else if (Math.abs(rx * ay - ry * ax) <= eps * Math.max(1, Math.hypot(ax, ay)))
      for (let [p, e0, e1] of [[A.p, i, j], [A.q, i, j], [B.p, j, i], [B.q, j, i]]) {
        let q = segD22(p, edges[e1].p, edges[e1].q);
        if (q.d <= eps2 && q.t >= -eps && q.t <= 1 + eps) {
          let t0 = segD22(p, edges[e0].p, edges[e0].q).t;
          addCut(e0, t0, p), addCut(e1, q.t, p);
        }
      }
  }
  let seg = [], seen = /* @__PURE__ */ new Set();
  for (let e = 0; e < edges.length; e++) {
    cuts[e].sort((a, b) => a[0] - b[0]);
    let q = [];
    for (let x of cuts[e]) (!q.length || x[1] !== q[q.length - 1][1]) && q.push(x);
    cuts[e] = q;
    for (let k = 1; k < q.length; k++) {
      let a = q[k - 1][1], b = q[k][1];
      if (a === b) continue;
      let key2 = edgeKey2(a, b);
      seen.has(key2) || (seen.add(key2), seg.push([a, b]));
    }
  }
  return { nodes, seg, cuts, eps2 };
}
function boolOcc(op, a, b) {
  return op === "union" ? a || b : op === "difference" ? a && !b : a && b;
}
function groupPairs2(pairs, nA, nB) {
  let byA = Array.from({ length: nA }, () => []), byB = Array.from({ length: nB }, () => []);
  for (let i = 0; i < pairs.length; i++)
    byA[pairs[i].patchA].push(i), byB[pairs[i].patchB].push(i);
  let seen = new Uint8Array(pairs.length), groups = [];
  for (let root = 0; root < pairs.length; root++) if (!seen[root]) {
    let orient0 = pairs[root].sameOrientation, plane = pairs[root].planeKey, q = [root], aids = [], bids = [], sa = new Uint8Array(nA), sb = new Uint8Array(nB);
    seen[root] = 1;
    let valid = !0;
    for (let qi = 0; qi < q.length; qi++) {
      let pr = pairs[q[qi]];
      if (pr.planeKey !== plane || pr.sameOrientation !== orient0) {
        valid = !1;
        break;
      }
      if (!sa[pr.patchA]) {
        sa[pr.patchA] = 1, aids.push(pr.patchA);
        for (let e of byA[pr.patchA]) seen[e] || (seen[e] = 1, q.push(e));
      }
      if (!sb[pr.patchB]) {
        sb[pr.patchB] = 1, bids.push(pr.patchB);
        for (let e of byB[pr.patchB]) seen[e] || (seen[e] = 1, q.push(e));
      }
    }
    groups.push({ valid, orient: orient0, plane, aids, bids });
  }
  return groups;
}
function resolveCoplanar(A, B, ca, cb, op, pairs) {
  let out = { vertices: [], indices: [], consumedFacesA: [], consumedFacesB: [], edgeSplits: [], seamAtoms: [], ambiguous: !1 };
  if (!pairs.length) return { ok: !0, out };
  for (let G of groupPairs2(pairs, ca.patches.length, cb.patches.length)) {
    let emitVertex = function(ni) {
      if (ni >= base) return -1;
      if (emitCache[ni] >= 0) return emitCache[ni];
      let p = nodes[ni], on2 = [];
      for (let e of edges) {
        let q = segD22(p, e.p, e.q);
        q.d <= Math.max(ar.eps2, scale * scale * 1e-18) && on2.push([e, q.t]);
      }
      let ea = null, eb = null, va = -1, vb = -1;
      for (let [e, t] of on2)
        e.owner === 0 ? (ea = e, Math.abs(t) < 1e-9 ? va = e.a : Math.abs(t - 1) < 1e-9 && (va = e.b)) : (eb = e, Math.abs(t) < 1e-9 ? vb = e.a : Math.abs(t - 1) < 1e-9 && (vb = e.b));
      let xyz = unproj2(F, p), r;
      if (va >= 0 && vb >= 0) r = { kind: CoplanarVertexKind2.FeaturePair, featurePair: { approxPosition: xyz, featureA: { kind: FeatureKind.Vertex, id: va }, featureB: { kind: FeatureKind.Vertex, id: vb } } };
      else if (va >= 0 && eb) r = { kind: CoplanarVertexKind2.FeaturePair, featurePair: { approxPosition: xyz, featureA: { kind: FeatureKind.Vertex, id: va }, featureB: { kind: FeatureKind.Edge, id: eb.id } } };
      else if (vb >= 0 && ea) r = { kind: CoplanarVertexKind2.FeaturePair, featurePair: { approxPosition: xyz, featureA: { kind: FeatureKind.Edge, id: ea.id }, featureB: { kind: FeatureKind.Vertex, id: vb } } };
      else if (ea && eb) r = { kind: CoplanarVertexKind2.FeaturePair, featurePair: { approxPosition: xyz, featureA: { kind: FeatureKind.Edge, id: ea.id }, featureB: { kind: FeatureKind.Edge, id: eb.id } } };
      else if (va >= 0) r = { kind: CoplanarVertexKind2.SourceVertexA, sourceVertex: va };
      else if (vb >= 0) r = { kind: CoplanarVertexKind2.SourceVertexB, sourceVertex: vb };
      else return -1;
      let id = out.vertices.length;
      out.vertices.push(r), emitCache[ni] = id;
      for (let [e, t] of on2) t > 1e-9 && t < 1 - 1e-9 && out.edgeSplits.push({ operand: e.owner, sourceEdge: e.id, vertex: id });
      return id;
    };
    if (!G.valid || !G.aids.length || !G.bids.length) return { ok: !1, out };
    let F = frame2(A, ca.patches[G.aids[0]], ca.normal[G.aids[0]]);
    if (!F) return { ok: !1, out };
    let pa = G.aids.map((id) => patch22(A, ca.patches[id], F)), pb = G.bids.map((id) => patch22(B, cb.patches[id], F)), edges = [];
    for (let id of G.aids)
      out.consumedFacesA.push(...ca.patches[id].faces), addEdges2(A, ca.patches[id], F, 0, edges);
    for (let id of G.bids)
      out.consumedFacesB.push(...cb.patches[id].faces), addEdges2(B, cb.patches[id], F, 1, edges);
    let scale = 1;
    for (let e of edges) scale = Math.max(scale, Math.abs(e.p.x), Math.abs(e.p.y), Math.abs(e.q.x), Math.abs(e.q.y));
    let ar = nodeArrangement(edges, scale), nodes = ar.nodes, minx = 1 / 0, miny = 1 / 0, maxx = -1 / 0, maxy = -1 / 0;
    for (let p of nodes)
      minx = Math.min(minx, p.x), miny = Math.min(miny, p.y), maxx = Math.max(maxx, p.x), maxy = Math.max(maxy, p.y);
    let d = Math.max(1, maxx - minx, maxy - miny), base = nodes.length;
    nodes.push({ x: minx - 2 * d, y: miny - 2 * d }, { x: maxx + 2 * d, y: miny - 2 * d }, { x: maxx + 2 * d, y: maxy + 2 * d }, { x: minx - 2 * d, y: maxy + 2 * d });
    let outer = [base, base + 1, base + 2, base + 3], tr = triangulatePSLGCore(nodes, outer, ar.seg);
    if (!tr.ok) return { ok: !1, out };
    let insideA = (p) => pa.some((x) => inPatch2(p, x)), insideB = (p) => pb.some((x) => inPatch2(p, x)), emitCache = new Int32Array(base);
    emitCache.fill(-1);
    let selected = [];
    for (let t of tr.tris) {
      let c = { x: (nodes[t[0]].x + nodes[t[1]].x + nodes[t[2]].x) / 3, y: (nodes[t[0]].y + nodes[t[1]].y + nodes[t[2]].y) / 3 }, a = insideA(c), b = insideB(c), keep = !1, flip = !1;
      if (G.orient ? keep = boolOcc(op, a, b) : op === "union" ? (keep = a !== b, flip = b && !a) : op === "difference" ? keep = a : keep = !1, !keep) continue;
      let ia = emitVertex(t[0]), ib = emitVertex(t[1]), ic = emitVertex(t[2]);
      if (ia < 0 || ib < 0 || ic < 0) return { ok: !1, out };
      selected.push([t[0], t[1], t[2]]), flip ? out.indices.push(ia, ic, ib) : out.indices.push(ia, ib, ic);
    }
    let inc = /* @__PURE__ */ new Map();
    for (let t of selected) for (let e of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]]) {
      let k = edgeKey2(e[0], e[1]), q = inc.get(k);
      q || inc.set(k, q = { n: 0, a: e[0], b: e[1] }), q.n++;
    }
    for (let q of inc.values()) if (q.n === 1) {
      let a = nodes[q.a], b = nodes[q.b], onB = !1;
      for (let e of edges) {
        let da = segD22(a, e.p, e.q), db = segD22(b, e.p, e.q);
        da.d <= scale * scale * 1e-18 && db.d <= scale * scale * 1e-18 && e.owner !== 0 && (onB = !0);
      }
      if (onB) {
        let ia = emitVertex(q.a), ib = emitVertex(q.b);
        ia >= 0 && ib >= 0 && ia !== ib && out.seamAtoms.push({ a: ia, b: ib });
      }
    }
  }
  return out.consumedFacesA = [...new Set(out.consumedFacesA)].sort((a, b) => a - b), out.consumedFacesB = [...new Set(out.consumedFacesB)].sort((a, b) => a - b), { ok: !0, out };
}

 
function resolveCoplanar2(A, B, ca, cb, op, pairs) {
  let f = resolveCoplanarFast(A, B, ca, cb, op, pairs);
  if (f.ok)
    return f.path = "fast", f;
  let g = resolveCoplanar(A, B, ca, cb, op, pairs);
  if (g.ok) {
    let d = buildCoplanarDisplaySeam(A, B, ca, cb, op, pairs);
    d && (g.out.displaySeamPositions = Array.from(d.positions), g.out.displaySeamIndices = Array.from(d.indices));
  }
  return g.path = "generic", g.fastRejected = !0, g;
}

 
var Operation = { Union: 0, Difference: 1, Intersection: 2 }, Label = { Outside: 0, Inside: 1, Ambiguous: -1 }, UINT32_MAX2 = 4294967295, DIRS2 = new Float64Array([
  1,
  0.1732050807568877,
  0.317837245195782,
  0.2718281828459045,
  1,
  0.4142135623730951,
  0.6180339887498948,
  0.233,
  1,
  -1,
  0.3819660112501052,
  0.271,
  0.7071067811865476,
  -1,
  0.2236067977499789,
  0.347,
  0.6180339887498948,
  -1,
  1,
  1,
  0.5773502691896258,
  1,
  -0.7548776662466927,
  0.5698402909980532,
  -0.4384471871911697,
  1,
  0.8982444017039272,
  0.9238795325112867,
  0.3826834323650898,
  -0.611,
  -0.8090169943749475,
  0.5877852522924731,
  0.431,
  0.30901699437494745,
  -0.9510565162951535,
  0.733,
  0.5773502691896258,
  0.5773502691896258,
  0.5773502691896258,
  -0.2672612419124244,
  0.5345224838248488,
  0.8017837257372732,
  0.8728715609439696,
  -0.4364357804719848,
  0.2182178902359924
]), nextPow23 = (n) => {
  let c = 1;
  for (; c < n; ) c *= 2;
  return c;
};
function hash2(a, b) {
  let x = (Math.imul((a ^ 2654435769) >>> 0, 2246822507) ^ Math.imul((b ^ 3266489909) >>> 0, 668265263)) >>> 0;
  return x ^= x >>> 16, x = Math.imul(x, 2146121005), x ^= x >>> 15, x >>> 0;
}
var EdgeSet = class {
  constructor(n = 16) {
    let c = nextPow23(Math.max(16, n * 2));
    this.mask = c - 1, this.used = new Uint8Array(c), this.a = new Uint32Array(c), this.b = new Uint32Array(c);
  }
  add(a, b) {
    if (a > b) {
      let t = a;
      a = b, b = t;
    }
    let s = hash2(a, b) & this.mask;
    for (; this.used[s] && !(this.a[s] === a && this.b[s] === b); ) s = s + 1 & this.mask;
    return this.used[s] ? !1 : (this.used[s] = 1, this.a[s] = a, this.b[s] = b, !0);
  }
  has(a, b) {
    if (a > b) {
      let t = a;
      a = b, b = t;
    }
    let s = hash2(a, b) & this.mask;
    for (; this.used[s]; ) {
      if (this.a[s] === a && this.b[s] === b) return !0;
      s = s + 1 & this.mask;
    }
    return !1;
  }
};
function seamToEdgeSet(seam, nHint) {
  let S = new EdgeSet(nHint);
  for (let k of seam) {
    let p = k.indexOf(","), a = Number(k.slice(0, p)) >>> 0, b = Number(k.slice(p + 1)) >>> 0;
    S.add(a, b);
  }
  return S;
}
function buildFaceTopo(M, off = 0) {
  let fc = M.faceCount, deg = new Uint32Array(fc), cap = nextPow23(fc * 6 + 8), mask = cap - 1, used = new Uint8Array(cap), ea = new Uint32Array(cap), eb = new Uint32Array(cap), f0 = new Int32Array(cap), f1 = new Int32Array(cap);
  f0.fill(-1), f1.fill(-1);
  let tv = M.triV;
  for (let f = 0; f < fc; f++) {
    let o = f * 3;
    for (let e = 0; e < 3; e++) {
      let a = off + tv[o + e], b = off + tv[o + (e + 1) % 3];
      if (a > b) {
        let t = a;
        a = b, b = t;
      }
      let s = hash2(a, b) & mask;
      for (; used[s] && !(ea[s] === a && eb[s] === b); ) s = s + 1 & mask;
      used[s] ? f1[s] < 0 && f0[s] !== f && (f1[s] = f, deg[f0[s]]++, deg[f]++) : (used[s] = 1, ea[s] = a, eb[s] = b, f0[s] = f);
    }
  }
  let adjOff = new Uint32Array(fc + 1);
  for (let f = 0; f < fc; f++) adjOff[f + 1] = adjOff[f] + deg[f];
  let cur = adjOff.slice(0, fc), adj = new Uint32Array(adjOff[fc]);
  for (let s = 0; s < cap; s++) if (used[s] && f0[s] >= 0 && f1[s] >= 0) {
    let w = cur[f0[s]]++;
    adj[w] = f1[s], w = cur[f1[s]]++, adj[w] = f0[s];
  }
  return { cap, mask, used, ea, eb, f0, f1, adjOff, adj };
}
function edgeNeighbor(T, a, b, face) {
  if (a > b) {
    let t = a;
    a = b, b = t;
  }
  let s = hash2(a, b) & T.mask;
  for (; T.used[s]; ) {
    if (T.ea[s] === a && T.eb[s] === b)
      return T.f0[s] === face ? T.f1[s] : T.f1[s] === face ? T.f0[s] : -1;
    s = s + 1 & T.mask;
  }
  return -1;
}
function faceCent(M, f) {
  let o = f * 3, t = M.triV, p = M.pos, a = t[o] * 3, b = t[o + 1] * 3, c = t[o + 2] * 3;
  return [(p[a] + p[b] + p[c]) / 3, (p[a + 1] + p[b + 1] + p[c + 1]) / 3, (p[a + 2] + p[b + 2] + p[c + 2]) / 3];
}
function pieceCent(piece, pool) {
  let a = piece[0] * 3, b = piece[1] * 3, c = piece[2] * 3;
  return [(pool[a] + pool[b] + pool[c]) / 3, (pool[a + 1] + pool[b + 1] + pool[c + 1]) / 3, (pool[a + 2] + pool[b + 2] + pool[c + 2]) / 3];
}
function rayVote(M, ox, oy, oz, dx, dy, dz) {
  let dl = Math.hypot(dx, dy, dz);
  dx /= Math.max(dl, 1e-30), dy /= Math.max(dl, 1e-30), dz /= Math.max(dl, 1e-30);
  let hits = 0, eps = 1e-11, tv = M.triV, p = M.pos;
  for (let t = 0; t < M.triCount; t++) {
    let o = t * 3, ia = tv[o] * 3, ib = tv[o + 1] * 3, ic = tv[o + 2] * 3, ax = p[ia], ay = p[ia + 1], az = p[ia + 2], e1x = p[ib] - ax, e1y = p[ib + 1] - ay, e1z = p[ib + 2] - az, e2x = p[ic] - ax, e2y = p[ic + 1] - ay, e2z = p[ic + 2] - az, px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x, det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-14) continue;
    let inv = 1 / det, sx = ox - ax, sy = oy - ay, sz = oz - az, u = (sx * px + sy * py + sz * pz) * inv;
    if (u < -eps || u > 1 + eps) continue;
    let qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x, v = (dx * qx + dy * qy + dz * qz) * inv;
    if (!(v < -eps || u + v > 1 + eps || (e2x * qx + e2y * qy + e2z * qz) * inv <= 1e-10)) {
      if (u < eps || v < eps || 1 - u - v < eps) return -1;
      hits++;
    }
  }
  return hits & 1;
}
function classifyPoint(M, p) {
  let yes = 0, no = 0;
  for (let i = 0; i < DIRS2.length; i += 3) {
    let v = rayVote(M, p[0], p[1], p[2], DIRS2[i], DIRS2[i + 1], DIRS2[i + 2]);
    v < 0 || (v ? yes++ : no++);
  }
  let n = yes + no;
  if (n < 5) return { label: Label.Ambiguous, confidence: 0 };
  let confidence = Math.abs(yes - no) / n;
  return { label: yes > no ? Label.Inside : Label.Outside, confidence };
}
function callClass(classifier, operand, p, minConf) {
  let r = classifier(operand, p);
  return { inside: r.label === Label.Inside, ambiguous: r.label === Label.Ambiguous || r.confidence < minConf };
}
function classifyActive(M, hit, T, activeFaces, complete, classifier, other, minConf) {
  if (!complete) {
    let id2 = new Int32Array(M.faceCount);
    id2.fill(-1);
    let inside2 = [], q2 = new Uint32Array(M.faceCount), seeds2 = 0, ambiguous2 = !1;
    for (let root = 0; root < M.faceCount; root++) {
      if (hit[root] || id2[root] >= 0) continue;
      let r = callClass(classifier, other, faceCent(M, root), minConf);
      ambiguous2 ||= r.ambiguous;
      let ci = inside2.length;
      inside2.push(r.inside ? 1 : 0), seeds2++;
      let h = 0, n = 0;
      for (q2[n++] = root, id2[root] = ci; h < n; ) {
        let u = q2[h++];
        for (let k = T.adjOff[u]; k < T.adjOff[u + 1]; k++) {
          let v = T.adj[k];
          !hit[v] && id2[v] < 0 && (id2[v] = ci, q2[n++] = v);
        }
      }
    }
    return { id: id2, inside: Uint8Array.from(inside2), seeds: seeds2, ambiguous: ambiguous2 };
  }
  let id = new Int32Array(M.faceCount);
  id.fill(-2);
  let active = new Uint8Array(M.faceCount);
  for (let f of activeFaces) f < M.faceCount && (active[f] = 1);
  for (let f = 0; f < M.faceCount; f++) hit[f] && (active[f] = 1);
  for (let f = 0; f < M.faceCount; f++) active[f] && !hit[f] && (id[f] = -1);
  let inside = [], q = new Uint32Array(M.faceCount), seeds = 0, ambiguous = !1;
  for (let root = 0; root < M.faceCount; root++) {
    if (id[root] !== -1) continue;
    let touchesOutside = !1, h = 0, n = 0, ci = inside.length;
    for (q[n++] = root, id[root] = ci; h < n; ) {
      let u = q[h++];
      for (let k = T.adjOff[u]; k < T.adjOff[u + 1]; k++) {
        let v = T.adj[k];
        if (!hit[v]) {
          if (!active[v]) {
            touchesOutside = !0;
            continue;
          }
          id[v] === -1 && (id[v] = ci, q[n++] = v);
        }
      }
    }
    let lab = !1;
    if (!touchesOutside) {
      let r = callClass(classifier, other, faceCent(M, root), minConf);
      ambiguous ||= r.ambiguous, lab = r.inside, seeds++;
    }
    inside.push(lab ? 1 : 0);
  }
  return { id, inside: Uint8Array.from(inside), seeds, ambiguous };
}
function labelBand(pieces, seam, T, hit, C, pool, classifier, other, minConf) {
  let n = pieces.length;
  if (!n) return { labels: new Uint8Array(0), conflicts: 0, seeds: 0, ambiguous: !1 };
  let need = n * 3, cap = nextPow23(Math.max(16, need * 2)), mask = cap - 1, used = new Uint8Array(cap), ea = new Uint32Array(cap), eb = new Uint32Array(cap), owner = new Int32Array(cap), oe = new Uint8Array(cap), cnt = new Uint8Array(cap), nb = new Int32Array(n * 3), fl = new Uint8Array(n * 3);
  nb.fill(-1), owner.fill(-1);
  let conflicts = 0;
  for (let i = 0; i < n; i++) {
    let p = pieces[i];
    for (let e = 0; e < 3; e++) {
      let a = p[e], b = p[(e + 1) % 3];
      if (a > b) {
        let t = a;
        a = b, b = t;
      }
      let s = hash2(a, b) & mask;
      for (; used[s] && !(ea[s] === a && eb[s] === b); ) s = s + 1 & mask;
      if (!used[s])
        used[s] = 1, ea[s] = a, eb[s] = b, owner[s] = i, oe[s] = e, cnt[s] = 1;
      else if (cnt[s] === 1) {
        let j = owner[s], je = oe[s], f = seam.has(a, b) ? 1 : 0;
        nb[i * 3 + e] = j, fl[i * 3 + e] = f, nb[j * 3 + je] = i, fl[j * 3 + je] = f, cnt[s] = 2;
      } else
        cnt[s]++, conflicts++;
    }
  }
  let lab = new Int8Array(n);
  lab.fill(-1);
  let q = new Uint32Array(n), seeds = 0, ambiguous = !1;
  for (let i = 0; i < n; i++) {
    let p = pieces[i], face = p[3];
    for (let e = 0; e < 3; e++) if (nb[i * 3 + e] < 0) {
      let nf = edgeNeighbor(T, p[e], p[(e + 1) % 3], face);
      if (nf >= 0 && !hit[nf]) {
        let x;
        if (C.id[nf] >= 0) x = C.inside[C.id[nf]];
        else if (C.id[nf] === -2) x = 0;
        else continue;
        lab[i] < 0 ? lab[i] = x : lab[i] !== x && conflicts++;
      }
    }
  }
  for (let root = 0; root < n; root++) if (lab[root] >= 0) {
    let h = 0, z = 0;
    for (q[z++] = root; h < z; ) {
      let u = q[h++];
      for (let e = 0; e < 3; e++) {
        let v = nb[u * 3 + e];
        if (v < 0) continue;
        let x = lab[u] ^ fl[u * 3 + e];
        lab[v] < 0 ? (lab[v] = x, q[z++] = v) : lab[v] !== x && conflicts++;
      }
    }
  }
  for (let root = 0; root < n; root++) if (lab[root] < 0) {
    let r = callClass(classifier, other, pieceCent(pieces[root], pool), minConf);
    ambiguous ||= r.ambiguous, seeds++, lab[root] = r.inside ? 1 : 0;
    let h = 0, z = 0;
    for (q[z++] = root; h < z; ) {
      let u = q[h++];
      for (let e = 0; e < 3; e++) {
        let v = nb[u * 3 + e];
        if (v < 0) continue;
        let x = lab[u] ^ fl[u * 3 + e];
        lab[v] < 0 ? (lab[v] = x, q[z++] = v) : lab[v] !== x && conflicts++;
      }
    }
  }
  return { labels: Uint8Array.from(lab, (x) => x > 0 ? 1 : 0), conflicts, seeds, ambiguous };
}
function boolOccupancy(op, a, b) {
  return op === Operation.Difference ? a && !b : op === Operation.Union ? a || b : a && b;
}
function resolveTwoSided(pieces, pool, op, classifier, minConf, epsRel) {
  let decision = new Uint8Array(pieces.length), queries = 0;
  for (let i = 0; i < pieces.length; i++) {
    let p = pieces[i], ao = p[0] * 3, bo = p[1] * 3, co = p[2] * 3, abx = pool[bo] - pool[ao], aby = pool[bo + 1] - pool[ao + 1], abz = pool[bo + 2] - pool[ao + 2], acx = pool[co] - pool[ao], acy = pool[co + 1] - pool[ao + 1], acz = pool[co + 2] - pool[ao + 2], bcx = pool[co] - pool[bo], bcy = pool[co + 1] - pool[bo + 1], bcz = pool[co + 2] - pool[bo + 2], nx0 = aby * acz - abz * acy, ny0 = abz * acx - abx * acz, nz0 = abx * acy - aby * acx, nl = Math.hypot(nx0, ny0, nz0);
    if (nl <= 1e-24) return { ok: !1, decision, queries };
    let nx = nx0 / nl, ny = ny0 / nl, nz = nz0 / nl, scale = Math.max(Math.hypot(abx, aby, abz), Math.hypot(acx, acy, acz), Math.hypot(bcx, bcy, bcz));
    if (scale <= 1e-15) return { ok: !1, decision, queries };
    let eps = Math.max(1e-15, scale * epsRel), q = pieceCent(p, pool), qm = [q[0] - nx * eps, q[1] - ny * eps, q[2] - nz * eps], qp = [q[0] + nx * eps, q[1] + ny * eps, q[2] + nz * eps], am = classifier(0, qm), bm = classifier(1, qm), ap = classifier(0, qp), bp = classifier(1, qp);
    queries += 4;
    for (let r of [am, bm, ap, bp]) if (r.label === Label.Ambiguous || r.confidence < minConf) return { ok: !1, decision, queries };
    let fm = boolOccupancy(op, am.label === Label.Inside, bm.label === Label.Inside), fp = boolOccupancy(op, ap.label === Label.Inside, bp.label === Label.Inside);
    decision[i] = fm === fp ? 0 : fm && !fp ? 1 : 2;
  }
  return { ok: !0, decision, queries };
}
function compactResult(pool, dsu, indices) {
  let map = new Uint32Array(pool.length / 3);
  map.fill(UINT32_MAX2);
  let outPos = [], outIdx = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) {
    let h = dsu ? dsu.find(indices[i]) : indices[i], q = map[h];
    if (q === UINT32_MAX2) {
      q = outPos.length / 3, map[h] = q;
      let o = h * 3;
      outPos.push(pool[o], pool[o + 1], pool[o + 2]);
    }
    outIdx[i] = q;
  }
  return { positions: Float64Array.from(outPos), indices: outIdx };
}
function compactSeam(pool, dsu, seamAtoms) {
  if (!seamAtoms?.length) return { seamPositions: new Float64Array(0), seamIndices: new Uint32Array(0) };
  let map = new Uint32Array(pool.length / 3);
  map.fill(UINT32_MAX2);
  let pos = [], idx2 = new Uint32Array(seamAtoms.length);
  for (let i = 0; i < seamAtoms.length; i++) {
    let h = dsu ? dsu.find(seamAtoms[i]) : seamAtoms[i], q = map[h];
    if (q === UINT32_MAX2) {
      q = pos.length / 3, map[h] = q;
      let o = h * 3;
      pos.push(pool[o], pool[o + 1], pool[o + 2]);
    }
    idx2[i] = q;
  }
  return { seamPositions: Float64Array.from(pos), seamIndices: idx2 };
}
function combineDisplaySeam(a, cp) {
  let sources = [a, { seamPositions: cp?.displaySeamPositions ?? [], seamIndices: cp?.displaySeamIndices ?? [] }], scale = 1;
  for (let s of sources) for (let v of s.seamPositions ?? []) scale = Math.max(scale, Math.abs(v));
  let eps = Math.max(1e-12, scale * 1e-10), eps2 = eps * eps, inv = 1 / eps, pts = [], buckets = /* @__PURE__ */ new Map(), seg = [], seen = /* @__PURE__ */ new Set(), point = (x, y, z) => {
    let ix = Math.round(x * inv), iy = Math.round(y * inv), iz = Math.round(z * inv);
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      let q2 = buckets.get(`${ix + dx},${iy + dy},${iz + dz}`);
      if (q2)
        for (let id2 of q2) {
          let p = pts[id2], ax = p[0] - x, ay = p[1] - y, az = p[2] - z;
          if (ax * ax + ay * ay + az * az <= eps2) return id2;
        }
    }
    let id = pts.length;
    pts.push([x, y, z]);
    let k = `${ix},${iy},${iz}`, q = buckets.get(k);
    return q || buckets.set(k, q = []), q.push(id), id;
  };
  for (let s of sources) {
    let p = s.seamPositions ?? [], ix = s.seamIndices ?? [];
    for (let i = 0; i + 1 < ix.length; i += 2) {
      let ao = ix[i] * 3, bo = ix[i + 1] * 3;
      if (ao + 2 >= p.length || bo + 2 >= p.length) continue;
      let x = point(p[ao], p[ao + 1], p[ao + 2]), y = point(p[bo], p[bo + 1], p[bo + 2]);
      if (x === y) continue;
      let k = x < y ? `${x},${y}` : `${y},${x}`;
      seen.has(k) || (seen.add(k), seg.push({ a: x, b: y }));
    }
  }
  if (!seg.length) return { seamPositions: new Float64Array(0), seamIndices: new Uint32Array(0) };
  let inc = Array.from({ length: pts.length }, () => []);
  for (let i = 0; i < seg.length; i++)
    inc[seg[i].a].push(i), inc[seg[i].b].push(i);
  let used = new Uint8Array(seg.length), out = [], col = (i, j, v) => {
    let a2 = seg[i].a === v ? seg[i].b : seg[i].a, b = seg[j].a === v ? seg[j].b : seg[j].a, A = pts[a2], V = pts[v], B = pts[b], x1 = A[0] - V[0], y1 = A[1] - V[1], z1 = A[2] - V[2], x2 = B[0] - V[0], y2 = B[1] - V[1], z2 = B[2] - V[2], l1 = x1 * x1 + y1 * y1 + z1 * z1, l2 = x2 * x2 + y2 * y2 + z2 * z2;
    if (l1 <= eps2 || l2 <= eps2) return !1;
    let cx = y1 * z2 - z1 * y2, cy = z1 * x2 - x1 * z2, cz = x1 * y2 - y1 * x2;
    return cx * cx + cy * cy + cz * cz <= l1 * l2 * 1e-20;
  }, walk = (ei, v) => {
    let first = v, e = ei, last = v;
    for (; !used[e]; ) {
      used[e] = 1;
      let z = seg[e], w = z.a === v ? z.b : z.a;
      last = w;
      let q = inc[w];
      if (q.length !== 2) break;
      let ne = q[0] === e ? q[1] : q[0];
      if (used[ne] || !col(e, ne, w)) break;
      v = w, e = ne;
    }
    first !== last && out.push([first, last]);
  };
  for (let i = 0; i < seg.length; i++) if (!used[i]) {
    let z = seg[i], qa = inc[z.a], qb = inc[z.b], sa = qa.length !== 2 || qa.length === 2 && !col(qa[0], qa[1], z.a), sb = qb.length !== 2 || qb.length === 2 && !col(qb[0], qb[1], z.b);
    (sa || sb) && walk(i, sa ? z.a : z.b);
  }
  for (let i = 0; i < seg.length; i++) used[i] || (used[i] = 1, out.push([seg[i].a, seg[i].b]));
  let remap = new Int32Array(pts.length);
  remap.fill(-1);
  let pos = [], idx2 = new Uint32Array(out.length * 2);
  for (let i = 0; i < out.length; i++) for (let e = 0; e < 2; e++) {
    let h = out[i][e], q = remap[h];
    q < 0 && (q = pos.length / 3, remap[h] = q, pos.push(...pts[h])), idx2[i * 2 + e] = q;
  }
  return { seamPositions: Float64Array.from(pos), seamIndices: idx2 };
}
function evaluatePrepared(Aprep, Bprep, op, { profile = !1, forceP32 = -1, p32Policy = "js", tolerantConfidence = 0.6, twoSidedEpsilonRel = 1e-6, classifier = null } = {}) {
  let A = Aprep.mesh ?? Aprep, B = Bprep.mesh ?? Bprep, timing = profile ? {} : null, t0 = profile ? performance.now() : 0, pca = buildPlanarCacheFast(A), pcb = buildPlanarCacheFast(B), t1 = profile ? performance.now() : 0, disc = discover(A, B, { forceP32, p32Policy, profile, planarA: pca, planarB: pcb });
  disc.stats.coplanarPairs = disc.coplanarPairs.length;
  let t2 = profile ? performance.now() : 0, hits = buildDetailedHits(A, B, disc.hitPairs), t3 = profile ? performance.now() : 0, cp = null;
  if (disc.coplanarPairs.length) {
    let copOp = op === Operation.Union ? "union" : op === Operation.Difference ? "difference" : "intersection", rr = resolveCoplanar2(A, B, pca, pcb, copOp, disc.coplanarPairs);
    if (!rr.ok) return { positions: new Float64Array(0), indices: new Uint32Array(0), ambiguous: !0, topologyValid: !1, stats: { coplanarFailed: !0 }, preflightA: Aprep.stats, preflightB: Bprep.stats, discovery: disc.stats };
    cp = rr.out;
  }
  let topo = canonicalizeAndSplit(A, B, hits, { profile, coplanar: cp }), t4 = profile ? performance.now() : 0;
  if (!topo.ok)
    return { positions: new Float64Array(0), indices: new Uint32Array(0), ambiguous: !0, topologyValid: !1, stats: { ...topo.stats }, preflightA: Aprep.stats, preflightB: Bprep.stats, discovery: disc.stats, topology: topo };
  let cl = classifier ?? ((operand, p) => classifyPoint(operand ? B : A, p)), TA = buildFaceTopo(A, 0), TB = buildFaceTopo(B, A.pos.length / 3), t5 = profile ? performance.now() : 0, CA = classifyActive(A, topo.hitA, TA, disc.activeFacesA, !0, cl, 1, tolerantConfidence), CB = classifyActive(B, topo.hitB, TB, disc.activeFacesB, !0, cl, 0, tolerantConfidence), t6 = profile ? performance.now() : 0, seam = seamToEdgeSet(topo.seam, topo.seam.size + 16), SA = labelBand(topo.piecesA, seam, TA, topo.hitA, CA, topo.pool, cl, 1, tolerantConfidence), SB = labelBand(topo.piecesB, seam, TB, topo.hitB, CB, topo.pool, cl, 0, tolerantConfidence), t7 = profile ? performance.now() : 0, bandAmbiguous = SA.ambiguous || SB.ambiguous || SA.conflicts > 0 || SB.conflicts > 0, useTwoSided = !1, sideA = null, sideB = null, twoSidedFallbackPieces = 0, queries = CA.seeds + CB.seeds + SA.seeds + SB.seeds;
  if (bandAmbiguous) {
    let ra = resolveTwoSided(topo.piecesA, topo.pool, op, cl, tolerantConfidence, twoSidedEpsilonRel), rb = resolveTwoSided(topo.piecesB, topo.pool, op, cl, tolerantConfidence, twoSidedEpsilonRel);
    twoSidedFallbackPieces = topo.piecesA.length + topo.piecesB.length, queries += ra.queries + rb.queries, ra.ok && rb.ok && (sideA = ra.decision, sideB = rb.decision, useTwoSided = !0, bandAmbiguous = !1);
  }
  let ambiguous = !!topo.stats.ambiguous || CA.ambiguous || CB.ambiguous || bandAmbiguous, pa = Aprep.stats, pb = Bprep.stats;
  pa && pb && (ambiguous ||= !!(pa.nonManifoldEdges || pb.nonManifoldEdges || pa.windingConflicts || pb.windingConflicts || pa.shellNestingAmbiguous || pb.shellNestingAmbiguous));
  let out = [], outMaterials=[],outSources=[],pushTri=(a,b,c,material,M=null,fi=0)=>{out.push(a,b,c);outMaterials.push(material>>>0);outSources.push(M?(M===A?1:-1)*(M.sourceFaces[fi]+1):0);}, keepA = (in0) => op === Operation.Intersection ? in0 : !in0, keepB = (in0) => op === Operation.Difference ? in0 : op === Operation.Union ? !in0 : in0, ds = topo.dsu, offB = A.pos.length / 3;
  for (let t = 0; t < A.triCount; t++) {
    let f = A.triFace[t];
    if (topo.hitA[f]) continue;
    let inside = !1;
    if (CA.id[f] >= 0 ? inside = !!CA.inside[CA.id[f]] : CA.id[f] === -2 && (inside = !1), keepA(inside)) {
      let o = t * 3;
      pushTri(ds.find(A.triV[o]), ds.find(A.triV[o + 1]), ds.find(A.triV[o + 2]),A.faceMaterial?.[f]??0,A,f);
    }
  }
  for (let t = 0; t < B.triCount; t++) {
    let f = B.triFace[t];
    if (topo.hitB[f]) continue;
    let inside = !1;
    if (CB.id[f] >= 0 ? inside = !!CB.inside[CB.id[f]] : CB.id[f] === -2 && (inside = !1), keepB(inside)) {
      let o = t * 3, a = ds.find(offB + B.triV[o]), b = ds.find(offB + B.triV[o + 1]), c = ds.find(offB + B.triV[o + 2]);
      op === Operation.Difference ? pushTri(a,c,b,B.faceMaterial?.[f]??0,B,f) : pushTri(a,b,c,B.faceMaterial?.[f]??0,B,f);
    }
  }
  if (useTwoSided) {
    for (let i = 0; i < topo.piecesA.length; i++) {
      let d = sideA[i];
      if (!d) continue;
      let p = topo.piecesA[i], a = ds.find(p[0]), b = ds.find(p[1]), c = ds.find(p[2]);
      if (d === 2) {
        let z = b;
        b = c, c = z;
      }
      pushTri(a,b,c,A.faceMaterial?.[p[3]]??0,A,p[3]);
    }
    for (let i = 0; i < topo.piecesB.length; i++) {
      let d = sideB[i];
      if (!d) continue;
      let p = topo.piecesB[i], a = ds.find(p[0]), b = ds.find(p[1]), c = ds.find(p[2]);
      if (d === 2) {
        let z = b;
        b = c, c = z;
      }
      pushTri(a,b,c,B.faceMaterial?.[p[3]]??0,B,p[3]);
    }
  } else {
    for (let i = 0; i < topo.piecesA.length; i++) if (keepA(!!SA.labels[i])) {
      let p = topo.piecesA[i];
      pushTri(ds.find(p[0]),ds.find(p[1]),ds.find(p[2]),A.faceMaterial?.[p[3]]??0,A,p[3]);
    }
    for (let i = 0; i < topo.piecesB.length; i++) if (keepB(!!SB.labels[i])) {
      let p = topo.piecesB[i], a = ds.find(p[0]), b = ds.find(p[1]), c = ds.find(p[2]);
      op === Operation.Difference ? pushTri(a,c,b,B.faceMaterial?.[p[3]]??0,B,p[3]) : pushTri(a,b,c,B.faceMaterial?.[p[3]]??0,B,p[3]);
    }
  }
  for(const t of topo.cpOut){
    const pool=topo.pool,x=(pool[t[0]*3]+pool[t[1]*3]+pool[t[2]*3])/3,y=(pool[t[0]*3+1]+pool[t[1]*3+1]+pool[t[2]*3+1])/3,z=(pool[t[0]*3+2]+pool[t[1]*3+2]+pool[t[2]*3+2])/3;
    const candidates=t[3]||[cp?.consumedFacesA||[],cp?.consumedFacesB||[]];let source=null,face=0,best=Infinity;
    for(let operand=0;operand<2;operand++){
      const M=operand?B:A,p=M.pos;
      for(const f of candidates[operand]){const a=M.triV[f*3]*3,b=M.triV[f*3+1]*3,c=M.triV[f*3+2]*3;
        const distance=pointTriangleDistanceSq(x,y,z,p[a],p[a+1],p[a+2],p[b],p[b+1],p[b+2],p[c],p[c+1],p[c+2]);
        if(distance<best){best=distance;source=M;face=f;}}
      if(best===0)break;
    }
    pushTri(t[0],t[1],t[2],source?.faceMaterial?.[face]??0,source,face);
  }
  let compact = compactResult(topo.pool, ds, out), seamCompact = combineDisplaySeam(compactSeam(topo.pool, ds, topo.nonCoplanarSeamAtoms ?? topo.seamAtoms), cp), t8 = profile ? performance.now() : 0, stats = { ...topo.stats, classifierQueries: queries, twoSidedFallbackPieces, bandConflicts: SA.conflicts + SB.conflicts, outputTriangles: out.length / 3, seamVertices: seamCompact.seamPositions.length / 3, seamSegments: seamCompact.seamIndices.length / 2, useTwoSided };
  return profile && (timing.planar = t1 - t0, timing.discovery = t2 - t1, timing.hits = t3 - t2, timing.topology = t4 - t3, timing.faceTopo = t5 - t4, timing.classify = t6 - t5, timing.band = t7 - t6, timing.assembly = t8 - t7, timing.total = t8 - t0, stats.timing = timing), { ...compact, ...seamCompact, triangleMaterials:Uint32Array.from(outMaterials), triangleSources:Int32Array.from(outSources), ambiguous, topologyValid: !ambiguous, stats, preflightA: Aprep.stats, preflightB: Bprep.stats, discovery: disc.stats, topology: topo };
}
function evaluate(positionsA, indicesA, positionsB, indicesB, op, options = {}) {
  let A = prepareMeshFlat(positionsA, indicesA, { profile: options.profile,faceMaterials:options.faceMaterialsA }), B = prepareMeshFlat(positionsB, indicesB, { profile: options.profile,faceMaterials:options.faceMaterialsB });
  if(indicesA.length&&!A.mesh.faceCount||indicesB.length&&!B.mesh.faceCount)throw Error('Boolean operand collapsed during mesh preparation');
  if(!A.mesh.faceCount||!B.mesh.faceCount){
    const take=op===Operation.Union?(A.mesh.faceCount?A:B):op===Operation.Difference&&!B.mesh.faceCount?A:null;
    const bad=!!(take&&(take.stats.nonManifoldEdges||take.stats.windingConflicts||take.stats.shellNestingAmbiguous));
    return {positions:take?take.mesh.pos:new Float64Array(0),indices:take?take.mesh.triV:new Uint32Array(0),triangleMaterials:take?Uint32Array.from(take.mesh.faceMaterial||[]):new Uint32Array(0),triangleSources:take?Int32Array.from(take.mesh.sourceFaces,f=>(take===A?1:-1)*(f+1)):new Int32Array(0),ambiguous:bad,topologyValid:!bad,preflightA:A.stats,preflightB:B.stats,stats:{emptyInput:true}};
  }
   
   
  const ba=bounds(A.mesh.pos),bb=bounds(B.mesh.pos),separate=ba.maxx<bb.minx||bb.maxx<ba.minx||ba.maxy<bb.miny||bb.maxy<ba.miny||ba.maxz<bb.minz||bb.maxz<ba.minz;
  if(separate&&[A.stats,B.stats].every(q=>!q.boundaryEdges&&!q.nonManifoldEdges&&!q.windingConflicts&&!q.shellNestingAmbiguous)){
    const parts=op===Operation.Intersection?[]:op===Operation.Difference?[A]:[A,B],vertices=parts.reduce((n,q)=>n+q.mesh.pos.length,0),faces=parts.reduce((n,q)=>n+q.mesh.triV.length,0);
    const positions=new Float64Array(vertices),indices=new Uint32Array(faces),triangleMaterials=new Uint32Array(faces/3),triangleSources=new Int32Array(faces/3);let v=0,f=0;
    for(const q of parts){const M=q.mesh;positions.set(M.pos,v);for(let i=0;i<M.triV.length;i++)indices[f+i]=M.triV[i]+v/3;
      triangleMaterials.set(M.faceMaterial,f/3);for(let i=0;i<M.faceCount;i++)triangleSources[f/3+i]=(q===A?1:-1)*(M.sourceFaces[i]+1);v+=M.pos.length;f+=M.triV.length;}
    return {positions,indices,triangleMaterials,triangleSources,ambiguous:false,topologyValid:true,preflightA:A.stats,preflightB:B.stats,stats:{disjointBounds:true}};
  }
  return evaluatePrepared(A,B,op,options);
}

 
var PAIR_CLASS = Object.freeze({ N: 0, M: 1, S: 2 }), RASTER_MODE = Object.freeze({ AABB: 0, R8: 1, ALL: 2 });
function finiteNumber(v, fallback = 0) {
  return Number.isFinite(v) ? v : fallback;
}
function count(v) {
  return Number.isSafeInteger(v) ? v : finiteNumber(v, 0);
}
function validateMesh(positions, indices, label, { nonEmpty = !0 } = {}) {
  if (!(positions instanceof Float32Array) || positions.length % 3) throw new Error(`${label} positions are invalid`);
  if (!(indices instanceof Uint32Array) || indices.length % 3) throw new Error(`${label} indices are invalid`);
  if (nonEmpty && (!positions.length || !indices.length)) throw new Error("Boolean operands must contain vertices and triangles");
  let vertices = positions.length / 3;
  for (let i = 0; i < positions.length; i++) if (!Number.isFinite(positions[i])) throw new Error(`${label} contains NaN/Inf`);
  for (let i = 0; i < indices.length; i++) if (indices[i] >= vertices) throw new Error(`${label} index is out of range`);
}
function toFloat32(array) {
  return array instanceof Float32Array ? array : Float32Array.from(array || []);
}
function toUint32(array) {
  return array instanceof Uint32Array ? array : Uint32Array.from(array || []);
}
function sumPreflightMs(result) {
  return finiteNumber(result.preflightA?.timing?.total) + finiteNumber(result.preflightB?.timing?.total);
}
function makeDiagnostics(result) {
  let d = result.discovery || {}, s = result.stats || {}, pa = result.preflightA || {}, pb = result.preflightB || {}, t = s.timing || {}, topologyMs = finiteNumber(t.topology), classifyMs = finiteNumber(t.classify), bandMs = finiteNumber(t.band), assemblyMs = finiteNumber(t.assembly);
  return {
    backend: "frame-js-r6",
    topologyValid: !!result.topologyValid,
    ambiguous: !!result.ambiguous,
    grid: count(d.g),
    pairClass: PAIR_CLASS[d.class] ?? null,
    rasterMode: RASTER_MODE[d.mode] ?? null,
    p32: !!d.p32,
    uniquePairs: count(d.uniquePairs),
    aabbPairs: count(d.aabbPairs),
    facePairs: count(d.facePairs),
    exactPairs: count(d.exactPairs),
    segmentHits: count(d.segmentHits),
    coplanarPairs: count(d.coplanarPairs ?? d.coplanarExact),
    coplanarSuppressed: count(d.coplanarSuppressed),
    cutFaces: count(s.cutFaces),
    bandPieces: count(s.bandPieces),
    classifierQueries: count(s.classifierQueries),
    twoSidedPieces: count(s.twoSidedFallbackPieces),
    boundaryA: count(pa.boundaryEdges),
    boundaryB: count(pb.boundaryEdges),
    nonmanifoldA: count(pa.nonManifoldEdges),
    nonmanifoldB: count(pb.nonManifoldEdges),
    windingRepairsA: count(pa.windingRepairs),
    windingRepairsB: count(pb.windingRepairs),
    windingConflictsA: count(pa.windingConflicts),
    windingConflictsB: count(pb.windingConflicts),
    nestAmbA: count(pa.shellNestingAmbiguous),
    nestAmbB: count(pb.shellNestingAmbiguous),
    droppedDegenerateA: count(pa.droppedDegenerate),
    droppedDegenerateB: count(pb.droppedDegenerate),
    droppedDuplicateA: count(pa.droppedDuplicate),
    droppedDuplicateB: count(pb.droppedDuplicate),
    qualityA: count(pa.quality),
    qualityB: count(pb.quality),
    preflightMs: sumPreflightMs(result),
    patchCacheMs: finiteNumber(t.planar),
    discoveryMs: finiteNumber(t.discovery),
    backendMs: topologyMs + finiteNumber(t.faceTopo) + classifyMs + bandMs + assemblyMs,
    compactMs: 0,
    totalMs: finiteNumber(t.total) + sumPreflightMs(result),
    canonicalizeMs: finiteNumber(result.topology?.stats?.timing?.canonicalize, topologyMs),
    classifyMs,
    splitMs: finiteNumber(result.topology?.stats?.timing?.split, topologyMs),
    bandGraphMs: bandMs,
    assemblyMs
  };
}
function rcFor(result) {
  return result.ambiguous ? 2 : result.indices?.length ? 0 : 1;
}
function classifyLabels(positions, indices, points) {
  if (validateMesh(positions, indices, "Classification mesh"), !(points instanceof Float32Array) || points.length % 3) throw new Error("Classification points are invalid");
  let prep = prepareMeshFlat(positions, indices);
  if (!prep.mesh?.faceCount) throw new Error("Classification mesh contains no usable triangles");
  let labels = new Int8Array(points.length / 3);
  for (let i = 0, j = 0; i < points.length; i += 3, j++) {
    let r = classifyPoint(prep.mesh, [points[i], points[i + 1], points[i + 2]]);
    labels[j] = r.label === Label.Inside ? 1 : r.label === Label.Outside ? -1 : 0;
  }
  return labels;
}
async function handleBooleanWorkerMessage(data = {}) {
  if (data.cmd !== "run" && data.cmd !== "planar" && data.cmd !== "classify" && data.cmd !== "surfaceClip") return null;
  try {
    if(data.cmd === "planar"){const result=planarContourBoolean(data.contoursA,data.contoursB,data.op,data.curveSource);return {message:{id:data.id,ok:true,...result},transfer:[]};}
    if (data.cmd === "surfaceClip") {
      if (validateMesh(data.positions, data.indices, "Surface clip mesh"), !(data.points instanceof Float32Array) || data.points.length % 3) throw new Error("Surface clip points are invalid");
      if (!(data.lines instanceof Uint32Array) || data.lines.length % 2) throw new Error("Surface clip line ranges are invalid");
      for (let i = 0; i < data.points.length; i++) if (!Number.isFinite(data.points[i])) throw new Error("Surface clip contains NaN/Inf");
      let steps = Math.max(4, Math.min(256, Math.floor(Number(data.steps) || 32))), refine = Math.max(4, Math.min(32, Math.floor(Number(data.refine) || 16))), tolerance = Math.max(0, Number(data.tolerance) || 0), r = clipPolylineSegments(data.positions, data.indices, data.points, data.lines, tolerance, { steps, refine });
      return { message: { id: data.id, ok: !0, ...r, wasmHeapBytes: 0 }, transfer: [r.lineIds.buffer, r.edgeIds.buffer, r.t.buffer] };
    }
    if (data.cmd === "classify") {
      let labels = classifyLabels(data.positions, data.indices, data.points);
      return { message: { id: data.id, ok: !0, labels, wasmHeapBytes: 0 }, transfer: [labels.buffer] };
    }
    if (validateMesh(data.positionsA, data.indicesA, "Operand A",{nonEmpty:false}), validateMesh(data.positionsB, data.indicesB, "Operand B",{nonEmpty:false}), data.op !== Operation.Union && data.op !== Operation.Difference && data.op !== Operation.Intersection) throw new Error(`Unknown Boolean operation code: ${data.op}`);
    const started=performance.now(),result=evaluate(data.positionsA,data.indicesA,data.positionsB,data.indicesB,data.op,{profile:true,p32Policy:'js',faceMaterialsA:data.faceMaterialsA,faceMaterialsB:data.faceMaterialsB}),wallMilliseconds=performance.now()-started;
    const seamPositions=toFloat32(result.seamPositions),seamIndices=toUint32(result.seamIndices),report=makeDiagnostics(result),rc=rcFor(result);
    const t=performance.now(),expectsClosed=!report.boundaryA&&!report.boundaryB,cleaned=cleanBooleanFloatMesh(toFloat32(result.positions),toUint32(result.indices),expectsClosed,result.triangleMaterials,result.triangleSources);
    const {positions,indices,triangleMaterials}=cleaned,transferTrusted=!cleaned.nonManifoldEdges&&(!expectsClosed||cleaned.topologyValid);
    Object.assign(report,{disjointBounds:!!result.stats?.disjointBounds,postprocessMilliseconds:performance.now()-t,transferTrusted,trusted:!!report.topologyValid&&!report.ambiguous&&transferTrusted,empty:!indices.length,
      postTransfer:{vertices:positions.length/3,triangles:indices.length/3,weldedVertices:cleaned.weldedVertices,tolerance:cleaned.tolerance,droppedDegenerate:cleaned.droppedDegenerate,droppedDuplicate:cleaned.droppedDuplicate,boundaryEdges:cleaned.boundaryEdges,nonManifoldEdges:cleaned.nonManifoldEdges,expectsClosed,fastPath:!!cleaned.fastPath}});
    let cageClip=null;
    if(report.trusted&&indices.length&&data.cagePoints?.length){const startClip=performance.now();cageClip=clipPolylineSegments(positions,indices,data.cagePoints,data.cageLines,cleaned.tolerance,{steps:32,refine:18});report.cageClipMilliseconds=performance.now()-startClip;}
    let render=null;
    if(report.trusted&&indices.length){const t=performance.now();render=prepareBooleanRender(positions,indices,triangleMaterials,cleaned.triangleSources,{positions:data.positionsA,indices:data.indicesA,normals:data.normalsA},{positions:data.positionsB,indices:data.indicesB,normals:data.normalsB},data.creaseCos);report.renderPreparationMilliseconds=performance.now()-t;}
    report.workerTotalMilliseconds=performance.now()-started;
    return {message:{id:data.id,ok:true,rc,wallMilliseconds,positions,indices,faceMaterials:triangleMaterials,seamPositions,seamIndices,report,cageClip,render,wasmHeapBytes:0},
      transfer:[positions.buffer,indices.buffer,triangleMaterials.buffer,seamPositions.buffer,seamIndices.buffer,...(render?[render.positions.buffer,render.normals.buffer,render.indices.buffer,render.source.buffer,render.materialIds.buffer,render.bounds.buffer,render.wire.buffer]:[]),...(cageClip?[cageClip.lineIds.buffer,cageClip.edgeIds.buffer,cageClip.t.buffer]:[])]};
  } catch (error) {
    return { message: { id: data.id, ok: !1, error: error?.message || String(error), wasmHeapBytes: 0 }, transfer: [] };
  }
}

 
self.onmessage = async (event) => {
  let out = await handleBooleanWorkerMessage(event.data || {});
  out && self.postMessage(out.message, out.transfer);
};
