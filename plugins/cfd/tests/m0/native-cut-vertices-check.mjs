import {captureFlowSurfaces,extendNativeMetric,gpuScope,nativeCutMetric,rasterize} from '../../plugin.js';
import {cuboid} from './cut-distance-check.mjs';
import {researchSceneContext} from './native-geometry.mjs';

export async function verifyNativeCutVertices(device){
  const band={h:.0037,dims:[30,29,25],origin:[-.0551,.4487,-.0431]},[nx,ny]=band.dims,n=band.dims.reduce((x,y)=>x*y);
  const body=cuboid([.0013,.5011,.0017],[.031,.024,.027],.403),work=new Float32Array(n);
  for(let i=0;i<n;i++){
    const p=[i%nx,Math.floor(i/nx)%ny,Math.floor(i/(nx*ny))].map((v,a)=>band.origin[a]+band.h*v);
    const dist=body.distance(p)/band.h;
    // The complete exact-depth portion is independent of the quantized
    // raster magnitudes. Include exterior, interior and oblique edge sites.
    if(Math.abs(dist)>.04&&Math.abs(dist)<1.25)work[i]=.53+.27*Math.sin(.29*i)+.18*Math.cos(67*p[0]-32*p[2]);
  }
  const call=(name,args={})=>frameAI.call(name,args);
  async function evaluate(storage,vertices,reverse=false){
    await call('scene.new');const owner=(await call('scene.create',{type:'cfd'})).hash;
    await call('mesh.create',{name:'Cut derivative specimen',vertices,indices:body.indices,storage});
    const gpu=gpuScope(device),capture=captureFlowSurfaces(device,researchSceneContext(frameEngine),owner);
    try{
      const original=await extendNativeMetric(gpu,band.dims,await rasterize(gpu,band,capture),12);
      const exact=await nativeCutMetric(gpu,band,capture,original);
      const stage=gpu.staging('Independent physical cut vertices',4*n),values=await gpu.read(exact.distance,stage,n);
      let gradient;
      if(reverse){
        const out=gpu.buffer('Logical native coordinate sensitivities',12*exact.shape.vertices);
        const range=gpu.buffer('All original vertices',new Uint32Array([0,exact.shape.vertices,0,0]),GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
        const seed=gpu.buffer('Signed surface metric objective',work),e=device.createCommandEncoder();
        exact.shape.scatter(e,seed,out,range);device.queue.submit([e.finish()]);gradient=await gpu.read(out,stage,out.size/4);
      }
      return {values,gradient,storage:capture.meshes[0].storage,samples:exact.shape.samples};
    }finally{gpu.close();}
  }
  const rows=[];
  for(const storage of ['auto','texture']){
    const base=await evaluate(storage,body.vertices,true);
    for(const [mode,objective] of ['single oblique corner','translation','opposite vertex stars'].entries()){
      const direction=body.vertices.map((x,k)=>{
        const a=k%3,id=Math.floor(k/3);
        if(mode===0)return id===5?[.69,-.31,.58][a]:0;
        if(mode===1)return [.57,-.42,.33][a];
        return (id===1?1:id===6?-.6:0)*[.36,.78,-.29][a];
      });
      const derivative=direction.reduce((sum,v,i)=>sum+.001*v*base.gradient[i],0),estimates=[];
      for(const stepMm of [.03,.015]){
        const minus=await evaluate(storage,body.vertices.map((v,k)=>v-stepMm*direction[k]));
        const plus=await evaluate(storage,body.vertices.map((v,k)=>v+stepMm*direction[k]));
        let total=0;for(let i=0;i<n;i++)total+=work[i]*(plus.values[i]-minus.values[i]);
        const secant=total/(2*stepMm);
        estimates.push({stepMm,secant,relativeError:Math.abs(secant-derivative)/Math.max(Math.abs(derivative),1e-8)});
      }
      rows.push({storage:base.storage,objective,samples:base.samples,derivative,estimates});
    }
  }
  return {pass:rows.every(r=>r.samples>0&&Number.isFinite(r.derivative)&&r.estimates.every(e=>e.relativeError<.035)),rows};
}
