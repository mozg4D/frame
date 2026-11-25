import {gridWGSL} from './fixtures.mjs';

// Add exact Dirichlet subdomain solves on the bricks touched by a cut.
// Numerical rows alone cross to the setup worker, in bounded batches.
export async function cutPressureBlocks(gpu,f,faces,coeff){
  const tiles=f.dims.map(n=>n/4),nTiles=tiles.reduce((a,b)=>a*b);
  const head=gridWGSL(f)+`
    fn brickBase(b:u32)->vec3i{return 4*vec3i(i32(b%${tiles[0]}u),i32((b/${tiles[0]}u)%${tiles[1]}u),i32(b/${tiles[0]*tiles[1]}u));}
    fn offset(k:u32)->vec3i{return vec3i(i32(k&3u),i32((k>>2u)&3u),i32(k>>4u));}`;
  const list=gpu.buffer('CFD active boundary brick indices',4*(nTiles+1));
  const find=await gpu.kernel('CFD collect pressure bricks at cut walls',head+`
    @group(0) @binding(0) var<storage,read> faces:array<vec4f>;
    @group(0) @binding(1) var<storage,read_write> list:array<atomic<u32>>;
    var<workgroup> cut:atomic<u32>;
    @compute @workgroup_size(64) fn main(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) k:u32){
      let b=group.x+${tiles[0]}u*(group.y+${tiles[1]}u*group.z);let p=brickBase(b)+offset(k);let m=faces[index(p)];
      if(m.w>0.){var near=m.w<1.||any(m.xyz<vec3f(1));
        for(var a=0u;a<3u;a++){var q=p;q[a]--;if(inside(q)){near=near||faces[index(q)][a]<1.;}}
        if(near){atomicStore(&cut,1u);}}
      workgroupBarrier();if(k==0u&&atomicLoad(&cut)!=0u){let j=atomicAdd(&list[0],1u);atomicStore(&list[1u+j],b);}
    }`);
  gpu.run(find,[faces,list],tiles);
  const stage=gpu.staging('CFD pressure brick indices readback',list.size);
  const count=new Uint32Array((await gpu.read(list,stage,1)).buffer)[0];
  if(!count)return null;
  // Keep this additive acceleration bounded for highly fragmented scenes.
  // The regular multigrid/Krylov operator still uses every cut face.
  const byteBudget=Math.min(gpu.device.limits.maxBufferSize,Math.max(16*1024**2,16*f.dims.reduce((a,b)=>a*b)));
  if(count*16384>byteBudget)return null;
  const selected=new Uint32Array((await gpu.read(list,stage,count+1)).buffer).subarray(1);
  const pack=await gpu.kernel('CFD boundary brick pressure matrices',head+`
    @group(0) @binding(0) var<storage,read> bricks:array<u32>;
    @group(0) @binding(1) var<storage,read> c:array<vec4f>;
    @group(0) @binding(2) var<storage,read_write> rows:array<vec4f>;
    @compute @workgroup_size(64) fn main(@builtin(workgroup_id) g:vec3u,@builtin(local_invocation_index) k:u32){
      let off=offset(k);let p=brickBase(bricks[g.x])+off;let i=index(p);var row=vec4f(0,0,0,c[i].w);
      for(var a=0u;a<3u;a++){for(var side=-1;side<=1;side+=2){var q=p;q[a]+=side;if(!inside(q)){continue;}
        let weight=c[select(index(q),i,side>0)][a];
        if(off[a]+side<0||off[a]+side>3){row.w+=weight;}else if(side>0){row[a]=weight;}
      }}rows[g.x*64u+k]=row;
    }`);
  const apply=await gpu.kernel('CFD exact cut-brick pressure correction',head+`
    @group(0) @binding(0) var<storage,read> bricks:array<u32>;
    @group(0) @binding(1) var<storage,read> inverse:array<f32>;
    @group(0) @binding(2) var<storage,read> r:array<f32>;
    @group(0) @binding(3) var<storage,read_write> z:array<f32>;
    var<workgroup> v:array<f32,64>;
    @compute @workgroup_size(64) fn main(@builtin(workgroup_id) g:vec3u,@builtin(local_invocation_index) k:u32){
      let i=index(brickBase(bricks[g.x])+offset(k));v[k]=r[i];workgroupBarrier();var s=0.;
      for(var j=0u;j<64u;j++){s+=inverse[g.x*4096u+j*64u+k]*v[j];}z[i]+=s;
    }`);
  const batch=Math.min(count,128,Math.floor(gpu.device.limits.maxStorageBufferBindingSize/16384));
  const rows=gpu.buffer('CFD temporary cut-brick rows',batch*1024),read=gpu.staging('CFD boundary stencil readback',rows.size);
  const worker=new Worker(new URL('./cut-block-factor.mjs',import.meta.url),{type:'module'}),parts=[];
  try{
    for(let j=0;j<count;j+=batch){
      const take=Math.min(count-j,batch),indices=gpu.buffer('CFD cut-brick origins',selected.subarray(j,j+take));
      gpu.run(pack,[indices,coeff,rows],[take]);const data=await gpu.read(rows,read,take*256);
      const inverse=await new Promise((ok,no)=>{
        worker.onmessage=({data})=>data.error?no(Error(data.error)):ok(new Float32Array(data));
        worker.onerror=e=>no(Error(e.message));worker.postMessage(data.buffer,[data.buffer]);
      });
      parts.push({indices,weights:gpu.buffer('CFD factored cut-brick inverse',inverse),take});
    }
  }finally{worker.terminate();}
  return {count,binding(r,z){
    const groups=parts.map(part=>[gpu.bind(apply,[part.indices,part.weights,r,z]),[part.take]]);
    return e=>{for(const [bind,grid] of groups)gpu.dispatch(e,apply,bind,grid);};
  }};
}
