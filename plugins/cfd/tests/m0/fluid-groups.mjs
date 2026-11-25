import {gridWGSL} from './fixtures.mjs';
import {metricWGSL,metricBuffer} from './rectilinear.mjs';

// Find a completely fluid momentum volume through open apertures. Paths use
// decreasing graph distance, so a sliver cannot point back to its child.
// Components consisting entirely of cut cells retain their local grouping.
export async function fluidCentreLinks(gpu,f,mu,wall,parents){
  const n=f.dims.reduce((a,b)=>a*b),grid=[Math.ceil(n/128)],head=gridWGSL(f);
  const dist=[0,1].map(()=>gpu.buffer('CFD distance to a fluid momentum root',4*n));
  const changed=gpu.buffer('CFD newly reached cut cells',4),stage=gpu.staging('CFD group frontier',4);
  const decl=(b,k,t,w=false)=>`@group(0) @binding(${b}) var<storage,${w?'read_write':'read'}> ${k}:array<${t}>;`;
  const main=s=>`@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
    let i=g.x;if(i>=CELLS){return;}let p=point(i);${s}}`;
  const seed=await gpu.kernel('CFD seed regular exterior volumes',head+decl(0,'mu','vec4f')+decl(1,'wall','vec4f')+
    decl(2,'dist','u32',true)+main('dist[i]=select(0x7fffffffu,0u,mu[i].w==1.&&wall[i].x>0.);'));
  gpu.run(seed,[mu,wall,dist[0]],grid);
  const neighbours=`for(var a=0u;a<3u;a++){for(var side=-1;side<=1;side+=2){
    var q=p;q[a]+=side;if(!inside(q)){continue;}let j=index(q);let opening=mu[select(j,i,side>0)][a];
    if(opening<=0.||mu[j].w<=0.){continue;}`;
  const flood=await gpu.kernel('CFD find open paths to fluid roots',head+decl(0,'mu','vec4f')+decl(1,'src','u32')+decl(2,'dst','u32',true)+
    '@group(0) @binding(3) var<storage,read_write> changed:atomic<u32>;'+main(`
      let old=src[i];var d=old;if(old==0x7fffffffu&&mu[i].w>0.){
        ${neighbours}d=min(d,src[j]+1u);}}
        if(d<old){atomicOr(&changed,1u);}
      }dst[i]=d;`));
  const binds=dist.map((v,i)=>gpu.bind(flood,[mu,v,dist[1-i],changed]));
  let waves=0;
  for(;;){
    const e=gpu.device.createCommandEncoder();e.clearBuffer(changed);
    for(let i=0;i<2;i++)gpu.dispatch(e,flood,binds[i],grid);
    e.copyBufferToBuffer(changed,0,stage,0,4);gpu.device.queue.submit([e.finish()]);await stage.mapAsync(GPUMapMode.READ);
    let more;try{more=new Uint32Array(stage.getMappedRange())[0];}finally{stage.unmap();}
    waves+=2;if(!more)break;
  }
  const link=await gpu.kernel('CFD join cut momentum through its widest shortest path',head+metricWGSL(f)+
    decl(0,'mu','vec4f')+decl(1,'dist','u32')+decl(2,'parent','u32',true)+main(`
      let d=dist[i];if(d==0u||d==0x7fffffffu){return;}var best=-1.;var parentId=i;let area=faceAreas(cellWidths(p));
      ${neighbours}let score=area[a]*opening;if(dist[j]+1u==d&&score>best){best=score;parentId=j;}
      }}parent[i]=parentId;`));
  const group=gpu.bind(link,[mu,dist[0],parents],metricBuffer(gpu,f));
  return {waves,encode:e=>gpu.dispatch(e,link,group,grid)};
}
