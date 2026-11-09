import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export async function creationSanityCPUChecks(){
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),checks=[],timings=[];
 const check=(name,fn)=>{fn();checks.push({name,pass:true});};
 try{
  const K=Function('return ('+html.match(/<script id="frame-spline-kernel" type="text\/plain">([\s\S]*?)<\/script>/)[1]+')')()();
  const FM=Function('return '+html.slice(html.indexOf('const FM=')+9,html.indexOf('\n    })();',html.indexOf('const FM='))+11))();
  const start=html.indexOf('    function splineCreationFrame('),end=html.indexOf('    function splinePlanePoint(',start),functions=html.slice(start,end);
  const make=view=>Function('FM','frameViewKind','activeView',functions+';return {frame:splineCreationFrame,pivot:splineCreationPivot,initialize:initializeSplineCreation};')(FM,x=>x,view);
  const expected=[FM.unpack([1,0,0,0,0,1,0,-1,0,0,0,0]),FM.unpack([1,0,0,0,0,1,0,-1,0,0,0,0]),FM.I(),FM.unpack([0,0,-1,0,1,0,1,0,0,0,0,0])];
  for(const view of [0,1,2,3])check('View '+view+' keeps authored geometry plane and neutral origin',()=>{
   const api=make(view),n={};api.initialize(n);const frame=FM.unpack(n.creationFrame),pivot=FM.unpack(n.creationPivot),axis=FM.mul(frame,pivot);
   assert.deepEqual(Array.from(frame),Array.from(expected[view]));assert.deepEqual(Array.from(axis.slice(12,15)),[0,0,0]);
   assert.deepEqual(FM.euler(axis),view===0?[0,0,0]:FM.euler(expected[view]));
   for(const p of [[0,0,0],[30,-50,7],[-12,40,0]])assert.deepEqual(FM.point(frame,p),FM.point(expected[view],p));
   const moved=FM.mul(FM.translation([12,23,34]),frame);assert.deepEqual(Array.from(FM.mul(moved,pivot).slice(12,15)),[12,23,34]);
   const turned=FM.mul(FM.rotation([1,0,0],.3),frame);assert.ok(Math.abs(FM.euler(FM.mul(turned,pivot))[0]-(view===0?.3:FM.euler(FM.mul(FM.rotation([1,0,0],.3),expected[view]))[0]))<1e-9);
  });
  for(const type of ['spline','square','circle','polyhedron','text','helix','gear','pulley','cube','cylinder','tube','sphere','capsule','nut','washer','bolt'])check(type+' uses the authored local origin, including asymmetric parameters',()=>assert.deepEqual(K.primitivePivot(type,{text:'Hg\nH',sides:5,'start diameter':24,pitch:12,turns:2.5}),[0,0,0]));
  const pentagon=K.primitive('polyhedron',{faces:5,diameter:100}),vertices=Object.values(pentagon.vertices),center=[0,1,2].map(k=>(Math.min(...vertices.map(p=>p[k]))+Math.max(...vertices.map(p=>p[k])))/2);
  check('Odd polygon exposes the original bounds-center offset',()=>assert.ok(Math.abs(center[1]-4.774575140626315)<1e-10));
  const pivotSource=html.slice(html.indexOf('    function objectPivot('),html.indexOf('\n    function putFrame('));
  for(const type of ['polyhedron','cylinder','text','helix'])check('Actual native '+type+' pivot avoids measured-bounds drift and honors explicit edits',()=>{
   let saved,boundsReads=0;const pivot=Function('FM','nativeValue','nodes','FrameSpline','pluginViewport','objectWorld','nodeBounds',pivotSource+';return objectPivot;')(FM,()=>saved,[{nativeHash:'p',type,params:{}}],{K:()=>K},()=>null,()=>FM.I(),()=>{boundsReads++;return {center};});
   assert.deepEqual(Array.from(pivot('p').slice(12,15)),[0,0,0]);assert.equal(boundsReads,0);
   saved=FM.pack(FM.translation([12,23,34]));assert.deepEqual(Array.from(pivot('p').slice(12,15)),[12,23,34]);
  });
  check('Imported mesh and generator pivots retain measured behavior',()=>{for(const type of ['mesh','extrude','sweep','lathe','spline_patch','group'])assert.equal(K.primitivePivot(type,{}),null);});
  check('All three native GPU crease classifiers use cos(44 degrees)',()=>{assert.equal(html.split('0.7193398').length-1,3);assert.ok(!html.includes('0.6946584'));for(const degrees of [43,45,47])assert.equal(Math.cos(degrees*Math.PI/180)<.7193398,degrees>44);});
  check('Boolean worker uses 44 degree default',()=>{assert.ok(html.includes('creaseCos=Math.cos(44*Math.PI/180)'));assert.ok(html.includes("backend:'worker-polygon-44-degree-area'"));});
  const workerStart=html.indexOf('function polygonCreaseData('),workerEnd=html.indexOf('\n}',html.indexOf('function prepareBooleanRender('))+2;
  const prepare=Function(html.slice(workerStart,workerEnd)+';return prepareBooleanRender;')();
  for(const degrees of [43,43.9,44.1,45,46,47])check('Actual Boolean normal aliases at '+degrees+' degrees',()=>{
   const rad=degrees*Math.PI/180,r=prepare(new Float32Array([0,-30,0,0,30,0,-60,0,0,60*Math.cos(rad),0,60*Math.sin(rad)]),new Uint32Array([0,1,2,1,0,3]));
   assert.equal(r.positions.length/3,degrees>44?6:4);assert.equal(r.creaseCos,Math.cos(44*Math.PI/180));assert.equal(r.indices.length,6);
  });
  const at=performance.now();for(let i=0;i<100000;i++){K.primitivePivot('polyhedron',{});const n={};make(i%4).initialize(n);}const ms=performance.now()-at;timings.push({name:'100000 complete placement+origin calculations',ms,budget:2000});check('Placement calculation bounded latency',()=>assert.ok(ms<2000));
  return {pass:true,checks,timings};
 }catch(e){return {pass:false,checks,timings,error:e.stack};}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const r=await creationSanityCPUChecks();await mkdir(new URL('results/',import.meta.url),{recursive:true});r.indexSHA256=createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex');await writeFile(new URL('results/creation-sanity-cpu.json',import.meta.url),JSON.stringify(r,null,2));console.log(JSON.stringify(r,null,2));process.exitCode=r.pass?0:1;}
