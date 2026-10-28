// Persistent orthogonal layered depth images. Geometry never leaves the GPU.
const KEYS=['Line width','Layer height','Initial layer height'];
const LAYER_BATCH=64,MAX_LAYERS=4096,MAX_RAYS=4194304,MAX_EVENTS=16777216,MAX_HITS=1024;
const sourceLanes=count=>Math.min(256,2**Math.ceil(Math.log2(Math.max(1,4096/Math.max(1,count)))));
const failure=(code,message)=>Object.assign(Error(message),{code});
const emptySchema={type:'object',properties:{},additionalProperties:false};
const layerY=(i,o)=>i?o.initial+(i-.5)*o.height:o.initial*.5;
const checkedModule=async(d,label,code)=>{const module=d.createShaderModule({label,code}),info=await module.getCompilationInfo(),errors=info.messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(m=>m.message).join('; '));return module;};

// One bounded, reusable distance field for the requested layer, not a voxel volume.
// The occupancy pyramid prunes exact segment-distance queries; no JFA error is added.
const pathShader=`
struct Config{size:vec4u,domain:vec4f,physical:vec4f,limits:vec4u,stage:vec4u,levels:array<vec4u,13>};
struct Node{ends:vec4f,edges:vec2u,ring:u32,next:u32};
@group(0) @binding(0) var<storage,read> headers:array<vec2u>;
@group(0) @binding(1) var<storage,read> intervals:array<vec2f>;
@group(0) @binding(2) var<storage,read_write> tree:array<u32>;
@group(0) @binding(3) var<storage,read_write> geometry:array<vec4f>;
@group(0) @binding(4) var<storage,read_write> field:array<f32>;
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
 let sourceBase=atomicAdd(&stats[0],n);if(sourceBase+n>cfg.limits.y*2u){atomicStore(&stats[7],1u);return;}tree[c.y*(cfg.size.x+1u)+c.x]=(sourceBase+1u)*2u+u32(n==4u);
 for(var k=0u;k<n;k+=2u){let ea=edges[k];let eb=edges[k+1u];let a=crossing(c,ea);let b=crossing(c,eb);let at=sourceBase+k;geometry[at]=vec4f(a,b);geometry[at+1u]=vec4f(b,b);
   // Recover a resolved polygon corner from neighbouring exact LDI crossings.
   // Smooth curvature remains piecewise linear and is simplified within tolerance.
   if(n==2u){let u=tangent(c,ea,a);let w=tangent(c,eb,b);let det=cross2(u,w);if(abs(det)>.05*length(u)*length(w)&&length(u)>0.&&length(w)>0.){let q=a+u*(cross2(b-a,w)/det);let low=point(c);let high=point(c+1u);if(all(q>=low-cfg.domain.zw)&&all(q<=high+cfg.domain.zw)){geometry[at]=vec4f(a,q);geometry[at+1u]=vec4f(q,b);}}}
 }
}
@compute @workgroup_size(64) fn seed(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){let i=linear(id,groups);let w=cfg.size.x+1u;if(i>=w*(cfg.size.y+1u)){return;}let c=vec2u(i%w,i/w);march(c,vec4f(occupancy(c),occupancy(c+vec2u(1,0)),occupancy(c+1u),occupancy(c+vec2u(0,1))));}
@compute @workgroup_size(64) fn reduce(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){let i=linear(id,groups);let level=cfg.stage.x;let p=cfg.levels[level];let q=cfg.levels[level-1u];if(i>=p.x*p.y){return;}let c=vec2u(i%p.x,i/p.x)*2u;var v=0u;for(var y=0u;y<2u;y++){for(var x=0u;x<2u;x++){let a=c+vec2u(x,y);if(all(a<q.xy)){v|=tree[q.z+a.y*q.x+a.x];}}}tree[p.z+i]=v;}
fn nearestBound(p:vec2f,bound:f32)->vec4f{var best=bound;var closest=p;var stack:array<vec3u,40>;var top=1u;stack[0]=vec3u(0,0,cfg.limits.z-1u);
 loop{if(top==0u){break;}top--;let node=stack[top];let level=cfg.levels[node.z];if(tree[level.z+node.y*level.x+node.x]==0u){continue;}let low=point(node.xy*level.w)-cfg.domain.zw;let high=point(min((node.xy+1u)*level.w,vec2u(cfg.size.x+1u,cfg.size.y+1u)))+cfg.domain.zw;if(length(max(max(low-p,p-high),vec2f(0)))>=best){continue;}
  if(node.z==0u){let record=tree[node.y*level.x+node.x];let at=record/2u-1u;let count=2u+(record%2u)*2u;for(var j=0u;j<count;j++){let a=geometry[at+j].xy;let b=geometry[at+j].zw;let v=b-a;let q=mix(a,b,clamp(dot(p-a,v)/max(dot(v,v),1e-30),0.,1.));let d=length(p-q);if(d<best){best=d;closest=q;}}}
  else{let child=cfg.levels[node.z-1u];let near=vec2u(p>=(low+high)*.5);for(var k=0u;k<4u;k++){let a=node.xy*2u+(vec2u(k%2u,k/2u)^near^vec2u(1));if(all(a<child.xy)){stack[top]=vec3u(a,node.z-1u);top++;}}}
 }return vec4f(closest,best,0);
}

fn nearest(p:vec2f)->vec4f{return nearestBound(p,cfg.physical.x*(f32(cfg.limits.x)+.5)+length(cfg.domain.zw));}
@compute @workgroup_size(64) fn distance(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){let i=linear(id,groups);let w=cfg.size.x+2u;if(i>=w*(cfg.size.y+2u)){return;}let c=vec2u(i%w,i/w);let p=point(c);if(occupancy(c)<0.){field[i]=-nearestBound(p,cfg.physical.x+length(cfg.domain.zw)*2.).z;return;}field[i]=nearest(p).z;
}
fn refined(p:vec2f,q:vec2f,first:f32,last:f32,iso:f32)->vec2f{var t=clamp((iso-first)/(last-first),0.,1.);if(first>0.&&last>0.){var lo=0.;var hi=1.;for(var i=0u;i<8u;i++){let x=mix(p,q,t);let n=nearest(x);let error=n.z-iso;if(abs(error)<=min(cfg.domain.z,cfg.domain.w)*.0001){break;}if((n.z>=iso)==(first>=iso)){lo=t;}else{hi=t;}let g=(x-n.xy)/max(n.z,1e-8);let slope=dot(g,q-p);var step=t-error/select(1e-8,slope,abs(slope)>1e-8);if(step<=lo||step>=hi){step=(lo+hi)*.5;}t=step;}}return mix(p,q,t);}
@compute @workgroup_size(64) fn offset(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){let i=linear(id,groups);let w=cfg.size.x+1u;if(i>=w*(cfg.size.y+1u)){return;}let c=vec2u(i%w,i/w);let stride=w+1u;let at=c.y*stride+c.x;let v=vec4f(field[at],field[at+1u],field[at+stride+1u],field[at+stride]);let lo=min(min(v.x,v.y),min(v.z,v.w));let hi=max(max(v.x,v.y),max(v.z,v.w));let first=u32(clamp(ceil(lo/cfg.physical.x-.5),0.,f32(cfg.limits.x)));let last=u32(clamp(floor(hi/cfg.physical.x-.5)+1.,0.,f32(cfg.limits.x)));
 // Each cell reserves its own bounded contiguous range.
 let count=(last-first)*2u;if(count==0u){return;}let base=atomicAdd(&stats[2],count);if(base+count>cfg.limits.y){atomicStore(&stats[7],1u);return;}links[i*2u]=base;links[i*2u+1u]=count;
 // Slots are deterministic per cell; unused slots have invalid ring identity.
 for(var k=0u;k<count;k++){nodes[base+k].ring=0xffffffffu;}
 for(var ring=first;ring<last;ring++){
  let iso=(f32(ring)+.5)*cfg.physical.x;let corners=array<vec2u,4>(c,c+vec2u(1,0),c+1u,c+vec2u(0,1));var edges:array<u32,4>;var n=0u;for(var e=0u;e<4u;e++){if((v[e]>=iso)!=(v[(e+1u)%4u]>=iso)){edges[n]=e;n++;}}if(n==4u){let f=v-iso;if(f.x*f.z-f.y*f.w<0.){edges=array<u32,4>(0,3,1,2);}}
  for(var k=0u;k<n;k+=2u){let ea=edges[k];let eb=edges[k+1u];let a=refined(point(corners[ea]),point(corners[(ea+1u)%4u]),v[ea],v[(ea+1u)%4u],iso);let b=refined(point(corners[eb]),point(corners[(eb+1u)%4u]),v[eb],v[(eb+1u)%4u],iso);let slot=base+(ring-first)*2u+k/2u;var ends=vec4f(a,b);var keys=vec2u(edgeKey(c,ea),edgeKey(c,eb));let midA=(point(corners[ea])+point(corners[(ea+1u)%4u]))*.5;let midB=(point(corners[eb])+point(corners[(eb+1u)%4u]))*.5;if((cross2(midB-midA,point(corners[ea])-midA)>0.)!=(v[ea]>=iso)){ends=ends.zwxy;keys=keys.yx;}nodes[slot]=Node(ends,keys,ring,0xffffffffu);atomicAdd(&stats[1],1u);
   if(n==2u){let na=nearest(ends.xy);let nb=nearest(ends.zw);let ga=ends.xy-na.xy;let gb=ends.zw-nb.xy;let u=vec2f(-ga.y,ga.x);let w=vec2f(-gb.y,gb.x);let det=cross2(u,w);if(abs(det)>.1*length(u)*length(w)&&length(u)>0.&&length(w)>0.){let corner=ends.xy+u*(cross2(ends.zw-ends.xy,w)/det);if(all(corner>=point(c)-cfg.domain.zw)&&all(corner<=point(c+1u)+cfg.domain.zw)&&abs(nearest(corner).z-iso)<min(cfg.physical.x*.0025,min(cfg.domain.z,cfg.domain.w)*.01)){let internal=(cfg.size.x+2u)*(cfg.size.y+2u)*2u+i;nodes[slot]=Node(vec4f(ends.xy,corner),vec2u(keys.x,internal),ring,slot+1u);nodes[slot+1u]=Node(vec4f(corner,ends.zw),vec2u(internal,keys.y),ring,0xffffffffu);atomicAdd(&stats[1],1u);}}}
}
 }
}
fn labelBase()->u32{return (cfg.size.x+1u)*(cfg.size.y+1u)*2u;}
@compute @workgroup_size(64) fn connect(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){let i=linear(id,groups);let total=min(atomicLoad(&stats[2]),cfg.limits.y);if(i>=total||nodes[i].ring==0xffffffffu){return;}let e=nodes[i].edges.y;let w=cfg.size.x+2u;let p=vec2u((e/2u)%w,(e/2u)/w);var cells:array<vec2u,2>;cells[0]=p;cells[1]=p;if(e%2u==0u){cells[1].y--;}else{cells[1].x--;}
 var next=nodes[i].next;if(next==0xffffffffu){for(var k=0u;k<2u;k++){let c=cells[k];if(c.x>cfg.size.x||c.y>cfg.size.y){continue;}let at=(c.y*(w-1u)+c.x)*2u;let start=links[at];let n=links[at+1u];for(var j=start;j<min(start+n,cfg.limits.y);j++){if(j!=i&&nodes[j].ring==nodes[i].ring&&nodes[j].edges.x==e){next=j;}}}}nodes[i].next=next;let at=labelBase()+i*5u;links[at]=next;links[at+1u]=i;links[at+4u]=0u;
}
@compute @workgroup_size(64) fn label(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){let i=linear(id,groups);if(i>=min(atomicLoad(&stats[2]),cfg.limits.y)||nodes[i].ring==0xffffffffu){return;}let a=labelBase()+i*5u;let src=cfg.stage.x;let dst=2u-src;let j=links[a+src];let r=links[a+src+1u];if(j==0xffffffffu){links[a+dst]=j;links[a+dst+1u]=r;return;}let b=labelBase()+j*5u;links[a+dst]=links[b+src];links[a+dst+1u]=min(r,links[b+src+1u]);}
fn keep(i:u32){links[labelBase()+i*5u+4u]|=1u;}
@compute @workgroup_size(64) fn simplify(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){let root=linear(id,groups);let total=min(atomicLoad(&stats[2]),cfg.limits.y);if(root>=total||nodes[root].ring==0xffffffffu||links[labelBase()+root*5u+cfg.stage.x+1u]!=root){return;}
 var cursor=nodes[root].next;var count=1u;var far=root;var maximum=0.;var area=0.;loop{if(cursor==root||cursor==0xffffffffu||count>32768u){break;}let next=nodes[cursor].next;if(next!=0xffffffffu){area+=cross2(nodes[cursor].ends.xy-nodes[root].ends.xy,nodes[next].ends.xy-nodes[root].ends.xy);}let d=length(nodes[root].ends.xy-nodes[cursor].ends.xy);if(d>maximum){maximum=d;far=cursor;}cursor=nodes[cursor].next;count++;}
 if(cursor!=root){atomicAdd(&stats[6],1u);return;}if(far==root||abs(area)<cfg.physical.x*cfg.physical.x*1e-8){atomicAdd(&stats[9],1u);return;}atomicAdd(&stats[3],1u);let start=far;cursor=nodes[start].next;maximum=0.;loop{if(cursor==start){break;}let d=length(nodes[start].ends.xy-nodes[cursor].ends.xy);if(d>maximum){maximum=d;far=cursor;}cursor=nodes[cursor].next;}keep(start);keep(far);var stack:array<vec2u,64>;stack[0]=vec2u(start,far);stack[1]=vec2u(far,start);var top=2u;var work=0u;
 loop{if(top==0u){break;}top--;let range=stack[top];let a=nodes[range.x].ends.xy;let b=nodes[range.y].ends.xy;var best=min(cfg.physical.y,abs(area)/max(maximum*16.,1e-8));var split=0xffffffffu;cursor=nodes[range.x].next;
  loop{if(cursor==range.y){break;}let d=segmentDistance(nodes[cursor].ends.xy,a,b);if(d>best){best=d;split=cursor;}cursor=nodes[cursor].next;work++;if(work>2000000u){break;}}
  if(work>2000000u||top>60u){cursor=root;loop{keep(cursor);cursor=nodes[cursor].next;if(cursor==root){break;}}atomicAdd(&stats[8],1u);break;}
  if(split!=0xffffffffu){keep(split);stack[top]=vec2u(range.x,split);stack[top+1u]=vec2u(split,range.y);top+=2u;}
 }
 // A bounded farthest-feasible walk avoids RDP's power-of-two over-segmentation.
 // Keep the result only when every skipped source point was checked and it wins.
 var rdp=0u;cursor=root;loop{rdp+=links[labelBase()+cursor*5u+4u]&1u;cursor=nodes[cursor].next;if(cursor==root){break;}}
 var anchor=start;var previous=start;var candidate=nodes[start].next;var greedy=1u;work=0u;var complete=false;links[labelBase()+start*5u+4u]|=2u;
 loop{var error=0.;cursor=nodes[anchor].next;loop{if(cursor==candidate){break;}error=max(error,segmentDistance(nodes[cursor].ends.xy,nodes[anchor].ends.xy,nodes[candidate].ends.xy));cursor=nodes[cursor].next;work++;if(work>200000u||error>cfg.physical.y){break;}}
  if(work>200000u){break;}if(error<=cfg.physical.y){if(candidate==start){complete=true;break;}previous=candidate;candidate=nodes[candidate].next;}
  else{if(previous==anchor){break;}links[labelBase()+previous*5u+4u]|=2u;greedy++;anchor=previous;candidate=nodes[anchor].next;previous=anchor;}
 }
 if(complete&&greedy>=3u&&greedy<rdp){links[labelBase()+root*5u+4u]|=4u;}
}
@compute @workgroup_size(64) fn emit(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){let i=linear(id,groups);if(i>=min(atomicLoad(&stats[2]),cfg.limits.y)||nodes[i].ring==0xffffffffu){return;}let root=links[labelBase()+i*5u+cfg.stage.x+1u];let mask=select(1u,2u,(links[labelBase()+root*5u+4u]&4u)!=0u);if((links[labelBase()+i*5u+4u]&mask)==0u){return;}var next=nodes[i].next;var steps=0u;loop{if(next==0xffffffffu||steps>32768u){return;}if((links[labelBase()+next*5u+4u]&mask)!=0u){break;}next=nodes[next].next;steps++;}let at=atomicAdd(&stats[4],1u);geometry[at*2u]=vec4f(nodes[i].ends.xy,nodes[next].ends.xy);geometry[at*2u+1u]=bitcast<vec4f>(vec4u(i,next,nodes[i].ring,links[labelBase()+i*5u+cfg.stage.x+1u]));}
@compute @workgroup_size(64) fn unmark(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){let i=linear(id,groups);if(i<min(atomicLoad(&stats[2]),cfg.limits.y)){links[labelBase()+i*5u+4u]=0u;}}
@compute @workgroup_size(1) fn prepare(){atomicStore(&stats[20],select(0u,(min(atomicLoad(&stats[2]),cfg.limits.y)+63u)/64u,atomicLoad(&stats[7])==0u));atomicStore(&stats[21],1u);atomicStore(&stats[22],1u);}
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
@compute @workgroup_size(128) fn bounds(@builtin(global_invocation_id) gid:vec3u,@builtin(num_workgroups) groups:vec3u){let t=invocation(gid,groups);if(t>=cfg.size.x){return;}for(var k=0u;k<3u;k++){let p=point(t*3u+k);for(var a=0u;a<3u;a++){atomicMin(&metrics[a],ordered(p[a]));atomicMax(&metrics[3u+a],ordered(p[a]));}}}
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
   let depth=fma((x-v.x)/(w.x-v.x),w.z-v.z,v.z);let ray=select(layer*cfg.size.z+col,cfg.size.w*cfg.size.z+layer*cfg.size.y+col,axis!=0u);
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

const previewShader=`
struct Camera{rotation:mat4x4f,centerScale:vec4f,viewport:vec4f,clip:vec4f,frame:vec4f,modes:vec4f};
struct Frame{matrix:mat4x4f,inverse:mat4x4f,color:vec4f,settings:vec4f};
struct Config{size:vec4u,domain:vec4f,heights:vec4f};
@group(0) @binding(0) var<uniform> camera:Camera;
@group(1) @binding(0) var<uniform> frame:Frame;
@group(2) @binding(0) var image:texture_2d<f32>;
@group(2) @binding(1) var<uniform> cfg:Config;
@group(2) @binding(2) var<storage,read> paths:array<vec4f>;
override orthographic:bool=false;
struct Output{@builtin(position) position:vec4f,@location(0) color:vec3f,@location(1) uv:vec2f};
fn project(local:vec3f,color:vec3f,uv:vec2f)->Output{
 let p=(camera.rotation*vec4f(((frame.matrix*vec4f(local,1)).xyz-camera.centerScale.xyz)*camera.centerScale.w,1)).xyz;
 let xy=p.xy+camera.viewport.zw;let depth=3.2-p.z;var out:Output;out.color=color;out.uv=uv;
 if(orthographic){out.position=vec4f(xy.x*camera.viewport.y/camera.viewport.x,xy.y*camera.viewport.y,(depth-camera.clip.x)/(camera.clip.y-camera.clip.x),1);}
 else{out.position=vec4f(xy.x*camera.clip.w/camera.viewport.x,xy.y*camera.clip.w,(camera.clip.y*depth-camera.clip.x*camera.clip.y)/(camera.clip.y-camera.clip.x),depth);}return out;
}
@vertex fn axes(@builtin(vertex_index) vertex:u32)->Output{let ends=array<vec3f,3>(vec3f(500,0,-500),vec3f(-500,1000,-500),vec3f(-500,0,500));let colors=array<vec3f,3>(vec3f(.82,.24,.22),vec3f(.28,.71,.34),vec3f(.28,.44,.85));return project(select(vec3f(-500,0,-500),ends[vertex/2u],vertex%2u!=0u),colors[vertex/2u],vec2f(0));}
fn pathPoint(p:vec2f,color:vec3f)->Output{let i=cfg.size.w;let y=select(cfg.heights.x+(f32(i)-.5)*cfg.heights.y,cfg.heights.x*.5,i==0u);return project(vec3f(p.x,y,p.y),color,vec2f(0));}
@vertex fn perimeter(@builtin(vertex_index) vertex:u32)->Output{let s=paths[(vertex/2u)*2u];return pathPoint(select(s.xy,s.zw,vertex%2u!=0u),vec3f(1));}
@vertex fn control(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->Output{let corners=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));var out=pathPoint(paths[instance*2u].xy,vec3f(.35,.8,1));out.position=vec4f(out.position.xy+corners[vertex]*3./camera.frame.xy*out.position.w,out.position.zw);return out;}
@vertex fn map(@builtin(vertex_index) vertex:u32)->Output{let corners=array<vec2f,6>(vec2f(0,0),vec2f(1,0),vec2f(0,1),vec2f(0,1),vec2f(1,0),vec2f(1,1));let uv=corners[vertex];let xz=cfg.domain.xy+uv*cfg.domain.zw*vec2f(cfg.size.xy);let i=cfg.size.w;let y=select(cfg.heights.x+(f32(i)-.5)*cfg.heights.y,cfg.heights.x*.5,i==0u);return project(vec3f(xz.x,y,xz.y),vec3f(1),uv);}
@fragment fn fs(input:Output)->@location(0) vec4f{return vec4f(input.color,1);}
@fragment fn coverage(input:Output)->@location(0) vec4f{let size=textureDimensions(image);let p=clamp(vec2i(input.uv*vec2f(size)),vec2i(0),vec2i(size)-1);let color=textureLoad(image,p,0);if(color.a==0.){discard;}return color;}
`;

async function createPreview(context,slicer){
 const d=context.device,module=await checkedModule(d,'Printer LDI coverage and axes',previewShader);
 const uniformLayout=()=>d.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:'uniform'}}]}),cameraLayout=uniformLayout(),frameLayout=uniformLayout();
 const imageLayout=d.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'unfilterable-float'}},{binding:1,visibility:GPUShaderStage.VERTEX,buffer:{type:'uniform'}},{binding:2,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}}]});
 const pipeline=(entryPoint,orthographic)=>d.createRenderPipelineAsync({label:'Printer '+entryPoint,layout:d.createPipelineLayout({bindGroupLayouts:entryPoint==='axes'?[cameraLayout,frameLayout]:[cameraLayout,frameLayout,imageLayout]}),vertex:{module,entryPoint,constants:{orthographic}},fragment:{module,entryPoint:entryPoint==='map'?'coverage':'fs',targets:[{format:navigator.gpu.getPreferredCanvasFormat(),blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]},primitive:{topology:entryPoint==='axes'||entryPoint==='perimeter'?'line-list':'triangle-list'},depthStencil:{format:'depth24plus',depthWriteEnabled:false,depthCompare:'always'}});
 const [axes,lines,points]=await Promise.all(['axes','perimeter','control'].map(entry=>Promise.all([false,true].map(o=>pipeline(entry,o)))));
 const groups=new WeakMap(),group=(buffer,layout)=>{let cache=groups.get(buffer);if(!cache)groups.set(buffer,cache=new Map());if(!cache.has(layout))cache.set(layout,d.createBindGroup({layout,entries:[{binding:0,resource:{buffer}}]}));return cache.get(layout);};
 return ({pass,camera,frame,orthographic,hash,params})=>{
  pass.setPipeline(axes[orthographic?1:0]);pass.setBindGroup(0,group(camera,cameraLayout));pass.setBindGroup(1,group(frame,frameLayout));pass.draw(6);
  const job=slicer.jobs.get(hash);if(!job||job.state!=='complete')return;if(job.result&&slicer.signature(hash)!==job.signature)slicer.invalidate(job);if(!job.result)return;
  slicer.reconstruct(job,Math.round(params['Finish layer']),params);const r=job.result;
  if(!r.paths)return;
  if(!r.previewGroup)r.previewGroup=d.createBindGroup({layout:imageLayout,entries:[{binding:0,resource:r.image.createView()},{binding:1,resource:{buffer:r.config}},{binding:2,resource:{buffer:r.paths.output}}]});
  pass.setPipeline(lines[orthographic?1:0]);pass.setBindGroup(2,r.previewGroup);pass.drawIndirect(r.paths.stats,48);
  pass.setPipeline(points[orthographic?1:0]);pass.drawIndirect(r.paths.stats,64);
 };
}

class LDISlicer{
 constructor(context){this.context=context;this.jobs=new Map();this.initialized=new Map();this.serial=0;this.pipelines=new WeakMap();}
 signature(hash){try{return this.context.scene.signature(hash,KEYS);}catch{return null;}}
 config(snapshot){const p=snapshot.params,width=p['Line width'],height=p['Layer height'],initial=p['Initial layer height'];if(!(width>=.1&&width<=100&&height>=.1&&height<=100&&initial>=.1&&initial<=100))throw failure('INVALID_ARGUMENT','Invalid printer width or layer heights.');return {width,height,initial};}
 disposeResult(result){for(const b of result?.paths?.resources||[])b.destroy();for(const b of result?.resources||[])b.destroy();}
 retire(hash){const job=this.jobs.get(hash);if(job){clearTimeout(job.refreshTimer);job.cancelled=true;this.disposeResult(job.result);this.jobs.delete(hash);}this.initialized.delete(hash);}
 check(job){if(job.cancelled)throw failure('CANCELLED','Slicing cancelled.');if(this.signature(job.hash)!==job.signature)throw failure('STALE_JOB','Source geometry, visibility, printer or sampling settings changed.');}
 invalidate(job){this.disposeResult(job.result);job.result=null;job.state='stale';try{job.refresh=this.context.scene.capture(job.hash,KEYS).contentSignature===job.contentSignature;}catch{job.refresh=false;}if(job.refresh)this.refresh(job);this.context.requestAttributes();}
 refresh(job){if(job.refreshTimer)return;job.refreshTimer=setTimeout(()=>{job.refreshTimer=0;if(this.jobs.get(job.hash)!==job||!job.refresh)return;if(this.context.scene.transforming){this.refresh(job);return;}job.refresh=false;try{this.start(job.hash,{},true);}catch(e){job.state='failed';job.error={code:e.code||'SLICE_FAILED',message:e.message};this.context.requestAttributes();}},32);}
 start(hash,args={},automatic=false){
  const snapshot=this.context.scene.capture(hash,KEYS),options=this.config(snapshot),previous=this.jobs.get(hash);if(previous?.state==='running')throw failure('BUSY','This printer is already slicing.');clearTimeout(previous?.refreshTimer);this.disposeResult(previous?.result);
  const job={id:++this.serial,hash,scene:snapshot.scene,signature:snapshot.signature,contentSignature:snapshot.contentSignature,automatic,options,state:'running',stage:'bounds',completed:0,total:2,started:performance.now(),cancelled:false,result:null};this.jobs.set(hash,job);
  this.run(job,snapshot).catch(e=>{job.state=e.code==='CANCELLED'?'cancelled':e.code==='STALE_JOB'?'stale':'failed';job.error={code:e.code||'SLICE_FAILED',message:e.message};if(job.state==='stale'&&job.automatic)this.invalidate(job);}).finally(()=>{job.ms=performance.now()-job.started;this.context.requestAttributes();this.context.requestDraw();});this.context.requestAttributes();return this.status(hash);
 }
 summary(r){return {representation:'orthogonal-ldi',topology:'shell-overlap-union-nested-parity-occurrence-union',axes:['X','Z'],builds:1,lastLayer:r.lastLayer,grid:r.grid,rawEvents:r.rawEvents,intervals:r.intervals,ambiguousRays:r.ambiguousRays,duplicateEvents:r.duplicateEvents,peakGPUBytes:Math.max(r.peakGPUBytes,r.retainedGPUBytes+(r.paths?.bytes||0)),retainedGPUBytes:r.retainedGPUBytes+(r.paths?.bytes||0),metadataReadBytes:r.metadataReadBytes,triangleVisits:r.triangleVisits,timings:r.timings,preview:{primitive:'line-list',points:true,finishLayer:r.previewLayer,reconstructions:r.reconstructions,reconstructSubmitMs:r.reconstructSubmitMs||0},perimeters:r.paths?{state:r.paths.error?'failed':r.paths.pending?'running':'complete',error:r.paths.error||null,layer:r.previewLayer,count:r.paths.count,firstOffset:r.paths.width*.5,spacing:r.paths.width,maxDeviation:r.paths.deviation,samplingPitch:r.grid.pitch,sourceAccuracyCertified:false,segments:r.paths.counters?.[4]??null,rawSegments:r.paths.counters?.[1]??null,loops:r.paths.counters?.[3]??null,openLoops:r.paths.counters?.[6]??null,collapsedLoops:r.paths.counters?.[9]??null,capacity:r.paths.capacity,builds:r.pathBuilds,fieldBuilds:r.fieldBuilds,graphBuilds:r.graphBuilds,metadataReadBytes:r.pathBuilds*48,ms:r.paths.ms||0,retainedLayers:1}:null};}
 status(hash){const job=this.jobs.get(hash);if(!job)return {state:'idle',result:null};if(job.result&&this.signature(hash)!==job.signature)this.invalidate(job);return {id:job.id,state:job.state,stage:job.stage,completed:job.completed,total:job.total,ms:job.ms??performance.now()-job.started,error:job.error||null,result:job.result?this.summary(job.result):null};}
 cancel(hash){const job=this.jobs.get(hash);if(job){clearTimeout(job.refreshTimer);job.refresh=false;if(job.state==='running')job.cancelled=true;}return this.status(hash);}
 attributes(hash){const s=this.status(hash),last=s.result?.lastLayer||3332;return {actions:[{id:'slice',label:'Slice',cancel:'cancel',busy:s.state==='running',progress:s.state==='running'?(s.completed?'50%':'â€¦'):''}],ranges:{'Start layer':{min:1,max:last,scrubRange:()=>[1,last]},'Finish layer':{min:1,max:last,scrubRange:()=>[1,last]},'Layer position':{min:0,max:s.result?last:0},'Max deviation':{min:.0001,max:10,scrubRange:()=>[.001,.1]}},units:{'Max deviation':'mm'}};}
 async kernels(d){let p=this.pipelines.get(d);if(!p){p=(async()=>{
  const compute=async(label,code,names,entries)=>{const module=await checkedModule(d,label,code),layout=d.createBindGroupLayout({entries}),plan=d.createPipelineLayout({bindGroupLayouts:[layout]}),result={layout};await Promise.all(names.map(async entryPoint=>result[entryPoint]=await d.createComputePipelineAsync({label:label+' '+entryPoint,layout:plan,compute:{module,entryPoint}})));return result;};
  const buffer=(binding,type='storage')=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type}});
  const source=texture=>compute('LDI source',sourceShader(texture),['bounds','count','emit','shellInit','shellJoin','shellCompress'],[0,1].map(binding=>texture?{binding,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:'uint',viewDimension:'2d-array'}}:buffer(binding,'read-only-storage')).concat([buffer(2,'uniform'),buffer(3),buffer(4,'read-only-storage'),buffer(5),buffer(6),buffer(7),buffer(8)]));
  const [native,paged,scan,clean,coverage]=await Promise.all([source(false),source(true),compute('LDI prefix',scanShader,['scan','add'],[buffer(0,'read-only-storage'),buffer(1),buffer(2),buffer(3,'uniform'),buffer(4)]),compute('LDI sort and union',cleanShader,['clean'],[buffer(0,'read-only-storage'),buffer(1,'read-only-storage'),buffer(2,'read-only-storage'),buffer(3),buffer(4),buffer(5),buffer(6,'uniform'),buffer(7)]),compute('LDI layer reconstruction',coverageShader,['reconstruct'],[buffer(0,'read-only-storage'),buffer(1,'read-only-storage'),{binding:2,visibility:GPUShaderStage.COMPUTE,storageTexture:{access:'write-only',format:'rgba8unorm'}},buffer(3,'uniform')])]);
  const paths=await compute('Printer local distance and polylines',pathShader,['seed','reduce','distance','offset','connect','label','simplify','emit','finish','prepare','unmark'],[buffer(0,'read-only-storage'),buffer(1,'read-only-storage'),buffer(2),buffer(3),buffer(4),buffer(5),buffer(6),buffer(7,'uniform'),buffer(8)]);return {native,paged,scan,clean,coverage,paths};
 })();this.pipelines.set(d,p);}return p;}
 dispatch(d,pipeline,bind,n,workgroup=128){if(!n)return;const e=d.createCommandEncoder(),pass=e.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,bind);const blocks=Math.ceil(n/workgroup),x=Math.min(blocks,d.limits.maxComputeWorkgroupsPerDimension);pass.dispatchWorkgroups(x,Math.ceil(blocks/x));pass.end();d.queue.submit([e.finish()]);}
 reconstruct(job,layer,params){const r=job.result;if(!r)return;layer=Math.max(1,Math.min(r.lastLayer,layer));params??=this.context.scene.capture(job.hash,KEYS).params;const count=Math.max(1,Math.min(1000,Math.round(params.Perimeters))),deviation=Math.max(.0001,Math.min(10,params['Max deviation']));const changed=r.previewLayer!==layer;
  if(changed){const start=performance.now(),d=this.context.device,data=new ArrayBuffer(48);new Uint32Array(data).set([r.grid.width,r.grid.depth,r.lastLayer,layer-1]);new Float32Array(data).set([...r.grid.min,...r.grid.pitch,job.options.initial,job.options.height,0,0],4);d.queue.writeBuffer(r.config,0,data);
   const e=d.createCommandEncoder(),p=e.beginComputePass();p.setPipeline(r.coveragePipeline);p.setBindGroup(0,r.coverageGroup);p.dispatchWorkgroups(Math.ceil(r.grid.width/8),Math.ceil(r.grid.depth/8));p.end();d.queue.submit([e.finish()]);r.previewLayer=layer;r.reconstructions++;r.reconstructSubmitMs=performance.now()-start;
  }
  if(changed||r.paths?.count!==count||r.paths?.deviation!==deviation)this.buildPaths(job,count,deviation,changed);
 }
 buildPaths(job,count,deviation,fieldChanged){
  const r=job.result,d=this.context.device,start=performance.now(),g=r.grid,cells=(g.width+1)*(g.depth+1),capacity=Math.min(262144,Math.max(1024,cells*4));
  let v=r.paths;if(!v){const resources=[],make=(size,usage,label)=>{if(size>d.limits.maxStorageBufferBindingSize)throw failure('PATH_MEMORY_LIMIT','Perimeter scratch exceeds the GPU binding limit.');const b=d.createBuffer({size:Math.max(16,size),usage,label});resources.push(b);return b;},storage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST;
   const levels=[];let w=g.width+1,h=g.depth+1,offset=0,scale=1;while(true){levels.push([w,h,offset,scale]);offset+=w*h;if(w===1&&h===1)break;w=Math.ceil(w/2);h=Math.ceil(h/2);scale*=2;}
   v=r.paths={resources,levels,capacity,tree:make(offset*4,storage,'Perimeter boundary pyramid'),geometry:make(capacity*32,storage,'Perimeter source boundary'),output:make(capacity*32,storage,'Perimeter compact output'),field:make((g.width+2)*(g.depth+2)*4,storage,'Layer local distance'),nodes:make(capacity*32,storage,'Perimeter linked vertices'),links:make((cells*2+capacity*5)*4,storage,'Perimeter cells and loop labels'),dispatch:make(16,GPUBufferUsage.INDIRECT|GPUBufferUsage.COPY_DST,'Perimeter bounded work dispatch'),stats:make(96,storage|GPUBufferUsage.INDIRECT,'Perimeter counters and indirect draws'),configs:[]};
   for(let i=0;i<Math.max(levels.length,3);i++)v.configs.push(make(288,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,'Perimeter pass config'));
   v.groups=v.configs.map(config=>d.createBindGroup({layout:r.pathKernels.layout,entries:[r.headers,r.intervalBuffer,v.tree,v.geometry,v.field,v.nodes,v.stats,config,v.links].map((buffer,binding)=>({binding,resource:{buffer}}))}));v.outputGroups=v.configs.map(config=>d.createBindGroup({layout:r.pathKernels.layout,entries:[r.headers,r.intervalBuffer,v.tree,v.output,v.field,v.nodes,v.stats,config,v.links].map((buffer,binding)=>({binding,resource:{buffer}}))}));v.bytes=resources.reduce((n,b)=>n+b.size,0);
  }
  const topologyChanged=fieldChanged||v.count!==count;const fieldLimit=Math.ceil(Math.hypot(g.width*g.pitch[0],g.depth*g.pitch[1])/job.options.width); // Keep the reusable field independent of Perimeters.
  v.count=count;v.width=job.options.width;v.deviation=deviation;v.error=null;v.pending=true;v.counters=null;const revision=v.revision=(v.revision||0)+1;
  for(let i=0;i<v.configs.length;i++){const data=new ArrayBuffer(288);new Uint32Array(data).set([g.width,g.depth,r.previewLayer-1,r.lastLayer]);new Float32Array(data).set([...g.min,...g.pitch,job.options.width,deviation,0,0],4);new Uint32Array(data).set([fieldChanged?fieldLimit:count,capacity,v.levels.length,0,i,0,0,0],12);v.levels.forEach((a,j)=>new Uint32Array(data).set(a,20+j*4));d.queue.writeBuffer(v.configs[i],0,data);}
  const e=d.createCommandEncoder(),dispatch=(entry,n,config=0)=>{const pass=e.beginComputePass();pass.setPipeline(r.pathKernels[entry]);pass.setBindGroup(0,v.groups[config]);const blocks=Math.ceil(n/64),x=Math.min(blocks,d.limits.maxComputeWorkgroupsPerDimension);pass.dispatchWorkgroups(x,Math.ceil(blocks/x));pass.end();};
  if(topologyChanged){e.clearBuffer(v.stats);e.clearBuffer(v.links);}else{e.clearBuffer(v.stats,12,16);e.clearBuffer(v.stats,32,16);e.clearBuffer(v.stats,48,32);}
  if(fieldChanged){e.clearBuffer(v.tree);dispatch('seed',cells);for(let i=1;i<v.levels.length;i++)dispatch('reduce',v.levels[i][0]*v.levels[i][1],i);dispatch('distance',(g.width+2)*(g.depth+2));r.fieldBuilds=(r.fieldBuilds||0)+1;}
  // Separate config buffers prevent later writes changing an earlier queued pass.
  d.queue.submit([e.finish()]);if(!fieldChanged&&v.sourceOverflow)d.queue.writeBuffer(v.stats,28,new Uint32Array([1]));for(let i=0;i<3;i++)d.queue.writeBuffer(v.configs[i],48,new Uint32Array([count,capacity,v.levels.length,0,i===1?2:0,0,0,0]));
  const out=d.createCommandEncoder(),run=(entry,n,config=0)=>{const pass=out.beginComputePass();pass.setPipeline(r.pathKernels[entry]);pass.setBindGroup(0,(entry==='emit'?v.outputGroups:v.groups)[config]);const blocks=Math.ceil(n/64),x=Math.min(blocks,d.limits.maxComputeWorkgroupsPerDimension);if(['connect','label','simplify','emit','unmark'].includes(entry))pass.dispatchWorkgroupsIndirect(v.dispatch,0);else pass.dispatchWorkgroups(x,Math.ceil(blocks/x));pass.end();};
  let ping=(Math.ceil(Math.log2(capacity))+1)%2;if(topologyChanged){run('offset',cells);run('prepare',1);out.copyBufferToBuffer(v.stats,80,v.dispatch,0,12);run('connect',capacity);ping=0;for(let i=0;i<Math.ceil(Math.log2(capacity))+1;i++){run('label',capacity,ping);ping=1-ping;}r.graphBuilds=(r.graphBuilds||0)+1;}else run('unmark',capacity);run('simplify',capacity,ping);run('emit',capacity,ping);run('finish',1);d.queue.submit([out.finish()]);r.pathBuilds=(r.pathBuilds||0)+1;
  const read=d.createBuffer({size:48,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),copy=d.createCommandEncoder();copy.copyBufferToBuffer(v.stats,0,read,0,48);d.queue.submit([copy.finish()]);v.done=(async()=>{try{await read.mapAsync(GPUMapMode.READ);const counters=Array.from(new Uint32Array(read.getMappedRange()));read.unmap();if(job.result!==r||v.revision!==revision)return;v.counters=counters;if(fieldChanged){v.sourceSegments=counters[0];v.sourceOverflow=counters[0]>v.capacity*2;}v.ms=performance.now()-start;if(counters[7])v.error={code:'PATH_CAPACITY',message:'Perimeter segment capacity exceeded.'};else if(counters[6])v.error={code:'PATH_TOPOLOGY',message:'An open or oversized perimeter was rejected.'};v.pending=false;}finally{read.destroy();}})().catch(error=>{if(job.result===r&&v.revision===revision){v.error={code:'PATH_FAILED',message:error.message};v.pending=false;}});
 }
 async run(job,snapshot){
  if(snapshot.meshes.length>256)throw failure('OWNER_LIMIT','LDI supports at most 256 evaluated solid occurrences.');
  const d=snapshot.device,owned=new Set(),options=job.options;let live=0,peak=0,metadataReadBytes=0;
  const make=(size,usage,label)=>{if(size>d.limits.maxBufferSize||(usage&GPUBufferUsage.STORAGE)&&size>d.limits.maxStorageBufferBindingSize)throw failure('LDI_MEMORY_LIMIT','LDI exceeds the bounded GPU binding.');const b=d.createBuffer({size:Math.max(16,size),usage,label});owned.add(b);live+=b.size;peak=Math.max(peak,live);return b;};
  const free=b=>{if(owned.delete(b)){live-=b.size;b.destroy();}};
  const storage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC;
  const group=(layout,items)=>d.createBindGroup({layout,entries:items.map((resource,binding)=>({binding,resource:resource instanceof GPUBuffer?{buffer:resource}:resource}))});
  const read=async(buffer,bytes)=>{const b=make(bytes,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ,'LDI small metadata readback');try{const e=d.createCommandEncoder();e.copyBufferToBuffer(buffer,0,b,0,bytes);d.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);const data=b.getMappedRange().slice(0,bytes);b.unmap();metadataReadBytes+=bytes;this.check(job);return data;}finally{free(b);}};
  try{
   const t=performance.now(),p=await this.kernels(d);this.check(job);const timings={compileMs:performance.now()-t};
   const metrics=make(32,storage,'LDI counters'),uniform=make(128,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,'LDI source transform'),placeholders=Array.from({length:5},(_,i)=>make(16,storage,'LDI placeholder '+i));
   const shellOffsets=new Map();let shellWords=0;for(const mesh of snapshot.meshes){shellOffsets.set(mesh,shellWords);shellWords+=mesh.vertexCount;}
   let grid={width:1,depth:1,min:[0,0],pitch:[1,1]},last=1,counts=placeholders[0],offsets=placeholders[1],cursors=placeholders[2],events=placeholders[3],planes=placeholders[4];
   const sourcePass=entry=>{for(const mesh of snapshot.meshes){this.check(job);if(!mesh.triangleCount)continue;const tiled=entry==='count'||entry==='emit',lanes=tiled?sourceLanes(mesh.triangleCount):1;for(let layer=0;layer<(tiled?last:1);layer+=LAYER_BATCH){const data=new ArrayBuffer(128);new Float32Array(data).set(mesh.matrix);new Uint32Array(data).set([mesh.triangleCount,grid.width,grid.depth,last],16);new Float32Array(data).set([...grid.min,...grid.pitch,options.initial,options.height,mesh.solid,lanes],20);new Uint32Array(data).set([mesh.vertexCount,shellOffsets.get(mesh),shellWords,layer],28);d.queue.writeBuffer(uniform,0,data);const k=mesh.storage==='texture'?p.paged:p.native;this.dispatch(d,k[entry],group(k.layout,[mesh.storage==='texture'?mesh.positions.view:mesh.positions,mesh.storage==='texture'?mesh.indices.view:mesh.indices,uniform,counts,offsets,cursors,events,metrics,planes]),entry==='shellInit'||entry==='shellCompress'?mesh.vertexCount:mesh.triangleCount*lanes);}}};
   d.queue.writeBuffer(metrics,0,new Uint32Array([0xffffffff,0xffffffff,0xffffffff,0,0,0,0,0]));let started=performance.now();sourcePass('bounds');const rawBounds=new Uint32Array(await read(metrics,24));
   const unordered=v=>{const a=new Uint32Array([v&0x80000000?v^0x80000000:~v]);return new Float32Array(a.buffer)[0];},lo=Array.from(rawBounds.slice(0,3),unordered),hi=Array.from(rawBounds.slice(3),unordered);timings.boundsMs=performance.now()-started;
   if(!snapshot.meshes.length||!lo.every(Number.isFinite)||!hi.every(Number.isFinite)||hi[0]<=-500||lo[0]>=500||hi[2]<=-500||lo[2]>=500||hi[1]<layerY(0,options)){job.state='empty';return;}
   last=0;while(last<MAX_LAYERS&&layerY(last,options)<Math.min(hi[1],1000))last++;if(last===MAX_LAYERS&&layerY(last,options)<Math.min(hi[1],1000))throw failure('LAYER_LIMIT','LDI exceeds 4096 layers.');if(!last){job.state='empty';return;}
   const min=[Math.max(-500,lo[0]),Math.max(-500,lo[2])],max=[Math.min(500,hi[0]),Math.min(500,hi[2])],span=max.map((v,i)=>v-min[i]);if(span.some(v=>!(v>0))){job.state='empty';return;}
   // Sampling is explicit and bounded; no full-resolution voxel volume exists.
   const target=options.width*.2;let nx=Math.min(2048,Math.max(1,Math.ceil(span[0]/target))),nz=Math.min(2048,Math.max(1,Math.ceil(span[1]/target)));const maxColumns=Math.floor(MAX_RAYS/last);if(nx+nz>maxColumns){const factor=maxColumns/(nx+nz);nx=Math.max(1,Math.floor(nx*factor));nz=Math.max(1,Math.floor(nz*factor));}
   grid={width:nx,depth:nz,min,pitch:[span[0]/nx,span[1]/nz],targetPitch:target,resolutionLimited:span[0]/nx>target*1.001||span[1]/nz>target*1.001};const rays=(nx+nz)*last;job.stage='ldi-count';
   counts=make(rays*4,storage,'LDI raw ray counts');offsets=make(rays*4,storage,'LDI raw ray offsets');d.queue.writeBuffer(metrics,0,new Uint32Array(8));started=performance.now();sourcePass('count');
   const scan=async(input,output,n,root=true)=>{const blocks=Math.ceil(n/256),sums=make(blocks*4,storage,'LDI scan block sums'),config=make(16,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,'LDI scan config');d.queue.writeBuffer(config,0,new Uint32Array([n,root?1:0,0,0]));this.dispatch(d,p.scan.scan,group(p.scan.layout,[input,output,sums,config,metrics]),n,256);if(blocks>1){const prefix=make(blocks*4,storage,'LDI scan block offsets');await scan(sums,prefix,blocks,false);this.dispatch(d,p.scan.add,group(p.scan.layout,[prefix,output,sums,config,metrics]),n,256);free(prefix);}free(sums);free(config);};
   await scan(counts,offsets,rays);const totals=new Uint32Array(await read(metrics,16)),rawEvents=totals[0];timings.countMs=performance.now()-started;
   if(!rawEvents){job.state='empty';return;}if(rawEvents>Math.min(MAX_EVENTS,Math.floor(d.limits.maxStorageBufferBindingSize/8)))throw failure('LDI_EVENT_LIMIT','LDI depth events exceed the bounded GPU allocation.');if(totals[1]>MAX_HITS)throw failure('LDI_RAY_LIMIT','A ray exceeds 1024 depth events; split the source geometry.');
   job.stage='ldi-emit';started=performance.now();cursors=make(rays*4,storage,'LDI emit cursors');events=make(rawEvents*8,storage,'LDI raw depth and occurrence events');planes=make((shellWords+rawEvents*4)*4,storage,'LDI shell roots and crossing planes');sourcePass('shellInit');sourcePass('shellJoin');sourcePass('shellCompress');sourcePass('emit');await d.queue.onSubmittedWorkDone();this.check(job);timings.emitMs=performance.now()-started;free(cursors);for(const b of placeholders)free(b);
   const headers=make(rays*8,storage,'Clean X and Z LDI ray headers'),intervalBuffer=make(Math.floor(rawEvents/2)*8,storage,'Clean X and Z union depth intervals'),cleanConfig=make(16,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,'LDI clean config');d.queue.writeBuffer(cleanConfig,0,new Uint32Array([rays,shellWords,0,0]));d.queue.writeBuffer(metrics,0,new Uint32Array(8));job.stage='ldi-clean';started=performance.now();const cleanGroup=group(p.clean.layout,[counts,offsets,events,headers,intervalBuffer,metrics,cleanConfig,planes]);d.queue.writeBuffer(cleanConfig,0,new Uint32Array([rays,shellWords,1,0]));this.dispatch(d,p.clean.clean,cleanGroup,rays*128);d.queue.writeBuffer(cleanConfig,0,new Uint32Array([rays,shellWords,0,0]));d.queue.writeBuffer(metrics,0,new Uint32Array(8));this.dispatch(d,p.clean.clean,cleanGroup,rays*128);const cleaned=new Uint32Array(await read(metrics,16));timings.cleanMs=performance.now()-started;free(counts);free(offsets);free(events);free(planes);free(cleanConfig);
   const image=d.createTexture({label:'Finish layer LDI coverage',size:[nx,nz],format:'rgba8unorm',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC});owned.add(image);live+=nx*nz*4;peak=Math.max(peak,live);const config=make(48,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,'LDI selected layer');
   await this.preparePreview();this.check(job);const resources=[headers,intervalBuffer,image,config],params=this.context.scene.capture(job.hash,KEYS).params,firstSuccess=this.initialized.get(job.hash)!==snapshot.scene;
   const r={resources,headers,intervalBuffer,image,config,grid,lastLayer:last,rawEvents,intervals:cleaned[0],ambiguousRays:cleaned[2],duplicateEvents:cleaned[3],triangleVisits:snapshot.meshes.reduce((n,m)=>n+m.triangleCount*(2+2*Math.ceil(last/LAYER_BATCH)*sourceLanes(m.triangleCount)),0),metadataReadBytes,peakGPUBytes:peak,retainedGPUBytes:rays*8+intervalBuffer.size+nx*nz*4+config.size,timings,reconstructions:0,previewLayer:0,pathKernels:p.paths,coveragePipeline:p.coverage.reconstruct};r.coverageGroup=group(p.coverage.layout,[headers,intervalBuffer,image.createView(),config]);job.result=r;
   const finish=firstSuccess?last:Math.max(1,Math.min(last,Math.round(params['Finish layer'])));this.reconstruct(job,finish,params);await job.result.paths.done;await d.queue.onSubmittedWorkDone();this.check(job);
   try{this.context.update(job.hash,{'Finish layer':finish,'Start layer':Math.max(1,Math.min(last,params['Start layer']))});}catch(error){job.result=null;throw error;}
   this.initialized.set(job.hash,snapshot.scene);for(const b of resources)owned.delete(b);job.completed=2;job.state='complete';job.stage='complete';
  }finally{if(job.state!=='complete'){for(const b of job.result?.paths?.resources||[])b.destroy();job.result=null;}for(const b of owned)b.destroy();}
 }
 async inspectCoverage(job,args){const r=job.result,d=this.context.device,total=r.grid.width*r.grid.depth,offset=args.offset||0,count=Math.min(args.count||64,total-offset);if(offset>=total)throw failure('INVALID_ARGUMENT','Pixel offset is outside the coverage map.');if(args.layer!==undefined&&args.layer!==r.previewLayer)throw failure('INVALID_ARGUMENT','Coverage inspection reads the displayed Finish layer.');
  const read=d.createBuffer({size:count*256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{const e=d.createCommandEncoder();for(let i=0;i<count;i++){const pixel=offset+i;e.copyTextureToBuffer({texture:r.image,origin:[pixel%r.grid.width,Math.floor(pixel/r.grid.width)]},{buffer:read,offset:i*256,bytesPerRow:256},[1,1]);}d.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);const bytes=new Uint8Array(read.getMappedRange()),coverage=Array.from({length:count},(_,i)=>bytes[i*256+3]/255);read.unmap();this.check(job);return {index:r.previewLayer,width:r.grid.width,height:r.grid.depth,offset,coverage};}finally{read.destroy();}
 }
 async inspectPaths(job,args){const r=job.result;this.reconstruct(job,Math.round(this.context.scene.capture(job.hash,KEYS).params['Finish layer']));if(args.layer!==undefined&&args.layer!==r.previewLayer)throw failure('INVALID_ARGUMENT','Path inspection reads the displayed Finish layer.');const v=r.paths,revision=v.revision;await v.done;this.check(job);if(v.error&&!args.raw&&!args.boundary)throw failure(v.error.code,v.error.message);const raw=args.raw===true,boundary=args.boundary===true,stride=boundary?16:32,total=boundary?Math.min(v.sourceSegments,v.capacity*2):raw?Math.min(v.counters[2],v.capacity):v.counters[4],offset=args.offset||0,count=Math.min(args.count||64,Math.max(0,total-offset));if(offset>total)throw failure('INVALID_ARGUMENT','Path offset is outside the generated paths.');const d=this.context.device,read=d.createBuffer({size:Math.max(32,count*stride),usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  try{if(count){const e=d.createCommandEncoder();e.copyBufferToBuffer(boundary?v.geometry:raw?v.nodes:v.output,offset*stride,read,0,count*stride);d.queue.submit([e.finish()]);}await read.mapAsync(GPUMapMode.READ);const f=new Float32Array(read.getMappedRange()),u=new Uint32Array(f.buffer),segments=[];for(let i=0;i<count;i++){const at=i*stride/4;if(raw&&u[at+6]===0xffffffff)continue;segments.push({a:[f[at],layerY(r.previewLayer-1,job.options),f[at+1]],b:[f[at+2],layerY(r.previewLayer-1,job.options),f[at+3]],id:raw||boundary?offset+i:u[at+4],next:boundary?null:raw?u[at+7]:u[at+5],perimeter:boundary?0:u[at+6]+1,loop:raw||boundary?null:u[at+7]});}read.unmap();this.check(job);if(r.paths!==v||v.revision!==revision)throw failure('STALE_JOB','Perimeters changed during inspection.');return {index:r.previewLayer,offset,total,raw,boundary,segments};}finally{read.destroy();}
 }
 async inspect(hash,args){if((args.raw||args.boundary)&&!args.paths||args.paths&&args.coverage||args.raw&&args.boundary||args.paths&&args.axis)throw failure('INVALID_ARGUMENT','Choose either LDI, coverage, paths, raw paths or boundary inspection.');const status=this.status(hash),job=this.jobs.get(hash);if(!job?.result)return status;this.check(job);const r=job.result;if(args.paths){const paths=await this.inspectPaths(job,args);return {...this.status(hash),paths};}if(args.coverage)return {...status,image:await this.inspectCoverage(job,args)};const layer=args.layer??r.previewLayer;if(layer>r.lastLayer)throw failure('INVALID_ARGUMENT','Layer is outside the LDI.');
  const d=this.context.device,axis=args.axis||'X',columns=axis==='X'?r.grid.depth:r.grid.width,offset=args.offset||0,count=Math.min(args.count||64,columns-offset);if(offset>=columns)throw failure('INVALID_ARGUMENT','Ray offset is outside the LDI.');
  const ray=(axis==='X'?0:r.lastLayer*r.grid.depth)+(layer-1)*columns+offset,read=d.createBuffer({size:count*8,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  try{let e=d.createCommandEncoder();e.copyBufferToBuffer(r.headers,ray*8,read,0,count*8);d.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);const headers=new Uint32Array(read.getMappedRange().slice(0));read.unmap();const total=Array.from({length:count},(_,i)=>(headers[i*2+1]&0x7fffffff)).reduce((a,b)=>a+b,0);if(total>4096)throw failure('INSPECTION_LIMIT','Inspect at most 4096 intervals per request.');const data=d.createBuffer({size:Math.max(16,total*8),usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
   try{e=d.createCommandEncoder();let at=0;for(let i=0;i<count;i++){const n=(headers[i*2+1]&0x7fffffff);if(n)e.copyBufferToBuffer(r.intervalBuffer,headers[i*2]*8,data,at*8,n*8);at+=n;}d.queue.submit([e.finish()]);await data.mapAsync(GPUMapMode.READ);const values=Array.from(new Float32Array(data.getMappedRange()).slice(0,total*2));data.unmap();this.check(job);at=0;const rays=Array.from({length:count},(_,i)=>{const n=(headers[i*2+1]&0x7fffffff),intervals=Array.from({length:n},()=>{const a=values.slice(at,at+2);at+=2;return a;});return {column:offset+i,ambiguous:(headers[i*2+1]&0x80000000)!==0,position:r.grid.min[axis==='X'?1:0]+(offset+i+.5)*r.grid.pitch[axis==='X'?1:0],intervals};});return {...status,layer:{index:layer,y:layerY(layer-1,job.options),axis,columns,offset,rays}};}finally{data.destroy();}
  }finally{read.destroy();}
 }
 operations(){return [{id:'slice',description:'Build persistent GPU LDIs and connected simplified perimeter lines and points for Finish layer.',inputSchema:emptySchema,readOnly:false,run:hash=>this.start(hash)},{id:'status',description:'Read LDI build, sampling, ambiguity, memory and coverage diagnostics.',inputSchema:emptySchema,readOnly:true,run:hash=>this.status(hash)},{id:'cancel',description:'Cancel the LDI build without partial publication.',inputSchema:emptySchema,readOnly:false,run:hash=>this.cancel(hash)},{id:'inspect',description:'Read bounded LDI intervals, coverage, or connected perimeter segments and points from Finish layer.',inputSchema:{type:'object',properties:{layer:{type:'integer',minimum:1,maximum:MAX_LAYERS},axis:{type:'string',enum:['X','Z']},coverage:{type:'boolean'},paths:{type:'boolean'},raw:{type:'boolean'},boundary:{type:'boolean'},offset:{type:'integer',minimum:0,maximum:4194303},count:{type:'integer',minimum:1,maximum:256}},additionalProperties:false},readOnly:true,run:(hash,args)=>this.inspect(hash,args)}];}
}

export async function activate(context){
 if(context.version!==1)throw Error('Unsupported Frame plugin API');const slicer=new LDISlicer(context);let preview=null;
 let previewPending=null;slicer.preparePreview=()=>preview?.device===context.device?Promise.resolve():previewPending??=(async()=>{const device=context.device,draw=await createPreview(context,slicer);preview={device,draw};})().finally(()=>{previewPending=null;});
 context.operations.register(slicer.operations());context.attributes.register(hash=>slicer.attributes(hash));
 const corners=[[-500,0,-500],[500,0,-500],[500,0,500],[-500,0,500],[-500,1000,-500],[500,1000,-500],[500,1000,500],[-500,1000,500]],edges=[];
 for(let i=0;i<4;i++)edges.push(...corners[i],...corners[(i+1)%4],...corners[i+4],...corners[(i+1)%4+4],...corners[i],...corners[i+4]);
 slicer.preparePreview().then(()=>context.requestDraw());
 await context.viewport.register({pivot:[-500,0,-500],bounds:{min:[-500,0,-500],max:[500,1000,500]},surfaceSelection:'last-active',lines:new Float32Array(edges),color:[.45,.62,.58,.65],selectedColor:[.75,.65,.43,.65],settings:params=>[Math.sin(Math.max(0,Math.min(90,params['Overhang angle']))*Math.PI/180),0,0,0],retire:hash=>slicer.retire(hash),render:state=>{if(preview?.device!==state.device){slicer.preparePreview().then(()=>context.requestDraw());return;}preview.draw(state);},shader:`fn pluginSurface(local:vec3f,normal:vec3f,build:vec3f,settings:vec4f)->vec4f{
  if(local.y<=0.001||local.y>1000.||abs(local.x)>500.||abs(local.z)>500.){discard;}
  if(-dot(normal,build)<=settings.x+0.000001){discard;}return vec4f(1.,.12,.12,1.);
 }`});
}
