import {LOCAL_BOX} from '../../plugin.js';
import {meshPressureBarriers} from './pressure-barrier.mjs';

// Physical coordinates have an orthonormal basis. A sheared or scaled CFD
// owner still carries real millimetres along each of its authored directions.
export function boxMetric(world){
  const dot=(a,b)=>a.reduce((sum,value,i)=>sum+value*b[i],0);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  function unit(v){const length=Math.hypot(...v);if(!Number.isFinite(length)||length===0)throw Error('Degenerate CFD frame');return v.map(x=>x/length);}
  const columns=[0,4,8].map(i=>Array.from(world.slice(i,i+3)));
  const x=unit(columns[0]),z=unit(cross(x,columns[1])),axes=[x,cross(z,x),z];
  if(!Number.isFinite(dot(z,columns[2]))||dot(z,columns[2])===0)throw Error('Degenerate CFD frame');
  return [...columns.flatMap(col=>[...axes.map(axis=>.001*dot(axis,col)),0]),0,0,0,1];
}

// Shares the SDK's visibility, occurrence transforms, relative-revision checks
// and native buffer / paged-texture storage. No polygon readback or mesh copy.
export async function capturedPressureBarriers(gpu,f,context,owner){
  const options={bounds:{min:[...LOCAL_BOX.min],max:[...LOCAL_BOX.max]}},keys=['Speed','Medium','Altitude','Ground'];
  const snapshot=context.scene.capture(owner,keys,options),metric=boxMetric(context.document.world(owner));
  if(snapshot.device!==gpu.device)throw Error('CFD geometry belongs to a different device');
  function assertCurrent(){
    const current=boxMetric(context.document.world(owner));
    if(context.device!==gpu.device||context.scene.signature(owner,keys,options)!==snapshot.signature||
      current.some((v,i)=>Math.abs(v-metric[i])>64*Number.EPSILON*Math.max(.001,Math.abs(v),Math.abs(metric[i])))){
      throw Object.assign(Error('CFD source geometry or physical frame changed'),{code:'STALE_CFD_GEOMETRY'});
    }
  }
  const meshes=snapshot.meshes.map(mesh=>({...mesh,matrix:context.math.mul(metric,mesh.matrix)}));
  const phase=gpu.buffer('CFD evaluated pose',new Float32Array([1,0,0,0]),GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
  const barrier=await meshPressureBarriers(gpu,f,meshes,phase,assertCurrent);
  return {...barrier,occurrences:meshes.length,triangles:meshes.reduce((n,m)=>n+m.triangleCount,0),storage:meshes.map(m=>m.storage)};
}
