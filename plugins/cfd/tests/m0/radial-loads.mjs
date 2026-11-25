import {cellCenter} from './rectilinear.mjs';

// Sum forces along the shaft on the device. The remaining columns have a
// single radius in the shaft-centred physical frame, also on a graded grid.
export async function radialLoads(gpu,f,force,loads){
  const [nx,ny,nz]=f.dims,columns=ny*nz,radius=.5*f.sweptDiameterM,bins=12;
  const result=gpu.buffer('CFD integrated shaft columns',16*columns);
  const stage=gpu.staging('CFD radial force profile',result.size);
  const pipe=await gpu.kernel('CFD thrust and moment by shaft column',`
    @group(0) @binding(0) var<storage,read> force:array<f32>;
    @group(0) @binding(1) var<storage,read> load:array<vec4f>;
    @group(0) @binding(2) var<storage,read_write> out:array<vec4f>;
    var<workgroup> lanes:array<vec4f,64>;
    @compute @workgroup_size(64) fn main(@builtin(workgroup_id) id:vec3u,@builtin(local_invocation_index) k:u32){
      let column=id.x+${ny}u*id.y;var sum=vec4f(0);
      for(var x=k;x<${nx}u;x+=64u){
        let i=x+${nx}u*column;sum+=vec4f(force[i],load[i].xy,0.);
      }lanes[k]=sum;for(var d=32u;d>0u;d/=2u){
        workgroupBarrier();if(k<d){lanes[k]+=lanes[k+d];}
      }if(k==0u){out[column]=lanes[0];}
    }`);
  const index=Uint8Array.from({length:columns},(_,i)=>{
    const r=Math.hypot(cellCenter(f,1,i%ny),cellCenter(f,2,Math.floor(i/ny)));
    return Math.min(bins,Math.floor(r*bins/radius));
  });
  return async(scale,thrust,torque)=>{
    gpu.run(pipe,[force,loads,result],[ny,nz]);
    const values=await gpu.read(result,stage,4*columns);
    const profile=Array.from({length:bins+1},(_,i)=>({innerRadiusM:i*radius/bins,
      outerRadiusM:i===bins?null:(i+1)*radius/bins,thrustN:0,pressureThrustN:0,torqueNm:0,shaftPowerToFluidW:0}));
    for(let i=0;i<columns;i++){
      const b=profile[index[i]];b.thrustN+=scale*values[4*i];
      b.pressureThrustN+=scale*values[4*i+1];b.torqueNm+=scale*values[4*i+2];
    }
    for(const b of profile)b.shaftPowerToFluidW=-f.omega*b.torqueNm;
    for(const [key,total] of [['thrustN',thrust],['torqueNm',torque]]){
      const sum=profile.reduce((s,b)=>s+b[key],0),l1=profile.reduce((s,b)=>s+Math.abs(b[key]),0);
      if(!Number.isFinite(sum)||Math.abs(sum-total)>5e-5*Math.max(l1,Math.abs(total),1e-10))
        throw Error('Annular integral disagrees with whole-rotor '+key);
    }
    return profile;
  };
}
