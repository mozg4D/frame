import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {launch,ready} from '../../../tools/browser.mjs';
const report={pass:false,scope:'GPU-resident Hex8 PCG on authored resolved grids, shared Frame GPUDevice; not scene Solve',sceneSolved:false,analysisReady:false,hardwareValidated:false,checks:[],errors:[],sources:{}};
let session;
try {
 for(const p of ['index.html','experiments/structural-pcg/gpu-pcg.js','experiments/structural-pcg/hex8-reference.js','experiments/structural-pcg/tests/hardware.mjs']) report.sources[p]=createHash('sha256').update(await readFile(new URL('../../../'+p,import.meta.url))).digest('hex');
 report.physicalGPU=execFileSync('nvidia-smi',['--query-gpu=name,driver_version,memory.total','--format=csv,noheader'],{encoding:'utf8',windowsHide:true}).trim();
 session=await launch({headless:true}); const page=session.page;page.on('pageerror',e=>report.errors.push(e.message));await ready(page);
 const sceneBefore=await page.evaluate(async()=>{const s=await frameAI.call('scene.inspect');if(s.stats)delete s.stats.frame;return JSON.stringify(s);});
 report.probe=await page.evaluate(async()=>{
  const {createGPUPCG}=await import('./experiments/structural-pcg/gpu-pcg.js'),{createGrid,faceLoad,solve,evaluateCells,applyStiffness}=await import('./experiments/structural-pcg/hex8-reference.js');
  const device=frameEngine.renderer.device,errors=[],onError=e=>errors.push(e.error.message),out={cases:[],adapter:Object.fromEntries(['vendor','architecture','device','description','isFallbackAdapter'].map(k=>[k,device.adapterInfo?.[k]??null]))};device.addEventListener('uncapturederror',onError);device.pushErrorScope('validation');let lost=null;device.lost.then(e=>lost=e.reason);
  const material={young:210e9,poisson:.3,yieldStrength:250e6};
  const check=(name,pass,detail)=>{out.cases.push({name,pass:!!pass,detail});if(!pass)throw Error(name+': '+JSON.stringify(detail));};
  const readAll=async(s,g)=>{const u=new Float64Array(g.dofs);for(let offset=0;offset<g.dofs;offset+=256)u.set(await s.inspectDisplacement({offset,count:Math.min(256,g.dofs-offset)}),offset);return u;};
  const clamp=g=>Array.from({length:g.nodeCount},(_,n)=>n).filter(n=>g.position(n)[0]===0).flatMap(n=>[0,1,2].map(k=>({dof:3*n+k})));
  const norm=a=>Math.hypot(...a),relative=(a,b)=>norm(a.map((v,i)=>v-b[i]))/Math.max(norm(b),Number.MIN_VALUE);
  let solver;
  try {
   for(const cells of [[4,1,1],[8,2,2],[16,4,4]]) {
    const spacing=cells.map((n,k)=>[.2,.04,.04][k]/n),grid=createGrid({cells,spacing,materials:[material]}),constraints=[];
    for(let n=0;n<grid.nodeCount;n++)for(let k=0;k<3;k++)if(grid.position(n)[k]===0)constraints.push({dof:3*n+k});
    const force=1000,loads=faceLoad(grid,0,1,[force,0,0]),started=performance.now();solver=await createGPUPCG(device,grid,{loads,constraints,tolerance:2e-5,maxIterations:3000,checkpointEvery:8});
    const status=await solver.run();check('tension '+cells.join('x')+' converges after exact residual',status.converged&&status.exactChecks>=1&&status.relativeResidual<=2e-5,status);
    const u=await readAll(solver,grid),stress=force/(.04*.04),end=stress/material.young*.2,expected=new Float64Array(grid.dofs);for(let n=0;n<grid.nodeCount;n++){const p=grid.position(n);expected.set([stress/material.young*p[0],-material.poisson*stress/material.young*p[1],-material.poisson*stress/material.young*p[2]],3*n);}
    let maxDisp=0;for(let i=0;i<u.length;i++)maxDisp=Math.max(maxDisp,Math.abs(u[i]-expected[i])/end);
    const fields=evaluateCells(grid,u),stressError=Math.max(...fields.map(f=>Math.abs(f.vonMises/stress-1))),internal=applyStiffness(grid,u);let free2=0,load2=0,reactionX=0;const fixed=new Set(constraints.map(c=>c.dof));for(let i=0;i<u.length;i++){if(fixed.has(i)){if(i%3===0)reactionX+=internal[i]-loads[i];}else {free2+=(internal[i]-loads[i])**2;load2+=loads[i]**2;}}
    check('tension '+cells.join('x')+' independent F L / E A, Poisson, stress, reaction',maxDisp<.002&&stressError<.005&&Math.abs(reactionX+force)<.5&&Math.sqrt(free2/load2)<1e-4,{maxRelativeDisplacementError:maxDisp,maxRelativeStressError:stressError,reactionX,independentRelativeResidual:Math.sqrt(free2/load2),summary:solver.summary()});
    check('tension '+cells.join('x')+' completed budget',performance.now()-started<15000,{completedIncludingCompilationMs:performance.now()-started,limitMs:15000});await solver.dispose();solver=null;
   }
   {
    const cells=[4,2,1],grid=createGrid({cells,spacing:[.01,.01,.01],materials:[material,{...material,young:70e9}],materialIds:Array.from({length:8},(_,i)=>Math.floor(i/4))}),loads=faceLoad(grid,0,1,[0,0,-100]),constraints=clamp(grid),cpu=solve(grid,{loads,constraints,tolerance:1e-10,maxIterations:4000});
    check('independent Float64 multimat oracle converges',cpu.converged,{iterations:cpu.iterations,residual:cpu.relativeResidual});solver=await createGPUPCG(device,grid,{loads,constraints,tolerance:2e-5,checkpointEvery:8});const status=await solver.run(),u=await readAll(solver,grid);check('multi-material bending matches Float64 equation',status.converged&&relative(u,cpu.displacement)<.002&&status.completedMs<10000,{status,relativeDisplacementError:relative(u,cpu.displacement)});await solver.dispose();solver=null;
    solver=await createGPUPCG(device,grid,{loads,constraints,tolerance:1e-7,maxIterations:1,checkpointEvery:8});const fail=await solver.run();let noField=false,repeated=false;try{await solver.inspectDisplacement({count:1});}catch{noField=true;}try{await solver.run();}catch{repeated=true;}check('iteration limit never exposes a valid displacement field',!fail.converged&&fail.reason==='iteration-limit'&&noField&&repeated,{fail,noField,repeated});await solver.dispose();solver=null;
   }
   {
    const grid=createGrid({cells:[4,2,2],spacing:[.01,.01,.01],materials:[material]}),translation=[2e-6,-3e-6,1e-6],constraints=clamp(grid).map(c=>({...c,value:translation[c.dof%3]})),loads=new Float64Array(grid.dofs);solver=await createGPUPCG(device,grid,{loads,constraints,tolerance:2e-5});const status=await solver.run(),u=await readAll(solver,grid);let error=0;for(let i=0;i<u.length;i++)error=Math.max(error,Math.abs(u[i]-translation[i%3]));check('nonzero welded translation enters projected RHS',status.converged&&error<2e-9,{status,maxTranslationErrorMetres:error});await solver.dispose();solver=null;
   }
   {
    const grid=createGrid({cells:[4,1,1],spacing:[.01,.01,.01],materials:[material]}),constraints=clamp(grid),loads=faceLoad(grid,0,1,[1000,0,0]);let current=true;solver=await createGPUPCG(device,grid,{loads,constraints,isCurrent:()=>current,checkpointEvery:1});const p=solver.run();current=false;let rejected=false;try{await p;}catch{rejected=true;}check('mid-await stale problem retires without a result',rejected&&solver.summary()===null,{rejected});await solver.dispose();solver=null;
    const controller=new AbortController();solver=await createGPUPCG(device,grid,{loads,constraints,signal:controller.signal});const p2=solver.run();controller.abort();let cancelled=false;try{await p2;}catch{cancelled=true;}check('cancellation retires without a result',cancelled&&solver.summary()===null,{cancelled});await solver.dispose();solver=null;
    for(const magnitude of [1e30,1e-30]){const badLoads=faceLoad(grid,0,1,[magnitude,0,0]);solver=await createGPUPCG(device,grid,{loads:badLoads,constraints});const state=await solver.run();check('Float32 reduction overflow/underflow '+magnitude+' fails explicitly',!state.converged&&state.reason==='non-finite',state);await solver.dispose();solver=null;}
   }
   {
    const grid=createGrid({cells:[4,1,1],spacing:[.01,.01,.01],materials:[material]}),loads=faceLoad(grid,0,1,[1000,0,0]),constraints=clamp(grid);
    solver=await createGPUPCG(device,grid,{loads,constraints,tolerance:2e-5});const state=await solver.run();
    check('diagnostic lifecycle fixture converges',state.converged,state);
    const started=performance.now(),first=solver.inspectDisplacement({count:4});
    let excluded=false;try{await solver.inspectDisplacement({count:4});}catch{excluded=true;}
    const values=await first;
    check('concurrent diagnostic allocation is rejected on shared hardware',excluded&&values.length===4&&values.every(Number.isFinite),{excluded,values:Array.from(values)});
    const pending=solver.inspectDisplacement({count:4});
    const rejected=pending.then(()=>false,()=>true),retire1=solver.dispose(),retire2=solver.dispose();
    await Promise.all([retire1,retire2]);
    check('all retirement callers complete and pending diagnostics stay unavailable',await rejected&&solver.summary()===null&&retire1===retire2,{sameRetirement:retire1===retire2});
    check('diagnostic lifecycle completed budget',performance.now()-started<5000,{completedMs:performance.now()-started,limitMs:5000});solver=null;
   }
   check('all work retains original Frame GPUDevice',frameEngine.renderer.device===device&&!lost,{lost});
  }finally{await solver?.dispose();await device.queue.onSubmittedWorkDone();out.validationError=(await device.popErrorScope())?.message??null;out.uncapturedErrors=errors;device.removeEventListener('uncapturederror',onError);}
  return out;
 });
 const check=(name,pass,detail)=>{report.checks.push({name,pass:!!pass,detail});assert.ok(pass,name+': '+JSON.stringify(detail));};
 check('physical non-fallback RTX hardware',report.probe.adapter.vendor==='nvidia'&&report.probe.adapter.isFallbackAdapter===false&&/RTX 3060/.test(report.physicalGPU),{adapter:report.probe.adapter,physical:report.physicalGPU});
 check('no validation or uncaptured WebGPU errors',!report.probe.validationError&&!report.probe.uncapturedErrors.length,{validation:report.probe.validationError,errors:report.probe.uncapturedErrors});
 const sceneAfter=await page.evaluate(async()=>{const s=await frameAI.call('scene.inspect');if(s.stats)delete s.stats.frame;return JSON.stringify(s);});check('numerical checkpoint never changes native authoring scene',sceneBefore===sceneAfter);
 check('no page errors',!report.errors.length,report.errors);report.pass=true;report.hardwareValidated=true;
} catch(error){report.error=error.stack;process.exitCode=1;}finally{await session?.close();await mkdir(new URL('./results/',import.meta.url),{recursive:true});await writeFile(new URL('./results/hardware.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
