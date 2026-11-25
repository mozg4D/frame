import {gpuScope} from './gpu.mjs';
import {gridWGSL} from './fixtures.mjs';
import {metricBuffer,metricWGSL,cellCenter,gradedAxis} from './rectilinear.mjs';

// Unite's signed metric is accurate in its finite reconstruction band.
// Turbulence also needs a wall distance throughout the wake. Propagate
// physical surface points over the graded grid and retain the native near field.
export async function extendWallDistance(gpu,f,wall,bandWidth){
  const n=f.dims.reduce((a,b)=>a*b),grid=[Math.ceil(n/128)],metric=metricBuffer(gpu,f);
  const points=[0,1].map(i=>gpu.buffer('CFD physical nearest-wall points '+i,n*16));
  const base=gridWGSL(f)+metricWGSL(f);
  const stations=(b,name,write=false)=>`@group(0) @binding(${b}) var<storage,${write?'read_write':'read'}> ${name}:array<vec4f>;`;
  const main=s=>`@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
    let i=g.x;if(i>=CELLS){return;}let p=point(i);let x=cellCenters(p);${s}}`;
  const pin=.65*bandWidth;
  const seed=await gpu.kernel('CFD surface foot in the native distance band',base+stations(0,'wall')+stations(1,'near',true)+main(`
    let d=wall[i].x;var value=vec4f(0);
    if(abs(d)<${pin}){
      var grad=vec3f(0);
      for(var a=0u;a<3u;a++){var q=p;var r=p;q[a]=max(p[a]-1,0);r[a]=min(p[a]+1,DIMS[a]-1);
        let dx=axisMetric(a,r[a]).x-axisMetric(a,q[a]).x;
        grad[a]=(wall[index(r)].x-wall[index(q)].x)/max(dx,1e-20);}
      if(dot(grad,grad)>.04){value=vec4f(x-d*normalize(grad),1.);}
    }near[i]=value;`));
  const jump=await gpu.kernel('CFD propagate nearest surface coordinates',base+stations(0,'src')+stations(1,'dst',true)+
    '@group(0) @binding(2) var<uniform> stride:vec4i;'+main(`
    var best=src[i];var d=select(3e38,dot(best.xyz-x,best.xyz-x),best.w>0.);
    for(var z=-1;z<=1;z++){for(var y=-1;y<=1;y++){for(var a=-1;a<=1;a++){
      let q=p+stride.x*vec3i(a,y,z);if(!inside(q)){continue;}
      let s=src[index(q)];let a2=dot(x-s.xyz,x-s.xyz);
      if(s.w>0.&&a2<d){d=a2;best=s;}
    }}}dst[i]=best;`));
  const finish=await gpu.kernel('CFD exterior wall distance for turbulence',base+stations(0,'near')+stations(1,'wall',true)+main(`
    let w=wall[i];if(w.x<=${pin}||near[i].w==0.){return;}
    let d=distance(x,near[i].xyz);let a=smoothstep(${pin},${.9*bandWidth},w.x);
    wall[i]=vec4f(mix(w.x,d,a),w.yzw);`));
  const strides=[];for(let k=2**Math.floor(Math.log2(Math.max(...f.dims)-1));k>=1;k/=2)strides.push(k);
  strides.push(1,1);
  const e=gpu.device.createCommandEncoder();
  gpu.dispatch(e,seed,gpu.bind(seed,[wall,points[0]],metric),grid);
  for(const [i,k] of strides.entries()){
    const step=gpu.buffer('CFD wall propagation stride',new Int32Array([k,0,0,0]),GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
    gpu.dispatch(e,jump,gpu.bind(jump,[points[i%2],points[1-i%2],step],metric),grid);
  }
  gpu.dispatch(e,finish,gpu.bind(finish,[points[strides.length%2],wall],metric),grid);
  gpu.device.queue.submit([e.finish()]);await gpu.device.queue.onSubmittedWorkDone();
  return {propagationPasses:strides.length,preservedBandM:pin*f.h};
}

export async function verifyWallDistance(device){
  const gpu=gpuScope(device);
  try{
    const axes=[0,1,2].map(()=>gradedAxis(-1,1,-.35,.35,.044));
    const f={dims:axes.map(a=>a.length-1),origin:[-1,-1,-1],axes,h:.044};
    const n=f.dims.reduce((a,b)=>a*b),data=new Float32Array(4*n),exact=new Float64Array(n),band=.15/f.h;
    const [nx,ny]=f.dims,center=[.017,-.023,.033],radius=.29;
    for(let i=0;i<n;i++){
      const id=[i%nx,Math.floor(i/nx)%ny,Math.floor(i/(nx*ny))];
      exact[i]=(Math.hypot(...id.map((j,a)=>cellCenter(f,a,j)-center[a]))-radius)/f.h;
      data[4*i]=Math.max(-band,Math.min(band,exact[i]));data[4*i+1]=.3;data[4*i+2]=-.4;data[4*i+3]=.81;
    }
    const wall=gpu.buffer('CFD clipped exact sphere distances',data);
    const result=await extendWallDistance(gpu,f,wall,band);
    const values=await gpu.read(wall,gpu.staging('CFD analytic wake distances',data.byteLength),data.length);
    let maxErrorM=0,rms=0,count=0,pins=true,components=true;
    for(let i=0;i<n;i++){
      if(data[4*i]<=.65*band)pins&&=values[4*i]===data[4*i];
      if(exact[i]>band){const error=Math.abs(values[4*i]-exact[i])*f.h;
        maxErrorM=Math.max(maxErrorM,error);rms+=error**2;count++;}
      for(let k=1;k<4;k++)components&&=values[4*i+k]===data[4*i+k];
    }
    return {...result,samples:count,maxErrorM,rmsErrorM:Math.sqrt(rms/count),pinnedSamplesExact:pins,wallDataPreserved:components,
      pass:count>1000&&pins&&components&&maxErrorM<.15*f.h};
  }finally{gpu.close();}
}
