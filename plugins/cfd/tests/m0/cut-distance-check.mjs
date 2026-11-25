import {captureFlowSurfaces,extendNativeMetric,gpuScope,rasterize,nativeCutMetric} from '../../plugin.js';
import {researchSceneContext} from './native-geometry.mjs';

// Signed distance in physical metres, positive in the material. Each plane,
// edge and vertex of this oriented native cuboid has a known closest point.
export function cuboid(center,half,angle){
  const c=Math.cos(angle),s=Math.sin(angle);
  const vertices=Array.from({length:8},(_,i)=>{
    const [x,y,z]=half.map((h,a)=>i&(1<<a)?h:-h);
    return [center[0]+c*x-s*y,center[1]+s*x+c*y,center[2]+z].map(x=>x*1000);
  });
  const indices=[0,2,3,0,3,1,4,5,7,4,7,6,0,4,6,0,6,2,1,3,7,1,7,5,0,1,5,0,5,4,2,6,7,2,7,3];
  return {vertices:vertices.flat(),indices,distance(p){
    const [a,b,z]=p.map((x,k)=>x-center[k]);
    const q=[c*a+s*b,-s*a+c*b,z].map((x,k)=>Math.abs(x)-half[k]);
    return -Math.hypot(...q.map(x=>Math.max(0,x)))-Math.min(0,Math.max(...q));
  }};
}

export async function verifyNativeCutDistance(device){
  const h=.0037,band={h,dims:[37,37,37],origin:[-.0671,.4333,-.0668]},angle=.403;
  const rows=[],call=(name,args={})=>frameAI.call(name,args);
  for(const problem of ['oblique','subcell-edit','union-and-sheet']){
    await call('scene.new');const owner=(await call('scene.create',{type:'cfd'})).hash;
    const slide=problem==='subcell-edit'?.17*h:0;
    const first=cuboid([.0013+slide*Math.cos(angle),.5011+slide*Math.sin(angle),.0017],[.031,.024,.027],angle);
    const solids=[first];
    if(problem==='union-and-sheet'){
      solids.push(cuboid([.026,.492,.002],[.021,.019,.015],-.27),cuboid([0,.5,0],[.012,.011,.013],-.14));
      await call('mesh.create',{name:'Open non-volumetric sheet',vertices:[-44,450,12,44,450,12,44,550,12,-44,550,12],
        indices:[0,1,2,0,2,3],storage:'texture'});
    }
    for(const [k,solid] of solids.entries())await call('mesh.create',{name:'Resolved native cuboid '+k,
      vertices:solid.vertices,indices:solid.indices,storage:problem==='subcell-edit'||k%2?'texture':'auto'});
    const capture=captureFlowSurfaces(device,researchSceneContext(frameEngine),owner),gpu=gpuScope(device);
    try{
      const packed=await rasterize(gpu,band,capture),distance=await extendNativeMetric(gpu,band.dims,packed,12);
      const n=band.dims.reduce((a,b)=>a*b),stage=gpu.staging('Compare native signed distances',4*n);
      const before=await gpu.read(distance,stage,n);const exact=await nativeCutMetric(gpu,band,capture,distance);
      const after=await gpu.read(exact.distance,stage,n);
      let count=0,oldSum=0,newSum=0,maxError=0,wrongSign=0,farChange=0;
      const [nx,ny]=band.dims;
      for(let i=0;i<n;i++){
        const q=[i%nx,Math.floor(i/nx)%ny,Math.floor(i/(nx*ny))].map((v,a)=>band.origin[a]+h*v);
        const exact=Math.max(...solids.map(s=>s.distance(q)))/h;
        if(Math.abs(before[i])>=3.5)farChange=Math.max(farChange,Math.abs(after[i]-before[i]));
        if(Math.abs(exact)>1.35)continue;
        const error=after[i]-exact;oldSum+=(before[i]-exact)**2;newSum+=error**2;
        maxError=Math.max(maxError,Math.abs(error));count++;
        if(Math.abs(exact)>.005&&Math.sign(after[i])!==Math.sign(exact))wrongSign++;
      }
      const oldRms=Math.sqrt(oldSum/count),rms=Math.sqrt(newSum/count);
      rows.push({problem,count,oldRmsCells:oldRms,rmsCells:rms,maxErrorCells:maxError,wrongSign,farChangeCells:farChange,
        pass:count>2000&&rms<.01&&maxError<.08&&rms<oldRms*.2&&wrongSign===0&&farChange===0});
    }finally{gpu.close();}
  }
  return {pass:rows.every(r=>r.pass),bandPitchM:h,rows};
}
