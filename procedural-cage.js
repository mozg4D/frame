import * as SPLINE from './spline-core.js?v=surface-builder-2';

const add=(a,b)=>a.map((x,i)=>x+b[i]);
const mul=(a,s)=>a.map(x=>x*s);

// Builds authoring geometry, not render triangles. Every wall and cap region is a
// normal spline-cage cell consumed by the same Surface Builder as user cages.
export function buildExtrudeSplineCage(source,offsetVector){
  const topology=SPLINE.resolveSplineTopology(source),cycles=topology.planarContours.filter(c=>c.edges.length);
  if(!cycles.length)throw new Error('Extrude needs at least one closed planar contour');
  if(cycles.some(c=>!c.plane?.planar))throw new Error('Extrude profile must be planar');
  const cage=SPLINE.createSplineData();
  cage.approximation={...source.approximation};
  cage.planarFills=[];
  cage.patchCells=[];
  const edgeCopies=[];
  for(const cycle of cycles){
    const bottom=new Map(),top=new Map(),getVertex=(map,id,delta)=>{if(!map.has(id))map.set(id,SPLINE.addSplineVertex(cage,add(source.vertices[id],delta)));return map.get(id);};
    const bottomEdges=[],topEdges=[];
    for(const edge of cycle.edges){
      const s=source.segments[edge.id],a=getVertex(bottom,s.a,[0,0,0]),b=getVertex(bottom,s.b,[0,0,0]),ta=getVertex(top,s.a,offsetVector),tb=getVertex(top,s.b,offsetVector);
      const qb=SPLINE.addSplineSequence(cage),qt=SPLINE.addSplineSequence(cage);
      bottomEdges.push({id:SPLINE.addSplineSegment(cage,qb,a,b,s.ha.slice(),s.hb.slice()),reversed:!!edge.reversed});
      topEdges.push({id:SPLINE.addSplineSegment(cage,qt,ta,tb,s.ha.slice(),s.hb.slice()),reversed:!!edge.reversed});
    }
    const railBySource=new Map();
    for(const id of new Set(cycle.edges.flatMap(e=>{const s=source.segments[e.id];return [s.a,s.b];}))){const q=SPLINE.addSplineSequence(cage),a=getVertex(bottom,id,[0,0,0]),b=getVertex(top,id,offsetVector);railBySource.set(id,SPLINE.addSplineSegment(cage,q,a,b,mul(offsetVector,1/3),mul(offsetVector,-1/3)));}
    for(let i=0;i<cycle.edges.length;i++){const edge=cycle.edges[i],s=source.segments[edge.id],be=bottomEdges[i].id,te=topEdges[i].id;cage.patchCells.push({vertices:[bottom.get(s.a),bottom.get(s.b),top.get(s.b),top.get(s.a)],edges:[be,railBySource.get(s.b),te,railBySource.get(s.a)]});}
    cage.planarFills.push({id:`${cycle.id}:bottom`,edges:bottomEdges.slice()},{id:`${cycle.id}:top`,edges:topEdges.slice()});
    edgeCopies.push({cycle:cycle.id,bottomEdges,topEdges,rails:[...railBySource.values()]});
  }
  const report=SPLINE.validateSpline(cage);if(!report.ok)throw new Error(report.errors.join('; '));
  return {data:cage,sourceTopology:topology,edgeCopies};
}
