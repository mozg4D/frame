import {gpuScope} from './gpu.mjs';
import {groupTransport} from '../../plugin.js';
import {verifyMomentum} from './momentum-check.mjs';

// Independently eliminate the physical control-volume matrix in Float64.
// The two adjacent L-shaped groups break Cartesian red/black parity.
function solveDense(rows,size){
  for(let k=0;k<size;k++){
    const diagonal=rows[k][k];if(!(diagonal>0))throw Error('Invalid transport pivot');
    for(let i=k+1;i<size;i++){
      const scale=rows[i][k]/diagonal;
      for(let j=k;j<size+5;j++)rows[i][j]-=scale*rows[k][j];
    }
  }
  const result=rows.map(()=>new Float64Array(5));
  for(let i=size-1;i>=0;i--)for(let a=0;a<5;a++){
    let s=rows[i][size+a];for(let j=i+1;j<size;j++)s-=rows[i][j]*result[j][a];
    result[i][a]=s/rows[i][i];
  }
  return result;
}

export async function verifyGroupTransport(device){
  const gpu=gpuScope(device),dims=[8,4,4],[nx,ny,nz]=dims,n=nx*ny*nz;
  const f={dims,h:1,origin:[0,0,0],U:.08,maxSpeed:.3,nu:.04},dt=1,k=1.5*(.005*f.maxSpeed)**2;
  const ambient=[f.U,0,0,k,k/(5*f.nu)],scales=[f.maxSpeed,f.maxSpeed,f.maxSpeed,k,ambient[4]];
  const at=(x,y,z)=>x+nx*(y+ny*z),links=new Uint32Array(n*3).fill(0xffffffff),root=Uint32Array.from({length:n},(_,i)=>i);
  for(let z=0;z<nz;z++)for(const x of [2,4]){
    const parent=at(x,1,z),a=at(x+1,1,z),b=at(x,2,z);
    root[a]=parent;root[b]=parent;links[3*parent+1]=a;links[3*a+2]=b;
  }
  const members=[...root.keys()].filter(i=>root[i]===i),index=new Map(members.map((v,i)=>[v,i]));
  const volume=new Float32Array(n),cell=Float32Array.from(root,(_,i)=>.25+((5*i)%7)*.125);
  for(let i=0;i<n;i++){links[3*i]=root[i];volume[root[i]]+=cell[i];}
  const initial=new Float32Array(8*n);
  for(let i=0;i<n;i++){const s=.6+.35*Math.sin(root[i]*.67);
    initial.set([.1+.04*s,.3*s-.12,.1*s-.09,k*(1+s),ambient[4]*(2-s)],8*i);}
  try{
    const pred=gpu.buffer('CFD irregular transport RHS',initial),hi=gpu.buffer('CFD group face flows',8*n*4),lo=gpu.buffer('CFD group face tails',hi.size);
    const groups={links:gpu.buffer('CFD irregular group forest',links),volumes:gpu.buffer('CFD irregular group volumes',volume),stats:{groupsWithChildren:2*nz}};
    const solver=await groupTransport(gpu,f,dt,pred,hi,lo,groups),stage=gpu.staging('CFD group validation',pred.size);
    const scheduler={async perform(ops){const e=device.createCommandEncoder();for(const op of ops)op.encode(e);device.queue.submit([e.finish()]);await device.queue.onSubmittedWorkDone();}};
    const cases=[];
    for(const rate of [2.75,-3.5]){
      const q=new Float32Array(8*n),tail=new Float32Array(q.length),rows=members.map(()=>new Float64Array(members.length+5));
      const yForce=(x,y)=>.5*Math.sin((x+1)*.7+y*.5); // interior transverse transfer
      for(let i=0;i<n;i++){
        const x=i%nx,y=Math.floor(i/nx)%ny,z=Math.floor(i/(nx*ny));
        q[8*i]=rate;q[8*i+4]=rate;q[8*i+1]=y===ny-1?0:yForce(x,y);q[8*i+5]=y===0?0:yForce(x,y-1);
        const row=rows[index.get(root[i])];row[index.get(root[i])]+=cell[i];
        for(let a=0;a<5;a++)row[members.length+a]+=cell[i]*initial[8*i+a];
        for(const axis of [0,1])for(const side of [-1,1]){
          const j=axis===0?x+side:y+side,internal=j>=0&&j<dims[axis],face=8*i+axis+(side>0?0:4);
          tail[face]=q[face]*3e-8;
          const flux=side*(q[face]+tail[face]);const neighbour=internal?root[at(axis===0?j:x,axis===1?j:y,z)]:-1;
          if(neighbour===root[i])continue;
          if(flux>=0.)row[index.get(root[i])]+=flux;
          else if(internal)row[index.get(neighbour)]+=flux;
          else for(let a=0;a<5;a++)row[members.length+a]-=flux*ambient[a];
        }
      }
      const exact=solveDense(rows,members.length);
      device.queue.writeBuffer(hi,0,q);device.queue.writeBuffer(lo,0,tail);device.queue.writeBuffer(pred,0,initial);
      await solver.solve(scheduler);
      const result=await gpu.read(pred,stage,initial.length),balance=new Float64Array(5);let maxError=0,maxScatter=0;
      for(let i=0;i<n;i++)for(let a=0;a<5;a++){
        const v=result[8*i+a];
        maxError=Math.max(maxError,Math.abs(v-exact[index.get(root[i])][a])/scales[a]);
        maxScatter=Math.max(maxScatter,Math.abs(v-result[8*root[i]+a])/scales[a]);balance[a]+=cell[i]*(v-initial[8*i+a]);
        const x=i%nx;if(x===0||x===nx-1){const flux=(x===0?-1:1)*(rate+Math.fround(rate*3e-8));balance[a]+=flux*(flux<0?ambient[a]:v);}
      }
      const imbalance=Math.max(...balance.map((v,a)=>Math.abs(v)/(scales[a]*ny*nz)));
      cases.push({rate,maxError,maxScatter,imbalance});
    }
    const coupled=await verifyMomentum(device,true,true,true,true,false,true,false,true);
    return {cases,...solver.stats,coupled,pass:coupled.pass&&cases.every(c=>c.maxError<5e-5&&c.maxScatter===0&&c.imbalance<5e-5)};
  }finally{gpu.close();}
}
