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
  return {id:job.id,state:job.state,stage:job.stage,completed:job.completed,total:job.total,algorithm:job.algorithm,ms:job.ms??performance.now()-job.started,error:job.error||null,result:job.result?{layers:job.result.layers,lastLayer:job.result.lastLayer,segments:job.result.segments,peakGPUBytes:job.result.peakGPUBytes,metadataReadBytes:job.result.metadataReadBytes,triangleVisits:job.result.triangleVisits,timings:job.result.timings,preview:{primitive:'line-list',polygonVertices:0},rawSegments:job.result.rawSegments,repairs:job.result.repairs,simplificationTolerance:job.options.width*.02,topology:'closed-even-odd-union'}:null};
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
 async topology(job,buffer,rawRows,make,free){
  const d=this.context.device,n=rawRows.reduce((s,r)=>s+r.segments,0),started=performance.now(),dense=rawRows.length<=64&&rawRows.some(r=>r.segments>512),fine=rawRows.length<=4&&rawRows.some(r=>r.segments>2048),gridX=fine?512:dense?128:1,gridZ=fine?512:dense?128:64,gridStride=6+gridX*gridZ*3;
  let pipeline=this.topologyPipelines?.device===d?this.topologyPipelines:null;
  if(!pipeline){
   const first=topologyShader.indexOf('@compute @workgroup_size(64) fn indexBounds'),last=topologyShader.indexOf('@group(0) @binding(6)',first),queryCode=(topologyShader.slice(0,first)+topologyShader.slice(last)).replace('var<storage,read_write> buckets:array<u32>','var<storage,read> buckets:array<u32>').replace('var<storage,read_write> bucketRows:array<atomic<u32>>','var<storage,read> bucketRows:array<u32>').replace(/atomicLoad\(&bucketRows\[([^\]]+)\]\)/g,'bucketRows[$1]').replace(/atomicLoad\(&buckets\[([^\]]+)\]\)/g,'buckets[$1]');
   const modules=[d.createShaderModule({label:'Printer vector contours',code:queryCode}),d.createShaderModule({label:'Printer vector index',code:topologyShader})];for(const module of modules){const info=await module.getCompilationInfo();if(info.messages.some(m=>m.type==='error'))throw Error(info.messages.filter(m=>m.type==='error').map(m=>m.message).join('; '));}
   const layouts=[false,true].map(write=>d.createBindGroupLayout({entries:[0,1,2,3,4,6,7,8].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:[0,4].includes(binding)||!write&&[7,8].includes(binding)?'read-only-storage':'storage'}})).concat([{binding:5,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform',hasDynamicOffset:true,minBindingSize:48}}])})),plans=layouts.map(layout=>d.createPipelineLayout({bindGroupLayouts:[layout]}));
   pipeline={device:d,layout:layouts[0],indexLayout:layouts[1]};await Promise.all(['clean','connect','close','boundary','trace','claim','rematch','simplify','rawClaim','rawNext','augment','indexBounds','indexCount','indexPrefix','indexEdges','repairBoundary','chordPlan','rootInit','rootStep'].map(async entryPoint=>{const index=['indexBounds','indexCount','indexPrefix','indexEdges'].includes(entryPoint)?1:0;pipeline[entryPoint]=await d.createComputePipelineAsync({label:'Printer '+entryPoint,layout:plans[index],compute:{module:modules[index],entryPoint}});}));this.topologyPipelines=pipeline;
  }
  this.check(job);
  const rowsBuffer=make(rawRows.length*16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,'Contour layer ranges'),counts=make((rawRows.length+1)*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST,'Contour counters'),read=make(Math.max(12,(rawRows.length+1)*4),GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST,'Contour metadata');
  const placeholder=make(32,GPUBufferUsage.STORAGE,'Contour count placeholder');let partners=make(n*8,GPUBufferUsage.STORAGE,'Reciprocal raw endpoint pairs');
  let buckets=make(16,GPUBufferUsage.STORAGE,'Packed section Z bins');const bucketRows=make((rawRows.length*gridStride+3)*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC,'Section Z bin bounds');
  const clean=make(n*32,GPUBufferUsage.STORAGE,'Deduplicated sections'),links=make(n*16,GPUBufferUsage.STORAGE,'Contour links'),closed=make(n*64,GPUBufferUsage.STORAGE,'Closed sections');
  const configurations=[],configStride=d.limits.minUniformBufferOffsetAlignment;
  const dispatch=(name,input,output,rows,total,mode=0,tolerance=job.options.width*.02)=>{
   const metadata=Uint32Array.from(rows.flat());d.queue.writeBuffer(rowsBuffer,0,metadata);const config=new ArrayBuffer(48);new Uint32Array(config).set([total,rows.length,mode,0]);new Float32Array(config).set([tolerance,Math.max(1e-6,job.options.width*1e-5),job.options.width,0],4);
   new Uint32Array(config).set([gridX,gridZ,gridStride,0],8);const chunk=['rootInit','rootStep'].includes(name)?total:Math.max(64,Math.floor(16000000/Math.max(...rows.map(r=>r[1]))/(name==='chordPlan'?32:1)/64)*64),parts=Math.ceil(total/chunk),data=new Uint8Array(parts*configStride),uniform=make(data.byteLength,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,'Contour dispatch uniforms');configurations.push(uniform);for(let part=0;part<parts;part++){new Uint32Array(config)[3]=part*chunk;data.set(new Uint8Array(config),part*configStride);}d.queue.writeBuffer(uniform,0,data);const bind=d.createBindGroup({layout:['indexBounds','indexCount','indexPrefix','indexEdges'].includes(name)?pipeline.indexLayout:pipeline.layout,entries:[input,output,links,counts,rowsBuffer,uniform,partners,buckets,bucketRows].map((buffer,binding)=>({binding,resource:{buffer,...(binding===5?{size:48}:{})}}))}),e=d.createCommandEncoder(),p=e.beginComputePass();p.setPipeline(pipeline[name]);for(let part=0;part<parts;part++){p.setBindGroup(0,bind,[part*configStride]);const blocks=Math.ceil(Math.min(chunk,total-part*chunk)/64),x=Math.min(blocks,d.limits.maxComputeWorkgroupsPerDimension);p.dispatchWorkgroups(x,Math.ceil(blocks/x));}p.end();d.queue.submit([e.finish()]);
  };
  const index=async(input,rows,total)=>{const metadata=new Uint32Array(rows.length*gridStride+3);for(let i=0;i<rows.length;i++){metadata[i*gridStride]=0xffffffff;metadata[i*gridStride+2]=0xffffffff;};d.queue.writeBuffer(bucketRows,0,metadata);dispatch('indexBounds',input,placeholder,rows,total);dispatch('indexCount',input,placeholder,rows,total);dispatch('indexPrefix',input,placeholder,rows,rows.length*64);const e=d.createCommandEncoder();e.copyBufferToBuffer(bucketRows,rows.length*gridStride*4,read,0,12);d.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);const indexCounts=new Uint32Array(read.getMappedRange()).slice(0,3),entries=indexCounts[0];read.unmap();for(const buffer of configurations)free(buffer);configurations.length=0;metadataBytes+=12;this.check(job);if(indexCounts[2]||entries!==indexCounts[1])throw failure('INDEX_LIMIT','Section interval index exceeds its bounded capacity.');if(entries*4>Math.min(d.limits.maxStorageBufferBindingSize,64*1024*1024))throw failure('INDEX_LIMIT','Section interval index exceeds its bounded binding.');if(buckets.size<entries*4){free(buckets);buckets=make(entries*4,GPUBufferUsage.STORAGE,'Packed section Z bins');}dispatch('indexEdges',input,placeholder,rows,total);};
  let metadataBytes=0;
  const reset=()=>d.queue.writeBuffer(counts,0,new Uint32Array(rawRows.length+1));
  const counter=async()=>{const e=d.createCommandEncoder();e.copyBufferToBuffer(counts,0,read,0,(rawRows.length+1)*4);d.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);const values=new Uint32Array(read.getMappedRange().slice(0));read.unmap();for(const buffer of configurations)free(buffer);configurations.length=0;metadataBytes+=(rawRows.length+1)*4;this.check(job);const code=values[rawRows.length];if(code)throw failure(['','BRANCHED_SECTION','INTERSECTION_LIMIT','OUTPUT_OVERFLOW','OPEN_BOUNDARY','NON_MANIFOLD_BOUNDARY'][code]||'TOPOLOGY_ERROR','GPU contour processing rejected an ambiguous branch, excessive intersections or an unclosed boundary.');return values;};
  let rows=rawRows.map(r=>[r.offset,r.segments,r.offset*2,0]);
  await index(buffer,rows,n);dispatch('clean',buffer,clean,rows,n);dispatch('connect',clean,closed,rows,n,0,job.options.width*.02+1e-5);dispatch('rawClaim',clean,closed,rows,n);reset();dispatch('close',clean,closed,rows,n);let repairs=Array.from(await counter()).slice(0,-1).reduce((a,b)=>a+b,0);if(repairs){for(let i=0;i<8;i++){dispatch('rawNext',clean,closed,rows,n,0,job.options.width*.02+1e-5);dispatch('rawClaim',clean,closed,rows,n);}reset();dispatch('close',clean,closed,rows,n);repairs=Array.from(await counter()).slice(0,-1).reduce((a,b)=>a+b,0);}free(clean);free(buffer);
  rows=rawRows.map(r=>[r.offset*2,r.segments*2,0,0]);await index(closed,rows,n*2);reset();dispatch('boundary',closed,placeholder,rows,n*2);let sizes=await counter(),total=Array.from(sizes).slice(0,-1).reduce((a,b)=>a+b,0);
  if(total>MAX_SEGMENTS||total*32>Math.min(d.limits.maxStorageBufferBindingSize,64*1024*1024))throw failure('LAYER_OUTPUT_LIMIT','Boolean contours exceed the bounded output binding.');
  if(!total){for(const b of [rowsBuffer,counts,read,links,closed,placeholder,partners,buckets,bucketRows])free(b);return {buffer:null,rows:[],segments:0,repairs,metadataBytes,ms:performance.now()-started};}
  let offset=0;rows=rows.map((r,i)=>{const row=[r[0],r[1],offset,sizes[i]];offset+=sizes[i];return row;});
  let boundary=make(total*32,GPUBufferUsage.STORAGE,'Boolean section boundaries');reset();dispatch('boundary',closed,boundary,rows,n*2,1);await counter();free(closed);
  let finalLinks=make(total*8,GPUBufferUsage.STORAGE,'Boundary successors');
  // Rebind the link allocation after intersection splitting changes the edge count.
    const finalDispatch=(name,input,output,rows,rootPass=-1)=>{
   d.queue.writeBuffer(rowsBuffer,0,Uint32Array.from(rows.flat()));const config=new ArrayBuffer(48);new Uint32Array(config).set([total,rows.length,1,0]);new Float32Array(config).set([Math.max(0,job.options.width*.02-2e-5),Math.max(1e-6,job.options.width*1e-5),job.options.width,rootPass],4);
   new Uint32Array(config).set([gridX,gridZ,gridStride,0],8);const chunk=['rootInit','rootStep'].includes(name)?total:Math.max(64,Math.floor(16000000/Math.max(...rows.map(r=>r[1]))/(name==='chordPlan'?32:1)/64)*64),parts=Math.ceil(total/chunk),data=new Uint8Array(parts*configStride),uniform=make(data.byteLength,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,'Contour dispatch uniforms');configurations.push(uniform);for(let part=0;part<parts;part++){new Uint32Array(config)[3]=part*chunk;data.set(new Uint8Array(config),part*configStride);}d.queue.writeBuffer(uniform,0,data);const bind=d.createBindGroup({layout:pipeline.layout,entries:[input,output,finalLinks,counts,rowsBuffer,uniform,partners,buckets,bucketRows].map((buffer,binding)=>({binding,resource:{buffer,...(binding===5?{size:48}:{})}}))}),e=d.createCommandEncoder(),p=e.beginComputePass();p.setPipeline(pipeline[name]);for(let part=0;part<parts;part++){p.setBindGroup(0,bind,[part*configStride]);const blocks=Math.ceil(Math.min(chunk,total-part*chunk)/64),x=Math.min(blocks,d.limits.maxComputeWorkgroupsPerDimension);p.dispatchWorkgroups(x,Math.ceil(blocks/x));}p.end();d.queue.submit([e.finish()]);
  };
  rows=rows.map(r=>[r[2],r[3],r[2],r[3]]);let simplified=make(total*32,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC,'Simplified colored contours');await index(boundary,rows,total);reset();finalDispatch('trace',boundary,simplified,rows);await counter();
  reset();finalDispatch('claim',boundary,simplified,rows);let unmatched=await counter();
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
