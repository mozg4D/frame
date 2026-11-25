import {gridWGSL} from './fixtures.mjs';
import {metricBuffer,metricWGSL} from './rectilinear.mjs';
import {outerSpinWGSL} from './outer-transport.mjs';

// Transport the reconstructed upwind velocity at the actual aperture centroid.
// Store each interior correction once, together with the transpose-gradient
// part of the deviatoric stress. Its two cells receive opposite impulses.
export async function cutFaceTransport(gpu,f,dt,old,predictor,mu,centers,wall,flux,tail){
  const n=f.dims.reduce((a,b)=>a*b),grid=[Math.ceil(n/128)],axes=metricBuffer(gpu,f);
  const gradient=gpu.buffer('CFD open-fluid velocity reconstruction',48*n),faces=gpu.buffer('CFD shared face momentum correction',48*n);
  const common=gridWGSL(f)+metricWGSL(f)+outerSpinWGSL(f)+`
    struct Cell{uk:vec4f,wt:vec2f,padding:vec2f} struct Centers{t:array<vec2f,3>}
    struct Gradient{v:array<vec4f,3>} struct Flux{hi:vec4f,lo:vec4f}
    fn offset(a:u32,side:i32,w:vec3f,t:vec2f)->vec3f{
      let b=(a+1u)%3u;let c=(a+2u)%3u;var d=vec3f(0);d[a]=.5*f32(side)*w[a];d[b]=t.x*w[b];d[c]=t.y*w[c];return d;
    }
    fn matrix(g:Gradient)->mat3x3f{return mat3x3f(g.v[0].xyz,g.v[1].xyz,g.v[2].xyz);}`;
  const decl=(b,k,t,write=false)=>`@group(0) @binding(${b}) var<storage,${write?'read_write':'read'}> ${k}:array<${t}>;`;
  const main=code=>`@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) gid:vec3u){
    let i=gid.x;if(i>=CELLS){return;}let p=point(i);${code}}`;
  const reconstruct=await gpu.kernel('CFD bounded gradients on connected fluid faces',common+decl(0,'s','Cell')+
    decl(1,'mu','vec4f')+decl(2,'center','Centers')+decl(3,'grad','Gradient',true)+main(`
    if(mu[i].w<=0.){return;}let u=s[i].uk.xyz;let w=cellWidths(p);var low=u;var high=u;var g:mat3x3f;
    for(var a=0u;a<3u;a++){
      var lm=0.;var lp=0.;var left=vec3f(0);var right=vec3f(0);
      for(var side=-1;side<=1;side+=2){var q=p;q[a]+=side;if(!inside(q)){continue;}
        let j=index(q);let owner=select(j,i,side>0);if(mu[owner][a]<=0.){continue;}
        let v=s[j].uk.xyz;low=min(low,v);high=max(high,v);let inv=spacingInv(a,p[a],side);
        if(side<0){lm=1./inv;left=(u-v)*inv;}else{lp=1./inv;right=(v-u)*inv;}
      }
      if(lm*lp>0.){g[a]=(lp*left+lm*right)/(lm+lp);}else{g[a]=left+right;}
    }
    var phi=vec3f(1);
    for(var a=0u;a<3u;a++){for(var side=-1;side<=1;side+=2){
      var q=p;q[a]+=side;if(!inside(q)){continue;}let owner=select(index(q),i,side>0);if(mu[owner][a]<=0.){continue;}
      let du=g*offset(a,side,w,center[owner].t[a]);
      for(var k=0u;k<3u;k++){if(du[k]>0.){phi[k]=min(phi[k],(high[k]-u[k])/du[k]);}
        else if(du[k]<0.){phi[k]=min(phi[k],(low[k]-u[k])/du[k]);}}
    }}
    for(var a=0u;a<3u;a++){grad[i].v[a]=vec4f(g[a],phi[a]);}`));
  const reconGroup=gpu.bind(reconstruct,[old,mu,centers,gradient],axes);
  const shared=await gpu.kernel('CFD integrated higher-order face momentum',common+decl(0,'s','Cell')+
    decl(1,'mu','vec4f')+decl(2,'center','Centers')+decl(3,'grad','Gradient')+decl(4,'flow','Flux')+
    decl(5,'tail','Flux')+decl(6,'face','Gradient',true)+main(`
    let w=cellWidths(p);let area=faceAreas(w);
    for(var a=0u;a<3u;a++){var q=p;q[a]++;var impulse=vec3f(0);
      if(inside(q)&&mu[i][a]>0.){
        let j=index(q);let value=flow[i].hi[a]+tail[i].hi[a];let up=select(j,i,value>=0.);let attr=grad[up];
        let phi=vec3f(attr.v[0].w,attr.v[1].w,attr.v[2].w);let side=select(-1,1,value>=0.);
        let delta=phi*(matrix(attr)*offset(a,side,cellWidths(point(up)),center[i].t[a]));
        let l=matrix(grad[i]);let r=matrix(grad[j]);let t=.5*w[a]*spacingInv(a,p[a],1);
        let g=(1.-t)*l+t*r;
        var transposeFlux=vec3f(g[0][a],g[1][a],g[2][a]);transposeFlux[a]-=(2./3.)*(g[0].x+g[1].y+g[2].z);
        let viscosity=${f.nu*dt/f.h**2}+.5*(s[i].wt.y+s[j].wt.y);
        impulse=mu[i][a]*area[a]*viscosity*transposeFlux-select(value,0.,outerFace(p,q))*delta;
      }face[i].v[a]=vec4f(impulse,0);
    }`));
  const faceGroup=gpu.bind(shared,[old,mu,centers,gradient,flux,tail,faces],axes);
  const gather=await gpu.kernel('CFD conservative momentum from shared faces',common+decl(0,'face','Gradient')+
    decl(1,'wall','vec4f')+decl(2,'s','Cell',true)+main(`
    let ratio=wall[i].w;if(ratio<=0.){return;}let w=cellWidths(p);var change=vec3f(0);
    for(var a=0u;a<3u;a++){var q=p;q[a]--;change+=face[i].v[a].xyz;if(inside(q)){change-=face[index(q)].v[a].xyz;}}
    let v=s[i].uk;s[i].uk=vec4f(v.xyz+change/(w.x*w.y*w.z*ratio),v.w);`));
  const gatherGroup=gpu.bind(gather,[faces,wall,predictor],axes);
  return {faces,reconstruct:e=>gpu.dispatch(e,reconstruct,reconGroup,grid),transfer:e=>gpu.dispatch(e,shared,faceGroup,grid),
    apply:e=>gpu.dispatch(e,gather,gatherGroup,grid)};
}
