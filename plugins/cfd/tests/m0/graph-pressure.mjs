const decl=(i,name,type,write=false)=>`@group(0) @binding(${i}) var<storage,${write?'read_write':'read'}> ${name}:array<${type}>;`;
export async function graphPressure(gpu,levels){
  const stencil=decl(0,'offset','u32')+decl(1,'nbr','u32')+decl(2,'c','f32')+decl(3,'row','vec2f')+
    decl(4,'b','f32')+decl(5,'p','f32')+decl(6,'out','f32',true);
  const kernel=body=>`@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){let i=g.x;if(i>=arrayLength(&out)){return;}${body}}`;
  const residual='var r=b[i]-row[i].y*p[i];for(var e=offset[i];e<offset[i+1u];e++){r+=c[e]*(p[nbr[e]]-p[i]);}';
  const smooth=await gpu.kernel('CFD graph Jacobi',stencil+kernel(residual+'out[i]=p[i]+0.7*r/row[i].x;'));
  const op=await gpu.kernel('CFD graph residual',stencil+kernel(residual+'out[i]=r;'));
  const restrict=await gpu.kernel('CFD graph conservative restriction',decl(0,'start','u32')+decl(1,'children','u32')+decl(2,'r','f32')+decl(3,'out','f32',true)+kernel('var v=0.;for(var j=start[i];j<start[i+1u];j++){v+=r[children[j]];}out[i]=v;'));
  const prolong=await gpu.kernel('CFD graph prolongation',decl(0,'parent','u32')+decl(1,'p','f32')+decl(2,'out','f32',true)+kernel('out[i]+=p[parent[i]];'));
  const states=levels.map(l=>{
    const bytes=l.diag.byteLength,fill=(name,a)=>gpu.buffer('CFD graph '+name,a),p=fill('pressure',bytes),b=fill('imbalance',bytes),s=fill('temporary',bytes);
    const row=new Float32Array(2*l.diag.length);
    for(let i=0;i<l.diag.length;i++){row[2*i]=l.diag[i];row[2*i+1]=l.boundary[i];}
    const geom=[fill('offsets',l.offset),fill('neighbour',l.nbr),fill('conductance',l.c),fill('pressure row',row),b];
    return {p,b,s,grid:[Math.ceil(l.diag.length/128)],bindings:[gpu.bind(smooth,[...geom,p,s]),gpu.bind(smooth,[...geom,s,p])],op:gpu.bind(op,[...geom,p,s])};
  });
  for(let i=0;i+1<states.length;i++){
    const l=levels[i],a=states[i],b=states[i+1];
    a.down=gpu.bind(restrict,[gpu.buffer('CFD graph child offsets',l.childOffset),gpu.buffer('CFD graph children',l.children),a.s,b.b]);
    a.up=gpu.bind(prolong,[gpu.buffer('CFD graph groups',l.parent),b.p,a.p]);
  }
  function jacobi(e,a,pairs){for(let k=0;k<pairs;k++)for(const b of a.bindings)gpu.dispatch(e,smooth,b,a.grid);}
  function cycle(e,i){
    const a=states[i];if(i===states.length-1){jacobi(e,a,5);return;}
    jacobi(e,a,1);gpu.dispatch(e,op,a.op,a.grid);
    const coarse=states[i+1];gpu.dispatch(e,restrict,a.down,coarse.grid);e.clearBuffer(coarse.p);
    cycle(e,i+1);gpu.dispatch(e,prolong,a.up,a.grid);jacobi(e,a,1);
  }
  return {p:states[0].p,b:states[0].b,cycle:e=>cycle(e,0)};
}
