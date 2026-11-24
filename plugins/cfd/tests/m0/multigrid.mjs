import {gridWGSL} from './fixtures.mjs';
import {gpuBlocks} from './blocks.mjs';

export function openBoundaries(f){
  return `fn openFace(axis:u32,side:i32)->bool{
    return !((${!f.rotor} && axis==0u && side<0)||(${f.name==='ahmed'} && axis==1u && side<0));}`;
}
const ro=(i,s)=>`@group(0) @binding(${i}) var<storage,read> ${s}:array<f32>;`;
const rw=(i,s)=>`@group(0) @binding(${i}) var<storage,read_write> ${s}:array<f32>;`;
export async function pressureMultigrid(gpu,f){
  const levels=[];
  let dims=f.dims;
  while(true){
    const count=dims.reduce((a,b)=>a*b),head=gridWGSL({dims})+openBoundaries(f);
    const body=code=>`@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){let i=g.x;if(i>=CELLS){return;}let p=point(i);${code}}`;
    const rhs=gpu.buffer('CFD level RHS',count*4), p=gpu.buffer('CFD level pressure',count*4), scratch=gpu.buffer('CFD level residual',count*4);
    const group=[Math.ceil(count/128)], stencil=`
      var d=0.;var sum=0.;for(var axis=0u;axis<3u;axis++){var e=vec3i(0);e[axis]=1;
        for(var side=-1;side<=1;side+=2){let j=p+side*e;
          if(inside(j)){d+=1.;sum+=pressure[index(j)];}else if(openFace(axis,side)){d+=2.;}}}
      let residual=b[i]+sum-d*pressure[i];`;
    const op=await gpu.kernel('CFD pressure residual',head+ro(0,'b')+ro(1,'pressure')+rw(2,'out')+body(stencil+'out[i]=residual;'));
    const smooth=await gpu.kernel('CFD weighted Jacobi',head+ro(0,'b')+ro(1,'pressure')+rw(2,'out')+body(stencil+'out[i]=pressure[i]+0.72*residual/d;'));
    const residual=gpu.bind(op,[rhs,p,scratch]),pair=[gpu.bind(smooth,[rhs,p,scratch]),gpu.bind(smooth,[rhs,scratch,p])];
    levels.push({dims,rhs,p,scratch,group,damp(encoder,times){
      for(let i=0;i<times;i++)for(const binding of pair)gpu.dispatch(encoder,smooth,binding,group);
    },residual(encoder){gpu.dispatch(encoder,op,residual,group);}});
    if(dims.some(n=>n%2)||Math.min(...dims)<=4)break;
    dims=dims.map(n=>n/2);
  }
  for(let l=0;l<levels.length-1;l++){
    const fine=levels[l],coarse=levels[l+1],[nx,ny]=fine.dims,[cx,cy,cz]=coarse.dims;
    const restrict=await gpu.kernel('CFD pressure restriction',gridWGSL({dims:coarse.dims})+ro(0,'r')+rw(1,'b')+`
      @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){let i=g.x;if(i>=CELLS){return;}
      let p=2*point(i);var s=0.;for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
        let q=p+vec3i(x,y,z);s+=r[u32(q.x+${nx}*(q.y+${ny}*q.z))];}}}b[i]=0.5*s;}`);
    const prolong=await gpu.kernel('CFD pressure prolongation',gridWGSL({dims:fine.dims})+ro(0,'c')+rw(1,'p')+`
      @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){let i=g.x;if(i>=CELLS){return;}
      let pos=(vec3f(point(i))+0.5)*0.5-0.5;let base=vec3i(floor(pos));let t=fract(pos);var v=0.;
      for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
        let off=vec3i(x,y,z);let q=clamp(base+off,vec3i(0),vec3i(${cx-1},${cy-1},${cz-1}));
        let w=select(1.-t,t,off==vec3i(1));v+=w.x*w.y*w.z*c[u32(q.x+${cx}*(q.y+${cy}*q.z))];}}}p[i]+=v;}`);
    const down=gpu.bind(restrict,[fine.scratch,coarse.rhs]),up=gpu.bind(prolong,[coarse.p,fine.p]);
    fine.down=e=>{gpu.dispatch(e,restrict,down,coarse.group);e.clearBuffer(coarse.p);};
    fine.up=e=>gpu.dispatch(e,prolong,up,fine.group);
  }
  const fine=levels[0],block=await gpuBlocks(gpu,8,f.dims,false);
  const correction=gpu.buffer('CFD Schwarz correction',fine.p.size),bb=block.binding(fine.scratch,correction);
  const add=await gpu.kernel('CFD pressure Schwarz update',ro(0,'z')+rw(1,'p')+`
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){if(g.x<arrayLength(&p)){p[g.x]+=0.75*z[g.x];}}`);
  const addBind=gpu.bind(add,[correction,fine.p]);
  function cycle(e,l){
    const level=levels[l];
    if(l===levels.length-1){level.damp(e,5);return;}
    level.damp(e,1);level.residual(e);level.down(e);cycle(e,l+1);level.up(e);level.damp(e,1);
  }
  return {p:fine.p,rhs:fine.rhs,solve(e){
    fine.residual(e);block.encode(e,bb);gpu.dispatch(e,add,addBind,fine.group);cycle(e,0);
  }};
}
