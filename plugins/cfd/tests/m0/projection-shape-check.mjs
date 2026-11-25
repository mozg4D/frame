import {gpuScope} from './gpu.mjs';
import {pressureForceAdjoint} from './projection-shape.mjs';

const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=v=>Math.hypot(...v);
const subtract=(a,b)=>a.map((v,i)=>v-b[i]);
const unit=a=>a.map(v=>v/norm(a));

// Polygon clipping and signed areas independently measure a partially wet
// triangular face. This reference never calls the production cut formula.
function area(s,which){
  const corners=[[0,0],[1,0],[0,1],[1,1]],polygon=[];
  for(let k=0;k<3;k++){
    const a=which[k],b=which[(k+1)%3];
    if(s[a]>0)polygon.push(corners[a]);
    if((s[a]>0)!==(s[b]>0)){
      const t=s[a]/(s[a]-s[b]);polygon.push(corners[a].map((v,j)=>v+t*(corners[b][j]-v)));
    }
  }
  let twice=0;
  for(let k=0;k<polygon.length;k++){const a=polygon[k],b=polygon[(k+1)%polygon.length];twice+=a[0]*b[1]-a[1]*b[0];}
  return .5*Math.abs(twice);
}

// Physical area of each planar patch on the convex reference body. Each
// corner is the intersection of three planes satisfying all other halfspaces.
function patchAreas(normals,radii){
  const sites=normals.map(()=>[]);
  for(let i=0;i<sites.length;i++)for(let j=0;j<i;j++)for(let k=0;k<j;k++){
    const a=normals[i],b=normals[j],c=normals[k],bc=cross(b,c),ca=cross(c,a),ab=cross(a,b),det=dot(a,bc);
    if(Math.abs(det)<1e-8)continue;
    const x=bc.map((v,d)=>(radii[i]*v+radii[j]*ca[d]+radii[k]*ab[d])/det);
    if(normals.some((p,m)=>dot(p,x)>radii[m]+1e-10))continue;
    for(const m of [i,j,k])sites[m].push(x);
  }
  return sites.map((vertices,i)=>{
    if(vertices.length<3)return 0;
    const center=[0,1,2].map(k=>vertices.reduce((s,p)=>s+p[k],0)/vertices.length);
    const x=unit(subtract(vertices[0],center)),y=cross(normals[i],x);
    const vectors=vertices.map(p=>subtract(p,center));
    vectors.sort((a,b)=>Math.atan2(dot(a,y),dot(a,x))-Math.atan2(dot(b,y),dot(b,x)));
    return .5*Math.abs(vectors.reduce((s,v,k)=>s+dot(normals[i],cross(v,vectors[(k+1)%vectors.length])),0));
  });
}

function conjugateGradient(apply,b){
  const x=new Float64Array(b.length),r=b.slice(),p=r.slice(),ap=new Float64Array(b.length);
  let rr=dot(r,r);const stop=rr*1e-25;
  for(let step=0;rr>stop;step++){
    if(step>=500)throw Error('Independent projection did not converge');
    apply(p,ap);const alpha=rr/dot(p,ap);
    for(let i=0;i<x.length;i++){x[i]+=alpha*p[i];r[i]-=alpha*ap[i];}
    const next=dot(r,r);for(let i=0;i<p.length;i++)p[i]=r[i]+next/rr*p[i];rr=next;
  }return x;
}

export async function verifyProjectionShape(device){
  const gpu=gpuScope(device),side=16,n=side**3,vside=side+1,vertices=vside**3,h=.006,dt=.00023,rho=1.21;
  const f={dims:[side,side,side],h,rho,origin:[-.047,-.046,-.05],pressureOpen:Array(6).fill(true)};
  const normal=Array.from({length:14},(_,i)=>{const z=1-(2*i+1)/14,a=i*Math.PI*(3-Math.sqrt(5));
    return [Math.sqrt(1-z*z)*Math.cos(a),Math.sqrt(1-z*z)*Math.sin(a),z];});
  const radii=normal.map((_,i)=>.0157+.0022*Math.sin(3*i+.31)),centre=[.00117,-.0024,.00311],direction=unit([1,.27,-.41]);
  const velocity=new Float32Array(8*n),size=[1,side,side*side],vs=[1,vside,vside*vside];
  const location=(i,width)=>[i%width,Math.floor(i/width)%width,Math.floor(i/(width*width))];
  for(let i=0;i<n;i++){const p=location(i,side);
    for(let a=0;a<3;a++){const b=(a+1)%3;
      const u=[1.32,-.34,.27][a]+.019*p[b]+.003*p[(a+2)%3];
      velocity[8*i+a]=velocity[8*i+4+a]=u*dt/h;}}
  const scale=rho*(h/dt)**2*h*h;
  function problem(radii){
    const distances=new Float64Array(vertices),owner=new Int32Array(vertices);
    for(let i=0;i<vertices;i++){const x=location(i,vside).map((v,k)=>f.origin[k]+h*v-centre[k]);
      let max=-Infinity;for(let p=0;p<normal.length;p++){const v=dot(normal[p],x)-radii[p];if(v>max){max=v;owner[i]=p;}}
      distances[i]=max;
    }
    const mu=new Float64Array(4*n),diagonal=new Float64Array(n),rhs=new Float64Array(n),seed=new Float64Array(n);
    for(let i=0;i<n;i++){
      const p=location(i,side),v0=dot(p,vs);
      for(let a=0;a<3;a++){
        const v=v0+vs[a],b=vs[(a+1)%3],c=vs[(a+2)%3];
        const s=[distances[v],distances[v+b],distances[v+c],distances[v+b+c]];
        mu[4*i+a]=area(s,[0,1,3])+area(s,[0,2,3]);
      }
      mu[4*i+3]=Number(Array.from({length:8},(_,k)=>distances[v0+(k&1)*vs[0]+((k>>1)&1)*vs[1]+(k>>2)*vs[2]]).some(d=>d>0));
    }
    for(let i=0;i<n;i++){
      if(mu[4*i+3]===0)continue;
      const p=location(i,side);
      for(let a=0;a<3;a++){const lo=p[a]>0?mu[4*(i-size[a])+a]:1,hi=p[a]+1<side?mu[4*i+a]:1;
        rhs[i]-=hi*velocity[8*i+a]-lo*velocity[8*i+4+a];seed[i]+=direction[a]*(lo-hi);
        if(p[a]===0||p[a]+1===side)diagonal[i]+=2;
      }
    }
    function apply(p,y){
      for(let i=0;i<n;i++)y[i]=diagonal[i]*p[i];
      for(let i=0;i<n;i++){const q=location(i,side);
        for(let a=0;a<3;a++){if(q[a]+1>=side)continue;const j=i+size[a],flux=mu[4*i+a]*(p[i]-p[j]);y[i]+=flux;y[j]-=flux;}}
    }
    const p=conjugateGradient(apply,rhs);
    return {distances,owner,mu,seed,rhs,apply,p,force:scale*dot(p,seed)};
  }
  try{
    const base=problem(radii),areas=patchAreas(normal,radii);
    const op=await pressureForceAdjoint(gpu,f,dt,gpu.buffer('CFD reference cut fractions',Float32Array.from(base.mu)),
      gpu.buffer('CFD reference normal velocities',velocity),direction);
    const e=device.createCommandEncoder();op.encode(e,gpu.buffer('CFD signed distances in metres',Float32Array.from(base.distances)),60);
    device.queue.submit([e.finish()]);const stage=gpu.staging('CFD independent shape verification',4*vertices);
    const p=await gpu.read(op.primal,stage,n),lambda=await gpu.read(op.lambda,stage,n),g=await gpu.read(op.gradient,stage,vertices);
    const r=new Float64Array(n);base.apply(lambda,r);
    const dualResidual=Math.sqrt(dot(r.map((v,i)=>v-base.seed[i]),r.map((v,i)=>v-base.seed[i]))/dot(base.seed,base.seed));
    const force=scale*dot(p,base.seed),slope=new Float64Array(radii.length);
    for(let i=0;i<g.length;i++)slope[base.owner[i]]-=g[i];
    const patches=radii.map((_,j)=>{
      const paired=[2e-6,1e-6].map(eps=>{const plus=radii.slice(),minus=radii.slice();plus[j]+=eps;minus[j]-=eps;
        return .001*(problem(plus).force-problem(minus).force)/(2*eps);});
      return {normal:normal[j],areaM2:areas[j],sensitivityNPerMm:.001*slope[j],pairedNPerMm:paired};
    });
    const numeric=patches.map(p=>p.pairedNPerMm[1]),analytic=patches.map(p=>p.sensitivityNPerMm);
    const delta=subtract(analytic,numeric),relativeL2=norm(delta)/norm(numeric);
    const centered=a=>a.map(x=>x-a.reduce((s,v)=>s+v,0)/a.length),a=centered(analytic),b=centered(numeric);
    const correlation=dot(a,b)/(norm(a)*norm(b)),forceError=Math.abs(force/base.force-1);
    return {objective:'frozen-predictor projected wall pressure force',forceN:force,referenceForceN:base.force,
      forceError,dualResidual,relativeL2,correlation,patches,
      pass:forceError<3e-5&&dualResidual<5e-5&&relativeL2<.002&&correlation>.999&&areas.every(x=>x>0)&&
        analytic.every((v,i)=>Math.sign(v)===Math.sign(numeric[i]))};
  }finally{gpu.close();}
}
