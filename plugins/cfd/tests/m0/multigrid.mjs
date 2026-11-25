import {gridWGSL} from './fixtures.mjs';
import {gpuBlocks} from './blocks.mjs';
import {devicePressureCG} from './pressure-cg.mjs';
import {cellWidth,metricBuffer,metricWGSL} from './rectilinear.mjs';
import {separablePressure} from './separable-pressure.mjs';
import {coarseSpectral} from './coarse-spectral.mjs';
import {cutPressureBlocks} from './cut-blocks.mjs';

function pressureBoundarySides(f){
  return f.pressureOpen??[!!f.rotor,true,!(f.name==='ahmed'||f.movingRoad),true,true,true];
}
export function openBoundaries(f){
  const mask=pressureBoundarySides(f).reduce((bits,open,i)=>bits|(Number(open)<<i),0);
  return `fn openFace(axis:u32,side:i32)->bool{return (${mask}u&(1u<<(axis*2u+select(0u,1u,side>0))))!=0u;}`;
}
const ro=(i,s)=>`@group(0) @binding(${i}) var<storage,read> ${s}:array<f32>;`;
const rw=(i,s)=>`@group(0) @binding(${i}) var<storage,read_write> ${s}:array<f32>;`;
// Reused by residual evaluation, multigrid and the Krylov operator.
const weightedRow=integrated=>`fn pressureRow(i:u32)->vec2f{
  let p=point(i);let pi=pressure[i];var diagonal=${integrated?'mobility[i].w':'0.'};var value=diagonal*pi;
  for(var axis=0u;axis<3u;axis++){var unit=vec3i(0);unit[axis]=1;
    for(var side=-1;side<=1;side+=2){let neighbour=p+side*unit;
      if(inside(neighbour)){let j=index(neighbour);let c=mobility[select(j,i,side>0)][axis];
        diagonal+=c;value+=c*(pi-pressure[j]);}
      ${integrated?'':'else if(openFace(axis,side)){diagonal+=2.;value+=2.*pi;}'}}}
  return vec2f(diagonal,value);}`;
const boundaryWeight=`fn boundaryWeight(p:vec3i,width:vec3f,area:vec3f)->f32{
  var diagonal=0.;for(var a=0u;a<3u;a++){
    if((p[a]==0&&openFace(a,-1))||(p[a]+1==DIMS[a]&&openFace(a,1))){diagonal+=2.*area[a]/width[a];}
  }return diagonal;}`;
export async function pressureMultigrid(gpu,f,faceMobility){
  const levels=[],row=weightedRow(!!f.axes);
  let dims=f.dims,axes=f.axes,childAxes=null;
  while(true){
    const count=dims.reduce((a,b)=>a*b),head=gridWGSL({dims})+openBoundaries(f);
    const body=code=>`@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){let i=g.x;if(i>=CELLS){return;}let p=point(i);${code}}`;
    const rhs=gpu.buffer('CFD level RHS',count*4), p=gpu.buffer('CFD level pressure',count*4), scratch=gpu.buffer('CFD level residual',count*4);
    const metric={...f,dims,axes,childAxes};
    const weight=levels.length||axes?gpu.buffer('CFD level face conductance',count*16):faceMobility;
    const group=[Math.ceil(count/128)],stencil='let row=pressureRow(i);let d=row.x;let residual=b[i]-row.y;let pi=pressure[i];';
    const buffers=head+ro(0,'b')+ro(1,'pressure')+rw(2,'out')+'@group(0) @binding(3) var<storage,read> mobility:array<vec4f>;'+row;
    const op=await gpu.kernel('CFD immersed pressure residual',buffers+body(stencil+'out[i]=select(0.,residual,d>0.);'));
    const smooth=await gpu.kernel('CFD immersed Jacobi',buffers+body(stencil+'if(d>0.){out[i]=pi+0.72*residual/d;}else{out[i]=0.;}'));
    const residual=gpu.bind(op,[rhs,p,scratch,weight]),pair=[gpu.bind(smooth,[rhs,p,scratch,weight]),gpu.bind(smooth,[rhs,scratch,p,weight])];
    levels.push({dims,rhs,p,scratch,weight,group,metric,damp(encoder,times){
      for(let i=0;i<times;i++)for(const binding of pair)gpu.dispatch(encoder,smooth,binding,group);
    },residual(encoder){gpu.dispatch(encoder,op,residual,group);}});
    if(dims.some(n=>n%2)||Math.min(...dims)<=4)break;
    dims=dims.map(n=>n/2);childAxes=axes;axes=axes?.map(a=>a.filter((_,i)=>i%2===0));
  }
  let updateFine;
  if(f.axes){
    const code=gridWGSL(f)+openBoundaries(f)+metricWGSL(f)+boundaryWeight+`
      @group(0) @binding(0) var<storage,read> fraction:array<vec4f>;
      @group(0) @binding(1) var<storage,read_write> coeff:array<vec4f>;
      @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) gid:vec3u){let i=gid.x;if(i>=CELLS){return;}
        let p=point(i);let w=cellWidths(p);let area=faceAreas(w);
        let invD=vec3f(axisMetric(0u,p.x).z,axisMetric(1u,p.y).z,axisMetric(2u,p.z).z);
        coeff[i]=vec4f(fraction[i].xyz*area*invD,boundaryWeight(p,w,area));}`;
    const op=await gpu.kernel('CFD integrated face conductance',code),fine=levels[0];
    const bind=gpu.bind(op,[faceMobility,fine.weight],metricBuffer(gpu,f));
    updateFine=e=>gpu.dispatch(e,op,bind,fine.group);
  }
  for(let l=0;l<levels.length-1;l++){
    const fine=levels[l],coarse=levels[l+1],[nx,ny]=fine.dims,[cx,cy,cz]=coarse.dims;
    const geometry=await gpu.kernel('CFD coarsen face mobility',gridWGSL({dims:coarse.dims})+(f.axes?openBoundaries(f)+metricWGSL(coarse.metric)+boundaryWeight:'')+`
      @group(0) @binding(0) var<storage,read> fine:array<vec4f>;
      @group(0) @binding(1) var<storage,read_write> coarse:array<vec4f>;
      @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){let i=g.x;if(i>=CELLS){return;}
        let start=2*point(i);var sum=vec3f(0);
        for(var k=0;k<8;k++){let off=vec3i(k&1,(k>>1)&1,k>>2);let p=start+off;
          sum+=vec3f(off)*fine[u32(p.x+${nx}*(p.y+${ny}*p.z))].xyz;}
        ${f.axes?`let p=point(i);let w=cellWidths(p);
          let ratio=vec3f(axisMetric(0u,p.x).w,axisMetric(1u,p.y).w,axisMetric(2u,p.z).w);
          coarse[i]=vec4f(ratio*sum,boundaryWeight(p,w,faceAreas(w)));`:'coarse[i]=vec4f(.25*sum,0.);'}}`);
    const geometryBind=gpu.bind(geometry,[fine.weight,coarse.weight],metricBuffer(gpu,coarse.metric));
    fine.updateGeometry=e=>gpu.dispatch(e,geometry,geometryBind,coarse.group);
    const restrict=await gpu.kernel('CFD pressure restriction',gridWGSL({dims:coarse.dims})+ro(0,'r')+rw(1,'b')+`
      @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){let i=g.x;if(i>=CELLS){return;}
      let p=2*point(i);var s=0.;for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
        let q=p+vec3i(x,y,z);s+=r[u32(q.x+${nx}*(q.y+${ny}*q.z))];}}}b[i]=${f.axes?'s':'0.5*s'};}`);
    const interpolation=f.axes?metricWGSL(fine.metric)+`
      fn parentCenter(a:u32,j:i32)->f32{let l=axisMetric(a,2*j);let r=axisMetric(a,2*j+1);
        return .5*(l.x-.5*l.y+r.x+.5*r.y);}
      fn coarsePos(p:vec3i)->vec3f{var pos=vec3f(p/2);for(var a=0u;a<3u;a++){let j=p[a]/2;
        let x=axisMetric(a,p[a]).x;let cp=parentCenter(a,j);let k=clamp(j+select(-1,1,x>=cp),0,DIMS[a]/2-1);
        if(k!=j){pos[a]+=f32(k-j)*(x-cp)/(parentCenter(a,k)-cp);}}return pos;}`:
      'fn coarsePos(p:vec3i)->vec3f{return (vec3f(p)+0.5)*0.5-0.5;}';
    const prolong=await gpu.kernel('CFD pressure prolongation',gridWGSL({dims:fine.dims})+interpolation+ro(0,'c')+rw(1,'p')+`
      @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){let i=g.x;if(i>=CELLS){return;}
      let pos=coarsePos(point(i));let base=vec3i(floor(pos));let t=fract(pos);var v=0.;
      for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
        let off=vec3i(x,y,z);let q=clamp(base+off,vec3i(0),vec3i(${cx-1},${cy-1},${cz-1}));
        let w=select(1.-t,t,off==vec3i(1));v+=w.x*w.y*w.z*c[u32(q.x+${cx}*(q.y+${cy}*q.z))];}}}p[i]+=v;}`);
    const down=gpu.bind(restrict,[fine.scratch,coarse.rhs]),up=gpu.bind(prolong,[coarse.p,fine.p],metricBuffer(gpu,fine.metric));
    fine.down=e=>{gpu.dispatch(e,restrict,down,coarse.group);e.clearBuffer(coarse.p);};
    fine.up=e=>gpu.dispatch(e,prolong,up,fine.group);
    if(f.axes&&!f.globalPressure&&l>0){
      const inject=await gpu.kernel('CFD constant coarse correction',gridWGSL({dims:fine.dims})+ro(0,'c')+rw(1,'p')+`
        @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){let i=g.x;if(i>=CELLS){return;}
          let q=point(i)/2;p[i]+=c[u32(q.x+${cx}*(q.y+${cy}*q.z))];}`);
      const group=gpu.bind(inject,[coarse.p,fine.p]);fine.inject=e=>gpu.dispatch(e,inject,group,fine.group);
    }
  }
  const fine=levels[0],block=await gpuBlocks(gpu,8,f.dims,false);
  // One colour reads only itself and neighbours of the other colour.
  // Separate dispatches provide the global ordering between both half-sweeps.
  const colours=[];
  for(let colour=0;colour<2;colour++){
    const code=gridWGSL(f)+openBoundaries(f)+ro(0,'b')+rw(1,'pressure')+
      '@group(0) @binding(2) var<storage,read> mobility:array<vec4f>;'+row+`
      @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
        let i=g.x;if(i>=CELLS){return;}let p=point(i);if(((p.x+p.y+p.z)&1)!=${colour}){return;}
        let row=pressureRow(i);if(row.x>0.){pressure[i]+=(b[i]-row.y)/row.x;}
      }`;
    const op=await gpu.kernel('CFD local pressure defect relaxation',code);
    colours.push([op,gpu.bind(op,[fine.rhs,fine.p,fine.weight])]);
  }
  let cutRelax=null;
  function polish(e){
    for(let pair=0;pair<3;pair++){
      if(pair===1&&cutRelax){cutRelax(e);continue;}
      for(const [op,bindings] of colours)gpu.dispatch(e,op,bindings,fine.group);
    }
  }
  let schwarz;
  if(!f.axes){
    const correction=gpu.buffer('CFD Schwarz correction',fine.p.size),bb=block.binding(fine.scratch,correction);
    const add=await gpu.kernel('CFD pressure Schwarz update',ro(0,'z')+rw(1,'p')+`
      @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){if(g.x<arrayLength(&p)){p[g.x]+=0.75*z[g.x];}}`);
    const addBind=gpu.bind(add,[correction,fine.p]);
    schwarz=e=>{fine.residual(e);block.encode(e,bb);gpu.dispatch(e,add,addBind,fine.group);};
  }
  function cycle(e,l,symmetric=false){
    const level=levels[l];
    if(l===levels.length-1){level.damp(e,5);return;}
    level.damp(e,1);level.residual(e);level.down(e);cycle(e,l+1,symmetric);
    if(symmetric)level.inject(e);else level.up(e);level.damp(e,1);
  }
  // PCG needs adjoint transfers. Sum the extensive residual and inject its
  // coarse correction, with identical symmetric pre- and post-smoothing.
  // The equilibrated block inverse supplies the complementary local solve.
  async function coarseCorrection(pair,z){
    const c=levels[1],[cx,cy]=c.dims,[nx,ny]=fine.dims;
    const restrict=await gpu.kernel('CFD coarse Krylov residual',gridWGSL({dims:c.dims})+
      '@group(0) @binding(0) var<storage,read> pair:array<vec2f>;'+rw(1,'b')+`
      @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){let i=g.x;if(i>=CELLS){return;}
        let start=2*point(i);var r=0.;for(var k=0;k<8;k++){let q=start+vec3i(k&1,(k>>1)&1,k>>2);
          r+=pair[u32(q.x+${nx}*(q.y+${ny}*q.z))].x;}b[i]=r;}`);
    const add=await gpu.kernel('CFD combined block and global pressure correction',gridWGSL(f)+ro(0,'c')+
      '@group(0) @binding(1) var<storage,read> pair:array<vec2f>;'+rw(2,'z')+`
      @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){let i=g.x;if(i>=CELLS){return;}
        let q=point(i)/2;let s=pair[i].y;if(s>0.){z[i]+=c[u32(q.x+${cx}*(q.y+${cy}*q.z))]/s;}}`);
    const down=gpu.bind(restrict,[pair,c.rhs]),up=gpu.bind(add,[c.p,pair,z]);
    return e=>{gpu.dispatch(e,restrict,down,c.group);e.clearBuffer(c.p);cycle(e,1,true);gpu.dispatch(e,add,up,fine.group);};
  }
  async function globalCorrection(pair,z){
    const widths=f.dims.map((n,k)=>Array.from({length:n},(_,i)=>cellWidth(f,k,i)));
    if(f.coarseSpectral)return (await coarseSpectral(gpu,widths,pressureBoundarySides(f))).binding(pair,z);
    const inverse=await separablePressure(gpu,f.dims,widths,pressureBoundarySides(f));
    const field=gpu.buffer('CFD global Krylov correction',fine.p.size),apply=inverse.binding(fine.scratch,field);
    const pairField='@group(0) @binding(0) var<storage,read> pair:array<vec2f>;';
    const unpack=await gpu.kernel('CFD integrated global residual',pairField+rw(1,'r')+`
      @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){if(g.x<arrayLength(&r)){r[g.x]=pair[g.x].x;}}`);
    const combine=await gpu.kernel('CFD global plus local pressure correction',pairField+ro(1,'corr')+rw(2,'z')+`
      @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){let i=g.x;if(i<arrayLength(&z)){
        let s=pair[i].y;if(s>0.){z[i]+=corr[i]/s;}}}`);
    const before=gpu.bind(unpack,[pair,fine.scratch]),after=gpu.bind(combine,[pair,field,z]);
    const stages=[{kind:'global residual',encode:e=>gpu.dispatch(e,unpack,before,fine.group)},
      ...apply.stages,{kind:'combine pressure corrections',encode:e=>gpu.dispatch(e,combine,after,fine.group)}];
    return Object.assign(e=>{for(const op of stages)op.encode(e);},{stages});
  }
  const pre=f.globalPressure?globalCorrection:f.axes&&levels.length>1?coarseCorrection:null;
  let cut=null;
  if(f.cutCells&&updateFine){
    const e=gpu.device.createCommandEncoder();updateFine(e);gpu.device.queue.submit([e.finish()]);
    cut=await cutPressureBlocks(gpu,f,faceMobility,fine.weight);
    if(cut?.smoother)cutRelax=await cut.smoother(fine.rhs,fine.p);
  }
  const local=cut?{
    binding(r,z){return {regular:block.binding(r,z),cut:cut.binding(r,z)};},
    encode(e,b){block.encode(e,b.regular);b.cut(e);}
  }:block;
  const refine=await devicePressureCG(gpu,fine,local,gridWGSL(f)+openBoundaries(f)+row,pre);
  return {p:fine.p,rhs:fine.rhs,refine,polish,cutRelax,cutBlocks:cut?.count??0,updateGeometry(e){updateFine?.(e);for(const level of levels)level.updateGeometry?.(e);},solve(e){
    schwarz?.(e);cycle(e,0);
  }};
}
