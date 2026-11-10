export const SAT_HELPERS = `
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
`;
