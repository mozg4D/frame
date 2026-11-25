import {gridWGSL} from './fixtures.mjs';
import {metricBuffer,metricWGSL,pressureMultigrid} from '../../plugin.js';

// Local derivative of the same two planar triangles used by cutMetric.
// Inputs are signed distances in metres. A positive normal displacement of
// the solid decreases signed distance at a point with that closest surface.
const faceDerivativeWGSL=`
  fn triangleDerivative(s:vec3f)->vec3f{
    var mask=0u;for(var k=0u;k<3u;k++){mask|=u32(s[k]>0.)<<k;}
    let count=countOneBits(mask);if(count==0u||count==3u){return vec3f(0);}
    let i=firstTrailingBit(select(7u^mask,mask,count==1u));let j=(i+1u)%3u;let k=(i+2u)%3u;
    let a=s[i];let b=s[j];let c=s[k];let ab=a-b;let ac=a-c;
    let t=a/ab;let u=a/ac;var d=vec3f(0);
    d[i]=(-b*u)/(ab*ab)-(c*t)/(ac*ac);d[j]=a*u/(ab*ab);d[k]=a*t/(ac*ac);
    return select(-d,d,count==1u);
  }
  fn squareDerivative(s:vec4f)->vec4f{
    let a=triangleDerivative(s.xyw);let b=triangleDerivative(s.xzw);
    return .5*vec4f(a.x+b.x,a.y,b.y,a.z+b.z);
  }`;
const storage=(i,name,type,write=false)=>
  `@group(0) @binding(${i}) var<storage,${write?'read_write':'read'}> ${name}:array<${type}>;`;

// Differentiate the actual pressure projection with fixed predicted normal
// velocities. The objective is the pressure force in the supplied direction,
// using the cell pressure on the cut wall. Temporal and viscous adjoints add
// their own state and wall terms when this substep is composed into a solve.
export async function pressureForceAdjoint(gpu,f,dt,mobility,faceVelocity,direction){
  if(direction.length!==3||direction.some(x=>!Number.isFinite(x))||!(dt>0&&f.h>0&&f.rho>0))
    throw Error('Invalid pressure sensitivity objective or physical scale');
  const count=f.dims.reduce((a,b)=>a*b),grid=[Math.ceil(count/128)],coords=metricBuffer(gpu,f);
  const vertexDims=f.dims.map(n=>n+1),vertices=vertexDims.reduce((a,b)=>a*b);
  const hierarchy=await pressureMultigrid(gpu,f,mobility);
  const common=gridWGSL(f)+metricWGSL(f)+`
    const DIRECTION=vec3f(${direction.join(',')});
    struct NormalVelocity{hi:vec4f,lo:vec4f}
    fn unit(a:u32)->vec3i{var e=vec3i(0);e[a]=1;return e;}`;
  const main=body=>`@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) id:vec3u){
    let i=id.x;if(i>=CELLS){return;}let p=point(i);${body}}`;
  const primal=gpu.buffer('CFD primal pressure for the shape derivative',4*count);
  const seed=gpu.buffer('CFD force derivative with respect to pressure',4*count);
  const faceGradient=gpu.buffer('CFD pressure force per unit open fraction',16*count);
  const gradient=gpu.buffer('CFD pressure force per metre of metric change',4*vertices);
  const rhs=await gpu.kernel('CFD projection source and pressure force seed',common+
    storage(0,'mu','vec4f')+storage(1,'v','NormalVelocity')+storage(2,'b','f32',true)+storage(3,'seed','f32',true)+main(`
      var defect=0.;var wall=vec3f(0);let area=faceAreas(cellWidths(p));
      if(mu[i].w>0.){for(var a=0u;a<3u;a++){
        let e=unit(a);let openHi=select(1.,mu[i][a],inside(p+e));let openLo=select(1.,mu[bounded(p-e)][a],inside(p-e));
        defect+=area[a]*(openHi*v[i].hi[a]-openLo*v[i].lo[a]);wall[a]=area[a]*(openLo-openHi);
      }}b[i]=-defect;seed[i]=dot(wall,DIRECTION);`));
  const rhsBind=gpu.bind(rhs,[mobility,faceVelocity,hierarchy.rhs,seed],coords);
  const sensitivity=await gpu.kernel('CFD adjoint of aperture pressure and flux',common+
    storage(0,'mu','vec4f')+storage(1,'v','NormalVelocity')+storage(2,'p0','f32')+storage(3,'lambda','f32')+
    storage(4,'out','vec4f',true)+main(`
      let area=faceAreas(cellWidths(p));var derivative=vec3f(0);
      for(var a=0u;a<3u;a++){let q=p+unit(a);let open=mu[i][a];
        if(open<=0.||open>=1.||!inside(q)){continue;}
        let j=index(q);let dp=p0[i]-p0[j];let dl=lambda[i]-lambda[j];
        derivative[a]=-area[a]*(DIRECTION[a]*dp+dl*(v[i].hi[a]+spacingInv(a,p[a],1)*dp));
      }out[i]=vec4f(derivative*${f.rho*(f.h/dt)**2*f.h**2},0.);`));
  const faceBind=gpu.bind(sensitivity,[mobility,faceVelocity,primal,hierarchy.p,faceGradient],coords);
  const corner=await gpu.kernel('CFD adjoint of signed-distance face intersections',gridWGSL(f)+faceDerivativeWGSL+
    storage(0,'sdf','f32')+storage(1,'face','vec4f')+storage(2,'out','f32',true)+`
    const VERTS=vec3i(${vertexDims.join(',')});
    fn vi(p:vec3i)->u32{return u32(p.x+VERTS.x*(p.y+VERTS.y*p.z));}
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) id:vec3u){
      if(id.x>=arrayLength(&out)){return;}
      let k=i32(id.x);let v=vec3i(k%VERTS.x,(k/VERTS.x)%VERTS.y,k/(VERTS.x*VERTS.y));var sum=0.;
      for(var a=0u;a<3u;a++){let b=(a+1u)%3u;let c=(a+2u)%3u;var eb=vec3i(0);eb[b]=1;var ec=vec3i(0);ec[c]=1;
        for(var n=0u;n<4u;n++){let corner=v-i32(n&1u)*eb-i32(n>>1u)*ec;var owner=corner;owner[a]--;
          if(!inside(owner)||corner[a]>=DIMS[a]){continue;}let load=face[index(owner)][a];if(load==0.){continue;}
          let s=vec4f(sdf[vi(corner)],sdf[vi(corner+eb)],sdf[vi(corner+ec)],sdf[vi(corner+eb+ec)]);
          sum+=load*squareDerivative(s)[n];
        }}out[k]=sum;
    }`);
  function encodePrimal(e,iterations=36){
    hierarchy.updateGeometry(e);e.clearBuffer(hierarchy.p);gpu.dispatch(e,rhs,rhsBind,grid);
    hierarchy.solve(e);hierarchy.refine(e,iterations);
    e.copyBufferToBuffer(hierarchy.p,0,primal,0,primal.size);
  }
  return {primal,seed,lambda:hierarchy.p,faceGradient,gradient,encodePrimal,
    encode(e,distances,iterations=36){
      encodePrimal(e,iterations);e.copyBufferToBuffer(seed,0,hierarchy.rhs,0,seed.size);e.clearBuffer(hierarchy.p);
      hierarchy.solve(e);hierarchy.refine(e,iterations);gpu.dispatch(e,sensitivity,faceBind,grid);
      gpu.dispatch(e,corner,gpu.bind(corner,[distances,faceGradient,gradient]),[Math.ceil(vertices/128)]);
    }};
}
