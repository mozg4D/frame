// Independent test-only triangle clipping, not the SAT kernel under test.
export const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const plane=(x=.1)=>({vertices:[x,-2,-2,x,2,-2,x,2,2,x,-2,2],indices:[0,1,2,0,2,3],matrix:[...identity]});
export function surfaceFixtures(){
 const p=plane(),sheared={...plane(),matrix:[1,0,0,0,.5,1,0,0,0,0,1,0,0,0,0,1]},rotated={...plane(),matrix:[0,1,0,0,-1,0,0,0,0,0,1,0,0,0,0,1]},translated={...plane(),matrix:[.5,0,0,0,0,.5,0,0,0,0,.5,0,.25,0,0,1]};
 const paged={vertices:Array(192*3).fill(9),indices:[85,128,191,85,191,42],matrix:[...identity]};for(const [j,id]of [85,128,191,42].entries())paged.vertices.splice(3*id,3,...p.vertices.slice(3*j,3*j+3));
 const invalid={...plane(),indices:[0,1,99]},nonfinite={...plane(),vertices:[NaN,-2,-2,.1,2,-2,.1,2,2],indices:[0,1,2]},huge=plane(1e9);
 return [
  {name:'crossing-plane',meshes:[p],surfaceCells:16},
  {name:'reversed-winding',meshes:[{...plane(),indices:[2,1,0,3,2,0]}],surfaceCells:16},
  {name:'duplicate-600-triangles-three-batches',meshes:[{...plane(),indices:Array.from({length:300},()=>[0,1,2,0,2,3]).flat()}],surfaceCells:16,minBatches:3},
  {name:'outside-plane',meshes:[plane(2)],surfaceCells:0},
  {name:'rotated-90-degrees',meshes:[rotated],surfaceCells:16},
  {name:'exact-affine-scale-translation',meshes:[translated],surfaceCells:16},
  {name:'dyadic-shear-crossing',meshes:[sheared]},
  {name:'paged-position-and-index-layer-boundaries',meshes:[paged],surfaceCells:16},
  {name:'invalid-index',meshes:[invalid],uncertainCells:64},
  {name:'nonfinite-source',meshes:[nonfinite],uncertainCells:64},
  {name:'unsupported-huge-coordinate',meshes:[huge],uncertainCells:64},
  {name:'uncertainty-then-surface',meshes:[invalid,plane()],surfaceCells:16,uncertainCells:48},
  {name:'surface-then-uncertainty',meshes:[plane(),invalid],surfaceCells:16,uncertainCells:48}
 ];
}
function clip(poly,k,edge,sign){
 const out=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],da=sign*(a[k]-edge),db=sign*(b[k]-edge);if(da>=0)out.push(a);if((da>=0)!==(db>=0)){const t=da/(da-db);out.push(a.map((v,j)=>v+t*(b[j]-v)));}}return out;
}
const point=(v,m)=>[0,1,2].map(k=>m[k]*v[0]+m[4+k]*v[1]+m[8+k]*v[2]+m[12+k]);
export function expectedLabels(fixture){
 const triangles=[];for(const mesh of fixture.meshes){const v=Array.from(new Float32Array(mesh.vertices)),m=mesh.matrix;for(let t=0;t<mesh.indices.length;t+=3){const ids=mesh.indices.slice(t,t+3);if(ids.some(i=>i<0||i>=v.length/3)){triangles.push(null);continue;}const p=ids.map(i=>point(v.slice(3*i,3*i+3),m));triangles.push(p.flat().some(x=>!Number.isFinite(x)||Math.abs(x)>1e7)?null:p);}}
 const labels=[];for(let z=0;z<4;z++)for(let y=0;y<4;y++)for(let x=0;x<4;x++){
  const lo=[x,y,z].map(i=>-1+i*.5),hi=lo.map(v=>v+.5);let label=0;
  for(const triangle of triangles){if(label===2)break;if(!triangle){label=3;continue;}let p=triangle;for(let k=0;k<3&&p.length;k++){p=clip(p,k,lo[k],1);p=clip(p,k,hi[k],-1);}if(p.length)label=2;}
  labels.push(label);
 }return labels;
}
