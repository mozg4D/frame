import {gridWGSL} from './fixtures.mjs';
import {gpuBlocks} from './blocks.mjs';
import {devicePressureCG} from './pressure-cg.mjs';

export function openBoundaries(f){
  if(f.pressureOpen){
    const mask=f.pressureOpen.reduce((bits,open,i)=>bits|(Number(open)<<i),0);
    return `fn openFace(axis:u32,side:i32)->bool{return (${mask}u&(1u<<(axis*2u+select(0u,1u,side>0))))!=0u;}`;
  }
  return `fn openFace(axis:u32,side:i32)->bool{
    return !((${!f.rotor} && axis==0u && side<0)||(${f.name==='ahmed'} && axis==1u && side<0));}`;
}
const ro=(i,s)=>`@group(0) @binding(${i}) var<storage,read> ${s}:array<f32>;`;
const rw=(i,s)=>`@group(0) @binding(${i}) var<storage,read_write> ${s}:array<f32>;`;
// Reused by residual evaluation, multigrid and the Krylov operator.
const weightedRow=`fn pressureRow(i:u32)->vec2f{
  let p=point(i);let pi=pressure[i];var diagonal=0.;var value=0.;
  for(var axis=0u;axis<3u;axis++){var unit=vec3i(0);unit[axis]=1;
    for(var side=-1;side<=1;side+=2){let neighbour=p+side*unit;
      if(inside(neighbour)){let j=index(neighbour);let c=mobility[select(j,i,side>0)][axis];
        diagonal+=c;value+=c*(pi-pressure[j]);}
      else if(openFace(axis,side)){diagonal+=2.;value+=2.*pi;}}}
  return vec2f(diagonal,value);}`;
export async function pressureMultigrid(gpu,f,faceMobility){
  const levels=[];
  let dims=f.dims;
  while(true){
    const count=dims.reduce((a,b)=>a*b),head=gridWGSL({dims})+openBoundaries(f);
    const body=code=>`@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){let i=g.x;if(i>=CELLS){return;}let p=point(i);${code}}`;
    const rhs=gpu.buffer('CFD level RHS',count*4), p=gpu.buffer('CFD level pressure',count*4), scratch=gpu.buffer('CFD level residual',count*4);
    const weight=levels.length?gpu.buffer('CFD level face mobility',count*16):faceMobility;
    const group=[Math.ceil(count/128)],stencil='let row=pressureRow(i);let d=row.x;let residual=b[i]-row.y;let pi=pressure[i];';
    const buffers=head+ro(0,'b')+ro(1,'pressure')+rw(2,'out')+'@group(0) @binding(3) var<storage,read> mobility:array<vec4f>;'+weightedRow;
    const op=await gpu.kernel('CFD immersed pressure residual',buffers+body(stencil+'out[i]=select(0.,residual,d>0.);'));
    const smooth=await gpu.kernel('CFD immersed Jacobi',buffers+body(stencil+'if(d>0.){out[i]=pi+0.72*residual/d;}else{out[i]=0.;}'));
    const residual=gpu.bind(op,[rhs,p,scratch,weight]),pair=[gpu.bind(smooth,[rhs,p,scratch,weight]),gpu.bind(smooth,[rhs,scratch,p,weight])];
    levels.push({dims,rhs,p,scratch,weight,group,damp(encoder,times){
      for(let i=0;i<times;i++)for(const binding of pair)gpu.dispatch(encoder,smooth,binding,group);
    },residual(encoder){gpu.dispatch(encoder,op,residual,group);}});
    if(dims.some(n=>n%2)||Math.min(...dims)<=4)break;
    dims=dims.map(n=>n/2);
  }
  for(let l=0;l<levels.length-1;l++){
    const fine=levels[l],coarse=levels[l+1],[nx,ny]=fine.dims,[cx,cy,cz]=coarse.dims;
    const geometry=await gpu.kernel('CFD coarsen face mobility',gridWGSL({dims:coarse.dims})+`
      @group(0) @binding(0) var<storage,read> fine:array<vec4f>;
      @group(0) @binding(1) var<storage,read_write> coarse:array<vec4f>;
      @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){let i=g.x;if(i>=CELLS){return;}
        let start=2*point(i);var sum=vec3f(0);
        for(var k=0;k<8;k++){let off=vec3i(k&1,(k>>1)&1,k>>2);let p=start+off;
          sum+=vec3f(off)*fine[u32(p.x+${nx}*(p.y+${ny}*p.z))].xyz;}
        coarse[i]=vec4f(.25*sum,0.);}`);
    const geometryBind=gpu.bind(geometry,[fine.weight,coarse.weight]);
    fine.updateGeometry=e=>gpu.dispatch(e,geometry,geometryBind,coarse.group);
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
  const refine=await devicePressureCG(gpu,fine,block,gridWGSL(f)+openBoundaries(f)+weightedRow);
  return {p:fine.p,rhs:fine.rhs,refine,updateGeometry(e){for(const level of levels)level.updateGeometry?.(e);},solve(e){
    fine.residual(e);block.encode(e,bb);gpu.dispatch(e,add,addBind,fine.group);cycle(e,0);
  }};
}
