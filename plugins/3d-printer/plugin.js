// Native GPU sections, closed vector boundaries, even-odd owner fill and solid union.
const KEYS=['Line width','Layer height','Initial layer height'];
const MAX_LAYERS=4096,MAX_SEGMENTS=8000000,MAX_LAYER_SEGMENTS=65536;
const failure=(code,message)=>Object.assign(Error(message),{code});
const emptySchema={type:'object',properties:{},additionalProperties:false};
const sectionKernel=texture=>`
struct Config{matrix:mat4x4f,range:vec4u,heights:vec4f};
@group(0) @binding(0) var ${texture?'positions:texture_2d_array<u32>':'<storage,read> positions:array<f32>'};
@group(0) @binding(1) var ${texture?'indices:texture_2d_array<u32>':'<storage,read> indices:array<u32>'};
@group(0) @binding(2) var<uniform> cfg:Config;
@group(0) @binding(3) var<storage,read_write> differences:array<atomic<i32>>;
@group(0) @binding(4) var<storage,read> offsets:array<u32>;
@group(0) @binding(5) var<storage,read_write> cursors:array<atomic<u32>>;
struct Segment{a:vec4f,b:vec4f};
@group(0) @binding(6) var<storage,read_write> output:array<Segment>;
${texture?`fn scalar(t:texture_2d_array<u32>,i:u32)->u32{let d=textureDimensions(t);return textureLoad(t,vec2i(vec2u(i%d.x,(i/d.x)%d.y)),i32(i/(d.x*d.y)),0).x;}
fn index(i:u32)->u32{return scalar(indices,i);}fn value(i:u32)->f32{return bitcast<f32>(scalar(positions,i));}`:`fn index(i:u32)->u32{return indices[i];}fn value(i:u32)->f32{return positions[i];}`}
fn point(i:u32)->vec3f{let j=index(i)*3u;return (cfg.matrix*vec4f(value(j),value(j+1u),value(j+2u),1)).xyz;}
fn layerY(i:u32)->f32{return select(cfg.heights.x+(f32(i)-.5)*cfg.heights.y,cfg.heights.x*.5,i==0u);}
// Half-open [minimumY,maximumY). Layer zero has its own center and thickness.
fn span(a:vec3f,b:vec3f,c:vec3f)->vec3u{
 let low=min(a.y,min(b.y,c.y));let high=max(a.y,max(b.y,c.y));
 var first=u32(clamp(ceil((low-cfg.heights.x)/cfg.heights.y+.5),1.,f32(cfg.range.y)));
 var end=u32(clamp(ceil((high-cfg.heights.x)/cfg.heights.y+.5),1.,f32(cfg.range.y)));
 // Correct division rounding against the actual Float32 plane equations.
 while(first>1u&&layerY(first-1u)>=low){first--;}
 while(first<cfg.range.y&&layerY(first)<low){first++;}
 while(end>1u&&layerY(end-1u)>=high){end--;}
 while(end<cfg.range.y&&layerY(end)<high){end++;}
 return vec3u(first,end,select(0u,1u,low<=layerY(0u)&&high>layerY(0u)));
}
fn triangle(id:vec3u,groups:vec3u)->u32{return id.x+id.y*groups.x*128u;}
@compute @workgroup_size(128) fn count(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){
 let t=triangle(id,groups);if(t>=cfg.range.x){return;}let a=point(t*3u);let b=point(t*3u+1u);let c=point(t*3u+2u);let s=span(a,b,c);
 if(layerY(cfg.range.y)<1000.&&min(a.y,min(b.y,c.y))<1000.&&max(a.y,max(b.y,c.y))>layerY(cfg.range.y)){atomicAdd(&differences[cfg.range.y+1u],1);}
 if(s.z!=0u){atomicAdd(&differences[0],1);atomicSub(&differences[1],1);}
 if(s.y>s.x){atomicAdd(&differences[s.x],1);atomicSub(&differences[s.y],1);}
}
fn emitSection(a:vec3f,b:vec3f,c:vec3f,layer:u32){
 let h=layerY(layer);let points=array<vec3f,3>(a,b,c);var hits:array<vec3f,2>;var n=0u;
 for(var k=0u;k<3u;k++){
  var p=points[k];var q=points[(k+1u)%3u];if(p.y>q.y){let swap=p;p=q;q=swap;}
  if(p.y<=h&&q.y>h){if(n<2u){let v=p+(q-p)*((h-p.y)/(q.y-p.y));hits[n]=vec3f(v.x,h,v.z);}n++;}
 }
 if(n==2u){let at=offsets[layer]+atomicAdd(&cursors[layer],1u);output[at]=Segment(vec4f(hits[0],cfg.heights.z),vec4f(hits[1],cfg.heights.w));}
}
@compute @workgroup_size(128) fn emit(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){
 let t=triangle(id,groups);if(t>=cfg.range.x){return;}let a=point(t*3u);let b=point(t*3u+1u);let c=point(t*3u+2u);let s=span(a,b,c);
 if(s.z!=0u&&cfg.range.z==0u){emitSection(a,b,c,0u);}
 for(var i=max(s.x,cfg.range.z);i<min(s.y,cfg.range.w);i++){emitSection(a,b,c,i);}
}
// Benchmark baseline: transform/test each triangle separately for every layer.
@compute @workgroup_size(128) fn scan(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){
 let t=triangle(vec3u(id.xy,0u),groups);let layer=cfg.range.z+id.z;if(t>=cfg.range.x||layer>=cfg.range.w){return;}
 let a=point(t*3u);let b=point(t*3u+1u);let c=point(t*3u+2u);let h=layerY(layer);
 if(min(a.y,min(b.y,c.y))<=h&&max(a.y,max(b.y,c.y))>h){emitSection(a,b,c,layer);}
}`;

// Bounded vector topology. All coordinates remain on the shared GPU.
const topologyShader=`
struct Segment{a:vec4f,b:vec4f};
struct Config{size:vec4u,values:vec4f,grid:vec4u};
@group(0) @binding(0) var<storage,read> source:array<Segment>;
@group(0) @binding(1) var<storage,read_write> dest:array<Segment>;
@group(0) @binding(2) var<storage,read_write> links:array<vec2u>;
@group(0) @binding(3) var<storage,read_write> counts:array<atomic<u32>>;
@group(0) @binding(4) var<storage,read> rows:array<vec4u>;
@group(0) @binding(5) var<uniform> cfg:Config;
const NONE=0xffffffffu;
fn cross(a:vec2f,b:vec2f)->f32{return a.x*b.y-a.y*b.x;}
fn robustCross(a:vec2f,b:vec2f)->f32{let x=a.x*b.y;let y=a.y*b.x;let d=x-y;if(abs(d)>(abs(x)+abs(y))*.0000002384185791){return d;}return d+(fma(a.x,b.y,-x)-fma(a.y,b.x,-y));}
fn point(s:Segment,e:u32)->vec2f{return select(s.a.xz,s.b.xz,e!=0u);}
fn validSegment(s:Segment)->bool{return s.a.w>0.&&distance(s.a.xz,s.b.xz)>cfg.values.y;}
fn rowAt(id:u32)->u32{var lo=0u;var hi=cfg.size.y;while(lo<hi){let mid=(lo+hi)/2u;if(rows[mid].x+rows[mid].y<=id){lo=mid+1u;}else{hi=mid;}}return lo;}
fn invocation(id:vec3u,groups:vec3u)->u32{return cfg.size.w+id.x+id.y*groups.x*64u;}
fn error(code:u32){atomicMax(&counts[cfg.size.y],code);}
fn same(a:vec2f,b:vec2f)->bool{return distance(a,b)<=cfg.values.y;}
fn distanceTo(p:vec2f,a:vec2f,b:vec2f)->f32{let v=b-a;return distance(p,a+v*clamp(dot(p-a,v)/max(dot(v,v),1e-30),0.,1.));}
@compute @workgroup_size(64) fn clean(@builtin(global_invocation_id) gid:vec3u,@builtin(num_workgroups) groups:vec3u){
 let id=invocation(gid,groups);if(id>=cfg.size.x){return;}let row=rowAt(id);let r=rows[row];var s=source[id];
 if(!validSegment(s)){s.a.w=0.;dest[id]=s;return;}
 var query=candidates(row,s.a.xz-vec2f(cfg.values.y),s.a.xz+vec2f(cfg.values.y));loop{let j=nextCandidate(&query);if(j==NONE){break;}if(j>=id){continue;}let t=source[j];if(t.b.w!=s.b.w||!validSegment(t)){continue;}
  if((same(s.a.xz,t.a.xz)&&same(s.b.xz,t.b.xz))||(same(s.a.xz,t.b.xz)&&same(s.b.xz,t.a.xz))){s.a.w=0.;break;}}
 dest[id]=s;
}
@compute @workgroup_size(64) fn connect(@builtin(global_invocation_id) gid:vec3u,@builtin(num_workgroups) groups:vec3u){
 let id=invocation(gid,groups);if(id>=cfg.size.x){return;}let row=rowAt(id);let r=rows[row];let s=source[id];var pair=vec2u(NONE);
 if(validSegment(s)){for(var end=0u;end<2u;end++){let p=point(s,end);var best=cfg.values.x;var chosen=NONE;
  var query=candidates(row,p-vec2f(cfg.values.x),p+vec2f(cfg.values.x));loop{let j=nextCandidate(&query);if(j==NONE){break;}let t=source[j];if(j==id||t.b.w!=s.b.w||!validSegment(t)){continue;}
   for(var e=0u;e<2u;e++){let delta=distance(p,point(t,e));if(delta<best||(delta==best&&j*2u+e<chosen)){best=delta;chosen=j*2u+e;}}}
  pair[end]=chosen;}}
 links[id]=pair;
}
@compute @workgroup_size(64) fn close(@builtin(global_invocation_id) gid:vec3u,@builtin(num_workgroups) groups:vec3u){
 let id=invocation(gid,groups);if(id>=cfg.size.x){return;}let row=rowAt(id);let r=rows[row];let local=id-r.x;var s=source[id];var extra=s;extra.a.w=0.;
 if(validSegment(s)){
  for(var end=0u;end<2u;end++){let other=partner(id*2u+end);if(other!=NONE){
   if(partner(other)!=id*2u+end){error(1u);continue;}
   let p=(point(s,end)+point(source[other/2u],other%2u))*.5;if(end==0u){s.a.x=p.x;s.a.z=p.y;}else{s.b.x=p.x;s.b.z=p.y;}
  }else{
   // Follow this nonbranching chain to its other free endpoint; never bridge unrelated islands.
   var at=id*2u+(1u-end);var found=NONE;
   for(var step=0u;step<=r.y;step++){let next=partner(at);if(next==NONE){found=at;break;}at=(next/2u)*2u+(1u-next%2u);}
   if(found==NONE){error(1u);}else if(id*2u+end<found){extra=Segment(vec4f(point(s,end).x,s.a.y,point(s,end).y,s.a.w),vec4f(point(source[found/2u],found%2u).x,s.a.y,point(source[found/2u],found%2u).y,s.b.w));atomicAdd(&counts[row],1u);}
  }}
 }
 dest[r.z+local]=s;dest[r.z+r.y+local]=extra;
}
// Horizontal ray parity per independent GPU occurrence, then union the filled owners.
fn filled(p:vec2f,origin:vec2f,direction:vec2f,edge:u32,r:vec4u)->bool{
 var parity:array<u32,8>;
 var query=candidates(rowAt(edge),origin+p,vec2f(coordinate(atomicLoad(&bucketRows[rowAt(edge)*cfg.grid.z+1u])),origin.y+p.y));loop{let j=nextCandidate(&query);if(j==NONE){break;}let s=source[j];if(!validSegment(s)){continue;}let a=s.a.xz-origin;let b=s.b.xz-origin;
  let aboveA=a.y>p.y||(a.y==p.y&&direction.y<0.);let aboveB=b.y>p.y||(b.y==p.y&&direction.y<0.);
  if(aboveA!=aboveB){let w=b-a;let q=p-a;var determinant=cross(w,q);let error=(abs(w.x*q.y)+abs(w.y*q.x))*.0000002384185791;if(j!=edge&&abs(determinant)<=error){let x=w.x*q.y;let y=w.y*q.x;determinant=(x-y)+(fma(w.x,q.y,-x)-fma(w.y,q.x,-y));}let own=vec2f(direction.y,-direction.x);
   if(j==edge||determinant==0.||(cross(w,own)==0.&&cross(w,a)==0.)){determinant=cross(w,direction);}
   if(determinant!=0.&&((determinant>0.)==(w.y>0.))){let owner=u32(s.b.w)-1u;parity[owner/32u]^=1u<<(owner%32u);}}}
 var result=0u;for(var k=0u;k<8u;k++){result|=parity[k];}return result!=0u;
}
@compute @workgroup_size(64) fn boundary(@builtin(global_invocation_id) gid:vec3u,@builtin(num_workgroups) groups:vec3u){
 let id=invocation(gid,groups);if(id>=cfg.size.x){return;}let row=rowAt(id);let r=rows[row];let s=source[id];if(!validSegment(s)){return;}
 let a=s.a.xz;let v=s.b.xz-a;let lengthV=length(v);let epsilon=max(cfg.values.y,min(cfg.values.z*.005,max(1.,max(max(abs(a.x),abs(a.y)),max(abs(s.b.x),abs(s.b.z))))*.0000002384185791));var cuts:array<f32,128>;cuts[0]=0.;cuts[1]=1.;var n=2u;
 var intersections=candidates(row,min(s.a.xz,s.b.xz)-vec2f(cfg.values.y),max(s.a.xz,s.b.xz)+vec2f(cfg.values.y));loop{let j=nextCandidate(&intersections);if(j==NONE){break;}if(j==id){continue;}let t=source[j];if(!validSegment(t)){continue;}let b=t.a.xz;let w=t.b.xz-b;
  if(any(max(a,s.b.xz)+vec2f(cfg.values.y)<min(b,t.b.xz))||any(max(b,t.b.xz)+vec2f(cfg.values.y)<min(a,s.b.xz))){continue;}
  let denom=robustCross(v,w);var c=vec2f(-1.);
  if(abs(denom)<=epsilon*max(lengthV,length(w))&&(distanceTo(b-a,vec2f(0),v)<=epsilon||distanceTo(t.b.xz-a,vec2f(0),v)<=epsilon)){c=vec2f(dot(b-a,v),dot(t.b.xz-a,v))/dot(v,v);}
  else if(denom!=0.){let u=robustCross(b-a,w)/denom;let q=robustCross(b-a,v)/denom;if(q>=0.&&q<=1.){c.x=u;}}
  for(var k=0u;k<2u;k++){if(c[k]>0.&&c[k]<1.){if(n==128u){error(2u);return;}cuts[n]=c[k];n++;}}
 }
 // Insertion sort is bounded by the per-edge intersection limit, independent of layer size.
 for(var i=1u;i<n;i++){let value=cuts[i];var j=i;while(j>0u){if(cuts[j-1u]<=value){break;}cuts[j]=cuts[j-1u];j--;}cuts[j]=value;}
 for(var i=0u;i+1u<n;i++){let t0=cuts[i];let t1=cuts[i+1u];if((t1-t0)*lengthV<=epsilon){continue;}
  let center=v*((t0+t1)*.5);var duplicate=false;
  var duplicates=candidates(row,a+center-vec2f(cfg.values.y),a+center+vec2f(cfg.values.y));loop{let j=nextCandidate(&duplicates);if(j==NONE){break;}if(j>=id){continue;}let t=source[j];if(validSegment(t)&&distanceTo(center,t.a.xz-a,t.b.xz-a)<=epsilon&&abs(robustCross(v,t.b.xz-t.a.xz))<=epsilon*lengthV){duplicate=true;break;}}
  if(duplicate){continue;}
  let normal=vec2f(-v.y,v.x);let left=filled(center,a,normal,id,r);let right=filled(center,a,-normal,id,r);if(left==right){continue;}
  let first=a+v*select(t1,t0,left);let last=a+v*select(t0,t1,left);if(distance(first,last)<=epsilon){continue;}let out=atomicAdd(&counts[row],1u);if(cfg.size.z!=0u){if(out>=r.w){error(3u);return;}dest[r.z+out]=Segment(vec4f(first.x,s.a.y,first.y,cfg.values.z),vec4f(last.x,s.a.y,last.y,cfg.values.z));}
 }
}
@compute @workgroup_size(64) fn trace(@builtin(global_invocation_id) gid:vec3u,@builtin(num_workgroups) groups:vec3u){
 let id=invocation(gid,groups);if(id>=cfg.size.x){return;}let r=rows[rowAt(id)];let s=source[id];var next=NONE;var turn=-4.;var nearest=cfg.values.x;let v=s.b.xz-s.a.xz;
 var query=candidates(rowAt(id),s.b.xz-vec2f(cfg.values.x),s.b.xz+vec2f(cfg.values.x));loop{let j=nextCandidate(&query);if(j==NONE){break;}if(j==id){continue;}let t=source[j];let gap=distance(s.b.xz,t.a.xz);if(gap>nearest+cfg.values.y){continue;}let w=t.b.xz-t.a.xz;let angle=atan2(cross(v,w),dot(v,w));if(gap<nearest-cfg.values.y||angle>turn){nearest=gap;turn=angle;next=j;}}
 links[id]=vec2u(next,0u);
}
// Reconcile endpoint clusters as a one-to-one assignment. Near-coincident vertices
// must not let two incoming edges consume the same outgoing edge.
@compute @workgroup_size(64) fn claim(@builtin(global_invocation_id) gid:vec3u,@builtin(num_workgroups) groups:vec3u){
 let id=invocation(gid,groups);if(id>=cfg.size.x){return;}let r=rows[rowAt(id)];var winner=NONE;var best=1e30;var turn=-4.;let outgoing=source[id].b.xz-source[id].a.xz;
 var query=candidates(rowAt(id),source[id].a.xz-vec2f(cfg.values.x),source[id].a.xz+vec2f(cfg.values.x));loop{let j=nextCandidate(&query);if(j==NONE){break;}if(links[j].x!=id){continue;}let s=source[j];let gap=distance(s.b.xz,source[id].a.xz);let v=s.b.xz-s.a.xz;let angle=atan2(cross(v,outgoing),dot(v,outgoing));if(gap<best-cfg.values.y||(abs(gap-best)<=cfg.values.y&&(angle>turn||(angle==turn&&j<winner)))){winner=j;best=gap;turn=angle;}}
 links[id].y=winner;if(winner==NONE){atomicAdd(&counts[rowAt(id)],1u);}
}
@compute @workgroup_size(64) fn rematch(@builtin(global_invocation_id) gid:vec3u,@builtin(num_workgroups) groups:vec3u){
 let id=invocation(gid,groups);if(id>=cfg.size.x){return;}let old=links[id].x;if(old!=NONE&&links[old].y==id){return;}let r=rows[rowAt(id)];let s=source[id];let v=s.b.xz-s.a.xz;var next=NONE;var nearest=cfg.values.x;var turn=-4.;
 var query=candidates(rowAt(id),s.b.xz-vec2f(cfg.values.x),s.b.xz+vec2f(cfg.values.x));loop{let j=nextCandidate(&query);if(j==NONE){break;}if(j==id||links[j].y!=NONE){continue;}let t=source[j];let gap=distance(s.b.xz,t.a.xz);if(gap>nearest+cfg.values.y){continue;}let w=t.b.xz-t.a.xz;let angle=atan2(cross(v,w),dot(v,w));if(gap<nearest-cfg.values.y||angle>turn){nearest=gap;turn=angle;next=j;}}
 links[id].x=next;
}

fn chordOK(first:u32,end:u32,r:vec4u)->bool{
 let a=source[first].a.xz;let b=source[links[end].x].a.xz;var at=first;
 for(var step=0u;step<r.y;step++){let s=source[at];if(max(distanceTo(s.a.xz,a,b),distanceTo(s.b.xz,a,b))+length(b-a)*.000001>cfg.values.x){return false;}if(at==end){break;}at=links[at].x;}
 // Do not cross another boundary or erase a nearby hole. A local tolerance alone is insufficient.
 let v=b-a;
 var query=candidates(rowAt(first),min(a,b),max(a,b));loop{let j=nextCandidate(&query);if(j==NONE){break;}let s=source[j];let c=s.a.xz;let d=s.b.xz;if(any(max(a,b)<min(c,d))||any(max(c,d)<min(a,b))){continue;}
  let w=d-c;let den=cross(v,w);if(abs(den)<=cfg.values.y){continue;}let t=cross(c-a,w)/den;let u=cross(c-a,v)/den;
  if(t>cfg.values.y&&t<1.-cfg.values.y&&u>cfg.values.y&&u<1.-cfg.values.y){return false;}}
 return true;
}


@compute @workgroup_size(64) fn rootInit(@builtin(global_invocation_id) gid:vec3u,@builtin(num_workgroups) groups:vec3u){let id=invocation(gid,groups);if(id>=cfg.size.x){return;}let at=cfg.size.x*2u+id*2u;partners[at]=links[id].x;partners[at+1u]=id;}
@compute @workgroup_size(64) fn rootStep(@builtin(global_invocation_id) gid:vec3u,@builtin(num_workgroups) groups:vec3u){
 let id=invocation(gid,groups);if(id>=cfg.size.x){return;}let inputOffset=(1u+u32(cfg.values.w))*cfg.size.x*2u;let outputOffset=(2u-u32(cfg.values.w))*cfg.size.x*2u;let next=partners[inputOffset+id*2u];let a=partners[inputOffset+id*2u+1u];let b=partners[inputOffset+next*2u+1u];let p=source[a].a.xz;let q=source[b].a.xz;let root=select(a,b,q.x<p.x||(q.x==p.x&&(q.y<p.y||(q.y==p.y&&b<a))));partners[outputOffset+id*2u]=partners[inputOffset+next*2u];partners[outputOffset+id*2u+1u]=root;
}
@compute @workgroup_size(64) fn chordPlan(@builtin(global_invocation_id) gid:vec3u,@builtin(num_workgroups) groups:vec3u){
 let id=invocation(gid,groups);if(id>=cfg.size.x){return;}let r=rows[rowAt(id)];var end=id;var steps=1u;
 while(steps<32u){let candidate=links[end].x;if(candidate==id||!chordOK(id,candidate,r)){break;}end=candidate;steps++;}
 partners[id*2u]=end;partners[id*2u+1u]=steps;
}
@compute @workgroup_size(64) fn simplify(@builtin(global_invocation_id) gid:vec3u,@builtin(num_workgroups) groups:vec3u){
 let id=invocation(gid,groups);if(id>=cfg.size.x){return;}let row=rowAt(id);let r=rows[row];var root=id;var at=id;var area=0.;var lengthLoop=0u;let origin=source[id].a.xz;if(cfg.values.w>=0.){root=partners[(1u+u32(cfg.values.w))*cfg.size.x*2u+id*2u+1u];if(root!=id){return;}}
 for(var step=0u;step<=r.y;step++){let s=source[at];area+=cross(s.a.xz-origin,s.b.xz-origin);lengthLoop++;let rp=source[root].a.xz;let ap=s.a.xz;if(ap.x<rp.x||(ap.x==rp.x&&(ap.y<rp.y||(ap.y==rp.y&&at<root)))){root=at;}at=links[at].x;if(at==NONE){return;}if(at==id){break;}}
 if(at!=id){error(5u);return;}if(root!=id){return;}if(lengthLoop<3u||abs(area)<=cfg.values.y*cfg.values.y){return;}
 var anchor=id;var consumed=0u;var emitted=0u;
 while(consumed<lengthLoop){var end=partners[anchor*2u];var steps=partners[anchor*2u+1u];
  // Leave enough original edges to retain at least three vertices in a closed polygon.
  let maximum=select(lengthLoop-consumed,lengthLoop-consumed-(3u-emitted-1u),emitted<2u);
  if(steps>maximum){end=anchor;steps=1u;while(steps<maximum){end=links[end].x;steps++;}}else if(steps==32u){while(steps<maximum){let candidate=links[end].x;if(!chordOK(anchor,candidate,r)){break;}end=candidate;steps++;}}
  let index=atomicAdd(&counts[row],1u);let s=source[anchor];let t=source[end];let sign=select(-1.,1.,area>0.);dest[r.z+index]=Segment(s.a,vec4f(source[links[end].x].a.xyz,sign*cfg.values.z));
  consumed+=steps;emitted++;anchor=links[end].x;
 }
}


@group(0) @binding(7) var<storage,read_write> buckets:array<u32>;
@group(0) @binding(8) var<storage,read_write> bucketRows:array<atomic<u32>>;
fn ordered(v:f32)->u32{let bits=bitcast<u32>(v);return select(bits^0x80000000u,~bits,(bits&0x80000000u)!=0u);}
fn coordinate(bits:u32)->f32{return bitcast<f32>(select(bits^0x80000000u,~bits,(bits&0x80000000u)==0u));}
fn bin(row:u32,value:f32,axis:u32)->u32{let at=row*cfg.grid.z+axis*2u;let lo=coordinate(atomicLoad(&bucketRows[at]));let hi=coordinate(atomicLoad(&bucketRows[at+1u]));return u32(clamp(floor((value-lo)/max(hi-lo,1e-6)*f32(cfg.grid[axis])),0.,f32(cfg.grid[axis]-1u)));}
struct Candidates{row:u32,loX:u32,hiX:u32,loZ:u32,hiZ:u32,x:u32,z:u32,cx:u32,cz:u32,index:u32,end:u32};
fn candidates(row:u32,lo:vec2f,hi:vec2f)->Candidates{let x=u32(max(0,i32(bin(row,lo.x,0u))-1));let z=u32(max(0,i32(bin(row,lo.y,1u))-1));return Candidates(row,x,min(cfg.grid.x-1u,bin(row,hi.x,0u)+1u),z,min(cfg.grid.y-1u,bin(row,hi.y,1u)+1u),x,z,0u,0u,0u,0u);}
fn nextCandidate(q:ptr<function,Candidates>)->u32{
 loop{if((*q).index<(*q).end){let id=buckets[(*q).index];(*q).index++;let lo=min(source[id].a.xz,source[id].b.xz);if((*q).cx==max((*q).loX,bin((*q).row,lo.x,0u))&&(*q).cz==max((*q).loZ,bin((*q).row,lo.y,1u))){return id;}continue;}
  if((*q).x>(*q).hiX){(*q).x=(*q).loX;(*q).z++;}if((*q).z>(*q).hiZ){return NONE;}let at=(*q).row*cfg.grid.z;let cell=(*q).z*cfg.grid.x+(*q).x;let cells=cfg.grid.x*cfg.grid.y;(*q).index=atomicLoad(&bucketRows[at+6u+cells+cell]);(*q).end=(*q).index+atomicLoad(&bucketRows[at+6u+cell]);(*q).cx=(*q).x;(*q).cz=(*q).z;(*q).x++;
 }
}
@compute @workgroup_size(64) fn indexBounds(@builtin(global_invocation_id) gid:vec3u,@builtin(num_workgroups) groups:vec3u){
 let id=invocation(gid,groups);if(id>=cfg.size.x){return;}let s=source[id];if(!validSegment(s)){return;}let at=rowAt(id)*cfg.grid.z;atomicMin(&bucketRows[at],ordered(min(s.a.x,s.b.x)));atomicMax(&bucketRows[at+1u],ordered(max(s.a.x,s.b.x)));atomicMin(&bucketRows[at+2u],ordered(min(s.a.z,s.b.z)));atomicMax(&bucketRows[at+3u],ordered(max(s.a.z,s.b.z)));
}
@compute @workgroup_size(64) fn indexCount(@builtin(global_invocation_id) gid:vec3u,@builtin(num_workgroups) groups:vec3u){
 let id=invocation(gid,groups);if(id>=cfg.size.x){return;}let s=source[id];if(!validSegment(s)){return;}let row=rowAt(id);let lo=min(s.a.xz,s.b.xz);let hi=max(s.a.xz,s.b.xz);let control=cfg.size.y*cfg.grid.z;let size=(bin(row,hi.x,0u)-bin(row,lo.x,0u)+1u)*(bin(row,hi.y,1u)-bin(row,lo.y,1u)+1u);let before=atomicAdd(&bucketRows[control+1u],size);if(before>16777216u||size>16777216u-min(before,16777216u)){atomicStore(&bucketRows[control+2u],1u);return;}if(atomicLoad(&bucketRows[control+2u])!=0u){return;}
 for(var z=bin(row,lo.y,1u);z<=bin(row,hi.y,1u);z++){for(var x=bin(row,lo.x,0u);x<=bin(row,hi.x,0u);x++){atomicAdd(&bucketRows[row*cfg.grid.z+6u+z*cfg.grid.x+x],1u);}}
}
var<workgroup> binScan:array<u32,64>;var<workgroup> binBase:u32;
@compute @workgroup_size(64) fn indexPrefix(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_id) local:vec3u,@builtin(num_workgroups) groups:vec3u){
 let row=cfg.size.w/64u+group.x+group.y*groups.x;if(row>=cfg.size.y){return;}let lane=local.x;let at=row*cfg.grid.z;let cells=cfg.grid.x*cfg.grid.y;let span=(cells+63u)/64u;let first=lane*span;let last=min(cells,first+span);var sum=0u;for(var i=first;i<last;i++){sum+=atomicLoad(&bucketRows[at+6u+i]);}binScan[lane]=sum;workgroupBarrier();
 for(var step=1u;step<64u;step*=2u){var value=0u;if(lane>=step){value=binScan[lane-step];}workgroupBarrier();binScan[lane]+=value;workgroupBarrier();}
 if(lane==0u){binBase=atomicAdd(&bucketRows[cfg.size.y*cfg.grid.z],binScan[63]);}workgroupBarrier();var offset=binBase;if(lane>0u){offset+=binScan[lane-1u];}for(var i=first;i<last;i++){atomicStore(&bucketRows[at+6u+cells+i],offset);offset+=atomicLoad(&bucketRows[at+6u+i]);}
}
@compute @workgroup_size(64) fn indexEdges(@builtin(global_invocation_id) gid:vec3u,@builtin(num_workgroups) groups:vec3u){
 let id=invocation(gid,groups);if(id>=cfg.size.x){return;}let s=source[id];if(!validSegment(s)){return;}let row=rowAt(id);let at=row*cfg.grid.z;let cells=cfg.grid.x*cfg.grid.y;let lo=min(s.a.xz,s.b.xz);let hi=max(s.a.xz,s.b.xz);
 for(var z=bin(row,lo.y,1u);z<=bin(row,hi.y,1u);z++){for(var x=bin(row,lo.x,0u);x<=bin(row,hi.x,0u);x++){let cell=z*cfg.grid.x+x;let cursor=atomicAdd(&bucketRows[at+6u+cells*2u+cell],1u);buckets[atomicLoad(&bucketRows[at+6u+cells+cell])+cursor]=id;}}
}
@group(0) @binding(6) var<storage,read_write> partners:array<u32>;
fn partner(end:u32)->u32{let value=partners[end];return select(NONE,value-1u,value>0u);}
@compute @workgroup_size(64) fn ldniCount(@builtin(global_invocation_id) gid:vec3u,@builtin(num_workgroups) groups:vec3u){let id=invocation(gid,groups);if(id<cfg.size.x&&validSegment(source[id])){atomicAdd(&counts[rowAt(id)],1u);}}
@compute @workgroup_size(64) fn ldniPack(@builtin(global_invocation_id) gid:vec3u,@builtin(num_workgroups) groups:vec3u){let id=invocation(gid,groups);if(id<cfg.size.x&&validSegment(source[id])){let row=rowAt(id);dest[rows[row].z+atomicAdd(&counts[row],1u)]=source[id];}}

@compute @workgroup_size(64) fn rawClaim(@builtin(global_invocation_id) gid:vec3u,@builtin(num_workgroups) groups:vec3u){
 let id=invocation(gid,groups);if(id>=cfg.size.x||!validSegment(source[id])){return;}
 for(var e=0u;e<2u;e++){let end=id*2u+e;if(partners[end]!=0u){continue;}let other=links[id][e];if(other!=NONE&&links[other/2u][other%2u]==end){partners[end]=other+1u;}}
}
@compute @workgroup_size(64) fn rawNext(@builtin(global_invocation_id) gid:vec3u,@builtin(num_workgroups) groups:vec3u){
 let id=invocation(gid,groups);if(id>=cfg.size.x){return;}let row=rowAt(id);let r=rows[row];let s=source[id];var pair=vec2u(NONE);
 if(validSegment(s)){for(var end=0u;end<2u;end++){var chosen=partner(id*2u+end);if(chosen==NONE){let p=point(s,end);var best=cfg.values.x;
  var query=candidates(row,p-vec2f(cfg.values.x),p+vec2f(cfg.values.x));loop{let j=nextCandidate(&query);if(j==NONE){break;}let t=source[j];if(j==id||t.b.w!=s.b.w||!validSegment(t)){continue;}for(var e=0u;e<2u;e++){if(partners[j*2u+e]!=0u){continue;}let delta=distance(p,point(t,e));if(delta<best||(delta==best&&j*2u+e<chosen)){best=delta;chosen=j*2u+e;}}}}
  pair[end]=chosen;}}
 links[id]=pair;
}

@compute @workgroup_size(64) fn augment(@builtin(global_invocation_id) gid:vec3u,@builtin(num_workgroups) groups:vec3u){
 let row=invocation(gid,groups);if(row>=cfg.size.y){return;}let r=rows[row];var probes=0u;
 for(var root=r.x;root<r.x+r.y;root++){
  let chosen=links[root].x;if(chosen!=NONE&&links[chosen].y==root){continue;}links[root].x=NONE;
  var queue:array<u32,128>;var parent:array<u32,128>;var via:array<u32,128>;queue[0]=root;parent[0]=NONE;var tail=1u;var done=false;
  for(var head=0u;head<tail&&!done;head++){
   let incoming=queue[head];let s=source[incoming];let v=s.b.xz-s.a.xz;var free=NONE;var nearest=cfg.values.x;var turn=-4.;
   var query=candidates(row,s.b.xz-vec2f(cfg.values.x),s.b.xz+vec2f(cfg.values.x));loop{let j=nextCandidate(&query);if(j==NONE){break;}probes++;if(probes>1048576u){return;}if(j==incoming){continue;}let t=source[j];let gap=distance(s.b.xz,t.a.xz);if(gap>cfg.values.x+cfg.values.y){continue;}
    let winner=links[j].y;if(winner==NONE){let w=t.b.xz-t.a.xz;let angle=atan2(cross(v,w),dot(v,w));if(free==NONE||gap<nearest-cfg.values.y||(abs(gap-nearest)<=cfg.values.y&&angle>turn)){free=j;nearest=gap;turn=angle;}}
    else if(tail<128u){var seen=false;for(var k=0u;k<tail;k++){if(queue[k]==winner){seen=true;break;}}if(!seen){queue[tail]=winner;parent[tail]=head;via[tail]=j;tail++;}}
   }
   if(free!=NONE){var at=head;var out=free;loop{let edge=queue[at];links[edge].x=out;links[out].y=edge;if(at==0u){break;}out=via[at];at=parent[at];}done=true;}
  }
 }
}

@compute @workgroup_size(64) fn repairBoundary(@builtin(global_invocation_id) gid:vec3u,@builtin(num_workgroups) groups:vec3u){
 let id=invocation(gid,groups);if(id>=cfg.size.x){return;}let row=rowAt(id);let r=rows[row];let s=source[id];let out=atomicAdd(&counts[row],1u);dest[r.z+out]=s;
 let successor=links[id].x;if(successor!=NONE&&links[successor].y==id){return;}var start=id;var found=false;
 for(var step=0u;step<=r.y;step++){let previous=links[start].y;if(previous==NONE||links[previous].x!=start){found=true;break;}start=previous;}
 if(!found){error(1u);return;}let a=s.b.xz;let b=source[start].a.xz;let v=b-a;if(length(v)<=cfg.values.y){return;}
 var query=candidates(row,min(a,b),max(a,b));loop{let j=nextCandidate(&query);if(j==NONE){break;}let t=source[j];let c=t.a.xz;let w=t.b.xz-c;let den=robustCross(v,w);if(den==0.){continue;}let u=robustCross(c-a,w)/den;let q=robustCross(c-a,v)/den;let margin=min(.5,cfg.values.x/max(length(v),cfg.values.y));let otherMargin=min(.5,cfg.values.x/max(length(w),cfg.values.y));if(u>margin&&u<1.-margin&&q>otherMargin&&q<1.-otherMargin){error(1u);return;}}
 let index=atomicAdd(&counts[row],1u);dest[r.z+index]=Segment(s.b,source[start].a);
}
`;

// Adaptive LDNI in the layer plane. Depths and geometric tangents are sampled at
// source events; neighboring depth crossings add exact adaptive ray levels.
const ldniShader=`
struct Segment{a:vec4f,b:vec4f};
struct Config{size:vec4u,sort:vec4u,values:vec4f};
@group(0) @binding(0) var<storage,read> source:array<Segment>;
// source start/count, padded depth-sort start/count
@group(0) @binding(1) var<storage,read> rows:array<vec4u>;
@group(0) @binding(2) var<storage,read_write> levels:array<f32>;
@group(0) @binding(3) var<storage,read_write> tasks:array<vec4u>;
@group(0) @binding(4) var<storage,read_write> counts:array<atomic<u32>>;
@group(0) @binding(5) var<storage,read> outputRows:array<vec4u>;
@group(0) @binding(6) var<storage,read_write> output:array<Segment>;
@group(0) @binding(7) var<uniform> cfg:Config;
@group(0) @binding(8) var<storage,read_write> bins:array<atomic<u32>>;
const NONE=0xffffffffu;
const BIN_COUNT=128u;
const BIN_STRIDE=388u;
fn invocation(id:vec3u,groups:vec3u)->u32{return id.x+id.y*groups.x*128u;}
fn rowAt(id:u32)->u32{var lo=0u;var hi=cfg.size.y;while(lo<hi){let mid=(lo+hi)/2u;if(rows[mid].z+rows[mid].w<=id){lo=mid+1u;}else{hi=mid;}}return lo;}
fn sourceRow(id:u32)->u32{var lo=0u;var hi=cfg.size.y;while(lo<hi){let mid=(lo+hi)/2u;if(rows[mid].x+rows[mid].y<=id){lo=mid+1u;}else{hi=mid;}}return lo;}
fn binAt(row:u32,z:f32)->u32{let base=row*BIN_STRIDE;let low=bitcast<f32>(atomicLoad(&bins[base]));let high=bitcast<f32>(atomicLoad(&bins[base+1u]));return u32(clamp((z-low)/max(high-low,1e-20)*f32(BIN_COUNT),0.,f32(BIN_COUNT-1u)));}
@compute @workgroup_size(128) fn binBounds(@builtin(global_invocation_id) gid:vec3u,@builtin(num_workgroups) groups:vec3u){let row=invocation(gid,groups);if(row>=cfg.size.y){return;}let r=rows[row];var lo=r.z;var hi=r.z+r.w;while(lo<hi){let mid=(lo+hi)/2u;if(levels[mid]<1e30){lo=mid+1u;}else{hi=mid;}}let base=row*BIN_STRIDE;atomicStore(&bins[base],bitcast<u32>(levels[r.z]));atomicStore(&bins[base+1u],bitcast<u32>(levels[max(r.z,lo-1u)]));}
@compute @workgroup_size(128) fn binCount(@builtin(global_invocation_id) gid:vec3u,@builtin(num_workgroups) groups:vec3u){let id=invocation(gid,groups);if(id>=cfg.sort.z){return;}let row=sourceRow(id);let s=source[id];if(!valid(s)||s.a.z==s.b.z){return;}let a=binAt(row,min(s.a.z,s.b.z));let b=binAt(row,max(s.a.z,s.b.z));for(var bin=a;bin<=b;bin++){atomicAdd(&bins[row*BIN_STRIDE+4u+bin*3u],1u);}}
@compute @workgroup_size(128) fn binPrefix(@builtin(global_invocation_id) gid:vec3u,@builtin(num_workgroups) groups:vec3u){let row=invocation(gid,groups);if(row>=cfg.size.y){return;}for(var bin=0u;bin<BIN_COUNT;bin++){let at=row*BIN_STRIDE+4u+bin*3u;let count=atomicLoad(&bins[at]);let offset=atomicAdd(&counts[cfg.size.y+1u],count);atomicStore(&bins[at+1u],cfg.size.y*BIN_STRIDE+offset);}}
@compute @workgroup_size(128) fn binEmit(@builtin(global_invocation_id) gid:vec3u,@builtin(num_workgroups) groups:vec3u){let id=invocation(gid,groups);if(id>=cfg.sort.z){return;}let row=sourceRow(id);let s=source[id];if(!valid(s)||s.a.z==s.b.z){return;}let a=binAt(row,min(s.a.z,s.b.z));let b=binAt(row,max(s.a.z,s.b.z));for(var bin=a;bin<=b;bin++){let at=row*BIN_STRIDE+4u+bin*3u;let i=atomicAdd(&bins[at+2u],1u);atomicStore(&bins[atomicLoad(&bins[at+1u])+i],id);}}
fn valid(s:Segment)->bool{return s.a.w>0.&&distance(s.a.xz,s.b.xz)>cfg.values.x;}
fn depth(s:Segment,z:f32)->f32{if(z==s.a.z){return s.a.x;}if(z==s.b.z){return s.b.x;}let t=(z-s.a.z)/(s.b.z-s.a.z);return s.a.x+(s.b.x-s.a.x)*t;}
fn slope(s:Segment)->f32{return (s.b.x-s.a.x)/(s.b.z-s.a.z);}
@compute @workgroup_size(128) fn sampleLevels(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){let i=invocation(id,groups);if(i>=cfg.size.x){return;}let r=rows[rowAt(i)];let k=i-r.z;var z=3.402823e38;if(k<r.y*2u){let s=source[r.x+k/2u];if(valid(s)){z=select(s.a.z,s.b.z,k%2u!=0u);}}levels[i]=z;}
@compute @workgroup_size(128) fn sortLevels(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){let i=invocation(id,groups);if(i>=cfg.size.x){return;}let r=rows[rowAt(i)];let local=i-r.z;let other=local^cfg.sort.x;if(other>=r.w||other<=local){return;}let j=r.z+other;let a=levels[i];let b=levels[j];let ascending=(local&cfg.sort.y)==0u;if((a>b)==ascending){levels[i]=b;levels[j]=a;}}
@compute @workgroup_size(128) fn rayTasks(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){let i=invocation(id,groups);if(i>=cfg.size.x){return;}let row=rowAt(i);let r=rows[row];let z=levels[i];if(z>1e30||(i>r.z&&z==levels[i-1u])){return;}var next=i+1u;while(next<r.z+r.w&&levels[next]==z){next++;}var high=z;if(next<r.z+r.w&&levels[next]<1e30){high=levels[next];}let at=atomicAdd(&counts[cfg.size.y+1u],1u);if(cfg.size.w!=0u){tasks[at]=vec4u(row,bitcast<u32>(z),bitcast<u32>(high),0);}}
var<workgroup> ids:array<u32,1024>;
var<workgroup> depths:array<f32,1024>;
var<workgroup> tangents:array<f32,1024>;
var<workgroup> eventCount:atomic<u32>;
var<workgroup> count:u32;
var<workgroup> cursor:f32;
var<workgroup> finish:f32;
var<workgroup> nextLevel:f32;
fn less(a:u32,b:u32)->bool{let A=depths[a];let B=depths[b];if(A!=B){return A<B;}let u=tangents[a];let v=tangents[b];if(u!=v){return u<v;}let i=ids[a];let j=ids[b];if(i==NONE||j==NONE){return i<j;}let x=source[i].b.w;let y=source[j].b.w;if(x!=y){return x<y;}return i<j;}
fn sortEvents(lane:u32){let total=workgroupUniformLoad(&count);var length=1u;while(length<total){length*=2u;}for(var size=2u;size<=length;size*=2u){var step=size/2u;while(step>0u){for(var i=lane;i<length;i+=128u){let j=i^step;if(j>i){let ascending=(i&size)==0u;if(less(j,i)==ascending){let a=ids[i];let x=depths[i];let n=tangents[i];ids[i]=ids[j];depths[i]=depths[j];tangents[i]=tangents[j];ids[j]=a;depths[j]=x;tangents[j]=n;}}}workgroupBarrier();step/=2u;}}}
fn emit(row:u32,A:vec2f,B:vec2f,y:f32){let a=A;let b=B;if(distance(a,b)<=cfg.values.x){return;}let at=atomicAdd(&counts[row],1u);if(cfg.size.w!=0u){let r=outputRows[row];if(at>=r.y){atomicMax(&counts[cfg.size.y],2u);return;}output[r.x+at]=Segment(vec4f(a.x,y,a.y,cfg.values.y),vec4f(b.x,y,b.y,cfg.values.y));}}
fn spanAt(id:u32)->u32{return cfg.sort.w+id*7u;}
fn ordered(x:f32)->u32{let b=bitcast<u32>(x);return select(b^0x80000000u,~b,(b&0x80000000u)!=0u);}
fn unordered(b:u32)->f32{return bitcast<f32>(select(~b,b^0x80000000u,(b&0x80000000u)!=0u));}
@compute @workgroup_size(128) fn initSpans(@builtin(global_invocation_id) gid:vec3u,@builtin(num_workgroups) groups:vec3u){let id=invocation(gid,groups);if(id>=cfg.sort.z){return;}let a=spanAt(id);atomicStore(&bins[a],16777216u);atomicStore(&bins[a+4u],0xffffffffu);}
fn continuous(a:u32)->bool{return atomicLoad(&bins[a+2u])==atomicLoad(&bins[a+1u])-atomicLoad(&bins[a])&&atomicLoad(&bins[a+6u])!=3u;}
@compute @workgroup_size(128) fn spanCounts(@builtin(global_invocation_id) gid:vec3u,@builtin(num_workgroups) groups:vec3u){let id=invocation(gid,groups);if(id>=cfg.sort.z){return;}let a=spanAt(id);let pieces=atomicLoad(&bins[a+3u]);if(pieces==0u){return;}atomicAdd(&counts[sourceRow(id)],select(pieces,1u,continuous(a)));}
fn emitSide(row:u32,id:u32,low:f32,high:f32,down:bool){let s=source[id];let z0=min(s.a.z,s.b.z);let z1=max(s.a.z,s.b.z);let t0=u32(clamp(round((low-z0)/(z1-z0)*16777216.),0.,16777216.));let t1=u32(clamp(round((high-z0)/(z1-z0)*16777216.),0.,16777216.));if(distance(vec2f(depth(s,low),low),vec2f(depth(s,high),high))<=cfg.values.x){return;}let a=spanAt(id);
 if(cfg.size.w==0u){atomicMin(&bins[a],t0);atomicMax(&bins[a+1u],t1);atomicAdd(&bins[a+2u],t1-t0);atomicAdd(&bins[a+3u],1u);atomicMin(&bins[a+4u],ordered(low));atomicMax(&bins[a+5u],ordered(high));atomicOr(&bins[a+6u],select(2u,1u,down));return;}
 var lo=low;var hi=high;if(continuous(a)){lo=unordered(atomicLoad(&bins[a+4u]));if(low!=lo){return;}hi=unordered(atomicLoad(&bins[a+5u]));}let A=vec2f(depth(s,lo),lo);let B=vec2f(depth(s,hi),hi);if(down){emit(row,B,A,s.a.y);}else{emit(row,A,B,s.a.y);}
}

fn ownerMask(id:u32)->vec2u{let owner=u32(source[id].b.w)-1u;return vec2u(owner/32u,1u<<(owner%32u));}
fn horizontal(row:u32,z:f32){var above:array<u32,8>;var below:array<u32,8>;var activeA=0;var activeB=0;var i=0u;
 while(i<count){let x=depths[i];var group=i;while(group<count&&abs(depths[group]-x)<=cfg.values.x){var j=group+1u;let sid=ids[group];let s=source[sid];let mask=ownerMask(sid);var A=min(s.a.z,s.b.z)<=z&&max(s.a.z,s.b.z)>z;var B=min(s.a.z,s.b.z)<z&&max(s.a.z,s.b.z)>=z;
  // Coincident, collinear samples from the same occurrence are one event.
  while(j<count&&abs(depths[j]-depths[group])<=cfg.values.x&&abs(tangents[j]-tangents[group])<=1e-6&&source[ids[j]].b.w==s.b.w){let t=source[ids[j]];A=A||(min(t.a.z,t.b.z)<=z&&max(t.a.z,t.b.z)>z);B=B||(min(t.a.z,t.b.z)<z&&max(t.a.z,t.b.z)>=z);j++;}
  if(A){activeA+=select(1,-1,(above[mask.x]&mask.y)!=0u);above[mask.x]^=mask.y;}if(B){activeB+=select(1,-1,(below[mask.x]&mask.y)!=0u);below[mask.x]^=mask.y;}group=j;
 }if(group<count&&(activeA>0)!=(activeB>0)){let X=depths[group];if(activeA>0){emit(row,vec2f(x,z),vec2f(X,z),source[ids[i]].a.y);}else{emit(row,vec2f(X,z),vec2f(x,z),source[ids[i]].a.y);}}i=group;
 }if(activeA!=0||activeB!=0){atomicMax(&counts[cfg.size.y],3u+row*16u);}
}
fn sideBoundaries(row:u32,low:f32,high:f32){var owners:array<u32,8>;var filledCount=0;var i=0u;let middle=low+(high-low)*.5;
 while(i<count){let first=i;let x=depth(source[ids[i]],middle);let old=filledCount;var chosen=ids[i];var j=i;
  while(j<count&&abs(depth(source[ids[j]],middle)-x)<=cfg.values.x){let sid=ids[j];let s=source[sid];let mask=ownerMask(sid);var end=j+1u;while(end<count&&abs(depth(source[ids[end]],middle)-x)<=cfg.values.x&&abs(tangents[end]-tangents[j])<=1e-6&&source[ids[end]].b.w==s.b.w){end++;}filledCount+=select(1,-1,(owners[mask.x]&mask.y)!=0u);owners[mask.x]^=mask.y;chosen=sid;j=end;}
  if((old>0)!=(filledCount>0)){let s=source[chosen];emitSide(row,chosen,low,high,filledCount>0);}i=j;
 }if(filledCount!=0){atomicMax(&counts[cfg.size.y],3u+row*16u);}
}
@compute @workgroup_size(128) fn intervals(@builtin(workgroup_id) gid:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(num_workgroups) groups:vec3u){let task=gid.x+gid.y*groups.x;if(task>=cfg.size.z){return;}let item=tasks[task];let row=item.x;let r=rows[row];let low=bitcast<f32>(item.y);let high=bitcast<f32>(item.z);let bin=row*BIN_STRIDE+4u+binAt(row,low)*3u;let candidateCount=atomicLoad(&bins[bin]);let candidateOffset=atomicLoad(&bins[bin+1u]);
 // First resolve the material immediately above and below an event ray.
 if(lane==0u){atomicStore(&eventCount,0u);}workgroupBarrier();for(var k=lane;k<candidateCount;k+=128u){let id=atomicLoad(&bins[candidateOffset+k]);let s=source[id];if(!valid(s)||s.a.z==s.b.z||min(s.a.z,s.b.z)>low||max(s.a.z,s.b.z)<low){continue;}let i=atomicAdd(&eventCount,1u);if(i<1024u){ids[i]=id;depths[i]=depth(s,low);tangents[i]=slope(s);}}
 workgroupBarrier();if(lane==0u){count=atomicLoad(&eventCount);if(count>1024u){atomicMax(&counts[cfg.size.y],1u);}}workgroupBarrier();if(workgroupUniformLoad(&count)>1024u){return;}for(var i=count+lane;i<1024u;i+=128u){ids[i]=NONE;depths[i]=3.402823e38;tangents[i]=0.;}workgroupBarrier();sortEvents(lane);if(lane==0u){horizontal(row,low);cursor=low;finish=high;}workgroupBarrier();if(workgroupUniformLoad(&finish)<=workgroupUniformLoad(&cursor)){return;}
 // No source endpoint lies inside this strip. Ordered depth/tangent events
 // therefore remain affine until two adjacent samples exchange order.
 for(var iteration=0u;iteration<1024u;iteration++){
  if(lane==0u){atomicStore(&eventCount,0u);}workgroupBarrier();for(var k=lane;k<candidateCount;k+=128u){let id=atomicLoad(&bins[candidateOffset+k]);let s=source[id];if(!valid(s)||s.a.z==s.b.z||min(s.a.z,s.b.z)>low||max(s.a.z,s.b.z)<high){continue;}let i=atomicAdd(&eventCount,1u);if(i<1024u){ids[i]=id;depths[i]=depth(s,cursor);tangents[i]=slope(s);}}
  workgroupBarrier();if(lane==0u){count=atomicLoad(&eventCount);if(count>1024u){atomicMax(&counts[cfg.size.y],1u);}}workgroupBarrier();if(workgroupUniformLoad(&count)>1024u){return;}for(var i=count+lane;i<1024u;i+=128u){ids[i]=NONE;depths[i]=3.402823e38;tangents[i]=0.;}workgroupBarrier();sortEvents(lane);
  if(lane==0u){nextLevel=finish;for(var i=1u;i<count;i++){let ds=tangents[i-1u]-tangents[i];if(ds<=0.){continue;}let dz=(depths[i]-depths[i-1u])/ds;let z=cursor+dz;if(z>cursor+cfg.values.x&&z<nextLevel){nextLevel=z;}}sideBoundaries(row,cursor,nextLevel);cursor=nextLevel;}
  workgroupBarrier();if(workgroupUniformLoad(&cursor)>=workgroupUniformLoad(&finish)){return;}
 }if(lane==0u){atomicMax(&counts[cfg.size.y],4u);}
}`;

const previewShader=`
struct Camera{rotation:mat4x4f,centerScale:vec4f,viewport:vec4f,clip:vec4f,frame:vec4f,modes:vec4f};
struct Frame{matrix:mat4x4f,inverse:mat4x4f,color:vec4f,settings:vec4f};
@group(0) @binding(0) var<uniform> camera:Camera;
@group(1) @binding(0) var<uniform> frame:Frame;
struct Segment{a:vec4f,b:vec4f};@group(2) @binding(0) var<storage,read> segments:array<Segment>;
override orthographic:bool=false;
struct Output{@builtin(position) position:vec4f,@location(0) color:vec3f};
fn view(p:vec3f)->vec3f{return (camera.rotation*vec4f(((frame.matrix*vec4f(p,1)).xyz-camera.centerScale.xyz)*camera.centerScale.w,1)).xyz;}
fn project(p:vec3f,color:vec3f)->Output{
 let xy=p.xy+camera.viewport.zw;let depth=3.2-p.z;var out:Output;out.color=color;
 if(orthographic){out.position=vec4f(xy.x*camera.viewport.y/camera.viewport.x,xy.y*camera.viewport.y,(depth-camera.clip.x)/(camera.clip.y-camera.clip.x),1);}
 else{out.position=vec4f(xy.x*camera.clip.w/camera.viewport.x,xy.y*camera.clip.w,(camera.clip.y*depth-camera.clip.x*camera.clip.y)/(camera.clip.y-camera.clip.x),depth);}return out;
}
@vertex fn line(@builtin(vertex_index) vertex:u32)->Output{let s=segments[vertex/2u];return project(view(select(s.a.xyz,s.b.xyz,vertex%2u!=0u)),select(vec3f(.96,.48,.24),vec3f(.32,.76,.59),s.b.w>0.));}
@vertex fn axes(@builtin(vertex_index) vertex:u32)->Output{
 let ends=array<vec3f,3>(vec3f(500,0,500),vec3f(-500,1000,500),vec3f(-500,0,-500));
 let colors=array<vec3f,3>(vec3f(.82,.24,.22),vec3f(.28,.71,.34),vec3f(.28,.44,.85));
 return project(view(select(vec3f(-500,0,500),ends[vertex/2u],vertex%2u!=0u)),colors[vertex/2u]);
}
// Physical-width, camera-facing butt-ended quads are retained for the next stage.
// Stage one draws only the line entry point; no polygon preview is submitted.
@vertex fn ribbon(@builtin(vertex_index) vertex:u32)->Output{
 let s=segments[vertex/6u];let corners=array<vec2f,6>(vec2f(0,-1),vec2f(1,-1),vec2f(0,1),vec2f(0,1),vec2f(1,-1),vec2f(1,1));
 let corner=corners[vertex%6u];let a=view(s.a.xyz);let b=view(s.b.xyz);let delta=b.xy-a.xy;let normal=vec2f(-delta.y,delta.x)/max(length(delta),1e-7);
 let direction=vec3f(-(s.b.z-s.a.z),0,s.b.x-s.a.x);let localNormal=direction/max(length(direction),1e-7);
 let width=length((frame.matrix*vec4f(localNormal,0)).xyz)*mix(s.a.w,s.b.w,corner.x)*camera.centerScale.w;
 var p=mix(a,b,corner.x);p.x+=normal.x*width*.5*corner.y;p.y+=normal.y*width*.5*corner.y;
 return project(p,vec3f(.48,.57,.53));
}
@fragment fn fs(input:Output)->@location(0) vec4f{return vec4f(input.color,1);}`;

async function createPreview(context,slicer){
 const d=context.device,module=d.createShaderModule({label:'Printer section lines and orientation',code:previewShader});
 const info=await module.getCompilationInfo();if(info.messages.some(m=>m.type==='error'))throw Error(info.messages.filter(m=>m.type==='error').map(m=>m.message).join('; '));
 const uniformLayout=()=>d.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:'uniform'}}]}),cameraLayout=uniformLayout(),frameLayout=uniformLayout();
 const segmentLayout=d.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}}]});
 const pipeline=async(entryPoint,orthographic)=>d.createRenderPipelineAsync({label:'Printer '+entryPoint,layout:d.createPipelineLayout({bindGroupLayouts:entryPoint==='axes'?[cameraLayout,frameLayout]:[cameraLayout,frameLayout,segmentLayout]}),vertex:{module,entryPoint,constants:{orthographic}},fragment:{module,entryPoint:'fs',targets:[{format:navigator.gpu.getPreferredCanvasFormat()}]},primitive:{topology:'line-list'},depthStencil:{format:'depth24plus',depthWriteEnabled:false,depthCompare:'always'}});
 const lines=await Promise.all([false,true].map(o=>pipeline('line',o))),axes=await Promise.all([false,true].map(o=>pipeline('axes',o)));
 const groups=new WeakMap(),group=(buffer,layout)=>{let cache=groups.get(buffer);if(!cache)groups.set(buffer,cache=new Map());if(!cache.has(layout))cache.set(layout,d.createBindGroup({layout,entries:[{binding:0,resource:{buffer}}]}));return cache.get(layout);};
 return ({pass,camera,frame,orthographic,hash,params})=>{
  pass.setPipeline(axes[orthographic?1:0]);pass.setBindGroup(0,group(camera,cameraLayout));pass.setBindGroup(1,group(frame,frameLayout));pass.draw(6);
  const job=slicer.jobs.get(hash);if(!job)return;
  if(job.result&&slicer.signature(hash)!==job.signature)slicer.invalidate(job);
  if(!job.result)return;
  const start=params['Layer position']>0?Math.round(params['Layer position']):Math.round(params['Start layer']),finish=params['Layer position']>0?start:Math.round(params['Finish layer']);
  pass.setPipeline(lines[orthographic?1:0]);
  for(const batch of job.result.batches){let first=null,last=null;for(const row of batch.rows)if(row.index>=start&&row.index<=finish){first??=row;last=row;}if(!first)continue;
   pass.setBindGroup(2,group(batch.buffer,segmentLayout));pass.draw((last.offset+last.segments-first.offset)*2,1,first.offset*2);
  }
 };
}

class SectionSlicer{
 constructor(context){this.context=context;this.jobs=new Map();this.initialized=new Map();this.serial=0;this.pipelines=new WeakMap();}
 signature(hash){try{return this.context.scene.signature(hash,KEYS);}catch{return null;}}
 config(snapshot){const p=snapshot.params,width=p['Line width'],height=p['Layer height'],initial=p['Initial layer height'];if(!(width>=.01&&width<=100&&height>=.01&&height<=1000&&initial>=.01&&initial<=1000))throw failure('INVALID_ARGUMENT','Invalid printer width or layer heights.');return {width,height,initial};}
 disposeResult(result){for(const batch of result?.batches||[])batch.buffer.destroy();}
 retire(hash){const job=this.jobs.get(hash);if(job){clearTimeout(job.refreshTimer);job.cancelled=true;this.disposeResult(job.result);this.jobs.delete(hash);}this.initialized.delete(hash);}
 check(job){if(job.cancelled)throw failure('CANCELLED','Slicing cancelled.');if(this.signature(job.hash)!==job.signature)throw failure('STALE_JOB','Source geometry, visibility, printer or layer settings changed.');}
 invalidate(job){this.disposeResult(job.result);job.result=null;job.state='stale';try{job.refresh=this.context.scene.capture(job.hash,KEYS).contentSignature===job.contentSignature;}catch{job.refresh=false;}if(job.refresh)this.refresh(job);this.context.requestAttributes();}
 refresh(job){if(job.refreshTimer)return;job.refreshTimer=setTimeout(()=>{job.refreshTimer=0;if(this.jobs.get(job.hash)!==job||!job.refresh)return;if(this.context.scene.transforming){this.refresh(job);return;}job.refresh=false;try{this.start(job.hash,{algorithm:job.algorithm},true);}catch(e){job.state='failed';job.error={code:e.code||'SLICE_FAILED',message:e.message};this.context.requestAttributes();}},32);}
 start(hash,args={},automatic=false){
  const snapshot=this.context.scene.capture(hash,KEYS),options=this.config(snapshot),previous=this.jobs.get(hash);if(previous?.state==='running')throw failure('BUSY','This printer is already slicing.');clearTimeout(previous?.refreshTimer);this.disposeResult(previous?.result);
  const job={id:++this.serial,hash,scene:snapshot.scene,signature:snapshot.signature,contentSignature:snapshot.contentSignature,automatic,options,algorithm:args.algorithm||'triangle-span',state:'running',stage:'count',completed:0,total:0,started:performance.now(),cancelled:false,result:null};this.jobs.set(hash,job);
  this.run(job,snapshot).catch(e=>{job.state=e.code==='CANCELLED'?'cancelled':e.code==='STALE_JOB'?'stale':'failed';job.error={code:e.code||'SLICE_FAILED',message:e.message};if(job.state==='stale'&&job.automatic)this.invalidate(job);}).finally(()=>{job.ms=performance.now()-job.started;this.context.requestAttributes();this.context.requestDraw();});this.context.requestAttributes();return this.status(hash);
 }
 status(hash){const job=this.jobs.get(hash);if(!job)return {state:'idle',result:null};if(job.result&&this.signature(hash)!==job.signature)this.invalidate(job);
  return {id:job.id,state:job.state,stage:job.stage,completed:job.completed,total:job.total,algorithm:job.algorithm,intervalStats:job.intervalStats||null,intervalFallbacks:job.intervalFallbacks||0,ms:job.ms??performance.now()-job.started,error:job.error||null,result:job.result?{layers:job.result.layers,lastLayer:job.result.lastLayer,segments:job.result.segments,peakGPUBytes:job.result.peakGPUBytes,metadataReadBytes:job.result.metadataReadBytes,triangleVisits:job.result.triangleVisits,timings:job.result.timings,preview:{primitive:'line-list',polygonVertices:0},rawSegments:job.result.rawSegments,repairs:job.result.repairs,simplificationTolerance:job.options.width*.02,topology:'closed-even-odd-union',representation:'adaptive-ldni',boundaryTolerance:job.options.width*.2,intervalFallbacks:job.intervalFallbacks||0}:null};
 }
 cancel(hash){const job=this.jobs.get(hash);if(job){clearTimeout(job.refreshTimer);job.refresh=false;if(job.state==='running')job.cancelled=true;}return this.status(hash);}
 attributes(hash){const s=this.status(hash),last=s.result?.lastLayer||3332;return {actions:[{id:'slice',label:'Slice',busy:s.state==='running',progress:s.state==='running'?(s.total?Math.floor(s.completed/s.total*100)+'%':'…'):''}],ranges:{'Start layer':{min:1,max:last,scrubRange:()=>[1,last]},'Finish layer':{min:1,max:last,scrubRange:()=>[1,last]},'Layer position':{min:0,max:s.result?last:0}}};}
 async inspect(hash,layer,offset=0,count){const status=this.status(hash),job=this.jobs.get(hash);if(layer===undefined||!job?.result)return status;const row=job.result.layers.find(r=>r.index===layer);if(!row)return {...status,layer:null};if(offset>row.segments)throw failure('INVALID_ARGUMENT','Section inspection offset is outside the layer.');const take=count===undefined?row.segments-offset:Math.min(count,row.segments-offset);if(take>4096)throw failure('INSPECTION_LIMIT','Inspect at most 4096 section segments per request.');if(!take)return {...status,layer:{...row,segments:0,totalSegments:row.segments,inspectionOffset:offset,data:[],kinds:[]}};
  const batch=job.result.batches[row.batch],d=this.context.device,read=d.createBuffer({size:take*32,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{const e=d.createCommandEncoder();e.copyBufferToBuffer(batch.buffer,(row.offset+offset)*32,read,0,take*32);d.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);const data=Array.from(new Float32Array(read.getMappedRange())),kinds=[];for(let i=0;i<data.length;i+=8){kinds.push(data[i+7]>0?'outer':'inner');data[i+7]=Math.abs(data[i+7]);}read.unmap();this.check(job);return {...status,layer:{...row,segments:take,totalSegments:row.segments,inspectionOffset:offset,data,kinds}};}finally{read.destroy();}
 }
 async kernels(d,texture){let cache=this.pipelines.get(d);if(!cache)this.pipelines.set(d,cache=new Map());if(!cache.has(texture))cache.set(texture,(async()=>{
  const module=d.createShaderModule({label:'Printer GPU plane sections',code:sectionKernel(texture)}),info=await module.getCompilationInfo();if(info.messages.some(m=>m.type==='error'))throw Error(info.messages.filter(m=>m.type==='error').map(m=>m.message).join('; '));
  const entries=[0,1].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,...texture?{texture:{sampleType:'uint',viewDimension:'2d-array'}}:{buffer:{type:'read-only-storage'}}}));entries.push({binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}});for(const binding of [3,4,5,6])entries.push({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:binding===4?'read-only-storage':'storage'}});
  const layout=d.createBindGroupLayout({entries}),pl=d.createPipelineLayout({bindGroupLayouts:[layout]}),pipelines=await Promise.all(['count','emit','scan'].map(entryPoint=>d.createComputePipelineAsync({layout:pl,compute:{module,entryPoint}})));return {layout,count:pipelines[0],emit:pipelines[1],scan:pipelines[2]};
 })());return cache.get(texture);}
 async ldni(job,source,rawRows,make,free){


  const d=this.context.device,started=performance.now();let p=this.ldniPipelines;
  if(!p||p.device!==d){const module=d.createShaderModule({label:'Adaptive LDNI interval Boolean',code:ldniShader}),info=await module.getCompilationInfo();if(info.messages.some(m=>m.type==='error'))throw Error(info.messages.filter(m=>m.type==='error').map(m=>m.message).join('; '));const layout=d.createBindGroupLayout({entries:[0,1,2,3,4,5,6,8].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:[0,1,5].includes(binding)?'read-only-storage':'storage'}})).concat([{binding:7,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform',hasDynamicOffset:true,minBindingSize:48}}])}),plan=d.createPipelineLayout({bindGroupLayouts:[layout]});p={device:d,layout};await Promise.all(['sampleLevels','sortLevels','rayTasks','intervals','binBounds','binCount','binPrefix','binEmit','initSpans','spanCounts'].map(async entryPoint=>p[entryPoint]=await d.createComputePipelineAsync({label:'LDNI '+entryPoint,layout:plan,compute:{module,entryPoint}})));this.ldniPipelines=p;}
  this.check(job);let totalLevels=0;const ranges=rawRows.map(r=>{const length=2**Math.ceil(Math.log2(Math.max(2,r.segments*2))),row=[r.offset,r.segments,totalLevels,length];totalLevels+=length;return row;}),limit=Math.min(d.limits.maxStorageBufferBindingSize,64*1024*1024);if(totalLevels*16>limit)throw failure('LDNI_CAPACITY','Adaptive ray tasks exceed the bounded binding.');
  const scratch=[],alloc=(size,usage,label)=>{const b=make(size,usage,label);scratch.push(b);return b;},storage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC;
  let levels=alloc(totalLevels*4,storage,'Adaptive ray levels');const rows=alloc(ranges.length*16,storage,'LDNI source and sorted-level ranges'),counts=alloc((ranges.length+2)*4,storage,'LDNI bounded counters'),read=alloc(counts.size,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ,'LDNI counter readback'),outputRows=alloc(ranges.length*16,storage,'LDNI output ranges'),dummy=alloc(32,storage,'LDNI count output');
  let tasks=alloc(16,storage,'LDNI task count placeholder'),bins=alloc(ranges.length*388*4,storage,'LDNI active-ray bin metadata');const sourceCount=rawRows.at(-1).offset+rawRows.at(-1).segments;const stride=d.limits.minUniformBufferOffsetAlignment,uniform=alloc(stride*512,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,'LDNI pass configurations');let uniformIndex=0,rays=0,metadataBytes=0,spanOffset=0;
  d.queue.writeBuffer(rows,0,Uint32Array.from(ranges.flat()));
  const bind=output=>d.createBindGroup({layout:p.layout,entries:[source,rows,levels,tasks,counts,outputRows,output,uniform,bins].map((buffer,binding)=>({binding,resource:{buffer,...binding===7?{size:48}:{}}}))}),initialGroup=bind(dummy);let countGroup=initialGroup;
  const dispatch=(pass,name,n,mode=0,sortX=0,sortY=0,group=countGroup)=>{job.stage='ldni:'+name;const config=new ArrayBuffer(48);new Uint32Array(config).set([totalLevels,ranges.length,rays,mode,sortX,sortY,sourceCount,spanOffset]);new Float32Array(config).set([Math.max(1e-7,job.options.width*1e-6),job.options.width,0,0],8);const offset=uniformIndex++*stride;if(offset+48>uniform.size)throw failure('LDNI_CAPACITY','Too many adaptive sorting stages.');d.queue.writeBuffer(uniform,offset,config);pass.setPipeline(p[name]);pass.setBindGroup(0,group,[offset]);const blocks=name==='intervals'?n:Math.ceil(n/128),x=Math.min(blocks,d.limits.maxComputeWorkgroupsPerDimension);if(blocks)pass.dispatchWorkgroups(x,Math.ceil(blocks/x));};
  const metadata=async(summary=false)=>{const e=d.createCommandEncoder(),bytes=summary?8:counts.size;e.copyBufferToBuffer(counts,summary?ranges.length*4:0,read,0,bytes);d.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);const values=new Uint32Array(counts.size/4);values.set(new Uint32Array(read.getMappedRange(),0,bytes/4),summary?ranges.length:0);read.unmap();metadataBytes+=bytes;job.contourReadBytes=(job.contourReadBytes||0)+bytes;this.check(job);const intervalCode=values[ranges.length],code=intervalCode%16;if(code)throw failure(['','LDNI_RAY_LIMIT','LDNI_OUTPUT_LIMIT','LDNI_OPEN_INTERVAL','LDNI_EVENT_LIMIT'][code]||'LDNI_ERROR',['','One adaptive ray exceeds 1024 intersections.','Adaptive contours exceed the allocated output.','Repaired source does not define bounded ray intervals at row '+Math.floor(intervalCode/16)+'.','One strip exceeds 1024 adaptive crossing events.'][code]||'LDNI failed.' +intervalCode);return values;};
  try{
   let encoder=d.createCommandEncoder(),pass=encoder.beginComputePass();dispatch(pass,'sampleLevels',totalLevels);const max=Math.max(...ranges.map(r=>r[3]));for(let size=2;size<=max;size*=2)for(let step=size/2;step>=1;step/=2)dispatch(pass,'sortLevels',totalLevels,0,step,size);dispatch(pass,'rayTasks',totalLevels);pass.end();d.queue.submit([encoder.finish()]);rays=(await metadata(true))[ranges.length+1];
   tasks=alloc(Math.max(16,rays*16),storage,'Compact adaptive event rays');countGroup=bind(dummy);encoder=d.createCommandEncoder();encoder.clearBuffer(counts);pass=encoder.beginComputePass();dispatch(pass,'rayTasks',totalLevels,1);dispatch(pass,'binBounds',ranges.length);dispatch(pass,'binCount',sourceCount);pass.end();d.queue.submit([encoder.finish()]);
   encoder=d.createCommandEncoder();encoder.clearBuffer(counts);pass=encoder.beginComputePass();dispatch(pass,'binPrefix',ranges.length);pass.end();d.queue.submit([encoder.finish()]);const entries=(await metadata(true))[ranges.length+1];free(levels);levels=alloc(16,storage,'Retired adaptive levels');const binBytes=(ranges.length*388+entries+sourceCount*7)*4;spanOffset=ranges.length*388+entries;if(binBytes>limit)throw failure('LDNI_INDEX_LIMIT','Ray interval bins exceed their bounded binding.');
   const previous=bins;bins=alloc(binBytes,storage,'Packed active ray intervals');encoder=d.createCommandEncoder();encoder.copyBufferToBuffer(previous,0,bins,0,previous.size);d.queue.submit([encoder.finish()]);countGroup=bind(dummy);encoder=d.createCommandEncoder();pass=encoder.beginComputePass();dispatch(pass,'binEmit',sourceCount);dispatch(pass,'initSpans',sourceCount);pass.end();d.queue.submit([encoder.finish()]);
   encoder=d.createCommandEncoder();encoder.clearBuffer(counts);pass=encoder.beginComputePass();dispatch(pass,'intervals',rays);dispatch(pass,'spanCounts',sourceCount);pass.end();d.queue.submit([encoder.finish()]);const sizes=await metadata();let total=0;const resultRows=rawRows.map((r,i)=>{const row={...r,offset:total,segments:sizes[i]};total+=sizes[i];return row;});job.intervalStats={rays,sourceSegments:sourceCount,boundarySegments:total};if(total>sourceCount+64)throw failure('LDNI_FRAGMENT_LIMIT','The adaptive arrangement needs exact vector refinement.');if(total*32>limit||total>MAX_SEGMENTS)throw failure('LDNI_OUTPUT_LIMIT','Adaptive contour output exceeds the bounded binding.');
   if(!total)return {buffer:null,rows:resultRows,segments:0,rays,metadataBytes,ms:performance.now()-started};
   const output=make(total*32,storage,'LDNI union boundaries');d.queue.writeBuffer(outputRows,0,Uint32Array.from(resultRows.flatMap(r=>[r.offset,r.segments,0,0])));encoder=d.createCommandEncoder();encoder.clearBuffer(counts);pass=encoder.beginComputePass();dispatch(pass,'intervals',rays,1,0,0,bind(output));pass.end();d.queue.submit([encoder.finish()]);await metadata();await d.queue.onSubmittedWorkDone();return {buffer:output,rows:resultRows,segments:total,rays,metadataBytes,ms:performance.now()-started};
  }finally{for(const b of scratch)free(b);}
 }

 async topology(job,buffer,rawRows,make,free){
  const started=performance.now(),readBefore=job.contourReadBytes||0;const run=async exact=>{const temporary=new Set(),allocate=(...args)=>{const b=make(...args);temporary.add(b);return b;},release=b=>{temporary.delete(b);free(b);};let result;try{result=await this.topologyPass(job,buffer,rawRows,allocate,release,exact);if(result.buffer)temporary.delete(result.buffer);result.ms=performance.now()-started;result.metadataBytes=(job.contourReadBytes||0)-readBefore;return result;}finally{for(const b of temporary)free(b);}};
  try{if(rawRows.some(r=>r.segments>4096)){job.intervalFallbacks=(job.intervalFallbacks||0)+1;return await run(true);}return await run(false);}catch(error){this.check(job);if(!['LDNI_OPEN_INTERVAL','LDNI_RAY_LIMIT','LDNI_EVENT_LIMIT','LDNI_FRAGMENT_LIMIT','LDNI_INDEX_LIMIT','LDNI_CAPACITY','LDNI_OUTPUT_LIMIT','OPEN_BOUNDARY','NON_MANIFOLD_BOUNDARY'].includes(error.code))throw error;job.intervalFallbacks=(job.intervalFallbacks||0)+1;return await run(true);}finally{free(buffer);}
 }
 async topologyPass(job,buffer,rawRows,make,free,exact){
  const d=this.context.device,n=rawRows.reduce((s,r)=>s+r.segments,0),started=performance.now(),dense=rawRows.length<=64&&rawRows.some(r=>r.segments>512),fine=rawRows.length<=4&&rawRows.some(r=>r.segments>2048),gridX=fine?512:dense?128:1,gridZ=fine?512:dense?128:64,gridStride=6+gridX*gridZ*3;
  let pipeline=this.topologyPipelines?.device===d?this.topologyPipelines:null;
  if(!pipeline){
   const first=topologyShader.indexOf('@compute @workgroup_size(64) fn indexBounds'),last=topologyShader.indexOf('@group(0) @binding(6)',first),queryCode=(topologyShader.slice(0,first)+topologyShader.slice(last)).replace('var<storage,read_write> buckets:array<u32>','var<storage,read> buckets:array<u32>').replace('var<storage,read_write> bucketRows:array<atomic<u32>>','var<storage,read> bucketRows:array<u32>').replace(/atomicLoad\(&bucketRows\[([^\]]+)\]\)/g,'bucketRows[$1]').replace(/atomicLoad\(&buckets\[([^\]]+)\]\)/g,'buckets[$1]');
   const modules=[d.createShaderModule({label:'Printer vector contours',code:queryCode}),d.createShaderModule({label:'Printer vector index',code:topologyShader})];for(const module of modules){const info=await module.getCompilationInfo();if(info.messages.some(m=>m.type==='error'))throw Error(info.messages.filter(m=>m.type==='error').map(m=>m.message).join('; '));}
   const layouts=[false,true].map(write=>d.createBindGroupLayout({entries:[0,1,2,3,4,6,7,8].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:[0,4].includes(binding)||!write&&[7,8].includes(binding)?'read-only-storage':'storage'}})).concat([{binding:5,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform',hasDynamicOffset:true,minBindingSize:48}}])})),plans=layouts.map(layout=>d.createPipelineLayout({bindGroupLayouts:[layout]}));
   pipeline={device:d,layout:layouts[0],indexLayout:layouts[1]};await Promise.all(['clean','connect','close','boundary','trace','claim','rematch','simplify','rawClaim','rawNext','ldniCount','ldniPack','augment','indexBounds','indexCount','indexPrefix','indexEdges','repairBoundary','chordPlan','rootInit','rootStep'].map(async entryPoint=>{const index=['indexBounds','indexCount','indexPrefix','indexEdges'].includes(entryPoint)?1:0;pipeline[entryPoint]=await d.createComputePipelineAsync({label:'Printer '+entryPoint,layout:plans[index],compute:{module:modules[index],entryPoint}});}));this.topologyPipelines=pipeline;
  }
  this.check(job);
  const rowsBuffer=make(rawRows.length*16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,'Contour layer ranges'),counts=make((rawRows.length+1)*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST,'Contour counters'),read=make(Math.max(12,(rawRows.length+1)*4),GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST,'Contour metadata');
  const placeholder=make(32,GPUBufferUsage.STORAGE,'Contour count placeholder');let partners=make(n*8,GPUBufferUsage.STORAGE,'Reciprocal raw endpoint pairs');
  let buckets=make(16,GPUBufferUsage.STORAGE,'Packed section Z bins');const bucketRows=make((rawRows.length*gridStride+3)*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC,'Section Z bin bounds');
  let links;const clean=make(n*32,GPUBufferUsage.STORAGE,'Deduplicated sections'),linkBuffer=make(n*16,GPUBufferUsage.STORAGE,'Contour links'),closed=make(n*64,GPUBufferUsage.STORAGE,'Closed sections');links=linkBuffer;
  const configurations=[],configStride=d.limits.minUniformBufferOffsetAlignment;
  const dispatch=(name,input,output,rows,total,mode=0,tolerance=job.options.width*.02)=>{job.stage='sections:'+name;
   const metadata=Uint32Array.from(rows.flat());d.queue.writeBuffer(rowsBuffer,0,metadata);const config=new ArrayBuffer(48);new Uint32Array(config).set([total,rows.length,mode,0]);new Float32Array(config).set([tolerance,Math.max(1e-6,job.options.width*1e-5),job.options.width,0],4);
   new Uint32Array(config).set([gridX,gridZ,gridStride,0],8);const chunk=['rootInit','rootStep'].includes(name)?total:Math.max(64,Math.floor(16000000/Math.max(...rows.map(r=>r[1]))/(name==='chordPlan'?32:1)/64)*64),parts=Math.ceil(total/chunk),data=new Uint8Array(parts*configStride),uniform=make(data.byteLength,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,'Contour dispatch uniforms');configurations.push(uniform);for(let part=0;part<parts;part++){new Uint32Array(config)[3]=part*chunk;data.set(new Uint8Array(config),part*configStride);}d.queue.writeBuffer(uniform,0,data);const bind=d.createBindGroup({layout:['indexBounds','indexCount','indexPrefix','indexEdges'].includes(name)?pipeline.indexLayout:pipeline.layout,entries:[input,output,links,counts,rowsBuffer,uniform,partners,buckets,bucketRows].map((buffer,binding)=>({binding,resource:{buffer,...(binding===5?{size:48}:{})}}))}),e=d.createCommandEncoder(),p=e.beginComputePass();p.setPipeline(pipeline[name]);for(let part=0;part<parts;part++){p.setBindGroup(0,bind,[part*configStride]);const blocks=Math.ceil(Math.min(chunk,total-part*chunk)/64),x=Math.min(blocks,d.limits.maxComputeWorkgroupsPerDimension);p.dispatchWorkgroups(x,Math.ceil(blocks/x));}p.end();d.queue.submit([e.finish()]);
  };
  const index=async(input,rows,total)=>{const metadata=new Uint32Array(rows.length*gridStride+3);for(let i=0;i<rows.length;i++){metadata[i*gridStride]=0xffffffff;metadata[i*gridStride+2]=0xffffffff;};d.queue.writeBuffer(bucketRows,0,metadata);dispatch('indexBounds',input,placeholder,rows,total);dispatch('indexCount',input,placeholder,rows,total);dispatch('indexPrefix',input,placeholder,rows,rows.length*64);const e=d.createCommandEncoder();e.copyBufferToBuffer(bucketRows,rows.length*gridStride*4,read,0,12);d.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);const indexCounts=new Uint32Array(read.getMappedRange()).slice(0,3),entries=indexCounts[0];read.unmap();for(const buffer of configurations)free(buffer);configurations.length=0;metadataBytes+=12;job.contourReadBytes=(job.contourReadBytes||0)+12;this.check(job);if(indexCounts[2]||entries!==indexCounts[1])throw failure('INDEX_LIMIT','Section interval index exceeds its bounded capacity.');if(entries*4>Math.min(d.limits.maxStorageBufferBindingSize,64*1024*1024))throw failure('INDEX_LIMIT','Section interval index exceeds its bounded binding.');if(buckets.size<entries*4){free(buckets);buckets=make(entries*4,GPUBufferUsage.STORAGE,'Packed section Z bins');}dispatch('indexEdges',input,placeholder,rows,total);};
  let metadataBytes=0;
  const reset=()=>d.queue.writeBuffer(counts,0,new Uint32Array(rawRows.length+1));
  const counter=async()=>{const e=d.createCommandEncoder();e.copyBufferToBuffer(counts,0,read,0,(rawRows.length+1)*4);d.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);const values=new Uint32Array(read.getMappedRange().slice(0));read.unmap();for(const buffer of configurations)free(buffer);configurations.length=0;metadataBytes+=(rawRows.length+1)*4;job.contourReadBytes=(job.contourReadBytes||0)+(rawRows.length+1)*4;this.check(job);const code=values[rawRows.length];if(code)throw failure(['','BRANCHED_SECTION','INTERSECTION_LIMIT','OUTPUT_OVERFLOW','OPEN_BOUNDARY','NON_MANIFOLD_BOUNDARY'][code]||'TOPOLOGY_ERROR','GPU contour processing rejected an ambiguous branch, excessive intersections or an unclosed boundary.');return values;};
  let rows=rawRows.map(r=>[r.offset,r.segments,r.offset*2,0]);
  await index(buffer,rows,n);dispatch('clean',buffer,clean,rows,n);dispatch('connect',clean,closed,rows,n,0,job.options.width*.02+1e-5);dispatch('rawClaim',clean,closed,rows,n);reset();dispatch('close',clean,closed,rows,n);let repairs=Array.from(await counter()).slice(0,-1).reduce((a,b)=>a+b,0);if(repairs){for(let i=0;i<8;i++){dispatch('rawNext',clean,closed,rows,n,0,job.options.width*.02+1e-5);dispatch('rawClaim',clean,closed,rows,n);}reset();dispatch('close',clean,closed,rows,n);repairs=Array.from(await counter()).slice(0,-1).reduce((a,b)=>a+b,0);}free(clean);
  let total=0,boundary=null,sizes,offset=0;
  if(exact){
  rows=rawRows.map(r=>[r.offset*2,r.segments*2,0,0]);await index(closed,rows,n*2);reset();dispatch('boundary',closed,placeholder,rows,n*2);sizes=await counter();total=Array.from(sizes).slice(0,-1).reduce((a,b)=>a+b,0);
  if(total>MAX_SEGMENTS||total*32>Math.min(d.limits.maxStorageBufferBindingSize,64*1024*1024))throw failure('LAYER_OUTPUT_LIMIT','Boolean contours exceed the bounded output binding.');
  if(!total){for(const b of [rowsBuffer,counts,read,links,closed,placeholder,partners,buckets,bucketRows])free(b);return {buffer:null,rows:[],segments:0,repairs,metadataBytes,ms:performance.now()-started};}
  offset=0;rows=rows.map((r,i)=>{const row=[r[0],r[1],offset,sizes[i]];offset+=sizes[i];return row;});
  boundary=make(total*32,GPUBufferUsage.STORAGE,'Boolean section boundaries');reset();dispatch('boundary',closed,boundary,rows,n*2,1);await counter();free(closed);
  }else{
  const reduced=closed;free(links);links=make(16,GPUBufferUsage.STORAGE,'Retired raw links');free(partners);partners=make(16,GPUBufferUsage.STORAGE,'Retired raw pairs');free(buckets);buckets=make(16,GPUBufferUsage.STORAGE,'Retired raw index');
  const sparseRows=rawRows.map(r=>[r.offset*2,r.segments*2,0,0]);reset();dispatch('ldniCount',reduced,placeholder,sparseRows,n*2);const live=await counter();let sourceTotal=0;const sourceRows=rawRows.map((r,i)=>{const row={...r,offset:sourceTotal,segments:live[i]};sparseRows[i][2]=sourceTotal;sourceTotal+=live[i];return row;});if(!sourceTotal){free(reduced);return {buffer:null,rows:[],segments:0,repairs,metadataBytes,ms:performance.now()-started};}const compactSource=make(sourceTotal*32,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC,'Compact LDNI source');reset();dispatch('ldniPack',reduced,compactSource,sparseRows,n*2);await counter();free(reduced);
  job.stage='adaptive-ldni';const adaptive=await this.ldni(job,compactSource,sourceRows,make,free);job.stage='contour-loops';metadataBytes+=adaptive.metadataBytes;free(compactSource);total=adaptive.segments;boundary=adaptive.buffer;
  if(!total){for(const b of [rowsBuffer,counts,read,links,placeholder,partners,buckets,bucketRows])free(b);return {buffer:null,rows:[],segments:0,repairs,metadataBytes,ms:performance.now()-started};}
  rows=adaptive.rows.map(r=>[r.offset,r.segments,r.offset,r.segments]);
  }
  let finalLinks=make(total*8,GPUBufferUsage.STORAGE,'Boundary successors');
  // Rebind the link allocation after intersection splitting changes the edge count.
    const finalDispatch=(name,input,output,rows,rootPass=-1)=>{job.stage='loops:'+name;
   d.queue.writeBuffer(rowsBuffer,0,Uint32Array.from(rows.flat()));const config=new ArrayBuffer(48);new Uint32Array(config).set([total,rows.length,1,0]);new Float32Array(config).set([Math.max(0,job.options.width*.02-2e-5),Math.max(1e-6,job.options.width*1e-5),job.options.width,rootPass],4);
   new Uint32Array(config).set([gridX,gridZ,gridStride,0],8);const chunk=['rootInit','rootStep'].includes(name)?total:Math.max(64,Math.floor(16000000/Math.max(...rows.map(r=>r[1]))/(name==='chordPlan'?32:1)/64)*64),parts=Math.ceil(total/chunk),data=new Uint8Array(parts*configStride),uniform=make(data.byteLength,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,'Contour dispatch uniforms');configurations.push(uniform);for(let part=0;part<parts;part++){new Uint32Array(config)[3]=part*chunk;data.set(new Uint8Array(config),part*configStride);}d.queue.writeBuffer(uniform,0,data);const bind=d.createBindGroup({layout:pipeline.layout,entries:[input,output,finalLinks,counts,rowsBuffer,uniform,partners,buckets,bucketRows].map((buffer,binding)=>({binding,resource:{buffer,...(binding===5?{size:48}:{})}}))}),e=d.createCommandEncoder(),p=e.beginComputePass();p.setPipeline(pipeline[name]);for(let part=0;part<parts;part++){p.setBindGroup(0,bind,[part*configStride]);const blocks=Math.ceil(Math.min(chunk,total-part*chunk)/64),x=Math.min(blocks,d.limits.maxComputeWorkgroupsPerDimension);p.dispatchWorkgroups(x,Math.ceil(blocks/x));}p.end();d.queue.submit([e.finish()]);
  };
  rows=rows.map(r=>[r[2],r[3],r[2],r[3]]);let simplified=make(total*32,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC,'Simplified colored contours');await index(boundary,rows,total);reset();finalDispatch('trace',boundary,simplified,rows);await counter();
  reset();finalDispatch('claim',boundary,simplified,rows);let unmatched=await counter();if(!exact&&unmatched.some((v,i)=>i<rawRows.length&&v))throw failure('NON_MANIFOLD_BOUNDARY','Interval endpoints require exact vector refinement.');
  for(let iteration=0;iteration<8&&unmatched.some((v,i)=>i<rawRows.length&&v);iteration++){finalDispatch('rematch',boundary,simplified,rows);reset();finalDispatch('claim',boundary,simplified,rows);unmatched=await counter();}
  if(unmatched.some((v,i)=>i<rawRows.length&&v)){finalDispatch('augment',boundary,simplified,rows);reset();finalDispatch('claim',boundary,simplified,rows);unmatched=await counter();}
  if(unmatched.some((v,i)=>i<rawRows.length&&v)){
   if(total*64>Math.min(d.limits.maxStorageBufferBindingSize,64*1024*1024))throw failure('LAYER_OUTPUT_LIMIT','Boundary repair exceeds the bounded binding.');
   const expanded=make(total*64,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC,'Closed boundary chains'),oldTotal=total;reset();finalDispatch('repairBoundary',boundary,expanded,rows.map(r=>[r[0],r[1],r[0]*2,r[1]*2]));const repairedCounts=await counter();let size=0;const repairedRows=rows.map((r,i)=>{const row=[size,repairedCounts[i],size,repairedCounts[i]];size+=repairedCounts[i];return row;});
   if(size>MAX_SEGMENTS||size*32>Math.min(d.limits.maxStorageBufferBindingSize,64*1024*1024))throw failure('LAYER_OUTPUT_LIMIT','Repaired boundaries exceed the bounded binding.');
   const compact=make(size*32,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST,'Repaired boolean boundaries'),e=d.createCommandEncoder();for(let i=0;i<rows.length;i++)if(repairedCounts[i])e.copyBufferToBuffer(expanded,rows[i][0]*64,compact,repairedRows[i][0]*32,repairedCounts[i]*32);d.queue.submit([e.finish()]);await d.queue.onSubmittedWorkDone();free(expanded);free(boundary);free(finalLinks);free(simplified);boundary=compact;total=size;rows=repairedRows;repairs+=size-oldTotal;finalLinks=make(total*8,GPUBufferUsage.STORAGE,'Repaired boundary successors');simplified=make(total*32,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC,'Simplified repaired contours');await index(boundary,rows,total);reset();finalDispatch('trace',boundary,simplified,rows);await counter();reset();finalDispatch('claim',boundary,simplified,rows);unmatched=await counter();
   for(let i=0;i<8&&unmatched.some((v,k)=>k<rawRows.length&&v);i++){finalDispatch('rematch',boundary,simplified,rows);reset();finalDispatch('claim',boundary,simplified,rows);unmatched=await counter();}
   if(unmatched.some((v,i)=>i<rawRows.length&&v)){finalDispatch('augment',boundary,simplified,rows);reset();finalDispatch('claim',boundary,simplified,rows);unmatched=await counter();}
   if(unmatched.some((v,i)=>i<rawRows.length&&v))throw failure('NON_MANIFOLD_BOUNDARY','Boundary endpoint assignment exceeded the bounded repair search.');
  }
  const rootSize=Math.max(...rows.map(r=>r[1])),rootBytes=total*(rootSize>512?24:8);if(partners.size<rootBytes){free(partners);partners=make(rootBytes,GPUBufferUsage.STORAGE,'Parallel contour roots and chords');}let rootPass=-1;if(rootSize>512){rootPass=0;finalDispatch('rootInit',boundary,simplified,rows,0);for(let i=0;i<Math.ceil(Math.log2(rootSize));i++){finalDispatch('rootStep',boundary,simplified,rows,rootPass);rootPass=1-rootPass;}}finalDispatch('chordPlan',boundary,simplified,rows);reset();finalDispatch('simplify',boundary,simplified,rows,rootPass);sizes=await counter();
  const resultRows=[];offset=0;for(let i=0;i<rows.length;i++)if(sizes[i]){resultRows.push({...rawRows[i],offset,segments:sizes[i]});offset+=sizes[i];}
  const output=offset?make(offset*32,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST,'Printer perimeter splines'):null;
  if(output){const e=d.createCommandEncoder();let at=0;for(let i=0;i<rows.length;i++)if(sizes[i]){e.copyBufferToBuffer(simplified,rows[i][0]*32,output,at*32,sizes[i]*32);at+=sizes[i];}d.queue.submit([e.finish()]);}
  await d.queue.onSubmittedWorkDone();this.check(job);for(const b of [rowsBuffer,counts,read,links,finalLinks,boundary,simplified,placeholder,partners,buckets,bucketRows])free(b);
  return {buffer:output,rows:resultRows,segments:offset,repairs,metadataBytes,ms:performance.now()-started};
 }

 async run(job,snapshot){
  if(snapshot.meshes.length>256)throw failure('OWNER_LIMIT','Contour union supports at most 256 evaluated solid occurrences per job.');
  const d=snapshot.device,owned=new Set(),batches=[],layers=[],options=job.options,timings={};let liveBytes=0,peakGPUBytes=0,triangleVisits=0;
  const make=(size,usage,label)=>{const b=d.createBuffer({size:Math.max(16,size),usage,label});owned.add(b);liveBytes+=b.size;peakGPUBytes=Math.max(peakGPUBytes,liveBytes);return b;};
  const free=b=>{if(owned.delete(b)){liveBytes-=b.size;b.destroy();}};
  try{
   const capacity=Math.min(MAX_LAYERS,Math.max(1,Math.ceil((1000-options.initial)/options.height+.5))),bytes=(capacity+2)*4;
   const uniform=make(96,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,'Printer section config'),differences=make(bytes,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC,'Printer layer differences'),read=make(bytes,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ,'Printer layer metadata'),offsetBuffer=make(bytes,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,'Printer layer offsets'),cursors=make(bytes,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,'Printer layer cursors'),dummy=make(32,GPUBufferUsage.STORAGE,'Printer count placeholder');
   const cfg=(mesh,first=0,end=capacity)=>{const data=new ArrayBuffer(96);new Float32Array(data).set(mesh.matrix);new Uint32Array(data).set([mesh.triangleCount,capacity,first,end],16);new Float32Array(data).set([options.initial,options.height,options.width,mesh.solid+1],20);d.queue.writeBuffer(uniform,0,data);};
   const group=(mesh,k,output)=>d.createBindGroup({layout:k.layout,entries:[{binding:0,resource:mesh.storage==='texture'?mesh.positions.view:{buffer:mesh.positions}},{binding:1,resource:mesh.storage==='texture'?mesh.indices.view:{buffer:mesh.indices}},{binding:2,resource:{buffer:uniform}},{binding:3,resource:{buffer:differences}},{binding:4,resource:{buffer:offsetBuffer}},{binding:5,resource:{buffer:cursors}},{binding:6,resource:{buffer:output}}]});
   const dispatch=(mesh,k,entry,output,first=0,end=capacity)=>{if(!mesh.triangleCount)return;cfg(mesh,first,end);const e=d.createCommandEncoder(),p=e.beginComputePass();p.setPipeline(k[entry]);p.setBindGroup(0,group(mesh,k,output));const blocks=Math.ceil(mesh.triangleCount/128),x=Math.min(blocks,d.limits.maxComputeWorkgroupsPerDimension);p.dispatchWorkgroups(x,Math.ceil(blocks/x),entry==='scan'?end-first:1);p.end();d.queue.submit([e.finish()]);};
   const indexed=[];let started=performance.now();
   for(const mesh of snapshot.meshes){this.check(job);const k=await this.kernels(d,mesh.storage==='texture');this.check(job);indexed.push({mesh,k});dispatch(mesh,k,'count',dummy);triangleVisits+=mesh.triangleCount;}
   const e=d.createCommandEncoder();e.copyBufferToBuffer(differences,0,read,0,bytes);d.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);this.check(job);const delta=new Int32Array(read.getMappedRange().slice(0));read.unmap();free(read);timings.countMs=performance.now()-started;
   const counts=new Uint32Array(capacity);let total=0,count=0,last=0,rawSegments=0,repairs=0,topologyReadBytes=0;
   for(let i=0;i<capacity;i++){count+=delta[i];if(count<0)throw failure('COUNT_OVERFLOW','Invalid GPU section count.');counts[i]=count;total+=count;if(count)last=i+1;}
   if(total>MAX_SEGMENTS)throw failure('OUTPUT_LIMIT','Raw sections exceed eight million segments.');
   // Detect geometry beyond the bounded layer window instead of silently truncating.
   if(delta[capacity+1]>0&&capacity===MAX_LAYERS)throw failure('LAYER_LIMIT','Raw section preview exceeds 4096 layers.');
   if(!total){job.state='empty';return;}job.total=last;job.stage='sections';started=performance.now();
   rawSegments=total;total=0;timings.topologyMs=0;
   const maxSegments=Math.floor(Math.min(d.limits.maxStorageBufferBindingSize,d.limits.maxBufferSize,32*1024*1024)/32);
   for(let first=0;first<last;){this.check(job);let end=first,n=0,work=0;if(counts[first]>MAX_LAYER_SEGMENTS)throw failure('TOPOLOGY_LIMIT','A layer exceeds 65536 raw section edges.');while(end<last&&counts[end]<=MAX_LAYER_SEGMENTS&&n+counts[end]<=maxSegments&&(work+counts[end]**2<=256000000||end===first)){work+=counts[end]**2;n+=counts[end++];}if(end===first)throw failure('LAYER_OUTPUT_LIMIT','One layer exceeds the GPU binding capacity.');
    if(n){const offsets=new Uint32Array(capacity+1),rows=[];let offset=0;for(let i=first;i<end;i++){offsets[i]=offset;if(counts[i]){const row={index:i+1,y:i?options.initial+(i-.5)*options.height:options.initial/2,offset,segments:counts[i],batch:batches.length};rows.push(row);}offset+=counts[i];}
     d.queue.writeBuffer(offsetBuffer,0,offsets);d.queue.writeBuffer(cursors,0,new Uint32Array(capacity+1));const buffer=make(n*32,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC,'Printer raw section splines');
     for(const {mesh,k}of indexed){this.check(job);dispatch(mesh,k,job.algorithm==='layer-scan'?'scan':'emit',buffer,first,end);triangleVisits+=mesh.triangleCount*(job.algorithm==='layer-scan'?end-first:1);}
     await d.queue.onSubmittedWorkDone();this.check(job);job.stage='contours';const result=await this.topology(job,buffer,rows,make,free);timings.topologyMs+=result.ms;topologyReadBytes+=result.metadataBytes;repairs+=result.repairs;total+=result.segments;
     if(total>MAX_SEGMENTS)throw failure('OUTPUT_LIMIT','Perimeters exceed eight million segments.');if(result.buffer){for(const row of result.rows){row.batch=batches.length;layers.push(row);}batches.push({buffer:result.buffer,rows:result.rows});}job.stage='sections';
    }
    await d.queue.onSubmittedWorkDone();this.check(job);job.completed=end;this.context.requestAttributes();first=end;
   }
   timings.sectionsMs=performance.now()-started-timings.topologyMs;if(!total){job.state='empty';return;}last=layers.at(-1).index;await this.preparePreview?.();this.check(job);
   const params=this.context.scene.capture(job.hash,KEYS).params,firstSuccess=this.initialized.get(job.hash)!==snapshot.scene;
   job.result={batches,layers,lastLayer:last,segments:total,rawSegments,repairs,peakGPUBytes,metadataReadBytes:bytes+topologyReadBytes,triangleVisits,timings};
   try{this.context.update(job.hash,{'Finish layer':firstSuccess?last:Math.max(1,Math.min(last,params['Finish layer'])),'Start layer':Math.max(1,Math.min(last,params['Start layer']))});}catch(error){job.result=null;throw error;}
   this.initialized.set(job.hash,snapshot.scene);for(const batch of batches)owned.delete(batch.buffer);job.state='complete';job.stage='complete';
  }finally{for(const b of owned)b.destroy();}
 }
 operations(){return [{id:'slice',description:'Build closed, simplified GPU section boundaries with even-odd owner fill and union.',inputSchema:{type:'object',properties:{algorithm:{type:'string',enum:['triangle-span','layer-scan']}},additionalProperties:false},readOnly:false,run:(hash,args)=>this.start(hash,args)},{id:'status',description:'Read GPU slicing progress and closed-boundary metadata.',inputSchema:emptySchema,readOnly:true,run:hash=>this.status(hash)},{id:'cancel',description:'Cancel without publishing partial sections.',inputSchema:emptySchema,readOnly:false,run:hash=>this.cancel(hash)},{id:'inspect',description:'Read at most 4096 x/y/z/width endpoint pairs and outer/inner kinds for one layer.',inputSchema:{type:'object',properties:{layer:{type:'integer',minimum:1,maximum:MAX_LAYERS},offset:{type:'integer',minimum:0,maximum:MAX_SEGMENTS},count:{type:'integer',minimum:1,maximum:4096}},additionalProperties:false},readOnly:true,run:(hash,args)=>this.inspect(hash,args.layer,args.offset,args.count)}];}
}

export async function activate(context){
 if(context.version!==1)throw Error('Unsupported Frame plugin API');const slicer=new SectionSlicer(context);let preview=null;
 slicer.preparePreview=async()=>{if(preview?.device!==context.device)preview={device:context.device,draw:await createPreview(context,slicer)};};
 context.operations.register(slicer.operations());context.attributes.register(hash=>slicer.attributes(hash));
 const corners=[[-500,0,-500],[500,0,-500],[500,0,500],[-500,0,500],[-500,1000,-500],[500,1000,-500],[500,1000,500],[-500,1000,500]],edges=[];
 for(let i=0;i<4;i++)edges.push(...corners[i],...corners[(i+1)%4],...corners[i+4],...corners[(i+1)%4+4],...corners[i],...corners[i+4]);
 await slicer.preparePreview();
 await context.viewport.register({pivot:[-500,0,500],bounds:{min:[-500,0,-500],max:[500,1000,500]},surfaceSelection:'last-active',lines:new Float32Array(edges),color:[.45,.62,.58,.65],selectedColor:[.75,.65,.43,.65],settings:params=>[Math.sin(Math.max(0,Math.min(90,params['Overhang angle']))*Math.PI/180),0,0,0],retire:hash=>slicer.retire(hash),render:state=>{if(preview?.device!==state.device){slicer.preparePreview().then(()=>context.requestDraw());return;}preview.draw(state);},shader:`fn pluginSurface(local:vec3f,normal:vec3f,build:vec3f,settings:vec4f)->vec4f{
  if(local.y<=0.001||local.y>1000.||abs(local.x)>500.||abs(local.z)>500.){discard;}
  if(-dot(normal,build)<=settings.x+0.000001){discard;}return vec4f(1.,.12,.12,1.);
 }`});
}
