import {gpuScope} from './gpu.mjs';

// The Cartesian empty-box operator is separable also on nonuniform axes.
// Diagonalize M^(-1/2) K M^(-1/2) on each axis, including the physical
// reservoir conditions. Store both transforms for an integrated-volume RHS.
export function pressureAxis(width,leftOpen,rightOpen){
  const n=width.length,d=new Float64Array(n),off=new Float64Array(n),vectors=new Float64Array(n*n);
  for(let i=0;i<n;i++){
    const w=width[i];if(!(w>0&&Number.isFinite(w)))throw Error('Expected a positive CFD cell width');
    vectors[i*n+i]=1;
    if(i>0)d[i]+=2/(w*(width[i-1]+w));else if(leftOpen)d[i]+=2/(w*w);
    if(i+1<n){
      const c=2/(w+width[i+1]);d[i]+=c/w;off[i]=-c/Math.sqrt(w*width[i+1]);
    }else if(rightOpen)d[i]+=2/(w*w);
  }
  // Implicit shifted QL on the symmetric tridiagonal operator. Apply every
  // real Givens rotation to its eigenvectors in double precision.
  for(let l=0;l<n;l++){
    for(let iter=0;;iter++){
      let m=l;while(m+1<n&&Math.abs(off[m])>8*Number.EPSILON*(Math.abs(d[m])+Math.abs(d[m+1])))m++;
      if(m===l)break;if(iter>=64)throw Error('CFD pressure axis failed to diagonalize');
      let g=(d[l+1]-d[l])/(2*off[l]);
      g=d[m]-d[l]+off[l]/(g+(g<0?-1:1)*Math.hypot(g,1));
      let s=1,c=1,p=0,split=false;
      for(let i=m-1;i>=l;i--){
        const f=s*off[i],b=c*off[i],r=Math.hypot(f,g);off[i+1]=r;
        if(r===0){d[i+1]-=p;off[m]=0;split=true;break;}
        s=f/r;c=g/r;g=d[i+1]-p;
        const h=(d[i]-g)*s+2*c*b;p=s*h;d[i+1]=g+p;g=c*h-b;
        for(let k=0;k<n;k++){
          const j=k*n+i,v=vectors[j],next=vectors[j+1];vectors[j+1]=s*v+c*next;vectors[j]=c*v-s*next;
        }
      }
      if(!split){d[l]-=p;off[l]=g;off[m]=0;}
    }
  }
  const order=Array.from({length:n},(_,i)=>i).sort((a,b)=>d[a]-d[b]);
  const eig=Float32Array.from(order,(j,i)=>i===0&&!leftOpen&&!rightOpen?0:Math.max(0,d[j]));
  const forward=new Float32Array(n*n),backward=new Float32Array(n*n);
  for(let k=0;k<n;k++)for(let j=0;j<n;j++){
    const value=vectors[j*n+order[k]]/Math.sqrt(width[j]);forward[k*n+j]=value;backward[j*n+k]=value;
  }
  return {eig,forward,backward};
}

export async function separablePressure(gpu,dims,widths,boundaries){
  const modes=widths.map((w,k)=>pressureAxis(w,boundaries[2*k],boundaries[2*k+1]));
  const [nx,ny,nz]=dims,cells=nx*ny*nz;
  const eigen=gpu.buffer('CFD whole-domain pressure eigenvalues',Float32Array.from(modes.flatMap(m=>[...m.eig])));
  const tmp=[0,1].map(()=>gpu.buffer('CFD global pressure transform',4*cells)),passes=[];
  for(let step=0;step<6;step++){
    const a=step<3?step:5-step,n=dims[a],lines=cells/n;
    const address=['k+'+nx+'u*line','line%'+nx+'u+'+nx+'u*(k+'+ny+'u*(line/'+nx+'u))','line+'+(nx*ny)+'u*k'][a];
    const matrix=gpu.buffer('CFD pressure axis basis',step<3?modes[a].forward:modes[a].backward);
    const pipe=await gpu.kernel('CFD tiled pressure axis '+step,`
      @group(0) @binding(0) var<storage,read> src:array<f32>;@group(0) @binding(1) var<storage,read_write> dst:array<f32>;
      @group(0) @binding(2) var<storage,read> basis:array<f32>;
      ${step===2?'@group(0) @binding(3) var<storage,read> eigen:array<f32>;':''}
      var<workgroup> values:array<f32,128>;var<workgroup> tile:array<f32,256>;
      fn index(line:u32,k:u32)->u32{return ${address};}
      @compute @workgroup_size(16,8) fn main(@builtin(workgroup_id) id:vec3u,@builtin(local_invocation_id) l:vec3u,@builtin(local_invocation_index) lane:u32){
        let start=id.x*16u;let row=start+l.x;let line=id.y*8u+l.y;var sum=0.;
        for(var block=0u;block<${n}u;block+=16u){
          var v=0.;if(line<${lines}u&&block+l.x<${n}u){v=src[index(line,block+l.x)];}values[lane]=v;
          for(var i=lane;i<256u;i+=128u){let col=block+i%16u;let r=start+i/16u;var x=0.;
            if(col<${n}u&&r<${n}u){x=basis[r*${n}u+col];}tile[i]=x;}
          workgroupBarrier();for(var j=0u;j<16u;j++){sum+=tile[l.x*16u+j]*values[l.y*16u+j];}workgroupBarrier();
        }
        if(row<${n}u&&line<${lines}u){let i=index(line,row);
          ${step===2?`let x=i%${nx}u;let y=i/${nx}u%${ny}u;let z=i/${nx*ny}u;
            let lambda=eigen[x]+eigen[${nx}u+y]+eigen[${nx+ny}u+z];if(lambda>0.){sum/=lambda;}else{sum=0.;}`:''}
          dst[i]=sum;}
      }`);
    passes.push({pipe,matrix,grid:[Math.ceil(n/16),Math.ceil(lines/8)],diagonal:step===2});
  }
  return {binding(input,out){
    const groups=passes.map(({pipe,matrix,diagonal},i)=>gpu.bind(pipe,[i===0?input:tmp[(i-1)%2],i===5?out:tmp[i%2],matrix,...diagonal?[eigen]:[]]));
    const stages=passes.map((p,i)=>({kind:'global pressure axis '+i,encode:e=>gpu.dispatch(e,p.pipe,groups[i],p.grid)}));
    return Object.assign(e=>{for(const op of stages)op.encode(e);},{stages});
  }};
}

// Form b with an independent face loop. Both the reconstruction and its
// residual are checked on a graded box with mixed pressure reservoirs.
export async function verifySeparablePressure(device){
  const gpu=gpuScope(device),dims=[24,16,8],strides=[1,24,384],n=3072;
  const widths=dims.map((d,k)=>Array.from({length:d},(_,i)=>.7+(k+.5)*(i+.5)/d));
  const open=[true,false,false,false,true,true];
  const exact=Float32Array.from({length:n},(_,i)=>Math.sin(.13*(i%24))+.3*Math.cos(.21*Math.floor(i/24))+.05*((i*37)%17));
  function apply(p){
    const b=new Float64Array(n);
    for(let i=0;i<n;i++){const xyz=[i%24,Math.floor(i/24)%16,Math.floor(i/384)],w=xyz.map((v,k)=>widths[k][v]);
      for(let k=0;k<3;k++){const j=xyz[k],area=w[(k+1)%3]*w[(k+2)%3];
        if(j===0&&open[2*k])b[i]+=2*area*p[i]/w[k];
        if(j+1===dims[k]){if(open[2*k+1])b[i]+=2*area*p[i]/w[k];}
        else{const next=i+strides[k],q=2*area*(p[i]-p[next])/(w[k]+widths[k][j+1]);b[i]+=q;b[next]-=q;}
      }
    }return b;
  }
  try{
    const b=Float32Array.from(apply(exact)),rhs=gpu.buffer('CFD manufactured regular RHS',b),out=gpu.buffer('CFD manufactured regular solution',4*n);
    const inverse=await separablePressure(gpu,dims,widths,open),encode=inverse.binding(rhs,out),e=device.createCommandEncoder();
    encode(e);device.queue.submit([e.finish()]);const solution=await gpu.read(out,gpu.staging('CFD exact pressure readback',4*n),n);
    const residual=apply(solution);let error2=0,res2=0,ref2=0,b2=0;
    for(let i=0;i<n;i++){error2+=(solution[i]-exact[i])**2;ref2+=exact[i]**2;res2+=(residual[i]-b[i])**2;b2+=b[i]**2;}
    const relativeError=Math.sqrt(error2/ref2),relativeResidual=Math.sqrt(res2/b2);
    return {dims,relativeError,relativeResidual,pass:relativeError<5e-5&&relativeResidual<5e-5};
  }finally{gpu.close();}
}
