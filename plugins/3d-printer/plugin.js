// Direct layered depth images and perimeter paths stay on the shared GPU.
const KEYS=['Line width','Layer height','Initial layer height'];
const BUILD_BOUNDS={min:[-500,0,-500],max:[500,1000,500]};
const LAYER_BATCH=64,MAX_LAYERS=4096,MAX_RAYS=4194304,MAX_EVENTS=16777216,MAX_HITS=1024;
const MAX_PREVIEW_SEGMENTS=4194304;
const sourceLanes=count=>Math.min(256,2**Math.ceil(Math.log2(Math.max(1,4096/Math.max(1,count)))));
const failure=(code,message)=>Object.assign(Error(message),{code});
const emptySchema={type:'object',properties:{},additionalProperties:false};
const layerY=(i,o)=>i?o.initial+(i-.5)*o.height:o.initial*.5;
const pathKey=p=>'perimeter:'+Math.max(.0001,Math.min(10,p['Max deviation']));
const checkedModule=async(d,label,code)=>{const module=d.createShaderModule({label,code}),info=await module.getCompilationInfo(),errors=info.messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(m=>m.message).join('; '));return module;};

// Reconstruct and link the zero-offset section directly at LDI crossings.
const pathShader=`
struct Config{size:vec4u,domain:vec4f,physical:vec4f,limits:vec4u,stage:vec4u};
struct Node{ends:vec4f,edges:vec2u,ring:u32,next:u32};
@group(0) @binding(0) var<storage,read> headers:array<vec2u>;
@group(0) @binding(1) var<storage,read> intervals:array<vec2f>;
@group(0) @binding(2) var<storage,read_write> tree:array<atomic<u32>>;
@group(0) @binding(3) var<storage,read_write> geometry:array<vec4f>;
@group(0) @binding(5) var<storage,read_write> nodes:array<Node>;
@group(0) @binding(6) var<storage,read_write> stats:array<atomic<u32>>;
@group(0) @binding(7) var<uniform> cfg:Config;
@group(0) @binding(8) var<storage,read_write> links:array<u32>;
fn linear(id:vec3u,g:vec3u)->u32{return id.x+id.y*g.x*64u;}
fn point(p:vec2u)->vec2f{return cfg.domain.xy+(vec2f(p)-.5)*cfg.domain.zw;}
fn cross2(a:vec2f,b:vec2f)->f32{return a.x*b.y-a.y*b.x;}
fn ray(axis:u32,col:u32)->vec2u{let n=select(cfg.size.y,cfg.size.x,axis!=0u);if(col==0u||col>n){return vec2u(0,0x80000000u);}let index=select(cfg.size.w*cfg.size.y+col-1u,col-1u,axis==0u);return headers[index+select(cfg.size.z*cfg.size.y,cfg.size.z*cfg.size.x,axis!=0u)];}
fn inside(r:vec2u,d:f32)->i32{if((r.y&0x80000000u)!=0u){return -1;}var lo=0u;var hi=r.y;while(lo<hi){let m=(lo+hi)/2u;if(intervals[r.x+m].x<=d){lo=m+1u;}else{hi=m;}}if(lo==0u){return 0;}return i32(d<intervals[r.x+lo-1u].y);}
fn occupancy(p:vec2u)->f32{if(any(p==vec2u(0))||p.x>cfg.size.x||p.y>cfg.size.y){return -1.;}let v=point(p);let a=inside(ray(0u,p.y),v.x);let b=inside(ray(1u,p.x),v.y);if(a<0&&b<0){return -1.;}return select(-1.,1.,max(a,b)>0);}
fn boundary(r:vec2u,d:f32)->f32{var lo=0u;var hi=r.y&0x7fffffffu;while(lo<hi){let m=(lo+hi)/2u;if(intervals[r.x+m].x<d){lo=m+1u;}else{hi=m;}}var v=1e20;if(lo<(r.y&0x7fffffffu)){v=intervals[r.x+lo].x;}if(lo>0u){let s=intervals[r.x+lo-1u];if(abs(s.x-d)<abs(v-d)){v=s.x;}if(abs(s.y-d)<abs(v-d)){v=s.y;}}return v;}
fn crossing(cell:vec2u,edge:u32)->vec2f{var p=cell;var q=cell;switch(edge){case 0u:{q.x++;}case 1u:{p.x++;q+=vec2u(1,1);}case 2u:{p.y++;q+=vec2u(1,1);}default:{q.y++;}}let a=point(p);let b=point(q);let axis=u32(edge%2u!=0u);let col=select(p.y,p.x,axis!=0u);let r=ray(axis,col);var t=.5;if((r.y&0x80000000u)==0u){let d=boundary(r,select((a.x+b.x)*.5,(a.y+b.y)*.5,axis!=0u));t=clamp((d-a[axis])/(b[axis]-a[axis]),0.,1.);}return mix(a,b,t);}
fn tangent(cell:vec2u,edge:u32,p:vec2f)->vec2f{let axis=u32(edge%2u!=0u);var col=select(cell.y,cell.x,axis!=0u);if(edge==1u||edge==2u){col+=2u;}else{if(col==0u){return vec2f(0);}col--;}
 let r=ray(axis,col);if((r.y&0x80000000u)!=0u||r.y==0u){return vec2f(0);}let d=boundary(r,p[axis]);var q=p;q[axis]=d;q[1u-axis]=cfg.domain[1u-axis]+(f32(col)-.5)*cfg.domain[3u-axis];let second=select(col-1u,col+1u,edge==1u||edge==2u);let r2=ray(axis,second);if((r2.y&0x80000000u)!=0u||r2.y==0u){return vec2f(0);}var q2=p;q2[axis]=boundary(r2,p[axis]);q2[1u-axis]=cfg.domain[1u-axis]+(f32(second)-.5)*cfg.domain[3u-axis];if(abs(cross2(q-p,q2-p))/max(length(q-p),1e-8)>min(cfg.domain.z,cfg.domain.w)*.005){return vec2f(0);}return q-p;}
fn segmentDistance(p:vec2f,a:vec2f,b:vec2f)->f32{let v=b-a;return length(p-mix(a,b,clamp(dot(p-a,v)/max(dot(v,v),1e-30),0.,1.)));}
fn edgeKey(c:vec2u,e:u32)->u32{let w=cfg.size.x+2u;switch(e){case 0u:{return (c.y*w+c.x)*2u;}case 1u:{return (c.y*w+c.x+1u)*2u+1u;}case 2u:{return ((c.y+1u)*w+c.x)*2u;}default:{return (c.y*w+c.x)*2u+1u;}}}
fn march(c:vec2u,v:vec4f){let iso=0.;var edges:array<u32,4>;var n=0u;for(var e=0u;e<4u;e++){if((v[e]>=iso)!=(v[(e+1u)%4u]>=iso)){edges[n]=e;n++;}}if(n==0u){return;}
 // Asymptotic decider: shared edge identities preserve touching/saddle topology.
 if(n==4u){let f=v-iso;let high=f.x*f.z-f.y*f.w;if(high<0.){edges=array<u32,4>(0,3,1,2);}}
 let cell=c.y*(cfg.size.x+1u)+c.x;
 let base=atomicAdd(&stats[0],n);
 if(base+n>cfg.limits.y*2u){atomicStore(&stats[7],1u);return;}
 let fits=base+n<=cfg.limits.y;
 if(fits){
  atomicStore(&tree[cell],(base+1u)*2u+u32(n==4u));
  for(var k=0u;k<n;k++){nodes[base+k].ring=0xffffffffu;}
 }else{atomicStore(&stats[7],1u);}
 let corners=array<vec2u,4>(c,c+vec2u(1,0),c+1u,c+vec2u(0,1));
 for(var k=0u;k<n;k+=2u){
  let ea=edges[k];let eb=edges[k+1u];let a=crossing(c,ea);let b=crossing(c,eb);var corner=b;
  if(n==2u){
   let u=tangent(c,ea,a);let w=tangent(c,eb,b);let det=cross2(u,w);
   if(abs(det)>.05*length(u)*length(w)){
    let q=a+u*(cross2(b-a,w)/det);
    if(all(q>=point(c)-cfg.domain.zw)&&all(q<=point(c+1u)+cfg.domain.zw)){corner=q;}
   }
  }
  geometry[base+k]=vec4f(a,corner);geometry[base+k+1u]=vec4f(corner,b);
  if(!fits){continue;}
  var ends=vec4f(a,b);var keys=vec2u(edgeKey(c,ea),edgeKey(c,eb));
  let midA=(point(corners[ea])+point(corners[(ea+1u)%4u]))*.5;
  let midB=(point(corners[eb])+point(corners[(eb+1u)%4u]))*.5;
  if((cross2(midB-midA,point(corners[ea])-midA)>0.)!=(v[ea]>=0.)){ends=ends.zwxy;keys=keys.yx;}
  let slot=base+k/2u;
  if(any(corner!=b)){
   let internal=(cfg.size.x+2u)*(cfg.size.y+2u)*2u+cell;
   nodes[slot]=Node(vec4f(ends.xy,corner),vec2u(keys.x,internal),0u,slot+1u);
   nodes[slot+1u]=Node(vec4f(corner,ends.zw),vec2u(internal,keys.y),0u,0xffffffffu);
   atomicAdd(&stats[1],2u);
  }else{
   nodes[slot]=Node(ends,keys,0u,0xffffffffu);atomicAdd(&stats[1],1u);
  }
 }
}
@compute @workgroup_size(64) fn seed(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){let i=linear(id,groups);let w=cfg.size.x+1u;if(i>=w*(cfg.size.y+1u)){return;}let c=vec2u(i%w,i/w);march(c,vec4f(occupancy(c),occupancy(c+vec2u(1,0)),occupancy(c+1u),occupancy(c+vec2u(0,1))));}
@compute @workgroup_size(64) fn seedSparse(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){let i=linear(id,groups);if(i>=cfg.size.x+cfg.size.y){return;}let axis=u32(i>=cfg.size.y);let col=select(i+1u,i-cfg.size.y+1u,axis!=0u);let r=ray(axis,col);if((r.y&0x80000000u)!=0u){return;}
 for(var j=0u;j<r.y;j++){let interval=intervals[r.x+j];for(var end=0u;end<2u;end++){let crossing=i32(floor((interval[end]-cfg.domain[axis])/cfg.domain[axis+2u]+.5));for(var side=0;side<2;side++){for(var edge=0;edge<2;edge++){let along=crossing-edge;let across=i32(col)-side;if(along<0||across<0){continue;}let c=select(vec2u(u32(along),u32(across)),vec2u(u32(across),u32(along)),axis!=0u);if(c.x>cfg.size.x||c.y>cfg.size.y){continue;}if(atomicMax(&tree[c.y*(cfg.size.x+1u)+c.x],1u)!=0u){continue;}march(c,vec4f(occupancy(c),occupancy(c+vec2u(1,0)),occupancy(c+1u),occupancy(c+vec2u(0,1))));}}}}
}
@compute @workgroup_size(64) fn connect(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){let i=linear(id,groups);let total=min(atomicLoad(&stats[2]),cfg.limits.y);if(i>=total||nodes[i].ring==0xffffffffu){return;}let e=nodes[i].edges.y;let w=cfg.size.x+2u;let p=vec2u((e/2u)%w,(e/2u)/w);var cells:array<vec2u,2>;cells[0]=p;cells[1]=p;if(e%2u==0u){cells[1].y--;}else{cells[1].x--;}
 var next=nodes[i].next;if(next==0xffffffffu){for(var k=0u;k<2u;k++){let c=cells[k];if(c.x>cfg.size.x||c.y>cfg.size.y){continue;}let cell=atomicLoad(&tree[c.y*(w-1u)+c.x]);if(cell<=1u){continue;}let start=cell/2u-1u;let n=2u+(cell%2u)*2u;for(var j=start;j<min(start+n,cfg.limits.y);j++){if(j!=i&&nodes[j].ring==nodes[i].ring&&nodes[j].edges.x==e){next=j;}}}}nodes[i].next=next;let at=i*5u;links[at]=next;links[at+1u]=i;links[at+4u]=0u;
}
@compute @workgroup_size(64) fn label(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){let i=linear(id,groups);if(i>=min(atomicLoad(&stats[2]),cfg.limits.y)||nodes[i].ring==0xffffffffu){return;}let a=i*5u;let src=cfg.stage.x;let dst=2u-src;let j=links[a+src];let r=links[a+src+1u];if(j==0xffffffffu){links[a+dst]=j;links[a+dst+1u]=r;return;}let b=j*5u;links[a+dst]=links[b+src];links[a+dst+1u]=min(r,links[b+src+1u]);}
fn keep(i:u32){links[i*5u+4u]|=1u;}
@compute @workgroup_size(64) fn simplify(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){let root=linear(id,groups);let total=min(atomicLoad(&stats[2]),cfg.limits.y);if(root>=total||nodes[root].ring==0xffffffffu||links[root*5u+cfg.stage.x+1u]!=root){return;}
 // Choose the same geometric anchor regardless of the order GPU cells were appended.
 // Removing monotone axis-aligned samples preserves the maximum distance to any chord.
 var incoming=root;var first=0xffffffffu;var last=0xffffffffu;var start=root;var count=0u;
 loop{
  let middle=nodes[incoming].next;
  if(middle==0xffffffffu||count>=32768u){atomicAdd(&stats[6],1u);return;}
  let next=nodes[middle].next;if(next==0xffffffffu){atomicAdd(&stats[6],1u);return;}
  let a=nodes[incoming].ends.xy;let b=nodes[middle].ends.xy;let c=nodes[next].ends.xy;
  let straight=((a.x==b.x&&b.x==c.x)||(a.y==b.y&&b.y==c.y))&&all(b>=min(a,c))&&all(b<=max(a,c))&&any(a!=b)&&any(b!=c);
  if(!straight){
   if(first==0xffffffffu){first=middle;start=middle;}else{links[last*5u]=middle;}
   let p=nodes[start].ends.xy;
   if(b.x<p.x||(b.x==p.x&&(b.y<p.y||(b.y==p.y&&nodes[middle].edges.x<nodes[start].edges.x)))){start=middle;}
   last=middle;
  }
  count++;incoming=middle;if(incoming==root){break;}
 }
 if(first==0xffffffffu){atomicAdd(&stats[9],1u);return;}
 links[last*5u]=first;
 var cursor=start;var far=start;var maximum=0.;var area=0.;let origin=nodes[start].ends.xy;
 loop{
  let next=links[cursor*5u];let p=nodes[cursor].ends.xy-origin;
  area+=cross2(p,nodes[next].ends.xy-origin);let d=length(p);
  if(d>maximum){maximum=d;far=cursor;}cursor=next;if(cursor==start){break;}
 }
 if(far==start||abs(area)<cfg.physical.x*cfg.physical.x*1e-8){atomicAdd(&stats[9],1u);return;}
 atomicAdd(&stats[3],1u);keep(start);keep(far);var stack:array<vec2u,64>;stack[0]=vec2u(start,far);stack[1]=vec2u(far,start);var top=2u;var work=0u;
 loop{if(top==0u){break;}top--;let range=stack[top];let a=nodes[range.x].ends.xy;let b=nodes[range.y].ends.xy;var best=min(cfg.physical.y,abs(area)/max(maximum*16.,1e-8));var split=0xffffffffu;cursor=links[range.x*5u];
  loop{if(cursor==range.y){break;}let d=segmentDistance(nodes[cursor].ends.xy,a,b);if(d>best){best=d;split=cursor;}cursor=links[cursor*5u];work++;if(work>2000000u){break;}}
  if(work>2000000u||top>60u){cursor=root;loop{keep(cursor);cursor=nodes[cursor].next;if(cursor==root){break;}}atomicAdd(&stats[8],1u);return;}
  if(split!=0xffffffffu){keep(split);stack[top]=vec2u(range.x,split);stack[top+1u]=vec2u(split,range.y);top+=2u;}
 }
 // A bounded farthest-feasible walk avoids RDP's power-of-two over-segmentation.
 // Keep the result only when every skipped source point was checked and it wins.
 var rdp=0u;cursor=start;loop{rdp+=links[cursor*5u+4u]&1u;cursor=links[cursor*5u];if(cursor==start){break;}}
 var anchor=start;var previous=start;var candidate=links[start*5u];var greedy=1u;work=0u;var complete=false;links[start*5u+4u]|=2u;
 loop{var error=0.;cursor=links[anchor*5u];loop{if(cursor==candidate){break;}error=max(error,segmentDistance(nodes[cursor].ends.xy,nodes[anchor].ends.xy,nodes[candidate].ends.xy));cursor=links[cursor*5u];work++;if(work>200000u||error>cfg.physical.y){break;}}
  if(work>200000u){break;}if(error<=cfg.physical.y){if(candidate==start){complete=true;break;}previous=candidate;candidate=links[candidate*5u];}
  else{if(previous==anchor){break;}links[previous*5u+4u]|=2u;greedy++;anchor=previous;candidate=links[anchor*5u];previous=anchor;}
 }
 if(complete&&greedy>=3u&&greedy<rdp){links[root*5u+4u]|=4u;}
}
@compute @workgroup_size(64) fn emit(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){let i=linear(id,groups);if(i>=min(atomicLoad(&stats[2]),cfg.limits.y)||nodes[i].ring==0xffffffffu){return;}let root=links[i*5u+cfg.stage.x+1u];let mask=select(1u,2u,(links[root*5u+4u]&4u)!=0u);if((links[i*5u+4u]&mask)==0u){return;}var next=nodes[i].next;var steps=0u;loop{if(next==0xffffffffu||steps>32768u){return;}if((links[next*5u+4u]&mask)!=0u){break;}next=nodes[next].next;steps++;}let at=atomicAdd(&stats[4],1u);geometry[at*2u]=vec4f(nodes[i].ends.xy,nodes[next].ends.xy);geometry[at*2u+1u]=bitcast<vec4f>(vec4u(i,next,nodes[i].ring,links[i*5u+cfg.stage.x+1u]));}
// Label jump slots 0/2 are free after emission; preserve roots 1/3 and keep flags.
@compute @workgroup_size(64) fn neighbours(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){let i=linear(id,groups);if(i>=min(atomicLoad(&stats[4]),cfg.limits.y)){return;}let record=bitcast<vec4u>(geometry[i*2u+1u]);links[record.x*5u]=i;links[record.y*5u+2u]=i;}
@compute @workgroup_size(64) fn remap(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){let i=linear(id,groups);if(i>=min(atomicLoad(&stats[4]),cfg.limits.y)){return;}let record=bitcast<vec4u>(geometry[i*2u+1u]);geometry[i*2u+1u]=bitcast<vec4f>(vec4u(i,links[record.y*5u],links[record.x*5u+2u],record.w));}
@compute @workgroup_size(64) fn unmark(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){let i=linear(id,groups);if(i<min(atomicLoad(&stats[2]),cfg.limits.y)){links[i*5u+4u]=0u;}}
@compute @workgroup_size(1) fn prepare(){atomicStore(&stats[2],atomicLoad(&stats[0]));atomicStore(&stats[20],select(0u,(min(atomicLoad(&stats[2]),cfg.limits.y)+63u)/64u,atomicLoad(&stats[7])==0u));atomicStore(&stats[21],1u);atomicStore(&stats[22],1u);}
@compute @workgroup_size(1) fn finish(){let valid=atomicLoad(&stats[7])==0u&&atomicLoad(&stats[6])==0u;let n=select(0u,atomicLoad(&stats[4]),valid);atomicStore(&stats[12],n*2u);atomicStore(&stats[13],1u);atomicStore(&stats[16],6u);atomicStore(&stats[17],n);}
`;

const sourceShader=texture=>`
struct Config{matrix:mat4x4f,size:vec4u,domain:vec4f,heights:vec4f,shell:vec4u};
@group(0) @binding(0) var ${texture?'positions:texture_2d_array<u32>':'<storage,read> positions:array<f32>'};
@group(0) @binding(1) var ${texture?'indices:texture_2d_array<u32>':'<storage,read> indices:array<u32>'};
@group(0) @binding(2) var<uniform> cfg:Config;
@group(0) @binding(3) var<storage,read_write> counts:array<atomic<u32>>;
@group(0) @binding(4) var<storage,read> offsets:array<u32>;
@group(0) @binding(5) var<storage,read_write> cursors:array<atomic<u32>>;
@group(0) @binding(6) var<storage,read_write> events:array<vec2u>;
@group(0) @binding(7) var<storage,read_write> metrics:array<atomic<u32>>;
@group(0) @binding(8) var<storage,read_write> planes:array<atomic<u32>>;
${texture?`fn scalar(t:texture_2d_array<u32>,i:u32)->u32{let d=textureDimensions(t);return textureLoad(t,vec2i(vec2u(i%d.x,(i/d.x)%d.y)),i32(i/(d.x*d.y)),0).x;}
fn index(i:u32)->u32{return scalar(indices,i);}fn value(i:u32)->f32{return bitcast<f32>(scalar(positions,i));}`:`fn index(i:u32)->u32{return indices[i];}fn value(i:u32)->f32{return positions[i];}`}
fn point(i:u32)->vec3f{let k=index(i)*3u;return (cfg.matrix*vec4f(value(k),value(k+1u),value(k+2u),1)).xyz;}
fn ordered(x:f32)->u32{let b=bitcast<u32>(x);return select(b^0x80000000u,~b,(b&0x80000000u)!=0u);}
fn invocation(id:vec3u,groups:vec3u)->u32{return id.x+id.y*groups.x*128u;}
@compute @workgroup_size(128) fn bounds(@builtin(global_invocation_id) gid:vec3u,@builtin(num_workgroups) groups:vec3u){let t=invocation(gid,groups);if(t>=cfg.size.x){return;}
 var polygon:array<vec3f,8>;var clipped:array<vec3f,8>;polygon[0]=point(t*3u);polygon[1]=point(t*3u+1u);polygon[2]=point(t*3u+2u);var n=3u;
 // Clip X/Z before reducing height: vertices outside the bed must not raise Finish.
 for(var plane=0u;plane<4u;plane++){let axis=select(0u,2u,plane>=2u);let sign=select(1.,-1.,(plane&1u)!=0u);var count=0u;var previous=polygon[n-1u];var before=previous[axis]*sign<=500.;for(var i=0u;i<n;i++){let current=polygon[i];let inside=current[axis]*sign<=500.;if(inside!=before){var p=mix(previous,current,(500.*sign-previous[axis])/(current[axis]-previous[axis]));p[axis]=500.*sign;clipped[count]=p;count++;}if(inside){clipped[count]=current;count++;}previous=current;before=inside;}n=count;if(n==0u){return;}for(var i=0u;i<n;i++){polygon[i]=clipped[i];}}
 for(var k=0u;k<n;k++){let p=polygon[k];for(var a=0u;a<3u;a++){atomicMin(&metrics[a],ordered(p[a]));atomicMax(&metrics[3u+a],ordered(p[a]));}}
}
fn cross(a:vec2f,b:vec2f)->f32{let x=a.x*b.y;let y=a.y*b.x;let d=x-y;if(abs(d)>(abs(x)+abs(y))*2.3841858e-7){return d;}return d+(fma(a.x,b.y,-x)-fma(a.y,b.x,-y));}
fn project(p:vec3f,axis:u32)->vec3f{return select(p.zyx,p.xyz,axis!=0u);}
fn yAt(i:u32)->f32{return select(cfg.heights.x+(f32(i)-.5)*cfg.heights.y,cfg.heights.x*.5,i==0u);}
fn before(a:vec3f,b:vec3f)->bool{return a.x<b.x||(a.x==b.x&&(a.y<b.y||(a.y==b.y&&a.z<b.z)));}
fn root(vertex:u32)->u32{var v=vertex;loop{let p=atomicLoad(&planes[v]);if(p==v){return v;}let q=atomicLoad(&planes[p]);atomicMin(&planes[v],q);v=q;}}
@compute @workgroup_size(128) fn shellInit(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){let i=invocation(id,groups);if(i<cfg.shell.x){atomicStore(&planes[cfg.shell.y+i],cfg.shell.y+i);}}
@compute @workgroup_size(128) fn shellJoin(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){let i=invocation(id,groups);if(i>=cfg.size.x){return;}let a=index(i*3u)+cfg.shell.y;for(var k=1u;k<3u;k++){let b=index(i*3u+k)+cfg.shell.y;loop{let x=root(a);let y=root(b);if(x==y){break;}let hi=max(x,y);let lo=min(x,y);if(atomicMin(&planes[hi],lo)==hi){break;}}}}
@compute @workgroup_size(128) fn shellCompress(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){let i=invocation(id,groups);if(i<cfg.shell.x){let v=cfg.shell.y+i;atomicStore(&planes[v],root(v));}}
fn raster(A:vec3f,B:vec3f,C:vec3f,axis:u32,emit:bool,vertex:u32,lane:u32,lanes:u32){
 let originalA=project(A,axis);let originalB=project(B,axis);let originalC=project(C,axis);let direction=u32(cross(originalB.xy-originalA.xy,originalC.xy-originalA.xy)>0.);
 // Canonical ordering makes duplicate/reversed triangles bit-identical.
 var a=project(A,axis);var b=project(B,axis);var c=project(C,axis);
 if(before(b,a)){let v=a;a=b;b=v;}if(before(c,b)){let v=b;b=c;c=v;}if(before(b,a)){let v=a;a=b;b=v;}
 var area=cross(b.xy-a.xy,c.xy-a.xy);if(area==0.){return;}if(area<0.){let swap=b;b=c;c=swap;area=-area;}
 let columns=select(cfg.size.z,cfg.size.y,axis!=0u);let low=select(cfg.domain.y,cfg.domain.x,axis!=0u);let pitch=select(cfg.domain.w,cfg.domain.z,axis!=0u);
 let first=u32(clamp(floor((min(a.x,min(b.x,c.x))-low)/pitch-.5)-1.,0.,f32(columns)));
 let end=u32(clamp(ceil((max(a.x,max(b.x,c.x))-low)/pitch-.5)+2.,0.,f32(columns)));
 let minY=min(a.y,min(b.y,c.y));let maxY=max(a.y,max(b.y,c.y));
 var firstLayer=u32(clamp(ceil((minY-cfg.heights.x)/cfg.heights.y+.5),1.,f32(cfg.size.w)));
 while(firstLayer>1u&&yAt(firstLayer-1u)>=minY){firstLayer--;}
 while(firstLayer<cfg.size.w&&yAt(firstLayer)<minY){firstLayer++;}
 if(yAt(0u)>=minY&&yAt(0u)<=maxY){firstLayer=0u;}
 // Bound serial work per lane even for a full-height coarse triangle.
 firstLayer=max(firstLayer,cfg.shell.w);let layerEnd=min(cfg.size.w,cfg.shell.w+${LAYER_BATCH}u);if(firstLayer>=layerEnd||first+lane>=end){return;}
 let ab=b-a;let ac=c-a;let slopes=bitcast<vec2u>(vec2f(ab.z*ac.y-ab.y*ac.z,ab.x*ac.z-ab.z*ac.x)/area);var component=0u;if(emit){component=atomicLoad(&planes[cfg.shell.y+vertex]);}
 for(var layer=firstLayer;layer<layerEnd;layer++){let y=yAt(layer);if(y>maxY){break;}if(y<minY){continue;}
  // Interpolate shared edges in the same direction. Half-open section
  // endpoints prevent skinny triangles and shared vertices losing a crossing.
  let vertices=array<vec3f,3>(a,b,c);var cuts:array<vec3f,2>;var n=0u;
  for(var edge=0u;edge<3u;edge++){var v=vertices[edge];var w=vertices[(edge+1u)%3u];if(v.y>w.y){let swap=v;v=w;w=swap;}
   if(v.y<=y&&y<w.y){let f=(y-v.y)/(w.y-v.y);cuts[n]=vec3f(fma(f,w.x-v.x,v.x),y,fma(f,w.z-v.z,v.z));n++;}
  }
  if(n!=2u){continue;}var v=cuts[0];var w=cuts[1];if(v.x>w.x){let swap=v;v=w;w=swap;}if(v.x==w.x){continue;}
  for(var col=first+lane;col<end;col+=lanes){let x=low+(f32(col)+.5)*pitch;if(x<v.x||x>=w.x){continue;}
   // A certified vertical plane has an identical section at every height.
   // Evaluate it from the original anchor to avoid layer-dependent edge roundoff.
   var depth=fma((x-v.x)/(w.x-v.x),w.z-v.z,v.z);if(bitcast<f32>(slopes.y)==0.){depth=fma(bitcast<f32>(slopes.x),x-a.x,a.z);}let ray=select(layer*cfg.size.z+col,cfg.size.w*cfg.size.z+layer*cfg.size.y+col,axis!=0u);
   if(emit){let at=offsets[ray]+atomicAdd(&cursors[ray],1u);events[at]=vec2u(bitcast<u32>(depth),u32(cfg.heights.z));let base=cfg.shell.z+at*4u;atomicStore(&planes[base],slopes.x);atomicStore(&planes[base+1u],slopes.y);atomicStore(&planes[base+2u],component);atomicStore(&planes[base+3u],direction);}
   else{atomicAdd(&counts[ray],1u);atomicAdd(&metrics[0],1u);}
  }
 }
}
@compute @workgroup_size(128) fn count(@builtin(global_invocation_id) gid:vec3u,@builtin(num_workgroups) groups:vec3u){let slot=invocation(gid,groups);let lanes=u32(cfg.heights.w);let t=slot/lanes;let lane=slot%lanes;if(t<cfg.size.x){let a=point(t*3u);let b=point(t*3u+1u);let c=point(t*3u+2u);raster(a,b,c,0u,false,0u,lane,lanes);raster(a,b,c,1u,false,0u,lane,lanes);}}
@compute @workgroup_size(128) fn emit(@builtin(global_invocation_id) gid:vec3u,@builtin(num_workgroups) groups:vec3u){let slot=invocation(gid,groups);let lanes=u32(cfg.heights.w);let t=slot/lanes;let lane=slot%lanes;if(t<cfg.size.x){let a=point(t*3u);let b=point(t*3u+1u);let c=point(t*3u+2u);raster(a,b,c,0u,true,index(t*3u),lane,lanes);raster(a,b,c,1u,true,index(t*3u),lane,lanes);}}
`;

const scanShader=`
struct Config{size:vec4u};
@group(0) @binding(0) var<storage,read> input:array<u32>;
@group(0) @binding(1) var<storage,read_write> output:array<u32>;
@group(0) @binding(2) var<storage,read_write> sums:array<u32>;
@group(0) @binding(3) var<uniform> cfg:Config;
@group(0) @binding(4) var<storage,read_write> metrics:array<atomic<u32>>;
var<workgroup> values:array<u32,256>;
@compute @workgroup_size(256) fn scan(@builtin(workgroup_id) gid:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(num_workgroups) groups:vec3u){
 let block=gid.x+gid.y*groups.x;let i=block*256u+lane;let v=select(0u,input[min(i,cfg.size.x-1u)],i<cfg.size.x);values[lane]=v;workgroupBarrier();
 for(var step=1u;step<256u;step*=2u){var add=0u;if(lane>=step){add=values[lane-step];}workgroupBarrier();values[lane]+=add;workgroupBarrier();}
 if(i<cfg.size.x){output[i]=values[lane]-v;if(cfg.size.y!=0u){atomicMax(&metrics[1],v);}}if(lane==255u){sums[block]=values[lane];}
}
@compute @workgroup_size(256) fn add(@builtin(global_invocation_id) gid:vec3u,@builtin(num_workgroups) groups:vec3u){let i=gid.x+gid.y*groups.x*256u;if(i<cfg.size.x){output[i]+=input[i/256u];}}
`;

const cleanShader=`
struct Config{size:vec4u};
@group(0) @binding(0) var<storage,read> counts:array<u32>;
@group(0) @binding(1) var<storage,read> offsets:array<u32>;
@group(0) @binding(2) var<storage,read> events:array<vec2u>;
@group(0) @binding(3) var<storage,read_write> headers:array<vec2u>;
@group(0) @binding(4) var<storage,read_write> intervals:array<vec2f>;
@group(0) @binding(5) var<storage,read_write> metrics:array<atomic<u32>>;
@group(0) @binding(6) var<uniform> cfg:Config;
@group(0) @binding(7) var<storage,read_write> planes:array<atomic<u32>>;
var<workgroup> hits:array<vec4u,1024>;
fn slope(e:vec4u)->vec2u{let at=cfg.size.y+e.w*4u;return vec2u(atomicLoad(&planes[at]),atomicLoad(&planes[at+1u]));}
fn direction(e:vec4u)->i32{return select(-1,1,atomicLoad(&planes[cfg.size.y+e.w*4u+3u])!=0u);}
fn less(a:vec4u,b:vec4u,shells:bool)->bool{
 if(shells){if(a.y!=b.y){return a.y<b.y;}if(a.z!=b.z){return a.z<b.z;}}
 let x=bitcast<f32>(a.x);let y=bitcast<f32>(b.x);if(x!=y){return x<y;}if(a.y!=b.y){return a.y<b.y;}
 if(!shells){return false;}let pa=slope(a);let pb=slope(b);if(pa.x!=pb.x){return pa.x<pb.x;}return pa.y<pb.y;
}
fn cluster(shell:u32)->u32{var v=shell;loop{let p=atomicLoad(&planes[v]);if(p==v){return v;}v=p;}}
fn join(a:u32,b:u32){loop{let x=cluster(a);let y=cluster(b);if(x==y){return;}let hi=max(x,y);if(atomicMin(&planes[hi],min(x,y))==hi){return;}}}
fn groupLess(a:vec4u,b:vec4u)->bool{if(a.y!=b.y){return a.y<b.y;}if(a.z!=b.z){return a.z<b.z;}return bitcast<f32>(a.x)<bitcast<f32>(b.x);}
fn duplicate(a:vec4u,b:vec4u)->bool{return all(a.xyz==b.xyz)&&all(slope(a)==slope(b));}
@compute @workgroup_size(128) fn clean(@builtin(workgroup_id) gid:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(num_workgroups) groups:vec3u){
 let ray=gid.x+gid.y*groups.x;if(ray>=cfg.size.x){return;}let count=counts[ray];let offset=offsets[ray];
 if(lane==0u){var length=1u;while(length<count){length*=2u;}hits[0].x=length;}workgroupBarrier();let n=workgroupUniformLoad(&hits[0]).x;
 let sentinel=vec4u(0x7f7fffffu,0xffffffffu,0xffffffffu,0u);
 for(var i=lane;i<n;i+=128u){var v=sentinel;if(i<count){let at=cfg.size.y+(offset+i)*4u;v=vec4u(events[offset+i],atomicLoad(&planes[at+2u]),offset+i);}hits[i]=v;}workgroupBarrier();
 // Resolve nonzero winding inside each connected shell, independent of its
 // global orientation. Unbalanced authored winding falls back to parity.
 for(var size=2u;size<=n;size*=2u){var step=size/2u;while(step>0u){for(var i=lane;i<n;i+=128u){let j=i^step;if(j>i&&less(hits[j],hits[i],true)==((i&size)==0u)){let v=hits[i];hits[i]=hits[j];hits[j]=v;}}workgroupBarrier();step/=2u;}}
 if(lane==0u){var i=0u;var output=0u;var ambiguous=false;
  while(i<count){let begin=i;let owner=hits[i].y;let shell=hits[i].z;var balance=0;var unique=0u;
   while(i<count&&hits[i].y==owner&&hits[i].z==shell){let e=hits[i];balance+=direction(e);unique++;i++;while(i<count&&duplicate(hits[i],e)){atomicAdd(&metrics[3],1u);i++;}}
   let end=i;ambiguous=ambiguous||(unique%2u!=0u);var winding=0;var parity=false;var j=begin;
   while(j<end){let e=hits[j];let before=select(parity,winding!=0,balance==0);winding+=direction(e);parity=!parity;j++;while(j<end&&duplicate(hits[j],e)){j++;}let after=select(parity,winding!=0,balance==0);if(before!=after){hits[output]=vec4u(e.xyz,u32(after));output++;}}
  }
  for(var j=output;j<n;j++){hits[j]=sentinel;}hits[0].w=output|(u32(ambiguous)<<11u);
 }workgroupBarrier();let info=workgroupUniformLoad(&hits[0]).w;let kept=info&2047u;let ambiguous=info>>11u;if(lane==0u){hits[0].w=1u;}workgroupBarrier();
 // A separate all-ray pass joins only interpenetrating connected shells.
 // Strict nesting retains parity; an overlap found on either axis/layer is
 // shared by every ray through the same canonical GPU union/find labels.
 if(cfg.size.z!=0u){for(var i=lane*2u;i+1u<kept;i+=256u){let a=hits[i];let ae=hits[i+1u];if(a.y!=ae.y||a.z!=ae.z||a.w==0u||ae.w!=0u){continue;}let lo=bitcast<f32>(a.x);let hi=bitcast<f32>(ae.x);for(var j=i+2u;j+1u<kept;j+=2u){let b=hits[j];let be=hits[j+1u];if(a.y!=b.y||a.z==b.z||b.y!=be.y||b.z!=be.z||b.w==0u||be.w!=0u){continue;}let low=bitcast<f32>(b.x);let high=bitcast<f32>(be.x);if((lo<low&&low<hi&&hi<high)||(low<lo&&lo<high&&high<hi)){join(a.z,b.z);}}}return;}
 for(var i=lane;i<kept;i+=128u){hits[i].z=cluster(hits[i].z);}workgroupBarrier();
 for(var size=2u;size<=n;size*=2u){var step=size/2u;while(step>0u){for(var i=lane;i<n;i+=128u){let j=i^step;if(j>i&&groupLess(hits[j],hits[i])==((i&size)==0u)){let v=hits[i];hits[i]=hits[j];hits[j]=v;}}workgroupBarrier();step/=2u;}}
 if(lane==0u){var i=0u;var output=0u;while(i<kept){let owner=hits[i].y;let shell=hits[i].z;var occupancy=0;while(i<kept&&hits[i].y==owner&&hits[i].z==shell){let e=hits[i];let before=occupancy;occupancy+=select(-1,1,e.w!=0u);i++;if((before==0)!=(occupancy==0)){hits[output]=e;output++;}}}for(var j=output;j<n;j++){hits[j]=sentinel;}hits[0].z=output;}
 workgroupBarrier();let grouped=workgroupUniformLoad(&hits[0]).z;
 // Distinct nested clusters alternate cavities/islands within one occurrence.
 for(var size=2u;size<=n;size*=2u){var step=size/2u;while(step>0u){for(var i=lane;i<n;i+=128u){let j=i^step;if(j>i&&less(hits[j],hits[i],false)==((i&size)==0u)){let v=hits[i];hits[i]=hits[j];hits[j]=v;}}workgroupBarrier();step/=2u;}}
 if(lane!=0u){return;}var owners:array<u32,8>;var filled=0;var i=0u;var start=0.;var written=0u;let base=offset/2u;
 while(i<grouped){let depth=bitcast<f32>(hits[i].x);let before=filled;
  loop{let owner=hits[i].y;let word=owner/32u;let mask=1u<<(owner%32u);filled+=select(1,-1,(owners[word]&mask)!=0u);owners[word]^=mask;i++;if(i>=grouped||bitcast<f32>(hits[i].x)!=depth){break;}}
  if(before==0&&filled>0){start=depth;}if(before>0&&filled==0){let a=max(start,-500.);let b=min(depth,500.);if(b>a){intervals[base+written]=vec2f(a,b);written++;}}
 }
 if(filled!=0||ambiguous!=0u){atomicAdd(&metrics[2],1u);}headers[ray]=vec2u(base,written|select(0u,0x80000000u,filled!=0||ambiguous!=0u));atomicAdd(&metrics[0],written);
}
`;

const coverageShader=`
struct Config{size:vec4u,domain:vec4f,heights:vec4f};
@group(0) @binding(0) var<storage,read> headers:array<vec2u>;
@group(0) @binding(1) var<storage,read> intervals:array<vec2f>;
@group(0) @binding(2) var image:texture_storage_2d<rgba8unorm,write>;
@group(0) @binding(3) var<uniform> cfg:Config;
fn contains(ray:u32,depth:f32)->f32{let r=headers[ray];if((r.y&0x80000000u)!=0u){return -1.;}var lo=0u;var hi=r.y;while(lo<hi){let mid=(lo+hi)/2u;if(intervals[r.x+mid].x<=depth){lo=mid+1u;}else{hi=mid;}}if(lo==0u){return 0.;}return select(0.,1.,depth<intervals[r.x+lo-1u].y);}
@compute @workgroup_size(8,8) fn reconstruct(@builtin(global_invocation_id) id:vec3u){if(id.x>=cfg.size.x||id.y>=cfg.size.y){return;}
 let x=cfg.domain.x+(f32(id.x)+.5)*cfg.domain.z;let z=cfg.domain.y+(f32(id.y)+.5)*cfg.domain.w;let layer=cfg.size.w;
 let a=contains(layer*cfg.size.y+id.y,x);let b=contains(cfg.size.z*cfg.size.y+layer*cfg.size.x+id.x,z);
 let valid=u32(a>=0.)+u32(b>=0.);let coverage=(max(a,0.)+max(b,0.))/f32(max(valid,1u));textureStore(image,vec2i(id.xy),vec4f(1,1,1,coverage));}
`;

// Compare exact interval bits, not hashes: repeated sections share one path build.
const layerShader=`
@group(0) @binding(0) var<storage,read> headers:array<vec2u>;
@group(0) @binding(1) var<storage,read> intervals:array<vec2u>;
@group(0) @binding(2) var<storage,read_write> changed:array<atomic<u32>>;
@group(0) @binding(3) var<uniform> size:vec4u;
@compute @workgroup_size(64) fn compare(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){
 let i=id.x+id.y*groups.x*64u;let columns=size.x+size.y;if(i>=columns*size.z){return;}let layer=i/columns;let col=i%columns;if(layer==0u){atomicStore(&changed[0],1u);return;}
 var at=layer*size.y+col;var previous=at-size.y;if(col>=size.y){at=size.z*size.y+layer*size.x+col-size.y;previous=at-size.x;}
 let a=headers[at];let b=headers[previous];if(a.y!=b.y){atomicStore(&changed[layer],1u);return;}
 for(var j=0u;j<(a.y&0x7fffffffu);j++){if(any(intervals[a.x+j]!=intervals[b.x+j])){atomicStore(&changed[layer],1u);return;}}
}`;
const previewPackShader=`
@group(0) @binding(0) var<storage,read> source:array<vec4f>;
@group(0) @binding(1) var<storage,read_write> output:array<vec4f>;
@group(0) @binding(2) var<storage,read_write> layers:array<u32>;
@group(0) @binding(3) var<uniform> cfg:vec4u;
@compute @workgroup_size(64) fn pack(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){let i=id.x+id.y*groups.x*64u;if(i>=cfg.x*cfg.w){return;}let at=cfg.y+i;let src=(i%cfg.x)*2u;output[at*2u]=source[src];output[at*2u+1u]=source[src+1u];layers[at]=cfg.z+i/cfg.x;}
`;

// Pick the same compact segments as the viewport, with one bounded depth readback.
// Project the oval bead cross-section onto a camera-facing, butt-ended strip.
// The same extent is used by drawing and navigation, including affine printer frames.
const beadShader=`
fn beadLocalSupport(tangent:vec3f,delta:vec2f,position:vec3f,rotation:mat4x4f,matrix:mat4x4f,scale:f32,pan:vec2f,ortho:bool,width:f32,height:f32)->vec3f{
 var eye=vec3f(0,0,1);if(!ortho){eye=-vec3f(position.xy+pan,position.z);}
 let transverse=cross(tangent,eye);let side=transverse*inverseSqrt(max(dot(transverse,transverse),1e-20));
 let local=transpose(mat3x3f(matrix[0].xyz,matrix[1].xyz,matrix[2].xyz))*(transpose(mat3x3f(rotation[0].xyz,rotation[1].xyz,rotation[2].xyz))*side)*scale;
 let horizontal=vec2f(-delta.y,delta.x)*inverseSqrt(max(dot(delta,delta),1e-20));let extent=vec2f(dot(local.xz,horizontal)*width,local.y*height);
 // Use the actual ellipse support point, including its depth. A screen-plane
 // offset has the right apparent width but can exceed the physical layer height.
 return vec3f(horizontal.x*width*extent.x,height*extent.y,horizontal.y*width*extent.x)/(2.*max(length(extent),1e-20));
}
fn beadViewOffset(local:vec3f,rotation:mat4x4f,matrix:mat4x4f,scale:f32)->vec3f{return (rotation*vec4f((matrix*vec4f(local,0)).xyz*scale,0)).xyz;}
fn beadOffset(a:vec3f,b:vec3f,delta:vec2f,rotation:mat4x4f,matrix:mat4x4f,scale:f32,pan:vec2f,ortho:bool,width:f32,height:f32)->vec3f{return beadViewOffset(beadLocalSupport(b-a,delta,(a+b)*.5,rotation,matrix,scale,pan,ortho,width,height),rotation,matrix,scale);}
fn beadJoin(previous:vec3f,position:vec3f,next:vec3f,incoming:vec2f,outgoing:vec2f,rotation:mat4x4f,matrix:mat4x4f,scale:f32,pan:vec2f,ortho:bool,width:f32,height:f32)->vec3f{
 let a=beadLocalSupport(position-previous,incoming,position,rotation,matrix,scale,pan,ortho,width,height);let b=beadLocalSupport(next-position,outgoing,position,rotation,matrix,scale,pan,ortho,width,height);
 let n=vec2f(-incoming.y,incoming.x)*inverseSqrt(max(dot(incoming,incoming),1e-20));let m=vec2f(-outgoing.y,outgoing.x)*inverseSqrt(max(dot(outgoing,outgoing),1e-20));let cosine=dot(n,m);let denominator=1.-cosine*cosine;var joined=(a.xz+b.xz)*.5;
 if(denominator>1e-5){let first=dot(a.xz,n);let second=dot(b.xz,m);joined=(n*(first-cosine*second)+m*(second-cosine*first))/denominator;let limit=2.*max(length(a.xz),length(b.xz));joined*=min(1.,limit/max(length(joined),1e-20));}
 return beadViewOffset(vec3f(joined.x,select(a.y,b.y,abs(b.y)>abs(a.y)),joined.y),rotation,matrix,scale);
}
// A changing neighbour can move a miter. Keep its influence within one bead
// width of the joint, so a long straight wall retains its own cross-section.
fn beadInset(delta:vec2f,width:f32)->f32{return min(.5,width/max(length(delta),1e-10));}
fn straightSupport(a:vec3f,b:vec3f,delta:vec2f,p:vec3f,rotation:mat4x4f,matrix:mat4x4f,scale:f32,pan:vec2f,ortho:bool,width:f32,height:f32)->vec3f{
 return beadViewOffset(beadLocalSupport(b-a,delta,p,rotation,matrix,scale,pan,ortho,width,height),rotation,matrix,scale);
}
fn beadTriangleDepth(eye:vec3f,direction:vec3f,a:vec3f,b:vec3f,c:vec3f)->f32{let first=b-a;let second=c-a;let p=cross(direction,second);let determinant=dot(first,p);if(abs(determinant)<1e-20){return 1e30;}let inverse=1./determinant;let relative=eye-a;let u=dot(relative,p)*inverse;let q=cross(relative,first);let v=dot(direction,q)*inverse;if(u<0.||v<0.||u+v>1.){return 1e30;}let depth=dot(second,q)*inverse;return select(1e30,depth,depth>0.);}
`;

const navigationShader=beadShader+`
struct Query{rotation:mat4x4f,centerScale:vec4f,viewport:vec4f,clip:vec4f,frame:vec4f,modes:vec4f,matrix:mat4x4f,pointer:vec4f,range:vec4u,heights:vec4f};
@group(0) @binding(0) var<storage,read> paths:array<vec4f>;
@group(0) @binding(1) var<storage,read> layers:array<u32>;
@group(0) @binding(2) var<uniform> query:Query;
@group(0) @binding(3) var<storage,read_write> hit:array<atomic<u32>>;
fn view(p:vec2f,layer:u32)->vec3f{let y=select(query.heights.x+(f32(layer)-.5)*query.heights.y,query.heights.x*.5,layer==0u);let world=(query.matrix*vec4f(p.x,y,p.y,1)).xyz;return (frameCameraRelative(query.rotation)*vec4f((world-query.centerScale.xyz)*query.centerScale.w,1)).xyz;}
fn screen(p:vec3f)->vec2f{let xy=p.xy+query.viewport.zw;var ndc=vec2f(xy.x*query.viewport.y/query.viewport.x,xy.y*query.viewport.y);if(query.range.w==0u){ndc=vec2f(xy.x*query.clip.w/query.viewport.x,xy.y*query.clip.w)/(-p.z);}return (ndc*vec2f(.5,-.5)+.5)*query.pointer.zw;}
@compute @workgroup_size(64) fn pick(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){let i=id.x+id.y*groups.x*64u;if(i>=query.range.z){return;}let layer=layers[i];if(layer+1u<query.range.x||layer+1u>query.range.y){return;}
 let segment=paths[i*2u];let a=view(segment.xy,layer);let b=view(segment.zw,layer);let za=-a.z;let zb=-b.z;let dz=zb-za;var low=0.;var high=1.;if(abs(dz)<1e-20){if(za<query.clip.x||za>query.clip.y){return;}}else{let near=(query.clip.x-za)/dz;let far=(query.clip.y-za)/dz;low=max(low,min(near,far));high=min(high,max(near,far));if(high<low){return;}}
 let first=mix(a,b,low);let last=mix(a,b,high);let sa=screen(first);let sb=screen(last);let delta=sb-sa;let t=clamp(dot(query.pointer.xy-sa,delta)/max(dot(delta,delta),1e-20),0.,1.);var u=t;if(query.range.w==0u){u=t*(-first.z)/max(1e-20,(1.-t)*(-last.z)+t*(-first.z));}let point=mix(first,last,u);
 var centres:array<vec3f,4>;var widths:array<vec3f,4>;var spans=1u;var offset=vec3f(0);var offsetA=vec3f(0);var offsetB=vec3f(0);var radius=8.;if(query.heights.w!=1.){let height=select(query.heights.y,query.heights.x,layer==0u);let record=bitcast<vec4u>(paths[i*2u+1u]);let base=i-record.x;let before=paths[(base+record.z)*2u].xy;let after=paths[(base+record.y)*2u].zw;offsetA=beadJoin(view(before,layer),a,b,segment.xy-before,segment.zw-segment.xy,query.rotation,query.matrix,query.centerScale.w,query.viewport.zw,query.range.w!=0u,query.heights.z,height);offsetB=beadJoin(a,b,view(after,layer),segment.zw-segment.xy,after-segment.zw,query.rotation,query.matrix,query.centerScale.w,query.viewport.zw,query.range.w!=0u,query.heights.z,height);let t=mix(low,high,u);offset=mix(offsetA,offsetB,t);
 if(query.heights.w==2.){
  let delta=segment.zw-segment.xy;let inset=beadInset(delta,query.heights.z);
  let left=mix(a,b,inset);let right=mix(a,b,1.-inset);
  let leftOffset=straightSupport(a,b,delta,left,query.rotation,query.matrix,query.centerScale.w,query.viewport.zw,query.range.w!=0u,query.heights.z,height);
  let rightOffset=straightSupport(a,b,delta,right,query.rotation,query.matrix,query.centerScale.w,query.viewport.zw,query.range.w!=0u,query.heights.z,height);
  if(t<inset){offset=mix(offsetA,leftOffset,t/inset);}else if(t>1.-inset){offset=mix(rightOffset,offsetB,(t+inset-1.)/inset);}else{offset=mix(leftOffset,rightOffset,(t-inset)/max(1.-2.*inset,1e-10));}
  centres=array<vec3f,4>(a,left,right,b);widths=array<vec3f,4>(offsetA,leftOffset,rightOffset,offsetB);spans=3u;
 }else{centres[0]=a;centres[1]=b;widths[0]=offsetA;widths[1]=offsetB;}let projected=screen(point+offset)-screen(point);radius=max(radius,length(projected));}if(distance(query.pointer.xy,sa+t*delta)>radius){return;}
 let cursor=query.pointer.xy/query.pointer.zw*vec2f(2,-2)+vec2f(-1,1);var eye=vec3f(-query.viewport.zw,0);var direction=vec3f(cursor.x*query.viewport.x/query.clip.w,cursor.y/query.clip.w,-1);if(query.range.w!=0u){eye=vec3f(cursor.x*query.viewport.x/query.viewport.y-query.viewport.z,cursor.y/query.viewport.y-query.viewport.w,-query.clip.x);direction=vec3f(0,0,-1);}
 var exactHit=true;var depth=dot(point-eye,direction)/dot(direction,direction);if(query.heights.w!=1.){var exact=1e30;
 for(var j=0u;j<spans;j++){let p=centres[j];let q=centres[j+1u];let m=widths[j];let n=widths[j+1u];exact=min(exact,min(beadTriangleDepth(eye,direction,p-m,p+m,q-n),beadTriangleDepth(eye,direction,q-n,p+m,q+n)));}exactHit=exact<1e29;if(exactHit){depth=exact;}else{let normal=cross(b-a,offset);let denominator=dot(direction,normal);if(abs(denominator)>1e-20){depth=dot(a-eye,normal)/denominator;}}}if(depth>0.){atomicMin(&hit[0],bitcast<u32>(depth)|select(0x80000000u,0u,exactHit));}
}`;

const previewShader=beadShader+`
struct Camera{rotation:mat4x4f,centerScale:vec4f,viewport:vec4f,clip:vec4f,frame:vec4f,modes:vec4f};
struct Frame{matrix:mat4x4f,inverse:mat4x4f,color:vec4f,settings:vec4f};
struct Config{size:vec4u,domain:vec4f,heights:vec4f};
@group(0) @binding(0) var<uniform> camera:Camera;
@group(1) @binding(0) var<uniform> frame:Frame;
@group(2) @binding(0) var image:texture_2d<f32>;
@group(2) @binding(1) var<uniform> cfg:Config;
@group(2) @binding(2) var<storage,read> paths:array<vec4f>;
@group(2) @binding(3) var<storage,read> layers:array<u32>;
@group(2) @binding(4) var<uniform> drawRange:vec4u;
override orthographic:bool=false;
struct Output{@builtin(position) position:vec4f,@location(0) color:vec3f,@location(1) uv:vec2f};
fn cameraPoint(local:vec3f)->vec3f{return (frameCameraRelative(camera.rotation)*vec4f(((frame.matrix*vec4f(local,1)).xyz-camera.centerScale.xyz)*camera.centerScale.w,1)).xyz;}
fn projectView(p:vec3f,color:vec3f,uv:vec2f)->Output{
 let xy=p.xy+camera.viewport.zw;let depth=-p.z;var out:Output;out.color=color;out.uv=uv;
 if(orthographic){out.position=vec4f(xy.x*camera.viewport.y/camera.viewport.x,xy.y*camera.viewport.y,(depth-camera.clip.x)/(camera.clip.y-camera.clip.x),1);}
 else{out.position=vec4f(xy.x*camera.clip.w/camera.viewport.x,xy.y*camera.clip.w,(camera.clip.y*depth-camera.clip.x*camera.clip.y)/(camera.clip.y-camera.clip.x),depth);}return out;
}
fn project(local:vec3f,color:vec3f,uv:vec2f)->Output{return projectView(cameraPoint(local),color,uv);}
fn pathPoint(p:vec2f,i:u32,color:vec3f)->Output{let y=select(cfg.heights.x+(f32(i)-.5)*cfg.heights.y,cfg.heights.x*.5,i==0u);var out=project(vec3f(p.x,y,p.y),color,vec2f(0));if(f32(i+1u)<cfg.heights.z||f32(i+1u)>cfg.heights.w){out.position=vec4f(2,2,2,1);}return out;}
@vertex fn perimeter(@builtin(vertex_index) vertex:u32)->Output{let s=paths[(vertex/2u)*2u];return pathPoint(select(s.xy,s.zw,vertex%2u!=0u),layers[vertex/2u],vec3f(1));}
@vertex fn bead(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->Output{
 let upward=(camera.rotation*vec4f((frame.matrix*vec4f(0,1,0,0)).xyz,0)).z>0.;let index=select(drawRange.x+instance,drawRange.y-1u-instance,upward);
 let s=paths[index*2u];let layer=layers[index];let y=select(cfg.heights.x+(f32(layer)-.5)*cfg.heights.y,cfg.heights.x*.5,layer==0u);let height=select(cfg.heights.y,cfg.heights.x,layer==0u);
 let record=bitcast<vec4u>(paths[index*2u+1u]);let base=index-record.x;let before=paths[(base+record.z)*2u].xy;let after=paths[(base+record.y)*2u].zw;let station=vertex/2u;let detailed=drawRange.z!=0u;
 let end=station==select(1u,3u,detailed);let interior=detailed&&(station==1u||station==2u);
 let delta=s.zw-s.xy;let inset=beadInset(delta,frame.settings.y);
 let a=cameraPoint(vec3f(s.x,y,s.y));let b=cameraPoint(vec3f(s.z,y,s.w));
 let previous=select(before,s.xy,end);let position=select(s.xy,s.zw,end);let next=select(s.zw,after,end);
 var p=select(a,b,end);if(interior){p=mix(a,b,select(inset,1.-inset,station==2u));}
 let tangent=b-a;
 let support=straightSupport(a,b,delta,p,camera.rotation,frame.matrix,camera.centerScale.w,camera.viewport.zw,orthographic,frame.settings.y,height);
 var offset=support;if(!interior){offset=beadJoin(cameraPoint(vec3f(previous.x,y,previous.y)),p,cameraPoint(vec3f(next.x,y,next.y)),position-previous,next-position,camera.rotation,frame.matrix,camera.centerScale.w,camera.viewport.zw,orthographic,frame.settings.y,height);}
 let side=select(-1.,1.,(vertex&1u)!=0u);
 let localStep=beadViewOffset(vec3f(0,height,0),camera.rotation,frame.matrix,camera.centerScale.w);
 // Project both supports on the same screen normal; their ratio is in bead half-widths.
 let eye=select(p.xy+camera.viewport.zw,vec2f(0),orthographic);
 let depth=max(-p.z,camera.clip.x);
 let screenTangent=tangent.xy+eye*(tangent.z/depth);
 let normal=vec2f(-screenTangent.y,screenTangent.x)*inverseSqrt(max(dot(screenTangent,screenTangent),1e-30));
 let width=dot(normal,support.xy+eye*(support.z/depth));
 let joinedWidth=dot(normal,offset.xy+eye*(offset.z/depth));
 let plane=cross(tangent,offset);
 let upperNear=dot(plane,localStep)*dot(plane,vec3f(-eye,depth))>0.;
 var spacing=3.;
 if(abs(width)>1e-12&&select(f32(layer+1u)>cfg.heights.z,f32(layer+1u)<cfg.heights.w,upperNear)){
  spacing=clamp(dot(normal,localStep.xy+eye*(localStep.z/depth))/width*select(-1.,1.,upperNear),-2.,2.);
 }
 let u=side*select(1.,clamp(joinedWidth/width,-4.,4.),abs(width)>1e-12);
 return projectView(p+offset*side,vec3f(1),vec2f(spacing,u));
}
@vertex fn control(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->Output{let corners=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));var out=pathPoint(paths[instance*2u].xy,layers[instance],vec3f(.35,.8,1));out.position=vec4f(out.position.xy+corners[vertex]*3./camera.frame.xy*out.position.w,out.position.zw);return out;}
@vertex fn map(@builtin(vertex_index) vertex:u32)->Output{let corners=array<vec2f,6>(vec2f(0,0),vec2f(1,0),vec2f(0,1),vec2f(0,1),vec2f(1,0),vec2f(1,1));let uv=corners[vertex];let xz=cfg.domain.xy+uv*cfg.domain.zw*vec2f(cfg.size.xy);let i=cfg.size.w;let y=select(cfg.heights.x+(f32(i)-.5)*cfg.heights.y,cfg.heights.x*.5,i==0u);return project(vec3f(xz.x,y,xz.y),vec3f(1),uv);}
@fragment fn fs(input:Output)->@location(0) vec4f{return vec4f(input.color,1);}
// Integral of the smooth transverse rim, extended with its endpoint shade.
fn rimIntegral(u:f32)->f32{
 let x=abs(u);let t=clamp((x-.4)/.6,0.,1.);
 return sign(u)*(.6*t*t*t*(1.-.5*t)+max(0.,x-1.));
}
fn repeatedRimIntegral(x:f32,period:f32)->f32{
 let cycles=floor(x/period);
 return cycles*(rimIntegral(period-1.)+.3)+rimIntegral(x-cycles*period-1.)+.3;
}
@fragment fn beadColor(input:Output)->@location(0) vec4f{
 let u=input.uv.y;let halfPixel=max(.001,.5*fwidth(u));
 let single=(rimIntegral(u+halfPixel)-rimIntegral(u-halfPixel))/(2.*halfPixel);
 // Overlapping layers expose just the outer part of each bead. Integrate
 // that band over the pixel; visible interiors and end layers use their own profile.
 let period=clamp(abs(input.uv.x),.01,2.);let x=1.+select(-u,u,input.uv.x>=0.);
 let visibleBand=(repeatedRimIntegral(x+halfPixel,period)-repeatedRimIntegral(x-halfPixel,period))/(2.*halfPixel);
 let mean=(rimIntegral(period-1.)+.3)/period;
 let repeated=mix(mean,visibleBand,smoothstep(1.,2.,period/(2.*halfPixel)));
 let edge=clamp(select(mix(repeated,single,smoothstep(period,period+halfPixel,x)),single,abs(input.uv.x)>2.),0.,1.);return vec4f(mix(vec3f(.50,.54,.55),vec3f(.10,.13,.14),edge),1);}
@fragment fn coverage(input:Output)->@location(0) vec4f{let size=textureDimensions(image);let p=clamp(vec2i(input.uv*vec2f(size)),vec2i(0),vec2i(size)-1);let color=textureLoad(image,p,0);if(color.a==0.){discard;}return color;}
`;

async function createPreview(context,slicer){
 const d=context.device,module=await checkedModule(d,'Printer layer preview',context.viewport.cameraWGSL+previewShader);
 const uniformLayout=()=>d.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:'uniform'}}]}),cameraLayout=uniformLayout(),frameLayout=uniformLayout();
 const imageLayout=d.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'unfilterable-float'}},{binding:1,visibility:GPUShaderStage.VERTEX,buffer:{type:'uniform'}},{binding:2,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}},{binding:3,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}},{binding:4,visibility:GPUShaderStage.VERTEX,buffer:{type:'uniform'}}]});
 const pipeline=(entryPoint,orthographic)=>d.createRenderPipelineAsync({label:'Printer '+entryPoint,layout:d.createPipelineLayout({bindGroupLayouts:[cameraLayout,frameLayout,imageLayout]}),vertex:{module,entryPoint,constants:{orthographic}},fragment:{module,entryPoint:entryPoint==='map'?'coverage':entryPoint==='bead'?'beadColor':'fs',targets:[{format:navigator.gpu.getPreferredCanvasFormat(),...entryPoint==='bead'?{}:{blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}}]},primitive:{topology:entryPoint==='bead'?'triangle-strip':entryPoint==='perimeter'?'line-list':'triangle-list'},depthStencil:{format:'depth24plus',depthWriteEnabled:entryPoint==='bead',depthCompare:'less-equal'}});
 const [lines,points,beads]=await Promise.all(['perimeter','control','bead'].map(entry=>Promise.all([false,true].map(o=>pipeline(entry,o)))));
 const groups=new WeakMap(),group=(buffer,layout)=>{let cache=groups.get(buffer);if(!cache)groups.set(buffer,cache=new Map());if(!cache.has(layout))cache.set(layout,d.createBindGroup({layout,entries:[{binding:0,resource:{buffer}}]}));return cache.get(layout);};
 return ({pass,camera,frame,orthographic,hash,params})=>{
  const job=slicer.jobs.get(hash);if(!job||job.state!=='complete')return;if(job.result&&!slicer.matches(job))slicer.invalidate(job);if(!job.result)return;
  slicer.reconstruct(job,Math.round(params['Finish layer']),params);slicer.ensurePreview(job,params);const r=job.result,v=r.preview;
  if(!v?.segments||v.error)return;
  if(!v.group){v.drawRange=d.createBuffer({label:'Printer preview draw range',size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});v.resources.push(v.drawRange);v.bytes+=16;v.group=d.createBindGroup({layout:imageLayout,entries:[{binding:0,resource:r.image.createView()},{binding:1,resource:{buffer:r.config}},{binding:2,resource:{buffer:v.output}},{binding:3,resource:{buffer:v.layers}},{binding:4,resource:{buffer:v.drawRange}}]});}
  const first=v.ranges.find(a=>a.last>=r.previewStart),last=v.ranges.findLast(a=>a.first<=r.previewLayer);if(!first||!last)return;
  const offset=first.offset+Math.max(0,r.previewStart-first.first)*first.count,end=last.offset+(Math.min(r.previewLayer,last.last)-last.first+1)*last.count,n=Math.max(0,end-offset);if(!n)return;
  if(v.firstDraw!==offset||v.endDraw!==end){d.queue.writeBuffer(v.drawRange,0,new Uint32Array([offset,end,r.sections.length>1?1:0,0]));v.firstDraw=offset;v.endDraw=end;}
  pass.setBindGroup(0,group(camera,cameraLayout));pass.setBindGroup(1,group(frame,frameLayout));pass.setBindGroup(2,v.group);
  if(slicer.polyline(hash)){pass.setPipeline(lines[orthographic?1:0]);pass.draw(n*2,1,offset*2);pass.setPipeline(points[orthographic?1:0]);pass.draw(6,n,0,offset);}
  else{pass.setPipeline(beads[orthographic?1:0]);pass.draw(r.sections.length>1?8:4,n);}
 };
}

class LDISlicer{
 constructor(context){this.context=context;this.jobs=new Map();this.initialized=new Map();this.polylineModes=new Map();this.serial=0;this.pipelines=new WeakMap();this.navigationQueue=Promise.resolve();this.navigationSerial=0;}
 polyline(hash){return this.polylineModes.get(hash)===true;}
 setPolyline(hash,enabled=!this.polyline(hash)){this.polylineModes.set(hash,enabled);this.navigationSerial++;this.context.requestAttributes();this.context.requestDraw();return {polyline:enabled};}
 capture(hash){return this.context.scene.capture(hash,KEYS,{bounds:BUILD_BOUNDS,includeHidden:true});}
 signature(hash,includeHidden=true){try{return this.context.scene.signature(hash,KEYS,{includeHidden,bounds:BUILD_BOUNDS});}catch{return null;}}
 matches(job){const signature=this.signature(job.hash);return signature!==null&&signature===job.signature;}
 config(snapshot){const p=snapshot.params,width=p['Line width'],height=p['Layer height'],initial=p['Initial layer height'];if(!(width>=.1&&width<=100&&height>=.1&&height<=100&&initial>=.1&&initial<=100))throw failure('INVALID_ARGUMENT','Invalid printer width or layer heights.');return {width,height,initial};}
 disposeResult(result){if(!result)return;result.retired=true;for(const b of result.preview?.resources||[])b.destroy();for(const b of result.previewBuild?.resources||[])b.destroy();for(const b of result.paths?.resources||[])b.destroy();for(const b of result.resources||[])b.destroy();}
 retire(hash){const job=this.jobs.get(hash);if(job){cancelAnimationFrame(job.progressFrame);job.cancelled=true;this.disposeResult(job.result);this.jobs.delete(hash);}this.initialized.delete(hash);this.polylineModes.delete(hash);}
 check(job){if(job.stale)throw failure('STALE_JOB','Source geometry changed. Run Slice again.');if(job.cancelled)throw failure('CANCELLED','Slicing cancelled.');if(!this.matches(job))throw failure('STALE_JOB','Source geometry, visibility, printer or sampling settings changed.');}
 invalidate(job){if(job.stale)return;job.stale=true;job.state='stale';job.stage='stale';job.completed=0;job.total=0;job.error={code:'STALE_JOB',message:'Source geometry changed. Run Slice again.'};cancelAnimationFrame(job.progressFrame);job.progressFrame=0;this.disposeResult(job.result);job.result=null;this.navigationSerial++;this.context.requestAttributes();this.context.requestDraw();}
 sync(){for(const job of this.jobs.values())if(['running','complete'].includes(job.state)&&!this.matches(job))this.invalidate(job);}
 start(hash,args={}){
  const snapshot=this.capture(hash),options=this.config(snapshot),previous=this.jobs.get(hash),initialized=this.initialized.get(hash);if(previous?.state==='running')throw failure('BUSY','This printer is already slicing.');this.disposeResult(previous?.result);
  const job={id:++this.serial,hash,scene:snapshot.scene,signature:snapshot.signature,options,firstSuccess:initialized?.scene!==snapshot.scene,followFinish:initialized?.scene!==snapshot.scene||snapshot.params['Finish layer']===initialized.lastLayer,authoredFinish:snapshot.params['Finish layer'],state:'running',stage:'bounds',completed:0,total:0,started:performance.now(),cancelled:false,result:null};this.jobs.set(hash,job);
  this.run(job,snapshot).catch(e=>{job.state=e.code==='CANCELLED'?'cancelled':e.code==='STALE_JOB'?'stale':'failed';job.stage=job.state;job.error={code:e.code||'SLICE_FAILED',message:e.message};job.completed=0;job.total=0;}).finally(()=>{cancelAnimationFrame(job.progressFrame);job.progressFrame=0;job.ms=performance.now()-job.started;if(this.jobs.get(hash)===job){this.context.requestAttributes();this.context.requestDraw();}});this.context.requestAttributes();return this.status(hash);
 }
 empty(job){job.state='empty';job.stage='empty';job.completed=0;job.total=0;this.initialized.delete(job.hash);this.context.update(job.hash,{'Start layer':1,'Finish layer':1});}
 progress(job,completed,total=job.total){if(job.state!=='running')return;job.completed=completed;job.total=total;if(!job.progressFrame)job.progressFrame=requestAnimationFrame(()=>{job.progressFrame=0;if(this.jobs.get(job.hash)===job&&job.state==='running')this.context.requestAttributes();});}
 navigation(x,y){if(![...this.jobs.values()].some(job=>job.state==='complete'&&job.result?.preview?.segments&&this.context.viewport.isVisible(job.hash)))return null;const request=++this.navigationSerial,run=()=>request===this.navigationSerial?this.pickNavigation(x,y,request):null;return this.navigationQueue=this.navigationQueue.catch(()=>null).then(run);}
 async pickNavigation(x,y,request){const context=this.context,d=context.device;await context.requestDraw();if(request!==this.navigationSerial||context.device!==d)return null;const view=context.editor.view(),{rect}=view;if(x<rect.left||y<rect.top||x>rect.left+rect.width||y>rect.top+rect.height)return null;
  const pipeline=(await this.kernels(d)).navigation;if(request!==this.navigationSerial||context.device!==d)return null;const jobs=[...this.jobs.values()].filter(job=>job.state==='complete'&&job.result?.preview?.segments&&!job.result.retired&&context.viewport.isVisible(job.hash)&&this.matches(job));if(!jobs.length)return null;const records=[],uniform=d.createBuffer({label:'Printer navigation query',size:256,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),out=d.createBuffer({label:'Printer navigation winner',size:16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST}),read=d.createBuffer({label:'Printer navigation depth',size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  try{d.queue.writeBuffer(out,0,new Uint32Array([0xffffffff,0,0,0]));for(const job of jobs){const r=job.result,v=r.preview,data=new Float32Array(64),world=Array.from(context.document.world(job.hash));data.set(view.camera);data.set(world,36);data.set([x-rect.left,y-rect.top,rect.width,rect.height],52);new Uint32Array(data.buffer).set([r.previewStart,r.previewLayer,v.segments,view.index?1:0],56);data.set([job.options.initial,job.options.height,job.options.width,this.polyline(job.hash)?1:r.sections.length>1?2:0],60);d.queue.writeBuffer(uniform,0,data);const group=d.createBindGroup({layout:pipeline.layout,entries:[v.output,v.layers,uniform,out].map((buffer,binding)=>({binding,resource:{buffer}}))});this.dispatch(d,pipeline.pick,group,v.segments,64);records.push({job,r,v,world,first:r.previewStart,last:r.previewLayer,polyline:this.polyline(job.hash)});}
   const copy=d.createCommandEncoder();copy.copyBufferToBuffer(out,0,read,0,16);d.queue.submit([copy.finish()]);await read.mapAsync(GPUMapMode.READ);const bits=new Uint32Array(read.getMappedRange())[0],depth=new Float32Array(new Uint32Array([bits&0x7fffffff]).buffer)[0];read.unmap();if(request!==this.navigationSerial||context.device!==d||!Number.isFinite(depth)||depth<=0)return null;const current=context.editor.view();if(current.instance!==view.instance||current.rect.left!==rect.left||current.rect.top!==rect.top||current.rect.width!==rect.width||current.rect.height!==rect.height||current.camera.some((v,i)=>v!==view.camera[i]))return null;
   for(const {job,r,v,world,first,last,polyline}of records){const n=context.document.nodes.find(n=>n.nativeHash===job.hash);if(!n||job.result!==r||r.retired||r.preview!==v||r.previewStart!==first||r.previewLayer!==last||this.polyline(job.hash)!==polyline||!context.viewport.isVisible(job.hash)||!this.matches(job))return null;const finish=Math.max(1,Math.min(r.lastLayer,Math.round(n.params['Finish layer']))),start=Math.max(1,Math.min(finish,Math.round(n.params['Start layer']))),currentWorld=context.document.world(job.hash);if(start!==first||finish!==last||world.some((v,i)=>v!==currentWorld[i]))return null;}return {depth};
  }finally{if(read.mapState==='mapped')read.unmap();uniform.destroy();out.destroy();read.destroy();}
 }
 summary(r,polyline){const retained=r.retainedGPUBytes+(r.paths?.bytes||0)+(r.preview?.bytes||0),visibleSegments=r.preview?.ranges.reduce((n,s)=>n+Math.max(0,Math.min(s.last,r.previewLayer)-Math.max(s.first,r.previewStart)+1)*s.count,0)||0;
  return {sourceOccurrences:r.sourceOccurrences,representation:'orthogonal-ldi',topology:'shell-overlap-union-nested-parity-occurrence-union',axes:['X','Z'],builds:1,lastLayer:r.lastLayer,grid:r.grid,rawEvents:r.rawEvents,intervals:r.intervals,ambiguousRays:r.ambiguousRays,duplicateEvents:r.duplicateEvents,peakGPUBytes:Math.max(r.peakGPUBytes,r.previewPeakGPUBytes||0,retained),retainedGPUBytes:retained,metadataReadBytes:r.metadataReadBytes,triangleVisits:r.triangleVisits,timings:r.timings,
   preview:{mode:polyline?'polyline':'rectangles',primitive:polyline?'line-list':'triangle-strip',points:polyline,state:r.previewBuild?'running':r.preview?.error?'failed':r.preview?'complete':'idle',error:r.preview?.error||null,startLayer:r.previewStart,finishLayer:r.previewLayer,visibleLayers:Math.max(0,r.previewLayer-r.previewStart+1),segments:visibleSegments,retainedLayers:r.preview?r.lastLayer:0,sections:r.sections.length,completedSections:r.previewBuild?.completed??r.preview?.builds??0,builds:r.preview?.builds||0,metadataReadBytes:r.layerReadBytes+(r.preview?.metadataReadBytes||0),ms:r.preview?.ms||0,reconstructions:r.reconstructions,reconstructSubmitMs:r.reconstructSubmitMs||0},
   perimeters:r.paths?{state:r.paths.error?'failed':r.paths.pending?'running':'complete',error:r.paths.error||null,layer:r.previewLayer,count:r.paths.count,mode:'section-perimeter',firstOffset:0,spacing:0,maxDeviation:r.paths.deviation,samplingPitch:r.grid.pitch,sourceAccuracyCertified:false,segments:r.paths.counters?.[4]??null,rawSegments:r.paths.counters?.[1]??null,loops:r.paths.counters?.[3]??null,openLoops:r.paths.counters?.[6]??null,collapsedLoops:r.paths.counters?.[9]??null,capacity:r.paths.capacity,builds:r.pathBuilds,fieldBuilds:r.fieldBuilds,graphBuilds:r.graphBuilds,metadataReadBytes:r.pathBuilds*48,ms:r.paths.ms||0,retainedLayers:r.preview?r.lastLayer:1}:null};}
 status(hash){const job=this.jobs.get(hash);if(!job)return {state:'idle',polyline:this.polyline(hash),result:null};if(['running','complete'].includes(job.state)&&!this.matches(job))this.invalidate(job);return {id:job.id,state:job.state,polyline:this.polyline(hash),stage:job.stage,completed:job.completed,total:job.total,ms:job.ms??performance.now()-job.started,error:job.error||null,result:job.result?this.summary(job.result,this.polyline(hash)):null};}
 cancel(hash){const job=this.jobs.get(hash);if(job&&job.state==='running')job.cancelled=true;return this.status(hash);}
 attributes(hash){const s=this.status(hash),last=s.state==='empty'?1:s.total||s.result?.lastLayer||this.initialized.get(hash)?.lastLayer||3332;return {hiddenFields:['Perimeters'],actions:[{id:'slice',label:'Slice',cancel:'cancel',progressAlign:'left',busy:s.state==='running',progress:s.state==='running'?s.completed+' / '+(s.total||'\u2026'):''},{id:'polyline',label:'Polyline',active:this.polyline(hash),placement:'bottom'}],ranges:{'Start layer':{min:1,max:last,scrubRange:()=>[1,last]},'Finish layer':{min:1,max:last,scrubRange:()=>[1,last]},'Layer position':{min:0,max:s.result?last:0},'Max deviation':{min:.0001,max:10,scrubRange:()=>[.001,.1]}},units:{'Max deviation':'mm'}};}
 async kernels(d){let p=this.pipelines.get(d);if(!p){p=(async()=>{
  const compute=async(label,code,names,entries)=>{const module=await checkedModule(d,label,code),layout=d.createBindGroupLayout({entries}),plan=d.createPipelineLayout({bindGroupLayouts:[layout]}),result={layout};await Promise.all(names.map(async entryPoint=>result[entryPoint]=await d.createComputePipelineAsync({label:label+' '+entryPoint,layout:plan,compute:{module,entryPoint}})));return result;};
  const buffer=(binding,type='storage')=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type}});
  const source=texture=>compute('LDI source',sourceShader(texture),['bounds','count','emit','shellInit','shellJoin','shellCompress'],[0,1].map(binding=>texture?{binding,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:'uint',viewDimension:'2d-array'}}:buffer(binding,'read-only-storage')).concat([buffer(2,'uniform'),buffer(3),buffer(4,'read-only-storage'),buffer(5),buffer(6),buffer(7),buffer(8)]));
  const [native,paged,scan,clean,coverage]=await Promise.all([source(false),source(true),compute('LDI prefix',scanShader,['scan','add'],[buffer(0,'read-only-storage'),buffer(1),buffer(2),buffer(3,'uniform'),buffer(4)]),compute('LDI sort and union',cleanShader,['clean'],[buffer(0,'read-only-storage'),buffer(1,'read-only-storage'),buffer(2,'read-only-storage'),buffer(3),buffer(4),buffer(5),buffer(6,'uniform'),buffer(7)]),compute('LDI layer reconstruction',coverageShader,['reconstruct'],[buffer(0,'read-only-storage'),buffer(1,'read-only-storage'),{binding:2,visibility:GPUShaderStage.COMPUTE,storageTexture:{access:'write-only',format:'rgba8unorm'}},buffer(3,'uniform')])]);
  const paths=await compute('Printer section perimeters',pathShader,['seed','seedSparse','connect','label','simplify','emit','neighbours','remap','finish','prepare','unmark'],[buffer(0,'read-only-storage'),buffer(1,'read-only-storage'),buffer(2),buffer(3),buffer(5),buffer(6),buffer(7,'uniform'),buffer(8)]);
  const [layers,pack,navigation]=await Promise.all([compute('Printer identical layers',layerShader,['compare'],[buffer(0,'read-only-storage'),buffer(1,'read-only-storage'),buffer(2),buffer(3,'uniform')]),compute('Printer all-layer compact preview',previewPackShader,['pack'],[buffer(0,'read-only-storage'),buffer(1),buffer(2),buffer(3,'uniform')]),compute('Printer polyline navigation',this.context.viewport.cameraWGSL+navigationShader,['pick'],[buffer(0,'read-only-storage'),buffer(1,'read-only-storage'),buffer(2,'uniform'),buffer(3)])]);return {native,paged,scan,clean,coverage,paths,layers,pack,navigation};
 })();this.pipelines.set(d,p);}return p;}
 dispatch(d,pipeline,bind,n,workgroup=128){if(!n)return;const e=d.createCommandEncoder(),pass=e.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,bind);const blocks=Math.ceil(n/workgroup),x=Math.min(blocks,d.limits.maxComputeWorkgroupsPerDimension);pass.dispatchWorkgroups(x,Math.ceil(blocks/x));pass.end();d.queue.submit([e.finish()]);}
 reconstruct(job,layer,params){const r=job.result;if(!r)return;layer=Math.max(1,Math.min(r.lastLayer,layer));params??=this.capture(job.hash).params;const count=1,deviation=Math.max(.0001,Math.min(10,params['Max deviation'])),first=Math.max(1,Math.min(layer,Math.round(params['Start layer'])));const changed=r.previewLayer!==layer;
  if(changed||r.previewStart!==first){const start=performance.now(),d=this.context.device,data=new ArrayBuffer(48);new Uint32Array(data).set([r.grid.width,r.grid.depth,r.lastLayer,layer-1]);new Float32Array(data).set([...r.grid.min,...r.grid.pitch,job.options.initial,job.options.height,first,layer],4);d.queue.writeBuffer(r.config,0,data);r.previewStart=first;
   if(changed){
   const e=d.createCommandEncoder(),p=e.beginComputePass();p.setPipeline(r.coveragePipeline);p.setBindGroup(0,r.coverageGroup);p.dispatchWorkgroups(Math.ceil(r.grid.width/8),Math.ceil(r.grid.depth/8));p.end();d.queue.submit([e.finish()]);r.previewLayer=layer;r.reconstructions++;r.reconstructSubmitMs=performance.now()-start;
   }
  }
  if(changed||r.paths?.count!==count||r.paths?.deviation!==deviation)this.buildPaths(job,count,deviation,changed);
 }
 ensurePreview(job,params){const r=job.result;if(!r||r.retired)return Promise.resolve();const count=1,deviation=Math.max(.0001,Math.min(10,params['Max deviation'])),key=pathKey(params);
  if(r.previewBuild)return r.previewBuild.done;if(r.preview?.key===key)return Promise.resolve();
  this.progress(job,0);const build=r.previewBuild={key,completed:0,total:r.sections.length,resources:new Set()};build.done=this.buildPreview(job,r,build,count,deviation).then(preview=>{try{this.check(job);if(job.result!==r||r.retired)throw failure('STALE_JOB','Preview owner was retired.');}catch(error){for(const b of preview.resources)b.destroy();throw error;}for(const b of r.preview?.resources||[])b.destroy();r.preview=preview;}).finally(()=>{if(r.previewBuild===build)r.previewBuild=null;this.context.requestDraw();});build.done.catch(()=>{});return build.done;
 }
 async waitPreview(job,params){const r=job.result;do{await this.ensurePreview(job,params);this.check(job);if(job.result!==r||r.retired)throw failure('STALE_JOB','Preview owner was retired.');}while(r.preview?.key!==pathKey(params));}
 async buildPreview(job,r,build,count,deviation){const d=this.context.device,resources=build.resources,retained=new Set(),ranges=[],started=performance.now();let total=0,builds=0;
  const check=()=>{this.check(job);if(job.result!==r||r.retired)throw failure('STALE_JOB','Preview owner was retired.');};
  const make=(size,usage,label)=>{if(size>d.limits.maxStorageBufferBindingSize)throw failure('PATH_MEMORY_LIMIT','All-layer preview exceeds the GPU binding limit.');const b=d.createBuffer({size:Math.max(16,size),usage,label});resources.add(b);return b;};
  const peak=()=>{r.previewPeakGPUBytes=Math.max(r.previewPeakGPUBytes||0,r.retainedGPUBytes+(r.paths?.bytes||0)+(r.preview?.bytes||0)+[...resources].reduce((n,b)=>n+b.size,0));};
  // One field/graph is reused serially; only compact paths survive each section.
  const scratch={grid:r.grid,lastLayer:r.lastLayer,headers:r.headers,intervalBuffer:r.intervalBuffer,pathKernels:r.pathKernels,previewScratch:true},worker={...job,result:scratch};
  try{
   for(const section of r.sections){check();scratch.previewLayer=section.first;this.buildPaths(worker,count,deviation,true);for(const b of scratch.paths.resources)resources.add(b);peak();await scratch.paths.done;check();builds++;
    if(scratch.paths.error)throw failure(scratch.paths.error.code,scratch.paths.error.message);const n=scratch.paths.counters[4],layers=section.last-section.first+1;if(total+n*layers>MAX_PREVIEW_SEGMENTS)throw failure('PATH_CAPACITY','All-layer preview exceeds '+MAX_PREVIEW_SEGMENTS+' compact segments.');
    let source=null;if(n){source=make(n*32,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,'Printer compact section');const e=d.createCommandEncoder();e.copyBufferToBuffer(scratch.paths.output,0,source,0,n*32);d.queue.submit([e.finish()]);}
    ranges.push({...section,count:n,offset:total,source});total+=n*layers;build.completed=builds;this.progress(job,section.last);peak();
   }
   check();const output=make(total*32,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC,'Printer all-layer paths'),layers=make(total*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,'Printer path layer indices'),configs=make(Math.max(1,ranges.length)*256,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,'Printer compact section placement'),data=new Uint32Array(Math.max(1,ranges.length)*64),e=d.createCommandEncoder();
   ranges.forEach((section,i)=>data.set([section.count,section.offset,section.first-1,section.last-section.first+1],i*64));d.queue.writeBuffer(configs,0,data);
   for(let i=0;i<ranges.length;i++){const section=ranges[i];if(!section.count)continue;const group=d.createBindGroup({layout:r.packKernels.layout,entries:[{binding:0,resource:{buffer:section.source}},{binding:1,resource:{buffer:output}},{binding:2,resource:{buffer:layers}},{binding:3,resource:{buffer:configs,offset:i*256,size:16}}]}),pass=e.beginComputePass();pass.setPipeline(r.packKernels.pack);pass.setBindGroup(0,group);const blocks=Math.ceil(section.count*(section.last-section.first+1)/64),x=Math.min(blocks,d.limits.maxComputeWorkgroupsPerDimension);pass.dispatchWorkgroups(x,Math.ceil(blocks/x));pass.end();}
   d.queue.submit([e.finish()]);peak();await d.queue.onSubmittedWorkDone();check();retained.add(output);retained.add(layers);return {key:build.key,output,layers,resources:[output,layers],ranges:ranges.map(({source,...section})=>section),segments:total,bytes:output.size+layers.size,builds,metadataReadBytes:builds*48,ms:performance.now()-started};
  }catch(error){if(['CANCELLED','STALE_JOB'].includes(error.code))throw error;return {key:build.key,error:{code:error.code||'PATH_FAILED',message:error.message},segments:0,resources:[],ranges:[],bytes:0,builds,metadataReadBytes:builds*48,ms:performance.now()-started};
  }finally{for(const b of resources)if(!retained.has(b))b.destroy();resources.clear();}
 }
 buildPaths(job,count,deviation,fieldChanged){
  const r=job.result,d=this.context.device,start=performance.now(),g=r.grid,cells=(g.width+1)*(g.depth+1),capacity=Math.min(262144,Math.max(1024,cells*4));
  let v=r.paths;if(!v){const resources=[],make=(size,usage,label)=>{if(size>d.limits.maxStorageBufferBindingSize)throw failure('PATH_MEMORY_LIMIT','Perimeter scratch exceeds the GPU binding limit.');const b=d.createBuffer({size:Math.max(16,size),usage,label});resources.push(b);return b;},storage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST;
   v=r.paths={resources,capacity,
    tree:make(cells*4,storage,'Perimeter boundary cells'),geometry:make(capacity*32,storage,'Perimeter source boundary'),
    output:make(capacity*32,storage,'Perimeter compact output'),nodes:make(capacity*32,storage,'Perimeter linked vertices'),
    links:make(capacity*5*4,storage,'Perimeter loop labels'),dispatch:make(16,GPUBufferUsage.INDIRECT|GPUBufferUsage.COPY_DST,'Perimeter bounded work dispatch'),
    stats:make(96,storage,'Perimeter counters'),configs:[0,1].map(()=>make(80,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,'Perimeter pass config'))};
   const groups=geometry=>v.configs.map(config=>{
    const entries=[r.headers,r.intervalBuffer,v.tree,geometry,null,v.nodes,v.stats,config,v.links].flatMap((buffer,binding)=>buffer?[{binding,resource:{buffer}}]:[]);
    return d.createBindGroup({layout:r.pathKernels.layout,entries});
   });
   v.groups=groups(v.geometry);v.outputGroups=groups(v.output);v.bytes=resources.reduce((n,b)=>n+b.size,0);
  }
  v.count=count;v.width=job.options.width;v.deviation=deviation;v.error=null;v.pending=true;v.counters=null;const revision=v.revision=(v.revision||0)+1;
  const data=new ArrayBuffer(80),words=new Uint32Array(data);
  words.set([g.width,g.depth,r.previewLayer-1,r.lastLayer]);new Float32Array(data).set([...g.min,...g.pitch,job.options.width,deviation],4);words.set([count,capacity],12);
  for(let i=0;i<v.configs.length;i++){words[16]=i*2;d.queue.writeBuffer(v.configs[i],0,data);}
  const encoder=d.createCommandEncoder();
  const run=(entry,groups,config,direct)=>{
   const pass=encoder.beginComputePass();pass.setPipeline(r.pathKernels[entry]);pass.setBindGroup(0,groups[config]);
   if(direct===undefined){pass.dispatchWorkgroupsIndirect(v.dispatch,0);}
   else{const blocks=Math.ceil(direct/64),x=Math.min(blocks,d.limits.maxComputeWorkgroupsPerDimension);pass.dispatchWorkgroups(x,Math.ceil(blocks/x));}
   pass.end();
  };
  const rounds=Math.ceil(Math.log2(capacity))+1,ping=rounds%2;
  if(fieldChanged){
   encoder.clearBuffer(v.stats);encoder.clearBuffer(v.tree);
   run(r.previewScratch?'seedSparse':'seed',v.groups,0,r.previewScratch?g.width+g.depth:cells);
   run('prepare',v.groups,0,1);encoder.copyBufferToBuffer(v.stats,80,v.dispatch,0,12);
   run('connect',v.groups,0);for(let i=0;i<rounds;i++)run('label',v.groups,i%2);
   r.fieldBuilds=(r.fieldBuilds||0)+1;r.graphBuilds=(r.graphBuilds||0)+1;
  }else{
   encoder.clearBuffer(v.stats,12,16);encoder.clearBuffer(v.stats,32,16);encoder.clearBuffer(v.stats,48,32);
   run('unmark',v.groups,0);
  }
  run('simplify',v.groups,ping);run('emit',v.outputGroups,ping);run('neighbours',v.outputGroups,ping);run('remap',v.outputGroups,ping);run('finish',v.groups,0,1);
  r.pathBuilds=(r.pathBuilds||0)+1;
  const read=d.createBuffer({label:'Printer perimeter metadata',size:48,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});encoder.copyBufferToBuffer(v.stats,0,read,0,48);d.queue.submit([encoder.finish()]);v.done=(async()=>{try{await read.mapAsync(GPUMapMode.READ);const counters=Array.from(new Uint32Array(read.getMappedRange()));read.unmap();if(job.result!==r||v.revision!==revision)return;v.counters=counters;if(fieldChanged)v.sourceSegments=counters[0];v.ms=performance.now()-start;if(counters[7])v.error={code:'PATH_CAPACITY',message:'Perimeter segment capacity exceeded.'};else if(counters[6])v.error={code:'PATH_TOPOLOGY',message:'An open or oversized perimeter was rejected.'};v.pending=false;}finally{read.destroy();}})().catch(error=>{if(job.result===r&&v.revision===revision){v.error={code:'PATH_FAILED',message:error.message};v.pending=false;}});
 }
 async run(job,snapshot){
  if(snapshot.meshes.length>256)throw failure('OWNER_LIMIT','LDI supports at most 256 evaluated solid occurrences.');
  const d=snapshot.device,owned=new Set(),options=job.options;let live=0,peak=0,metadataReadBytes=0;
  const make=(size,usage,label)=>{if(size>d.limits.maxBufferSize||(usage&GPUBufferUsage.STORAGE)&&size>d.limits.maxStorageBufferBindingSize)throw failure('LDI_MEMORY_LIMIT','LDI exceeds the bounded GPU binding.');const b=d.createBuffer({size:Math.max(16,size),usage,label});owned.add(b);live+=b.size;peak=Math.max(peak,live);return b;};
  const free=b=>{if(owned.delete(b)){live-=b.size;b.destroy();}};
  const storage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC;
  const group=(layout,items)=>d.createBindGroup({layout,entries:items.map((resource,binding)=>({binding,resource:resource instanceof GPUBuffer?{buffer:resource}:resource}))});
  const read=async(buffer,bytes,ldi=true)=>{const b=make(bytes,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ,'LDI small metadata readback');try{const e=d.createCommandEncoder();e.copyBufferToBuffer(buffer,0,b,0,bytes);d.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);const data=b.getMappedRange().slice(0,bytes);b.unmap();if(ldi)metadataReadBytes+=bytes;this.check(job);return data;}finally{free(b);}};
  try{
   const t=performance.now(),p=await this.kernels(d);this.check(job);const timings={compileMs:performance.now()-t};
   const metrics=make(32,storage,'LDI counters'),uniform=make(128,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,'LDI source transform'),placeholders=Array.from({length:5},(_,i)=>make(16,storage,'LDI placeholder '+i));
   const shellOffsets=new Map();let shellWords=0;for(const mesh of snapshot.meshes){shellOffsets.set(mesh,shellWords);shellWords+=mesh.vertexCount;}
   let grid={width:1,depth:1,min:[0,0],pitch:[1,1]},last=1,counts=placeholders[0],offsets=placeholders[1],cursors=placeholders[2],events=placeholders[3],planes=placeholders[4];
   const sourcePass=entry=>{for(const mesh of snapshot.meshes){this.check(job);if(!mesh.triangleCount)continue;const tiled=entry==='count'||entry==='emit',lanes=tiled?sourceLanes(mesh.triangleCount):1;for(let layer=0;layer<(tiled?last:1);layer+=LAYER_BATCH){const data=new ArrayBuffer(128);new Float32Array(data).set(mesh.matrix);new Uint32Array(data).set([mesh.triangleCount,grid.width,grid.depth,last],16);new Float32Array(data).set([...grid.min,...grid.pitch,options.initial,options.height,mesh.solid,lanes],20);new Uint32Array(data).set([mesh.vertexCount,shellOffsets.get(mesh),shellWords,layer],28);d.queue.writeBuffer(uniform,0,data);const k=mesh.storage==='texture'?p.paged:p.native;this.dispatch(d,k[entry],group(k.layout,[mesh.storage==='texture'?mesh.positions.view:mesh.positions,mesh.storage==='texture'?mesh.indices.view:mesh.indices,uniform,counts,offsets,cursors,events,metrics,planes]),entry==='shellInit'||entry==='shellCompress'?mesh.vertexCount:mesh.triangleCount*lanes);}}};
   d.queue.writeBuffer(metrics,0,new Uint32Array([0xffffffff,0xffffffff,0xffffffff,0,0,0,0,0]));let started=performance.now();sourcePass('bounds');const rawBounds=new Uint32Array(await read(metrics,24));
   const unordered=v=>{const a=new Uint32Array([v&0x80000000?v^0x80000000:~v]);return new Float32Array(a.buffer)[0];},lo=Array.from(rawBounds.slice(0,3),unordered),hi=Array.from(rawBounds.slice(3),unordered);timings.boundsMs=performance.now()-started;
   if(!snapshot.meshes.length||!lo.every(Number.isFinite)||!hi.every(Number.isFinite)||hi[0]<=-500||lo[0]>=500||hi[2]<=-500||lo[2]>=500||hi[1]<layerY(0,options)){this.empty(job);return;}
   last=0;while(last<MAX_LAYERS&&layerY(last,options)<Math.min(hi[1],1000))last++;if(last===MAX_LAYERS&&layerY(last,options)<Math.min(hi[1],1000))throw failure('LAYER_LIMIT','LDI exceeds 4096 layers.');if(!last){this.empty(job);return;}
   this.progress(job,0,last);const min=[Math.max(-500,lo[0]),Math.max(-500,lo[2])],max=[Math.min(500,hi[0]),Math.min(500,hi[2])],span=max.map((v,i)=>v-min[i]);if(span.some(v=>!(v>0))){this.empty(job);return;}
   // Sampling is explicit and bounded; no full-resolution voxel volume exists.
   const target=options.width*.2;let nx=Math.min(2048,Math.max(1,Math.ceil(span[0]/target))),nz=Math.min(2048,Math.max(1,Math.ceil(span[1]/target)));const maxColumns=Math.floor(MAX_RAYS/last);if(nx+nz>maxColumns){const factor=maxColumns/(nx+nz);nx=Math.max(1,Math.floor(nx*factor));nz=Math.max(1,Math.floor(nz*factor));}
   grid={width:nx,depth:nz,min,pitch:[span[0]/nx,span[1]/nz],targetPitch:target,resolutionLimited:span[0]/nx>target*1.001||span[1]/nz>target*1.001};const rays=(nx+nz)*last;job.stage='ldi-count';
   counts=make(rays*4,storage,'LDI raw ray counts');offsets=make(rays*4,storage,'LDI raw ray offsets');d.queue.writeBuffer(metrics,0,new Uint32Array(8));started=performance.now();sourcePass('count');
   const scan=async(input,output,n,root=true)=>{const blocks=Math.ceil(n/256),sums=make(blocks*4,storage,'LDI scan block sums'),config=make(16,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,'LDI scan config');d.queue.writeBuffer(config,0,new Uint32Array([n,root?1:0,0,0]));this.dispatch(d,p.scan.scan,group(p.scan.layout,[input,output,sums,config,metrics]),n,256);if(blocks>1){const prefix=make(blocks*4,storage,'LDI scan block offsets');await scan(sums,prefix,blocks,false);this.dispatch(d,p.scan.add,group(p.scan.layout,[prefix,output,sums,config,metrics]),n,256);free(prefix);}free(sums);free(config);};
   await scan(counts,offsets,rays);const totals=new Uint32Array(await read(metrics,16)),rawEvents=totals[0];timings.countMs=performance.now()-started;
   if(!rawEvents){this.empty(job);return;}if(rawEvents>Math.min(MAX_EVENTS,Math.floor(d.limits.maxStorageBufferBindingSize/8)))throw failure('LDI_EVENT_LIMIT','LDI depth events exceed the bounded GPU allocation.');if(totals[1]>MAX_HITS)throw failure('LDI_RAY_LIMIT','A ray exceeds 1024 depth events; split the source geometry.');
   job.stage='ldi-emit';started=performance.now();cursors=make(rays*4,storage,'LDI emit cursors');events=make(rawEvents*8,storage,'LDI raw depth and occurrence events');planes=make((shellWords+rawEvents*4)*4,storage,'LDI shell roots and crossing planes');sourcePass('shellInit');sourcePass('shellJoin');sourcePass('shellCompress');sourcePass('emit');await d.queue.onSubmittedWorkDone();this.check(job);timings.emitMs=performance.now()-started;free(cursors);for(const b of placeholders)free(b);
   const headers=make(rays*8,storage,'Clean X and Z LDI ray headers'),intervalBuffer=make(Math.floor(rawEvents/2)*8,storage,'Clean X and Z union depth intervals'),cleanConfig=make(16,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,'LDI clean config');d.queue.writeBuffer(cleanConfig,0,new Uint32Array([rays,shellWords,0,0]));d.queue.writeBuffer(metrics,0,new Uint32Array(8));job.stage='ldi-clean';started=performance.now();const cleanGroup=group(p.clean.layout,[counts,offsets,events,headers,intervalBuffer,metrics,cleanConfig,planes]);d.queue.writeBuffer(cleanConfig,0,new Uint32Array([rays,shellWords,1,0]));this.dispatch(d,p.clean.clean,cleanGroup,rays*128);d.queue.writeBuffer(cleanConfig,0,new Uint32Array([rays,shellWords,0,0]));d.queue.writeBuffer(metrics,0,new Uint32Array(8));this.dispatch(d,p.clean.clean,cleanGroup,rays*128);const cleaned=new Uint32Array(await read(metrics,16));timings.cleanMs=performance.now()-started;free(counts);free(offsets);free(events);free(planes);free(cleanConfig);
   const changed=make(last*4,storage,'Printer distinct layer flags'),layerConfig=make(16,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,'Printer layer comparison');d.queue.writeBuffer(layerConfig,0,new Uint32Array([nx,nz,last,0]));this.dispatch(d,p.layers.compare,group(p.layers.layout,[headers,intervalBuffer,changed,layerConfig]),rays,64);const flags=new Uint32Array(await read(changed,last*4,false)),sections=[];for(let i=0;i<last;i++){if(i===0||flags[i])sections.push({first:i+1,last:i+1});else sections.at(-1).last=i+1;}free(changed);free(layerConfig);
   const image=d.createTexture({label:'Finish layer LDI coverage',size:[nx,nz],format:'rgba8unorm',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC});owned.add(image);live+=nx*nz*4;peak=Math.max(peak,live);const config=make(48,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,'LDI selected layer');
   await this.preparePreview();this.check(job);const resources=[headers,intervalBuffer,image,config],firstSuccess=job.firstSuccess;
   const r={resources,headers,intervalBuffer,image,config,grid,sourceOccurrences:snapshot.meshes.length,lastLayer:last,sections,layerReadBytes:last*4,rawEvents,intervals:cleaned[0],ambiguousRays:cleaned[2],duplicateEvents:cleaned[3],triangleVisits:snapshot.meshes.reduce((n,m)=>n+m.triangleCount*(2+2*Math.ceil(last/LAYER_BATCH)*sourceLanes(m.triangleCount)),0),metadataReadBytes,peakGPUBytes:peak,retainedGPUBytes:rays*8+intervalBuffer.size+nx*nz*4+config.size,timings,reconstructions:0,previewLayer:0,previewStart:1,pathKernels:p.paths,packKernels:p.pack,coveragePipeline:p.coverage.reconstruct};r.coverageGroup=group(p.coverage.layout,[headers,intervalBuffer,image.createView(),config]);job.result=r;job.stage='perimeters';
   let params,finish,first;while(true){params=this.capture(job.hash).params;await this.waitPreview(job,params);if(r.preview.key!==pathKey(this.capture(job.hash).params))continue;
    params=this.capture(job.hash).params;finish=firstSuccess||job.followFinish&&params['Finish layer']===job.authoredFinish?last:Math.max(1,Math.min(last,Math.round(params['Finish layer'])));first=firstSuccess?1:Math.max(1,Math.min(finish,Math.round(params['Start layer'])));this.reconstruct(job,finish,{...params,'Start layer':first});await r.paths.done;await d.queue.onSubmittedWorkDone();this.check(job);
    const latest=this.capture(job.hash).params,nextFinish=firstSuccess||job.followFinish&&latest['Finish layer']===job.authoredFinish?last:Math.max(1,Math.min(last,Math.round(latest['Finish layer']))),nextFirst=firstSuccess?1:Math.max(1,Math.min(nextFinish,Math.round(latest['Start layer'])));if(r.preview.key===pathKey(latest)&&finish===nextFinish&&first===nextFirst)break;
   }
   this.context.update(job.hash,{'Finish layer':finish,'Start layer':first});
   this.initialized.set(job.hash,{scene:snapshot.scene,lastLayer:last});for(const b of resources)owned.delete(b);if(!r.preview.error)job.completed=last;job.state='complete';job.stage='complete';
  }finally{if(job.state!=='complete'){this.disposeResult(job.result);job.result=null;}for(const b of owned)b.destroy();}
 }
 async inspectCoverage(job,args){const r=job.result,d=this.context.device,total=r.grid.width*r.grid.depth,offset=args.offset||0,count=Math.min(args.count||64,total-offset);if(offset>=total)throw failure('INVALID_ARGUMENT','Pixel offset is outside the coverage map.');if(args.layer!==undefined&&args.layer!==r.previewLayer)throw failure('INVALID_ARGUMENT','Coverage inspection reads the displayed Finish layer.');
  const read=d.createBuffer({size:count*256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{const e=d.createCommandEncoder();for(let i=0;i<count;i++){const pixel=offset+i;e.copyTextureToBuffer({texture:r.image,origin:[pixel%r.grid.width,Math.floor(pixel/r.grid.width)]},{buffer:read,offset:i*256,bytesPerRow:256},[1,1]);}d.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);const bytes=new Uint8Array(read.getMappedRange()),coverage=Array.from({length:count},(_,i)=>bytes[i*256+3]/255);read.unmap();this.check(job);return {index:r.previewLayer,width:r.grid.width,height:r.grid.depth,offset,coverage};}finally{read.destroy();}
 }
 async inspectPreviewPaths(job,args){const r=job.result,params=this.capture(job.hash).params;this.reconstruct(job,Math.round(params['Finish layer']),params);await this.waitPreview(job,params);const v=r.preview,layer=args.layer;if(!v)throw failure('STALE_JOB','Preview was replaced.');if(v.error)throw failure(v.error.code,v.error.message);if(layer<r.previewStart||layer>r.previewLayer)throw failure('INVALID_ARGUMENT','Path inspection requires a displayed layer.');const section=v.ranges.find(s=>s.first<=layer&&s.last>=layer),total=section.count,offset=args.offset||0,count=Math.min(args.count||64,Math.max(0,total-offset));if(offset>total)throw failure('INVALID_ARGUMENT','Path offset is outside the generated paths.');const d=this.context.device,read=d.createBuffer({size:Math.max(32,count*32),usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  try{if(count){const e=d.createCommandEncoder();e.copyBufferToBuffer(v.output,(section.offset+(layer-section.first)*total+offset)*32,read,0,count*32);d.queue.submit([e.finish()]);}await read.mapAsync(GPUMapMode.READ);const f=new Float32Array(read.getMappedRange()),u=new Uint32Array(f.buffer),y=layerY(layer-1,job.options),segments=Array.from({length:count},(_,i)=>{const at=i*8;return {a:[f[at],y,f[at+1]],b:[f[at+2],y,f[at+3]],id:u[at+4],next:u[at+5],perimeter:1,loop:u[at+7]};});read.unmap();this.check(job);if(r.preview!==v)throw failure('STALE_JOB','Preview changed during inspection.');return {index:layer,offset,total,raw:false,boundary:false,segments};}finally{read.destroy();}
 }
 async inspectPaths(job,args){if(args.layer!==undefined&&!args.raw&&!args.boundary)return this.inspectPreviewPaths(job,args);const r=job.result;this.reconstruct(job,Math.round(this.capture(job.hash).params['Finish layer']));if(args.layer!==undefined&&args.layer!==r.previewLayer)throw failure('INVALID_ARGUMENT','Raw path inspection reads the Finish layer.');const v=r.paths,revision=v.revision;await v.done;this.check(job);if(v.error&&!args.raw&&!args.boundary)throw failure(v.error.code,v.error.message);const raw=args.raw===true,boundary=args.boundary===true,stride=boundary?16:32,total=boundary?Math.min(v.sourceSegments,v.capacity*2):raw?Math.min(v.counters[2],v.capacity):v.counters[4],offset=args.offset||0,count=Math.min(args.count||64,Math.max(0,total-offset));if(offset>total)throw failure('INVALID_ARGUMENT','Path offset is outside the generated paths.');const d=this.context.device,read=d.createBuffer({size:Math.max(32,count*stride),usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  try{if(count){const e=d.createCommandEncoder();e.copyBufferToBuffer(boundary?v.geometry:raw?v.nodes:v.output,offset*stride,read,0,count*stride);d.queue.submit([e.finish()]);}await read.mapAsync(GPUMapMode.READ);const f=new Float32Array(read.getMappedRange()),u=new Uint32Array(f.buffer),segments=[];for(let i=0;i<count;i++){const at=i*stride/4;if(raw&&u[at+6]===0xffffffff)continue;segments.push({a:[f[at],layerY(r.previewLayer-1,job.options),f[at+1]],b:[f[at+2],layerY(r.previewLayer-1,job.options),f[at+3]],id:raw||boundary?offset+i:u[at+4],next:boundary?null:raw?u[at+7]:u[at+5],perimeter:boundary?0:raw?u[at+6]+1:1,loop:raw||boundary?null:u[at+7]});}read.unmap();this.check(job);if(r.paths!==v||v.revision!==revision)throw failure('STALE_JOB','Perimeters changed during inspection.');return {index:r.previewLayer,offset,total,raw,boundary,segments};}finally{read.destroy();}
 }
 async inspect(hash,args){if((args.raw||args.boundary)&&!args.paths||args.paths&&args.coverage||args.raw&&args.boundary||args.paths&&args.axis)throw failure('INVALID_ARGUMENT','Choose either LDI, coverage, paths, raw paths or boundary inspection.');const status=this.status(hash),job=this.jobs.get(hash);if(!job?.result)return status;this.check(job);const r=job.result;if(args.paths){const paths=await this.inspectPaths(job,args);return {...this.status(hash),paths};}if(args.coverage)return {...status,image:await this.inspectCoverage(job,args)};const layer=args.layer??r.previewLayer;if(layer>r.lastLayer)throw failure('INVALID_ARGUMENT','Layer is outside the LDI.');
  const d=this.context.device,axis=args.axis||'X',columns=axis==='X'?r.grid.depth:r.grid.width,offset=args.offset||0,count=Math.min(args.count||64,columns-offset);if(offset>=columns)throw failure('INVALID_ARGUMENT','Ray offset is outside the LDI.');
  const ray=(axis==='X'?0:r.lastLayer*r.grid.depth)+(layer-1)*columns+offset,read=d.createBuffer({size:count*8,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  try{let e=d.createCommandEncoder();e.copyBufferToBuffer(r.headers,ray*8,read,0,count*8);d.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);const headers=new Uint32Array(read.getMappedRange().slice(0));read.unmap();const total=Array.from({length:count},(_,i)=>(headers[i*2+1]&0x7fffffff)).reduce((a,b)=>a+b,0);if(total>4096)throw failure('INSPECTION_LIMIT','Inspect at most 4096 intervals per request.');const data=d.createBuffer({size:Math.max(16,total*8),usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
   try{e=d.createCommandEncoder();let at=0;for(let i=0;i<count;i++){const n=(headers[i*2+1]&0x7fffffff);if(n)e.copyBufferToBuffer(r.intervalBuffer,headers[i*2]*8,data,at*8,n*8);at+=n;}d.queue.submit([e.finish()]);await data.mapAsync(GPUMapMode.READ);const values=Array.from(new Float32Array(data.getMappedRange()).slice(0,total*2));data.unmap();this.check(job);at=0;const rays=Array.from({length:count},(_,i)=>{const n=(headers[i*2+1]&0x7fffffff),intervals=Array.from({length:n},()=>{const a=values.slice(at,at+2);at+=2;return a;});return {column:offset+i,ambiguous:(headers[i*2+1]&0x80000000)!==0,position:r.grid.min[axis==='X'?1:0]+(offset+i+.5)*r.grid.pitch[axis==='X'?1:0],intervals};});return {...status,layer:{index:layer,y:layerY(layer-1,job.options),axis,columns,offset,rays}};}finally{data.destroy();}
  }finally{read.destroy();}
 }
  operations(){return [{id:'polyline',description:'Switch the temporary preview: enabled draws polylines; disabled draws camera-facing bead rectangles. Defaults to rectangles.',inputSchema:{type:'object',properties:{enabled:{type:'boolean'}},additionalProperties:false},readOnly:false,run:(hash,args)=>this.setPolyline(hash,args.enabled)},{id:'slice',description:'Build persistent GPU LDIs and compact perimeters for all layers; display the authored Start–Finish range.',inputSchema:emptySchema,readOnly:false,run:(hash,args)=>this.start(hash,args)},{id:'status',description:'Read LDI build, sampling, ambiguity, memory and preview diagnostics.',inputSchema:emptySchema,readOnly:true,run:hash=>this.status(hash)},{id:'cancel',description:'Cancel the slice build without partial publication.',inputSchema:emptySchema,readOnly:false,run:hash=>this.cancel(hash)},{id:'inspect',description:'Read bounded LDI intervals, Finish coverage/raw paths, or compact perimeters from any displayed layer.',inputSchema:{type:'object',properties:{layer:{type:'integer',minimum:1,maximum:MAX_LAYERS},axis:{type:'string',enum:['X','Z']},coverage:{type:'boolean'},paths:{type:'boolean'},raw:{type:'boolean'},boundary:{type:'boolean'},offset:{type:'integer',minimum:0,maximum:4194303},count:{type:'integer',minimum:1,maximum:256}},additionalProperties:false},readOnly:true,run:(hash,args)=>this.inspect(hash,args)}];}
}

export async function activate(context){
 if(context.version!==1)throw Error('Unsupported Frame plugin API');const slicer=new LDISlicer(context);let preview=null;
 let previewPending=null;slicer.preparePreview=()=>preview?.device===context.device?Promise.resolve():previewPending??=(async()=>{const device=context.device,draw=await createPreview(context,slicer);preview={device,draw};})().finally(()=>{previewPending=null;});
 context.operations.register(slicer.operations());context.attributes.register(hash=>slicer.attributes(hash));
 context.editor.register({navigation:(x,y)=>slicer.navigation(x,y),documentChanged:()=>slicer.sync(),frames:()=>slicer.sync()});
 const corners=[[-500,0,-500],[500,0,-500],[500,0,500],[-500,0,500],[-500,1000,-500],[500,1000,-500],[500,1000,500],[-500,1000,500]],edges=[];
 for(let i=0;i<4;i++)edges.push(...corners[i],...corners[(i+1)%4],...corners[i+4],...corners[(i+1)%4+4],...corners[i],...corners[i+4]);
 const boxColor=[.45,.62,.58,.65],selectedBoxColor=[.75,.65,.43,.65];
 slicer.preparePreview().then(()=>context.requestDraw());
 await context.viewport.register({renderStage:'opaque',renderKind:'overlay',surfaceWarningBlend:true,pivot:[-500,0,-500],bounds:{min:[-500,0,-500],max:[500,1000,500]},surfaceSelection:'last-active',lines:new Float32Array(edges),axisLines:[0,2,9],color:boxColor,selectedColor:selectedBoxColor,settings:params=>[Math.sin(Math.max(0,Math.min(90,params['Overhang angle']))*Math.PI/180),params['Line width'],0,0],retire:hash=>slicer.retire(hash),render:state=>{if(preview?.device!==state.device){slicer.preparePreview().then(()=>context.requestDraw());return;}preview.draw(state);},shader:`fn pluginSurface(local:vec3f,normal:vec3f,build:vec3f,settings:vec4f)->vec4f{
  if(local.y<=0.001||local.y>1000.||abs(local.x)>500.||abs(local.z)>500.){discard;}
  if(-dot(normal,build)<=settings.x+0.000001){discard;}return vec4f(1.,.12,.12,.3);
 }`});
}
