import {cellCenter,cellWidth} from '../../plugin.js';

// Sample at physical streamwise stations. Keep the actual vertical coordinates
// so the tunnel boundary layer and wake can be compared with independent LDA.
export function tunnelProfiles(f,axialVelocity){
  const [nx,ny]=f.dims;
  return [-.4,1.044+.08,1.044+.16,1.044+.24].map(xM=>{
    let left=0;
    while(left+1<nx&&cellCenter(f,0,left+1)<xM)left++;
    if(left+1>=nx||xM<cellCenter(f,0,left))throw Error('Wake station is outside the sampled tunnel');
    const x0=cellCenter(f,0,left),x1=cellCenter(f,0,left+1),t=(xM-x0)/(x1-x0);
    const profile=Array.from({length:ny},(_,j)=>({heightM:cellCenter(f,1,j),
      uOverU:((1-t)*axialVelocity(left,j)+t*axialVelocity(left+1,j))/f.U}));
    return {xM,profile};
  });
}

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
export function graphWakeSampler(f,g){
  const [nx,ny]=f.dims,span=3*f.h,buckets=new Map(),cache=new Map();
  for(let j=0;j<g.pos.length;j+=4){const x=g.pos[j],y=g.pos[j+1],z=g.pos[j+2];if(Math.abs(z)>span)continue;
    const bx=Math.floor((x-f.origin[0])/span),by=Math.floor((y-f.origin[1])/span),key=bx+10000*by;
    if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(j/4);}
  function stencil(ix,iy){
    const key=ix+nx*iy;if(cache.has(key))return cache.get(key);
    const x=f.origin[0]+(ix+.5)*f.h,y=f.sphere?0:f.origin[1]+(iy+.5)*f.h;
    const bx=Math.floor((x-f.origin[0])/span),by=Math.floor((y-f.origin[1])/span);
    const neighbors=[];
    for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++)for(const i of buckets.get(bx+a+10000*(by+b))??[]){
      const q=4*i,d=(g.pos[q]-x)**2+(g.pos[q+1]-y)**2+g.pos[q+2]**2;
      if(d<span**2)neighbors.push([d,i]);}
    neighbors.sort((a,b)=>a[0]-b[0]);const weighted=neighbors.slice(0,6).map(([d,i])=>[1/Math.max(1e-14,d),i]);
    cache.set(key,weighted);return weighted;
  }
  return (mean,steps,previous)=>wakeLength(f,nx,ny,(ix,iy)=>{
    const total=steps+(previous?.steps??0);let v=0,w=0;
    for(const [a,i] of stencil(ix,iy)){w+=a;v+=a*(mean[i]+(previous?.mean[i]??0));}
    return w?v/(w*total):null;
  });
}
