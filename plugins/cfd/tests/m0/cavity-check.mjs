import {cartesianSolver,gpuScope} from '../../plugin.js';

// Ghia, Ghia & Shin (1982), Tables I and II, Re=100. Coordinates and
// velocities are scaled by the cavity width and lid speed.
// https://doi.org/10.1016/0021-9991(82)90058-4
const uRef=[[.0547,-.03717],[.0625,-.04192],[.0703,-.04775],[.1016,-.06434],[.1719,-.10150],[.2813,-.15662],
  [.4531,-.21090],[.5,-.20581],[.6172,-.13641],[.7344,.00332],[.8516,.23151],[.9531,.68717],[.9609,.73722],[.9688,.78871],[.9766,.84123]];
const vRef=[[.0625,.09233],[.0703,.10091],[.0781,.10890],[.0938,.12317],[.1563,.16077],[.2266,.17507],[.2344,.17527],
  [.5,.05454],[.8047,-.24533],[.8594,-.22445],[.9063,-.16914],[.9453,-.10313],[.9531,-.08864],[.9609,-.07391],[.9688,-.05906]];

export async function verifyCavity(device){
  const gpu=gpuScope(device),n=48,nz=8,count=n*n*nz,h=1/n,dt=1/240;
  const f={dims:[n,n,nz],origin:[0,0,0],h,U:0,maxSpeed:1,nu:.01,rho:1,laminar:true,rotor:false,
    omega:0,period:1,globalPressure:true,tunnelSymmetry:true,pressureOpen:Array(6).fill(false),
    domainWalls:[[0,0,0],[0,0,0],[0,0,0],[1,0,0],null,null]};
  f.axes=f.dims.map(d=>Float64Array.from({length:d+1},(_,i)=>i*h));
  const scheduler={async perform(phases,check){check?.();const e=device.createCommandEncoder();for(const phase of phases)phase.encode(e);device.queue.submit([e.finish()]);}};
  try{
    const wallValues=new Float32Array(count*4);for(let i=0;i<count;i++)wallValues[4*i]=4*n;
    const wall=gpu.buffer('Cavity fluid centres',wallValues),mu=gpu.buffer('Cavity open internal faces',new Float32Array(4*count).fill(1));
    const force=gpu.buffer('Cavity immersed reaction',4*count),solver=await cartesianSolver(gpu,f,dt,wall,force,mu);
    const profile=gpu.buffer('Cavity centreline velocities',8*n),stage=gpu.staging('Cavity centreline readback',8*n);
    const sample=await gpu.kernel('Cavity midplane sampling',`
      @group(0) @binding(0) var<storage,read> state:array<vec4f>;
      @group(0) @binding(1) var<storage,read_write> line:array<vec2f>;
      fn cell(x:u32,y:u32,z:u32)->vec3f{return state[2u*(x+${n}u*(y+${n}u*z))].xyz;}
      @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3u){
        let j=g.x;if(j>=${n}u){return;}let mid=${n/2}u;var sum=vec2f(0);
        for(var z=0u;z<${nz}u;z++){for(var k=mid-1u;k<=mid;k++){
          sum+=vec2f(cell(k,j,z).x,cell(j,k,z).y);
        }}line[j]=sum*${h/dt/(2*nz)};}`);
    let previous=null,line=null,drift=null,step=0;const windows=[],start=performance.now();
    for(let t=1;t<=24;t++){
      const end=Math.round(t/dt);for(;step<end;step++)await solver.advance(step,false,scheduler,()=>{});
      if(solver.fluxConvergence.missedSteps)throw Error('A closed-cavity cell missed its mass tolerance');
      gpu.run(sample,[solver.state,profile],[Math.ceil(n/64)]);line=await gpu.read(profile,stage,2*n);
      drift=previous?Math.max(...line.map((v,i)=>Math.abs(v-previous[i]))):null;windows.push({physicalTimeS:t,drift});
      console.log('CFD live cavity t='+t+' centreline drift '+drift);
      if(t>=6&&drift<1e-4)break;previous=line;
    }
    function compare(ref,k){
      return ref.map(([position,target])=>{
        const p=n*position-.5,lo=Math.floor(p),frac=p-lo;
        const value=(1-frac)*line[2*lo+k]+frac*line[2*(lo+1)+k];
        return {position,reference:target,value,error:value-target};
      });
    }
    const horizontalVelocityAtMidX=compare(uRef,0),verticalVelocityAtMidY=compare(vRef,1),points=[...horizontalVelocityAtMidX,...verticalVelocityAtMidY];
    const maxError=Math.max(...points.map(p=>Math.abs(p.error))),relativeL2=Math.sqrt(points.reduce((a,p)=>a+p.error**2,0)/points.reduce((a,p)=>a+p.reference**2,0));
    return {pass:drift<1e-4&&maxError<.02&&relativeL2<.02&&solver.fluxConvergence.maxDivergencePerS<1e-6,
      dimensions:f.dims,Re:100,lidSpeedMps:1,steps:step,elapsedMs:performance.now()-start,windows,maxError,relativeL2,
      maxDivergencePerS:solver.fluxConvergence.maxDivergencePerS,horizontalVelocityAtMidX,verticalVelocityAtMidY};
  }finally{gpu.close();}
}
