import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {launch,ready,root} from '../tools/browser.mjs';
const sha=async()=>createHash('sha256').update(await readFile(join(root,'index.html'))).digest('hex');
const report={started:new Date().toISOString(),indexSHA256:await sha(),checks:[],errors:[],counts:[]},session=await launch({headless:process.argv.includes('--headless')}),{page}=session;
const call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]),check=(name,pass,detail)=>{report.checks.push({name,pass:!!pass,detail});if(!pass)throw Error(name);},same=(a,b)=>a.length===b.length&&a.every((v,i)=>Math.abs(v-b[i])<1e-5);
page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
try{
 await ready(page);await page.evaluate(()=>{window._clonerGPU=[];frameEngine.renderer.device.addEventListener('uncapturederror',e=>_clonerGPU.push(e.error.message));});
 await call('scene.open',{url:'tests/scenes/'+encodeURIComponent('ведьма.obj')});const witch=(await call('scene.inspect')).objects.find(n=>n.mesh);check('Original witch loaded at full resolution',witch.mesh.triangles===1129448,witch.mesh);
 const sphere=await call('scene.create',{type:'sphere',params:{diameter:10}}),start=performance.now(),cloner=await call('scene.create',{type:'cloner',inputs:[sphere.hash],params:{type:'object',object:witch.hash,count:100}});let copies=await call('diagnostics.replicas',{id:cloner.hash,limit:1000});report.prepareMs=performance.now()-start;check('100 spheres placed on full witch',copies.count===100&&copies.distribution.preparations===1,{count:copies.count,distribution:copies.distribution});
 for(const count of [200,1000,50]){const previous=copies.copies.map(c=>c.matrix),started=performance.now();await call('scene.update',{id:cloner.hash,params:{count}});const updateMs=performance.now()-started;copies=await call('diagnostics.replicas',{id:cloner.hash,limit:1000});check('Count '+count+' updates copies and preserves sample prefix',copies.count===count&&copies.copies.slice(0,Math.min(previous.length,count)).every((c,i)=>same(c.matrix,previous[i])),{count,updateMs,distribution:copies.distribution});report.counts.push({count,updateMs,distribution:copies.distribution});}
 check('All count changes reuse one surface preparation',copies.distribution.preparations===1&&copies.distribution.requests===4,copies.distribution);
 const before=copies.copies.map(c=>c.matrix);await call('scene.select',{ids:[sphere.hash]});await call('transform.set',{channel:'position',axis:0,value:200});copies=await call('diagnostics.replicas',{id:cloner.hash,limit:1000});check('Moving sphere leaves witch distribution unchanged',copies.copies.every((c,i)=>same(c.matrix,before[i])));
 const pivot=await page.evaluate(()=>frameEngine.transformState.position);await call('view.set',{pivot:true});await call('transform.set',{channel:'position',axis:0,value:pivot[0]+20});copies=await call('diagnostics.replicas',{id:cloner.hash,limit:1000});check('Sphere pivot shifts geometry inside every clone',copies.copies.every((c,i)=>Math.abs(Math.hypot(...c.matrix.slice(12,15).map((v,k)=>v-before[i][k+12]))-20)<1e-4));
 await call('scene.new');
 const cylinder=await call('scene.create',{type:'cylinder',params:{diameter:100,height:100}});
 const grass=await call('scene.create',{type:'tree',params:{type:'grass'}});
 const scatter=await call('scene.create',{type:'cloner',inputs:[grass.hash],params:{type:'object',object:cylinder.hash,count:640}});
 const sample=()=>call('diagnostics.replicas',{id:scatter.hash,limit:640});
 const upright=matrix=>Math.abs(matrix[5])>.999999;
 const basis=matrix=>[0,4,8].map(k=>matrix.slice(k,k+3));
 const orthonormal=m=>basis(m).every((v,i,a)=>Math.abs(Math.hypot(...v)-1)<1e-8&&a.slice(i+1).every(w=>Math.abs(v.reduce((s,x,k)=>s+x*w[k],0))<1e-8));
 const initial=await sample();
 check('Ordinary cylinder samples side walls and end caps',initial.copies.some(c=>upright(c.matrix))&&initial.copies.some(c=>!upright(c.matrix)));
 const thinStart=performance.now();
 await call('transform.apply',{ids:[cylinder.hash],size:[47521.7357,.02266,47521.7357]});
 const thin=await sample();
 check('Flattening the target updates completed placements within two seconds',performance.now()-thinStart<2000);
 check('Grass keeps rigid frames on the flattened cylinder',thin.copies.length===640&&thin.copies.every(c=>orthonormal(c.matrix)));
 check('Sampling measures the transformed cylinder caps',thin.copies.every(c=>upright(c.matrix))&&thin.copies.some(c=>c.matrix[5]>0)&&thin.copies.some(c=>c.matrix[5]<0));
 check('Anisotropy reweights areas without a new geometry readback',thin.distribution.requests===initial.distribution.requests+1&&thin.distribution.readbackBytes===initial.distribution.readbackBytes);
 await call('transform.apply',{ids:[cylinder.hash],rotation:[23,0,12],position:[375,150,82]});
 const tilted=await sample();
 const edited=(await call('scene.inspect')).objects.find(o=>o.hash===cylinder.hash).worldMatrix;
 const up=edited.slice(4,7),length=Math.hypot(...up);
 check('Rigid motion carries the same samples with transformed face normals',tilted.distribution.requests===thin.distribution.requests&&tilted.copies.every(c=>orthonormal(c.matrix)&&Math.abs(Math.abs(up.reduce((s,v,k)=>s+v*c.matrix[4+k],0)/length)-1)<1e-6));
 const raw=await page.evaluate(async h=>{const g=await frameEngine.readGeometry(h);return {vertices:Array.from(g.vertices),indices:Array.from(g.indices)};},cylinder.hash);
 for(let i=0;i<raw.vertices.length;i+=3){
   const [x,y,z]=raw.vertices.slice(i,i+3);
   for(let k=0;k<3;k++)raw.vertices[i+k]=edited[k]*x+edited[4+k]*y+edited[8+k]*z+edited[12+k];
 }
 const baked=await call('mesh.create',{...raw,storage:'texture'});
 await call('scene.update',{id:scatter.hash,params:{object:baked.hash}});
 const equivalent=await sample();
 check('A baked paged cylinder yields the same seeded positions as an affine target',equivalent.copies.every((c,i)=>Math.hypot(...c.matrix.slice(12,15).map((v,k)=>v-tilted.copies[i].matrix[12+k]))<.02));
 report.gpu=await page.evaluate(()=>_clonerGPU);check('No uncaptured WebGPU errors',report.gpu.length===0,report.gpu);report.pass=!report.errors.length;
}catch(e){report.error=e.stack;report.pass=false;}finally{await session.close();report.indexSHA256After=await sha();if(report.indexSHA256After!==report.indexSHA256){report.pass=false;report.errors.push('index.html changed during verification');}await mkdir(join(root,'tests/results'),{recursive:true});await writeFile(join(root,'tests/results/object-cloner-witch.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));process.exitCode=report.pass?0:1;}
