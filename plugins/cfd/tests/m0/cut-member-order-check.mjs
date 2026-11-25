import {cutGroups,gpuScope} from '../../plugin.js';

export async function verifyCutMemberOrder(device){
  const dims=[16,8,8],n=1024,rows=[];
  const f={dims,h:.01,maxSpeed:1.2,nu:1.5e-5,origin:[0,0,0],rotor:false,mergeToFluid:true};
  for(const regular of [[0],[571],[4,127,352,700]]){
    const gpu=gpuScope(device);
    try{
      const mu=new Float32Array(4*n),wall=new Float32Array(4*n),state=new Float32Array(8*n);
      for(let i=0;i<n;i++){
        mu.set([.53,.47,.39,regular.includes(i)?1:.17+.09*Math.sin(.27*i)**2],4*i);wall[4*i]=.8;
        for(let a=0;a<8;a++)state[8*i+a]=Math.sin(.31*i+.42*a)*10**((i%9)-4);
      }
      const groups=await cutGroups(gpu,f,gpu.buffer('Open random slivers',mu),gpu.buffer('Certified positive distance',wall));
      const values=gpu.buffer('Order-sensitive extensive cell quantities',state);
      const e=device.createCommandEncoder();groups.merge(values)(e);device.queue.submit([e.finish()]);
      const stage=gpu.staging('Independent Cartesian membership',values.size);
      const link=new Uint32Array((await gpu.read(groups.links,stage,3*n)).buffer),sum=await gpu.read(values,stage,8*n);
      let members=0,largest=0,ordered=true,exact=true,maxDifference=0;const seen=new Set();
      for(let i=0;i<n;i++)if(link[3*i]===i){
        const want=state.slice(8*i,8*i+8),children=[];let previous=-1,child=link[3*i+1];
        while(child!==0xffffffff){
          if(child>=n||seen.has(child)||child===i)throw Error('Invalid cut-group child link');
          seen.add(child);children.push(child);ordered&&=child>previous&&link[3*child]===i;
          previous=child;child=link[3*child+2];
        }
        for(const k of children.sort((a,b)=>a-b))for(let a=0;a<8;a++)want[a]+=state[8*k+a];
        for(const k of [i,...children])for(let a=0;a<8;a++){
          exact&&=sum[8*k+a]===want[a];maxDifference=Math.max(maxDifference,Math.abs(sum[8*k+a]-want[a]));
        }
        members+=1+children.length;largest=Math.max(largest,1+children.length);
      }
      rows.push({regular,ordered,exact,maxDifference,largest,members});
    }finally{gpu.close();}
  }
  return {pass:rows.every(r=>r.ordered&&r.exact&&r.members===n&&r.largest>200)&&rows[0].largest===n,dims,rows};
}
