// Two disjoint vertex stars on opposite sides of a native closed body.
// The signed volume is affine in each displacement, with no shared face.
export function nativeLocalShape(mm){
  const n=20,rings=12,points=[[40.27,0,0]],faces=[];
  const id=(j,k)=>1+(j-1)*n+(k+n)%n;
  for(let j=1;j<rings;j++)for(let k=0;k<n;k++){
    const t=j*Math.PI/rings,a=2*Math.PI*k/n;
    points.push([40.27*Math.cos(t),39.87*Math.sin(t)*Math.cos(a),39.87*Math.sin(t)*Math.sin(a)]);
  }
  const last=points.length;points.push([-40.27,0,0]);
  for(let k=0;k<n;k++){
    faces.push([0,id(1,k),id(1,k+1)],[last,id(rings-1,k+1),id(rings-1,k)]);
    for(let j=1;j<rings-1;j++)faces.push([id(j,k),id(j+1,k),id(j+1,k+1)],[id(j,k),id(j+1,k+1),id(j,k+1)]);
  }
  const first=id(8,3),second=id(5,12);
  const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const normal=i=>{const n=points[i].map((x,a)=>x/(a?39.87:40.27)**2);return n.map(x=>x/Math.hypot(...n));};
  function derivative(i){
    let sum=0;
    for(const face of faces){const at=face.indexOf(i);if(at>=0)sum+=dot(normal(i),cross(points[face[(at+1)%3]],points[face[(at+2)%3]]))/6;}
    return sum;
  }
  const balance=derivative(first)/derivative(second);
  for(const [i,ds] of [[first,mm],[second,-balance*mm]]){
    const direction=normal(i);points[i]=points[i].map((v,a)=>v+ds*direction[a]);
  }
  const volumeMm3=faces.reduce((sum,[i,j,k])=>sum+dot(points[i],cross(points[j],points[k]))/6,0);
  const vertices=points.flatMap(p=>{
    let v=[...p];
    for(const [axis,degrees] of [[0,13],[1,17],[2,19]]){
      const b=(axis+1)%3,c=(axis+2)%3,t=degrees*Math.PI/180,x=v[b],y=v[c];
      v[b]=x*Math.cos(t)-y*Math.sin(t);v[c]=x*Math.sin(t)+y*Math.cos(t);
    }return v.map((x,a)=>x+[.73,499.61,1.13][a]);
  });
  return {mesh:{name:'Fixed-volume local deformation',vertices,indices:faces.flat()},first,second,balance,volumeMm3};
}
