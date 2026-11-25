import {gridWGSL} from './fixtures.mjs';
import {metricBuffer,metricWGSL} from './rectilinear.mjs';
import {sstWallWGSL} from './wall-law.mjs';

// Set the wall-adjacent omega and production on the actual merged momentum
// volume. Weight corner and floor contributions by their exposed areas.
export async function mergedSstWall(gpu,f,dt,groups,wall,mu,previous,predictor){
  const n=f.dims.reduce((a,b)=>a*b),grid=[Math.ceil(n/128)];
  const code=gridWGSL(f)+metricWGSL(f)+sstWallWGSL+`
    const NU=${f.nu*dt/f.h**2};
    struct Cell{uk:vec4f,wt:vec2f,padding:vec2f}
    struct Links{root:u32,head:u32,next:u32}
    @group(0) @binding(0) var<storage,read> links:array<Links>;
    @group(0) @binding(1) var<storage,read> wall:array<vec4f>;
    @group(0) @binding(2) var<storage,read> mu:array<vec4f>;
    @group(0) @binding(3) var<storage,read> old:array<Cell>;
    @group(0) @binding(4) var<storage,read_write> pred:array<Cell>;
    fn contribution(velocity:vec3f,normal:vec3f,y:f32,area:f32)->vec4f{
      return area*vec4f(1.,sstWall(length(tangentialSlip(velocity,normal)),y,NU));
    }
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) gid:vec3u){
      let i=gid.x;if(i>=CELLS||mu[i].w<=0.){return;}let root=links[i].root;
      let u=old[root].uk.xyz;let w=cellWidths(point(root));let volume=w.x*w.y*w.z*wall[root].w;
      var surface=vec4f(0);var j=root;
      loop{
        let p=point(j);let width=cellWidths(p);let area=faceAreas(width);
        var solidArea=vec3f(0);var gradient=vec3f(0);
        for(var a=0u;a<3u;a++){for(var side=-1;side<=1;side+=2){
          var q=p;q[a]+=side;if(!inside(q)){continue;}let k=index(q);
          solidArea[a]-=f32(side)*(1.-mu[select(k,j,side>0)][a])*area[a];
          gradient[a]+=.5*f32(side)*(wall[k].x-wall[j].x)*spacingInv(a,p[a],side);
        }}
        let exposed=length(solidArea);
        if(exposed>0.){
          let normal=normalize(select(solidArea,gradient,dot(gradient,gradient)>1e-12));
          let y=max(wall[j].x,.5/length(normal/width));
          let arm=vec3f(${f.origin.join(',')})+(cellCenters(p)-max(0.,wall[j].x)*normal)*${f.h};
          let uw=vec3f(0.,-arm.z,arm.y)*${f.rotatingFrame?f.omega*dt/f.h:0};
          surface+=contribution(u-uw,normal,y,exposed);
        }
        if(p.y==0&&${f.name==='ahmed'||!!f.movingRoad}){
          surface+=contribution(u-vec3f(${f.movingRoad?f.U*dt/f.h:0},0.,0.),vec3f(0,1,0),.5*width.y,area.y);
        }
        j=select(links[j].next,links[root].head,j==root);if(j==0xffffffffu){break;}
      }
      var s=pred[i];var k=s.uk.w;var omega=max(1e-8,s.wt.x);
      if(surface.x>0.){
        omega=surface.y/surface.x;
        let production=min(surface.z/surface.x,10.*.09*max(1e-12,old[root].uk.w)*omega);
        k=(k-s.wt.y+production/(1.+.09*max(1e-8,old[root].wt.x)))/(1.+surface.w/volume);
      }
      k=max(1e-12,k);s.uk.w=k;s.wt=vec2f(omega,.31*k/max(.31*omega,s.padding.y));pred[i]=s;
    }`;
  const op=await gpu.kernel('CFD wall-adjacent SST transport',code);
  const bind=gpu.bind(op,[groups.links,wall,mu,previous,predictor],metricBuffer(gpu,f));
  return e=>gpu.dispatch(e,op,bind,grid);
}
