// Test-only same-page control. The route flag lives inside splineTextBytes;
// replacing an encoder object would change the codec's decode identity cache.
export async function splineCodecCopyChecks(page,metadata,{call,check,stage,measure,history,state}){
 const report={pass:false,series:[],packets:null},hash=metadata.handles.deepGroup;
 const capture=()=>page.evaluate(()=>{window.__zooCodecPackets=new Map();let bytes=0;for(const n of nodes){const shape=FrameSpline.shape(n);if(shape){const packet=FrameSpline.encodeShape(shape);__zooCodecPackets.set(n.nativeHash,packet);bytes+=packet.byteLength;}}return {records:__zooCodecPackets.size,bytes};});
 const verify=()=>page.evaluate(()=>{const mismatches=[];let records=0;for(const n of nodes){const shape=FrameSpline.shape(n);if(!shape)continue;records++;const packet=FrameSpline.encodeShape(shape),saved=__zooCodecPackets.get(n.nativeHash);if(!saved||packet.length!==saved.length||packet.some((b,i)=>b!==saved[i]))mismatches.push(n.nativeHash);}return {records,expected:__zooCodecPackets.size,mismatches:mismatches.slice(0,20),same:records===__zooCodecPackets.size&&!mismatches.length};});
 try{
  await stage('Spline UTF-8 cache full-packet identity control');await page.evaluate(()=>window.__zooSplineTextOrdinary=true);report.packets=await capture();await page.evaluate(()=>window.__zooSplineTextOrdinary=false);const identity=await verify();check('UTF-8 cache preserves every native authoring packet byte',identity.same,identity);
  const initial=(await state()).objects.length;
  for(const ordinary of [true,false]){
   const name=ordinary?'ordinary':'cached',times=[];await stage('Spline UTF-8 '+name+' native hierarchy copies');await page.evaluate(ordinary=>window.__zooSplineTextOrdinary=ordinary,ordinary);
   for(let round=0;round<3;round++){
    const copied=await measure('codec.'+name+'.copy',async()=>{const at=performance.now(),value=await call('scene.duplicate',{ids:[hash]});times.push(performance.now()-at);return value;});const count=(await state()).objects.length;check(name+' copy '+round+' creates native hierarchy owners',copied.objects.length>0&&count>initial,{roots:copied.objects.length,added:count-initial});await history('undo');check(name+' copy '+round+' Undo restores authored count',(await state()).objects.length===initial);const restored=await verify();check(name+' copy '+round+' Undo restores every original authoring byte',restored.same,restored);
   }
   report.series.push({name,ordinary,timesMs:times,medianMs:times.toSorted((a,b)=>a-b)[times.length>>1]});
  }
  report.pass=true;return report;
 }catch(error){report.error=error.stack;return report;}
 finally{await page.evaluate(()=>{window.__zooSplineTextOrdinary=false;delete window.__zooCodecPackets;}).catch(()=>{});}
}
