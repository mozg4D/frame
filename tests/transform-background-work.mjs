import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export async function transformBackgroundWorkChecks(){
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),a=html.indexOf('    function expandTransformTouching('),b=html.indexOf('    function transformBackground(',a),checks=[],timings=[];assert.ok(a>=0&&b>a);const expand=Function(html.slice(a,b)+';return expandTransformTouching;')(),check=(name,fn)=>{fn();checks.push({name,pass:true});},box=(id,x,y=0)=>({id,boundsMin:[x,y,0],boundsMax:[x+1,y+1,1],frameVisible:true});
 const original=(meshes,moving,epsilon)=>{let added=true;while(added){added=false;for(const m of meshes)if(m.frameVisible!==false&&!moving.has(m)&&[...moving].some(a=>a.boundsMin.every((n,i)=>n<=m.boundsMax[i]+epsilon&&a.boundsMax[i]+epsilon>=m.boundsMin[i]))){moving.add(m);added=true;}}return moving;};
 try{
  for(const [name,positions,epsilon]of [['transitive touching',[0,1,2],0],['reflected negative coordinates',[-3,-2,-1],0],['same epsilon contact',[0,1.000001,2.000002],.000002],['disjoint',[0,4,8],0]]){
   const meshes=[...positions.map((x,i)=>box('m'+i,x)),...Array.from({length:8},(_,i)=>box('far'+i,100+i*3))],expected=original(meshes,new Set([meshes[0]]),epsilon),moving=new Set([meshes[0]]),complete=expand(meshes,moving,epsilon);
   check('Exact ordered closure for '+name,()=>{assert.equal(complete,true);assert.deepEqual([...moving],[...expected]);});
  }
  check('Invisible neighbors do not join the transform background closure',()=>{const meshes=[box('selected',0),{...box('hidden',1),frameVisible:false},...Array.from({length:8},(_,i)=>box('far'+i,100+i*3))],moving=new Set([meshes[0]]);assert.equal(expand(meshes,moving,0),true);assert.deepEqual([...moving],[meshes[0]]);});
  check('Moving half the scene chooses ordinary ordered rendering immediately',()=>{const meshes=Array.from({length:10},(_,i)=>box('m'+i,i*3));assert.equal(expand(meshes,new Set(meshes.slice(0,5)),0),false);});
  check('An expanding contact closure chooses ordinary rendering before moving most owners',()=>{const meshes=Array.from({length:20},(_,i)=>box('m'+i,i));assert.equal(expand(meshes,new Set([meshes[0]]),0),false);});
  let pairs=0;const count=10000,meshes=Array.from({length:count},(_,i)=>{const m=box('m'+i,i*3);Object.defineProperty(m.boundsMin,'every',{value(fn){pairs++;return Array.prototype.every.call(this,fn);}});return m;}),at=performance.now(),complete=expand(meshes,new Set(meshes.slice(0,1000)),0);timings.push({name:'Ten thousand separated owners, one thousand moving',ms:performance.now()-at,pairs,budget:count*8});
  check('Actual AABB work stays within eight pairs per scene mesh',()=>{assert.equal(complete,false);assert.equal(pairs,count*8);});
  check('Budget exhaustion returns the existing ordinary render path before cache creation',()=>{const body=html.slice(b,html.indexOf('    function restoreTransformBackground(',b));assert.ok(body.indexOf('if(!expandTransformTouching(scene.meshes,moving,epsilon))return null;')<body.indexOf('ensureTransformBackground(r);'));});
  return {pass:true,checks,timings};
 }catch(error){return {pass:false,checks,timings,error:error.stack};}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const report=await transformBackgroundWorkChecks();report.sourceSHA256=createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex');await mkdir(new URL('./results/',import.meta.url),{recursive:true});await writeFile(new URL('./results/transform-background-work.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));process.exitCode=report.pass?0:1;}
