import {LOCAL_BOX} from '../../plugin.js';
import {meshPressureBarriers} from './pressure-barrier.mjs';

// Physical coordinates have an orthonormal basis. A sheared or scaled CFD
// owner still carries real millimetres along each of its authored directions.
const dot=(a,b)=>a.reduce((sum,value,i)=>sum+value*b[i],0);
export function boxAxes(world){
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  function unit(v){const length=Math.hypot(...v);if(!Number.isFinite(length)||length===0)throw Error('Degenerate CFD frame');return v.map(x=>x/length);}
  const columns=[0,4,8].map(i=>Array.from(world.slice(i,i+3)));
  const x=unit(columns[0]);let up=unit(cross(columns[2],x));const scale=dot(up,columns[1]);
  if(!Number.isFinite(scale)||scale===0)throw Error('Degenerate CFD frame');
  if(scale<0)up=up.map(v=>-v);
  return [x,up,cross(x,up)];
}
export function boxMetric(world){
  const columns=[0,4,8].map(i=>Array.from(world.slice(i,i+3))),axes=boxAxes(world);
  return [...columns.flatMap(col=>[...axes.map(axis=>.001*dot(axis,col)),0]),0,0,0,1];
}

// Shares the SDK's visibility, occurrence transforms, relative-revision checks
// and native buffer / paged-texture storage. No polygon readback or mesh copy.
export function captureFlowSurfaces(device,context,owner,origin=[0,0,0]){
  const options={bounds:{min:[...LOCAL_BOX.min],max:[...LOCAL_BOX.max]}},keys=['Speed','Medium','Altitude','Ground'];
  const snapshot=context.scene.capture(owner,keys,options),metric=boxMetric(context.document.world(owner));
  if(snapshot.device!==device)throw Error('CFD geometry belongs to a different device');
  function assertCurrent(){
    const current=boxMetric(context.document.world(owner));
    if(context.device!==device||context.scene.signature(owner,keys,options)!==snapshot.signature||
      current.some((v,i)=>Math.abs(v-metric[i])>64*Number.EPSILON*Math.max(.001,Math.abs(v),Math.abs(metric[i])))){
      throw Object.assign(Error('CFD source geometry or physical frame changed'),{code:'STALE_CFD_GEOMETRY'});
    }
  }
  const shift=metric.slice();for(let i=0;i<3;i++)shift[12+i]=-origin[i];
  const meshes=snapshot.meshes.map(mesh=>{
    const bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
    for(let k=0;k<8;k++){
      const corner=mesh.bounds.min.map((v,axis)=>k&(1<<axis)?mesh.bounds.max[axis]:v);
      const p=context.math.point(shift,corner);for(let axis=0;axis<3;axis++){bounds.min[axis]=Math.min(bounds.min[axis],p[axis]);bounds.max[axis]=Math.max(bounds.max[axis],p[axis]);}
    }
    return {...mesh,bounds,matrix:context.math.mul(shift,mesh.matrix)};
  });
  return {meshes,assertCurrent,signature:snapshot.signature,params:snapshot.params};
}

// Exact bindings used by the isolated host. Production callers receive these
// methods from the activation context; the harness has no plugin registration.
export function researchSceneContext(engine){
  return {get device(){return engine.renderer.device;},math:engine.pluginMath,document:{world:hash=>engine.pluginWorld(hash)},
    scene:{capture:(hash,keys,opts)=>engine.pluginSnapshot(hash,keys,true,false,opts.bounds),
      signature:(hash,keys,opts)=>engine.pluginSnapshot(hash,keys,false,false,opts.bounds).signature}};
}

export async function capturedPressureBarriers(gpu,f,context,owner){
  const {meshes,assertCurrent}=captureFlowSurfaces(gpu.device,context,owner);
  const phase=gpu.buffer('CFD evaluated pose',new Float32Array([1,0,0,0]),GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
  const barrier=await meshPressureBarriers(gpu,f,meshes,phase,assertCurrent);
  return {...barrier,occurrences:meshes.length,triangles:meshes.reduce((n,m)=>n+m.triangleCount,0),storage:meshes.map(m=>m.storage)};
}
