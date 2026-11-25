// Integrate the density in the resident 28-byte state independently of the
// streaming code. Gauge populations cancel on opposite links, so each window
// can compare its density change with the exterior and reservoir transfers.
export async function latticeMass(gpu,f,dt,state,exchanges){
  const n=f.dims.reduce((a,b)=>a*b),groups=Math.ceil(n/128);
  const values=gpu.buffer('CFD lattice mass and density range',16*groups);
  const stage=gpu.staging('CFD lattice mass reductions',Math.max(values.size,exchanges.size));
  const pipe=await gpu.kernel('CFD independent packed density integral',`
    struct M{rho:f32,j:array<f32,3>,stress:array<u32,3>}
    @group(0) @binding(0) var<storage,read> state:array<M>;
    @group(0) @binding(1) var<storage,read_write> partial:array<vec4f>;
    var<workgroup> lanes:array<vec4f,128>;
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) k:u32,@builtin(workgroup_id) g:vec3u){
      var v=0.;if(id.x<arrayLength(&state)){v=state[id.x].rho;}lanes[k]=vec4f(v,min(v,0.),max(v,0.),abs(v));
      for(var d=64u;d>0u;d/=2u){workgroupBarrier();if(k<d){let b=lanes[k+d];let a=lanes[k];lanes[k]=vec4f(a.x+b.x,min(a.y,b.y),max(a.z,b.z),a.w+b.w);}}
      if(k==0u){partial[g.x]=lanes[0];}
    }`);
  let previous=0;
  return {exchanges,async measure(steps){
    gpu.run(pipe,[state,values],[groups]);const field=await gpu.read(values,stage,4*groups),sums=[0,0,0,0];
    let end=0,min=0,max=0,absolute=0;
    for(let i=0;i<field.length;i+=4){end+=field[i];min=Math.min(min,field[i+1]);max=Math.max(max,field[i+2]);absolute+=field[i+3];}
    const transfers=await gpu.read(exchanges,stage,exchanges.size/4);
    for(let i=0;i<transfers.length;i++)sums[i%4]+=transfers[i];
    const [exterior,sponge,wall,gross]=sums,change=end-previous,defect=change-exterior-sponge;
    const unit=f.rho*f.h**3;previous=end;
    return {physicalTimeS:steps*dt,densityChangeKg:change*unit,boundaryTransferKg:exterior*unit,
      spongeTransferKg:sponge*unit,wallLeakageKg:wall*unit,kineticBalanceDefectKg:(defect-wall)*unit,
      relativeGlobalMassDefect:Math.abs(defect)/n,relativeKineticDefect:Math.abs(defect-wall)/n,
      referenceMassKg:n*unit,grossGaugeExchangeKg:gross*unit,densityRatioRange:[1+min,1+max],meanAbsoluteDensityVariation:absolute/n};
  }};
}
