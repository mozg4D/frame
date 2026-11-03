// Deterministic, test-only meshes and analytic solid oracles. No production
// geometry code is imported here. Normals are intentionally absent.
export function seeded(seed=0x9e3779b9){let x=seed>>>0;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;};}
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0);
export function boxMesh(min=[-5,-5,-5],max=[5,5,5]){
 const vertices=[];for(let k=0;k<8;k++)vertices.push(...min.map((v,i)=>k&(1<<i)?max[i]:v));
 const indices=[0,2,3,0,3,1,4,5,7,4,7,6,0,1,5,0,5,4,2,6,7,2,7,3,0,4,6,0,6,2,1,3,7,1,7,5];
 return{vertices,indices};
}
export function combineMeshes(meshes){const vertices=[],indices=[];for(const m of meshes){const base=vertices.length/3;vertices.push(...m.vertices);indices.push(...m.indices.map(i=>i+base));}return{vertices,indices};}
export function corruptMesh(mesh,{seed=31,flip=.5,duplicate=0,explode=false,degenerate=0}={}){
 const random=seeded(seed),vertices=mesh.vertices.slice(),indices=[];
 for(let i=0;i<mesh.indices.length;i+=3){const tri=mesh.indices.slice(i,i+3);if(random()<flip)[tri[1],tri[2]]=[tri[2],tri[1]];indices.push(...tri);if(random()<duplicate)indices.push(tri[2],tri[1],tri[0]);}
 for(let i=0;i<degenerate;i++)indices.push(i%(vertices.length/3),i%(vertices.length/3),(i+1)%(vertices.length/3));
 if(!explode)return{vertices,indices};
 return{vertices:indices.flatMap(i=>vertices.slice(i*3,i*3+3)),indices:indices.map((_,i)=>i)};
}
export function transformMesh(mesh,matrix){const vertices=[];for(let i=0;i<mesh.vertices.length;i+=3){const p=mesh.vertices.slice(i,i+3);vertices.push(...[0,1,2].map(k=>p.reduce((n,v,j)=>n+matrix[j*4+k]*v,matrix[12+k])));}return{vertices,indices:mesh.indices.slice()};}
// Independent convex-polyhedron clipping is used only to calculate the exact
// volume oracle of two arbitrarily rotated boxes. It is unrelated to the
// production triangle arrangement and never supplies its output geometry.
export function clippedCubeVolume(planes){
 const cube=boxMesh([-1,-1,-1],[1,1,1]),quads=[[0,2,3,1],[4,5,7,6],[0,1,5,4],[2,6,7,3],[0,4,6,2],[1,3,7,5]];let faces=quads.map(f=>f.map(i=>cube.vertices.slice(i*3,i*3+3)));
 for(const {normal:n,distance:d}of planes){const next=[],caps=[];for(const face of faces){const polygon=[];for(let i=0;i<face.length;i++){const a=face[i],b=face[(i+1)%face.length],da=dot(n,a)-d,db=dot(n,b)-d;if(da<=1e-12)polygon.push(a);if((da<0&&db>0)||(da>0&&db<0)){const t=da/(da-db),p=a.map((v,k)=>v+t*(b[k]-v));polygon.push(p);caps.push(p);}}if(polygon.length>=3)next.push(polygon);}
  const unique=[...new Map(caps.map(p=>[p.map(x=>Math.round(x*1e11)).join(','),p])).values()];if(unique.length>=3){const center=[0,1,2].map(k=>unique.reduce((v,p)=>v+p[k]/unique.length,0)),axis=[0,0,0];axis[n.reduce((best,v,k)=>Math.abs(v)<Math.abs(n[best])?k:best,0)]=1;let u=cross(n,axis);u=u.map(x=>x/Math.hypot(...u));const v=cross(n,u);unique.sort((a,b)=>Math.atan2(dot(sub(a,center),v),dot(sub(a,center),u))-Math.atan2(dot(sub(b,center),v),dot(sub(b,center),u)));next.push(unique);}faces=next;if(!faces.length)return 0;
 }let volume=0;for(const f of faces)for(let i=1;i+1<f.length;i++)volume+=dot(f[0],cross(f[i],f[i+1]))/6;return Math.abs(volume);
}
// The authored oblique box is rounded to native Float32 before Unite. Its
// triangulated faces can differ from the ideal rigid planes by a few e-8.
// This independent oblique-ray oracle classifies those actual stored triangles
// in Float64. The known interior box center establishes face orientation;
// supplied winding and duplicate triangles are ignored.
function nativeBoxOracle(mesh,center){
 const positions=mesh.vertices.map(Math.fround),triangles=[],seen=new Set(),direction=[1,Math.SQRT2/3,Math.sqrt(3)/5];
 for(let i=0;i<mesh.indices.length;i+=3){const points=mesh.indices.slice(i,i+3).map(j=>positions.slice(j*3,j*3+3)),key=points.map(p=>p.join(',')).sort().join(';');if(seen.has(key))continue;seen.add(key);const e1=sub(points[1],points[0]),e2=sub(points[2],points[0]),normal=cross(e1,e2),h=cross(direction,e2),det=dot(e1,h),outward=Math.sign(dot(normal,sub(points[0],center)));triangles.push({origin:points[0],e1,e2,h,det,sign:Math.sign(dot(normal,direction))*outward});}
 return point=>{const hits=[];for(const t of triangles){if(Math.abs(t.det)<1e-20)continue;const delta=sub(point,t.origin),u=dot(delta,t.h)/t.det;if(u<-1e-13||u>1+1e-13)continue;const q=cross(delta,t.e1),v=dot(direction,q)/t.det;if(v<-1e-13||u+v>1+1e-13)continue;const depth=dot(t.e2,q)/t.det;if(depth>1e-14)hits.push([depth,t.sign]);}hits.sort((a,b)=>a[0]-b[0]);let degree=0,last=-Infinity,sign=0;for(const [depth,crossing]of hits){if(depth-last>1e-12){degree+=Math.sign(sign);last=depth;sign=crossing;}else sign+=crossing;}degree+=Math.sign(sign);return degree!==0;};
}
export function rotatedCubeFixture(oblique=false){
 const angles=(oblique?[23,41,17]:[0,0,45]).map(a=>a*Math.PI/180),[sx,sy,sz]=angles.map(Math.sin),[cx,cy,cz]=angles.map(Math.cos),columns=[[cz*cy,sz*cy,-sy],[cz*sy*sx-sz*cx,sz*sy*sx+cz*cx,cy*sx],[cz*sy*cx+sz*sx,sz*sy*cx-cz*sx,cy*cx]],translation=oblique?[.2,-.35,.15]:[0,0,0],matrix=[...columns.flatMap(c=>[...c,0]),...translation,1],cube=boxMesh([-1,-1,-1],[1,1,1]),rotated=transformMesh(cube,matrix),planes=columns.flatMap(c=>[-1,1].map(sign=>{const normal=c.map(x=>x*sign);return{normal,distance:1+dot(normal,translation)};})),intersection=oblique?clippedCubeVolume(planes):16*(Math.SQRT2-1),volume=16-intersection;
 // In the 45-degree case, area=8(sqrt(2)-1) and height=2. The arbitrary
 // rotation uses all six independent half-space clips for its volume oracle.
 const vertices=combineMeshes([cube,rotated]).vertices,bounds={min:[0,1,2].map(k=>Math.min(...vertices.filter((_,i)=>i%3===k))),max:[0,1,2].map(k=>Math.max(...vertices.filter((_,i)=>i%3===k)))},inside=p=>p.every(x=>Math.abs(x)<1)||columns.every(c=>Math.abs(dot(c,sub(p,translation)))<1);
 const meshes=[corruptMesh(cube,{seed:982}),corruptMesh(rotated,{seed:995,duplicate:.25,explode:true})],sourceOracles=meshes.map((m,i)=>nativeBoxOracle(m,i?translation:[0,0,0])),sourceInside=p=>sourceOracles.some(contains=>contains(p));
 return{name:oblique?'oblique-three-axis-cube-union':'rotated-45-degree-cube-union',meshes,inside,sourceInside,volume,bounds,boundaryTolerance:1e-4,intersectionVolume:intersection};
}
export function sharedEdgeFixture(sameOwner=false,parity=false){
 const tetra=(c,d)=>({vertices:[0,0,-1,0,0,1,...c,...d],indices:[0,1,2,0,3,1,0,2,3,1,3,2]}),a=tetra([2,0,0],[0,2,0]),b=tetra([1,1,0],[-1,1,0]),contains=p=>{const height=1-Math.abs(p[2]),first=height>0&&p[0]>0&&p[1]>0&&p[0]+p[1]<2*height,second=height>0&&p[1]>Math.abs(p[0])&&p[1]<height;return parity?first!==second:first||second;};
 // Horizontal sections scale by (1-|z|). Their base areas are 2, 1 and
 // 1/2 for A, B and the overlap; integrating the squared scale gives 2/3.
 return{name:'shared-edge-tetrahedra-'+(sameOwner?'one-owner':'separate-owners')+(parity?'-parity':''),meshes:(sameOwner?[combineMeshes([a,b])]:[a,b]).map((m,i)=>corruptMesh(m,{seed:134+i,explode:true,duplicate:.3})),inside:contains,volume:parity?4/3:5/3,bounds:{min:[-1,0,-1],max:[2,2,1]},...parity?{fillRule:'even-odd',expectedNonmanifoldEdges:1}:{} };
}
export function conformingCellsFixture(oneDivider=false){
 const tetra=d=>({vertices:[0,0,-1,0,0,1,2,0,0,0,d,0],indices:[0,1,2,0,3,1,0,2,3,1,3,2]}),a=tetra(2),b=tetra(-2);if(oneDivider)b.indices=b.indices.slice(3);const geometry=corruptMesh(combineMeshes([a,b]),{seed:711,flip:.5,duplicate:.3,explode:true});
 return{name:'conforming-cells-'+(oneDivider?'single-internal-divider':'duplicate-shared-face'),meshes:[geometry],inside:p=>Math.abs(p[2])<1&&p[0]>0&&p[0]+Math.abs(p[1])<2*(1-Math.abs(p[2])),volume:8/3,bounds:{min:[0,-2,-1],max:[2,2,1]}};
}
export function prismMesh(polygon,z0=-2,z1=2){
 const vertices=[...polygon.flatMap(p=>[...p,z0]),...polygon.flatMap(p=>[...p,z1])],n=polygon.length,indices=[];
 for(let i=1;i+1<n;i++)indices.push(0,i+1,i,n,n+i,n+i+1);
 for(let i=0;i<n;i++){const j=(i+1)%n;indices.push(i,j,n+j,i,n+j,n+i);}return{vertices,indices};
}
export function insidePolygon(polygon,p){let inside=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
export function polygonWinding(polygon,p){let winding=0;for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length],left=(b[0]-a[0])*(p[1]-a[1])-(p[0]-a[0])*(b[1]-a[1]);if(a[1]<=p[1]&&b[1]>p[1]&&left>0)winding++;else if(a[1]>p[1]&&b[1]<=p[1]&&left<0)winding--;}return winding;}
// Integrate exact linear scanline spans between every vertex/intersection x.
// Ordering cannot change inside a slab, so its midpoint length integrates the
// piecewise-linear boundary exactly in Float64, for either fill convention.
export function polygonFilledArea(polygon,evenOdd=false){
 const cross2=(a,b)=>a[0]*b[1]-a[1]*b[0],minus=(a,b)=>a.map((v,k)=>v-b[k]),xs=polygon.map(p=>p[0]);
 for(let i=0;i<polygon.length;i++)for(let j=i+1;j<polygon.length;j++){const a=polygon[i],b=polygon[(i+1)%polygon.length],c=polygon[j],d=polygon[(j+1)%polygon.length],r=minus(b,a),s=minus(d,c),den=cross2(r,s);if(!den)continue;const t=cross2(minus(c,a),s)/den,u=cross2(minus(c,a),r)/den;if(t>0&&t<1&&u>0&&u<1)xs.push(a[0]+t*r[0]);}
 xs.sort((a,b)=>a-b);let area=0;for(let i=1;i<xs.length;i++){if(xs[i]-xs[i-1]<1e-12)continue;const x=(xs[i]+xs[i-1])/2,hits=[];for(let j=0;j<polygon.length;j++){const a=polygon[j],b=polygon[(j+1)%polygon.length];if((a[0]<=x&&b[0]>x)||(b[0]<=x&&a[0]>x))hits.push([a[1]+(x-a[0])*(b[1]-a[1])/(b[0]-a[0]),Math.sign(b[0]-a[0])]);}hits.sort((a,b)=>a[0]-b[0]);let degree=0,last=0,length=0;for(const [y,sign]of hits){if(evenOdd?Math.abs(degree)%2:degree!==0)length+=y-last;degree+=sign;last=y;}area+=length*(xs[i]-xs[i-1]);}return area;
}
export function heptagramFixture(evenOdd=false){const polygon=Array.from({length:7},(_,i)=>{const angle=(i*2%7)*Math.PI*2/7;return[Math.fround(4*Math.cos(angle)),Math.fround(4*Math.sin(angle))];}),bounds={min:[Math.min(...polygon.map(p=>p[0])),Math.min(...polygon.map(p=>p[1])),-2],max:[Math.max(...polygon.map(p=>p[0])),Math.max(...polygon.map(p=>p[1])),2]};return{name:'self-overlapping-heptagram-'+(evenOdd?'evenodd':'nonzero'),meshes:[corruptMesh(prismMesh(polygon),{explode:true,seed:927,duplicate:.25})],inside:p=>p[2]>-2&&p[2]<2&&(evenOdd?insidePolygon(polygon,p):polygonWinding(polygon,p)!==0),volume:polygonFilledArea(polygon,evenOdd)*4,bounds,boundaryTolerance:1e-4,selfIntersecting:true,...evenOdd?{fillRule:'even-odd'}:{}};}
const inBox=(b,p)=>p.every((x,k)=>x>b.min[k]&&x<b.max[k]);
const box=(min,max)=>({min,max});
// A group is a solid occurrence. Shells in one group use even/odd nesting;
// separate groups use set union. These fixtures have disjoint/nested shells
// within a group unless their name explicitly specifies self intersection.
function boxesCase(name,groups,options={}){
 const inside=p=>groups.some(g=>g.reduce((n,b)=>n+Number(inBox(b,p)),0)%2===1),axes=[0,1,2].map(k=>[...new Set(groups.flatMap(g=>g.flatMap(b=>[b.min[k],b.max[k]])))].sort((a,b)=>a-b));
 let volume=0;for(let i=1;i<axes[0].length;i++)for(let j=1;j<axes[1].length;j++)for(let k=1;k<axes[2].length;k++){const at=[i,j,k],p=at.map((n,a)=>(axes[a][n-1]+axes[a][n])/2);if(inside(p))volume+=at.reduce((n,v,a)=>n*(axes[a][v]-axes[a][v-1]),1);}
 const meshes=groups.map((g,i)=>corruptMesh(combineMeshes(g.map(b=>boxMesh(b.min,b.max))),{seed:123+i,...options}));
 return{name,meshes,inside,volume,bounds:{min:axes.map(a=>a[0]),max:axes.map(a=>a.at(-1))},boundaryTolerance:1e-4,groups};
}
export function uniteFixtures(){
 const outer=box([-6,-6,-6],[6,6,6]),inner=box([-4,-4,-4],[4,4,4]),core=box([-1,-1,-1],[1,1,1]),a=box([-5,-4,-3],[2,4,3]),b=box([-2,-3,-2],[5,3,2]);
 const cases=[
  boxesCase('random-winding-exploded-box',[[outer]],{explode:true}),
  boxesCase('intersecting-solid-occurrences',[[a],[b]]),
  boxesCase('disconnected-solid-occurrences',[[box([-10,-2,-2],[-6,2,2])],[box([6,-2,-2],[10,2,2])]]),
  boxesCase('nested-shell-cavity',[[outer,inner]]),
  boxesCase('nested-shell-material-island',[[outer,inner,core]]),
  boxesCase('contained-solid-occurrence-unites',[[outer],[inner]]),
  boxesCase('cavity-filled-by-distinct-occurrence',[[outer,inner],[box([-2,-8,-2],[2,8,2])]]),
  boxesCase('identical-solid-occurrences',[[outer],[outer]],{duplicate:1,explode:true}),
  boxesCase('duplicate-reversed-polygons',[[outer,inner]],{duplicate:1,explode:true}),
  boxesCase('thin-separated-shells',[[box([-5,-5,-5],[5,5,5]),box([-4.999,-4.999,-4.999],[4.999,4.999,4.999])]]),
  boxesCase('coplanar-shared-face',[[box([-5,-5,-5],[0,5,5])],[box([0,-5,-5],[5,5,5])]]),
  boxesCase('coplanar-partial-contact',[[box([-5,-5,-5],[0,5,5])],[box([0,-3,-3],[5,3,3])]]),
  boxesCase('near-coincident-overlap',[[box([-5,-5,-5],[.0002,5,5])],[box([0,-5,-5],[5,5,5])]]),
  boxesCase('three-way-solid-intersection',[[box([-6,-2,-2],[6,2,2])],[box([-2,-6,-2],[2,6,2])],[box([-2,-2,-6],[2,2,6])]])
 ];
 const polygon=[[-4,-3],[4,3],[-4,3],[4,-3]];
 const sameOwner=boxesCase('intersecting-shells-same-owner',[[a],[b]]);sameOwner.meshes=[combineMeshes(sameOwner.meshes)];cases.push(sameOwner);
 const internal=boxesCase('internal-open-triangle-is-discarded',[[outer]]);internal.meshes=[combineMeshes([internal.meshes[0],{vertices:[-2,-2,0,2,-2,0,0,2,0],indices:[0,1,2]}])];cases.push(internal);
 cases.push({name:'self-crossing-prism-evenodd',meshes:[corruptMesh(prismMesh(polygon),{duplicate:.3,explode:true})],inside:p=>p[2]>-2&&p[2]<2&&insidePolygon(polygon,p),volume:96,bounds:{min:[-4,-3,-2],max:[4,3,2]},boundaryTolerance:1e-4,selfIntersecting:true,expectedNonmanifoldEdges:2,contactSingularity:'Two parity-filled lobes meet along the original self-crossing line. The two output edge segments on this line each have four incident faces.'});
 cases.push(heptagramFixture());
 cases.push(rotatedCubeFixture(),rotatedCubeFixture(true),sharedEdgeFixture(),sharedEdgeFixture(true),conformingCellsFixture(),conformingCellsFixture(true));
 return cases;
}
export function orthogonalBoundary(fixture){
 if(!fixture.groups)throw Error('Orthogonal boundary requires box groups');
 const axes=[0,1,2].map(k=>[...new Set(fixture.groups.flatMap(g=>g.flatMap(b=>[b.min[k],b.max[k]])))].sort((a,b)=>a-b)),vertices=[],indices=[],ids=new Map(),cell=(i,j,k)=>i>=0&&j>=0&&k>=0&&i<axes[0].length-1&&j<axes[1].length-1&&k<axes[2].length-1&&fixture.inside([i,j,k].map((n,a)=>(axes[a][n]+axes[a][n+1])/2)),directions=[[0,0,-1],[0,0,1],[0,-1,0],[0,1,0],[-1,0,0],[1,0,0]];
 for(let i=0;i<axes[0].length-1;i++)for(let j=0;j<axes[1].length-1;j++)for(let k=0;k<axes[2].length-1;k++)if(cell(i,j,k)){
  const at=[i,j,k],m=boxMesh(at.map((n,a)=>axes[a][n]),at.map((n,a)=>axes[a][n+1]));
  for(let d=0;d<6;d++)if(!cell(i+directions[d][0],j+directions[d][1],k+directions[d][2]))for(const v of m.indices.slice(d*6,d*6+6)){const p=m.vertices.slice(v*3,v*3+3),key=p.join(',');if(!ids.has(key)){ids.set(key,vertices.length/3);vertices.push(...p);}indices.push(ids.get(key));}
 }return{vertices,indices};
}
export function sampleFixture(fixture,count=512,seed=7841){const r=seeded(seed);return Array.from({length:count},()=>fixture.bounds.min.map((lo,k)=>{const d=fixture.bounds.max[k]-lo;return lo-d*.1+r()*d*1.2;}));}
// Independent output mesh metrics. Exact/quantized welding is test-only;
// the resulting edge counts expose cracks, duplicate boundaries and winding.
export function meshMetrics(mesh,{weld=0}={}){
 const p=mesh.vertices||mesh.positions,indices=mesh.indices,ids=new Uint32Array(p.length/3),keys=new Map(),edges=new Map(),triangles=new Set(),bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
 let finite=true,indicesValid=true,duplicates=0,degenerate=0,volume=0,area=0;
 for(let i=0;i<p.length;i+=3){const v=p.slice(i,i+3);finite&&=v.every(Number.isFinite);for(let k=0;k<3;k++){bounds.min[k]=Math.min(bounds.min[k],v[k]);bounds.max[k]=Math.max(bounds.max[k],v[k]);}const key=v.map(x=>weld?Math.round(x/weld):Object.is(x,-0)?0:x).join(',');if(!keys.has(key))keys.set(key,keys.size);ids[i/3]=keys.get(key);}
 for(let t=0;t<indices.length;t+=3){const f=Array.from(indices.slice(t,t+3));if(!f.every(i=>Number.isInteger(i)&&i>=0&&i<ids.length)){indicesValid=false;continue;}const tri=f.map(i=>ids[i]),key=tri.slice().sort((a,b)=>a-b).join(',');if(triangles.has(key))duplicates++;triangles.add(key);const v=f.map(i=>Array.from(p.slice(i*3,i*3+3))),n=cross(sub(v[1],v[0]),sub(v[2],v[0]));if(new Set(tri).size!==3||dot(n,n)===0)degenerate++;area+=Math.sqrt(dot(n,n))/2;volume+=dot(v[0],cross(v[1],v[2]))/6;
  for(let k=0;k<3;k++){const a=tri[k],b=tri[(k+1)%3],key=Math.min(a,b)+','+Math.max(a,b);if(!edges.has(key))edges.set(key,[]);edges.get(key).push(a<b?1:-1);}}
 let boundaryEdges=0,nonmanifoldEdges=0,inconsistentEdges=0;for(const e of edges.values()){if(e.length===1)boundaryEdges++;if(e.length>2)nonmanifoldEdges++;if(e.length===2&&e[0]===e[1])inconsistentEdges++;}
 return{vertices:p.length/3,weldedVertices:keys.size,triangles:indices.length/3,finite,indicesValid,duplicates,degenerate,boundaryEdges,nonmanifoldEdges,inconsistentEdges,signedVolume:volume,surfaceArea:area,bounds};
}
export function boundaryOracle(mesh,fixture,{epsilon=1e-5,maxTriangles=8192}={}){
 const p=mesh.vertices||mesh.positions,indices=mesh.indices,step=Math.max(1,Math.ceil(indices.length/3/maxTriangles)),contains=fixture.sourceInside||fixture.inside;let checked=0,reversed=0,internal=0,degenerate=0,adaptiveTriangles=0,minProbeEpsilon=epsilon;
 for(let t=0;t<indices.length;t+=3*step){const v=Array.from(indices.slice(t,t+3),i=>Array.from(p.slice(i*3,i*3+3))),n=cross(sub(v[1],v[0]),sub(v[2],v[0])),length=Math.hypot(...n);if(!length){degenerate++;continue;}const c=[0,1,2].map(k=>(v[0][k]+v[1][k]+v[2][k])/3);let resolved=false,sawReversed=false;
  // A fixed normal offset can cross a second boundary at a thin fragment.
  // Require an actual filled/empty pair while decreasing the offset; no
  // triangles are skipped and an all-internal or reversed face still fails.
  for(let level=0;level<=7;level++){const offset=epsilon/10**level,before=contains(c.map((x,k)=>x-n[k]/length*offset)),after=contains(c.map((x,k)=>x+n[k]/length*offset));if(before&&!after){resolved=true;if(level)adaptiveTriangles++;minProbeEpsilon=Math.min(minProbeEpsilon,offset);break;}if(!before&&after)sawReversed=true;}
  checked++;if(!resolved){if(sawReversed)reversed++;else internal++;}
 }
 return{checked,reversed,internal,degenerate,adaptiveTriangles,minProbeEpsilon,reference:fixture.sourceInside?'independent native Float32 source triangles':'analytic solid',pass:checked>0&&reversed===0&&internal===0&&degenerate===0};
}
// Irrational oblique ray avoids the axial special cases used in runtime LDIs.
// Coincident depths count once, so duplicate copies do not change the oracle.
export function meshContains(mesh,point,{epsilon=1e-9}={}){
 const p=mesh.vertices||mesh.positions,indices=mesh.indices,d=[1,Math.SQRT2/3,Math.sqrt(3)/5],hits=[];
 for(let i=0;i<indices.length;i+=3){const v=Array.from(indices.slice(i,i+3),i=>Array.from(p.slice(i*3,i*3+3))),e1=sub(v[1],v[0]),e2=sub(v[2],v[0]),h=cross(d,e2),det=dot(e1,h);if(Math.abs(det)<epsilon)continue;const s=sub(point,v[0]),u=dot(s,h)/det;if(u<-epsilon||u>1+epsilon)continue;const q=cross(s,e1),w=dot(d,q)/det;if(w<-epsilon||u+w>1+epsilon)continue;const t=dot(e2,q)/det;if(t>epsilon)hits.push(t);}
 hits.sort((a,b)=>a-b);let n=0,previous=-Infinity;for(const t of hits)if(t-previous>epsilon){n++;previous=t;}return n%2===1;
}
export function occupancyOracle(mesh,fixture,{count=512,epsilon=1e-9}={}){const mismatches=[];for(const p of sampleFixture(fixture,count))if(meshContains(mesh,p,{epsilon})!==fixture.inside(p))mismatches.push(p);return{checked:count,mismatches:mismatches.slice(0,16),errors:mismatches.length,pass:mismatches.length===0};}
