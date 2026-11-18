import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('function FramePolygonKernel('),end=html.indexOf('    function polygonWorker(',start);
assert.ok(start>=0&&end>start);
const cut=Function(html.slice(start,end)+';return FramePolygonKernel;')();
const vertices=[0,0,0,100,0,0,0,100,0,0,-100,0],indices=[0,1,2,1,0,3];
const screen=vertices.map((x,i)=>i%3===2?1:x);
// The shared edge is a UV seam. Each child must interpolate on its own side.
const uv=[0,0,1,0,0,1,11,0,10,0,10,-1];
for(const [name,line] of [
  ['two points on a shared edge',[[10,0],[60,0]]],
  ['reversed finite edge',[[60,0],[10,0]]],
  ['endpoint on a new triangulation spoke',[[25,25],[10,10]]],
  ['edge to interior',[[25,0],[5,28]]]
]){
  const r=cut({op:'lineCut',vertices,indices,screen,uv,line}),ids=line.map(([x,y])=>{
    const found=[];for(let i=0;i<r.vertices.length;i+=3)if(Math.hypot(r.vertices[i]-x,r.vertices[i+1]-y)<1e-5)found.push(i/3);
    assert.equal(found.length,1);return found[0];
  });
  const areas=[0,0];let incidence=0;
  for(let i=0;i<r.indices.length;i+=3){
    const source=r.sourceFaces[i/3],tri=Array.from(r.indices.slice(i,i+3)),p=tri.map(v=>r.vertices.slice(v*3,v*3+2));
    const area=((p[1][0]-p[0][0])*(p[2][1]-p[0][1])-(p[1][1]-p[0][1])*(p[2][0]-p[0][0]))/2;
    assert.ok(area>0);areas[source]+=area;if(ids.every(v=>tri.includes(v)))incidence++;
    for(let k=0;k<3;k++){
      assert.ok(Math.abs(r.uv[i*2+k*2]-(p[k][0]/100+(source?10:0)))<1e-5);
      assert.ok(Math.abs(r.uv[i*2+k*2+1]-p[k][1]/100)<1e-5);
    }
  }
  assert.equal(incidence,2);assert.deepEqual(areas,[5000,5000]);console.log('PASS '+name);
}
