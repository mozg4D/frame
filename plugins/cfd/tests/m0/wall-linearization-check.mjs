import {gpuScope,sstWallWGSL,sstSurfacePullbackWGSL} from '../../plugin.js';

// Cotangents for the wall terms in the modeled momentum and turbulence
// equations. Distance, viscosity and area/volume use logarithmic increments.
const reverse=`
  struct WallDual{relative:vec3f,normal:vec3f,parameters:vec3f}
  fn reverseWallMomentum(relative:vec3f,n:vec3f,y:f32,nu:f32,a:f32,seed:vec3f)->WallDual{
    let t=tangentialSlip(relative,n);let s=length(t);let f=wallFriction(s,y,nu);
    let rate=a*f.x;let scale=rate/(1.+rate);let radial=dot(t,seed)*scale/(1.+rate);
    var tangent=scale*seed;
    if(s>0.){tangent+=radial*f.y*(t/s)/s;}
    let g=-dot(relative,n)*tangent-dot(n,tangent)*relative;
    return WallDual(tangentialSlip(tangent,n),tangentialSlip(g,n),radial*vec3f(f.y-1.,1.-f.y,1.));
  }
`+sstSurfacePullbackWGSL;

const dot=(a,b)=>a.reduce((sum,x,k)=>sum+x*b[k],0);
const plus=(a,b,k)=>a.map((x,i)=>x+k*b[i]);
const unit=a=>a.map(x=>x/Math.hypot(...a));
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];

// Independently sum the exponential tail and bracket the scalar equation
// in Float64. There is no Newton step or derivative in this forward oracle.
export function reference(s,y,nu){
  if(s===0)return {resistance:nu/y,sst:[6*nu/(.075*y*y),0,nu/y]};
  function remainder(x){
    let term=x**4/24,sum=term;
    for(let k=5;k<200;k++){term*=x/k;sum+=term;if(term<=sum*1e-16)break;}
    return sum/9.8;
  }
  const re=s*y/nu;
  let l=0,h=Math.min(Math.sqrt(re),8+Math.log1p(9.8*re)/.41);
  for(let k=0;k<70;k++){const u=(l+h)/2;if(u*(u+remainder(.41*u))<re)l=u;else h=u;}
  const up=(l+h)/2,extra=remainder(.41*up),friction=s/up,resistance=s/up**2;
  return {resistance,sst:[Math.hypot(6*nu/(.075*y*y),friction/(.41*.3*y)),
    extra/(up+extra)*friction**3/(.41*y),up/(up+extra)*nu/y]};
}

async function timeWallKernels(gpu){
  const device=gpu.device,N=262144,records=new Float32Array(N*4);let random=1773;
  for(let i=0;i<N;i++){
    random=(Math.imul(random,1664525)+1013904223)>>>0;
    const re=10**(-3+10*random/2**32),y=.001*(1+i%13),nu=i%2?1.5e-5:1e-6;
    records.set([re*nu/y,y,nu,0],4*i);
  }
  const old=`fn sstWall(speed:f32,y:f32,nu:f32)->vec3f{
    let re=speed*y/nu;var resistance=nu/y;
    if(re>=.001){var lo=0.;var hi=min(sqrt(re),8.+log(1.+9.8*re)/.41);
      for(var i=0u;i<14u;i++){let u=.5*(lo+hi);let x=.41*u;
        let extra=max(0.,exp(min(x,80.))-1.-x-.5*x*x-x*x*x/6.);
        if(u*(u+extra/9.8)>re){hi=u;}else{lo=u;}}
      let up=.5*(lo+hi);resistance=speed/(up*up);}
    let friction=sqrt(max(0.,speed*resistance));let fraction=clamp(nu/(y*resistance),0.,1.);
    return vec3f(length(vec2f(6.*nu/(.075*y*y),friction/(.41*.3*y))),
      (1.-fraction)*friction*friction*friction/(.41*y),fraction*nu/y);
  }`;
  const body=`@group(0) @binding(0) var<storage,read> src:array<vec4f>;
    @group(0) @binding(1) var<storage,read_write> out:array<vec4f>;
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) id:vec3u){
      let x=src[id.x];out[id.x]=vec4f(sstWall(x.x,x.y,x.z),1.);
    }`;
  const ops=await Promise.all([old,sstWallWGSL].map((s,k)=>gpu.kernel('CFD timed wall closure '+k,s+body)));
  const input=gpu.buffer('Wall timing input',records),out=gpu.buffer('Wall timing result',records.byteLength);
  const bindings=ops.map(p=>gpu.bind(p,[input,out]));
  const query=device.features.has('timestamp-query')?device.createQuerySet({type:'timestamp',count:2}):null;
  const ticks=query?gpu.buffer('Wall time query',16,GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC):null;
  const read=query?gpu.staging('Wall timestamp pair',16):null;
  const results=[[],[]],timestamp=[[],[]],median=a=>a.slice().sort((x,y)=>x-y)[Math.floor(a.length/2)];
  try{
    for(let sweep=0;sweep<10;sweep++)for(const k of sweep%2?[1,0]:[0,1]){
      await device.queue.onSubmittedWorkDone();const start=performance.now(),e=device.createCommandEncoder();
      const pass=e.beginComputePass(query?{timestampWrites:{querySet:query,beginningOfPassWriteIndex:0,endOfPassWriteIndex:1}}:{});
      pass.setPipeline(ops[k]);pass.setBindGroup(0,bindings[k]);pass.dispatchWorkgroups(N/128);pass.end();
      if(query){e.resolveQuerySet(query,0,2,ticks,0);e.copyBufferToBuffer(ticks,0,read,0,16);}
      device.queue.submit([e.finish()]);await device.queue.onSubmittedWorkDone();const ms=performance.now()-start;
      if(sweep>0)results[k].push(ms);
      if(query){await read.mapAsync(GPUMapMode.READ);
        try{const t=new BigUint64Array(read.getMappedRange());if(sweep>0)timestamp[k].push(Number(t[1]-t[0])*1e-6);}
        finally{read.unmap();}
      }
    }
    return {samples:N,acceptedPairs:9,methods:['fourteen bisections','four Newton updates'],medianWallMs:results.map(median),
      ...(query?{medianGpuMs:timestamp.map(median),gpuMs:timestamp}:{})};
  }finally{query?.destroy();}
}

export async function verifyWallLinearization(device){
  const gpu=gpuScope(device),N=65,span=32,inputs=new Float32Array(N*span),slope=[.33,-.52,.49],rows=[];
  const seed=[.42,-.71,.53],sstSeed=[-.13,.22,.71];
  for(let i=0;i<N;i++){
    const re=i?10**(-3+10*(i-1)/(N-2)):0,nu=i%2?1.5e-5:1.e-6,y=.002+.00013*(i%9);
    const n=unit([.3+Math.sin(i*.2),.6,Math.cos(.17*i)]),t=unit(cross(n,[.03,.21,-.91]));
    const speed=re*nu/y,relative=t.map((v,k)=>speed*(v+.49*n[k])),a=(.65+.1*(i%7))/y;
    const normalDirection=unit(cross(n,t)),velocityDirection=plus(t,normalDirection,.42).map(x=>x*speed);
    const sst=reference(speed,y,nu).sst,scales=sst.map((x,k)=>sstSeed[k]/Math.max(Math.abs(x),k===1?1e-20:1e-16));
    const address=i*span;
    inputs.set([...relative,y,...n,nu,...velocityDirection,a,...normalDirection,0,...seed,0,...scales,0,...slope,0],address);
    rows.push({re,y,nu,n,t,speed,relative,a,normalDirection,velocityDirection,scales});
  }
  try{
    const state=gpu.buffer('Wall response differential inputs',inputs),out=gpu.buffer('Wall response and signed derivatives',N*48);
    const pipe=await gpu.kernel('CFD transpose of Spalding wall traction and SST boundary response',sstWallWGSL+reverse+`
      struct Row{v:vec4f,n:vec4f,dv:vec4f,dn:vec4f,seed:vec4f,closure:vec4f,slope:vec4f,pad:vec4f}
      @group(0) @binding(0) var<storage,read> input:array<Row>;
      @group(0) @binding(1) var<storage,read_write> result:array<vec4f>;
      @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3u){
        if(g.x>=arrayLength(&input)){return;}let i=g.x;let r=input[i];let y=r.v.w;let nu=r.n.w;
        let n=normalize(r.n.xyz);let slip=tangentialSlip(r.v.xyz,n);let speed=length(slip);let angle=r.dn.xyz;
        let wall=wallFriction(speed,y,nu);let j=reverseWallMomentum(r.v.xyz,n,y,nu,r.dv.w,r.seed.xyz);
        result[3u*i]=vec4f(wall.x,sstWall(speed,y,nu));
        result[3u*i+1u]=vec4f(dot(j.relative,r.dv.xyz),dot(j.normal,angle),dot(j.parameters,r.slope.xyz),wall.y);
        result[3u*i+2u]=vec4f(reverseSstSurface(speed,y,nu,r.closure.xyz),0.);
      }`);
    gpu.run(pipe,[state,out],[Math.ceil(N/64)]);
    const values=await gpu.read(out,gpu.staging('Independent wall responses',out.size),N*12);
    let resistanceError=0,closureError=0,tractionError=0,turbulenceError=0,signErrors=0;
    const epsilon=1e-4,derivative=fun=>(fun(epsilon)-fun(-epsilon))/(2*epsilon);
    for(let i=0;i<N;i++){
      const r=rows[i],j=12*i,base=reference(r.speed,r.y,r.nu);
      resistanceError=Math.max(resistanceError,Math.abs(values[j]/base.resistance-1));
      for(let k=0;k<3;k++)closureError=Math.max(closureError,Math.abs(values[j+1+k]-base.sst[k])/Math.max(1e-19,Math.abs(base.sst[k])));
      function impulse(v,n,y,nu,a){
        const tangential=plus(v,n,-dot(n,v)),rate=a*reference(Math.hypot(...tangential),y,nu).resistance;
        return dot(seed,tangential)*rate/(1+rate);
      }
      const finite=[derivative(x=>impulse(plus(r.relative,r.velocityDirection,x),r.n,r.y,r.nu,r.a)),
        derivative(x=>impulse(r.relative,unit(plus(r.n,r.normalDirection,x)),r.y,r.nu,r.a)),
        derivative(x=>impulse(r.relative,r.n,r.y*Math.exp(x*slope[0]),r.nu*Math.exp(x*slope[1]),r.a*Math.exp(x*slope[2])))];
      const scale=r.speed*r.a*base.resistance/(1+r.a*base.resistance);
      for(let k=0;k<3;k++){
        tractionError=Math.max(tractionError,Math.abs(finite[k]-values[j+4+k])/Math.max(1e-20,scale));
        if(Math.abs(finite[k])>scale*1e-4&&finite[k]*values[j+4+k]<=0)signErrors++;
        const slope=derivative(x=>dot(r.scales,reference(r.speed*(k===0?Math.exp(x):1),
          r.y*(k===1?Math.exp(x):1),r.nu*(k===2?Math.exp(x):1)).sst));
        turbulenceError=Math.max(turbulenceError,Math.abs(slope-values[j+8+k])/Math.max(1,Math.abs(slope)));
        if(Math.abs(slope)>1e-5&&slope*values[j+8+k]<=0)signErrors++;
      }
    }
    const timing=await timeWallKernels(gpu);
    return {pass:resistanceError<3e-6&&closureError<5e-5&&tractionError<8e-6&&turbulenceError<8e-5&&!signErrors,timing,
      samples:N,wallReRange:[0,1e7],resistanceError,closureError,tractionError,turbulenceError,signErrors};
  }finally{gpu.close();}
}
