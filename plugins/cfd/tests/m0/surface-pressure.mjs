import {gridWGSL} from './fixtures.mjs';
import {metricWGSL,metricBuffer} from './rectilinear.mjs';
import {meshReader,meshResources} from './pressure-barrier.mjs';

// Independent surface integral of the solved pressure. The native signed
// union orients the geometric triangle normal and excludes buried area. Two
// trilinear samples on the exterior normal reproduce an affine pressure at
// the wall. Each sample requires eight fully liquid, outward-side centres.
export async function surfacePressure(gpu,f,capture,band,distance,mobility){
  const device=gpu.device,coords=metricBuffer(gpu,f),n=f.dims.reduce((a,b)=>a*b),mean=gpu.buffer('CFD accumulated fluid pressure',4*n);
  const geometry=gridWGSL(f)+metricWGSL(f),siteType='struct Site{point:vec4f,normal:vec4f,near:vec4f,far:vec4f}';
  const cache=new Map(),chunks=[];
  const sample=await gpu.kernel('CFD accumulate pressure on physical time steps',`
    @group(0) @binding(0) var<storage,read> p:array<f32>;@group(0) @binding(1) var<storage,read_write> sum:array<f32>;
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){if(g.x<arrayLength(&sum)){sum[g.x]+=p[g.x];}}`);
  const origin=f.origin.map(v=>Number(v).toPrecision(12)).join(','),h=f.h;
  const shader=siteType+geometry+`
    struct Pose{m:mat4x4f,first:u32,triangles:u32}
    @group(0) @binding(2) var<storage,read> sdf:array<f32>;
    @group(0) @binding(3) var<storage,read> mu:array<vec4f>;
    @group(0) @binding(4) var<storage,read_write> site:array<Site>;
    @group(0) @binding(5) var<uniform> pose:Pose;
    const ORIGIN=vec3f(${origin});const H=f32(${h});
    const BAND=vec3i(${band.dims});const DX=f32(${band.h});
    fn signedDistance(x:vec3f)->f32{
      let p=(x-vec3f(${band.origin.join(',')}))/DX;if(any(p<vec3f(0))||any(p>=vec3f(BAND-1))){return 12.*DX;}
      let base=vec3i(floor(p));let frac=fract(p);var s=0.;for(var k=0;k<8;k++){
        let d=vec3i(k&1,(k>>1)&1,k>>2);let j=base+d;let w=select(1.-frac,frac,d==vec3i(1));
        s+=w.x*w.y*w.z*sdf[j.x+BAND.x*(j.y+BAND.y*j.z)];}return -DX*s;
    }
    fn left(a:u32,v:f32)->i32{var low=0;var high=DIMS[a]-1;
      while(low+1<high){let m=(low+high)/2;if(axisMetric(a,m).x<=v){low=m;}else{high=m;}}return low;}
    fn stencil(point:vec3f,n:vec3f,t:f32)->vec4f{
      let p=(point+t*n-ORIGIN)/H;let l=vec3i(left(0u,p.x),left(1u,p.y),left(2u,p.z));let center=cellCenters(l);
      let frac=(p-center)/(cellCenters(l+1)-center);if(any(frac<vec3f(0))||any(frac>vec3f(1))){return vec4f(-1);}
      for(var k=0;k<8;k++){let q=l+vec3i(k&1,(k>>1)&1,k>>2);let v=ORIGIN+H*cellCenters(q);
        if(mu[index(q)].w<.999999||dot(v-point,n)<-1e-5*H||signedDistance(v)<0.){return vec4f(-1);}
      }return vec4f(frac,bitcast<f32>(index(l)));
    }
    @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3u){
      let i=g.x;if(i>=3u*pose.triangles){return;}let tri=pose.first+i/3u;
      let a=(pose.m*vec4f(sourcePoint(3u*tri),1)).xyz;let b=(pose.m*vec4f(sourcePoint(3u*tri+1u),1)).xyz;
      let c=(pose.m*vec4f(sourcePoint(3u*tri+2u),1)).xyz;
      let ab=b-a;let ac=c-a;let crossArea=cross(ab,ac);let area=length(crossArea)/6.;if(area<=0.){return;}
      let q=i%3u;let x=a+ab*select(1./6.,2./3.,q==1u)+ac*select(1./6.,2./3.,q==2u);
      var n=crossArea/(6.*area);var s:Site;s.point=vec4f(x,area);
      let l=signedDistance(x-.8*DX*n);let r=signedDistance(x+.8*DX*n);
      if(max(l,r)<-.25*DX){s.normal.w=-1.;site[i]=s;return;}
      if(abs(l-r)<.08*DX){s.normal.w=-2.;site[i]=s;return;}
      if(r<l){n=-n;}s.normal=vec4f(n,-3.);
      let p=(x-ORIGIN)/H;let base=vec3i(left(0u,p.x),left(1u,p.y),left(2u,p.z));
      let normalPitch=H/max(length(n/cellWidths(base)),1e-12);var found=false;var first=0.;
      for(var k=1;k<=18;k++){
        let t=.4*f32(k)*normalPitch;if(signedDistance(x+t*n)<-.15*DX){break;}
        if(found&&t-first<.98*normalPitch){continue;}
        let v=stencil(x,n,t);if(v.x<0.){continue;}
        if(!found){s.near=v;first=t;found=true;}else{s.far=v;s.normal.w=first/(t-first);break;}
      }site[i]=s;
    }`;
  const integrate=await gpu.kernel('CFD integrate traction on native triangles',geometry+siteType+`
    struct Estimate{load:vec4f,areas:vec4f,closure:vec4f}
    @group(0) @binding(0) var<storage,read> site:array<Site>;
    @group(0) @binding(1) var<storage,read> p:array<f32>;
    @group(0) @binding(2) var<storage,read_write> out:array<Estimate>;
    var<workgroup> local:array<Estimate,64>;
    fn pressure(s:vec4f)->f32{let base=bitcast<u32>(s.w);var v=0.;
      for(var k=0u;k<8u;k++){let d=vec3u(k&1u,(k>>1u)&1u,k>>2u);
        let w=select(1.-s.xyz,s.xyz,d==vec3u(1));v+=w.x*w.y*w.z*p[base+d.x+NX*(d.y+NY*d.z)];}return v;}
    @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3u,@builtin(local_invocation_index) k:u32,@builtin(workgroup_id) id:vec3u){
      var v:Estimate;if(g.x<arrayLength(&site)){let s=site[g.x];let area=s.point.w;let code=s.normal.w;
        if(code>=0.&&area>0.){let p1=pressure(s.near);let p2=pressure(s.far);let change=code*(p1-p2);
          let F=-area*(p1+change)*s.normal.xyz;v.load=vec4f(F,cross(s.point.xyz,F).x);
          v.closure=vec4f(area*s.normal.xyz,area*abs(change));v.areas.x=area;
        }else if(code==-1.){v.areas.y=area;}else if(code==-2.){v.areas.z=area;}else{v.areas.w=area;}
      }local[k]=v;for(var stride=32u;stride>0u;stride/=2u){workgroupBarrier();if(k<stride){
        let other=local[k+stride];local[k].load+=other.load;local[k].areas+=other.areas;local[k].closure+=other.closure;}}
      if(k==0u){out[id.x]=local[0];}
    }`);
  // Bound geometry submissions and per-binding storage independently of
  // source triangle count. The renderer owns buffer and paged mesh storage.
  for(const mesh of capture.meshes){
    if(!cache.has(mesh.storage))cache.set(mesh.storage,await gpu.kernel('CFD one-sided pressure stencils on native skin',meshReader(mesh.storage)+shader));
    const pipe=cache.get(mesh.storage);
    for(let first=0;first<mesh.triangleCount;first+=4096){
      const triangles=Math.min(4096,mesh.triangleCount-first),sites=3*triangles,groups=Math.ceil(sites/64),uniform=new ArrayBuffer(80);
      new Float32Array(uniform,0,16).set(mesh.matrix);new Uint32Array(uniform,64,2).set([first,triangles]);
      const pose=gpu.buffer('CFD pressure sampling pose',new Uint8Array(uniform),GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
      const s=gpu.buffer('CFD one-sided pressure samples',64*sites),result=gpu.buffer('CFD native pressure integral',48*groups);
      const resources=[...meshResources(mesh),...[distance,mobility,s,pose].map(buffer=>({buffer}))];
      const entries=resources.map((resource,binding)=>({binding,resource}));if(coords)entries.push({binding:12,resource:{buffer:coords}});
      const bind=device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries});
      capture.assertCurrent();const e=device.createCommandEncoder();gpu.dispatch(e,pipe,bind,[groups]);device.queue.submit([e.finish()]);
      chunks.push({result,groups,bind:gpu.bind(integrate,[s,mean,result])});
    }
  }
  const stage=gpu.staging('CFD native pressure integral reductions',Math.max(48,...chunks.map(c=>c.result.size)));
  return {mean,bind(p){const group=gpu.bind(sample,[p,mean]);return e=>gpu.dispatch(e,sample,group,[Math.ceil(n/128)]);},
    async measure(scale,omega){
      const sum=new Float64Array(12);capture.assertCurrent();
      const e=device.createCommandEncoder();for(const c of chunks)gpu.dispatch(e,integrate,c.bind,[c.groups]);device.queue.submit([e.finish()]);
      for(const c of chunks){const data=await gpu.read(c.result,stage,c.result.size/4);for(let k=0;k<data.length;k++)sum[k%12]+=data[k];}
      capture.assertCurrent();
      return {pressureForceN:[...sum.slice(0,3)].map(v=>v*scale),pressureTorqueXNm:sum[3]*scale,pressureShaftPowerW:-omega*sum[3]*scale,
        sampledAreaM2:sum[4],buriedAreaM2:sum[5],unorientedAreaM2:sum[6],missingStencilAreaM2:sum[7],areaVectorM2:[...sum.slice(8,11)],
        absoluteExtrapolationIntegralN:sum[11]*scale};
    }};
}
