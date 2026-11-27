import {box,combine,shifted,waitForSlice,runReport} from './slicer.mjs';
const sides=96,vertices=[0,0,0,0,1000,0],indices=[];
for(let i=0;i<sides;i++){const a=i*Math.PI*2/sides;vertices.push(40*Math.cos(a),0,40*Math.sin(a),40*Math.cos(a),1000,40*Math.sin(a));}
for(let i=0;i<sides;i++){const a=2+i*2,b=2+(i+1)%sides*2;indices.push(0,b,a,1,a+1,b+1,a,b,b+1,a,b+1,a+1);}
await runReport('printer-performance',async page=>{
 const checks=[],timings=[],call=(n,a={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[n,a]),check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});if(!pass)throw Error(name+': '+JSON.stringify(detail));},report={checks,timings};
 try{const printer=await call('plugins.create',{plugin:'3d-printer'}),mesh=await call('mesh.create',{vertices,indices,name:'4000-layer persistent GPU LDI benchmark'});await call('scene.update',{id:printer.hash,params:{'Line width':2,'Layer height':.25,'Initial layer height':.25}});const command=(operation,args={})=>call('plugins.command',{id:printer.hash,operation,args});
  const slice=async()=>{const start=performance.now();await command('slice');const s=await waitForSlice(call,printer.hash);if(s.state!=='complete')throw Error(JSON.stringify(s));return {...s,wallMs:performance.now()-start};};
  report.cold=await slice();check('4000 layers build both complete LDIs within 2 seconds',report.cold.result.lastLayer===4000&&report.cold.result.axes.length===2&&report.cold.wallMs<2000,report.cold);report.warm=[];for(let i=0;i<3;i++){const s=await slice();report.warm.push({ms:s.ms,wallMs:s.wallMs});}check('warm all-layer builds complete within one second',report.warm.every(s=>s.wallMs<1000),report.warm);
  const r=report.cold.result;check('bounded GPU storage and metadata-only runtime readback',r.peakGPUBytes<128*1024*1024&&r.metadataReadBytes===56,{peakGPUBytes:r.peakGPUBytes,retainedGPUBytes:r.retainedGPUBytes,metadataReadBytes:r.metadataReadBytes});check('cooperative source visits stay bounded below emitted sample events',r.triangleVisits>0&&r.triangleVisits<r.rawEvents,sides);
  await command('polyline',{enabled:true});
  await call('view.set',{single:true,index:2,shading:'solid',focus:mesh.hash});await call('scene.select',{ids:[]});await call('scene.update',{id:mesh.hash,visible:false});const projected=await call('view.project',{point:[0,500,40]}),navigationStart=performance.now();let navigation;for(let i=0;i<4;i++)navigation=await call('view.pick',{x:projected.screen[0],y:projected.screen[1]});report.navigationMs=(performance.now()-navigationStart)/4;check('navigation over 384000 hidden-source segments stays below 150 ms per pick',report.navigationMs<150&&navigation.point&&Math.abs(navigation.point[2]-40)<.1,{ms:report.navigationMs,navigation});await command('polyline',{enabled:false});await call('scene.update',{id:mesh.hash,visible:true});
  await call('view.set',{single:true,index:1,shading:'solid',focus:mesh.hash});await call('scene.select',{ids:[]});await call('diagnostics.frame',{frames:4});const before=await command('status'),wall=[];for(const layer of [1,4000,100,3900,2000,10,3500,800]){const start=performance.now();await call('scene.update',{id:printer.hash,params:{'Finish layer':layer}});await call('diagnostics.frame',{frames:1});const s=await command('status');wall.push(performance.now()-start);check('Finish '+layer+' reconstructs without rebuilding',s.id===before.id&&s.result.preview.finishLayer===layer&&s.result.builds===1&&JSON.stringify(s.result.timings)===JSON.stringify(before.result.timings),s.result.preview);}
  check('completed Finish-to-frame changes stay below 150 ms',wall.every(ms=>ms<150),wall);report.switchWallMs=wall;report.frames=await call('diagnostics.frame',{frames:8});for(const key of ['cpuMs','gpuMs']){const ms=Math.max(...report.frames.frames.map(f=>f[key]));timings.push({name:'LDI coverage '+key,ms,limit:40});check('coverage '+key+' frame budget',Number.isFinite(ms)&&ms<40,ms);}check('native GPU timestamps are available',report.frames.timestampQueries&&report.frames.adapter?.vendor!=='google',report.frames.adapter);
  const basePaths=(await command('status')).result.perimeters;
  for(const count of [4,16,1000]){
   const start=performance.now();await call('scene.update',{id:printer.hash,params:{Perimeters:count}});
   const status=await command('inspect',{paths:true,count:1}),paths=status.result.perimeters,ms=performance.now()-start;
   check('Legacy count '+count+' retains the single section boundary without rebuilding',ms<200&&status.id===before.id&&paths.count===1&&paths.firstOffset===0&&paths.loops===1&&paths.segments===basePaths.segments&&paths.fieldBuilds===basePaths.fieldBuilds&&paths.graphBuilds===basePaths.graphBuilds,{ms,paths});
  }
  await call('scene.update',{id:printer.hash,params:{Perimeters:1}});
  // The grid budget changes resolution explicitly, preserving all layer rows.
  await call('scene.delete',{ids:[mesh.hash]});const bedBox=await call('mesh.create',{...box(1000,1000,1000)});await call('scene.update',{id:printer.hash,params:{'Line width':.1}});const large=await slice();check('bounded sampling keeps all 4000 layers rather than truncating',large.result.lastLayer===4000&&large.result.grid.resolutionLimited&&(large.result.grid.width+large.result.grid.depth)*4000<=4194304&&large.wallMs<3000,large.result);
  const clipped=(await command('inspect',{paths:true,count:256})).paths;
  const points=clipped.segments.flatMap(segment=>[segment.a,segment.b]);
  check('The zero-offset perimeter reaches all four sides of the build footprint',points.length>0&&[0,2].every(axis=>{
   const values=points.map(point=>point[axis]);
   return Math.abs(Math.min(...values)+500)<.01&&Math.abs(Math.max(...values)-500)<.01;
  }),clipped);
  // Sixteen disjoint columns give each of the 4,000 layers sixteen real loops.
  await call('scene.delete',{ids:[bedBox.hash]});
  const column={vertices:vertices.map((value,i)=>i%3===1?value:value*.65),indices};
  const columns=Array.from({length:16},(_,i)=>shifted(column,(i-7.5)*60,0,(i-7.5)*60));
  await call('mesh.create',{...combine(...columns),name:'16 section boundaries'});
  await call('scene.update',{id:printer.hash,params:{'Line width':2,'Max deviation':2,'Finish layer':4000}});
  const columnJob=await slice(),coarse=columnJob.result.perimeters;
  check('All sixteen section boundaries fit in the coarse preview',coarse.loops===16&&columnJob.result.preview.state==='complete'&&columnJob.result.preview.segments===coarse.segments*4000,columnJob.result);
  const retune=async deviation=>{
   await call('scene.update',{id:printer.hash,params:{'Max deviation':deviation}});
   await command('inspect',{paths:true,count:1});
   await call('diagnostics.frame',{frames:1});
   let status=await command('status');const start=performance.now();
   while(status.result.preview.state==='running'&&performance.now()-start<3000){
    await new Promise(resolve=>setTimeout(resolve,10));status=await command('status');
   }
   return status;
  };
  const fineStart=performance.now(),fine=await retune(.001),fineMs=performance.now()-fineStart;
  check('An over-capacity preview publishes zero segments within one second',fineMs<1000&&fine.state==='complete'&&fine.result.perimeters.loops===16&&fine.result.preview.state==='failed'&&fine.result.preview.error?.code==='PATH_CAPACITY'&&fine.result.preview.segments===0,{ms:fineMs,paths:fine.result.perimeters,preview:fine.result.preview});
  const reduceStart=performance.now();await call('scene.update',{id:printer.hash,params:{'Max deviation':2}});
  const reduced=(await command('inspect',{paths:true,count:1})).result.perimeters,reduceMs=performance.now()-reduceStart;
  check('Simplifying sixteen loops reuses the graph within 100 ms',reduceMs<100&&reduced.fieldBuilds===coarse.fieldBuilds&&reduced.graphBuilds===coarse.graphBuilds&&reduced.segments===coarse.segments&&reduced.segments<fine.result.perimeters.segments,{ms:reduceMs,coarse,reduced});
  const recovered=await retune(2);
  check('The complete all-layer preview recovers from overflow on the same LDI',recovered.id===columnJob.id&&recovered.result.preview.state==='complete'&&recovered.result.preview.segments===columnJob.result.preview.segments,recovered.result.preview);
  return {...report,pass:true};
 }catch(e){return {...report,pass:false,error:e.stack};}
});
