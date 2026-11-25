import {captureFlowSurfaces,gpuScope,mediumProperties,nativeSurfaceMeasures} from '../../plugin.js';
import {researchSceneContext} from './native-geometry.mjs';

export async function verifySurfaceExtents(device){
  const gpu=gpuScope(device),textures=[],v=new Float32Array([-21,-17,9,31,-5,-13,-8,37,-22,-26,-4,35,9000,-7000,7000]);
  const indices=new Uint32Array([0,2,1,0,1,3,0,3,2,1,2,3]);
  // Only vertices referenced by an actual triangle are material geometry.
  function paged(words){
    const t=device.createTexture({size:[4,2,2],format:'r32uint',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
    textures.push(t);const bytes=new Uint32Array(16);bytes.set(words);
    device.queue.writeTexture({texture:t},bytes,{bytesPerRow:16,rowsPerImage:2},[4,2,2]);
    return {view:t.createView({dimension:'2d-array'})};
  }
  try{
    const fields=[{storage:'buffer',positions:gpu.buffer('Indexed extent points',v),indices:gpu.buffer('Active triangles',indices)},
      {storage:'texture',positions:paged(new Uint32Array(v.buffer)),indices:paged(indices)}];
    const meshes=Array.from({length:259},(_,i)=>({...fields[i%2],triangleCount:i===3?0:4,
      matrix:[.00073,-.00044,.00026,0,.00022,-.0011,.00061,0,-.00051,.00033,-.00087,0,
        i%7===0?35123.401:.0031*i,-.32+.008*i,.19-.003*i,1]}));
    const actual=await nativeSurfaceMeasures(device,{meshes,assertCurrent(){}},true);
    let maxBoundsErrorM=0,radius=0;
    for(const [i,m] of meshes.entries()){
      if(!m.triangleCount){if(actual.bounds[i]!==null)throw Error('An empty occurrence acquired bounds.');continue;}
      const p=[...new Set(indices)].map(k=>[0,1,2].map(a=>m.matrix[12+a]+[0,1,2].reduce((sum,j)=>sum+v[3*k+j]*m.matrix[4*j+a],0)));
      for(let a=0;a<3;a++)for(const [key,fn] of [['min',Math.min],['max',Math.max]]){
        const ref=fn(...p.map(x=>x[a]));maxBoundsErrorM=Math.max(maxBoundsErrorM,Math.abs(actual.bounds[i][key][a]-ref));
      }
      radius=Math.max(radius,...p.map(x=>Math.hypot(x[1],x[2])));
    }
    const call=(name,args={})=>frameAI.call(name,args),ctx=researchSceneContext(frameEngine),speed=.030;
    await call('scene.new');const box=await call('scene.create',{type:'cfd',params:{Speed:speed}});
    const sphere=await call('scene.create',{type:'sphere',params:{diameter:80,'angle approximation':10}});
    await call('transform.apply',{ids:[sphere.hash],position:[.73,499.61,1.13],rotation:[13,17,19]});
    await call('diagnostics.frame',{frames:2});
    const capture=captureFlowSurfaces(device,ctx,box.hash),b=capture.meshes[0].bounds;
    const conservativeM=Math.max(...b.max.map((x,i)=>x-b.min[i]));
    const op=(operation,args={})=>call('plugins.command',{id:box.hash,operation,args});
    await op('solve-frame',{fidelityBudget:'preview'});
    const start=performance.now();let result;
    for(;;){
      await new Promise(ok=>setTimeout(ok,80));const s=await op('results');result=s.result;
      if(result?.steps>0)break;
      if(!['queued','solving'].includes(s.state)||performance.now()-start>60000)throw Error('Physical extent '+JSON.stringify(s.job));
    }
    await op('stop');
    const extent=result.validity.geometryExtent,L=extent.characteristicLengthM,nu=mediumProperties('Air',0).nu;
    return {pass:maxBoundsErrorM<2e-8&&Math.abs(actual.diameterM/(2*radius)-1)<2e-6&&
      L>=.078&&L<=.0801&&conservativeM*speed/nu>200&&result.method==='laminar'&&result.reynolds<200&&
      Math.abs(result.reynolds-L*speed/nu)<1e-9&&result.validity.maxDivergencePerS<1e-6,
      bufferedAndPagedOccurrences:meshes.length,maxBoundsErrorM,sweptDiameterM:actual.diameterM,referenceDiameterM:2*radius,
      conservativeM,physicalExtent:extent,reynolds:result.reynolds,conservativeRe:conservativeM*speed/nu,
      method:result.method,mass:result.validity.maxDivergencePerS};
  }finally{for(const t of textures)t.destroy();gpu.close();}
}
