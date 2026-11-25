import {separablePressure} from './separable-pressure.mjs';
import {gridWGSL} from './fixtures.mjs';

// Interpolate cell-centred pressure in physical coordinates, continuing a
// homogeneous Dirichlet or Neumann condition at each exterior face. Store
// the transpose of these very same weights for the integrated flux residual.
export function pressureTransfers(width,leftOpen,rightOpen){
  if(width.length<4||width.length%2)throw Error('The coarse pressure correction needs paired fine cells');
  const n=width.length,coarseWidth=[],fine=[],coarse=[];let x=0;
  for(let j=0;j<n;j+=2){
    const a=width[j],b=width[j+1];if(!(a>0&&b>0))throw Error('Invalid width in the coarse pressure correction');
    fine.push(x+.5*a,x+a+.5*b);coarse.push(x+.5*(a+b));coarseWidth.push(a+b);x+=a+b;
  }
  const forward=[],transpose=coarse.map(()=>[]);
  for(const [i,v] of fine.entries()){
    const parent=i>>1,side=v<coarse[parent]?-1:1,other=parent+side;
    const boundary=side<0?0:x,open=side<0?leftOpen:rightOpen;
    const outside=other<0||other>=coarse.length,neighbour=outside?boundary:coarse[other];
    const part=outside&&!open?0:(v-coarse[parent])/(neighbour-coarse[parent]);
    const row=[[parent,1-part]];if(!outside&&part)row.push([other,part]);
    forward.push(row);for(const [j,w] of row)transpose[j].push([i,w]);
  }
  return {forward,transpose,width:coarseWidth};
}

function packedRows(rows){
  const data=new ArrayBuffer(rows.length*32),index=new Uint32Array(data),weight=new Float32Array(data);
  for(const [i,row] of rows.entries()){
    if(row.length>4)throw Error('Paired pressure interpolation exceeds its one-dimensional support');
    for(const [j,[col,w]] of row.entries()){index[8*i+j]=col;weight[8*i+4+j]=w;}
  }
  return new Uint8Array(data);
}
const rowWGSL='struct Row{idx:vec4u,w:vec4f} @group(0) @binding(2) var<storage,read> rows:array<Row>;';
const groups=d=>[Math.ceil(d.reduce((a,b)=>a*b)/128)];
function transferKernel(dims,other,perAxis,expression){
  const [nx,ny]=dims,[ox,oy]=other;
  return gridWGSL({dims})+rowWGSL+`
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
      let i=g.x;if(i>=CELLS){return;}let p=vec3u(point(i));
      let x=rows[p.x];let y=rows[${nx}u+p.y];let z=rows[${nx+ny}u+p.z];var v=0.;
      for(var k=0u;k<${perAxis}u;k++){for(var b=0u;b<${perAxis}u;b++){for(var a=0u;a<${perAxis}u;a++){
        let w=x.w[a]*y.w[b]*z.w[k];let j=x.idx[a]+${ox}u*(y.idx[b]+${oy}u*z.idx[k]);
        v+=w*${perAxis===4?'pair[j].x':'pressure[j]'};
      }}}${expression}
    }`;
}

// Fine blocks and cut-wall solves cover the short modes. The global additive
// term P A_box^-1 P^T only transforms the coarser grid, including the actual
// paired widths and reservoirs. Equilibration belongs to the outer PCG.
export async function coarseSpectral(gpu,widths,boundary){
  const axes=widths.map((w,a)=>pressureTransfers(w,boundary[2*a],boundary[2*a+1]));
  const dims=widths.map(w=>w.length),coarse=axes.map(a=>a.width.length),bytes=4*coarse.reduce((a,b)=>a*b);
  const rhs=gpu.buffer('CFD coarse spectral flux residual',bytes),out=gpu.buffer('CFD coarse spectral pressure',bytes);
  const prolong=gpu.buffer('CFD physical pressure interpolation',packedRows(axes.flatMap(a=>a.forward)));
  const restrict=gpu.buffer('CFD transposed pressure interpolation',packedRows(axes.flatMap(a=>a.transpose)));
  const pairDecl='@group(0) @binding(0) var<storage,read> pair:array<vec2f>;';
  const down=await gpu.kernel('CFD adjoint coarse spectral restriction',pairDecl+
    '@group(0) @binding(1) var<storage,read_write> rhs:array<f32>;'+transferKernel(coarse,dims,4,'rhs[i]=v;'));
  const up=await gpu.kernel('CFD additive coarse spectral prolongation',pairDecl+
    '@group(0) @binding(1) var<storage,read> pressure:array<f32>; @group(0) @binding(3) var<storage,read_write> out:array<f32>;'+
    transferKernel(dims,coarse,2,'let scale=pair[i].y;if(scale>0.){out[i]+=v/scale;}'));
  const inverse=await separablePressure(gpu,coarse,axes.map(a=>a.width),boundary),apply=inverse.binding(rhs,out);
  return {dims:coarse,binding(pair,result){
    const r=gpu.bind(down,[pair,rhs,restrict]),p=gpu.bind(up,[pair,out,prolong,result]);
    const stages=[{kind:'restrict pressure residual to the spectral grid',encode:e=>gpu.dispatch(e,down,r,groups(coarse))},
      ...apply.stages,{kind:'prolong coarse spectral pressure',encode:e=>gpu.dispatch(e,up,p,groups(dims))}];
    return Object.assign(e=>{for(const s of stages)s.encode(e);},{stages});
  }};
}
