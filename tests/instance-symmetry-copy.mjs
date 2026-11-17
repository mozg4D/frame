import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../tools/browser.mjs';
export async function instanceSymmetryCopyChecks(page){
const report={pass:false,checks:[],errors:[]};
const call=(name,args={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[name,args]);
const check=(name,pass,detail)=>{report.checks.push({name,pass:!!pass,detail});console.log((pass?'PASS ':'FAIL ')+name);assert.ok(pass,name+': '+JSON.stringify(detail));};
page.on('pageerror',e=>report.errors.push(e.message));
try{
 for(const storage of ['auto','texture']){
  await call('scene.new');const source=await call('mesh.create',{vertices:[-12,-10,0,12,-10,0,12,10,0,-12,10,0],indices:[0,1,2,0,2,3],storage});
  await call('scene.update',{id:source.hash,visible:false});const instance=await call('scene.create',{type:'instance',params:{object:source.hash}});
  await call('transform.apply',{ids:[instance.hash],position:[70,0,0]});const symmetry=await call('scene.create',{type:'symmetry',inputs:[instance.hash],params:{X:true,Y:false,Z:false}});
  await call('view.set',{index:2,single:true,mode:'object',shading:'solid',focus:symmetry.hash});await call('scene.select',{ids:[]});
  const point=(await call('view.project',{point:[-73,-5,0]})).screen;await page.mouse.click(...point);await call('scene.inspect');
  const handle=await page.evaluate(async()=>{await frameEngine.draw(false);return frameEngine.gizmoState.handles.find(h=>h.part==='move0').suggested;});
  const started=performance.now();await page.keyboard.down('Control');await page.mouse.move(...handle);await page.mouse.down();await page.mouse.move(handle[0]+35,handle[1],{steps:5});await page.mouse.up();await page.keyboard.up('Control');const state=await call('scene.inspect');
  const copy=state.objects.find(n=>n.type==='instance'&&n.hash!==instance.hash),replicas=await call('diagnostics.replicas',{id:symmetry.hash});
  report.snapshot={state,replicas};check(storage+' Ctrl+drag creates an Instance',!!copy,copy);check(storage+' copied Instance retains source',copy.params.object===source.hash,copy.params);
  const displayed=await page.evaluate(({copy,symmetry})=>frameEngine.scene.meshes.filter(m=>{if(m.hashId!==symmetry||m.frameVisible===false)return false;for(let s=m.replicaSource;s;s=s.replicaSource)if(s.hashId===copy)return true;return false;}).map(m=>({x:m.frameWorld[12],visible:m.frameVisible})),{copy:copy.hash,symmetry:symmetry.hash});
  check(storage+' copied Instance is visible at its moved position under Symmetry',displayed.length===2&&displayed.every(m=>Math.abs(Math.abs(m.x)-Math.abs(copy.worldMatrix[12]))<1e-7),{copy,displayed});
  check(storage+' copy completes within 3000 ms',performance.now()-started<3000);
  await call('edit.history',{action:'undo'});check(storage+' copy and motion share one Undo',!(await call('scene.inspect')).objects.some(n=>n.hash===copy.hash));
  await call('edit.history',{action:'redo'});const redone=(await call('scene.inspect')).objects.find(n=>n.hash===copy.hash),afterRedo=await call('diagnostics.replicas',{id:symmetry.hash});check(storage+' Redo restores visible copy',!!redone&&afterRedo.visible===4&&afterRedo.copies.some(m=>Math.abs(Math.abs(m.worldMatrix[12])-Math.abs(redone.worldMatrix[12]))<1e-7),{redone,afterRedo});
 }
 check('No browser errors',!report.errors.length,report.errors);report.pass=true;
}catch(e){report.error=e.stack;}return report;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const session=await launch({headless:true});let report;try{await ready(session.page);report=await instanceSymmetryCopyChecks(session.page);}catch(error){report={pass:false,error:error.stack};}finally{await session.close();await mkdir(new URL('results/',import.meta.url),{recursive:true});await writeFile(new URL('results/instance-symmetry-copy.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,error:report.error}));process.exitCode=report.pass?0:1;}
}
