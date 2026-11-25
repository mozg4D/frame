import {cutGroups,discretization,gpuScope} from '../../plugin.js';

export async function verifyMomentumTopology(device){
  const dims=[16,8,8],n=dims.reduce((a,b)=>a*b),h=.006,axes=dims.map(d=>Float64Array.from({length:d+1},(_,i)=>i*h));
  const source={axes:[[1,0,0],[0,1,0],[0,0,1]],originWorldM:[.004,-.002,.003]},cell=7+16*(4+8*3);
  const f={dims,axes,origin:[0,0,0],h,nu:1.54e-5,U:2,maxSpeed:2,omega:0},rows=[];
  const digest=async bits=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bits)),x=>x.toString(16).padStart(2,'0')).join('');
  for(const [fraction,closeFace] of [[.31,false],[.27,false],[.25,false],[.25,false],[.25,true]]){
    const gpu=gpuScope(device);
    try{
      const row=new Float32Array(4*n).fill(1);row[4*cell+3]=fraction;
      if(closeFace)row[4*(cell-1)]=0;
      const bits=new Uint8Array(n/2);
      for(let k=0;k<row.length;k++)if(row[k]>0)bits[k>>3]|=1<<(k&7);
      const mu=gpu.buffer('Apertures with one small control volume',row),wall=gpu.buffer('Native group volume field',16*n);
      const groups=await cutGroups(gpu,f,mu,wall),hashes=await discretization(gpu,f,mu,source,groups);
      const links=new Uint32Array((await gpu.read(groups.links,gpu.staging('Momentum root assignment',groups.links.size),3*n)).buffer);
      const roots=Uint32Array.from({length:n},(_,i)=>links[3*i]);
      const independentWall=await digest(bits),independentGroups=await digest(roots);
      rows.push({fraction,closeFace,...hashes,mergedCells:groups.stats.mergedCells,root:roots[cell],
        correct:independentWall===hashes.wallTopologyHash&&independentGroups===hashes.momentumTopologyHash});
    }finally{gpu.close();}
  }
  const [alone,joined,perturbed,repeat,sealed]=rows;
  return {pass:rows.every(r=>r.correct&&r.gridHash===alone.gridHash)&&alone.mergedCells===0&&joined.mergedCells===1&&
    alone.wallTopologyHash===joined.wallTopologyHash&&alone.momentumTopologyHash!==joined.momentumTopologyHash&&
    joined.momentumTopologyHash===perturbed.momentumTopologyHash&&repeat.momentumTopologyHash===perturbed.momentumTopologyHash&&
    repeat.wallTopologyHash===perturbed.wallTopologyHash&&sealed.wallTopologyHash!==perturbed.wallTopologyHash,rows};
}
