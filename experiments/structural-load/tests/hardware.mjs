import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {launch,ready} from '../../../tools/browser.mjs';
const paths=['index.html','experiments/structural-load/resolved-case.js','experiments/structural-load/load-case-reference.js','experiments/structural-load/load-mapping-reference.js','experiments/structural-pcg/gpu-pcg.js','experiments/structural-pcg/hex8-reference.js','experiments/structural-load/tests/hardware.mjs'];
const sources=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,createHash('sha256').update(await readFile(new URL('../../../'+p,import.meta.url))).digest('hex')])));
const report={started:new Date().toISOString(),scope:'Explicit resolved-cell load assembly through borrowed-device PCG; not native geometry capture or scene Solve',sceneSolved:false,analysisReady:false,pass:false,errors:[],sources:await sources()};let app;
try{
 app=await launch({headless:true});await ready(app.page);app.page.on('pageerror',e=>report.errors.push(e.message));
 const before=await app.page.evaluate(async()=>{const s=await frameAI.call('scene.inspect');if(s.stats)delete s.stats.frame;return JSON.stringify(s)});
 report.probe=await app.page.evaluate(async()=>{
  const {prepareResolvedCase,createResolvedBodyPCG}=await import('./experiments/structural-load/resolved-case.js');
  const {applyStiffness,solve}=await import('./experiments/structural-pcg/hex8-reference.js');
  const device=frameEngine.renderer.device,checks=[],errors=[],onError=e=>errors.push(e.error.message),material={young:210e9,poisson:0,yieldStrength:250e6,density:7800};
  const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});if(!pass)throw Error(name+': '+JSON.stringify(detail))};
  const fixture=n=>({owner:{source:'Structural explicit reference',uid:'owner'},frame:7,cells:[n,1,1],spacingMetres:[.2/n,.04,.04],bodies:[{source:'part',uid:'material',occupancy:Array(n).fill(1),material:{...material}}],fixtures:[{source:'support',uid:'fixture',occupancy:Array.from({length:n},(_,i)=>i===0?1:0)}],forces:[{source:'load',uid:'force',occupancy:Array.from({length:n},(_,i)=>i===n-1?1:0),wrench:{force:[1000,0,0],torque:[0,0,0],pivot:[.2-.1/n,.02,.02]}}]});
  const read=async(s,g)=>{const u=new Float64Array(g.dofs);for(let offset=0;offset<g.dofs;offset+=256)u.set(await s.inspectDisplacement({offset,count:Math.min(256,g.dofs-offset)}),offset);return u};
  let solver,lost=null;device.lost.then(e=>lost=e.reason);device.addEventListener('uncapturederror',onError);device.pushErrorScope('validation');
  let validation;try{
   for(const n of [4,8,16]){
    const input=fixture(n),prepared=prepareResolvedCase(input),p=prepared.problems[0],start=performance.now(),body=await createResolvedBodyPCG(device,input,{source:'part',uid:'material'},{isCurrent:()=>true,tolerance:2e-5,maxIterations:3000,checkpointEvery:8});solver=body.solver;
    const state=await solver.run(),u=await read(solver,p.grid),h=.2/n,coefficient=1000/(material.young*.04*.04),scale=coefficient*.2;let error=0;
    for(let node=0;node<p.grid.nodeCount;node++){const x=p.grid.position(node)[0],expected=coefficient*(x<=h?0:x<.2-h/2?x-h:.2-1.5*h);error=Math.max(error,Math.abs(u[3*node]-expected)/scale,Math.abs(u[3*node+1])/scale,Math.abs(u[3*node+2])/scale)}
    check(n+' cells: adapter preserves source/frame and explicit incompleteness',body.source==='part'&&body.uid==='material'&&body.frame===7&&body.owner===prepared.owner&&!body.sceneSolved&&!body.analysisReady,{source:body.source,frame:body.frame});
    check(n+' cells: exact residual and independent volume-loaded axial bar',state.converged&&state.exactChecks>=1&&state.relativeResidual<=2e-5&&error<.002,{state,maxRelativeDisplacementError:error});
    const internal=applyStiffness(p.grid,u),fixed=new Set(p.constraints.map(c=>c.dof));let reaction=0,free2=0,force2=0;
    for(let i=0;i<u.length;i++){if(fixed.has(i)){if(i%3===0)reaction+=internal[i]-p.loads[i]}else{free2+=(internal[i]-p.loads[i])**2;force2+=p.loads[i]**2}}
    check(n+' cells: independent equation and -1000 N support reaction',Math.abs(reaction+1000)<.5&&Math.sqrt(free2/force2)<1e-4,{reaction,relativeResidual:Math.sqrt(free2/force2)});
    check(n+' cells: completed operation budget',performance.now()-start<15000,{ms:performance.now()-start,budgetMs:15000});await solver.dispose();solver=null;
   }
   {
    const input=fixture(4),translation=[2e-6,-3e-6,1e-6];input.forces=[];input.fixtures[0].displacementMetres=translation;const p=prepareResolvedCase(input).problems[0],body=await createResolvedBodyPCG(device,input,{source:'part',uid:'material'},{isCurrent:()=>true,tolerance:2e-5});solver=body.solver;const state=await solver.run(),u=await read(solver,p.grid);
    check('prescribed resolved translation reaches native GPU RHS',state.converged&&u.every((v,i)=>Math.abs(v-translation[i%3])<2e-9),state);await solver.dispose();solver=null;
   }
   {
    const input=fixture(5);input.bodies=[{source:'left',uid:'material',occupancy:[1,1,0,0,0],material:{...material}},{source:'right',uid:'material',occupancy:[0,0,0,1,1],material:{...material,young:70e9}}];input.fixtures[0].occupancy=[1,0,0,1,0];input.forces[0].occupancy=[1,1,1,1,1];const prepared=prepareResolvedCase(input);
    for(const p of prepared.problems){const cpu=solve(p.grid,{loads:p.loads,constraints:p.constraints,tolerance:1e-10,maxIterations:3000}),body=await createResolvedBodyPCG(device,input,{source:p.source,uid:p.uid},{isCurrent:()=>true,tolerance:2e-5});solver=body.solver;const state=await solver.run(),u=await read(solver,p.grid);let err=0,scale=Math.max(...cpu.displacement.map(Math.abs));for(let i=0;i<u.length;i++)err=Math.max(err,Math.abs(u[i]-cpu.displacement[i])/scale);check(p.source+': selected independent body matches Float64 load partition',cpu.converged&&state.converged&&err<.002,{state,maxRelativeError:err});await solver.dispose();solver=null}
   }
   check('shared original device remains live',frameEngine.renderer.device===device&&!lost,{lost});
  }finally{await solver?.dispose();await device.queue.onSubmittedWorkDone();validation=(await device.popErrorScope())?.message??null;device.removeEventListener('uncapturederror',onError)}
  return {checks,adapter:Object.fromEntries(['vendor','architecture','isFallbackAdapter'].map(k=>[k,device.adapterInfo?.[k]??null])),validation,uncaptured:errors};
 });
 const after=await app.page.evaluate(async()=>{const s=await frameAI.call('scene.inspect');if(s.stats)delete s.stats.frame;return JSON.stringify(s)});
 if(report.probe.adapter.vendor!=='nvidia'||report.probe.adapter.isFallbackAdapter!==false||report.probe.validation||report.probe.uncaptured.length||report.errors.length||before!==after)throw Error('Hardware, scene isolation or error gate failed');report.pass=true;report.hardwareValidated=true;
}catch(e){report.error=e.stack;process.exitCode=1}finally{await app?.close();report.sourcesAfter=await sources();if(JSON.stringify(report.sources)!==JSON.stringify(report.sourcesAfter)){report.pass=false;process.exitCode=1;report.error='Source changed during test'}report.finished=new Date().toISOString();await mkdir(new URL('./results/',import.meta.url),{recursive:true});await writeFile(new URL('./results/hardware.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({pass:report.pass,checks:report.probe?.checks.length,error:report.error,adapter:report.probe?.adapter},null,2))}
