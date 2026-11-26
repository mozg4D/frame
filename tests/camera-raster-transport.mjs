// Raster observations and supplemental hits use the same native visibility,
// material decoding, lights and BVH as the shipped Camera.
export async function sampleRasterViews({views,grid,base,size}){
  const t=window.rasterTracer,dev=t.device,resources=[];
  const nodesPerView=grid[0]*grid[1],slots=32,extra=2,words=20;
  const sizeBytes=nodesPerView*(1+extra)*words*4;
  const desc=(size,usage)=>{const b=dev.createBuffer({size,usage});resources.push(b);return b;};
  const out=desc(sizeBytes,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC),copy=desc(sizeBytes,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);
  const code=window.rasterSource+`
    struct Observation {p:vec3f,tri:u32,n:vec3f,cell:u32,rho:vec3f,owner:u32,d:vec3f,material:u32,emission:vec3f,seed:u32};
    @group(1) @binding(0) var hits:texture_2d<u32>;
    @group(1) @binding(1) var<storage,read_write> obs:array<Observation>;
    fn observation(r:Receiver)->Observation{
      let key=patchKey(r);let hash=sampleHash(key.x^sampleHash(key.y));
      var seed=giPixelSampler(hash,1234u);var energy=vec3f(0.);
      for(var k=0u;k<16u;k++){energy+=directLighting(r,&seed,3u).diffuse;}
      let rho=diffuseBase(r.surface);
      return Observation(r.p,key.x,r.surface.normal,key.y,rho,u32(r.triangle.nb.w),rho*(energy/16.),u32(r.triangle.a.w),r.surface.emission,hash);
    }
    fn localDirection(n:vec3f,hash:u32,s:u32)->vec3f{
      let u=(f32(s)+.5)/32.;let phi=6.2831853*fract(f32(s)*.618033989+f32(hash&65535u)/65536.);
      let axis=select(vec3f(0.,0.,1.),vec3f(1.,0.,0.),abs(n.z)>.8);
      let x=normalize(cross(axis,n));return sqrt(u)*(cos(phi)*x+sin(phi)*cross(n,x))+sqrt(1.-u)*n;
    }
    @compute @workgroup_size(8,8) fn capture(@builtin(global_invocation_id) id:vec3u){
      if(id.x>=GXu||id.y>=GYu){return;}let offset=(id.y*GXu+id.x)*3u;
      let xy=min(vec2u((vec2f(id.xy)+.5)*vec2f(params.image.xy)/vec2f(GX.,GY.)),params.image.xy-1u);
      let h=textureLoad(hits,xy,0);let empty=Observation(vec3f(0.),0u,vec3f(0.),0u,vec3f(0.),0u,vec3f(0.),0u,vec3f(0.),0u);
      obs[offset]=empty;obs[offset+1u]=empty;obs[offset+2u]=empty;if(h.x==0u){return;}
      let r=atPixel(h,xy);let node=observation(r);obs[offset]=node;
      for(var k=0u;k<2u;k++){
        let slot=(node.seed+k*17u)&31u;let d=localDirection(node.n,node.seed,slot);var early=false;
        let world=intersectGeometry(0u,originFor(r,d),d,1e20,false,false,false,&early);
        if(world.triangle!=EMPTY_SLOT){obs[offset+1u+k]=observation(receiver(world,d));}
      }
    }`.replaceAll('GX',String(grid[0])).replaceAll('GY',String(grid[1]));
  const layout=dev.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:'uint'}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}}]});
  const mod=dev.createShaderModule({code}),compiled=performance.now();
  const pipe=await dev.createComputePipelineAsync({layout:dev.createPipelineLayout({bindGroupLayouts:[t.programs.sceneLayout,layout]}),
    compute:{module:mod,entryPoint:'capture',constants:{sceneFeatures:0,variableSceneFeatures:15}}});
  const compileMs=performance.now()-compiled,records=[],poses=[],costs=[];
  try{
    for(let i=0;i<views.length;i++){
      const at=performance.now(),camera=views[i],pixels=i===views.length-1?size:[320,200];
      await t.start({...base,camera,outputSize:pixels,rect:{x:0,y:0,w:pixels[0],h:pixels[1]},viewKey:'raster-graph-'+i,
        finish:false,motion:true,refine:false,current:undefined,renderer:'Interactive GI',previewPresentation:i===views.length-1});
      if(t.stats.phase!=='preview')throw Error(t.stats.errors.join('\n'));
      const rasterReady=performance.now(),bg=t.group(layout,[t.cameraImage.hitView,out]),f=t._paramF32;
      poses.push({p:Array.from(f.subarray(0,3)),right:camera.right,up:camera.up,forward:camera.forward,tanX:f[7],tanY:f[11]});
      const enc=dev.createCommandEncoder();t.encodeCompute(enc,pipe,'Raster patches, source radiance and world supplements',[t.sceneBindGroup,bg],grid);
      enc.copyBufferToBuffer(out,0,copy,0,sizeBytes);dev.queue.submit([enc.finish()]);await copy.mapAsync(GPUMapMode.READ);
      records.push(copy.getMappedRange().slice(0));copy.unmap();
      costs.push({nativeCameraMs:rasterReady-at,captureAndReadbackMs:performance.now()-rasterReady});
    }
  }finally{resources.forEach(b=>b.destroy());}
  return {records,poses,grid,slots,extra,words,compileMs,costs};
}

export function rasterLinks({records,poses,grid,words,extra,slots}){
  const at=performance.now(),[w,h]=grid,nodes=[],keys=new Map(),maps=[],checked=[],supplements=[];
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
  function record(f,u,offset){
    if(!u[offset+3])return -1;
    const key=u[offset+3]+':'+u[offset+7];if(keys.has(key))return keys.get(key);
    const vec=k=>[f[offset+k],f[offset+k+1],f[offset+k+2]],id=nodes.length;
    nodes.push({p:vec(0),tri:u[offset+3],n:vec(4),rho:vec(8),direct:vec(12),emission:vec(16),seed:u[offset+19]});
    keys.set(key,id);return id;
  }
  for(const bytes of records){
    const f=new Float32Array(bytes),u=new Uint32Array(bytes),map=new Int32Array(w*h);maps.push(map);
    for(let i=0;i<map.length;i++)map[i]=record(f,u,i*(1+extra)*words);
  }
  const represented=nodes.length;
  for(let v=0;v<records.length;v++){
    const f=new Float32Array(records[v]),u=new Uint32Array(records[v]);
    for(let i=0;i<w*h;i++){
      const id=maps[v][i];if(id<0||supplements[id])continue;
      supplements[id]=Array.from({length:extra},(_,k)=>record(f,u,(i*(extra+1)+k+1)*words));
    }
  }
  function direction(n,seed,slot){
    const u=(slot+.5)/slots,phi=2*Math.PI*(slot*.618033989+(seed&65535)/65536);
    const x=Math.abs(n[2])>.8?[0,-n[2],n[1]]:[-n[1],n[0],0],len=Math.hypot(...x);
    for(let k=0;k<3;k++)x[k]/=len;
    const y=[n[1]*x[2]-n[2]*x[1],n[2]*x[0]-n[0]*x[2],n[0]*x[1]-n[1]*x[0]];
    return n.map((c,k)=>Math.sqrt(u)*(Math.cos(phi)*x[k]+Math.sin(phi)*y[k])+Math.sqrt(1-u)*c);
  }
  function march(receiver,d){
    let best=-1,nearest=Infinity;
    for(let v=0;v<poses.length;v++){
      const cam=poses[v],o=sub(receiver.p,cam.p),map=maps[v];
      const rx=dot(o,cam.right)/cam.tanX,ry=dot(o,cam.up)/cam.tanY,rz=dot(o,cam.forward);
      const dx=dot(d,cam.right)/cam.tanX,dy=dot(d,cam.up)/cam.tanY,dz=dot(d,cam.forward);
      let prior=-1;
      for(let t=.001;t<3&&t<nearest*1.4;t*=1.38){
        const z=rz+t*dz;if(z<=.0001)continue;
        const x=(.5+.5*(rx+t*dx)/z)*w,y=(.5-.5*(ry+t*dy)/z)*h;
        if(x<0||x>=w||y<0||y>=h)continue;
        const donor=map[(y|0)*w+(x|0)];if(donor<0||donor===prior)continue;prior=donor;
        const b=nodes[donor];if(b.tri===receiver.tri)continue;
        const den=dot(d,b.n);if(Math.abs(den)<1e-5)continue;
        const dist=dot(sub(b.p,receiver.p),b.n)/den;
        if(dist<=.00015||dist>=nearest)continue;
        const depth=rz+dist*dz;if(depth<=0)continue;
        const px=(.5+.5*(rx+dist*dx)/depth)*w,py=(.5-.5*(ry+dist*dy)/depth)*h;
        if((px|0)!==(x|0)||(py|0)!==(y|0)||px<0||py<0)continue;
        nearest=dist;best=den<0?donor:-2;
      }
    }return best;
  }
  const counts={raster:0,worldHit:0,worldMiss:0,blocked:0,unknown:0},edges=[];
  for(let i=0;i<nodes.length;i++){
    const a=nodes[i],sum=new Map();
    for(let s=0;s<slots;s++){
      const slot=(s-(a.seed&31)+32)&31,exact=slot===0?0:slot===17?1:-1;
      let j;
      if(exact>=0&&supplements[i]){j=supplements[i][exact];counts[j>=0?'worldHit':'worldMiss']++;}
      else{j=march(a,direction(a.n,a.seed,s));counts[j>=0?'raster':j===-2?'blocked':'unknown']++;}
      if(j>=0)sum.set(j,(sum.get(j)||0)+1/slots);
    }
    edges.push(Array.from(sum));checked.push(Array.from(sum.values()).reduce((a,b)=>a+b,0));
  }
  return {nodes,edges,maps,represented,hidden:nodes.length-represented,counts,
    knownDonorMass:checked.reduce((a,b)=>a+b,0)/Math.max(1,nodes.length),buildMs:performance.now()-at};
}
