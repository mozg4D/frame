// Immutable physical replay. Parallel unit plates face inward, with finite-area quadrature.
// Opposite-facing convex plates are a zero-transfer control. Each instance has its own D and R.
export function cavityData(nx,ny,instances){
  const half=nx*ny,n=half*2,rows=instances*3,gap=.45,area=1/half;
  const W=new Float32Array(n*n),X=new Float32Array(rows*n),R=new Float32Array(rows*n);
  const at=performance.now();
  for(let i=0;i<half;i++)for(let j=0;j<half;j++){
    const dx=(i%nx-j%nx)/nx,dy=(Math.floor(i/nx)-Math.floor(j/nx))/ny;
    let f=0;
    for(const x of [-.5,0,0,.5])for(const y of [-.5,0,0,.5]){
      const d2=(dx+x/nx)**2+(dy+y/ny)**2+gap*gap;
      f+=area*gap*gap/(16*Math.PI*d2*d2);
    }
    W[i*n+half+j]=W[(half+j)*n+i]=f;
  }
  for(let row=0;row<rows;row++)for(let k=0;k<n;k++){
    const instance=Math.floor(row/3),channel=row%3,face=k%half,u=(face%nx+.5)/nx,v=(Math.floor(face/nx)+.5)/ny;
    const lx=(Math.sin(instance*1.7)+1)/2,ly=(Math.cos(instance*.91)+1)/2;
    X[row*n+k]=k>=half?0:(.15+.85*channel/2)/(1+18*((lx-u)**2+(ly-v)**2));
    R[row*n+k]=.2+.7*((row*11+k*3)%31)/30;
  }
  const selected=[0,Math.min(rows-1,7),rows-1],reference=[];
  for(const row of selected){
    let x=Float64Array.from(X.subarray(row*n,(row+1)*n)),sum=x.slice();
    for(let order=0;order<4;order++){
      const y=new Float64Array(n);
      for(let i=0;i<n;i++){let v=0;const first=i<half?half:0;
        for(let j=first;j<first+half;j++)v+=W[j*n+i]*x[j];
        y[i]=R[row*n+i]*v;sum[i]+=y[i];
      }x=y;
    }reference.push(sum);
  }
  return {n,rows,W,X,R,selected,reference,constructionMs:performance.now()-at};
}

// Replay 32,768 surface patches with 64 real donor links each. Changing the address
// permutation changes locality, while the geometry, source inputs and expected RGB stay identical.
export async function sparseReplay(){
  const device=window.transportCamera.device,count=32768,degree=64,owned=[],runs=[];
  const storage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST;
  const buf=(bytes,usage=storage)=>{const b=device.createBuffer({size:bytes,usage});owned.push(b);return b;};
  const upload=a=>{const b=buf(a.byteLength);device.queue.writeBuffer(b,0,a);return b;};
  const module=device.createShaderModule({code:`
    @group(0) @binding(0) var<storage,read> inputs:array<vec4f>;
    @group(0) @binding(1) var<storage,read> donors:array<u32>;
    @group(0) @binding(2) var<storage,read> weights:array<u32>;
    @group(0) @binding(3) var<storage,read> scales:array<f32>;
    @group(0) @binding(4) var<storage,read_write> outputs:array<vec4f>;
    @group(0) @binding(5) var<storage,read_write> total:array<vec4f>;
    override bits:u32=32u;
    @compute @workgroup_size(64) fn step(@builtin(global_invocation_id) id:vec3u){
      let row=id.x;if(row>=32768u){return;}var v=vec3f(0.);
      for(var j=0u;j<64u;j++){
        let idx=row*64u+j;var w=0.;
        if(bits==32u){w=bitcast<f32>(weights[idx]);}
        else if(bits==16u){w=unpack2x16float(weights[idx/2u])[idx%2u];}
        else{w=f32((weights[idx/8u]>>((idx%8u)*4u))&15u)*scales[row];}
        v+=inputs[donors[idx]].rgb*w;
      }
      let out=v*inputs[row].w;outputs[row]=vec4f(out,inputs[row].w);total[row]+=vec4f(out,0.);
    }`}),pipelines={};
  for(const bits of [32,16,4])pipelines[bits]=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'step',constants:{bits}}});
  try{for(const scattered of [false,true]){
    const idx=i=>scattered?(i*20077)&32767:i,start=performance.now();
    const donors=new Uint32Array(count*degree),weights=new Float32Array(donors.length),half=new Float16Array(donors.length);
    const quant=new Uint32Array(donors.length/8),scales=new Float32Array(count),input=new Float32Array(4*count);
    for(let i=0;i<count;i++){
      const group=Math.floor(i/128),side=(i>>6)&1,patch=i%64,row=idx(i),gap=.32+.3*((group*29)%97)/96;
      const u=(patch%8+.5)/8,v=((patch>>3)+.5)/8;let hi=0;
      for(let j=0;j<degree;j++){
        const x=u-(j%8+.5)/8,y=v-((j>>3)+.5)/8,f=(gap*gap)/(64*Math.PI*(gap*gap+x*x+y*y)**2),k=row*degree+j;
        donors[k]=idx(group*128+(1-side)*64+j);weights[k]=half[k]=f;hi=Math.max(hi,f);
      }
      const scale=hi/15;scales[row]=scale;
      for(let j=0;j<degree;j++){const k=row*degree+j;quant[k>>3]|=Math.min(15,Math.round(weights[k]/scale))<<((k%8)*4);}
      input.set([side?0:u,side?0:v,side?0:(group%9===0&&patch===3?1000:.03),.3+.65*((group*17+patch)%31)/30],row*4);
    }
    const constructionMs=performance.now()-start,x=upload(input),donorBuf=upload(donors),scaleBuf=upload(scales);
    const ping=buf(input.byteLength),pong=buf(input.byteLength),sum=buf(input.byteLength);
    const read=buf(input.byteLength,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST);let oracle;
    for(const [bits,values] of [[32,weights],[16,half],[4,quant]]){
      const weightBuf=upload(values),p=pipelines[bits],groups=[[x,ping],[ping,pong],[pong,ping]].map(([a,b])=>
        device.createBindGroup({layout:p.getBindGroupLayout(0),entries:[a,donorBuf,weightBuf,scaleBuf,b,sum].map((buffer,binding)=>({binding,resource:{buffer}}))}));
      const run=async()=>{
        const e=device.createCommandEncoder();e.copyBufferToBuffer(x,0,sum,0,input.byteLength);
        for(const g of groups){const pass=e.beginComputePass();pass.setPipeline(p);pass.setBindGroup(0,g);pass.dispatchWorkgroups(count/64);pass.end();}
        device.queue.submit([e.finish()]);await device.queue.onSubmittedWorkDone();};
      await run();const raw=[];
      for(let n=0;n<7;n++){const t=performance.now();await run();raw.push(performance.now()-t);}
      const e=device.createCommandEncoder();e.copyBufferToBuffer(sum,0,read,0,input.byteLength);device.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);
      let err=0,den=0,peak=0;
      try{const a=new Float32Array(read.getMappedRange());if(!oracle)oracle=a.slice();for(let i=0;i<a.length;i++)if(i%4<3){const d=a[i]-oracle[i];err+=d*d;den+=oracle[i]**2;peak=Math.max(peak,Math.abs(d));}}finally{read.unmap();}
      const sorted=raw.toSorted((a,b)=>a-b);
      runs.push({layout:scattered?'permuted':'coherent',bits,links:donors.length,constructionMs,weightBytes:values.byteLength,donorBytes:donors.byteLength,
        p50:sorted[3],p95:sorted[6],raw,nrmse:Math.sqrt(err/den),maxAbs:peak});
    }
  }return runs;}finally{for(const b of owned)b.destroy();}
}

// Opposed square plates, a rigid transform, and a separate rectangle crossing a subset
// of the internal segments. Evaluate actual segment/rectangle intersections per occurrence.
export function intrinsicChecks(){
  const size=8,gap=.45,area=1/(size*size);
  const raw=(p,q,n,m)=>{
    const d=q.map((v,i)=>v-p[i]),length2=d.reduce((s,v)=>s+v*v,0);
    const dot=(u,v)=>u.reduce((s,x,i)=>s+x*v[i],0);
    return area*Math.max(0,dot(n,d))*Math.max(0,-dot(m,d))/(Math.PI*length2*length2);
  };
  const turn=p=>[p[2]+2,p[1]-3,-p[0]+1];
  let inward=0,outward=0,rotated=0,partiallyBlocked=0,remoteBlocker=0;
  for(let i=0;i<size*size;i++)for(let j=0;j<size*size;j++){
    const p=[(i%size+.5)/size,((i/size|0)+.5)/size,0];
    const q=[(j%size+.5)/size,((j/size|0)+.5)/size,gap];
    const f=raw(p,q,[0,0,1],[0,0,-1]);
    inward+=f;outward+=raw(p,q,[0,0,-1],[0,0,1]);rotated+=raw(turn(p),turn(q),[1,0,0],[-1,0,0]);
    const x=(p[0]+q[0])/2,y=(p[1]+q[1])/2;
    if(!(x<.48&&y<.75))partiallyBlocked+=f;
    if(!(x>1.25&&x<1.4&&y<.75))remoteBlocker+=f;
  }
  return {opposed:inward/(size*size),convex:outward/(size*size),relativeRigidError:Math.abs(rotated-inward)/inward,
    partiallyBlockedFraction:partiallyBlocked/inward,unobstructedFraction:remoteBlocker/inward};
}

// Q4 coarse corrections must lower the true, signed fine residual of the same system.
// This deliberately exercises the difference mode which a rank-one quantized inverse loses.
export function residualChecks(){
  const a=.98,diag=1/(1-a*a),off=a*diag,scale=diag/15,qd=Math.round(diag/scale)*scale,qo=Math.round(off/scale)*scale;
  const A=([u,v])=>[u-a*v,v-a*u],rhs=[1,-1],res=x=>A(x).map((v,i)=>rhs[i]-v),norm=x=>Math.hypot(...x);
  let x=[0,0],rejects=0,fineSteps=0;
  for(let i=0;i<16;i++){
    const r=res(x);if(norm(r)<1e-8)break;
    const trial=[x[0]+qd*r[0]+qo*r[1],x[1]+qo*r[0]+qd*r[1]];
    if(norm(res(trial))<norm(r)*.99)x=trial;
    else{rejects++;fineSteps++;x=x.map((v,k)=>v+.5*r[k]);}
  }
  const represented=x=>Math.min(15,Math.max(0,Math.round(x/.1*15)))*.1/15;
  return {rankLost:qd===qo,rejects,fineSteps,residual:norm(res(x)),fineSolution:x,
    hdr:{unquantized:1e-4*1e4,quantized:represented(1e-4)*1e4},signedZeroCode:8};
}

// Signed residuals are quantized around exact zero. This probes QDQ semantics only.
// No backend instruction or fusion follows from a successful build or numerical result.
export async function quantizedResidualProbe(){
  const runs=[];if(!navigator.ml)return [{failure:'navigator.ml unavailable'}];
  for(const deviceType of ['gpu','npu'])for(const type of ['int4','uint4']){
    const m={deviceType,type,nativeArithmetic:'unverified',fusion:'unverified'};runs.push(m);let ctx,g,x,y;
    try{
      ctx=await navigator.ml.createContext({deviceType});const b=new MLGraphBuilder(ctx),n=32,signed=type==='int4';
      const packed=v=>{const out=new Uint8Array(Math.ceil(v.length/2));v.forEach((q,i)=>out[i>>1]|=(q&15)<<((i&1)*4));return out;};
      const weightZero=signed?-8:0,inputZero=signed?0:8,ds=(dataType,shape)=>({dataType,shape});
      const values=Array.from({length:n*n},(_,i)=>{const row=Math.floor(i/n),col=i%n;return weightZero+(row===col||col===(row^1)?15:0);});
      const residual=Array.from({length:2*n},(_,i)=>i<n?(i%2?7:-7):(i===n+4?7:0));
      const coef=b.constant(ds(type,[n,n]),packed(values)),xx=b.input('x',ds(type,[2,n]));m.packedAccepted=true;
      const half=(shape,data)=>b.constant(ds('float16',shape),new Float16Array(data));
      const scalar=(dataType,shape,value)=>b.constant(ds(dataType,shape),packed([value]));
      const w=b.dequantizeLinear(coef,half([1,1],[1/(1-.98*.98)/15]),scalar(type,[1,1],weightZero));
      const v=b.dequantizeLinear(xx,half([1,1],[1/7]),scalar(type,[1,1],inputZero));
      g=await b.build({out:b.matmul(v,w)});m.graphBuilt=true;m.graphDevices=g.devices?Array.from(g.devices):null;
      x=await ctx.createTensor({...ds(type,[2,n]),writable:true});y=await ctx.createTensor({...ds('float16',[2,n]),readable:true});
      ctx.writeTensor(x,packed(residual.map(q=>q+inputZero)));ctx.dispatch(g,{x},{out:y});
      const result=new Float16Array(await ctx.readTensor(y));m.dispatched=true;
      m.alternatingMax=Math.max(...Array.from(result.subarray(0,n),Math.abs));m.localizedCorrection=Number(result[n+4]);
      m.outputFinite=result.every(Number.isFinite);
    }catch(e){m.failure=String(e);}
    finally{x?.destroy();y?.destroy();g?.destroy();ctx?.destroy();}
  }return runs;
}
