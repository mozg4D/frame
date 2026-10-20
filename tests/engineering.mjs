import {booleanProgressOperation} from './boolean-progress.mjs';
import {engineeringFixtures,binarySTL,revolve} from './engineering-fixtures.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {root} from '../tools/browser.mjs';
function closedRevolve(profile,segments){const input=revolve(profile,segments),vertices=[],map=new Map(),ids=[];for(let i=0;i<input.vertices.length;i+=3){const p=input.vertices.slice(i,i+3),key=p.map(v=>Math.round(v*1e6)).join(':');let id=map.get(key);if(id===undefined){id=vertices.length/3;map.set(key,id);vertices.push(...p);}ids.push(id);}const indices=[];for(let i=0;i<input.indices.length;i+=3){const tri=input.indices.slice(i,i+3).map(v=>ids[v]);if(new Set(tri).size===3)indices.push(...tri);}return {vertices,indices};}
export async function engineeringChecks(page){
 const checks=[],timings=[],call=(n,a={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[n,a]),check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});if(!pass)throw Error(name);};
 try{
  await mkdir(join(root,'tests/results/engineering'),{recursive:true});
  for(const f of engineeringFixtures()){
   const bytes=binarySTL(f);await writeFile(join(root,'tests/results/engineering',f.name+'.stl'),bytes);const state=await call('scene.open',{name:f.name+'.stl',base64:bytes.toString('base64')}),n=state.objects.find(n=>n.mesh),before=await call('diagnostics.mesh',{id:n.hash,geometry:true}),patch=await call('mesh.toSplinePatch',{id:n.hash}),after=patch.mesh?await call('diagnostics.mesh',{id:patch.hash,geometry:true}):null,extent=Math.max(...before.bounds.max.map((v,k)=>v-before.bounds.min[k])),volumeError=after?Math.abs(Math.abs(after.signedVolume)/Math.abs(before.signedVolume)-1):Infinity;
   check('STL recognition '+f.name,!patch.buildError&&patch.type==='spline_patch'&&patch.sources.length===1&&after?.finite&&after.indicesValid&&after.triangles>0&&volumeError<.08&&['min','max'].every(key=>before.bounds[key].every((v,k)=>Math.abs(v-after.bounds[key][k])<extent*.04)),{inputTriangles:before.triangles,outputTriangles:after?.triangles,volumeError,patch});
   await call('edit.history',{action:'undo'});const undo=await call('diagnostics.mesh',{id:n.hash,geometry:true});check('STL exact Undo '+f.name,undo.positionsSHA256===before.positionsSHA256&&undo.indicesSHA256===before.indicesSHA256);
  }
  // Two independently tessellated smooth engineering bodies, 786k input triangles.
  const profile=Array.from({length:129},(_,i)=>{const t=i/128*Math.PI;return [40*Math.sin(t),40*Math.cos(t)];}),mesh=closedRevolve(profile,1536),s=await call('scene.inspect');await call('scene.delete',{ids:s.objects.filter(n=>!n.parent).map(n=>n.hash)});
  const a=await call('mesh.create',mesh),b=await call('mesh.create',mesh);await call('scene.select',{ids:[b.hash]});await call('transform.set',{channel:'position',axis:0,value:30});let boolean;
  for(const op of ['union','subtract','intersect']){const run=await booleanProgressOperation(page,'Dense Boolean '+op,()=>!boolean?call('scene.create',{type:'boolean',inputs:[a.hash,b.hash],params:{op}}):call('scene.update',{id:boolean.hash,params:{op}}),check);boolean=run.value;timings.push(run.timing);const geometry=await call('diagnostics.mesh',{id:boolean.hash,geometry:true}),sphere=4/3*Math.PI*40**3,intersection=Math.PI*(4*40+30)*(2*40-30)**2/12,expected=op==='union'?2*sphere-intersection:op==='subtract'?sphere-intersection:intersection;
   check('Heavy surface Boolean '+op,!boolean.buildError&&boolean.evaluation?.report.trusted&&geometry.finite&&geometry.indicesValid&&Math.abs(Math.abs(geometry.signedVolume)/expected-1)<.07,{report:boolean.evaluation?.report,volume:geometry.signedVolume,expected});
   const topology=await page.evaluate(async hash=>{const {indices}=await frameEngine.readGeometry(hash),edges=new Map();for(let i=0;i<indices.length;i+=3)for(let k=0;k<3;k++){const a=indices[i+k],b=indices[i+(k+1)%3],key=Math.min(a,b)+':'+Math.max(a,b);edges.set(key,(edges.get(key)||0)+1);}return {bad:[...edges.values()].filter(v=>v!==2).length};},boolean.hash);check('Heavy surface Boolean closed topology '+op,topology.bad===0,topology);
  }
  await call('scene.delete',{ids:[boolean.hash]});const dense=closedRevolve(profile,1920),largeA=await call('mesh.create',dense),largeB=await call('mesh.create',dense);await call('scene.select',{ids:[largeB.hash]});await call('transform.set',{channel:'position',axis:0,value:300});const started=performance.now(),large=await call('scene.create',{type:'boolean',inputs:[largeA.hash,largeB.hash],params:{op:'union'}}),g=await call('diagnostics.mesh',{id:large.hash,geometry:true});
  check('Million triangle disjoint Boolean shares GPU path',!large.buildError&&large.evaluation?.report.backend==='webgpu-disjoint'&&large.evaluation.report.readbackBytes===0&&g.finite&&g.indicesValid,{report:large.evaluation?.report,wallMs:performance.now()-started,triangles:g.triangles});
  return {pass:true,checks,timings};
 }catch(e){return {pass:false,checks,error:e.stack};}
}
