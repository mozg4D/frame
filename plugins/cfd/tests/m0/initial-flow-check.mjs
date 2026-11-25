import {cartesianSolver,gpuScope} from '../../plugin.js';

// Both ends have zero reservoir pressure. A full transverse baffle leaves
// each chamber with one open end. Its unique axial potential discharge is
// zero. Removing the baffle gives an exactly compatible uniform stream.
export async function verifyInitialDischarge(device){
  const dims=[32,8,8],n=dims.reduce((a,b)=>a*b),h=.01,dt=.0005,U=.7,results=[];
  const f={dims,h,U,dt,origin:[0,0,0],maxSpeed:U,nu:1.52e-5,rho:1.2,period:dims[0]*h/U,
    wallModeled:true,cutCells:true,faceHistory:true,projectInflow:true,globalPressure:true,
    rotor:false,omega:0,laminar:false,tunnelSymmetry:true,pressureOpen:[true,true,false,false,false,false]};
  const schedule={async perform(phases,check){
    check();const e=device.createCommandEncoder();for(const p of phases)p.encode(e);device.queue.submit([e.finish()]);
  }};
  for(const baffle of [false,true]){
    const gpu=gpuScope(device);
    try{
      const permeability=new Float32Array(4*n).fill(1),wall=new Float32Array(4*n);
      for(let i=0;i<n;i++){
        const x=i%dims[0];if(baffle&&x===15)permeability[4*i]=0;
        wall[4*i]=baffle?Math.abs(x+.5-16):32;
      }
      const force=gpu.buffer('Initial duct reaction',4*n),solver=await cartesianSolver(gpu,{...f,U:baffle?0:U},dt,
        gpu.buffer('Duct wall distance',wall),force,gpu.buffer('Duct open faces',permeability));
      const array=b=>gpu.read(b,gpu.staging('Duct field verification',b.size),b.size/4);
      if(baffle){
        // The reservoirs are at rest after the impulse. Supply an initially
        // moving fluid so the projection is nontrivial without imposing any
        // subsequent backflow or tangential forcing at the outer boundary.
        const seed=await array(solver.state),q=new Float32Array(8*n);
        for(let i=0;i<n;i++){
          seed[8*i]=U*dt/h;
          q[8*i]=i%dims[0]===15?0:U*dt/h;q[8*i+4]=i%dims[0]===16?0:U*dt/h;
        }
        device.queue.writeBuffer(solver.state,0,seed);device.queue.writeBuffer(solver.flux,0,q);
      }
      const current=()=>{},init=await solver.initialize(schedule,current),again=await solver.initialize(schedule,current);
      const [primary,extra,pressure,axial,moments,state]=await Promise.all([solver.flux,solver.fluxTail,solver.pressure,force,solver.loads,solver.state].map(array));
      let maxFluxError=0,maxVelocityError=0;
      for(let i=0;i<n;i++)for(let a=0;a<3;a++)maxVelocityError=Math.max(maxVelocityError,
        Math.abs(state[8*i+a]/(U*dt/h)-(a===0&&!baffle?1:0)));
      for(let i=0;i<n;i++)for(const slot of [0,1,2,4,5,6]){
        const expected=!baffle&&slot%4===0?1:0,q=(primary[8*i+slot]+extra[8*i+slot])/(U*dt/h);
        maxFluxError=Math.max(maxFluxError,Math.abs(q-expected));
      }
      const cleared=[pressure,axial,moments].every(row=>row.every(v=>v===0)),stepsBefore=solver.fluxConvergence.steps;
      await solver.advance(0,false,schedule,current);
      const physical=await array(force),sum=physical.reduce((s,v)=>s+v,0);
      results.push({baffle,maxFluxError,maxVelocityError,cleared,stepsBefore,firstStepAxialImpulse:sum,initialization:init,
        pass:again===init&&cleared&&stepsBefore===0&&solver.fluxConvergence.steps===1&&
          init.maxDivergencePerS<1e-6&&maxFluxError<2e-5&&maxVelocityError<2e-5&&Math.abs(sum)<1e-5});
    }finally{gpu.close();}
  }
  return {pass:results.every(r=>r.pass),results};
}
