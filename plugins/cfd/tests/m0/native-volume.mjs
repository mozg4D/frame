import {countOf,distanceBand,rasterize} from '../../plugin.js';
export {nativeFlowGeometry} from '../../plugin.js';

import {gpuScope} from './gpu.mjs';

import {extendNativeMetric} from './metric.mjs';

import {latticeWallMotion} from './lattice-motion.mjs';
import {latticeSurface} from './lattice-surface.mjs';

export async function nativeGraphMetric(device,f,capture){
  const gpu=gpuScope(device),start=performance.now(),limit=Math.min(8000000,Math.floor(device.limits.maxStorageBufferBindingSize/12));
  try{
    if(!capture.meshes.length)throw Error('The native graph reference requires an evaluated surface');
    const band=distanceBand(f,capture.meshes,limit,Math.min(f.h/2,(f.graphTangentM??Infinity)/2)),count=countOf(band.dims);
    const packed=await rasterize(gpu,band,capture),distance=await extendNativeMetric(gpu,band.dims,packed,20);
    const field=await gpu.read(distance,gpu.staging('CFD graph native signed distance',4*count),count);capture.assertCurrent();
    for(let i=0;i<count;i++)field[i]*=-band.h;
    const bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
    for(const {bounds:b} of capture.meshes)for(let a=0;a<3;a++){bounds.min[a]=Math.min(bounds.min[a],b.min[a]);bounds.max[a]=Math.max(bounds.max[a],b.max[a]);}
    const domain={origin:f.origin,dims:f.dims,h:f.h};
    const sm={...f,graphNative:true,h:band.h,origin:band.origin.map(v=>v-.5*band.h),dims:band.dims,domain,surfaceBounds:bounds};
    return {sm,field,ms:performance.now()-start,peakGpuBytes:gpu.allocatedBytes,source:'Frame evaluated surface / native Unite raster, seed and extension'};
  }finally{gpu.close();}
}

export async function nativeLatticeGeometry(gpu,f,capture,dt){
  if(f.axes)throw Error('A physical lattice requires uniform spacing');
  const scratch=gpuScope(gpu.device),start=performance.now();
  try{
    const limit=Math.min(8000000,Math.floor(gpu.device.limits.maxStorageBufferBindingSize/12));
    const band=capture.meshes.length?distanceBand(f,capture.meshes,limit,f.h/4):{origin:f.origin,h:f.h/4,dims:[3,3,3]};
    const packed=await rasterize(scratch,band,capture),metric=await extendNativeMetric(scratch,band.dims,packed,12);
    const distance=gpu.buffer('CFD material-frame native signed lattice metric',metric.size);
    const e=gpu.device.createCommandEncoder();e.copyBufferToBuffer(metric,0,distance,0,metric.size);gpu.device.queue.submit([e.finish()]);
    const surface=f.latticeSurfaceWall?await latticeSurface(gpu,f,capture,band,distance):null;
    const geometry=await latticeWallMotion(gpu,f,dt,band,distance,surface);
    await gpu.device.queue.onSubmittedWorkDone();capture.assertCurrent();
    return {...geometry,assertCurrent:capture.assertCurrent,stats:{source:'Frame evaluated surfaces / rotating native Unite metric',
      geometryMs:performance.now()-start,occurrences:capture.meshes.length,triangles:capture.meshes.reduce((s,m)=>s+m.triangleCount,0),
      bandDims:band.dims,bandPitchM:band.h,surfaceTensorDims:surface?.dims,scratchBytes:scratch.allocatedBytes}};
  }finally{scratch.close();}
}
