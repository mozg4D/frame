// Equidistribute the integral of 1 / local pitch. Outside the dense interval
// the pitch grows linearly with distance, giving gently graded physical cells.
export function gradedAxis(start,end,denseStart,denseEnd,pitch,growth=.16){
  if(![start,end,denseStart,denseEnd,pitch,growth].every(Number.isFinite)||end<=start||pitch<=0||growth<=0||denseEnd<denseStart)
    throw Error('Invalid rectilinear CFD spacing');
  const lo=Math.max(start,Math.min(end,denseStart)),hi=Math.max(start,Math.min(end,denseEnd));
  const left=Math.log1p(growth*(lo-start)/pitch)/growth,core=(hi-lo)/pitch;
  const total=left+core+Math.log1p(growth*(end-hi)/pitch)/growth;
  const n=8*Math.max(1,Math.ceil(total/8));
  return Float64Array.from({length:n+1},(_,i)=>{
    if(i===0)return start;if(i===n)return end;
    const t=i*total/n-left;
    if(t<0)return lo-pitch*Math.expm1(-growth*t)/growth;
    if(t<=core)return lo+pitch*t;
    return hi+pitch*Math.expm1(growth*(t-core))/growth;
  });
}

export function rectilinearDomain(f,bounds,pitches,cap){
  const end=f.origin.map((x,k)=>x+f.dims[k]*f.h),length=bounds.max.map((v,k)=>v-bounds.min[k]);
  const scale=Math.max(...length);
  let factor=1;
  for(;;){
    const axes=f.origin.map((x,k)=>{
      const target=pitches[k]*factor,pad=Math.max(2*target,.15*length[k]);
      const downstream=k===0?Math.min(scale,Math.max(4*target,length[k])):pad;
      return gradedAxis(x,end[k],bounds.min[k]-pad,bounds.max[k]+downstream,target);
    });
    const dims=axes.map(a=>a.length-1),cells=dims.reduce((a,b)=>a*b);
    if(cells<=cap){
      const minPitch=axes.map(a=>a.subarray(1).reduce((s,v,i)=>Math.min(s,v-a[i]),Infinity));
      return {...f,axes,dims,h:Math.min(...minPitch),minPitch,domainEnd:end};
    }
    factor*=Math.max(1.05,Math.cbrt(cells/cap));
  }
}

export function cellCenter(f,a,i){
  const axis=f.axes?.[a];
  return axis?(axis[i]+axis[i+1])*.5:f.origin[a]+(i+.5)*f.h;
}
export function cellWidth(f,a,i){
  const axis=f.axes?.[a];return axis?(axis[i+1]-axis[i])/f.h:1;
}

// A uniform binding stores one record per coordinate, independent of the
// number of cells. It doesn't consume one of the eight portable storage slots.
const sets=new WeakMap();
export function metricBuffer(gpu,f){
  if(!f.axes)return null;
  let cache=sets.get(gpu);if(!cache){cache=new WeakMap();sets.set(gpu,cache);}
  if(cache.has(f.axes))return cache.get(f.axes);
  const values=[];
  for(const [k,axis] of f.axes.entries())for(let i=0;i+1<axis.length;i++){
    const width=cellWidth(f,k,i),next=i+2<axis.length?cellWidth(f,k,i+1):width;
    const child=f.childAxes?.[k],fineSpan=child&&i+2<axis.length?(child[2*i+3]-child[2*i+1])/(2*f.h):0;
    values.push((cellCenter(f,k,i)-f.origin[k])/f.h,width,2/(width+next),2*fineSpan/(width+next));
  }
  const data=Float32Array.from(values);
  if(data.byteLength>gpu.device.limits.maxUniformBufferBindingSize)throw Error('CFD coordinate table exceeds the device binding limit');
  const buf=gpu.buffer('CFD Cartesian axis metrics',data,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
  cache.set(f.axes,buf);return buf;
}

export function metricWGSL(f){
  const [nx,ny,nz]=f.dims;
  return (f.axes?`@group(0) @binding(12) var<uniform> gridAxes:array<vec4f,${nx+ny+nz}>;
    fn axisMetric(a:u32,j:i32)->vec4f{
      let offset=select(select(0,${nx},a==1u),${nx+ny},a==2u);return gridAxes[u32(offset+j)];}`:
    'fn axisMetric(a:u32,j:i32)->vec4f{return vec4f(f32(j)+.5,1.,1.,0.);}')+`
    fn cellWidths(p:vec3i)->vec3f{return vec3f(axisMetric(0u,p.x).y,axisMetric(1u,p.y).y,axisMetric(2u,p.z).y);}
    fn cellCenters(p:vec3i)->vec3f{return vec3f(axisMetric(0u,p.x).x,axisMetric(1u,p.y).x,axisMetric(2u,p.z).x);}
    fn faceAreas(w:vec3f)->vec3f{return w.yzx*w.zxy;}
    fn spacingInv(a:u32,j:i32,side:i32)->f32{return axisMetric(a,j-select(1,0,side>0)).z;}
    `;
}
