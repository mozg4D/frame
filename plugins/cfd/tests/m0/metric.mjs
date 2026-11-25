import {gpuScope} from './gpu.mjs';
import {geometryKernel} from './fixtures.mjs';

// Frame's directional solid field is positive inside. It seeds the native
// distance extension in grid cells. Consumers choose their own sign and units.
export async function extendNativeMetric(gpu,dims,packed,bandCells){
  const n=dims.reduce((a,b)=>a*b),device=gpu.device;
  const source=document.getElementById('frame-unite-filter').textContent;
  const [seed,extend]=await Promise.all(['seed','extend'].map(entry=>gpu.kernel('CFD native Unite '+entry,source,entry)));
  const settings=new ArrayBuffer(128);new Uint32Array(settings).set([...dims,n]);
  new Float32Array(settings).set([0,bandCells,2,0],28);
  const u=gpu.buffer('CFD native band configuration',new Uint8Array(settings),GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
  const a=gpu.buffer('CFD native distance A',n*4),b=gpu.buffer('CFD native distance B',n*4);
  const bind=(pipe,entries)=>device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:entries.map(([binding,buffer])=>({binding,resource:{buffer}}))});
  const groups=Math.ceil(n/64),grid=[Math.min(65535,groups),Math.ceil(groups/65535)];
  const e=device.createCommandEncoder();gpu.dispatch(e,seed,bind(seed,[[0,packed],[1,a],[5,u]]),grid);
  const ping=bind(extend,[[1,a],[2,b],[5,u]]),pong=bind(extend,[[1,b],[2,a],[5,u]]);
  for(let i=0;i<bandCells;i++)gpu.dispatch(e,extend,i%2?pong:ping,grid);
  device.queue.submit([e.finish()]);return bandCells%2?b:a;
}

// Exercise the actual Unite seed/extend WGSL. Its input is positive inside and
// its metric is in cells. The graph uses metres and the opposite sign.
export async function fixtureMetric(device,f){
  const gpu=gpuScope(device),started=performance.now(),n=f.dims.reduce((a,b)=>a*b);
  try{
    const geom=await geometryKernel(gpu,f,0);geom.update(0);
    const packed=gpu.buffer('CFD native band input',Math.ceil(n/2)*4);
    const prepare=await gpu.kernel('CFD fixture crossings for native metric',`
      @group(0) @binding(0) var<storage,read> wall:array<vec4f>;
      @group(0) @binding(1) var<storage,read_write> raw:array<u32>;
      fn val(i:u32)->u32{return u32(i32(round(clamp(-wall[i].x*4095.,-32767.,32767.))))&65535u;}
      @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
        let i=g.x*2u;if(i<${n}u){raw[g.x]=val(i)|(val(min(i+1u,${n-1}u))<<16u);}}`);
    gpu.run(prepare,[geom.wall,packed],[Math.ceil(n/256)]);
    const distance=await extendNativeMetric(gpu,f.dims,packed,20);
    const field=await gpu.read(distance,gpu.staging('CFD test-only metric readback',n*4),n);
    for(let i=0;i<n;i++)field[i]*=-f.h;
    return {...metricSampler(f,field),ms:performance.now()-started,peakGpuBytes:gpu.allocatedBytes,
      source:'frame-unite-filter/seed+extend',rangeM:20*f.h};
  }finally{gpu.close();}
}
export function metricSampler(f,field){
    const [nx,ny]=f.dims,h=f.h,origin=f.origin;
    function sample(p){
      const t=p.map((v,i)=>Math.max(0,Math.min(f.dims[i]-1.000001,(v-origin[i])/h-.5))),lo=t.map(Math.floor);
      const u=t.map((v,i)=>v-lo[i]);let d=0;
      for(let z=0;z<2;z++)for(let y=0;y<2;y++)for(let x=0;x<2;x++)
        d+=field[(lo[0]+x)+nx*(lo[1]+y+ny*(lo[2]+z))]*(x?u[0]:1-u[0])*(y?u[1]:1-u[1])*(z?u[2]:1-u[2]);
      if(f.surfaceBounds){
        const {min,max}=f.surfaceBounds;
        const dx=Math.max(0,min[0]-p[0],p[0]-max[0]),dy=Math.max(0,min[1]-p[1],p[1]-max[1]),dz=Math.max(0,min[2]-p[2],p[2]-max[2]);
        if(dx||dy||dz)d=Math.max(d,Math.hypot(dx,dy,dz));
      }
      return d;
    }
    function normal(p){
      const g=[0,1,2].map(k=>{const a=[...p],b=[...p];a[k]+=h*.4;b[k]-=h*.4;return sample(a)-sample(b);});
      const len=Math.hypot(...g);return len>1e-12?g.map(x=>x/len):null;
    }
    return {field,sample,normal,f};
}

// Within each interpolation cell a trilinear SDF restricted to a segment is
// cubic. Check its extrema as well as endpoints; endpoint or midpoint tests can
// miss a thin wall. A zero-thickness surface absent from the sampled field
// needs an independent crossing certificate.
export function crossesMetric(field,a,b){
  const delta=b.map((v,i)=>v-a[i]),cuts=[0,1],{h,origin}=field.f;
  for(let k=0;k<3;k++){
    if(Math.abs(delta[k])<1e-14)continue;
    const lo=(Math.min(a[k],b[k])-origin[k])/h-.5,hi=(Math.max(a[k],b[k])-origin[k])/h-.5;
    for(let q=Math.floor(lo)+1;q<hi;q++){const t=(origin[k]+(q+.5)*h-a[k])/delta[k];if(t>0&&t<1)cuts.push(t);}
  }
  cuts.sort((x,y)=>x-y);
  const val=t=>field.sample(a.map((x,k)=>x+t*delta[k]));
  const eps=h*1e-7;
  for(let i=1;i<cuts.length;i++){
    const l=cuts[i-1],d=cuts[i]-l;if(d<1e-12)continue;
    const y0=val(l),y1=val(l+d/3),y2=val(l+2*d/3),y3=val(l+d);
    if(Math.min(y0,y1,y2,y3)<-eps)return true;
    const aa=4.5*(-y0+3*y1-3*y2+y3),bb=4.5*(2*y0-5*y1+4*y2-y3),cc=y3-y0-aa-bb;
    const roots=[];
    if(Math.abs(aa)<1e-16){if(Math.abs(bb)>1e-16)roots.push(-cc/(2*bb));}
    else {const disc=4*bb*bb-12*aa*cc;if(disc>=0)roots.push((-2*bb-Math.sqrt(disc))/(6*aa),(-2*bb+Math.sqrt(disc))/(6*aa));}
    for(const t of roots)if(t>0&&t<1&&((aa*t+bb)*t+cc)*t+y0 < -eps)return true;
  }
  return false;
}
