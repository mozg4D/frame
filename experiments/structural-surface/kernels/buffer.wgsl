struct Config { matrix:mat4x4f, origin:vec4f, step:vec4f, dims:vec4u, range:vec4u };
@group(0) @binding(0) var<uniform> cfg:Config;
@group(0) @binding(1) var <storage,read> positions:array<f32>;
@group(0) @binding(2) var <storage,read> indices:array<u32>;
@group(0) @binding(3) var<storage,read_write> labels:array<u32>;
fn index(i:u32)->u32{return indices[i];}fn value(i:u32)->f32{return positions[i];}
fn maximum(v:vec3f)->f32{return max(v.x,max(v.y,v.z));}
fn point(i:u32)->vec3f{return (cfg.matrix*vec4f(value(3u*i),value(3u*i+1u),value(3u*i+2u),1)).xyz;}

fn separated(axis:vec3f,a:vec3f,b:vec3f,c:vec3f,halfSize:vec3f,guard:f32)->bool{
 let norm=maximum(abs(axis)); if(norm<1e-20){return false;} let n=axis/norm;
 let p=vec3f(dot(a,n),dot(b,n),dot(c,n));let radius=dot(halfSize,abs(n))+guard*dot(vec3f(1.0),abs(n));
 return min(p.x,min(p.y,p.z))>radius||max(p.x,max(p.y,p.z)) < -radius;
}
fn touches(a:vec3f,b:vec3f,c:vec3f,halfSize:vec3f,guard:f32)->bool{
 let unit=array<vec3f,3>(vec3f(1,0,0),vec3f(0,1,0),vec3f(0,0,1));
 let edge=array<vec3f,3>(b-a,c-b,a-c);
 for(var k=0u;k<3u;k++){if(separated(unit[k],a,b,c,halfSize,guard)){return false;}}
 if(separated(cross(edge[0],edge[1]),a,b,c,halfSize,guard)){return false;}
 for(var e=0u;e<3u;e++){for(var k=0u;k<3u;k++){if(separated(cross(edge[e],unit[k]),a,b,c,halfSize,guard)){return false;}}}
 return true;
}

@compute @workgroup_size(64) fn surface(@builtin(global_invocation_id) tid:vec3u){
 let id=tid.x;if(id>=cfg.dims.w||labels[id]==2u){return;}
 let xyz=vec3u(id%cfg.dims.x,(id/cfg.dims.x)%cfg.dims.y,id/(cfg.dims.x*cfg.dims.y));
 let centre=(vec3f(xyz)+vec3f(0.5))*cfg.step.xyz;let halfSize=cfg.step.xyz*0.5;
 for(var t=cfg.range.x;t<cfg.range.y;t++){
  let ia=index(3u*t);let ib=index(3u*t+1u);let ic=index(3u*t+2u);
  if(max(ia,max(ib,ic))>=cfg.range.z){labels[id]=3u;continue;}
  let pa=point(ia);let pb=point(ib);let pc=point(ic);
  let a=(pa-cfg.origin.xyz)/cfg.origin.w-centre;let b=(pb-cfg.origin.xyz)/cfg.origin.w-centre;let c=(pc-cfg.origin.xyz)/cfg.origin.w-centre;
  if(any(!(abs(a)<vec3f(1e6)))||any(!(abs(b)<vec3f(1e6)))||any(!(abs(c)<vec3f(1e6)))){labels[id]=3u;continue;}
  let coordinateMagnitude=max(maximum(abs(pa)),max(maximum(abs(pb)),maximum(abs(pc))));
  let guard=3.8146973e-6*max(1.0,max(maximum(abs(cfg.origin.xyz)),coordinateMagnitude))/cfg.origin.w;
  if(touches(a,b,c,halfSize,guard)){labels[id]=2u;return;}
 }
}