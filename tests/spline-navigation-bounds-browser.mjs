// Same-source native control: omit only the broadphase through a routed test
// guard. The canonical samples, closest-hit loop and navigation code stay native.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {launch,ready} from '../tools/browser.mjs';

export function instrumentNavigationBounds(source){
 const guard='if(!splineNavigationBoxHit(d,cache,x,y))continue;',pickGuard='if(!splineNavigationBoxHit(d,cache,x,y,12))continue;',expose='    function splineSnapPoint(';
 for(const marker of [guard,expose])assert.equal(source.split(marker).length,2,marker);
 return source.replace(guard,'if(!window.__navReference&&!splineNavigationBoxHit(d,cache,x,y))continue;').replace(pickGuard,'if(!window.__navReference&&!splineNavigationBoxHit(d,cache,x,y,12))continue;').replace(expose,`    const __navOriginalProjected=projectedSplineSegment;
    window.__navProbe={point:splineNavigationPoint,localBox:splineNavigationSampleBox,projection:splineProjection,project:projectSplineCached,key:splineProjectionKey,
      countSegments:enabled=>{projectedSplineSegment=enabled?function(...args){window.__navSegmentCalls=(window.__navSegmentCalls||0)+1;return __navOriginalProjected(...args);}:__navOriginalProjected;},
      clearProjection:()=>{for(const d of splineDisplays.values())d.projected=null;},
      state:()=>({drag:!!drag,pending:!!drag?.pending,wheel:!!wheelBusy||!!pendingWheel}),inputAt:(x,y)=>({view:frameViewportAt(x,y),active:viewIndex,owns:document.elementFromPoint(x,y)===canvas,target:document.elementFromPoint(x,y)?.tagName}),
      memory:()=>[...navigationSurfaces].map(([id,p])=>[id,p.slice()]),restoreMemory:rows=>{navigationSurfaces.clear();for(const [id,p]of rows)navigationSurfaces.set(id,p.slice());},
      queries:()=>{const key=splineProjectionKey(),rect=canvas.getBoundingClientRect(),inside=[],outside=[];for(const d of splineDisplays.values()){if(!splineShown(d))continue;const c=splineProjection(d,key);for(const samples of d.samples.values()){if(samples.length<2)continue;const a=new Float64Array(3),b=new Float64Array(3);projectSplineCached(c,samples[0].position,a);projectSplineCached(c,samples[1].position,b);if(a[2]<=0||b[2]<=0||![...a,...b].every(Number.isFinite))continue;const x=(a[0]+b[0])/2,y=(a[1]+b[1])/2,row={x,y,hash:d.hash};(x>rect.left+12&&x<rect.right-12&&y>rect.top+12&&y<rect.bottom-12?inside:outside).push(row);break;}}const chosen=inside.length?Array.from({length:Math.min(8,inside.length)},(_,i)=>inside[Math.floor(i*inside.length/Math.min(8,inside.length))]):outside.slice(0,8),queries=chosen.flatMap(q=>[q,{...q,x:q.x+7.999},{...q,y:q.y-8}]);queries.push({x:rect.left-9,y:rect.top-9},{x:rect.right+9,y:rect.bottom+9});const owns=q=>document.elementFromPoint(q.x,q.y)===canvas&&frameViewportAt(q.x,q.y)===viewIndex;let anchor=inside.find(owns);if(anchor)anchor={...anchor,kind:'cage'};else for(const rx of [.25,.5,.75]){for(const ry of [.25,.5,.75]){const q={x:rect.left+rect.width*rx,y:rect.top+rect.height*ry,kind:'viewport-fallback'};if(owns(q)){anchor=q;break;}}if(anchor)break;}return {rect:{left:rect.left,top:rect.top,width:rect.width,height:rect.height},inside:inside.length,queries,anchor:anchor||null};}
    };
`+expose);
}
function distribution(values){const a=values.toSorted((a,b)=>a-b);return {samples:a.length,median:a[a.length>>1]??null,p95:a[Math.min(a.length-1,Math.floor(a.length*.95))]??null,max:a.at(-1)??null};}

export async function navigationBoundsBrowserChecks(page,{metadata,rounds=2}={}){
 const report={pass:false,checks:[],rows:[],cameras:[]},call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]);
 const check=(name,pass,detail)=>{report.checks.push({name,pass:!!pass,...detail===undefined?{}:{detail}});assert.ok(pass,name+': '+JSON.stringify(detail));console.log('[spline nav] '+name);};
 const parity=async(queries,mode)=>page.evaluate(({queries,mode,rounds})=>{
  const results=[],probe=window.__navProbe;window.__navReference=false;for(const q of queries)probe.point(q.x,q.y);window.__navReference=true;for(const q of queries)probe.point(q.x,q.y);
  for(let round=0;round<rounds;round++)for(const [i,q]of queries.entries()){
   const row={query:q};for(const reference of (round+i)%2?[false,true]:[true,false]){if(mode==='fresh-projection')probe.clearProjection();window.__navReference=reference;probe.countSegments(false);const start=performance.now(),hit=probe.point(q.x,q.y),ms=performance.now()-start;probe.countSegments(true);window.__navSegmentCalls=0;probe.point(q.x,q.y);const segmentCalls=window.__navSegmentCalls;probe.countSegments(false);row[reference?'original':'accelerated']={hit,ms,segmentCalls};}results.push(row);
  }window.__navReference=false;return results;
 },{queries,mode,rounds});
 try{
  const adapter=await page.evaluate(()=>{const a=frameEngine.renderer.device.adapterInfo;return {vendor:a.vendor,architecture:a.architecture,description:a.description,isFallbackAdapter:a.isFallbackAdapter};});check('Hardware WebGPU adapter',adapter.isFallbackAdapter===false&&!/swiftshader|llvmpipe|software/i.test(JSON.stringify(adapter)),adapter);
  await call('scene.select',{ids:[]});const start=await call('view.set',{index:0,single:true,mode:'object',shading:'solid-isoparms',focus:metadata.handles.root,snap:false,quantize:false,pivot:false}),perspective=start.camera;
  for(const single of [true,false])for(const index of [0,2]){
   const label=(single?'single':'quad')+'.view'+index;await call('view.set',{index,single,mode:'object',shading:'solid-isoparms',focus:metadata.handles.root,...index===0?{camera:perspective}:{}});await call('diagnostics.frame',{frames:2});
   const plan=await page.evaluate(()=>__navProbe.queries()),queries=plan.queries.slice(0,16);check(label+' samples actual displayed cages',queries.length>=4,{queries:queries.length,inside:plan.inside});
   for(const mode of ['warm','fresh-projection']){
    const raw=await parity(queries,mode);for(const row of raw)assert.deepEqual(row.accelerated.hit,row.original.hit,'Exact navigation hash/segment/point/depth/distance');
    const original=distribution(raw.map(r=>r.original.ms)),accelerated=distribution(raw.map(r=>r.accelerated.ms)),oldCalls=raw.reduce((n,r)=>n+r.original.segmentCalls,0),newCalls=raw.reduce((n,r)=>n+r.accelerated.segmentCalls,0),hits=raw.filter(r=>r.original.hit).length;
    check(label+' '+mode+' preserves every closest-hit field exactly',true,{queries:raw.length,hits});check(label+' '+mode+' actually skips segment work',oldCalls>0&&newCalls<oldCalls,{original:oldCalls,accelerated:newCalls});report.rows.push({label,mode,original,accelerated,medianSpeedup:original.median/accelerated.median,oldCalls,newCalls,raw});
   }
   if(plan.anchor){
    const baseline=(await call('view.set',{})).camera,memory=await page.evaluate(()=>__navProbe.memory()),at=[plan.anchor.x,plan.anchor.y];
    for(const operation of ['wheel','pan']){
     const pair={label,operation,at,anchorKind:plan.anchor.kind};for(const reference of [true,false]){
      await call('view.set',{index,single,camera:baseline});await page.evaluate(({reference,memory})=>{window.__navReference=reference;__navProbe.restoreMemory(memory);}, {reference,memory});const input=await page.evaluate(at=>__navProbe.inputAt(...at),at);check(label+' '+operation+' targets the actual active viewport',input.owns&&input.view===input.active,input);await page.mouse.move(...at);const begin=performance.now();
      if(operation==='wheel'){await page.mouse.wheel(0,-25);await page.waitForFunction(()=>!__navProbe.state().wheel,{},{timeout:60000});}
      else{await page.mouse.down({button:'middle'});await page.waitForFunction(()=>{const s=__navProbe.state();return s.drag&&!s.pending;},{},{timeout:10000});await page.mouse.move(at[0]+24,at[1]+17,{steps:1});await page.mouse.up({button:'middle'});await page.waitForFunction(()=>!__navProbe.state().drag,{},{timeout:60000});}
      await call('diagnostics.frame',{frames:1});pair[reference?'original':'accelerated']={camera:(await call('view.set',{})).camera,completedMs:performance.now()-begin};assert.notDeepEqual(pair[reference?'original':'accelerated'].camera,baseline,'The native camera gesture must actually change its viewport');
     }assert.deepEqual(pair.accelerated.camera,pair.original.camera,'Exact anchored native camera');check(label+' '+operation+' preserves anchored native camera exactly',true);report.cameras.push(pair);await page.evaluate(()=>window.__navReference=false);await call('view.set',{index,single,camera:baseline});
    }
   }else check(label+' has a visible cage for anchored camera evidence',false,{inside:plan.inside});
  }
  // Run the actual native mutable-preview route rather than changing a cache
  // counter directly. Cancel leaves no authored change or history transaction.
  const child=metadata.handles.denseChildSpline,before=(await call('spline.inspect',{id:child})).data,vertex=Object.keys(before.vertices)[0];await call('view.set',{index:2,single:true,mode:'vertex',shading:'solid-isoparms',focus:child});await call('scene.select',{ids:[child],mode:'vertex',components:[vertex]});
  const preview=await page.evaluate(hash=>{const d=frameEngine.splineDisplays.get(hash);window.__navPreview={hash,display:d,box:__navProbe.localBox(d),version:d.wireVersion,transaction:frameEngine.beginNumeric()};frameEngine.applyNumeric('position',0,frameEngine.transformState.position[0]+.05);const now=frameEngine.splineDisplays.get(hash);return {sameDisplay:now===d,versionBefore:__navPreview.version,versionAfter:now.wireVersion,newBox:__navProbe.localBox(now)!==__navPreview.box};},child);
  check('Actual mutable preview invalidates sample bounds',preview.newBox&&(preview.sameDisplay?preview.versionAfter!==preview.versionBefore:true),preview);const plan=await page.evaluate(()=>__navProbe.queries()),raw=await parity(plan.queries.slice(0,8),'warm');for(const row of raw)assert.deepEqual(row.accelerated.hit,row.original.hit);check('Mutable preview preserves every exact navigation result',true,{queries:raw.length});await page.evaluate(()=>{frameEngine.finishNumeric(__navPreview.transaction,false);delete window.__navPreview;});await call('diagnostics.frame',{frames:2});check('Preview cancellation restores exact authored controls',JSON.stringify((await call('spline.inspect',{id:child})).data)===JSON.stringify(before));await call('scene.select',{ids:[]});await call('view.set',{index:0,single:true,mode:'object',camera:perspective});
  await call('view.set',{index:2,single:true,mode:'edge',shading:'solid-isoparms',focus:child});await call('scene.select',{ids:[child],mode:'edge',components:[]});
  const picks=await page.evaluate(hash=>{
   const d=frameEngine.splineDisplays.get(hash),projection=__navProbe.projection(d,__navProbe.key()),rect=document.querySelector('#frame-engine-canvas').getBoundingClientRect();
   let segment=null,distance=Infinity;
   for(const line of d.samples.values())for(let i=1;i<line.length;i++){
    const a=[],b=[];__navProbe.project(projection,line[i-1].position,a);__navProbe.project(projection,line[i].position,b);
    const x=(a[0]+b[0])/2,y=(a[1]+b[1])/2,delta=Math.hypot(x-rect.left-rect.width/2,y-rect.top-rect.height/2);
    if(a[2]>0&&b[2]>0&&delta<distance){distance=delta;segment=[x,y];}
   }
   if(!segment)return {hits:0};
   let hits=0;const mismatches=[];
   try{for(const [dx,dy]of [[0,0],[9,0],[-9,0],[0,11.99],[0,-12.01],[rect.width,0]]){
    const pick=reference=>{window.__navReference=reference;return frameEngine.hitSpline(segment[0]+dx,segment[1]+dy,false,false,true,false,true);};
    const reference=pick(true),filtered=pick(false);if(reference?.segment)hits++;
    if(JSON.stringify(reference)!==JSON.stringify(filtered))mismatches.push({dx,dy,reference,filtered});
   }}finally{window.__navReference=false;}
   return {hits,mismatches};
  },child);
  check('Edge picking with conservative bounds preserves the exact owner, cubic parameter and projected point',picks.hits>0&&picks.mismatches.length===0,picks);
  report.pass=report.checks.every(c=>c.pass);
 }catch(error){report.error=error.stack;}finally{await page.mouse.up({button:'middle'}).catch(()=>{});await page.evaluate(()=>{window.__navReference=false;if(window.__navPreview){frameEngine.finishNumeric(__navPreview.transaction,false);delete window.__navPreview;}}).catch(()=>{});}
 return report;
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const option=(name,fallback)=>process.argv.find(x=>x.startsWith('--'+name+'='))?.slice(name.length+3)??fallback,label=option('label','latest'),counts=option('counts','1000').split(',').map(Number),sourcePath=resolve(option('source',fileURLToPath(new URL('../index.html',import.meta.url)))),source=await readFile(sourcePath,'utf8'),session=await launch({headless:true}),page=session.page,report={pass:false,sourceSHA256:createHash('sha256').update(source).digest('hex'),sourcePath,testInjection:'Broadphase omission guard, exact result/segment-work observation and native navigation readiness exposure only.',scenes:[],errors:[],consoleErrors:[]};
 page.on('pageerror',e=>report.errors.push(e.stack));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
 try{
  await page.route('**/index.html',r=>r.fulfill({contentType:'text/html',body:instrumentNavigationBounds(source)}));await page.reload();await ready(page);await page.evaluate(()=>{window.__navGPU=[];window.__navLost=null;const d=frameEngine.renderer.device;window.__navDevice=d;d.lost.then(info=>window.__navLost={reason:info.reason,message:info.message});d.addEventListener('uncapturederror',e=>__navGPU.push(e.error.message));d.pushErrorScope('validation');});
  for(const count of counts){assert([1000,10000].includes(count));const stem='engineering-zoo-'+(count===10000?'10k':'1000'),metadata=JSON.parse(await readFile(new URL('scenes/'+stem+'.json',import.meta.url),'utf8')),bytes=await readFile(new URL('scenes/'+stem+'.hash',import.meta.url));console.log('[spline nav] loading '+count);await page.evaluate(stem=>frameAI.call('scene.open',{url:'tests/scenes/'+stem+'.hash'}),stem);const row=await navigationBoundsBrowserChecks(page,{metadata,rounds:Number(option('rounds',2))});row.count=count;row.fixtureSHA256=createHash('sha256').update(bytes).digest('hex');report.scenes.push(row);await mkdir(new URL('results/',import.meta.url),{recursive:true});await page.screenshot({path:fileURLToPath(new URL('results/spline-navigation-bounds-'+label+'-'+count+'.png',import.meta.url))});if(!row.pass)throw Error(row.error||'Native navigation case failed');}
  report.gpu=await page.evaluate(async()=>({validation:(await __navDevice.popErrorScope())?.message||null,uncaptured:__navGPU,lost:__navLost,sameDevice:__navDevice===frameEngine.renderer.device}));report.pass=report.scenes.every(s=>s.pass)&&!report.errors.length&&!report.consoleErrors.length&&!report.gpu.validation&&!report.gpu.uncaptured.length&&!report.gpu.lost&&report.gpu.sameDevice;
 }catch(error){report.error=error.stack;process.exitCode=1;}finally{await session.close();await mkdir(new URL('results/',import.meta.url),{recursive:true});await writeFile(new URL('results/spline-navigation-bounds-'+label+'.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,sourceSHA256:report.sourceSHA256,scenes:report.scenes.map(s=>({count:s.count,pass:s.pass,checks:s.checks.length,error:s.error,rows:s.rows.map(r=>({label:r.label,mode:r.mode,original:r.original,accelerated:r.accelerated,medianSpeedup:r.medianSpeedup}))})),error:report.error,gpu:report.gpu},null,2));process.exitCode=report.pass?0:1;}
}
