import {cutBandAdjoint,cutBandSampling,cutFaceSeal,cutGridWGSL,cutMetricWGSL,extendWallDistance,gpuScope,subcellMetricWGSL,
  gridWGSL,metricBuffer,metricWGSL} from '../../plugin.js';

export async function verifyNativeBandAdjoint(device,subcell=false){
  const dims=[20,14,10],n=dims.reduce((a,b)=>a*b),h=.007;
  const axes=dims.map((d,a)=>Float64Array.from({length:d+1},(_,i)=>h*i*(.89+.009*i+.035*a)));
  const f={dims,axes,h,origin:[-.064,-.035,-.029],sheetLinks:true,subcellSurface:subcell};
  const band={dims:[32,25,18],h:.0058,origin:[-.072,-.042,-.037]},[nx,ny]=band.dims;
  const count=band.dims.reduce((a,b)=>a*b),initial=new Float32Array(count);
  for(let i=0;i<count;i++){
    const p=[i%nx,Math.floor(i/nx)%ny,Math.floor(i/(nx*ny))].map((v,a)=>v*band.h+band.origin[a]);
    const r=Math.hypot((p[0]-.0091)*.87,(p[1]-.0057)*1.09,(p[2]-.0039)*1.2);
    initial[i]=Math.max(-4.2,Math.min(3.7,(.0289-r)/band.h));
  }
  const masks=Uint32Array.from({length:n},(_,i)=>i%19===7?1<<((i>>3)%3):0);
  const gpu=gpuScope(device),grid=[Math.ceil(n/128)],coords=metricBuffer(gpu,f),work=gpu.buffer('Cell geometry objective',48*n);
  const d=gpu.buffer('Signed native metric driver',initial),w=gpu.buffer('Unextended physical wall',16*n),raw=gpu.buffer('Raw cut fractions',16*n);
  const mu=gpu.buffer('Sealed cut fractions',16*n),centers=gpu.buffer('Geometric face centres',24*n);
  const decl=(b,id,t,write=false)=>`@group(0) @binding(${b}) var<storage,${write?'read_write':'read'}> ${id}:array<${t}>;`;
  const build=await gpu.kernel('CFD independently rebuild native band test geometry',gridWGSL(f)+metricWGSL(f)+decl(0,'metric','f32')+
    cutBandSampling(f,band)+cutGridWGSL+cutMetricWGSL+(subcell?subcellMetricWGSL:'')+decl(1,'raw','vec4f',true)+decl(2,'centers','FaceCenters',true)+decl(3,'wall','vec4f',true)+`
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
      let i=g.x;if(i>=CELLS){return;}let p=point(i);
      ${subcell?'let cut=subcellCut(p);raw[i]=cut.metric;centers[i]=cut.centers;':
        'let q=cellSamples(p);let m=cutMetric(q);raw[i]=m;centers[i]=cutFaceCenters(q,m);'}
      wall[i]=vec4f(surfaceDistance(cellCenters(p)),0.,0.,0.);
    }`);
  const bind=gpu.bind(build,[d,raw,centers,w],coords),seal=await cutFaceSeal(gpu,f,gridWGSL(f),raw,mu,gpu.buffer('Fixed resolved sheet crossings',masks));
  const stage=gpu.staging('Independent cut and distance observations',Math.max(4*count,48*n)),read=b=>gpu.read(b,stage,b.size/4);
  const dispatch=fn=>{const e=device.createCommandEncoder();fn(e);device.queue.submit([e.finish()]);};
  async function forward(values,retained=false){
    device.queue.writeBuffer(d,0,values);dispatch(e=>{gpu.dispatch(e,build,bind,grid);seal(e);});
    if(subcell)return null;
    const transient=gpuScope(device);
    try{return await extendWallDistance(transient,f,w,3.7,retained?gpu:null);}finally{transient.close();}
  }
  try{
    const rows=[],z=new Float32Array(12*n),extension=await forward(initial,true);
    const height=await extension?.adjoint(work),cut=await cutBandAdjoint(gpu,f,band,d,mu,work,height?.bar);
    for(const [mode,objective] of ['cut area and volume','centroids','wall distance in the body and wake'].entries()){
      z.fill(0);
      for(let i=0;i<n;i++){
        for(let a=0;a<3;a++){
          if(mode===0)z[12*i+4*a]=.85*Math.sin(.41*i+.61*a);
          if(mode===1)for(let k=0;k<2;k++)z[12*i+4*a+1+k]=.54*Math.cos(.37*i+.62*a+.38*k);
        }
        if(mode===0)z[12*i+3]=.89*Math.cos(.42*i);
        if(mode===2)z[12*i+7]=.27*Math.sin(.3*i+.19);
      }
      await forward(initial);device.queue.writeBuffer(work,0,z);dispatch(e=>{height?.encode(e);cut.encode(e);});
      const bar=await read(cut.derivatives);
      const direction=initial.map((_,i)=>.22*Math.sin(.083*i+.26)*Math.cos(.0123*i+.19));
      let derivative=0,scale=0;for(let k=0;k<count;k++){const v=bar[k]*direction[k];derivative+=v;scale+=Math.abs(v);}
      const estimates=[];
      for(const step of [.002,.0007]){
        const fields=[];
        for(const sign of [-1,1]){
          await forward(initial.map((v,i)=>v+sign*step*direction[i]));
          fields.push([await read(mu),await read(centers),await read(w)]);
        }
        const diff=(j,k)=>fields[1][j][k]-fields[0][j][k];let total=0;
        for(let i=0;i<n;i++){
          for(let a=0;a<3;a++){total+=z[12*i+4*a]*diff(0,4*i+a);
            for(let k=0;k<2;k++)total+=z[12*i+4*a+k+1]*diff(1,6*i+2*a+k);}
          total+=z[12*i+3]*diff(0,4*i+3)+z[12*i+7]*diff(2,4*i);
        }
        const secant=total/(2*step);estimates.push({step,secant,normalizedError:Math.abs(secant-derivative)/scale});
      }
      rows.push({objective,derivative,scale,estimates});
    }
    return {pass:rows.every(r=>r.scale>0&&r.estimates.every(e=>e.normalizedError<.003)),dims,band,subcell,activeCells:cut.activeCells,rows};
  }finally{gpu.close();}
}

export const verifySubcellBandAdjoint=device=>verifyNativeBandAdjoint(device,true);
