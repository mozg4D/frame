import {createGrid} from '../structural-pcg/hex8-reference.js';
import {regionWrench} from './load-case-reference.js';
const key=r=>{if(typeof r?.source!=='string'||!r.source.trim()||typeof r.uid!=='string'||!r.uid.trim())throw Error('Invalid provenance');return JSON.stringify([r.source,r.uid]);};
/** Bounded Float64 reference only. Caller supplies explicitly resolved masks,
 * one common SI grid and explicit grid-axis wrenches. Never reads GPU labels. */
export function mapResolvedLoads({cells,spacingMetres,bodies,forces=[],fixtures=[]}){
 if(!Array.isArray(cells)||cells.length!==3||cells.some(n=>!Number.isInteger(n)||n<1))throw Error('Invalid cells');
 cells=[...cells];
 const count=cells.reduce((a,b)=>a*b,1);if(count>4096)throw Error('Reference capacity: 4096 cells');
 if(!Array.isArray(spacingMetres)||spacingMetres.length!==3||spacingMetres.some(n=>typeof n!=='number'||!Number.isFinite(n)||n<=0))throw Error('Invalid SI spacing');
 spacingMetres=[...spacingMetres];
 if(!Array.isArray(bodies)||!bodies.length||bodies.length>32||!Array.isArray(forces)||forces.length>64||!Array.isArray(fixtures)||fixtures.length>64)throw Error('Reference group capacity');
 const validate=groups=>{const seen=new Set();for(const g of groups){const id=key(g);if(seen.has(id))throw Error('Duplicate provenance');seen.add(id);if(!g.occupancy||g.occupancy.length!==count||Array.from(g.occupancy).some(v=>v!==0&&v!==1))throw Error('Explicit resolved occupancy required');}};
 validate(bodies);validate(forces);validate(fixtures);
 const owner=new Int32Array(count).fill(-1);bodies.forEach((b,i)=>{b.occupancy.forEach((v,c)=>{if(v){if(owner[c]>=0)throw Error('Overlapping body ownership requires geometry resolution');owner[c]=i;}});});
 // This grid is a wrench quadrature helper only, never a merged material model.
 const grid=createGrid({cells,spacing:spacingMetres,materials:[{young:1,poisson:.2,yieldStrength:1}],materialIds:Array.from(owner,i=>i<0?-1:0)});
 const results=bodies.map(b=>({source:b.source,uid:b.uid,loads:new Float64Array(grid.dofs),fixtures:[]})),loadRecords=[];
 for(const f of forces){
  const selected=Array.from(owner,(_,c)=>c).filter(c=>owner[c]>=0&&f.occupancy[c]===1),w=regionWrench(grid,selected,f.wrench),nodeCounts=new Uint16Array(grid.nodeCount),bodyCounts=bodies.map(()=>new Uint16Array(grid.nodeCount));
  for(const c of selected)for(const n of grid.elementNodes.subarray(c*8,c*8+8)){nodeCounts[n]++;bodyCounts[owner[c]][n]++;}
  const recipients=[];for(let i=0;i<bodies.length;i++){let active=false;for(let n=0;n<grid.nodeCount;n++)if(bodyCounts[i][n]){active=true;const share=bodyCounts[i][n]/nodeCounts[n];for(let k=0;k<3;k++)results[i].loads[3*n+k]+=w.loads[3*n+k]*share;}if(active)recipients.push({source:bodies[i].source,uid:bodies[i].uid});}
  loadRecords.push({source:f.source,uid:f.uid,applied:w.applied,recipients});
 }
 for(let i=0;i<bodies.length;i++)for(const f of fixtures){const selected=[];for(let c=0;c<count;c++)if(owner[c]===i&&f.occupancy[c])selected.push(c);if(selected.length){const nodes=[...new Set(selected.flatMap(c=>Array.from(grid.elementNodes.subarray(c*8,c*8+8))))];results[i].fixtures.push({source:f.source,uid:f.uid,cells:selected,nodes});}}
 if(results.some(b=>!b.loads.every(Number.isFinite)))throw Error('Combined loads overflow');
 return {backend:'cpu-float64-reference',sceneSolved:false,analysisReady:false,bodies:results,forces:loadRecords,position:n=>grid.position(n),contact:'unresolved',fixturePolicy:'resolved full-cell intersection only; node candidates, no imposed motion'};
}
