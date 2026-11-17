import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export async function sceneBoundsReductionChecks(){
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),a=html.indexOf('    function updateSceneBounds(){'),b=html.indexOf('    const polygonTools=',a),checks=[],timings=[];assert.ok(a>=0&&b>a);const source=html.slice(a,b),run=scene=>Function('scene',source+';updateSceneBounds();return scene;')(scene),check=(name,fn)=>{fn();checks.push({name,pass:true});};
 try{
  check('An empty scene preserves its last bounds',()=>{const scene={meshes:[],boundsMin:[1,2,3],boundsMax:[4,5,6]},lo=scene.boundsMin,hi=scene.boundsMax;run(scene);assert.equal(scene.boundsMin,lo);assert.equal(scene.boundsMax,hi);assert.equal(run(null),null);});
  check('Independent meshes contribute all three extrema without changing their bounds',()=>{const meshes=[{boundsMin:[-7,2,0],boundsMax:[1,4,8]},{boundsMin:[3,-9,-2],boundsMax:[12,6,4]}],saved=structuredClone(meshes),scene=run({meshes});assert.deepEqual(scene.boundsMin,[-7,-9,-2]);assert.deepEqual(scene.boundsMax,[12,6,8]);assert.deepEqual(meshes,saved);});
  check('Native signed-zero and non-finite extrema retain Math.min/max behavior',()=>{const scene=run({meshes:[{boundsMin:[0,-0,NaN],boundsMax:[-0,Infinity,NaN]},{boundsMin:[-0,0,3],boundsMax:[0,-Infinity,1]}]});assert.ok(Object.is(scene.boundsMin[0],-0));assert.ok(Object.is(scene.boundsMin[1],-0));assert.ok(Object.is(scene.boundsMax[0],0));assert.equal(scene.boundsMax[1],Infinity);assert.ok(Number.isNaN(scene.boundsMin[2])&&Number.isNaN(scene.boundsMax[2]));});
  let reads=0;const count=10000,meshes=Array.from({length:count},(_,i)=>{const lo=[i-5000,i%7,-i],hi=[lo[0]+2,lo[1]+3,lo[2]+1];return {get boundsMin(){reads++;return lo;},get boundsMax(){reads++;return hi;}};}),at=performance.now(),scene=run({meshes});timings.push({name:'Ten thousand native owner bounds',ms:performance.now()-at,boundReads:reads});
  check('Ten thousand owner bounds use one current range per mesh',()=>{assert.deepEqual(scene.boundsMin,[-5000,0,-9999]);assert.deepEqual(scene.boundsMax,[5001,9,1]);assert.equal(reads,count*2);});
  return {pass:true,checks,timings};
 }catch(error){return {pass:false,checks,timings,error:error.stack};}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const report=await sceneBoundsReductionChecks();report.sourceSHA256=createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex');await mkdir(new URL('./results/',import.meta.url),{recursive:true});await writeFile(new URL('./results/scene-bounds-reduction.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));process.exitCode=report.pass?0:1;}
