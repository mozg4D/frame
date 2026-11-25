import {gpuScope} from './gpu.mjs';
import {meshReader,meshResources} from './pressure-barrier.mjs';

// Spread the actual unoriented area moment n n^T of every exposed native
// triangle. Opposite sides of a thin blade add, even when the signed-distance
// raster contains no negative sample between them. The hat basis integrates
// area and its first moment and removes any dependence on imported winding.
export async function latticeSurface(gpu,f,capture,band,metric){
  const {device}=gpu,scratch=gpuScope(device),spacing=.5*f.h;
  if(!capture.meshes.length)return {table:gpu.buffer('CFD empty material surface',8*32),origin:f.origin,dims:[2,2,2],spacing};
  const origin=[0,1,2].map(a=>capture.meshes.reduce((x,m)=>Math.min(x,m.bounds.min[a]),Infinity)-3*f.h);
  const dims=origin.map((x,a)=>Math.ceil((capture.meshes.reduce((v,m)=>Math.max(v,m.bounds.max[a]),-Infinity)+3*f.h-x)/spacing)+1);
  const n=dims.reduce((a,b)=>a*b);
  if(!Number.isSafeInteger(n)||n<1||32*n>device.limits.maxStorageBufferBindingSize)throw Error('Native lattice surface field exceeds the device binding limit');
  try{
    const a=scratch.buffer('CFD scattered native surface moments',32*n),b=scratch.buffer('CFD filtered native surface moments',32*n);
    const out=gpu.buffer('CFD material area tensor',32*n),cache=new Map();
    const common=`const D=vec3i(${dims});const ORIGIN=vec3f(${origin});const DX=f32(${spacing});
      fn idx(p:vec3i)->u32{return u32(p.x+D.x*(p.y+D.y*p.z));}`;
    for(const mesh of capture.meshes){
      if(!cache.has(mesh.storage))cache.set(mesh.storage,await scratch.kernel('CFD integrate native triangle area moments',meshReader(mesh.storage)+common+`
        struct Pose{m:mat4x4f,first:u32,count:u32}
        @group(0) @binding(2) var<uniform> pose:Pose;
        @group(0) @binding(3) var<storage,read> metric:array<f32>;
        @group(0) @binding(4) var<storage,read_write> table:array<atomic<u32>>;
        const BD=vec3i(${band.dims});
        fn signedDistance(p:vec3f)->f32{
          let v=(p-vec3f(${band.origin}))/${band.h};
          if(any(v<vec3f(0))||any(v>vec3f(BD-1))){return 12.*${band.h};}
          let base=vec3i(floor(v));let t=fract(v);var s=0.;
          for(var k=0;k<8;k++){let d=vec3i(k&1,(k>>1)&1,k>>2);let p1=min(BD-1,base+d);
            let w=select(1.-t,t,d==vec3i(1));s+=w.x*w.y*w.z*metric[u32(p1.x+BD.x*(p1.y+BD.y*p1.z))];}
          return -s*${band.h};
        }
        fn add(k:u32,v:f32){var old=atomicLoad(&table[k]);loop{
          let update=atomicCompareExchangeWeak(&table[k],old,bitcast<u32>(bitcast<f32>(old)+v));
          if(update.exchanged){break;}old=update.old_value;}}
        fn deposit(p:vec3f,n:vec3f,area:f32){
          if(max(signedDistance(p+${band.h}*n),signedDistance(p-${band.h}*n))<${-.25*band.h}){return;}
          let v=(p-ORIGIN)/DX;let base=vec3i(floor(v));let t=fract(v);
          for(var k=0;k<8;k++){let d=vec3i(k&1,(k>>1)&1,k>>2);let w=select(1.-t,t,d==vec3i(1));
            let wij=w.x*w.y*w.z*area;let j=8u*idx(base+d);if(wij<=0.){continue;}
            let diag=wij*n*n;let off=wij*vec3f(n.x*n.y,n.x*n.z,n.y*n.z);
            for(var q=0u;q<3u;q++){add(j+q,diag[q]);add(j+4u+q,off[q]);}
          }}
        @compute @workgroup_size(64) fn main(@builtin(workgroup_id) g:vec3u,@builtin(local_invocation_index) lane:u32){
          let tri=3u*(pose.first+g.x);let a=(pose.m*vec4f(sourcePoint(tri),1)).xyz;
          let b=(pose.m*vec4f(sourcePoint(tri+1u),1)).xyz;let c=(pose.m*vec4f(sourcePoint(tri+2u),1)).xyz;
          let u=b-a;let v=c-a;let crossArea=cross(u,v);let size=length(crossArea);if(size==0.){return;}
          let m=max(1u,u32(ceil(max(length(u),max(length(v),length(c-b)))/DX)));
          let normal=crossArea/size;let area=size/(2.*${f.h**2}*f32(m)*f32(m));
          for(var j=lane;j<m*m;j+=64u){let x=j%m;let y=j/m;if(x+y>=m){continue;}
            let p=a+(f32(x)*u+f32(y)*v)/f32(m);let step=(u+v)/(3.*f32(m));
            deposit(p+step,normal,area);if(x+y+1u<m){deposit(p+2.*step,normal,area);}
          }
        }`));
      const pipe=cache.get(mesh.storage);
      for(let first=0;first<mesh.triangleCount;first+=2048){
        const count=Math.min(mesh.triangleCount-first,2048),data=new ArrayBuffer(80);
        new Float32Array(data,0,16).set(mesh.matrix);new Uint32Array(data,64,2).set([first,count]);
        const pose=scratch.buffer('CFD lattice surface pose',new Uint8Array(data),GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
        const resources=[...meshResources(mesh),...[pose,metric,a].map(buffer=>({buffer}))];
        const group=device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:resources.map((resource,binding)=>({binding,resource}))});
        capture.assertCurrent();const e=device.createCommandEncoder();scratch.dispatch(e,pipe,group,[count]);device.queue.submit([e.finish()]);
        await device.queue.onSubmittedWorkDone();
      }
    }
    // At half lattice spacing these are samples of the physical unit hat
    // centred on each deposited quadrature point. Three separable passes
    // retain sum(area) * h and the exact material surface centroid.
    for(let axis=0;axis<3;axis++){
      const pipe=await scratch.kernel('CFD spread surface area along material axis '+axis,common+`
        struct Tensor{diag:vec4f,off:vec4f}
        @group(0) @binding(0) var<storage,read> src:array<Tensor>;
        @group(0) @binding(1) var<storage,read_write> dst:array<Tensor>;
        @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
          let i=g.x;if(i>=arrayLength(&dst)){return;}let p=vec3i(i32(i)%D.x,(i32(i)/D.x)%D.y,i32(i)/(D.x*D.y));
          var s=src[i];var dir=vec3i(0);dir[${axis}]=1;
          for(var side=-1;side<=1;side+=2){let q=p+side*dir;if(all(q>=vec3i(0))&&all(q<D)){
            let t=src[idx(q)];s.diag+=.5*t.diag;s.off+=.5*t.off;}}dst[i]=s;
        }`);
      scratch.run(pipe,axis===0?[a,b]:axis===1?[b,a]:[a,out],[Math.ceil(n/128)]);
    }
    await device.queue.onSubmittedWorkDone();capture.assertCurrent();
    return {table:out,origin,dims,spacing};
  }finally{scratch.close();}
}
