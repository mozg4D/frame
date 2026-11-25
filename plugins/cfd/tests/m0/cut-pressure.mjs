import {gridWGSL} from './fixtures.mjs';
import {metricBuffer,metricWGSL} from './rectilinear.mjs';
import {openBoundaries} from './multigrid.mjs';

// For a cut fluid volume, the wall first moment follows directly from the
// divergence theorem: integral_wall n_a r_b = V delta_ab - sum_open n_a r_b A.
// The clipped face centroids supply r. This gives the pressure reaction on an
// oblique wall and the correction on its fluid with equal and opposite signs.
export async function linearCutPressure(gpu,f,mu,centers,wall,pressure,state,force,loads){
  const n=f.dims.reduce((a,b)=>a*b),grid=[Math.ceil(n/128)],coords=metricBuffer(gpu,f);
  const base=gridWGSL(f)+metricWGSL(f)+openBoundaries(f);
  const storage=(b,name,type,write=false)=>`@group(0) @binding(${b}) var<storage,${write?'read_write':'read'}> ${name}:array<${type}>;`;
  const main=code=>`@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) gid:vec3u){
    let i=gid.x;if(i>=CELLS){return;}let p=point(i);${code}}`;
  const grad=gpu.buffer('CFD reconstructed pressure gradient',16*n);
  const derivative=await gpu.kernel('CFD open-sided pressure gradient',base+storage(0,'mu','vec4f')+storage(1,'pressure','f32')+storage(2,'grad','vec4f',true)+main(`
    let pi=pressure[i];let w=cellWidths(p);var d=vec3f(0);
    if(mu[i].w>0.){for(var a=0u;a<3u;a++){var sum=0.;var weight=0.;
      for(var side=-1;side<=1;side+=2){var q=p;q[a]+=side;
        if(inside(q)){let j=index(q);let open=mu[select(j,i,side>0)][a];
          sum+=open*f32(side)*(pressure[j]-pi)*spacingInv(a,p[a],side);weight+=open;}
        else if(openFace(a,side)){sum-=2.*f32(side)*pi/w[a];weight+=1.;}
      }if(weight>0.){d[a]=sum/weight;}
    }}grad[i]=vec4f(d,pi);`));
  const derivativeGroup=gpu.bind(derivative,[mu,pressure,grad],coords);
  const apply=await gpu.kernel('CFD linear pressure on clipped faces and wall',base+
    'struct Centers{t:array<vec2f,3>};'+storage(0,'mu','vec4f')+storage(1,'centers','Centers')+storage(2,'wall','vec4f')+
    storage(3,'grad','vec4f')+storage(4,'state','vec4f',true)+storage(5,'force','f32',true)+storage(6,'load','vec4f',true)+main(`
    let theta=mu[i].w;if(theta==0.){return;}let w=cellWidths(p);let area=faceAreas(w);let vol=w.x*area.x;
    var hasWall=theta<1.;var wallArea=vec3f(0);var moments:mat3x3f;var openCorrection=vec3f(0);
    for(var a=0u;a<3u;a++){let b=(a+1u)%3u;let c=(a+2u)%3u;moments[a][a]=theta*vol;
      for(var side=-1;side<=1;side+=2){var q=p;q[a]+=side;let sign=f32(side);var m=1.;var offset=vec3f(0);
        if(inside(q)){let j=index(q);let l=select(j,i,side>0);let r=select(i,j,side>0);m=mu[l][a];
          if(m<1.){hasWall=true;}
          if(m>0.&&m<1.){let t=centers[l].t[a];offset[b]=t.x*w[b];offset[c]=t.y*w[c];
            let cm=axisMetric(a,min(p[a],q[a]));let derivative=mix(grad[l].xyz,grad[r].xyz,.5*cm.y*cm.z);
            openCorrection[a]+=sign*area[a]*m*dot(derivative,offset);}
        }
        wallArea[a]+=sign*(1.-m)*area[a];offset[a]=sign*.5*w[a];
        moments[a]-=sign*area[a]*m*offset;
      }
    }
    if(!hasWall){return;}let g=grad[i];let extra=vec3f(dot(moments[0],g.xyz),dot(moments[1],g.xyz),dot(moments[2],g.xyz));
    let fluid=state[2u*i];state[2u*i]=vec4f(fluid.xyz-(extra+openCorrection)/(vol*wall[i].w),fluid.w);
    // Constant-pressure torque uses the exact first moment. The linear
    // force acts at the area centroid for the remaining second-order term.
    let center=moments*wallArea/max(dot(wallArea,wallArea),1e-30);
    let arm=vec3f(${f.origin.join(',')})+(cellCenters(p)+clamp(center,-.5*w,.5*w))*${f.h};
    let torque=g.w*(moments[2].y-moments[1].z)*${f.h}+cross(arm,extra).x;
    force[i]+=extra.x;load[i]+=vec4f(extra.x,torque,extra.yz);`));
  const applyGroup=gpu.bind(apply,[mu,centers,wall,grad,state,force,loads],coords);
  return e=>{gpu.dispatch(e,derivative,derivativeGroup,grid);gpu.dispatch(e,apply,applyGroup,grid);};
}
