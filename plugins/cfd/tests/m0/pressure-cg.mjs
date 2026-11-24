// Resident PCG on the actual immersed operator. A diagonally equilibrated
// regular Dirichlet block inverse is SPD also on the active fluid subspace.
// Geometry and pressure stay on Frame's device, including all scalar reductions.
export async function devicePressureCG(gpu,level,block,operator){
  const count=level.dims.reduce((a,b)=>a*b),groups=level.group;
  const buffer=(name,bytes)=>gpu.buffer('CFD pressure CG '+name,bytes);
  const pair=buffer('residual and equilibration',8*count),d=buffer('direction',4*count),ad=buffer('operator product',4*count);
  const scaled=buffer('scaled residual',4*count),z=buffer('block correction',4*count),partials=buffer('partial sums',4*groups[0]),control=buffer('coefficients',16);
  const storage=(i,name,t,write=false)=>`@group(0) @binding(${i}) var<storage,${write?'read_write':'read'}> ${name}:array<${t}>;`;
  const run=body=>`@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){let i=g.x;if(i<${count}u){${body}}}`;
  const row=operator+storage(0,'pressure','f32')+storage(1,'mobility','vec4f');
  const initial=await gpu.kernel('CFD true immersed residual',row+storage(2,'rhs','f32')+storage(3,'pair','vec2f',true)+storage(4,'scaled','f32',true)+run(`
    let a=pressureRow(i);var s=0.;var r=0.;if(a.x>0.){s=sqrt(6./a.x);r=rhs[i]-a.y;}
    pair[i]=vec2f(r,s);scaled[i]=r*s;`));
  const initialGroup=gpu.bind(initial,[level.p,level.weight,level.rhs,pair,scaled]);
  const partial=(single,finish='sums[group.x]=lanes[0];')=>`var<workgroup> lanes:array<f32,128>;
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) group:vec3u){
      let i=g.x;var value=0.;${single}
      lanes[lane]=value;for(var stride=64u;stride>0u;stride/=2u){workgroupBarrier();if(lane<stride){lanes[lane]+=lanes[lane+stride];}}
      if(lane==0u){${finish}}}`;
  const rz=await gpu.kernel('CFD preconditioned residual norm',storage(0,'pair','vec2f')+storage(1,'z','f32')+storage(2,'sums','f32',true)+
    partial(`if(i<${count}u){let r=pair[i];value=r.x*(r.y*z[i]);}`));
  const rzGroup=gpu.bind(rz,[pair,z,partials]);
  const multiply=await gpu.kernel('CFD immersed pressure direction',row+storage(2,'ad','f32',true)+storage(3,'sums','f32',true)+
    partial(`if(i<${count}u){let a=pressureRow(i);ad[i]=a.y;value=pressure[i]*a.y;}`));
  const productGroup=gpu.bind(multiply,[d,level.weight,ad,partials]);
  const advance=await gpu.kernel('CFD immersed Krylov update',storage(0,'pressure','f32',true)+storage(1,'pair','vec2f',true)+storage(2,'d','f32')+
    storage(3,'ad','f32')+storage(4,'scaled','f32',true)+storage(5,'control','vec4f')+run(`
      let alpha=control[0].y;let old=pair[i];let r=old.x-alpha*ad[i];pair[i]=vec2f(r,old.y);
      pressure[i]+=alpha*d[i];scaled[i]=r*old.y;`));
  const advanceGroup=gpu.bind(advance,[level.p,pair,d,ad,scaled,control]);
  const direction=await gpu.kernel('CFD immersed Krylov direction',storage(0,'pair','vec2f')+storage(1,'z','f32')+storage(2,'d','f32',true)+storage(3,'control','vec4f')+
    run('d[i]=pair[i].y*z[i]+control[0].z*d[i];'));
  const directionGroup=gpu.bind(direction,[pair,z,d,control]);
  const reductions=[];
  for(const update of [
    'control[0]=vec4f(sum,0.,0.,sum);',
    'var alpha=0.;if(sum>0.&&old.x>old.w*1e-14){alpha=old.x/sum;}control[0].y=alpha;',
    'var beta=0.;if(old.x>old.w*1e-14){beta=sum/old.x;}control[0].x=sum;control[0].z=beta;'
  ]){
    const pipe=await gpu.kernel('CFD device dot reduction',storage(0,'sums','f32')+storage(1,'control','vec4f',true)+
      partial(`for(var j=lane;j<${groups[0]}u;j+=128u){value+=sums[j];}`,'let sum=lanes[0];let old=control[0];'+update));
    reductions.push([pipe,gpu.bind(pipe,[partials,control])]);
  }
  const pre=block.binding(scaled,z);
  const prepare=e=>{
    gpu.dispatch(e,initial,initialGroup,groups);e.clearBuffer(d);block.encode(e,pre);
    gpu.dispatch(e,rz,rzGroup,groups);gpu.dispatch(e,...reductions[0],[1]);gpu.dispatch(e,direction,directionGroup,groups);
  };
  const iterate=(e,last)=>{
    gpu.dispatch(e,multiply,productGroup,groups);gpu.dispatch(e,...reductions[1],[1]);gpu.dispatch(e,advance,advanceGroup,groups);
    if(!last){block.encode(e,pre);gpu.dispatch(e,rz,rzGroup,groups);gpu.dispatch(e,...reductions[2],[1]);gpu.dispatch(e,direction,directionGroup,groups);}
  };
  function refine(e,iterations){prepare(e);for(let i=0;i<iterations;i++)iterate(e,i+1===iterations);}
  return Object.assign(refine,{prepare,iterate});
}
