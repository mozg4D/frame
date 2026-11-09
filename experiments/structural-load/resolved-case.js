import {createGrid} from '../structural-pcg/hex8-reference.js';
import {validateProblem,createGPUPCG} from '../structural-pcg/gpu-pcg.js';
import {mapResolvedLoads} from './load-mapping-reference.js';

const key=r=>{if(typeof r?.source!=='string'||!r.source.trim()||typeof r.uid!=='string'||!r.uid.trim())throw Error('Explicit owner and tag provenance required');return JSON.stringify([r.source,r.uid]);};
const vector=v=>v&&v.length===3&&Array.from(v).every(Number.isFinite);
/** CPU preparation of already clipped/resolved material/force/fixture cells.
 * No scene capture, inferred interiors, inherited tag traversal or contact.
 * Distinct bodies remain mechanically independent, including coincident nodes.
 */
export function prepareResolvedCase(input){
 if(!input||!Number.isFinite(input.frame))throw Error('Explicit independent load-case frame required');
 const owner=key(input.owner);
 const {cells,spacingMetres,bodies,forces=[],fixtures=[]}=input;
 if(!Array.isArray(bodies)||!bodies.length)throw Error('Resolved bodies required');
 for(const body of bodies){
  key(body);
  const m=body.material;
  if(!m||!Number.isFinite(m.density)||m.density<=0)throw Error('Explicit material SI density required');
 }
 const fixtureValues=new Map();
 for(const fixture of fixtures){
  const value=fixture.displacementMetres??[0,0,0];
  if(!vector(value))throw Error('Invalid prescribed SI translation');
  fixtureValues.set(key(fixture),Array.from(value));
 }
 // Reuse the preserved resolved-load partitioner: a parent Force is assembled
 // once across the union of participating bodies, never once per descendant.
 const mapped=mapResolvedLoads({cells,spacingMetres,bodies,forces,fixtures});
 const problems=mapped.bodies.map((record,i)=>{
  const body=bodies[i],grid=createGrid({cells:Array.from(cells),spacing:Array.from(spacingMetres),materials:[body.material],materialIds:Array.from(body.occupancy,v=>v?0:-1)});
  const constraints=[],prescribed=new Map();
  for(const fixture of record.fixtures){
   const displacement=fixtureValues.get(key(fixture));
   for(const node of fixture.nodes)for(let k=0;k<3;k++){
    const dof=3*node+k,value=displacement[k];
    if(prescribed.has(dof)&&prescribed.get(dof)!==value)throw Error('Conflicting resolved fixture translations');
    prescribed.set(dof,value);
   }
  }
  for(const [dof,value]of prescribed)constraints.push({dof,value});
  const loads=record.loads.slice();
  // Reuse PCG canonical/range/nullspace admission, before any device access.
  validateProblem(grid,{loads,constraints});
  return {source:body.source,uid:body.uid,grid,loads,constraints,material:{young:body.material.young,poisson:body.material.poisson,yieldStrength:body.material.yieldStrength,density:body.material.density}};
 });
 return {owner,frame:input.frame,problems,forceRecords:mapped.forces,backend:'resolved-cells-to-pcg-preparation',sceneSolved:false,analysisReady:false,geometryReadbackBytes:0,contact:'unresolved',fixturePolicy:'explicit full-cell initial overlap; prescribed translation only'};
}

/** One selected independent body, on the caller's borrowed shared device.
 * isCurrent must observe native inputs in an eventual scene integration; this
 * explicit callback is not proof that a native scene has been captured.
 */
export async function createResolvedBodyPCG(device,input,bodyRef,options={}){
 if(!options||Object.keys(options).some(k=>!['isCurrent','signal','tolerance','maxIterations','checkpointEvery'].includes(k))||typeof options.isCurrent!=='function')throw Error('Explicit bounded PCG options/currentness callback required');
 const selected=key(bodyRef),prepared=prepareResolvedCase(input),problem=prepared.problems.find(p=>key(p)===selected);
 if(!problem)throw Error('Selected resolved body is absent');
 const solver=await createGPUPCG(device,problem.grid,{...options,loads:problem.loads,constraints:problem.constraints});
 return {source:problem.source,uid:problem.uid,frame:prepared.frame,owner:prepared.owner,sceneSolved:false,analysisReady:false,solver};
}
