import {cellCenter,cellWidth} from './rectilinear.mjs';

// Averages span complete sampling windows. The sphere reference is on-axis.
// The Ahmed reference is the downstream extent of the reversed-flow region
// in the symmetry plane, not a zero crossing at an arbitrary body height.
export function wakeLength(f,nx,ny,at){
  if(f.rotor)return null;
  const rear=f.sphere?.04:1.044;
  let length=null;
  for(let j=0;j<ny;j++){
    const y=cellCenter(f,1,j);
    if(f.sphere&&j!==Math.floor(ny/2))continue;
    if(!f.sphere&&(y<.01||y>.338))continue;
    let seen=false,previous=null;
    for(let i=0;i<nx;i++){
      const x=cellCenter(f,0,i);if(x<rear)continue;
      const u=at(i,j);if(!Number.isFinite(u)){previous=null;continue;}
      if(u<0)seen=true;
      if(seen&&previous&&previous.u<0&&u>=0){
        const crossing=previous.x+(x-previous.x)*(-previous.u)/(u-previous.u);
        length=Math.max(length??0,crossing-rear);break;
      }
      // Only the bubble connected to the base belongs to this measurement.
      if(!seen&&x>rear+2*f.h*cellWidth(f,0,i))break;
      previous={x,u};
    }
  }
  return length;
}
export function graphPlane(f,g,u){
  const [nx,ny]=f.dims,span=3*f.h,buckets=new Map();
  for(let i=0;i<u.length;i++){const [x,y,z]=g.pos.subarray(4*i,4*i+3);if(Math.abs(z)>span)continue;
    const bx=Math.floor((x-f.origin[0])/span),by=Math.floor((y-f.origin[1])/span),key=bx+10000*by;
    if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(i);}
  return wakeLength(f,nx,ny,(ix,iy)=>{
    const x=f.origin[0]+(ix+.5)*f.h,y=f.sphere?0:f.origin[1]+(iy+.5)*f.h;
    const bx=Math.floor((x-f.origin[0])/span),by=Math.floor((y-f.origin[1])/span);
    const neighbors=[];
    for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++)for(const i of buckets.get(bx+a+10000*(by+b))??[]){
      const q=4*i,d=(g.pos[q]-x)**2+(g.pos[q+1]-y)**2+g.pos[q+2]**2;
      if(d<span**2)neighbors.push([d,i]);}
    neighbors.sort((a,b)=>a[0]-b[0]);let v=0,w=0;
    for(const [d,i] of neighbors.slice(0,6)){const a=1/Math.max(1e-14,d);v+=a*u[i];w+=a;}
    return w?v/w:null;
  });
}
