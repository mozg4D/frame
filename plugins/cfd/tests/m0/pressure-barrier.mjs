// Mark Cartesian pressure links whose center-to-center segment intersects
// an evaluated triangle. Surface winding and physical sheet thickness have
// no effect. Boundary-face storage has one bit for each positive axis.
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];

export function pressureBarriers(gpu,f,triangles,phase){
  const positions=gpu.buffer('CFD fixture vertices',triangles.vertices),indices=gpu.buffer('CFD fixture indices',triangles.indices);
  return meshPressureBarriers(gpu,f,[{storage:'buffer',positions,indices,matrix:identity,triangleCount:triangles.indices.length/3}],phase);
}

// Matrices map source positions to metres in the physical solver frame. Native
// mesh resources are borrowed. Only fixture geometry uses the upload above.
export async function meshPressureBarriers(gpu,f,meshes,phase,assertCurrent=()=>{}){
  const mask=gpu.buffer('CFD crossed Cartesian face bits',4*f.dims.reduce((a,b)=>a*b));
  const pipelines=new Map();
  for(const storage of new Set(meshes.map(m=>m.storage))){
    const source=storage==='texture'?`
      @group(0) @binding(0) var vertices:texture_2d_array<u32>;
      @group(0) @binding(1) var indices:texture_2d_array<u32>;
      fn scalar(t:texture_2d_array<u32>,i:u32)->u32{let d=textureDimensions(t);
        return textureLoad(t,vec2i(vec2u(i%d.x,i/d.x%d.y)),i32(i/(d.x*d.y)),0).x;}
      fn coord(i:u32)->f32{return bitcast<f32>(scalar(vertices,i));}fn vertex(i:u32)->u32{return scalar(indices,i);}`:`
      @group(0) @binding(0) var<storage,read> vertices:array<f32>;
      @group(0) @binding(1) var<storage,read> indices:array<u32>;
      fn coord(i:u32)->f32{return vertices[i];}fn vertex(i:u32)->u32{return indices[i];}`;
    const pipe=await gpu.kernel('CFD pressure crossings from '+storage,source+`
    @group(0) @binding(2) var<storage,read_write> mask:array<atomic<u32>>;
    @group(0) @binding(3) var<uniform> phase:vec2f;
    struct Occurrence {matrix:mat4x4f,count:u32};
    @group(0) @binding(4) var<uniform> mesh:Occurrence;
    const D=vec3i(${f.dims.join(',')});
    fn gridPoint(i:u32)->vec3f{
      let k=3u*vertex(i);let v=mesh.matrix*vec4f(coord(k),coord(k+1u),coord(k+2u),1.);
      let yz=vec2f(v.y*phase.x-v.z*phase.y,v.y*phase.y+v.z*phase.x);
      return (vec3f(v.x,yz)-vec3f(${f.origin.map(x=>x.toFixed(9)).join(',')}))/${f.h}-.5;
    }
    fn cross2(a:vec2f,b:vec2f)->f32{return a.x*b.y-a.y*b.x;}
    fn mark(p:vec3i,axis:u32){
      if(all(p>=vec3i(0))&&all(p<D)&&p[axis]+1<D[axis]){
        atomicOr(&mask[u32(p.x+D.x*(p.y+D.y*p.z))],1u<<axis);}
    }
    @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3u,@builtin(num_workgroups) groups:vec3u){
      let t=g.x+g.y*groups.x*64u;if(t>=mesh.count){return;}let i=3u*t;
      let a=gridPoint(i);let ab=gridPoint(i+1u)-a;let ac=gridPoint(i+2u)-a;
      for(var ax=0u;ax<3u;ax++){
        let u=(ax+1u)%3u;let v=(ax+2u)%3u;
        let e1=vec2f(ab[u],ab[v]);let e2=vec2f(ac[u],ac[v]);let det=cross2(e1,e2);
        if(abs(det)<1e-10){continue;}
        let origin=vec2f(a[u],a[v]);let dim=vec2i(D[u],D[v]);
        let low=max(vec2i(0),vec2i(ceil(origin+min(vec2f(0),min(e1,e2))-.00001)));
        let high=min(dim-1,vec2i(floor(origin+max(vec2f(0),max(e1,e2))+.00001)));
        for(var y=low.y;y<=high.y;y++){for(var x=low.x;x<=high.x;x++){
          let diff=vec2f(f32(x),f32(y))-origin;let s=cross2(diff,e2)/det;let t=cross2(e1,diff)/det;
          if(s<-.00001||t<-.00001||s+t>1.00001){continue;}
          let h=a[ax]+s*ab[ax]+t*ac[ax];var p=vec3i(0);p[u]=x;p[v]=y;p[ax]=i32(floor(h));
          mark(p,ax);if(abs(h-round(h))<.00001){p[ax]=i32(round(h))-1;mark(p,ax);p[ax]++;mark(p,ax);}
        }}
      }
    }`);
    pipelines.set(storage,pipe);
  }
  assertCurrent();
  const stride=Math.ceil(80/gpu.device.limits.minUniformBufferOffsetAlignment)*gpu.device.limits.minUniformBufferOffsetAlignment;
  const data=new ArrayBuffer(Math.max(1,meshes.length)*stride);
  meshes.forEach((mesh,i)=>{new Float32Array(data,i*stride,16).set(mesh.matrix);new Uint32Array(data,i*stride+64,1)[0]=mesh.triangleCount;});
  const settings=gpu.buffer('CFD captured surface transforms',new Uint8Array(data),GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
  const draws=meshes.map((mesh,i)=>{
    const pipe=pipelines.get(mesh.storage),paged=mesh.storage==='texture';
    const resources=[paged?mesh.positions.view:{buffer:mesh.positions},paged?mesh.indices.view:{buffer:mesh.indices},{buffer:mask},{buffer:phase},{buffer:settings,offset:i*stride,size:80}];
    const group=gpu.device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:resources.map((resource,binding)=>({binding,resource}))});
    const count=Math.ceil(mesh.triangleCount/64),width=Math.min(count,gpu.device.limits.maxComputeWorkgroupsPerDimension);
    return {pipe,group,grid:[width,Math.ceil(count/width)]};
  });
  return {mask,assertCurrent,encode(e){assertCurrent();e.clearBuffer(mask);for(const d of draws)gpu.dispatch(e,d.pipe,d.group,d.grid);}};
}
