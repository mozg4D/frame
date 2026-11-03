import {launch,ready} from '../tools/browser.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export async function handWorkflowChecks(page){
 const checks=[],timings=[],call=(n,a={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[n,a]),state=()=>call('scene.inspect');
 const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});if(!pass)throw Error(name+': '+JSON.stringify(detail));};
 const measure=async(name,budget,fn)=>{const start=performance.now(),result=await fn(),ms=performance.now()-start;timings.push({name,ms,budget});check(name+' latency',ms<budget,{ms,budget});return result;};
 const rejects=async(name,fn)=>{let rejected=false;try{await fn();}catch{rejected=true;}check(name,rejected);};
 const quad={vertices:[-80,-60,0,80,-60,0,80,60,0,-80,60,0],indices:[0,1,2,0,2,3]};
 try{
  await call('scene.new');const start=(await state()).view;check('Empty document camera follows levelled shared view',Math.abs(start.camera[0]+Math.PI/4)<1e-10&&Math.abs(start.camera[1]-Math.PI/6)<1e-10&&start.camera[2]===.4,start.camera);
  for(const storage of ['auto','texture'])for(const angle of [45,45.9,46,46.1]){
   await call('scene.new');const rad=angle*Math.PI/180,n=await call('mesh.create',{storage,vertices:[0,-30,0,0,30,0,-60,0,0,60*Math.cos(rad),0,60*Math.sin(rad)],indices:[0,1,2,1,0,3]});
   const crease=await page.evaluate(h=>frameEngine.scene.meshes.find(m=>m.hashId===h).edgeCounts[1],n.hash);check(storage+' native crease at '+angle+' degrees',crease===(angle>=46?1:0),{crease,angle});
  }
  await call('scene.new');let n=await call('mesh.create',quad);const red=await call('material.create',{name:'Red',params:{h:0,s:80,l:50}}),blue=await call('material.create',{name:'Blue',params:{h:220,s:80,l:50}});
  await measure('Assign explicit face material',600,()=>call('material.assign',{id:n.hash,material:red.uid,faces:[0]}));
  await call('view.set',{index:2,single:true,shading:'solid',focus:n.hash,mode:'polygon'});await call('scene.select',{ids:[n.hash],mode:'polygon'});
  const blank=(await call('view.project',{id:n.hash,point:[-40,20,0]})).screen;await page.locator('#tabAttributes').click();await measure('Pick polygon outside material selections',800,async()=>{await page.mouse.click(...blank);await state();});check('Unassigned polygon retains the current editor panel',await page.locator('#tabAttributes').getAttribute('aria-selected')==='true');
  await call('material.assign',{id:n.hash,material:blue.uid,faces:[1]});
  const p=(await call('view.project',{id:n.hash,point:[40,-20,0]})).screen;await measure('Pick polygon and resolve material mask',800,async()=>{await page.mouse.click(...p);await state();});check('Native polygon click opens its masked material',(await state()).materialEditor.material===red.uid,await state());
  check('Polygon click opens Material Editor',await page.locator('#tabMaterialMgr').evaluate(e=>e.classList.contains('active')||e.getAttribute('aria-selected')==='true'||document.querySelector('#matEditorContent').getClientRects().length>0));
  for(const mode of ['vertex','edge','polygon']){
   await call('scene.select',{ids:[n.hash],mode});await page.locator('#row-'+n.id+' [data-tag="1"]').click();await state();check(mode+' tag selects its material',(await state()).materialEditor.material===blue.uid);
   await measure(mode+' material context mode exit',800,async()=>{await page.locator({vertex:'#btnVertexMode',edge:'#btnEdgeMode',polygon:'#btnPolygonMode'}[mode]).click();await state();});check(mode+' exit retains chosen material',(await state()).selection.mode==='object'&&(await state()).materialEditor.material===blue.uid,await state());
  }
  const before=await call('diagnostics.appearance',{id:n.hash}),geometry=await call('diagnostics.mesh',{id:n.hash,geometry:true});
  const inspection=await measure('Inspect native IDs and topology',700,()=>call('mesh.inspect',{id:n.hash,topology:true}));check('Inspection exposes canonical vertex and face IDs',inspection.vertices.length===4&&inspection.faces[1].vertices.join(',')==='0,2,3'&&inspection.topology.boundary.length===4&&inspection.topology.creases.length===0,inspection);
  await rejects('Out of bounds inspection rejects',()=>call('mesh.inspect',{id:n.hash,vertices:[4]}));
  await rejects('Masked replacement requires material lineage',()=>call('mesh.replace',{id:n.hash,...quad}));
  await rejects('Float32 overflow rejects before publication',()=>call('mesh.replace',{id:n.hash,vertices:[1e100,0,0,10,0,0,0,10,0],indices:[0,1,2],sourceFaces:[0]}));
  await rejects('Invalid face lineage rejects before publication',()=>call('mesh.replace',{id:n.hash,...quad,sourceFaces:[0,2]}));
  const altered=[...quad.vertices];altered[0]-=20;const replaced=await measure('Replace same-count mesh and materials',1000,()=>call('mesh.replace',{id:n.hash,vertices:altered,indices:quad.indices,sourceFaces:[0,1]}));
  n=replaced.object;check('Same-count replacement changes actual positions',(await call('mesh.inspect',{id:n.hash,vertices:[0]})).vertices[0].position[0]===-100);
  check('Replacement preserves both source masks',(await call('diagnostics.appearance',{id:n.hash})).materials.map(m=>m.triangles).join(',')==='1,1');
  await call('edit.history',{action:'undo'});n=(await state()).objects[0];const undo=await call('diagnostics.mesh',{id:n.hash,geometry:true});check('One Undo restores exact positions and indices',undo.positionsSHA256===geometry.positionsSHA256&&undo.indicesSHA256===geometry.indicesSHA256);check('One Undo restores exact material masks',JSON.stringify(await call('diagnostics.appearance',{id:n.hash}))===JSON.stringify(before));
  await call('edit.history',{action:'redo'});n=(await state()).objects[0];check('Redo restores replacement',n.mesh.triangles===2&&(await call('mesh.inspect',{id:n.hash,vertices:[0]})).vertices[0].position[0]===-100);
  await measure('Select explicit native face IDs',600,()=>call('scene.select',{ids:[n.hash],mode:'polygon',components:[1]}));check('Explicit native face selection uses Polygon mode',(await state()).selection.mode==='polygon'&&(await state()).selection.counts.reduce((a,b)=>a+b,0)===1,await state());
  await rejects('Invalid explicit face selection rejects',()=>call('scene.select',{ids:[n.hash],mode:'polygon',components:[2]}));
  const focus=await measure('Focus current component selection',600,()=>call('view.set',{focusSelection:true}));check('Component focus retains selected face',focus.mode==='polygon'&&(await state()).selection.counts.reduce((a,b)=>a+b,0)===1);
  // Two closed tetrahedra overlap; an unselected third island must retain its unselected faces.
  await call('scene.new');const tet=(x,y,z)=>({vertices:[x,y,z,x+60,y,z,x,y+60,z,x,y,z+60],indices:[0,2,1,0,1,3,0,3,2,1,2,3]});const a=tet(0,0,0),b=tet(12,12,12),c=tet(150,0,0),multi={vertices:[...a.vertices,...b.vertices,...c.vertices],indices:[...a.indices,...b.indices.map(i=>i+4),...c.indices.map(i=>i+8)]};
  n=await call('mesh.create',multi);await call('scene.select',{ids:[n.hash],mode:'polygon',components:[0,4]});const selectedBefore=(await state()).selection;
  const united=await measure('Unite selected polygon islands',3000,()=>call('geometry.unite'));let s=await state();check('Unite retains Polygon mode and output polygon selection',s.selection.mode==='polygon'&&s.selection.counts.reduce((a,b)=>a+b,0)===united.object.mesh.triangles-4,{selection:s.selection,report:united.report});
  await call('edit.history',{action:'undo'});s=await state();check('Unite Undo restores exact face selection',s.objects[0].mesh.triangles===12&&s.selection.mode==='polygon'&&s.selection.counts.reduce((a,b)=>a+b,0)===selectedBefore.counts.reduce((a,b)=>a+b,0),s.selection);
  await call('edit.history',{action:'redo'});s=await state();check('Unite Redo restores output polygon selection',s.selection.mode==='polygon'&&s.selection.counts.reduce((a,b)=>a+b,0)===united.object.mesh.triangles-4,s.selection);
  const frames=await call('diagnostics.frame',{frames:8});timings.push({name:'Changed crease shader CPU/GPU frames',frames:frames.frames,adapter:frames.adapter});check('Crease rendering supplies measured CPU and GPU frames',frames.frames.every(f=>f.cpuMs>=0&&f.gpuMs>=0),frames);
  const reference=JSON.parse(await readFile(new URL('scenes/hand-bend-reference.json',import.meta.url),'utf8'));check('Authored bend study contains no failed probes',reference.failures.length===0);
  const dot=(a,b)=>a.reduce((sum,v,k)=>sum+v*b[k],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  await measure('Validate eight-sided bend fixture corpus',20000,async()=>{for(const [i,pose]of reference.cases.entries()){
   await call('scene.new');const n=await call('mesh.create',{vertices:pose.vertices,indices:pose.indices,...i%2?{storage:'texture'}:{}}),result=await call('mesh.inspect',{id:n.hash,vertices:[],faces:[],topology:true});
   check(pose.name+' has no unintended crease',result.topology.creases.length===0&&result.topology.maxAngle<46,result.topology.maxAngle);check(pose.name+' retains one open root and oriented surface',result.topology.boundary.length===8&&result.topology.nonmanifold.length===0&&result.topology.orientationWarnings===0&&result.topology.degenerate.length===0);
   let volume=0;for(let f=0;f<pose.closedIndices.length;f+=3){const P=pose.closedIndices.slice(f,f+3).map(v=>pose.vertices.slice(v*3,v*3+3));volume+=dot(P[0],cross(P[1],P[2]))/6;}
   check(pose.name+' conserves finger volume after Float32 publication',Math.abs(Math.abs(volume)/pose.referenceVolume-1)<2e-6,{volume,reference:pose.referenceVolume});
   const crease=await page.evaluate(h=>frameEngine.scene.meshes.find(m=>m.hashId===h).edgeCounts[1],n.hash);check(pose.name+' native GPU agrees with angle oracle',crease===0,crease);
  }});
 }catch(error){return {pass:false,checks,timings,error:error.message,debug:await state().catch(()=>null)};}
 return {pass:checks.every(c=>c.pass),checks,timings};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const app=await launch({headless:process.argv.includes('--headless')});try{await ready(app.page);const errors=[];app.page.on('pageerror',e=>errors.push(e.message));app.page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});const report=await handWorkflowChecks(app.page);report.errors=errors;report.pass&&=!errors.length;report.indexSHA256=createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex');await writeFile(new URL('results/hand-workflow.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,checks:report.checks.length,error:report.error,failed:report.checks.filter(c=>!c.pass),errors,timings:report.timings},null,2));process.exitCode=report.pass?0:1;}finally{await app.close();}
}
