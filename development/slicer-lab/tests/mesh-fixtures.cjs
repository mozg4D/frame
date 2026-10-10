'use strict';
function prism(ring,{height=1,shift=[0,0],generation=1}={}){const n=ring.length,vertices=[...ring.map(p=>[...p,0]),...ring.map(p=>[p[0]+shift[0],p[1]+shift[1],height])],faces=[];for(let i=0;i<n;i++){const j=(i+1)%n;faces.push([i,j,j+n],[i,j+n,i+n]);}return{vertices,faces,generation};}
function combine(meshes){const vertices=[],faces=[];for(const m of meshes){const n=vertices.length;vertices.push(...m.vertices);faces.push(...m.faces.map(f=>f.map(i=>i+n)));}return{vertices,faces,generation:1};}
module.exports={prism,combine};
