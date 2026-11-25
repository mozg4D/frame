import {gpuScope,controlVolumeRegion,cellWidth,regionalWallLoads,clipNativeSurfaceRegion} from '../../plugin.js';

export async function verifyRegionVolumes(device){
  const gpu=gpuScope(device),dims=[16,16,16],h=.01,n=4096;
  const axes=dims.map((d,a)=>Float64Array.from({length:d+1},(_,i)=>(i-8)*h*(1+.055*a*Math.cos(i*.2))));
  const f={dims,h,axes,origin:axes.map(v=>v[0])};
  const dot=(x,y)=>x.reduce((s,v,i)=>s+v*y[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const step=Float64Array.from({length:n},(_,i)=>h**3*cellWidth(f,0,i%16)*cellWidth(f,1,(i>>4)%16)*cellWidth(f,2,i>>8));
  const volume=weights=>dot(weights,step);
  const reports=[];
  try{
    for(const [basis,angle] of [[[[.026,0,0],[0,.016,0],[0,0,.012]],0],
      [[[.021,-.005,.004],[.008,.017,-.007],[-.003,.004,.019]],.61],
      [[[-.019,0,0],[.005,.025,0],[0,.004,.014]],-.42]]){
      const body={center:[.0008,.0041,-.0025],halfAxes:basis},extent=8*Math.abs(dot(basis[0],cross(basis[1],basis[2])));
      const half=s=>({center:body.center.map((x,j)=>x+s*.5*basis[0][j]),halfAxes:[basis[0].map(x=>x*.5),...basis.slice(1)]});
      const values=[];
      for(const region of [body,half(-1),half(1)]){
        const op=await controlVolumeRegion(gpu,f,region),e=device.createCommandEncoder();op.angle(angle);op.encode(e);device.queue.submit([e.finish()]);
        values.push(await gpu.read(op.mask,gpu.staging('CFD clipped volume reference',n*4),n));
      }
      const [whole,left,right]=values;let partitionError=0,clipped=0;
      for(let i=0;i<n;i++){partitionError=Math.max(partitionError,Math.abs(whole[i]-left[i]-right[i]));if(whole[i]>0&&whole[i]<1)clipped++;}
      const errors=[Math.abs(volume(whole)/extent-1),Math.abs(volume(left)/(.5*extent)-1),Math.abs(volume(right)/(.5*extent)-1)];
      reports.push({extent,volume:volume(whole),angle,clipped,partitionError,relativeErrors:errors,
        pass:clipped>10&&partitionError<1e-4&&Math.max(...errors)<8e-6});
    }
    return {reports,pass:reports.every(r=>r.pass)};
  }finally{gpu.close();}
}

export async function verifyRegionalWrench(device){
  const gpu=gpuScope(device),dims=[8,8,8],n=512;
  try{
    const result=[];
    for(const moving of [false,true]){
      const f={dims,h:.01,origin:[-.04,-.04,-.04],rotatingFrame:moving};
      const roi=await controlVolumeRegion(gpu,f,{center:[.008,.009,-.005],halfAxes:[[.013,0,0],[.003,.023,0],[.002,.004,.014]]});
      const force=gpu.buffer('CFD manufactured axial load',4*n),loads=gpu.buffer('CFD manufactured moments',32*n);
      const op=await regionalWallLoads(gpu,f,force,loads,roi),actual=new Float64Array(8*n);
      const read=gpu.staging('CFD checked regional geometry',4*n),angles=moving?[.03,.21,-.35,.72]:[0];
      for(const angle of angles){
        const axial=new Float32Array(n),v=new Float32Array(8*n);
        for(let i=0;i<n;i++){axial[i]=.05*Math.sin(i+angle);v.set([0,Math.cos(2*i),.15+i/n,Math.cos(3*i+angle)],4*i);
          v.set([0,0,Math.sin(i+angle),Math.cos(1.7*i)],4*(n+i));}
        device.queue.writeBuffer(force,0,axial);device.queue.writeBuffer(loads,0,v);op.angle(angle);
        const e=device.createCommandEncoder();roi.encode(e);op.encode(e);device.queue.submit([e.finish()]);
        const w=await gpu.read(roi.mask,read,n),c=Math.cos(angle),s=Math.sin(angle);
        for(let i=0;i<n;i++){
          const values=[axial[i],v[4*i+1],c*v[4*i+2]-s*v[4*i+3],s*v[4*i+2]+c*v[4*i+3],
            0,0,c*v[4*(n+i)+2]-s*v[4*(n+i)+3],s*v[4*(n+i)+2]+c*v[4*(n+i)+3]];
          for(let k=0;k<8;k++)actual[4*(i+(k>=4?n:0))+(k%4)]+=w[i]*values[k];
        }
      }
      const measured=await gpu.read(op.sum,gpu.staging('CFD actual regional wrench',32*n),8*n);
      const maxError=Math.max(...measured.map((v,i)=>Math.abs(v-actual[i])));result.push({moving,maxError,pass:maxError<1e-6});
    }
    const points=new Float32Array([498,2,0,502,2,0,498,6,0,504,3,0,505,3,0,504,4,0]);
    const mesh={storage:'buffer',positions:gpu.buffer('CFD clipped native triangle positions',points),
      indices:gpu.buffer('CFD clipped triangle indices',new Uint32Array([0,1,2,3,4,5])),ownerMatrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]};
    const chunk={mesh,first:0,triangles:2};await clipNativeSurfaceRegion(gpu,[chunk]);
    const perSite=[...await gpu.read(chunk.cover,gpu.staging('CFD fractional triangle coverage',24),6)];
    const first=perSite.slice(0,3).reduce((s,x)=>s+x)/3,second=perSite.slice(3).reduce((s,x)=>s+x)/3;
    return {wrench:result,perSite,first,second,pass:result.every(r=>r.pass)&&Math.abs(first-.75)<1e-6&&second===0};
  }finally{gpu.close();}
}
