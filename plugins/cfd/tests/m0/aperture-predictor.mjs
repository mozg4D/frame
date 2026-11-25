import {gridWGSL} from './fixtures.mjs';
import {metricWGSL,metricBuffer} from './rectilinear.mjs';
import {openBoundaries} from './multigrid.mjs';
import {addFlowWGSL} from './fvm.mjs';

// The rotating coordinate velocity and fluid velocity must be integrated
// on the same open polygon. Rotation is affine, so its face integral is
// exact at the aperture centroid. All velocity samples stay on the fluid side.
export async function aperturePredictor(gpu,f,dt,old,pred,mu,centers,primary,tail){
  const n=f.dims.reduce((a,b)=>a*b),grid=[Math.ceil(n/128)],axes=metricBuffer(gpu,f);
  const head=gridWGSL(f)+metricWGSL(f)+openBoundaries(f)+addFlowWGSL+`
    struct Cell{uk:vec4f,wt:vec2f,padding:vec2f} struct Flux{hi:vec4f,lo:vec4f}
    struct Centers{t:array<vec2f,3>}
    @group(0) @binding(0) var<storage,read> star:array<Cell>;
    @group(0) @binding(1) var<storage,read> mu:array<vec4f>;
    @group(0) @binding(2) var<storage,read> center:array<Centers>;
    @group(0) @binding(3) var<storage,read_write> primary:array<Flux>;
    @group(0) @binding(4) var<storage,read_write> tail:array<Flux>;`;
  const derivative=name=>`
    fn slope_${name}(p:vec3i,axis:u32,component:u32)->f32{
      let i=index(p);let u=${name}[i].uk[component];var pm=p;pm[axis]--;var pp=p;pp[axis]++;
      var minus=false;var plus=false;var l=0.;var r=0.;
      if(inside(pm)){let j=index(pm);minus=mu[j][axis]>0.;if(minus){l=(u-${name}[j].uk[component])*spacingInv(axis,p[axis],-1);}}
      if(inside(pp)){let j=index(pp);plus=mu[i][axis]>0.;if(plus){r=(${name}[j].uk[component]-u)*spacingInv(axis,p[axis],1);}}
      if(minus&&plus){return select(0.,sign(l)*min(abs(l),abs(r)),l*r>0.);}return l+r;
    }
    fn value_${name}(l:vec3i,r:vec3i,a:u32,t:f32,offset:vec3f)->f32{
      let i=index(l);let j=index(r);var result=mix(${name}[i].uk[a],${name}[j].uk[a],t);
      if(any(offset!=vec3f(0))){
        for(var b=0u;b<3u;b++){if(offset[b]!=0.){
          result+=offset[b]*mix(slope_${name}(l,b,a),slope_${name}(r,b,a),t);
        }}
      }return result;
    }`;
  async function pipeline(increment){
    return gpu.kernel(increment?'CFD transport relative aperture flow':'CFD initialize relative aperture flow',head+
      (increment?'@group(0) @binding(5) var<storage,read> previous:array<Cell>;'+derivative('previous'):'')+derivative('star')+`
      @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
        let i=g.x;if(i>=CELLS){return;}let p=point(i);let widths=cellWidths(p);let area=faceAreas(widths);
        for(var a=0u;a<3u;a++){for(var side=-1;side<=1;side+=2){
          var q=p;q[a]+=side;let internal=inside(q);let other=clamp(q,vec3i(0),DIMS-1);
          let l=select(other,p,side>0);let r=select(p,other,side>0);let li=index(l);let ri=index(r);
          let opening=select(1.,mu[li][a],internal);var v=vec2f(0);
          if(opening>0.){
            let m=axisMetric(a,l[a]);let t=.5*m.y*m.z;var offset=vec3f(0);
            if(internal&&opening<1.){let b=(a+1u)%3u;let c=(a+2u)%3u;let moment=center[li].t[a];
              offset[b]=moment.x*widths[b];offset[c]=moment.y*widths[c];}
            let position=vec3f(${f.origin.join(',')})+(cellCenters(l)+offset)*${f.h};
            let frame=vec3f(0.,-position.z,position.y)[a]*${f.omega*dt/f.h};let weight=opening*area[a];
            let speed=value_star(l,r,a,t,offset);
            ${increment?`let oldSpeed=value_previous(l,r,a,t,offset);let reference=weight*(oldSpeed-frame);
              let high=select(primary[i].lo[a],primary[i].hi[a],side>0);let low=select(tail[i].lo[a],tail[i].hi[a],side>0);
              let diag=mix(star[li].padding.x,star[ri].padding.x,t);
              v=addFlow(high,low,weight*(speed-oldSpeed)-(diag/(1.+diag))*((high-reference)+low));`:
              'v.x=weight*(speed-frame);'}
            if(!internal&&!openFace(a,side)){v=vec2f(area[a]*(select(0.,${f.U*dt/f.h},a==0u)-frame),0.);}
          }
          if(side>0){primary[i].hi[a]=v.x;tail[i].hi[a]=v.y;}else{primary[i].lo[a]=v.x;tail[i].lo[a]=v.y;}
        }}
      }`);
  }
  const [seed,update]=await Promise.all([pipeline(false),pipeline(true)]);
  const buffers=[mu,centers,primary,tail];
  const initial=gpu.bind(seed,[old,...buffers],axes),first=gpu.bind(seed,[pred,...buffers],axes);
  const later=gpu.bind(update,[pred,...buffers,old],axes);
  return {
    initial:e=>gpu.dispatch(e,seed,initial,grid),
    predict:(e,cold)=>gpu.dispatch(e,cold?seed:update,cold?first:later,grid)
  };
}
