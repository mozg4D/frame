import {gridWGSL} from './fixtures.mjs';
import {openBoundaries} from './multigrid.mjs';
import {metricBuffer,metricWGSL} from './rectilinear.mjs';
import {addFlowWGSL} from './fvm.mjs';

// Route only the remaining projection defect. An edge never crosses a closed
// face. A root discharges through an actual pressure reservoir. Components
// disconnected from all reservoirs retain the ordinary pressure correction.
export async function fluxEquilibration(gpu,f,dt,mu,flux,tail){
  const device=gpu.device,n=f.dims.reduce((a,b)=>a*b),grid=[Math.ceil(n/128)],axes=metricBuffer(gpu,f);
  const common=gridWGSL(f)+openBoundaries(f)+`
    const NONE=0xffffffffu;
    fn neighbour(p:vec3i,code:u32)->vec3i{var q=p;q[code/2u]+=select(-1,1,(code&1u)!=0u);return q;}
    fn upper(code:u32)->bool{return (code&1u)!=0u;}`;
  const st=(i,name,type,write=false)=>`@group(0) @binding(${i}) var<storage,${write?'read_write':'read'}> ${name}:${type};`;
  const arr=(i,name,type,write=false)=>st(i,name,'array<'+type+'>',write);
  const each=body=>`@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
    let i=g.x;if(i>=CELLS){return;}let p=point(i);${body}}`;
  const distances=[0,1].map(()=>gpu.buffer('CFD distance to an open pressure boundary',4*n));
  const changed=gpu.buffer('CFD pressure forest frontier flag',4),one=gpu.staging('CFD pressure forest convergence',4);
  const seed=await gpu.kernel('CFD pressure discharge reservoirs',common+arr(0,'mu','vec4f')+arr(1,'dist','u32',true)+each(`
    var depth=NONE;if(mu[i].w>0.){for(var code=0u;code<6u;code++){
      if(!inside(neighbour(p,code))&&openFace(code/2u,select(-1,1,upper(code)))){depth=0u;}
    }}dist[i]=depth;`));
  gpu.run(seed,[mu,distances[0]],grid);
  const flood=await gpu.kernel('CFD grow pressure paths through open fluid faces',common+arr(0,'mu','vec4f')+
    arr(1,'src','u32')+arr(2,'dst','u32',true)+st(3,'changed','atomic<u32>',true)+each(`
      var d=src[i];if(d==NONE&&mu[i].w>0.){for(var c=0u;c<6u;c++){
        let q=neighbour(p,c);if(!inside(q)){continue;}let j=index(q);
        if(mu[select(j,i,upper(c))][c/2u]<=0.||src[j]==NONE){continue;}d=min(d,src[j]+1u);
      }if(d!=NONE){atomicOr(&changed,1u);}}dst[i]=d;`));
  const floodBind=distances.map((d,k)=>gpu.bind(flood,[mu,d,distances[1-k],changed]));
  let waves=0,expanded;
  do{
    const e=device.createCommandEncoder();e.clearBuffer(changed);
    for(let k=0;k<8;k++)gpu.dispatch(e,flood,floodBind[k%2],grid);
    waves+=8;e.copyBufferToBuffer(changed,0,one,0,4);device.queue.submit([e.finish()]);await one.mapAsync(GPUMapMode.READ);
    try{expanded=new Uint32Array(one.getMappedRange())[0];}finally{one.unmap();}
  }while(expanded);
  const bucket=gpu.buffer('CFD pressure forest level counts',4*(waves+2)),parent=gpu.buffer('CFD pressure discharge direction',4*n);
  const choose=await gpu.kernel('CFD widest shortest pressure paths',common+metricWGSL(f)+arr(0,'mu','vec4f')+
    arr(1,'dist','u32')+arr(2,'direction','u32',true)+st(3,'bucket','array<atomic<u32>>',true)+each(`
      let d=dist[i];var best=-1.;var choice=NONE;
      if(d!=NONE){let w=cellWidths(p);let area=faceAreas(w);
        for(var c=0u;c<6u;c++){let a=c/2u;let q=neighbour(p,c);var strength=0.;
          if(inside(q)){let j=index(q);if(dist[j]>=d){continue;}
            strength=mu[select(j,i,upper(c))][a]*area[a]*spacingInv(a,p[a],select(-1,1,upper(c)));
          }else{if(d!=0u||!openFace(a,select(-1,1,upper(c)))){continue;}strength=2.*area[a]/w[a];}
          if(strength>0.&&strength>best){best=strength;choice=c;}
        }atomicAdd(&bucket[d],1u);
      }else if(mu[i].w>0.){atomicAdd(&bucket[${waves+1}u],1u);}
      direction[i]=choice;`));
  gpu.run(choose,[mu,distances[0],parent,bucket],grid,axes);
  const histogram=gpu.staging('CFD pressure forest level sizes',bucket.size);
  const levels=new Uint32Array((await gpu.read(bucket,histogram,waves+2)).buffer);
  const offsets=new Uint32Array(waves+1);let reached=0;
  for(let k=0;k<offsets.length;k++){offsets[k]=reached;reached+=levels[k];}
  const ordered=gpu.buffer('CFD pressure forest by depth',4*Math.max(1,reached));
  device.queue.writeBuffer(bucket,0,offsets);
  const pack=await gpu.kernel('CFD order pressure paths by depth',common+arr(0,'dist','u32')+
    st(1,'offset','array<atomic<u32>>',true)+arr(2,'ids','u32',true)+each('if(dist[i]!=NONE){ids[atomicAdd(&offset[dist[i]],1u)]=i;}'));
  gpu.run(pack,[distances[0],bucket,ordered],grid);
  // Geometry is static for this projection. These scratch buffers can be
  // retired once ordering has finished, even during a long physical study.
  await device.queue.onSubmittedWorkDone();for(const b of [...distances,bucket,histogram,one,changed])b.destroy();

  const sum=gpu.buffer('CFD compensated subtree discharges',8*n);
  const audit=gpu.buffer('CFD discharge reconstruction bounds',8),auditStage=gpu.staging('CFD conservative reconstruction limit',8);
  const energy=gpu.buffer('CFD face energy by workgroup',4*grid[0]);
  const stats={levels:levels.subarray(0,-1).filter(v=>v>0).length,reached,sealedUnreached:levels.at(-1),
    attempts:0,accepted:0,maxAcceptedRelativeSpeed:0,maxAcceptedRelativeRmsPressureGradientBound:0,maxTriedRelativeSpeed:0};
  const fields='struct Flux{hi:vec4f,lo:vec4f} ';
  const collect=await gpu.kernel('CFD conservative subtree sum',common+fields+addFlowWGSL+
    arr(0,'h','Flux')+arr(1,'l','Flux')+arr(2,'dir','u32')+arr(3,'ids','u32')+arr(4,'sum','vec2f',true)+
    '@group(0) @binding(5) var<uniform> block:vec2u;'+`
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) id:vec3u){
      if(id.x>=block.y){return;}let i=ids[block.x+id.x];let p=point(i);var s=vec2f(0);
      for(var c=0u;c<6u;c++){let a=c/2u;let sign=select(-1.,1.,upper(c));
        let v=select(h[i].lo[a],h[i].hi[a],upper(c));let w=select(l[i].lo[a],l[i].hi[a],upper(c));
        s=addFlow(s.x,s.y,sign*v);s=addFlow(s.x,s.y,sign*w);
        let q=neighbour(p,c);if(inside(q)){let j=index(q);if(dir[j]==(c^1u)){
          let child=sum[j];s=addFlow(s.x,s.y,child.x);s=addFlow(s.x,s.y,child.y);
        }}
      }sum[i]=s;
    }`);
  const sweeps=[];
  for(let depth=waves;depth>=0;depth--){if(!levels[depth])continue;
    const range=gpu.buffer('CFD pressure discharge level',new Uint32Array([offsets[depth],levels[depth],0,0]),GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
    sweeps.push([gpu.bind(collect,[flux,tail,parent,ordered,sum,range]),[Math.ceil(levels[depth]/128)]]);
  }
  const reference=f.maxSpeed*dt/f.h;
  const bound=await gpu.kernel('CFD bound the face velocity perturbation',common+metricWGSL(f)+arr(0,'mu','vec4f')+
    arr(1,'dir','u32')+arr(2,'sum','vec2f')+st(3,'peak','atomic<u32>',true)+arr(4,'energy','f32',true)+`
    var<workgroup> values:array<u32,128>;var<workgroup> energies:array<f32,128>;
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) block:vec3u){
      let i=id.x;var v=0.;var e=0.;if(i<CELLS&&dir[i]!=NONE){let c=dir[i];let a=c/2u;let p=point(i);let q=neighbour(p,c);
        let width=cellWidths(p);var aperture=1.;var distance=.5*width[a];
        if(inside(q)){aperture=mu[select(index(q),i,upper(c))][a];distance=1./spacingInv(a,p[a],select(-1,1,upper(c)));}
        let area=aperture*faceAreas(width)[a];let flow=(sum[i].x+sum[i].y)/${reference};
        v=abs(flow)/area;e=flow*flow*distance/area;
      }values[lane]=bitcast<u32>(v);energies[lane]=e;
      for(var d=64u;d>0u;d/=2u){workgroupBarrier();if(lane<d){values[lane]=max(values[lane],values[lane+d]);energies[lane]+=energies[lane+d];}}
      if(lane==0u){atomicMax(&peak,values[0]);energy[block.x]=energies[0];}
    }`);
  const boundGroup=gpu.bind(bound,[mu,parent,sum,audit,energy],axes);
  const volume=f.axes?f.axes.reduce((v,axis)=>v*(axis.at(-1)-axis[0])/f.h,1):n;
  // The missing elliptic correction minimizes sum(q^2/conductance) among
  // flows with this defect. A feasible discharge bounds its pressure energy.
  const reduce=await gpu.kernel('CFD upper bound on the remaining pressure gradient',arr(0,'terms','f32')+arr(1,'audit','f32',true)+`
    var<workgroup> sums:array<f32,128>;
    @compute @workgroup_size(128) fn main(@builtin(local_invocation_index) lane:u32){
      var s=0.;for(var i=lane;i<arrayLength(&terms);i+=128u){s+=terms[i];}sums[lane]=s;
      for(var d=64u;d>0u;d/=2u){workgroupBarrier();if(lane<d){sums[lane]+=sums[lane+d];}}
      if(lane==0u){audit[1]=sqrt(sums[0]/${volume});}
    }`);
  const reduceGroup=gpu.bind(reduce,[energy,audit]);
  const apply=await gpu.kernel('CFD share equilibrated discharges on both incidences',common+fields+addFlowWGSL+
    arr(0,'h','Flux',true)+arr(1,'l','Flux',true)+arr(2,'dir','u32')+arr(3,'sum','vec2f')+each(`
      let own=dir[i];if(own==NONE){return;}var hi=h[i];var lo=l[i];
      for(var c=0u;c<6u;c++){let a=c/2u;let sign=select(-1.,1.,upper(c));var d=vec2f(0);
        if(own==c){d=-sign*sum[i];}else{let q=neighbour(p,c);if(!inside(q)){continue;}
          let j=index(q);if(dir[j]!=(c^1u)){continue;}d=sign*sum[j];}
        var pair=addFlow(select(hi.lo[a],hi.hi[a],upper(c)),select(lo.lo[a],lo.hi[a],upper(c)),d.x);
        pair=addFlow(pair.x,pair.y,d.y);
        if(upper(c)){hi.hi[a]=pair.x;lo.hi[a]=pair.y;}else{hi.lo[a]=pair.x;lo.lo[a]=pair.y;}
      }h[i]=hi;l[i]=lo;`));
  const applyGroup=gpu.bind(apply,[flux,tail,parent,sum]);
  const proposals=sweeps.map(([group,size])=>({kind:'sum pressure discharge level',encode:e=>gpu.dispatch(e,collect,group,size)}));
  proposals.push({kind:'bound face perturbation',encode:e=>{
    e.clearBuffer(audit);gpu.dispatch(e,bound,boundGroup,grid);gpu.dispatch(e,reduce,reduceGroup,[1]);e.copyBufferToBuffer(audit,0,auditStage,0,8);
  }});
  const publish={kind:'equilibrate shared discharges',encode:e=>gpu.dispatch(e,apply,applyGroup,grid)};
  return {stats,async correct(scheduler,assertCurrent,limit=1e-5){
    await scheduler.perform(proposals,assertCurrent);await auditStage.mapAsync(GPUMapMode.READ);let peak,rms;
    try{[peak,rms]=new Float32Array(auditStage.getMappedRange());}finally{auditStage.unmap();}
    stats.attempts++;stats.maxTriedRelativeSpeed=Math.max(peak,stats.maxTriedRelativeSpeed);
    if(!Number.isFinite(peak)||!Number.isFinite(rms)||peak>limit||rms>limit)return false;
    await scheduler.perform([publish],assertCurrent);stats.accepted++;
    stats.maxAcceptedRelativeSpeed=Math.max(peak,stats.maxAcceptedRelativeSpeed);
    stats.maxAcceptedRelativeRmsPressureGradientBound=Math.max(rms,stats.maxAcceptedRelativeRmsPressureGradientBound);return true;
  }};
}
