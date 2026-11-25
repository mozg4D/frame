import {gridWGSL} from './fixtures.mjs';
import {residualControlledTransport} from './outer-transport.mjs';

// Backward Euler on the actual merged control volumes. A root owns its
// external discharges, including boundary reservoirs. Red/black singletons
// only touch opposite-colour singletons or a frozen merged root. Update all
// merged roots in a separate Jacobi pass to avoid colour conflicts.
export async function groupTransport(gpu,f,dt,rhs,high,low,groups){
  const n=f.dims.reduce((a,b)=>a*b),grid=[Math.ceil(n/128)],count=groups.stats.groupsWithChildren;
  const mergedGrid=[Math.ceil(count/128)],{links,volumes}=groups;
  const work=gpu.buffer('CFD implicit merged-volume transport iterate',rhs.size);
  const merged=gpu.buffer('CFD merged transport root indices',4*(1+count));
  const pending=gpu.buffer('CFD merged transport updates',Math.max(1,count)*32);
  const peak=gpu.buffer('CFD merged transport residual',4),stage=gpu.staging('CFD merged transport readback',4);
  const free=f.U*dt/f.h,reference=f.maxSpeed*dt/f.h,k0=1.5*(.005*reference)**2,omega0=k0/(5*f.nu*dt/f.h**2);
  const types=`struct Cell{uk:vec4f,wt:vec2f,pad:vec2f} struct Flux{hi:vec4f,lo:vec4f}
    struct Link{root:u32,head:u32,next:u32} struct Roster{count:u32,ids:array<u32>}
    struct Budget{incoming:vec4f,omega:f32,outgoing:f32} const END=0xffffffffu;`;
  const op=(body)=>`@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) id:vec3u){let i=id.x;${body}}`;
  const storage=(i,name,type,write=false)=>`@group(0) @binding(${i}) var<storage,${write?'read_write':'read'}> ${name}:${type};`;
  const roster=await gpu.kernel('CFD list merged transport roots',types+storage(0,'link','array<Link>')+
    'struct WritableRoster{count:atomic<u32>,ids:array<u32>}'+storage(1,'roster','WritableRoster',true)+
    op('if(i<arrayLength(&link)&&link[i].head!=END){let j=atomicAdd(&roster.count,1u);roster.ids[j]=i;}'));
  gpu.run(roster,[links,merged],grid);
  const base=(writeRhs,writeGuess)=>gridWGSL(f)+types+storage(0,'rhs','array<Cell>',writeRhs)+storage(1,'guess','array<Cell>',writeGuess)+
    storage(2,'link','array<Link>')+storage(3,'volume','array<f32>')+storage(4,'high','array<Flux>')+storage(5,'low','array<Flux>')+`
    fn transfers(root:u32)->Budget{
      var sums=Budget(vec4f(0),0.,0.);var i=root;let inv=1./volume[root];
      loop{let p=point(i);
        for(var axis=0u;axis<3u;axis++){for(var side=-1;side<=1;side+=2){
          var q=p;q[axis]+=side;let internal=inside(q);let neighbour=link[bounded(q)].root;
          if(internal&&neighbour==root){continue;}
          let h=select(high[i].lo[axis],high[i].hi[axis],side>0);
          let l=select(low[i].lo[axis],low[i].hi[axis],side>0);let rate=f32(side)*(h+l)*inv;
          if(rate>=0.){sums.outgoing+=rate;}else{
            var u=vec4f(${free},0.,0.,${k0});var omega=f32(${omega0});
            if(internal){u=guess[neighbour].uk;omega=guess[neighbour].wt.x;}
            sums.incoming-=rate*u;sums.omega-=rate*omega;
          }
        }}
        i=select(link[i].next,link[root].head,i==root);if(i==END){break;}
      }return sums;
    }
    fn updated(i:u32)->Cell{let t=transfers(i);var s=rhs[i];let scale=1./(1.+t.outgoing);
      s.uk=(s.uk+t.incoming)*scale;s.wt.x=(s.wt.x+t.omega)*scale;return s;}`;
  const bindings=[rhs,work,links,volumes,high,low];
  const regular=[];
  for(let colour=0;colour<2;colour++){
    const pipe=await gpu.kernel('CFD implicit singleton colour '+colour,base(false,true)+op(`
      if(i>=CELLS||link[i].root!=i||link[i].head!=END||volume[i]<=0.){return;}
      let p=point(i);if(((p.x+p.y+p.z)&1)==${colour}){guess[i]=updated(i);}`));
    regular.push([pipe,gpu.bind(pipe,bindings)]);
  }
  let updateMerged=null;
  if(count){
    const update=await gpu.kernel('CFD implicit irregular volumes',base(false,false)+storage(6,'roster','Roster')+
      storage(7,'next','array<Cell>',true)+op('if(i<roster.count){next[i]=updated(roster.ids[i]);}'));
    const apply=await gpu.kernel('CFD publish merged-volume iterate',types+storage(0,'roster','Roster')+
      storage(1,'next','array<Cell>')+storage(2,'guess','array<Cell>',true)+op('if(i<roster.count){guess[roster.ids[i]]=next[i];}'));
    const a=gpu.bind(update,[...bindings,merged,pending]),b=gpu.bind(apply,[merged,pending,work]);
    updateMerged=e=>{gpu.dispatch(e,update,a,mergedGrid);gpu.dispatch(e,apply,b,mergedGrid);};
  }
  const error=await gpu.kernel('CFD actual merged-volume transport defect',base(false,false)+storage(6,'peak','atomic<u32>',true)+`
    var<workgroup> block:array<u32,128>;
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) lane:u32){
      let i=id.x;var v=0.;if(i<CELLS&&volume[i]>0.){
        let t=transfers(i);let a=guess[i];let b=rhs[i];let r=abs((b.uk-a.uk)+t.incoming-t.outgoing*a.uk);
        let w=abs((b.wt.x-a.wt.x)+t.omega-t.outgoing*a.wt.x);
        v=max(length(r.xyz)/max(${reference},length(a.uk.xyz)),max(r.w/max(${k0},abs(a.uk.w)),w/max(${omega0},abs(a.wt.x))));
      }
      block[lane]=bitcast<u32>(v);for(var d=64u;d>0u;d/=2u){workgroupBarrier();if(lane<d){block[lane]=max(block[lane],block[lane+d]);}}
      if(lane==0u){atomicMax(&peak,block[0]);}
    }`);
  const finish=await gpu.kernel('CFD integrate external group discharges',base(true,false)+op(`
    if(i<CELLS&&volume[i]>0.){let t=transfers(i);let v=guess[i];var s=rhs[i];
      s.uk+=t.incoming-t.outgoing*v.uk;s.wt.x+=t.omega-t.outgoing*v.wt.x;rhs[i]=s;}`));
  const scatter=await gpu.kernel('CFD scatter implicit merged momentum',types+storage(0,'link','array<Link>')+
    storage(1,'rhs','array<Cell>',true)+op('if(i<arrayLength(&link)&&link[i].root!=i){rhs[i]=rhs[link[i].root];}'));
  const check=gpu.bind(error,[...bindings,peak]),final=gpu.bind(finish,bindings),fill=gpu.bind(scatter,[links,rhs]);
  const begin={kind:'initialize implicit group transport',encode:e=>e.copyBufferToBuffer(rhs,0,work,0,rhs.size)};
  const sweep={kind:'implicit group transport sweep',encode:e=>{
    for(const [pipe,group] of regular)gpu.dispatch(e,pipe,group,grid);
    updateMerged?.(e);
  }};
  const norm={kind:'measure group transport residual',encode:e=>{
    e.clearBuffer(peak);gpu.dispatch(e,error,check,grid);e.copyBufferToBuffer(peak,0,stage,0,4);
  }};
  const end={kind:'conservative group transport integral',encode:e=>{
    gpu.dispatch(e,finish,final,grid);if(count)gpu.dispatch(e,scatter,fill,grid);
  }};
  return residualControlledTransport(stage,begin,sweep,norm,end,192);
}
