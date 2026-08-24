// Display-only final-surface membership index for inherited Boolean cage primitives.
// This is NOT an intersection provider and does not participate in R2 topology.
// It answers whether query points lie within tolerance of the final triangle surface.

const clamp=(v,a,b)=>v<a?a:(v>b?b:v);
function pointTriangleDistanceSq(px,py,pz,ax,ay,az,bx,by,bz,cx,cy,cz){
  const abx=bx-ax,aby=by-ay,abz=bz-az,acx=cx-ax,acy=cy-ay,acz=cz-az,apx=px-ax,apy=py-ay,apz=pz-az;
  const d1=abx*apx+aby*apy+abz*apz,d2=acx*apx+acy*apy+acz*apz;
  if(d1<=0&&d2<=0)return apx*apx+apy*apy+apz*apz;
  const bpx=px-bx,bpy=py-by,bpz=pz-bz,d3=abx*bpx+aby*bpy+abz*bpz,d4=acx*bpx+acy*bpy+acz*bpz;
  if(d3>=0&&d4<=d3)return bpx*bpx+bpy*bpy+bpz*bpz;
  const vc=d1*d4-d3*d2;
  if(vc<=0&&d1>=0&&d3<=0){const v=d1/(d1-d3),qx=ax+v*abx,qy=ay+v*aby,qz=az+v*abz,dx=px-qx,dy=py-qy,dz=pz-qz;return dx*dx+dy*dy+dz*dz;}
  const cpx=px-cx,cpy=py-cy,cpz=pz-cz,d5=abx*cpx+aby*cpy+abz*cpz,d6=acx*cpx+acy*cpy+acz*cpz;
  if(d6>=0&&d5<=d6)return cpx*cpx+cpy*cpy+cpz*cpz;
  const vb=d5*d2-d1*d6;
  if(vb<=0&&d2>=0&&d6<=0){const w=d2/(d2-d6),qx=ax+w*acx,qy=ay+w*acy,qz=az+w*acz,dx=px-qx,dy=py-qy,dz=pz-qz;return dx*dx+dy*dy+dz*dz;}
  const va=d3*d6-d5*d4;
  if(va<=0&&(d4-d3)>=0&&(d5-d6)>=0){const w=(d4-d3)/((d4-d3)+(d5-d6)),qx=bx+w*(cx-bx),qy=by+w*(cy-by),qz=bz+w*(cz-bz),dx=px-qx,dy=py-qy,dz=pz-qz;return dx*dx+dy*dy+dz*dz;}
  const den=1/(va+vb+vc),v=vb*den,w=vc*den,qx=ax+abx*v+acx*w,qy=ay+aby*v+acy*w,qz=az+abz*v+acz*w,dx=px-qx,dy=py-qy,dz=pz-qz;
  return dx*dx+dy*dy+dz*dz;
}
function bounds(pos){let minx=Infinity,miny=Infinity,minz=Infinity,maxx=-Infinity,maxy=-Infinity,maxz=-Infinity;for(let i=0;i<pos.length;i+=3){const x=pos[i],y=pos[i+1],z=pos[i+2];if(x<minx)minx=x;if(y<miny)miny=y;if(z<minz)minz=z;if(x>maxx)maxx=x;if(y>maxy)maxy=y;if(z>maxz)maxz=z;}return{minx,miny,minz,maxx,maxy,maxz};}
function chooseGrid(triCount){return clamp(Math.ceil(Math.cbrt(Math.max(1,triCount))*1.6),8,96);}
function rangesFor(pos,idx,g,B,pad,out){const sx=g/Math.max(B.maxx-B.minx,1e-30),sy=g/Math.max(B.maxy-B.miny,1e-30),sz=g/Math.max(B.maxz-B.minz,1e-30);let postings=0,maxCells=0;for(let t=0;t<idx.length;t+=3){let ax=Infinity,ay=Infinity,az=Infinity,bx=-Infinity,by=-Infinity,bz=-Infinity;for(let k=0;k<3;k++){const o=idx[t+k]*3,x=pos[o],y=pos[o+1],z=pos[o+2];if(x<ax)ax=x;if(y<ay)ay=y;if(z<az)az=z;if(x>bx)bx=x;if(y>by)by=y;if(z>bz)bz=z;}const q=t*2,o=t*2; // t is index offset; triangle id is t/3
    const ti=t/3,r=ti*6,x0=clamp(Math.floor((ax-pad-B.minx)*sx),0,g-1),x1=clamp(Math.floor((bx+pad-B.minx)*sx),0,g-1),y0=clamp(Math.floor((ay-pad-B.miny)*sy),0,g-1),y1=clamp(Math.floor((by+pad-B.miny)*sy),0,g-1),z0=clamp(Math.floor((az-pad-B.minz)*sz),0,g-1),z1=clamp(Math.floor((bz+pad-B.minz)*sz),0,g-1),n=(x1-x0+1)*(y1-y0+1)*(z1-z0+1);out[r]=x0;out[r+1]=x1;out[r+2]=y0;out[r+3]=y1;out[r+4]=z0;out[r+5]=z1;postings+=n;if(n>maxCells)maxCells=n;}
  return{postings,maxCells,sx,sy,sz};
}
export function buildSurfaceIndex(positions,indices,tolerance=0){
  const triCount=indices.length/3,B=bounds(positions),extent=Math.max(1,B.maxx-B.minx,B.maxy-B.miny,B.maxz-B.minz),tol=Math.max(1e-7,Number.isFinite(tolerance)?tolerance:0,extent*1e-7),pad=tol*1.01;
  B.minx-=pad;B.miny-=pad;B.minz-=pad;B.maxx+=pad;B.maxy+=pad;B.maxz+=pad;
  let g=chooseGrid(triCount),ranges=new Uint16Array(triCount*6),meta;
  // Avoid pathological skinny-triangle posting explosions. Coarser grids are still exact because AABBs remain conservative.
  while(true){meta=rangesFor(positions,indices,g,B,pad,ranges);const cap=Math.max(2_000_000,triCount*96);if(meta.postings<=cap||g<=8)break;g=Math.max(8,Math.floor(g*.7));}
  const N=g*g*g,count=new Uint32Array(N),G2=g*g;
  for(let t=0;t<triCount;t++){const r=t*6;for(let z=ranges[r+4];z<=ranges[r+5];z++)for(let y=ranges[r+2];y<=ranges[r+3];y++){let c=z*G2+y*g+ranges[r];for(let x=ranges[r];x<=ranges[r+1];x++,c++)count[c]++;}}
  const off=new Uint32Array(N+1);for(let i=0;i<N;i++)off[i+1]=off[i]+count[i];const cur=off.slice(0,N),post=new Uint32Array(off[N]);
  for(let t=0;t<triCount;t++){const r=t*6;for(let z=ranges[r+4];z<=ranges[r+5];z++)for(let y=ranges[r+2];y<=ranges[r+3];y++){let c=z*G2+y*g+ranges[r];for(let x=ranges[r];x<=ranges[r+1];x++,c++)post[cur[c]++]=t;}}
  return{positions,indices,triCount,g,G2,B,sx:meta.sx,sy:meta.sy,sz:meta.sz,off,post,tolerance:tol,tol2:tol*tol,postings:post.length};
}
export function surfaceContainsPoint(S,px,py,pz){const B=S.B;if(px<B.minx||px>B.maxx||py<B.miny||py>B.maxy||pz<B.minz||pz>B.maxz)return false;const x=clamp(Math.floor((px-B.minx)*S.sx),0,S.g-1),y=clamp(Math.floor((py-B.miny)*S.sy),0,S.g-1),z=clamp(Math.floor((pz-B.minz)*S.sz),0,S.g-1),cell=z*S.G2+y*S.g+x,p=S.positions,ix=S.indices;for(let q=S.off[cell];q<S.off[cell+1];q++){const t=S.post[q]*3,ia=ix[t]*3,ib=ix[t+1]*3,ic=ix[t+2]*3;if(pointTriangleDistanceSq(px,py,pz,p[ia],p[ia+1],p[ia+2],p[ib],p[ib+1],p[ib+2],p[ic],p[ic+1],p[ic+2])<=S.tol2)return true;}return false;}
export function surfaceMask(positions,indices,points,tolerance=0){const S=buildSurfaceIndex(positions,indices,tolerance),mask=new Uint8Array(points.length/3);for(let i=0,j=0;i<points.length;i+=3,j++)mask[j]=surfaceContainsPoint(S,points[i],points[i+1],points[i+2])?1:0;return{mask,grid:S.g,postings:S.postings,tolerance:S.tolerance};}

function lerp3(points,a,b,t){const ao=a*3,bo=b*3,s=1-t;return[points[ao]*s+points[bo]*t,points[ao+1]*s+points[bo+1]*t,points[ao+2]*s+points[bo+2]*t];}
function stateAt(S,points,a,b,t){const p=lerp3(points,a,b,t);return surfaceContainsPoint(S,p[0],p[1],p[2]);}
function transitionT(S,points,a,b,lo,hi,stateLo,iterations){for(let i=0;i<iterations;i++){const m=(lo+hi)*.5,s=stateAt(S,points,a,b,m);if(s===stateLo)lo=m;else hi=m;}return(lo+hi)*.5;}
export function clipPolylineSegments(positions,indices,points,lines,tolerance=0,{steps=32,refine=16}={}){
  if(!(points instanceof Float32Array)||points.length%3)throw new Error('Surface clip points are invalid');
  if(!(lines instanceof Uint32Array)||lines.length%2)throw new Error('Surface clip line ranges are invalid');
  const S=buildSurfaceIndex(positions,indices,tolerance),lineIds=[],edgeIds=[],ts=[];let probes=0,transitions=0;
  for(let li=0;li<lines.length;li+=2){const line=li/2,start=lines[li],count=lines[li+1];if(count<2||start+count>points.length/3)continue;for(let e=0;e<count-1;e++){
    const a=start+e,b=a+1,st=new Uint8Array(steps+1);for(let k=0;k<=steps;k++){st[k]=stateAt(S,points,a,b,k/steps)?1:0;probes++;}
    for(let k=0;k<steps;k++){let t0=k/steps,t1=(k+1)/steps,s0=!!st[k],s1=!!st[k+1];if(!s0&&!s1)continue;if(!s0&&s1){t0=transitionT(S,points,a,b,t0,t1,false,refine);transitions++;}else if(s0&&!s1){t1=transitionT(S,points,a,b,t0,t1,true,refine);transitions++;}if(t1>t0){lineIds.push(line);edgeIds.push(e);ts.push(t0,t1);}}
  }}
  return{lineIds:Uint32Array.from(lineIds),edgeIds:Uint32Array.from(edgeIds),t:Float32Array.from(ts),grid:S.g,postings:S.postings,tolerance:S.tolerance,probes,transitions};
}
