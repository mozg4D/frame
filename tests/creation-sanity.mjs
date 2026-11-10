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
  const bounds=data=>{const p=Object.values(data.vertices);return {min:[0,1,2].map(k=>Math.min(...p.map(v=>v[k]))),max:[0,1,2].map(k=>Math.max(...p.map(v=>v[k])))};};
  const close=(a,b)=>assert.ok(a.every((v,k)=>Math.abs(v-b[k])<1e-9),JSON.stringify({actual:a,expected:b}));
  const anchored=[
   ['square',{'side 1':100,'side 2':100},[0,0,0],[100,100,0]],
   ['square',{'side 1':37.25,'side 2':12.5},[0,0,0],[37.25,12.5,0]],
   ['square',{'side 1':0,'side 2':19},[0,0,0],[0,19,0]],
   ['cube',{'size x':100,'size y':100,'size z':100},[0,0,0],[100,100,100]],
   ['cube',{'size x':37.25,'size y':12.5,'size z':19},[0,0,0],[37.25,12.5,19]],
   ['cube',{'size x':0,'size y':12.5,'size z':19},[0,0,0],[0,12.5,19]],
   ...['cylinder','tube'].flatMap(type=>[100,37.25,0].map(height=>[type,{diameter:42.5,'outer diameter':42.5,'inner diameter':17.5,height,'angle approximation':17},[-21.25,0,-21.25],[21.25,height,21.25]]))
  ];
  for(const [type,params,min,max]of anchored)check(type+' dimensions '+JSON.stringify(params)+' retain the corner/bottom origin',()=>{
   const data=K.primitive(type,params),b=bounds(data);close(b.min,min);close(b.max,max);assert.deepEqual(K.primitivePivot(type,params),[0,0,0]);
   if(type==='square'||type==='cube')assert.ok(Object.values(data.vertices).some(p=>p.every(v=>v===0)));
   else {const bottom=Object.values(data.vertices).filter(p=>p[1]===0);assert.ok(bottom.length>=4);close([0,1,2].map(k=>bottom.reduce((n,p)=>n+p[k],0)/bottom.length),[0,0,0]);}
  });
  // The mounting changes are translations only: retain topology, tangent vectors and every cubic sample.
  const kernelSource=html.match(/<script id="frame-spline-kernel" type="text\/plain">([\s\S]*?)<\/script>/)[1],offsetSource="const offset=e===\"square\"?[n.w,n.h,0]:e===\"cube\"?[n.sizeX??n.size,n.sizeY??n.size,n.sizeZ??n.size]:e===\"cylinder\"||e===\"tube\"?[0,n.height,0]:null;if(offset)for(const p of Object.values(data.vertices))for(let k=0;k<3;k++)p[k]+=.5*Math.max(0,+offset[k]||0);";assert.ok(kernelSource.includes(offsetSource));const legacy=Function('return ('+kernelSource.replace(offsetSource,'')+')')()();
  for(const [type,params,min,max]of anchored)check(type+' mounting preserves exact cage topology and cubic shape '+JSON.stringify(params),()=>{
   const current=K.primitive(type,params),old=legacy.primitive(type,params),offset=type==='square'||type==='cube'?max.map(v=>v/2):[0,max[1]/2,0];
   assert.deepEqual(current.segments,old.segments);assert.deepEqual(current.sequences,old.sequences);assert.deepEqual(current.approximation,old.approximation);
   for(const id of Object.keys(old.vertices))close(current.vertices[id],old.vertices[id].map((v,k)=>v+offset[k]));
   for(const id of Object.keys(old.segments))for(const t of [0,.125,.5,.875,1])close(K.cubicPoint(K.segmentPoints(current,id),t),legacy.cubicPoint(legacy.segmentPoints(old,id),t).map((v,k)=>v+offset[k]));
   if(offset.some(v=>v>0)){const before=bounds(old);assert.ok(before.min.some((v,k)=>Math.abs(v-min[k])>1e-9),'Pre-fix geometry must fail the mounting oracle');}
  });
  check('Other primitive families keep their exact authored cages',()=>{for(const [type,params]of [['circle',{diameter:100}],['polyhedron',{faces:5,diameter:100}],['sphere',{diameter:100}],['capsule',{diameter:100,'cylinder height':100,'total height':200}],['helix',{'start diameter':30,'end diameter':50,pitch:12,turns:2.5}]])assert.deepEqual(K.primitive(type,params),legacy.primitive(type,params));});
  const definitionSource=html.slice(html.indexOf('const approximation ='),html.indexOf('const generatorTypes'));
  const definitions=Function('boltLabels',definitionSource+';return definitions;')({}),defaults=fields=>Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,Array.isArray(v)?v[0]:v]));
  const types=['spline','square','circle','polyhedron','text','helix','gear','pulley','spline_patch','extrude','sweep','lathe','boolean','cube','cylinder','tube','sphere','capsule','nut','washer','bolt','render','instance','cloner','symmetry','target'];
  const codecSource=html.slice(html.indexOf('function createFrameSplineCodec('),html.indexOf('// The cubic kernel'));
  const codec=Function('defaults','definitions',codecSource+';return createFrameSplineCodec;')(defaults,definitions)(types);
  const lifeSource=html.slice(html.indexOf('  function shape(n){'),html.indexOf('  const isEditing=',html.indexOf('  function shape(n){')));
  const life=Function('supported','special','defaults','definitions','bakedHashes',lifeSource+';return {shape,restore};')(new Set(types),new Set(),defaults,definitions,new Set());
  for(const [type,params]of anchored.slice(0,2).concat(anchored.slice(3,5),anchored.slice(6,8),anchored.slice(9,11)))check(type+' single origin contract survives native typed serialization',()=>{
   const accepted=Object.fromEntries(Object.entries(params).filter(([key])=>Object.hasOwn(definitions[type][2],key))),shape=life.shape({type,params:accepted}),bytes=codec.encode(shape),decoded=codec.decode(bytes.slice()),n={};life.restore(n,decoded);assert.deepEqual(K.primitive(type,n.params),K.primitive(type,params));assert.deepEqual(Array.from(codec.encode(life.shape(n))),Array.from(bytes));assert.deepEqual(Object.keys(shape).sort(),['params','type']);
  });
  check('Primitive codec rejects all undeclared trailing origin flags',()=>{for(const type of ['square','cube','cylinder','tube','circle']){const bytes=codec.encode({type,params:{}});for(const suffix of [[0],[1],[2],[1,1]])assert.throws(()=>codec.decode(Uint8Array.from([...bytes,...suffix])),/Trailing/);}});
  check('Runtime has one primitive contract without an opt-in origin property',()=>assert.ok(!html.includes('mountingOrigin')));
  const anchorAt=performance.now();for(let i=0;i<2000;i++){const [type,params]=anchored[i%anchored.length];K.primitive(type,params);}const anchorMs=performance.now()-anchorAt;timings.push({name:'2000 complete anchored primitive cage builds',ms:anchorMs,budget:2000});check('Anchored primitive cage builds bounded latency',()=>assert.ok(anchorMs<2000));
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
