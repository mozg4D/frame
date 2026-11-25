import {gpuScope} from './gpu.mjs';
import {cutPressureBlocks} from './cut-blocks.mjs';

// Solve both neighbouring Dirichlet subdomains independently in FP64 with
// ordinary Gaussian elimination. The second block has to see the first one.
export async function verifyCutRelaxation(device){
  const gpu=gpuScope(device),dims=[16,8,8],n=dims.reduce((a,b)=>a*b),strides=[1,16,128];
  try{
    const mu=new Float32Array(4*n).fill(1),c=new Float32Array(4*n);
    const point=i=>[i%16,Math.floor(i/16)%8,Math.floor(i/128)];
    for(let i=0;i<n;i++){
      const p=point(i);
      for(let a=0;a<3;a++)c[4*i+a]=.35+(1+Math.sin(i*.22+a))*(1+a*.6);
      c[4*i+3]=p.reduce((sum,x,k)=>sum+Number(x===0||x+1===dims[k]),0);
    }
    for(const x of [5,9]){
      const i=x+16*(1+8);mu[4*i]=.021;mu[4*i+3]=.19;
      for(let a=0;a<3;a++){c[4*i+a]*=.013;c[4*(i-strides[a])+a]*=.021;}
    }
    function edges(i,visit){
      const p=point(i);for(let a=0;a<3;a++)for(const side of [-1,1]){
        if(p[a]+side<0||p[a]+side>=dims[a])continue;const j=i+side*strides[a];visit(j,c[4*Math.min(i,j)+a]);}
    }
    function apply(p){return Float64Array.from(p,(v,i)=>{let row=c[4*i+3]*v;edges(i,(j,w)=>{row+=w*(v-p[j]);});return row;});}
    const target=Float64Array.from({length:n},(_,i)=>Math.sin(i*.14)+.3*Math.cos(i*.35)),rhs=Float32Array.from(apply(target));
    const initial=Float32Array.from({length:n},(_,i)=>.17*Math.sin(i*.76)),expected=Float64Array.from(initial);
    function energy(p){const d=target.map((x,i)=>x-p[i]),ad=apply(d);return d.reduce((s,x,i)=>s+x*ad[i],0);}
    const op=await cutPressureBlocks(gpu,{dims,cutBlockSmoother:true},gpu.buffer('CFD two adjacent cut bricks',mu),gpu.buffer('CFD manufactured conductance',c));
    if(op?.count!==2)throw Error('Expected two adjacent irregular pressure bricks');
    const p=gpu.buffer('CFD relaxed pressure',initial),relax=await op.smoother(gpu.buffer('CFD manufactured RHS',rhs),p);
    const stage=gpu.staging('CFD bounded relaxation reference',4*n),cases=[];
    for(let sweep=0;sweep<3;sweep++){
      for(const bx of [2,1]){
        const ids=Array.from({length:64},(_,k)=>4*bx+(k&3)+16*(((k>>2)&3)+8*(k>>4))),rows=[];
        for(const [k,i] of ids.entries()){
          const row=new Float64Array(65);row[k]=c[4*i+3];row[64]=rhs[i];
          edges(i,(j,w)=>{row[k]+=w;const h=ids.indexOf(j);if(h<0)row[64]+=w*expected[j];else row[h]-=w;});rows.push(row);
        }
        for(let col=0;col<64;col++)for(let i=col+1;i<64;i++){
          const v=rows[i][col]/rows[col][col];for(let k=col+1;k<=64;k++)rows[i][k]-=v*rows[col][k];
        }
        for(let i=63;i>=0;i--){let b=rows[i][64];for(let j=i+1;j<64;j++)b-=rows[i][j]*expected[ids[j]];expected[ids[i]]=b/rows[i][i];}
      }
      const e=device.createCommandEncoder();relax(e);device.queue.submit([e.finish()]);
      const got=await gpu.read(p,stage,n);
      cases.push({maxError:got.reduce((m,x,i)=>Math.max(m,Math.abs(x-expected[i])),0),energy:energy(got)});
    }
    return {count:op.count,cases,initialEnergy:energy(initial),pass:cases.every(s=>s.maxError<3e-6)&&cases.at(-1).energy<energy(initial)};
  }finally{gpu.close();}
}
