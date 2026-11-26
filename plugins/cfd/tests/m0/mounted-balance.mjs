import {gpuScope,gridWGSL,metricWGSL,metricBuffer,nativeFlowGeometry,sumForce} from '../../plugin.js';

// The balance in Ahmed et al. (SAE 840300, Fig. 2 and Table 1) was tared
// for the four stilts. Keep them in the flow. Allocate stored wall impulses
// using the independently evaluated distances to the body and to the stilts.
// Report how much the allocation could vary on cells near the joint.
export async function mountedAxialBalance(gpu,f,force,capture){
  const n=f.dims.reduce((a,b)=>a*b),launch=[Math.ceil(n/128)],scratch=gpuScope(gpu.device);
  const mask=gpu.buffer('CFD test body and stilt attribution',4*n);
  try{
    const walls=[],envelopes=[];
    for(const body of [true,false]){
      const meshes=capture.meshes.filter(m=>(m.hash===f.balanceBody)===body);
      if(meshes.length!==(body?1:4))throw Error('Incomplete native support assembly');
      envelopes.push(meshes.map(m=>
        '(all(hi>=vec3f('+m.bounds.min.join(',')+'))&&all(lo<=vec3f('+m.bounds.max.join(',')+')))').join('||'));
      const metric=await nativeFlowGeometry(scratch,{...f,cutCells:false,sheetLinks:false,surfacePressure:false,wakeDistance:false,
        modeledShape:true,subcellSurface:false}, {...capture,meshes},1);
      walls.push(metric.wall);
    }
    const pipe=await gpu.kernel('CFD test nearest wetted component at each force cell',gridWGSL(f)+metricWGSL(f)+`
      @group(0) @binding(0) var<storage,read> body:array<vec4f>;@group(0) @binding(1) var<storage,read> stilts:array<vec4f>;
      @group(0) @binding(2) var<storage,read_write> mask:array<u32>;
      @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
        let i=g.x;if(i<CELLS){
          // A pressure barrier can place a reaction on either side of a cell
          // face. Include the adjacent cells' full extent on the graded grid.
          let p=point(i);let left=max(p-1,vec3i(0));let right=min(p+1,DIMS-1);
          let origin=vec3f(${f.origin.join(',')});
          let lo=origin+${f.h}*(cellCenters(left)-.5*cellWidths(left));
          let hi=origin+${f.h}*(cellCenters(right)+.5*cellWidths(right));
          let hull=${envelopes[0]};let support=${envelopes[1]};
          let distance=abs(stilts[i].x)-abs(body[i].x);let diameter=length(cellWidths(p));
          let owner=select(distance>=0.,hull,hull!=support);
          let ambiguous=(!hull&&!support)||(hull&&support&&abs(distance)<=diameter);
          mask[i]=u32(owner)+2u*u32(ambiguous);}}`);
    gpu.run(pipe,[...walls,mask],launch,metricBuffer(gpu,f));await gpu.device.queue.onSubmittedWorkDone();
  }finally{scratch.close();}
  const components=gpu.buffer('CFD test body, supports and ambiguous load interval',16*n);
  const split=await gpu.kernel('CFD test partition the measured assembly impulse',`
    @group(0) @binding(0) var<storage,read> force:array<f32>;@group(0) @binding(1) var<storage,read> flag:array<u32>;
    @group(0) @binding(2) var<storage,read_write> out:array<vec4f>;
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
      let i=g.x;if(i<arrayLength(&out)){let m=flag[i];let x=force[i];let b=select(0.,x,(m&1u)!=0u);
        let change=select(vec2f(0),vec2f(min(0.,x),max(0.,x))-vec2f(b),m>=2u);
        out[i]=vec4f(b,x-b,change);}}`);
  const bind=gpu.bind(split,[force,mask,components]),read=await sumForce(gpu,components,n,4);
  return async(scale,whole)=>{
    const e=gpu.device.createCommandEncoder();gpu.dispatch(e,split,bind,launch);gpu.device.queue.submit([e.finish()]);
    const [body,stilts,lo,hi]=(await read()).map(x=>x*scale),q=f.normalization;
    return {bodyN:body,stiltsN:stilts,assemblyN:whole,closureN:body+stilts-whole,bodyCd:body/q,assemblyCd:whole/q,
      cellAssignmentRangeCd:[(body+lo)/q,(body+hi)/q]};
  };
}
