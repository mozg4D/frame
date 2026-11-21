const PI=Math.PI;
export function cylinder(n=12,R=100,cap=true,flip=false,rows=[0,29,71,100],uneven=false,skew=false,ellipse=1,taper=0) {
  const p=[],f=[];
  for(let j=0;j<rows.length;j++)for(let i=0;i<n;i++){
    const t=2*PI*i/n,phi=t+(uneven?.05*Math.sin(3*t):0),
      z=rows[j]+(skew?3.96*Math.sin(527.92*i+71.43*j):0),rr=R*(1+z*taper);
    p.push(rr*Math.cos(phi),rr*Math.sin(phi)*ellipse,z);
  }
  for(let j=0;j<rows.length-1;j++)for(let i=0;i<n;i++){
    const a=j*n+i,b=j*n+(i+1)%n,c=b+n,d=a+n;
    if(!!((j+i)%2)===flip)f.push(a,b,d,b,c,d);else f.push(a,b,c,a,c,d);
  }
  const ns=f.length/3;
  if(cap){
    const l=p.length/3,h=l+1;p.push(0,0,rows[0],0,0,rows.at(-1));
    for(let a=0;a<n;a++){const b=(a+1)%n;f.push(l,b,a,h,l-n+a,l-n+b);}
  }
  return [p,f,ns];
}
export function icosphere(level,R=100,uneven=false){
  const t=(1+Math.sqrt(5))/2,L=Math.hypot(1,t);
  let v=[[-1,t,0],[1,t,0],[-1,-t,0],[1,-t,0],[0,-1,t],[0,1,t],[0,-1,-t],[0,1,-t],[t,0,-1],[t,0,1],[-t,0,-1],[-t,0,1]].map(p=>p.map(x=>x/L));
  let faces=[[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];
  while(level--){
    const m=new Map(),out=[];
    const mid=(a,b)=>{
      const i=Math.min(a,b),j=Math.max(a,b),key=i+':'+j;
      if(m.has(key))return m.get(key);
      const r=uneven?.47+((13*i+19*j)%7)*.01:.5,p=v[i].map((x,k)=>x*(1-r)+v[j][k]*r),L=Math.hypot(...p);
      m.set(key,v.length);v.push(p.map(x=>x/L));return v.length-1;
    };
    for(const [a,b,c] of faces){const d=mid(a,b),e=mid(b,c),g=mid(c,a);out.push([a,d,g],[b,e,d],[c,g,e],[d,e,g]);}
    faces=out;
  }
  return [v.flat().map(x=>x*R),faces.flat()];
}
