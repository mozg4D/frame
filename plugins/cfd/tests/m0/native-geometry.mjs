import {captureFlowSurfaces} from '../../plugin.js';
import {meshPressureBarriers} from './pressure-barrier.mjs';
export {boxAxes,boxMetric,captureFlowSurfaces} from '../../plugin.js';

// Exact bindings used by the isolated host. Production callers receive these
// methods from the activation context; the harness has no plugin registration.
export function researchSceneContext(engine){
  return {get device(){return engine.renderer.device;},math:engine.pluginMath,document:{world:hash=>engine.pluginWorld(hash)},
    animation:{inspect:hashes=>engine.pluginAnimationInputs(hashes),sampleTransforms:(hashes,t)=>engine.pluginSampleTransforms(hashes,t)},
    scene:{capture:(hash,keys,opts)=>engine.pluginSnapshot(hash,keys,true,false,opts.bounds),
      signature:(hash,keys,opts)=>engine.pluginSnapshot(hash,keys,false,false,opts.bounds).signature}};
}

export async function capturedPressureBarriers(gpu,f,context,owner){
  const {meshes,assertCurrent}=captureFlowSurfaces(gpu.device,context,owner);
  const phase=gpu.buffer('CFD evaluated pose',new Float32Array([1,0,0,0]),GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
  const barrier=await meshPressureBarriers(gpu,f,meshes,phase,assertCurrent);
  return {...barrier,occurrences:meshes.length,triangles:meshes.reduce((n,m)=>n+m.triangleCount,0),storage:meshes.map(m=>m.storage)};
}
