import {meshPressureBarriers} from '../../plugin.js';
export {meshReader,meshResources,meshPressureBarriers} from '../../plugin.js';

// Mark Cartesian pressure links whose center-to-center segment intersects
// an evaluated triangle. Surface winding and physical sheet thickness have
// no effect. Boundary-face storage has one bit for each positive axis.
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];

export function pressureBarriers(gpu,f,triangles,phase,representatives=null){
  const positions=gpu.buffer('CFD fixture vertices',triangles.vertices),indices=gpu.buffer('CFD fixture indices',triangles.indices);
  return meshPressureBarriers(gpu,f,[{storage:'buffer',positions,indices,matrix:identity,triangleCount:triangles.indices.length/3}],phase,undefined,representatives);
}
