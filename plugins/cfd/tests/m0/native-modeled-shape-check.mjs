import {captureFlowSurfaces,cartesianSolver,cutGroups,gpuScope,meshReader,meshResources,modeledTimeShape,nativeFlowGeometry,nativeSurfaceMeasures} from '../../plugin.js';
import {researchSceneContext} from './native-geometry.mjs';
import {nativeLocalShape} from './local-shape-fixture.mjs';

export async function verifyNativeModeledShape(device){
  const f={dims:[32,24,24],h:.008,origin:[-.1161,.4053,-.0967],U:.07,maxSpeed:.07,nu:1.5e-5,rho:1.2,
    period:.0805/.07,rotor:false,omega:0,wallModeled:true,cutCells:true,sstWall:true,ddes:true,projectInflow:true,
    incrementalPressure:true,faceHistory:true,faceReconstruction:true,linearWallPressure:true,sheetLinks:true,
    fluxEquilibration:true,globalPressure:true,cutBlockSmoother:true,mergeToFluid:true,wakeDistance:true,modeledShape:true,fullMoment:true};
  f.axes=f.dims.map((n,a)=>Float64Array.from({length:n+1},(_,i)=>f.origin[a]+f.h*i*(.94+.005*i+.011*a)));
  const n=f.dims.reduce((a,b)=>a*b),dt=.006,steps=12,scale=f.rho*f.h**4/(dt*dt*steps);
  const call=(name,args={})=>frameAI.call(name,args);
  async function solve(mm,storage,reverse=false){
    await call('scene.new');const box=(await call('scene.create',{type:'cfd'})).hash,body=nativeLocalShape(mm);
    await call('mesh.create',{...body.mesh,storage});
    const capture=captureFlowSurfaces(device,researchSceneContext(frameEngine),box),measures=await nativeSurfaceMeasures(device,capture);
    const active={...capture,meshes:capture.meshes.map((m,i)=>({...m,bounds:measures.bounds[i]}))};
    const gpu=gpuScope(device);
    const dispatch=fn=>{const e=device.createCommandEncoder();fn(e);device.queue.submit([e.finish()]);};
    const scheduler={async perform(phases,check){check();dispatch(e=>{for(const p of phases)p.encode(e);});}};
    try{
      const geom=await nativeFlowGeometry(gpu,f,active,dt),groups=await cutGroups(gpu,f,geom.response,geom.wall);
      const force=gpu.buffer('Physical axial impulse',4*n),s=await cartesianSolver(gpu,f,dt,geom.wall,force,geom.response,groups,geom.centers);
      const stage=gpu.staging('Native geometry and integrated force observations',48*n);
      const read=b=>gpu.read(b,stage,b.size/4);
      const mesh=active.meshes[0],coordinates=gpu.buffer('Actual indexed native vertex positions',12*mesh.vertexCount);
      const pose=gpu.buffer('Actual native shape pose',Float32Array.from(mesh.matrix),GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
      const vertices=await gpu.kernel('CFD observe evaluated positions used by the distance queries',meshReader(mesh.storage)+`
        @group(0) @binding(2) var<uniform> pose:mat4x4f;@group(0) @binding(3) var<storage,read_write> out:array<f32>;
        @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
          let k=3u*g.x;if(k>=arrayLength(&out)){return;}let v=pose*vec4f(coord(k),coord(k+1u),coord(k+2u),1.);
          out[k]=v.x;out[k+1u]=v.y;out[k+2u]=v.z;}`);
      const mapped=device.createBindGroup({layout:vertices.getBindGroupLayout(0),entries:[
        {binding:0,resource:meshResources(mesh)[0]},{binding:2,resource:{buffer:pose}},{binding:3,resource:{buffer:coordinates}}]});
      dispatch(e=>gpu.dispatch(e,vertices,mapped,[Math.ceil(mesh.vertexCount/128)]));const actual=await read(coordinates);
      const mask=(await read(geom.response)).map(x=>x>0?1:0);
      const roots=new Uint32Array((await read(groups.links)).buffer).filter((_,i)=>i%3===0);
      await s.initialize(scheduler,()=>{});
      const forceSeed=Float32Array.from({length:4*n},(_,i)=>i%4===0?scale:0);
      const seed=reverse?{force:gpu.buffer('Mean drag objective',forceSeed),moment:gpu.buffer('Moment objective',16*n),
        state:gpu.buffer('End state objective',32*n),face:gpu.buffer('End discharge objective',32*n),pressure:gpu.buffer('End pressure objective',4*n)}:null;
      const op=reverse?await s.modeledStepAdjoint(seed):null;
      const checkpoints=op?Array.from({length:steps},()=>gpu.buffer('Primal before physical step',op.checkpointSize)):[];
      for(let t=0;t<steps;t++){
        if(op)dispatch(e=>op.capture(e,checkpoints[t]));
        await s.advance(t,false,scheduler,()=>{});
      }
      const drag=(await read(force)).reduce((total,value)=>total+value,0)*scale;
      let derivative=null,defects=[],inletDefect=null,vertexGradient=null,replay=null;
      if(op){
        const packed=gpu.buffer('Reported terminal physical state',op.checkpointSize);
        const stageFull=gpu.staging('Check all terminal state words',op.checkpointSize);
        const captured=gpu.buffer('Recomputed complete state',op.checkpointSize);
        const beforeLoads=await read(s.loads),beforeForce=await read(force);
        dispatch(e=>op.capture(e,packed));
        const terminal=new Uint32Array((await gpu.read(packed,stageFull,packed.size/4)).buffer);
        const sum=gpu.buffer('Integrated material shape work',48*n);
        const add=await gpu.kernel('CFD test integrate volume work over actual physical steps',`
          @group(0) @binding(0) var<storage,read> now:array<vec4f>;@group(0) @binding(1) var<storage,read_write> sum:array<vec4f>;
          @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){if(g.x<arrayLength(&sum)){sum[g.x]+=now[g.x];}}`);
        const bind=gpu.bind(add,[op.geometry,sum]),accumulate=e=>gpu.dispatch(e,add,bind,[Math.ceil(3*n/128)]);
        for(let t=steps-1;t>=0;t--){
          dispatch(e=>{op.reverse(e,checkpoints[t]);accumulate(e);e.copyBufferToBuffer(op.old,0,seed.state,0,seed.state.size);
            e.copyBufferToBuffer(op.face,0,seed.face,0,seed.face.size);});
          defects.push(Array.from(await op.projection.defects()));
        }
        const initial=await op.projectedInlet();dispatch(e=>{initial.encode(e);accumulate(e);});inletDefect=await initial.defect();
        const material=await geom.cutShape.prepare(sum),vertices=geom.cutShape.vertices,out=gpu.buffer('Forces per metre of logical vertex movement',12*vertices);
        const range=gpu.buffer('Original logical vertices',new Uint32Array([0,vertices,0,0]),GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
        dispatch(e=>{material.encode(e);geom.cutShape.scatter(e,material.gradient,out,range);});
        vertexGradient=Array.from(await read(out));const displaced=nativeLocalShape(1).mesh.vertices;
        derivative=body.mesh.vertices.reduce((total,v,k)=>total+.001*vertexGradient[k]*(displaced[k]-v),0);
        if(storage==='auto'){
          const replaySubmissions={single:0,range:0};
          const counted=mode=>({perform(phases,check){replaySubmissions[mode]++;return scheduler.perform(phases,check);}});
          dispatch(e=>op.restore(e,checkpoints[0]));
          for(let t=0;t<steps;t++)await s.replay(t,counted('single'),()=>{});
          dispatch(e=>op.capture(e,captured));
          const words=async b=>new Uint32Array((await gpu.read(b,stageFull,b.size/4)).buffer);
          const single=await words(captured),middle=Math.floor(steps/2);
          dispatch(e=>op.restore(e,checkpoints[0]));
          await s.replayRange(0,steps,counted('range'),()=>{},(e,step)=>{if(step===middle)op.capture(e,packed);});
          dispatch(e=>op.capture(e,captured));
          const replayed=await words(captured),half=await words(packed),expectedHalf=await words(checkpoints[middle]);
          device.queue.writeBuffer(s.loads,0,beforeLoads);device.queue.writeBuffer(force,0,beforeForce);
          const history={submit:dispatch,stride:3,anchors:[{step:0,buffer:checkpoints[0]}],
            snapshot:label=>gpu.buffer(label,op.checkpointSize,GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST)};
          const actual=await modeledTimeShape(gpu,f,s,force,geom.cutShape,history,
            {steps,averagedSteps:steps,dtS:dt,forceLocal:{drag}},
            {shapeObjective:'drag',objectiveWorld:[1,0,0],objectiveAxis:[1,0,0]},scheduler,()=>{},()=>{});
          if(!actual.gradient)throw Error('Two-slot time adjoint '+JSON.stringify(actual.shape));
          dispatch(e=>{e.clearBuffer(out);geom.cutShape.scatter(e,actual.gradient,out,range);op.capture(e,captured);});
          const computed=await read(out),returned=new Uint32Array((await gpu.read(captured,stageFull,captured.size/4)).buffer);
          const d=Math.max(...computed.map((v,k)=>Math.abs(v-vertexGradient[k])))/Math.max(...vertexGradient.map(Math.abs));
          const loads=await read(s.loads),axial=await read(force);
          replay={restored:terminal.every((v,i)=>v===returned[i])&&axial.every((v,i)=>v===beforeForce[i])&&loads.every((v,i)=>v===beforeLoads[i]),
            identicalPrimal:terminal.every((v,i)=>v===replayed[i]&&v===single[i])&&half.every((v,i)=>v===expectedHalf[i]),
            replaySubmissions,relativeGradientDifference:d,replayedSteps:actual.shape.replayedSteps,
            fullCheckpoints:actual.shape.checkpointBytes/op.checkpointSize};
        }
      }
      return {mm,drag,derivative,defects,inletDefect,storage:active.meshes[0].storage,actual,mask,roots,volume:body.volumeMm3,
        bounds:measures.bounds[0],cells:n,samples:geom.cutShape.samples,vertexGradient,replay,mass:s.fluxConvergence.maxDivergencePerS};
    }finally{gpu.close();}
  }
  const rows=[];
  for(const storage of ['auto','texture']){
    const base=await solve(0,storage,true),estimates=[];
    for(const stepMm of [.008,.004]){
      const l=await solve(-stepMm,storage),r=await solve(stepMm,storage);
      const sameFlux=base.mask.every((v,i)=>v===l.mask[i]&&v===r.mask[i]);
      const sameMomentum=base.roots.every((v,i)=>v===l.roots[i]&&v===r.roots[i]);
      const volumeError=Math.max(Math.abs(l.volume/base.volume-1),Math.abs(r.volume/base.volume-1));
      const secant=(r.drag-l.drag)/(2*stepMm);
      const measured=base.vertexGradient.reduce((sum,v,k)=>sum+v*(r.actual[k]-l.actual[k])/(2*stepMm),0);
      estimates.push({stepMm,sameFlux,sameMomentum,volumeError,minusN:l.drag,plusN:r.drag,secantNPerMm:secant,
        measuredDirectionNPerMm:measured,authoredDirectionError:Math.abs(secant-base.derivative)/Math.max(Math.abs(secant),Math.abs(base.derivative),1e-20),
        relativeError:Math.abs(secant-measured)/Math.max(Math.abs(secant),Math.abs(measured),1e-20),
        mass:Math.max(l.mass,r.mass)});
    }
    rows.push({storage:base.storage,dragN:base.drag,derivativeNPerMm:base.derivative,inletDefect:base.inletDefect,replay:base.replay,
      adjointResidual:Math.max(...base.defects.map(d=>d[1])),samples:base.samples,mass:base.mass,estimates});
  }
  const b=rows[0].replay;
  return {pass:b?.restored&&b.identicalPrimal&&b.replaySubmissions.range<b.replaySubmissions.single&&
    b.relativeGradientDifference<.0001&&b.fullCheckpoints===4&&b.replayedSteps===21&&
    rows.every(r=>r.mass<1e-6&&r.inletDefect<3e-6&&r.adjointResidual<3e-6&&r.estimates.every(e=>
    e.sameFlux&&e.sameMomentum&&e.volumeError<1e-12&&e.mass<1e-6&&e.relativeError<.05)),dims:f.dims,steps,dtS:dt,rows};
}
