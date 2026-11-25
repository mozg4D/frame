// Each four-cell brick has 64 unknowns. The last coefficient is the
// conductance to its complement, including any pressure reservoir.
export function cutBlockInverse(rows){
  const n=64,A=new Float64Array(n*n),diagonal=new Float64Array(n),mark=new Uint8Array(n);
  for(let i=0;i<n;i++){
    diagonal[i]+=rows[4*i+3];
    for(const [a,stride] of [1,4,16].entries()){
      const c=rows[4*i+a];if(c===0)continue;const j=i+stride;
      A[i*n+j]=A[j*n+i]=-c;diagonal[i]+=c;diagonal[j]+=c;
    }
  }
  for(let seed=0;seed<n;seed++)if(!mark[seed]){
    const todo=[seed];mark[seed]=1;let anchored=false;
    for(let h=0;h<todo.length;h++){
      const i=todo[h];anchored||=rows[4*i+3]>0;
      for(let j=0;j<n;j++)if(!mark[j]&&A[i*n+j]<0){mark[j]=1;todo.push(j);}
    }
    // A sealed component has arbitrary pressure. Its compatible face flow
    // is invariant under this one reference in the local preconditioner.
    if(!anchored)A[seed*n+seed]=diagonal[seed]||1;
  }
  const scale=diagonal.map(v=>1/Math.sqrt(v||1));
  for(let i=0;i<n;i++){
    A[i*n+i]+=diagonal[i];
    for(let j=0;j<=i;j++){
      let a=A[i*n+j]*scale[i]*scale[j];
      for(let k=0;k<j;k++)a-=A[i*n+k]*A[j*n+k];
      if(i===j){if(!(a>0))throw Error('Nonpositive cut-block pressure pivot');A[i*n+i]=Math.sqrt(a);}
      else A[i*n+j]=a/A[j*n+j];
    }
  }
  const inverse=new Float32Array(n*n),v=new Float64Array(n);
  for(let col=0;col<n;col++){
    for(let i=0;i<n;i++){let s=Number(i===col);for(let j=0;j<i;j++)s-=A[i*n+j]*v[j];v[i]=s/A[i*n+i];}
    for(let i=n-1;i>=0;i--){let s=v[i];for(let j=i+1;j<n;j++)s-=A[j*n+i]*v[j];v[i]=s/A[i*n+i];inverse[i*n+col]=v[i]/6;}
  }
  return inverse;
}
if(typeof WorkerGlobalScope!=='undefined'&&self instanceof WorkerGlobalScope){
  self.onmessage=({data})=>{
    try{
      const rows=new Float32Array(data),out=new Float32Array(rows.length*16);
      for(let k=0;k<rows.length;k+=256)out.set(cutBlockInverse(rows.subarray(k,k+256)),16*k);
      self.postMessage(out.buffer,[out.buffer]);
    }catch(error){self.postMessage({error:error.message});}
  };
}
