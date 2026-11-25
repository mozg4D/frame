import {devicePressureCG} from '../../plugin.js';

const decl=(i,name,type,write=false)=>`@group(0) @binding(${i}) var<storage,${write?'read_write':'read'}> ${name}:array<${type}>;`;
// Factor the actual small Galerkin matrix in double precision once. Every
// V-cycle applies its symmetric inverse on the renderer device.
export function coarseGraphInverse(level){
  const n=level.diag.length,L=new Float64Array(n*n);
  for(let i=0;i<n;i++){
    let diagonal=level.boundary[i];
    for(let e=level.offset[i];e<level.offset[i+1];e++){
      const j=level.nbr[e],c=level.c[e];diagonal+=c;L[i*n+j]-=c;
    }L[i*n+i]=diagonal;
  }
  for(let i=0;i<n;i++)for(let j=0;j<=i;j++){
    let a=L[i*n+j];for(let k=0;k<j;k++)a-=L[i*n+k]*L[j*n+k];
    if(i===j){if(!(a>0))throw Error('Graph coarse pressure has no positive reference');L[i*n+i]=Math.sqrt(a);}
    else L[i*n+j]=a/L[j*n+j];
  }
  const inverse=new Float32Array(n*n),v=new Float64Array(n);
  for(let col=0;col<n;col++){
    for(let i=0;i<n;i++){let a=Number(i===col);for(let k=0;k<i;k++)a-=L[i*n+k]*v[k];v[i]=a/L[i*n+i];}
    for(let i=n-1;i>=0;i--){let a=v[i];for(let k=i+1;k<n;k++)a-=L[k*n+i]*v[k];v[i]=a/L[i*n+i];inverse[i*n+col]=v[i];}
  }return inverse;
}
export async function graphPressure(gpu,levels){
  const stencil=decl(0,'offset','u32')+decl(1,'nbr','u32')+decl(2,'c','f32')+decl(3,'row','vec2f')+
    decl(4,'b','f32')+decl(5,'p','f32')+decl(6,'out','f32',true);
  const kernel=body=>`@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){let i=g.x;if(i>=arrayLength(&out)){return;}${body}}`;
  const residual='var r=b[i]-row[i].y*p[i];for(var e=offset[i];e<offset[i+1u];e++){r+=c[e]*(p[nbr[e]]-p[i]);}';
  const smooth=await gpu.kernel('CFD graph Jacobi',stencil+kernel(residual+'out[i]=p[i]+0.7*r/row[i].x;'));
  const op=await gpu.kernel('CFD graph residual',stencil+kernel(residual+'out[i]=r;'));
  const zero=await gpu.kernel('CFD initial graph Jacobi sweep',decl(0,'row','vec2f')+decl(1,'b','f32')+decl(2,'out','f32',true)+
    kernel('out[i]=.7*b[i]/row[i].x;'));
  const restrict=await gpu.kernel('CFD graph conservative restriction',decl(0,'start','u32')+decl(1,'children','u32')+decl(2,'r','f32')+decl(3,'out','f32',true)+kernel('var v=0.;for(var j=start[i];j<start[i+1u];j++){v+=r[children[j]];}out[i]=v;'));
  const prolong=await gpu.kernel('CFD graph prolongation',decl(0,'parent','u32')+decl(1,'p','f32')+decl(2,'out','f32',true)+kernel('out[i]+=p[parent[i]];'));
  const states=levels.map(l=>{
    const bytes=l.diag.byteLength,fill=(name,a)=>gpu.buffer('CFD graph '+name,a),p=fill('pressure',bytes),b=fill('imbalance',bytes),s=fill('temporary',bytes);
    const row=new Float32Array(2*l.diag.length);
    for(let i=0;i<l.diag.length;i++){row[2*i]=l.diag[i];row[2*i+1]=l.boundary[i];}
    const geom=[fill('offsets',l.offset),fill('neighbour',l.nbr),fill('conductance',l.c),fill('pressure row',row)];
    function state(b,p){return {p,b,s,geom,grid:[Math.ceil(l.diag.length/128)],zero:gpu.bind(zero,[geom[3],b,s]),
      bindings:[gpu.bind(smooth,[...geom,b,p,s]),gpu.bind(smooth,[...geom,b,s,p])],op:gpu.bind(op,[...geom,b,p,s])};}
    return {...state(b,p),state};
  });
  for(let i=0;i+1<states.length;i++){
    const l=levels[i],a=states[i],b=states[i+1];
    a.down=gpu.bind(restrict,[gpu.buffer('CFD graph child offsets',l.childOffset),gpu.buffer('CFD graph children',l.children),a.s,b.b]);
    a.up=gpu.bind(prolong,[gpu.buffer('CFD graph groups',l.parent),b.p,a.p]);
  }
  function jacobi(e,a,pairs){for(let k=0;k<pairs;k++)for(const b of a.bindings)gpu.dispatch(e,smooth,b,a.grid);}
  const last=states.at(-1),order=levels.at(-1).diag.length;
  const inverse=order<=128?gpu.buffer('CFD graph coarse pressure inverse',coarseGraphInverse(levels.at(-1))):null;
  const exact=inverse?await gpu.kernel('CFD solve coarse graph pressure',decl(0,'b','f32')+decl(1,'inv','f32')+decl(2,'p','f32',true)+`
    var<workgroup> lane:array<f32,64>;@compute @workgroup_size(64) fn main(@builtin(workgroup_id) g:vec3u,@builtin(local_invocation_index) k:u32){
      let row=g.x;var sum=0.;for(var j=k;j<${order}u;j+=64u){sum+=inv[row*${order}u+j]*b[j];}lane[k]=sum;
      for(var stride=32u;stride>0u;stride/=2u){workgroupBarrier();if(k<stride){lane[k]+=lane[k+stride];}}if(k==0u){p[row]=lane[0];}}`):null;
  const coarseGroup=exact?gpu.bind(exact,[last.b,inverse,last.p]):null;
  function cycle(e,i,a=states[i],fromZero=false){
    if(i===states.length-1&&exact){gpu.dispatch(e,exact,a.coarse??coarseGroup,[order]);return;}
    if(fromZero){gpu.dispatch(e,zero,a.zero,a.grid);gpu.dispatch(e,smooth,a.bindings[1],a.grid);}
    else jacobi(e,a,1);
    if(i===states.length-1){jacobi(e,a,4);return;}
    gpu.dispatch(e,op,a.op,a.grid);
    const coarse=states[i+1];gpu.dispatch(e,restrict,a.down,coarse.grid);
    cycle(e,i+1,coarse,true);gpu.dispatch(e,prolong,a.up,a.grid);jacobi(e,a,1);
  }
  const fine=states[0],preconditioner={
    binding(b,p){
      const a={...fine,...fine.state(b,p)};
      if(states.length===1&&exact)a.coarse=gpu.bind(exact,[b,inverse,p]);
      if(states.length>1)a.up=gpu.bind(prolong,[gpu.buffer('CFD graph fine pressure groups',levels[0].parent),states[1].p,p]);
      return a;
    },
    encode(e,a){cycle(e,0,a,true);}
  };
  const level={dims:[levels[0].diag.length,1,1],group:fine.grid,p:fine.p,rhs:fine.b,equilibrate:false,rowBuffers:fine.geom,
    rowBindings:decl(1,'offset','u32')+decl(2,'nbr','u32')+decl(3,'c','f32')+decl(4,'row','vec2f')};
  const operator=`fn pressureRow(i:u32)->vec2f{let pi=pressure[i];var value=row[i].y*pi;
    for(var e=offset[i];e<offset[i+1u];e++){value+=c[e]*(pi-pressure[nbr[e]]);}return vec2f(row[i].x,value);}`;
  const krylov=await devicePressureCG(gpu,level,preconditioner,operator);
  return {p:fine.p,b:fine.b,krylov,cycle:e=>cycle(e,0),smooth:e=>jacobi(e,fine,3)};
}
