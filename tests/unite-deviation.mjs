// Compare the actual published surfaces. Samples are deterministic and stratified
// by triangle area. A query bin only indexes samples; distances are to triangles.
export function surfaceDeviation({from,to,pitch,count=2048}){
  if(typeof from==='string')from=window.__uniteMeasurements[from];
  if(typeof to==='string')to=window.__uniteMeasurements[to];
  const p=from.vertices,t=from.indices,area=(i)=>{
    const a=3*t[i],b=3*t[i+1],c=3*t[i+2],x=p[b]-p[a],y=p[b+1]-p[a+1],z=p[b+2]-p[a+2];
    const X=p[c]-p[a],Y=p[c+1]-p[a+1],Z=p[c+2]-p[a+2];
    return Math.hypot(y*Z-z*Y,z*X-x*Z,x*Y-y*X);
  };
  let total=0;
  for(let i=0;i<t.length;i+=3)total+=area(i);
  let running=0,seed=0x84160db3;
  const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)+.5)/4294967296;
  const samples=[];
  for(let i=0;i<t.length&&samples.length<count;i+=3){
    const size=area(i);running+=size;
    while(samples.length<count&&(samples.length+.5)*total/count<=running){
      const a=3*t[i],b=3*t[i+1],c=3*t[i+2],x=p[b]-p[a],y=p[b+1]-p[a+1],z=p[b+2]-p[a+2];
      const X=p[c]-p[a],Y=p[c+1]-p[a+1],Z=p[c+2]-p[a+2],u=Math.sqrt(random()),v=random()*u;
      samples.push({x:p[a]+(u-v)*x+v*X,y:p[a+1]+(u-v)*y+v*Y,z:p[a+2]+(u-v)*z+v*Z,
        nx:(y*Z-z*Y)/size,ny:(z*X-x*Z)/size,nz:(x*Y-y*X)/size,dist:Infinity,cos:0});
    }
  }
  const bounds=['x','y','z'].map(k=>Math.min(...samples.map(q=>q[k]))),v=to.vertices,f=to.indices;
  function search(missing,radius){
    const cells=new Map(),bin=12*pitch,r2=radius*radius,code=(x,y,z)=>(x+1024)+4096*((y+1024)+4096*(z+1024));
    const [ox,oy,oz]=bounds;
    for(const q of missing){
      const id=code(Math.floor((q.x-ox)/bin),Math.floor((q.y-oy)/bin),Math.floor((q.z-oz)/bin));
      let row=cells.get(id);if(!row)cells.set(id,row=[]);row.push(q);
    }
    for(let i=0;i<f.length;i+=3){
      const a=3*f[i],b=3*f[i+1],c=3*f[i+2];
      const ax=v[a],ay=v[a+1],az=v[a+2],bx=v[b],by=v[b+1],bz=v[b+2],cx=v[c],cy=v[c+1],cz=v[c+2];
      const x0=Math.min(ax,bx,cx)-radius,y0=Math.min(ay,by,cy)-radius,z0=Math.min(az,bz,cz)-radius;
      const x1=Math.max(ax,bx,cx)+radius,y1=Math.max(ay,by,cy)+radius,z1=Math.max(az,bz,cz)+radius;
      const I=Math.floor((x1-ox)/bin),J=Math.floor((y1-oy)/bin),K=Math.floor((z1-oz)/bin);
      const ux=bx-ax,uy=by-ay,uz=bz-az,vx=cx-ax,vy=cy-ay,vz=cz-az;
      const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,nn=nx*nx+ny*ny+nz*nz;if(!nn)continue;
      const uu=ux*ux+uy*uy+uz*uz,uv=ux*vx+uy*vy+uz*vz,vv=vx*vx+vy*vy+vz*vz;
      for(let k=Math.floor((z0-oz)/bin);k<=K;k++)for(let j=Math.floor((y0-oy)/bin);j<=J;j++)for(let h=Math.floor((x0-ox)/bin);h<=I;h++){
        const row=cells.get(code(h,j,k));if(!row)continue;
        for(const q of row){
          if(q.x<x0||q.y<y0||q.z<z0||q.x>x1||q.y>y1||q.z>z1)continue;
          const x=q.x-ax,y=q.y-ay,z=q.z-az,du=x*ux+y*uy+z*uz,dv=x*vx+y*vy+z*vz;
          const s=(vv*du-uv*dv)/nn,t=(uu*dv-uv*du)/nn,offset=x*nx+y*ny+z*nz;
          let d2=offset*offset/nn;
          if(d2>q.dist||d2>r2)continue;
          if(s<0||t<0||s+t>1){
            const edge=(px,py,pz,dx,dy,dz,l)=>{const r=Math.max(0,Math.min(1,(px*dx+py*dy+pz*dz)/l));
              return (px-r*dx)**2+(py-r*dy)**2+(pz-r*dz)**2;};
            d2=Math.min(edge(x,y,z,ux,uy,uz,uu),edge(x,y,z,vx,vy,vz,vv),
              edge(x-ux,y-uy,z-uz,vx-ux,vy-uy,vz-uz,(vx-ux)**2+(vy-uy)**2+(vz-uz)**2));
          }
          if(d2<=r2&&d2<q.dist){q.dist=d2;q.cos=(nx*q.nx+ny*q.ny+nz*q.nz)/Math.sqrt(nn);}
        }
      }
    }
  }
  let missing=samples;
  for(const scale of [1,3,10,32]){
    search(missing,scale*pitch);missing=missing.filter(q=>!Number.isFinite(q.dist));if(!missing.length)break;
  }
  if(missing.length)throw Error('Unresolved Unite distance samples: '+missing.length);
  const stats=values=>{values.sort((a,b)=>a-b);const at=f=>values[Math.floor((values.length-1)*f)];
    return {median:at(.5),p95:at(.95),p99:at(.99),max:values.at(-1)};};
  return {samples:samples.length,distanceMm:stats(samples.map(q=>Math.sqrt(q.dist))),
    normalDegrees:stats(samples.map(q=>Math.acos(Math.max(-1,Math.min(1,q.cos)))*180/Math.PI))};
}
