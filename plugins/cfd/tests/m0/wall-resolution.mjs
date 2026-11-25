import {gridWGSL} from './fixtures.mjs';
import {metricBuffer,metricWGSL} from './rectilinear.mjs';
import {wallResistanceWGSL} from './wall-law.mjs';

// Read bounded slabs of numerical samples. Compare grid resolutions by
// physical body-wall area at a given y+, independently of the number of cells.
export async function cutWallResolution(gpu,f,dt,state,wall,mu){
  const n=f.dims.reduce((a,b)=>a*b),chunk=Math.min(n,32768),nu=f.nu*dt/f.h**2;
  const sample=gpu.buffer('CFD area and physical wall y+',8*n),stage=gpu.staging('CFD bounded wall-resolution sample',8*chunk);
  const op=await gpu.kernel('CFD area-weighted wall resolution',gridWGSL(f)+metricWGSL(f)+wallResistanceWGSL+`
    @group(0) @binding(0) var<storage,read> state:array<vec4f>;@group(0) @binding(1) var<storage,read> wall:array<vec4f>;
    @group(0) @binding(2) var<storage,read> mu:array<vec4f>;@group(0) @binding(3) var<storage,read_write> out:array<vec2f>;
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
      let i=g.x;if(i>=CELLS||mu[i].w<=0.){return;}let p=point(i);
      let w=cellWidths(p);let a=faceAreas(w);var surface=vec3f(0);var grad=vec3f(0);
      for(var axis=0u;axis<3u;axis++){for(var side=-1;side<=1;side+=2){
        var q=p;q[axis]+=side;if(!inside(q)){continue;}let j=index(q);
        surface[axis]-=f32(side)*(1.-mu[select(j,i,side>0)][axis])*a[axis];
        grad[axis]+=.5*f32(side)*(wall[j].x-wall[i].x)*spacingInv(axis,p[axis],side);
      }}
      let area=length(surface);if(area<=0.){return;}let normal=normalize(select(surface,grad,dot(grad,grad)>1e-12));
      let y=max(max(0.,wall[i].x),.5/length(normal/w));
      let arm=vec3f(${f.origin.join(',')})+(cellCenters(p)-max(0.,wall[i].x)*normal)*${f.h};
      let uw=vec3f(0.,-arm.z,arm.y)*${f.rotatingFrame?f.omega*dt/f.h:0};
      let u=length(tangentialSlip(state[2u*i].xyz-uw,normal));let friction=sqrt(u*wallResistance(u,y,${nu}));
      out[i]=vec2f(area*${f.h**2},y*friction/${nu});
    }`);
  gpu.run(op,[state,wall,mu,sample],[Math.ceil(n/128)],metricBuffer(gpu,f));
  const areas=new Float64Array(512);let total=0,belowOne=0,belowThirty=0,wallCells=0;
  for(let first=0;first<n;first+=chunk){
    const m=Math.min(chunk,n-first),e=gpu.device.createCommandEncoder();
    e.copyBufferToBuffer(sample,8*first,stage,0,8*m);gpu.device.queue.submit([e.finish()]);await stage.mapAsync(GPUMapMode.READ,0,8*m);
    try{const data=new Float32Array(stage.getMappedRange(0,8*m));
      for(let i=0;i<data.length;i+=2){const area=data[i],y=data[i+1];if(!area)continue;
        if(!Number.isFinite(area+y)||y<0)throw Error('Invalid wall resolution sample');
        const bin=Math.max(0,Math.min(511,Math.floor(16*Math.log2(Math.max(y,2**-12)))+192));
        areas[bin]+=area;total+=area;wallCells++;if(y<=1)belowOne+=area;if(y<=30)belowThirty+=area;
      }
    }finally{stage.unmap();}
  }
  if(!total)return null;
  const quantile=q=>{let s=0;for(let i=0;i<areas.length;i++){s+=areas[i];if(s>=q*total)return 2**((i-192+.5)/16);}return null;};
  return {areaM2:total,wallCells,yPlusP10:quantile(.1),yPlusP50:quantile(.5),yPlusP90:quantile(.9),
    fractionOfAreaAtMost1:belowOne/total,fractionOfAreaAtMost30:belowThirty/total};
}
