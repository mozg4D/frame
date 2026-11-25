import {gridWGSL} from './fixtures.mjs';
import {metricBuffer,metricWGSL} from './rectilinear.mjs';
import {outerSpinWGSL} from './outer-transport.mjs';
import {fluidCentreLinks} from './fluid-groups.mjs';

// Every small fluid volume joins a more open neighbour through a nonzero
// aperture. Strict growth makes the parent forest acyclic. Momentum is
// advanced in the combined volume. Each cut cell keeps its own pressure and
// its six shared face flows, including those internal to a momentum group.
export async function cutGroups(gpu,f,mobility,wall){
  const n=f.dims.reduce((a,b)=>a*b),grid=[Math.ceil(n/128)],coords=metricBuffer(gpu,f);
  const head=gridWGSL(f),metric=metricWGSL(f);
  const main=code=>`@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) gid:vec3u){
    let i=gid.x;if(i>=CELLS){return;}${code}}`;
  const parents=[0,1].map(()=>gpu.buffer('CFD small-cell parent',4*n));
  const links=gpu.buffer('CFD cut-cell group members',12*n);
  const material='@group(0) @binding(0) var<storage,read> mu:array<vec4f>;';
  const forest='struct Links{root:u32,head:atomic<u32>,next:u32};';
  const select=await gpu.kernel('CFD open neighbour for thin cut volumes',head+material+
    '@group(0) @binding(1) var<storage,read_write> dst:array<u32>;'+main(`
    let p=point(i);let fraction=mu[i].w;var best=fraction;var face=0.;var parent=i;
    if(fraction>0.&&fraction<.3){
      for(var a=0u;a<3u;a++){for(var side=-1;side<=1;side+=2){
        var q=p;q[a]+=side;if(!inside(q)){continue;}let j=index(q);let other=mu[j].w;
        let aperture=mu[select(j,i,side>0)][a];
        if(aperture>0.&&other>fraction&&(other>best||(other==best&&aperture>face))){
          best=other;face=aperture;parent=j;}
      }}
    }dst[i]=parent;`));
  const jump=await gpu.kernel('CFD resolve cut-cell representatives',head+
    '@group(0) @binding(0) var<storage,read> src:array<u32>;@group(0) @binding(1) var<storage,read_write> dst:array<u32>;'+main('dst[i]=src[src[i]];'));
  const setup=await gpu.kernel('CFD initialize physical cut groups',head+forest+
    '@group(0) @binding(0) var<storage,read> root:array<u32>;@group(0) @binding(1) var<storage,read_write> link:array<Links>;'+
    main('link[i].root=root[i];atomicStore(&link[i].head,0xffffffffu);link[i].next=0xffffffffu;'));
  const append=await gpu.kernel('CFD link cut cells to their common volume',head+forest+
    '@group(0) @binding(0) var<storage,read_write> link:array<Links>;'+
    main('let root=link[i].root;if(root!=i){link[i].next=atomicExchange(&link[root].head,i);}'));
  const fluid=f.mergeToFluid?await fluidCentreLinks(gpu,f,mobility,wall,parents[0]):null;
  const e=gpu.device.createCommandEncoder(),dispatch=(op,buf)=>gpu.dispatch(e,op,gpu.bind(op,buf),grid);
  dispatch(select,[mobility,parents[0]]);
  fluid?.encode(e);
  let slot=0;for(let i=1;i<n;i*=2){dispatch(jump,[parents[slot],parents[1-slot]]);slot=1-slot;}
  dispatch(setup,[parents[slot],links]);dispatch(append,[links]);
  const members='struct Members{root:u32,head:u32,next:u32};';
  const volumes=gpu.buffer('CFD agglomerated physical volumes',4*n);
  const stats=gpu.buffer('CFD cut-volume stability bounds',new Uint32Array([0,0,0x3f800000,0,0,0,0]));
  const size=await gpu.kernel('CFD effective cut volumes and explicit stability bound',head+metric+outerSpinWGSL(f)+members+material+`
    @group(0) @binding(1) var<storage,read> links:array<Members>;
    @group(0) @binding(2) var<storage,read_write> volume:array<f32>;
    @group(0) @binding(3) var<storage,read_write> stats:array<atomic<u32>>;
    `+main(`
    let fraction=mu[i].w;if(fraction<=0.){return;}
    if(fraction<1.){atomicAdd(&stats[0],1u);atomicMin(&stats[2],bitcast<u32>(fraction));}
    if(links[i].root!=i){atomicAdd(&stats[1],1u);return;}
    var j=i;var sum=0.;var surfaces=vec3f(0);var rotation=0.;var diffusion=0.;
    loop{
      let p=point(j);let w=cellWidths(p);let area=faceAreas(w);sum+=mu[j].w*w.x*area.x;
      let xyz=vec3f(${f.origin.join(',')})+cellCenters(p)*${f.h};
      let frame=abs(vec3f(0.,-xyz.z,xyz.y))*f32(${f.rotatingFrame?Math.abs(f.omega):0});
      for(var a=0u;a<3u;a++){for(var side=-1;side<=1;side+=2){
        var q=p;q[a]+=side;var aperture=1.;var invD=1./w[a];
        if(inside(q)){
          let other=index(q);if(links[other].root==i){continue;}
          aperture=mu[select(other,j,side>0)][a];invD=spacingInv(a,p[a],side);
        }
        let open=aperture*area[a];let explicitArea=select(open,0.,outerFace(p,q));
        surfaces[a]+=.5*explicitArea;rotation+=.5*explicitArea*frame[a];diffusion+=open*invD;
      }}
      j=select(links[j].next,links[i].head,j==i);if(j==0xffffffffu){break;}
    }
    volume[i]=sum;let rate=((${f.maxSpeed}*length(surfaces)+rotation)/${f.h}+${f.nu/f.h**2}*diffusion)/sum;
    atomicMax(&stats[3],bitcast<u32>(rate));
    if(fraction<.3){atomicAdd(&stats[4],1u);}if(links[i].head!=0xffffffffu){atomicAdd(&stats[5],1u);}
    if(fraction<1.){atomicAdd(&stats[6],1u);}
    `));
  gpu.dispatch(e,size,gpu.bind(size,[mobility,links,volumes,stats],coords),grid);
  const share=await gpu.kernel('CFD distribute group volume to cut cells',head+metric+members+`
    @group(0) @binding(0) var<storage,read> link:array<Members>;
    @group(0) @binding(1) var<storage,read> volume:array<f32>;
    @group(0) @binding(2) var<storage,read_write> wall:array<vec4f>;`+
    main('let w=cellWidths(point(i));wall[i].w=volume[link[i].root]/(w.x*w.y*w.z);'));
  gpu.dispatch(e,share,gpu.bind(share,[links,volumes,wall],coords),grid);
  gpu.device.queue.submit([e.finish()]);
  const buffer=await gpu.read(stats,gpu.staging('CFD cut geometry statistics',stats.size),7);
  const u=new Uint32Array(buffer.buffer),maximumRate=buffer[3];
  if(!Number.isFinite(maximumRate))throw Error('Nonfinite cut-volume stability bound');
  const stateDecl=head+members+`struct Cell{uk:vec4f,wt:vec2f,padding:vec2f};
    @group(0) @binding(0) var<storage,read> link:array<Members>;
    @group(0) @binding(1) var<storage,read_write> state:array<Cell>;`;
  const sum=await gpu.kernel('CFD sum conservative momentum increments',stateDecl+main(`
    var j=link[i].head;if(j==0xffffffffu){return;}
    var total=state[i];loop{total.uk+=state[j].uk;total.wt+=state[j].wt;total.padding+=state[j].padding;j=link[j].next;if(j==0xffffffffu){break;}}
    state[i]=total;`));
  const scatter=await gpu.kernel('CFD scatter stabilized cell state',stateDecl+main('let k=link[i].root;if(i!=k){state[i]=state[k];}'));
  return {links,volumes,stats:{cutCells:u[0],mergedCells:u[1],minFluidFraction:buffer[2],smallRoots:u[4],groupsWithChildren:u[5],remainingCutRoots:u[6],
    fluidRootSearchSweeps:fluid?.waves,maxTransportRatePerS:maximumRate},
    stableStep:maximumRate>0?.65/maximumRate:Infinity,
    async courant(flux,tail,explicitOnly=false){
      const peak=gpu.buffer('CFD maximum momentum-group Courant number',4);
      const op=await gpu.kernel('CFD transport through outer group faces',head+(explicitOnly?metric+outerSpinWGSL(f):'')+members+`
        struct Flux{hi:vec4f,lo:vec4f}
        @group(0) @binding(0) var<storage,read> links:array<Members>;
        @group(0) @binding(1) var<storage,read> volume:array<f32>;
        @group(0) @binding(2) var<storage,read> flux:array<Flux>;
        @group(0) @binding(3) var<storage,read> tail:array<Flux>;
        @group(0) @binding(4) var<storage,read_write> peak:atomic<u32>;`+main(`
        if(links[i].root!=i||volume[i]<=0.){return;}var j=i;var total=0.;
        loop{let p=point(j);for(var a=0u;a<3u;a++){for(var side=-1;side<=1;side+=2){
          var q=p;q[a]+=side;if(inside(q)&&links[index(q)].root==i){continue;}
          ${explicitOnly?'if(outerFace(p,q)){continue;}':''}
          let f=select(flux[j].lo[a],flux[j].hi[a],side>0);
          let t=select(tail[j].lo[a],tail[j].hi[a],side>0);total+=abs(f+t);
        }}j=select(links[j].next,links[i].head,j==i);if(j==0xffffffffu){break;}}
        atomicMax(&peak,bitcast<u32>(.5*total/volume[i]));`));
      gpu.run(op,[links,volumes,flux,tail,peak],grid,explicitOnly?coords:null);
      return (await gpu.read(peak,gpu.staging('CFD measured momentum-group Courant number',4),1))[0];
    },
    merge(state){
      const gather=gpu.bind(sum,[links,state]),fill=gpu.bind(scatter,[links,state]);
      return e=>{gpu.dispatch(e,sum,gather,grid);gpu.dispatch(e,scatter,fill,grid);};
    }};
}
