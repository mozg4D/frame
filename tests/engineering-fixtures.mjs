// Deterministic engineering STL fixtures: independent analytic meshes, no Frame generators.
export function revolve(profile,steps=64){
 const vertices=[],indices=[];for(const [r,y]of profile)for(let i=0;i<steps;i++){const t=i/steps*Math.PI*2;vertices.push(r*Math.cos(t),y,r*Math.sin(t));}
 const tri=(a,b,c)=>{const p=vertices.slice(a*3,a*3+3),q=vertices.slice(b*3,b*3+3),r=vertices.slice(c*3,c*3+3),u=q.map((x,k)=>x-p[k]),v=r.map((x,k)=>x-p[k]);if(Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])>1e-9)indices.push(a,b,c);};
 for(let j=0;j<profile.length;j++)for(let i=0;i<steps;i++){const a=j*steps+i,b=j*steps+(i+1)%steps,c=((j+1)%profile.length)*steps+(i+1)%steps,d=((j+1)%profile.length)*steps+i;tri(a,b,c);tri(a,c,d);}return {vertices,indices};
}
function prism(contour,depth){
 const vertices=contour.flatMap(([x,y])=>[x,y,-depth/2]).concat(contour.flatMap(([x,y])=>[x,y,depth/2])),indices=[],n=contour.length,left=Array.from({length:n},(_,i)=>i),cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 for(let guard=0;left.length>2&&guard<n*n;guard++)for(let j=0;j<left.length;j++){const a=left[(j+left.length-1)%left.length],b=left[j],c=left[(j+1)%left.length];if(cross(contour[a],contour[b],contour[c])<=0)continue;const inside=left.some(k=>![a,b,c].includes(k)&&cross(contour[a],contour[b],contour[k])>=0&&cross(contour[b],contour[c],contour[k])>=0&&cross(contour[c],contour[a],contour[k])>=0);if(inside)continue;indices.push(a,c,b,a+n,b+n,c+n);left.splice(j,1);break;}
 if(left.length>2)throw Error('Fixture triangulation failed');for(let a=0;a<n;a++){const b=(a+1)%n;indices.push(a,b,b+n,a,b+n,a+n);}return {vertices,indices};
}
export function engineeringFixtures(){return [
 ['mounting-block',prism([[-40,-25],[40,-25],[40,25],[-40,25]],30)],
 ['tapered-bracket',prism([[-40,-30],[40,-30],[15,30],[-20,30]],20)],
 ['L-bracket',prism([[0,0],[70,0],[70,12],[12,12],[12,60],[0,60]],18)],
 ['chamfered-plate',prism([[-30,-30],[30,-30],[40,-20],[40,20],[30,30],[-30,30],[-40,20],[-40,-20]],12)],
 ['dowel-pin',revolve([[0,-40],[12,-40],[12,40],[0,40]])],
 ['taper-pin',revolve([[0,-35],[18,-35],[9,35],[0,35]])],
 ['bearing-sleeve',revolve([[10,-25],[18,-25],[18,25],[10,25]])],
 ['washer',revolve([[10,-3],[30,-3],[30,3],[10,3]])],
 ['stepped-shaft',revolve([[0,-50],[12,-50],[12,-10],[22,-10],[22,15],[14,15],[14,50],[0,50]])],
 ['flanged-bushing',revolve([[10,-30],[18,-30],[18,15],[32,15],[32,25],[10,25]])],
 ['belt-pulley',revolve([[8,-18],[28,-18],[28,-12],[22,-7],[22,7],[28,12],[28,18],[8,18]])],
 ['hex-spacer',revolve([[8,-20],[24,-20],[24,20],[8,20]],6)]
 ].map(([name,mesh])=>({name,...mesh}));}
export function binarySTL({vertices,indices}){const bytes=Buffer.alloc(84+indices.length/3*50);bytes.writeUInt32LE(indices.length/3,80);for(let f=0;f<indices.length/3;f++)for(let j=0;j<3;j++){const i=indices[f*3+j];for(let k=0;k<3;k++)bytes.writeFloatLE(vertices[i*3+k],96+f*50+j*12+k*4);}return bytes;}
