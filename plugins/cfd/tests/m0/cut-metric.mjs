import {gpuScope} from './gpu.mjs';

// Fluid is on the positive side of the metric. A common diagonal splits
// every Cartesian face. Six tetrahedra share the body diagonal, so adjacent
// cells integrate exactly the same open area on their common face.
export const cutMetricWGSL=`
  fn edgeFraction(pos:f32,neg:f32)->f32{return pos/(pos-neg);}
  fn triangleFluid(q:vec3f)->f32{
    var mask=0u;for(var i=0u;i<3u;i++){if(q[i]>0.){mask|=1u<<i;}}
    let count=countOneBits(mask);if(count==0u){return 0.;}if(count==3u){return 1.;}
    let one=select(7u^mask,mask,count==1u);let i=firstTrailingBit(one);
    let a=q[i];let fraction=edgeFraction(a,q[(i+1u)%3u])*edgeFraction(a,q[(i+2u)%3u]);
    return select(1.-fraction,fraction,count==1u);
  }
  fn tetraFluid(q:vec4f)->f32{
    var mask=0u;for(var i=0u;i<4u;i++){if(q[i]>0.){mask|=1u<<i;}}
    let count=countOneBits(mask);if(count==0u){return 0.;}if(count==4u){return 1.;}
    if(count!=2u){let one=select(15u^mask,mask,count==1u);let i=firstTrailingBit(one);let a=q[i];
      let v=edgeFraction(a,q[(i+1u)%4u])*edgeFraction(a,q[(i+2u)%4u])*edgeFraction(a,q[(i+3u)%4u]);
      return select(1.-v,v,count==1u);}
    let other=15u^mask;let a=q[firstTrailingBit(mask)];let b=q[firstLeadingBit(mask)];
    let c=q[firstTrailingBit(other)];let d=q[firstLeadingBit(other)];
    let ac=edgeFraction(a,c);let ad=edgeFraction(a,d);let bc=edgeFraction(b,c);let bd=edgeFraction(b,d);
    return ac*ad+(1.-ac)*ad*bc+(1.-ad)*bc*bd;
  }
  fn squareFluid(a:f32,b:f32,c:f32,d:f32)->f32{
    return .5*(triangleFluid(vec3f(a,b,d))+triangleFluid(vec3f(a,c,d)));
  }
  fn cutMetric(q:array<f32,8>)->vec4f{
    var positive=0u;for(var i=0u;i<8u;i++){positive+=u32(q[i]>0.);}
    if(positive==0u){return vec4f(0);}if(positive==8u){return vec4f(1);}
    let faces=vec3f(squareFluid(q[1],q[3],q[5],q[7]),squareFluid(q[2],q[3],q[6],q[7]),squareFluid(q[4],q[5],q[6],q[7]));
    var volume=0.;for(var a=0u;a<3u;a++){for(var b=0u;b<3u;b++){if(a!=b){
      volume+=tetraFluid(vec4f(q[0],q[1u<<a],q[(1u<<a)|(1u<<b)],q[7]));}}}
    return clamp(vec4f(faces,volume/6.),vec4f(0),vec4f(1));
  }
  struct FaceCenters{t:array<vec2f,3>};
  fn triangleMoment(q:vec3f,v:array<vec2f,3>)->vec3f{
    var mask=0u;for(var i=0u;i<3u;i++){if(q[i]>0.){mask|=1u<<i;}}
    let count=countOneBits(mask);let whole=.5*vec3f((v[0]+v[1]+v[2])/3.,1.);
    if(count==0u){return vec3f(0);}if(count==3u){return whole;}
    let i=firstTrailingBit(select(7u^mask,mask,count==1u));let j=(i+1u)%3u;let k=(i+2u)%3u;
    let a=edgeFraction(q[i],q[j]);let b=edgeFraction(q[i],q[k]);
    let part=.5*a*b*vec3f((v[i]+mix(v[i],v[j],a)+mix(v[i],v[k],b))/3.,1.);
    return select(whole-part,part,count==1u);
  }
  fn cutFaceCenters(q:array<f32,8>,m:vec4f)->FaceCenters{
    var out:FaceCenters;let a=vec2f(-.5);let b=vec2f(.5,-.5);let c=-b;let d=-a;
    for(var k=0u;k<3u;k++){if(m[k]>0.&&m[k]<1.){
      let i=1u<<k;let j=i|(1u<<((k+1u)%3u));let l=i|(1u<<((k+2u)%3u));
      let moment=triangleMoment(vec3f(q[i],q[j],q[7]),array<vec2f,3>(a,b,d))+
        triangleMoment(vec3f(q[i],q[l],q[7]),array<vec2f,3>(a,c,d));
      if(moment.z>0.){out.t[k]=clamp(moment.xy/moment.z,vec2f(-.5),vec2f(.5));}
    }}return out;
  }`;

// Both owners fetch a Cartesian vertex through the same integer address.
// Reconstructing it by offsetting each owner's centre would disagree by an
// ulp precisely where a plane touches a grid point.
export const cutGridWGSL=`
  fn vertexAxis(axis:u32,j:i32)->f32{
    if(j==DIMS[axis]){let m=axisMetric(axis,j-1);return m.x+.5*m.y;}
    let m=axisMetric(axis,j);return m.x-.5*m.y;
  }
  fn cutVertex(p:vec3i,i:u32)->vec3f{
    let v=p+vec3i(vec3u(i&1u,(i>>1u)&1u,i>>2u));
    return vec3f(vertexAxis(0u,v.x),vertexAxis(1u,v.y),vertexAxis(2u,v.z));
  }
  fn cellSamples(p:vec3i)->array<f32,8>{
    var q:array<f32,8>;for(var i=0u;i<8u;i++){
      q[i]=surfaceDistance(cutVertex(p,i));
    }
    return q;
  }
  fn fluidRepresentative(p:vec3i,q:array<f32,8>,fraction:f32)->vec4f{
    let center=cellCenters(p);if(fraction<=0.){return vec4f(center,0);}
    if(surfaceDistance(center)>0.){return vec4f(center,1);}
    var best=0u;for(var i=1u;i<8u;i++){if(q[i]>q[best]){best=i;}}
    var lo=center;let corner=cutVertex(p,best);var hi=corner;
    for(var j=0;j<7;j++){let mid=.5*(lo+hi);if(surfaceDistance(mid)>0.){hi=mid;}else{lo=mid;}}
    let insideFluid=.5*(hi+corner);
    return vec4f(select(corner,insideFluid,surfaceDistance(insideFluid)>0.),1.);
  }`;

export async function cutFaceSeal(gpu,f,head,raw,response,flags){
  const kernel=await gpu.kernel('CFD sealed shared cut-cell faces',head+`
    @group(0) @binding(0) var<storage,read> raw:array<vec4f>;
    @group(0) @binding(1) var<storage,read_write> sealed:array<vec4f>;
    ${flags?'@group(0) @binding(2) var<storage,read> crosses:array<u32>;':''}
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
      let i=g.x;if(i>=CELLS){return;}let p=point(i);let cell=raw[i];var open=cell.xyz;
      for(var a=0u;a<3u;a++){
        var j=p;j[a]++;if(!inside(j)){continue;}let other=raw[index(j)].w;
        if(min(cell.w,other)<=0.){open[a]=0.;}
        ${flags?`if(${f.sheetLinks?'true':'min(cell.w,other)==1.'}&&(crosses[i]&(1u<<a))!=0u){open[a]=0.;}`:''}
      }
      sealed[i]=vec4f(open,cell.w);
    }`);
  const group=gpu.bind(kernel,[raw,response,...flags?[flags]:[]]);
  return e=>gpu.dispatch(e,kernel,group,[Math.ceil(f.dims.reduce((a,b)=>a*b)/128)]);
}

// Exact measure of the halfspace n.x >= t in the unit hypercube. This
// inclusion-exclusion integral is independent of the GPU tetrahedra.
function halfspace(n,t){
  for(const a of n)if(a<0)t-=a;
  const axes=n.map(Math.abs).filter(x=>x>0);
  if(!axes.length)return Number(t<0);
  if(t<=0)return 1;if(t>=axes.reduce((a,b)=>a+b,0))return 0;
  let sum=0;
  for(let bits=0;bits<1<<axes.length;bits++){
    let x=t,sign=1;
    axes.forEach((a,k)=>{if(bits&(1<<k)){x-=a;sign=-sign;}});
    sum+=sign*Math.max(x,0)**axes.length;
  }
  return 1-sum/(axes.reduce((a,b)=>a*b,1)*[1,1,2,6][axes.length]);
}

// Independent polygon clipping and shoelace first moments on a square.
function squareMoment(a,b,t){
  const corners=[[0,0],[1,0],[1,1],[0,1]],polygon=[];
  for(let k=0;k<4;k++){
    const p=corners[k],q=corners[(k+1)%4],l=a*p[0]+b*p[1]-t,r=a*q[0]+b*q[1]-t;
    if(l>0)polygon.push(p);
    if((l>0)!==(r>0)){const u=l/(l-r);polygon.push(p.map((v,i)=>v+u*(q[i]-v)));}
  }
  let area=0,x=0,y=0;
  for(let k=0;k<polygon.length;k++){
    const p=polygon[k],q=polygon[(k+1)%polygon.length],cross=p[0]*q[1]-p[1]*q[0];
    area+=cross/2;x+=(p[0]+q[0])*cross/6;y+=(p[1]+q[1])*cross/6;
  }return [x-area/2,y-area/2];
}

export async function verifyCutMetric(device){
  const gpu=gpuScope(device),cases=[];
  for(const normal of [[1,0,0],[0,-1,0],[.3,.7,0],[.1,-.4,.8],[-.7,.55,.3],[.6,.6,.6]]){
    for(const offset of [-.0001,0,.0001,.07,.25,.43,.5,.71,.93,.9999,1,1.0001]){
      const lo=normal.reduce((s,a)=>s+Math.min(0,a),0),span=normal.reduce((s,a)=>s+Math.abs(a),0);
      const t=lo+offset*span;
      const corners=Array.from({length:8},(_,i)=>normal.reduce((v,a,k)=>v+((i>>k)&1)*a,-t));
      const faces=normal.map((a,k)=>halfspace(normal.filter((_,j)=>k!==j),t-a));
      const moment=normal.flatMap((a,k)=>squareMoment(normal[(k+1)%3],normal[(k+2)%3],t-a));
      cases.push({corners,expected:[...faces,halfspace(normal,t)],moment});
    }
  }
  try{
    const input=gpu.buffer('CFD inclined plane samples',Float32Array.from(cases.flatMap(c=>c.corners)));
    const output=gpu.buffer('CFD clipped Cartesian reference',16*cases.length);
    const moments=gpu.buffer('CFD clipped face moments',24*cases.length);
    const pipe=await gpu.kernel('CFD inclined volume and face apertures',cutMetricWGSL+`
      @group(0) @binding(0) var<storage,read> src:array<array<f32,8>>;
      @group(0) @binding(1) var<storage,read_write> dst:array<vec4f>;
      @group(0) @binding(2) var<storage,read_write> moments:array<FaceCenters>;
      @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){
        if(id.x<arrayLength(&dst)){let q=src[id.x];let m=cutMetric(q);dst[id.x]=m;moments[id.x]=cutFaceCenters(q,m);}}`);
    gpu.run(pipe,[input,output,moments],[Math.ceil(cases.length/64)]);
    const stage=gpu.staging('CFD planar clipping check',moments.size);
    const measured=await gpu.read(output,stage,4*cases.length),positions=await gpu.read(moments,stage,6*cases.length);
    let maxVolumeError=0,maxFaceError=0,maxFirstMomentError=0;
    for(const [i,c] of cases.entries()){
      for(let k=0;k<3;k++)maxFaceError=Math.max(maxFaceError,Math.abs(c.expected[k]-measured[4*i+k]));
      maxVolumeError=Math.max(maxVolumeError,Math.abs(c.expected[3]-measured[4*i+3]));
      for(let j=0;j<6;j++)maxFirstMomentError=Math.max(maxFirstMomentError,Math.abs(c.moment[j]-positions[6*i+j]*measured[4*i+(j>>1)]));
    }
    return {planes:cases.length,maxVolumeError,maxFaceError,maxFirstMomentError,pass:Math.max(maxVolumeError,maxFaceError,maxFirstMomentError)<2e-6};
  }finally{gpu.close();}
}
