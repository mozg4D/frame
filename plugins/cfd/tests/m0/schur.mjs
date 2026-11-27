import {blockBasis} from '../../plugin.js';

// The Dirichlet Green function G(i,j) is a sum of eight cosine transforms
// at the sums and differences of the endpoint coordinates (product-to-sum).
// Build this small table once instead of inverting a dense volume matrix.
function dirichletGreen(n){
  const l=n+1,k=l+1,cs=Array.from({length:k},(_,i)=>Float64Array.from({length:n},(_,j)=>Math.cos(Math.PI*i*(j+1)/l)));
  const ev=Float64Array.from({length:n},(_,j)=>4*Math.sin(Math.PI*(j+1)/(2*l))**2);
  const a=new Float64Array(k*n*n),b=new Float64Array(k*k*n),t=new Float64Array(k**3);
  for(let z=0;z<n;z++)for(let y=0;y<n;y++)for(let x=0;x<k;x++)for(let j=0;j<n;j++)
    a[x+k*(y+n*z)]+=cs[x][j]/(ev[j]+ev[y]+ev[z]);
  for(let z=0;z<n;z++)for(let y=0;y<k;y++)for(let x=0;x<k;x++)for(let j=0;j<n;j++)
    b[x+k*(y+k*z)]+=cs[y][j]*a[x+k*(j+n*z)];
  for(let z=0;z<k;z++)for(let y=0;y<k;y++)for(let x=0;x<k;x++)for(let j=0;j<n;j++)
    t[x+k*(y+k*z)]+=cs[z][j]*b[x+k*(y+k*j)]/l**3;
  const fold=x=>Math.min(x,2*l-x);
  return (i,j)=>{
    const x=Math.abs(i[0]-j[0]),y=Math.abs(i[1]-j[1])*k,z=Math.abs(i[2]-j[2])*k*k;
    const X=fold(i[0]+j[0]+2),Y=fold(i[1]+j[1]+2)*k,Z=fold(i[2]+j[2]+2)*k*k;
    return t[x+y+z]-t[X+y+z]-t[x+Y+z]-t[x+y+Z]+t[X+Y+z]+t[X+y+Z]+t[x+Y+Z]-t[X+Y+Z];
  };
}
export function schurGeometry(n){
  const shell=[],adj=[],indices=[],localToFace=new Int32Array(n**3).fill(-1);
  const linear=p=>p[0]+n*(p[1]+n*p[2]);
  for(let i=0;i<n**3;i++){
    const p=[i%n,Math.floor(i/n)%n,Math.floor(i/n**2)],axes=[0,1,2].filter(k=>p[k]===0||p[k]===n-1);
    if(!axes.length)continue;
    localToFace[i]=shell.length;shell.push(p);let other=null;
    if(axes.length===1){other=p.slice();other[axes[0]]+=p[axes[0]]===0?1:-1;}
    adj.push(other?.map(v=>v-1)??null);indices.push(i,other?linear(other):-1);
  }
  const m=shell.length,s=new Float32Array(m*m),green=new Float32Array(m*m);
  const full=dirichletGreen(n),interior=dirichletGreen(n-2);
  for(let i=0;i<m;i++)for(let j=0;j<=i;j++){
    const a=shell[i],b=shell[j],dist=Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1])+Math.abs(a[2]-b[2]);
    const response=(i===j?6:dist===1?-1:0)-(adj[i]&&adj[j]?interior(adj[i],adj[j]):0);
    s[i*m+j]=s[j*m+i]=response;green[i*m+j]=green[j*m+i]=full(a,b);
  }
  return {m,s,green,indices:new Int32Array(indices),localToFace};
}
const decl=(i,n,t,w=false)=>`@group(0) @binding(${i}) var<storage,${w?'read_write':'read'}> ${n}:array<${t}>;`;
function interfaceNeighbours(n,dims,data){
  const extent=dims.map(v=>v/n),num=extent.reduce((a,b)=>a*b),{m,indices,localToFace}=data;
  const neighbours=new Int32Array(num*m*4).fill(-1);
  const stride=[1,n,n*n],brickStride=[1,extent[0],extent[0]*extent[1]];
  for(let block=0;block<num;block++)for(let row=0;row<m;row++){
    const id=indices[2*row];
    for(let axis=0;axis<3;axis++){
      const q=Math.floor(id/stride[axis])%n,k=Math.floor(block/brickStride[axis])%extent[axis];
      const side=q===0?-1:q===n-1?1:0;
      if(!side||k+side<0||k+side>=extent[axis])continue;
      const j=id-side*(n-1)*stride[axis];
      neighbours[4*(block*m+row)+axis]=(block+side*brickStride[axis])*m+localToFace[j];
    }
  }
  return neighbours;
}

async function interfaceProduct(gpu,m,blocks,matrix,half,neighbours=null){
  const weights=gpu.buffer(neighbours?'CFD regular Schur response':'CFD inverse Schur response',half?new Uint16Array(Float16Array.from(matrix).buffer):matrix);
  const pipe=await gpu.kernel('CFD batched interface matrix product',(half?'enable f16;':'')+
    decl(0,'matrix',half?'f16':'f32')+decl(1,'x','f32')+decl(2,'out','f32',true)+(neighbours?decl(3,'links','vec4i'):'')+`
    var<workgroup> sum:array<f32,64>;
    @compute @workgroup_size(64) fn main(@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) group:vec3u){
      let row=group.x;let first=group.y*${m}u;var v=0.;for(var j=lane;j<${m}u;j+=64u){
        v+=f32(matrix[row*${m}u+j]*${half?'f16':'f32'}(x[first+j]));}sum[lane]=v;
      for(var k=32u;k>0u;k/=2u){workgroupBarrier();if(lane<k){sum[lane]+=sum[lane+k];}}
      if(lane==0u){let i=first+row;var s=sum[0];${neighbours?'let ids=links[i];for(var a=0u;a<3u;a++){if(ids[a]>=0){s-=x[u32(ids[a])];}}':''}out[i]=s;}}`);
  return (x,out)=>gpu.run(pipe,neighbours?[weights,x,out,neighbours]:[weights,x,out],[m,blocks]);
}

export async function schurPreconditioner(gpu,n,dims,kind,data){
  return {apply:await interfaceProduct(gpu,data.m,dims.reduce((a,b)=>a*b)/n**3,data.green,kind==='webgpu-f16')};
}

export async function schurSystem(gpu,n,dims,data,volume,ops){
  const {m}=data,b=n-2,blocks=dims.reduce((a,b)=>a*b,1)/n**3,lanes=128,work=Math.ceil(b**3/lanes);
  const cfg=`const N=${n}u;const B=${b}u;const M=${m}u;
    fn xyz(i:u32)->vec3u{return vec3u(i%N,(i/N)%N,i/(N*N));}
    fn idx(p:vec3u)->u32{return p.x+N*(p.y+N*p.z);}
    fn world(block:u32,i:u32)->u32{let brick=vec3u(block%${dims[0]/n}u,(block/${dims[0]/n}u)%${dims[1]/n}u,block/${dims[0]*dims[1]/n**2}u);
      let p=brick*N+xyz(i);return p.x+${dims[0]}u*(p.y+${dims[1]}u*p.z);}`;
  const {q,eigen}=blockBasis(b),basis=gpu.buffer('CFD interior basis',new Float32Array([...q,...eigen]));
  const map=gpu.buffer('CFD volume to shell',data.localToFace),ids=gpu.buffer('CFD shell endpoints',data.indices);
  const faceRhs=ops.vector('CFD condensed right hand side'),full=volume.vector('CFD reconstructed volume pressure');
  const innerPipes=[];
  for(const recover of [false,true]){
    const code=cfg+decl(0,'r','f32')+decl(1,'z','f32',true)+decl(2,'basis','f32')+(recover?decl(3,'map','i32')+decl(4,'face','f32'):'')+`
    var<workgroup> tile:array<f32,${b**3}>;
    fn local(i:u32)->vec3u{return vec3u(i%B,(i/B)%B,i/(B*B));}
    @compute @workgroup_size(128) fn main(@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) group:vec3u){
      let block=group.x;var vals:array<f32,${work}>;
      for(var i=lane;i<B*B*B;i+=128u){let p=local(i)+1u;var val=r[world(block,idx(p))];
        ${recover?`for(var d=0u;d<3u;d++){var e=vec3u(0);e[d]=1u;
          if(p[d]==1u){val+=face[block*M+u32(map[idx(p-e)])];}
          if(p[d]==B){val+=face[block*M+u32(map[idx(p+e)])];}}`:''}tile[i]=val;}
      workgroupBarrier();
      for(var step=0u;step<6u;step++){
        let d=step%3u;let stride=select(select(1u,B,d==1u),B*B,d==2u);
        for(var k=0u;k<${work}u;k++){let i=k*128u+lane;if(i>=B*B*B){continue;}let p=local(i);var v=0.;
          for(var j=0u;j<B;j++){v+=basis[p[d]*B+j]*tile[i-p[d]*stride+j*stride];}
          if(step==2u){v/=basis[B*B+p.x]+basis[B*B+p.y]+basis[B*B+p.z];}vals[k]=v;}
        workgroupBarrier();for(var k=0u;k<${work}u;k++){let i=k*128u+lane;if(i<B*B*B){tile[i]=vals[k];}}workgroupBarrier();
      }
      for(var i=lane;i<B*B*B;i+=128u){z[world(block,idx(local(i)+1u))]=tile[i];}
    }`;
    innerPipes.push(await gpu.kernel('CFD interior Dirichlet '+recover,code));
  }
  const gather=await gpu.kernel('CFD condense to unique shell nodes',cfg+decl(0,'r','f32')+decl(1,'z','f32')+decl(2,'ids','vec2i')+decl(3,'out','f32',true)+`
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){let i=g.x;if(i>=arrayLength(&out)){return;}
      let p=ids[i%M];var v=r[world(i/M,u32(p.x))];if(p.y>=0){v+=z[world(i/M,u32(p.y))];}out[i]=v;}`);
  const scatter=await gpu.kernel('CFD scatter interface pressure',cfg+decl(0,'y','f32')+decl(1,'ids','vec2i')+decl(2,'z','f32',true)+`
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){let i=g.x;if(i<arrayLength(&y)){z[world(i/M,u32(ids[i%M].x))]=y[i];}}`);
  const groups=[Math.ceil(m*blocks/128)];
  const neighbours=gpu.buffer('CFD pressure interfaces between bricks',interfaceNeighbours(n,dims,data));
  const apply=await interfaceProduct(gpu,m,blocks,data.s,false,neighbours);
  function condense(source,target){
    gpu.run(innerPipes[0],[source,full,basis],[blocks]);
    gpu.run(gather,[source,full,ids,target],groups);
  }
  function reconstruct(face){
    gpu.run(innerPipes[1],[volume.rhs,full,basis,map,face],[blocks]);
    gpu.run(scatter,[face,ids,full],groups);
  }
  const prepare=()=>condense(volume.rhs,faceRhs),defect=volume.vector('CFD original stencil residual');
  prepare();
  return {...ops,apply,prepare,rhs:faceRhs,rhsNorm:volume.rhsNorm,initialNorm:await ops.norm(faceRhs),
    trueResidual(face,out){reconstruct(face);volume.residual(full,defect);condense(defect,out);},
    async verify(face){reconstruct(face);return volume.verify(full);}};
}
