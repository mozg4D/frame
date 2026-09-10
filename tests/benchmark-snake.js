const fs=require('fs'),{Worker,isMainThread,parentPort,workerData}=require('worker_threads');
if(isMainThread){
 const h=fs.readFileSync(process.argv.slice(2).find(a=>!a.startsWith('--'))||require('path').join(__dirname,'../index.html'),'utf8'),section=(a,b)=>h.slice(h.indexOf(a),h.indexOf(b,h.indexOf(a)));
 const code=section('function createFrameSurfaceKernel()','const FrameSurfaceKernel=')+section('function prepareSplineBVH(','// Self-contained planar triangulation');
 const workers=Array.from({length:15},()=>new Worker(__filename,{workerData:{code,count:12,initial:process.argv.includes('--initial')}}));
 let ready=0,done=0,started=0,total=0,raw=0,quality=0,render=0;
 workers.forEach(w=>{w.on('error',e=>{console.error(e);process.exitCode=1;for(const q of workers)q.terminate();});w.on('message',m=>{
  if(m.ready){if(++ready===workers.length){started=performance.now();for(const q of workers)q.postMessage('run');}return;}
  total+=m.T;raw+=m.raw;quality+=m.quality;render+=m.render;
  if(++done===workers.length){const wall=performance.now()-started;console.log(JSON.stringify({mode:process.argv.includes('--initial')?'initial-with-render':'mesh-quality-render',workers:workers.length,cells:workers.length*12,triangles:total,wallMs:wall,trianglesPerSecond:total/wall*1000,cpuMs:{initialMesh:raw,diagonalQA:quality,renderAndBVH:render},cpu:require('os').cpus()[0].model}));for(const q of workers)q.terminate();}
 });});
}else{
 const {M,render}=new Function(workerData.code+';return {M:createFrameSurfaceKernel().MeshBuilder,render:prepareSplineRender};')();
 const k=4*(Math.SQRT2-1)/3,edges=[[[1,0,0],[1,k,0],[k,2,0],[0,2,0]],[[0,2,0],[0,2,k],[0,k,1],[0,0,1]],[[0,0,1],[k,0,1],[1,0,k],[1,0,0]]];
 function run(){const a=performance.now(),r=M.build(edges,{angle:1,deferQuality:true}),b=performance.now();if(!workerData.initial)M.refine(r.mesh);const c=performance.now(),positions=new Float64Array(r.mesh.p.flat()),indices=new Uint32Array(r.mesh.triangles.flat());render(new Float32Array(positions),indices,Math.cos(Math.PI/4),positions);const d=performance.now();return {T:r.mesh.triangles.length,raw:b-a,quality:c-b,render:d-c};}
 for(let i=0;i<4;i++)run();parentPort.postMessage({ready:true});
 parentPort.on('message',()=>{let T=0,raw=0,quality=0,render=0;for(let i=0;i<workerData.count;i++){const r=run();T+=r.T;raw+=r.raw;quality+=r.quality;render+=r.render;}parentPort.postMessage({T,raw,quality,render});});
}
