/* Run node tests/hash-object-browser-fixtures.mjs first, then pass the fixture name,
   its printed SHA-256 and the index.html SHA-256 to this standalone WebGPU test.
   Cases: legacy-32.hash, folded-100001.hash, flat-100001.hash. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {launch,ready} from '../tools/browser.mjs';

const [name,expectedSHA256,expectedIndexSHA256]=process.argv.slice(2);
assert(/^(legacy-32|folded-100001|flat-100001)\.hash$/.test(name||''),'Explicit fixture required');
const fixture=new URL('./hash-owner-fixtures/'+name,import.meta.url);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fixtureBytes=await fs.readFile(fixture),actualSHA256=hash(fixtureBytes);
assert.equal(actualSHA256,expectedSHA256,'Exact same HASH fixture');
const indexSHA256=hash(await fs.readFile(new URL('../index.html',import.meta.url)));
assert.equal(indexSHA256,expectedIndexSHA256,'Exact app source');
const folded=name.startsWith('folded'),expectedCount=name.startsWith('legacy')?32:100001,errors=[];
const s=await launch({headless:true}),p=s.page;
p.on('pageerror',e=>errors.push(e.message));p.on('crash',()=>errors.push('Chromium page crashed'));
let sampler,capture='',osSamples=[],startedAt;
function log(kind,value){console.log(JSON.stringify({kind,...value}));}
try{
 await ready(p);
 const browser=await s.browser.newBrowserCDPSession(),cdp=await s.context.newCDPSession(p);
 await cdp.send('Performance.enable');
 const info=async()=>{const {processInfo}=await browser.send('SystemInfo.getProcessInfo');return processInfo.map(v=>({id:v.id,type:v.type}));};
 const pids=await info();
 assert(pids.some(x=>x.type==='renderer'),'CDP renderer PID absent');
 const memory=async()=>{const {metrics}=await cdp.send('Performance.getMetrics'),dom=await cdp.send('Memory.getDOMCounters');const used=metrics.find(x=>x.name==='JSHeapUsedSize')?.value,total=metrics.find(x=>x.name==='JSHeapTotalSize')?.value;return {jsUsed:used,jsCapacity:total,...dom};};
 if(process.platform==='win32'){
  const ids=pids.map(q=>Number(q.id));assert(ids.every(Number.isSafeInteger));
  const ps='$ids=@('+ids.join(',')+');while($true){$r=Get-Process -Id $ids -ErrorAction SilentlyContinue;'+
   '$w=($r|Measure-Object WorkingSet64 -Sum).Sum;$pv=($r|Measure-Object PrivateMemorySize64 -Sum).Sum;'+
   'Write-Output ("{0},{1},{2}" -f [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(),$w,$pv);Start-Sleep -Milliseconds 400}';
  sampler=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',ps],{windowsHide:true});
  sampler.on('error',e=>errors.push('OS sampler: '+e.message));sampler.stderr.on('data',d=>process.stderr.write(d));
  sampler.stdout.on('data',d=>{capture+=d;const parts=capture.split(/\r?\n/);capture=parts.pop();for(const row of parts){const [time,rss,privateBytes]=row.trim().split(',').map(Number);if(time>0&&rss>0)osSamples.push({time,rss,privateBytes});}});
  await new Promise(r=>setTimeout(r,500));
 }
 const setup=await p.evaluate(async({name})=>{
  const res=await fetch('/tests/hash-owner-fixtures/'+name);
  if(!res.ok)throw Error('Fixture not served: '+res.status);
  window.__ownerNativeFixture=new File([await res.blob()],name);
  const a=frameEngine.renderer.device.adapterInfo;
  return {bytes:window.__ownerNativeFixture.size,adapter:{description:a.description,isFallbackAdapter:a.isFallbackAdapter}};
 },{name});assert.equal(setup.bytes,fixtureBytes.length);
 assert.equal(setup.adapter.isFallbackAdapter,false,'Native hardware evidence required');
 assert(!/swiftshader|llvmpipe|software/i.test(setup.adapter.description||''),'Native hardware evidence required');
 log('start',{name,fixtureSHA256:actualSHA256,indexSHA256,expectedCount,pids,setup,baselineMemory:await memory()});
 startedAt=Date.now();
 const loaded=await p.evaluate(async({expectedCount,folded})=>{
  const c=document.querySelector('#frame-engine-canvas'),t=performance.now(),prev=c.dataset.hashLoad;let frames=0,last=t,maxGap=0,maxGapWindow=null,raf;
  function watch(now){frames++;if(now-last>maxGap){maxGap=now-last;maxGapWindow=[last-t,now-t];}last=now;raf=requestAnimationFrame(watch);}
  raf=requestAnimationFrame(watch);
  try{
   await frameEngine.loadFile(window.__ownerNativeFixture);
   const loadResolved=performance.now()-t;
   await frameEngine.renderer.device.queue.onSubmittedWorkDone();
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const firstUsableFrame=performance.now()-t;
   if(c.dataset.ready!=='true'||c.dataset.hashLoad===prev||c.dataset.operationError)throw Error(c.dataset.operationError||'HASH never reached ready');
   const ids=frameEngine.scene.records.get(FrameHash.K.all).value;
   if(ids.length!==expectedCount||nodes.length!==expectedCount||selected.size)throw Error('Installed owner/selection count mismatch');
   const root=nodes[0].id,mid=Math.floor(expectedCount/2);
   let exact=true;for(let i=0;i<ids.length;i++){
    const expected=(0x40000000+i).toString(16).padStart(32,'0'),n=nodes[i];
    if(n.nativeHash!==expected||ids[i]!==expected||n.type!=='group'||n.parent!==(folded&&i?root:null)){exact=false;break;}
   }
   if(!exact||nodes[0].folded!==folded||nodes[mid].name!=='Null #'+mid||nodes.at(-1).name!=='Null #'+(expectedCount-1))throw Error('HASH roundtrip shape mismatch');
   const ob=document.getElementById('obScroll');
   return {loadResolved,firstUsableFrame,rafFrames:frames,maxAnimationFrameGapMs:maxGap,maxGapWindow,stage:JSON.parse(c.dataset.hashLoad),rows:document.querySelectorAll('#obInner .ob-row').length,rail:ob.scrollHeight,viewportHeight:ob.clientHeight,installedOwners:nodes.length,exact,freshFrame:true};
  }finally{cancelAnimationFrame(raf);}
 },{expectedCount,folded});
 const loadEndedAt=Date.now();const virtual=name.startsWith('flat')&&!process.env.FRAME_TEST_UNWINDOWED_CONTROL;
 if(virtual){
  assert(loaded.rows>=Math.floor(loaded.viewportHeight/17)&&loaded.rows<=Math.ceil(loaded.viewportHeight/17)+33,'bound mounted rows to viewport + overscan');
  assert.equal(loaded.rail,17*expectedCount,'No logical rows omitted from scroll range');
 }else assert.equal(loaded.rows,folded?1:expectedCount);
 log('loaded',loaded);
 const measured=await p.evaluate(()=>frameAI.call('diagnostics.frame',{frames:1}));
 assert.equal(measured.frames.length,1);log('fresh-native-frame',{measured});
 const final=await memory(),afterPIDs=await info();
 if(process.platform==='win32'&&loadEndedAt-startedAt<800)await new Promise(r=>setTimeout(r,500));
 const during=osSamples.filter(v=>v.time>=startedAt&&v.time<=loadEndedAt),post=osSamples.filter(v=>v.time>loadEndedAt),eligible=during.length?during:post;
 const peak=eligible.reduce((p,v)=>({rss:Math.max(p.rss,v.rss),privateBytes:Math.max(p.privateBytes,v.privateBytes)}),{rss:0,privateBytes:0});
 assert.deepEqual(errors,[]);
 if(process.platform==='win32'){
  assert(eligible.length>0,'No independent OS samples');
  if(loadEndedAt-startedAt>=800)assert(during.length>0,'No independent OS samples during sustained load');
 }
 log('load-complete',{pass:true,finalMemory:final,osPeak:peak,osSamples:eligible.length,osInLoad:during.length,osScope:during.length?'during-open':'post-open-only',knownPIDs:pids,afterPIDs,osSamplesAll:osSamples});
 if(virtual){
  const read=()=>p.evaluate(()=>({focus:focusId,first:nodes[0].id,last:nodes.at(-1).id,num:nodes.length,selected:selected.size,active:document.getElementById('obInner').getAttribute('aria-activedescendant'),viewport:document.getElementById('obScroll').clientHeight,rows:document.querySelectorAll('#obInner .ob-row').length}));
  const initial=await read();
  const tree=p.locator('#obInner');
  await tree.focus();
  await p.keyboard.press('End');
  let now=await read();
  assert.equal(now.focus,initial.last);
  assert.equal(now.active,'row-'+initial.last);
  assert.equal(now.selected,1);
  assert(now.rows<=Math.ceil(now.viewport/17)+33);
  const last=p.locator('#row-'+initial.last);
  assert(await last.isVisible());
  assert.equal(await last.locator('.ob-name').innerText(),'Null #100000');
  await p.evaluate(()=>{const box=document.getElementById('obScroll');box.scrollTop=0;});
  await p.waitForFunction(()=>!document.getElementById('row-'+focusId));
  assert.equal((await read()).active,null,'Do not reference unmounted rows in accessibility tree');
  await p.keyboard.press('F2');
  assert(await p.locator('.ob-rename').isVisible(),'F2 reveals offscreen object');
  assert.equal(await p.locator('.ob-rename').inputValue(),'Null #100000');
  await p.keyboard.press('Escape');
  await tree.focus();
  await p.keyboard.press('Home');
  now=await read();
  assert.equal(now.focus,initial.first);
  assert.equal(now.active,'row-'+initial.first);
  const nameBox=await p.locator('#row-'+initial.first+' .ob-name').boundingBox(),scrollBox=await p.locator('#obScroll').boundingBox();
  assert(nameBox&&scrollBox,'Drag fixture rows visible');
  const x=nameBox.x+Math.min(12,nameBox.width/2);
  await p.mouse.move(x,nameBox.y+nameBox.height/2);
  await p.mouse.down();
  try{
   // The bottom three CSS px are an existing overlay resize handle, not a row.
   const pointY=scrollBox.y+scrollBox.height-10,edge=await p.evaluate(({x,y,oldY})=>{
    const hit=z=>{const e=document.elementFromPoint(x,z);return {id:e?.id,row:e?.closest('.ob-row')?.dataset.id};};
    return {outsideRows:hit(oldY),actualBandRow:hit(y),treeResize:document.getElementById('treeResize').getBoundingClientRect().toJSON()};
   },{x,y:pointY,oldY:scrollBox.y+scrollBox.height-3});
   assert(edge.actualBandRow.row,'Choose an actual row inside the vertical autoscroll band');
   log('objects-browser-hit-band',edge);
   await p.mouse.move(x,pointY,{steps:6});
   try{
    const result=await p.waitForFunction(()=>{
     const box=document.getElementById('obScroll'),g=treeGesture;
     if(box.scrollTop<17*20||!g?.pointer||!g.drop?.target)return false;
     const q=g.pointer,hit=document.elementFromPoint(q.clientX,q.clientY)?.closest('.ob-row');
     const id=g.drop.target.id,index=Math.floor((box.scrollTop+q.clientY-box.getBoundingClientRect().top)/17);
     if(!hit||document.getElementById('row-'+g.ids[0]))return false;
     return {id,hit:hit.dataset.id,logical:nodes[index]?.id,index,scrollTop:box.scrollTop,
      sourceGone:true,mounted:!!document.getElementById('row-'+id)};
    },{},{timeout:5000});
    const drop=await result.jsonValue();
    assert(drop.mounted&&drop.sourceGone,'Auto-scroll mounts a target after source scrolls away');
    assert.equal(drop.id,drop.hit,'Drop resolves the actual row under the held pointer');
    assert.equal(drop.id,drop.logical,'Drop resolves the correct logical entry of the scrolled rail');
    log('objects-browser-drag',{pass:true,...drop});
   }catch(error){
    log('objects-browser-drag-debug',await p.evaluate(()=>{
     const box=document.getElementById('obScroll'),g=treeGesture,p=g?.pointer;
     return {scrollTop:box.scrollTop,box:box.getBoundingClientRect().toJSON(),active:g?.kind,moved:g?.moved,scrollExit:g?.scrollExit,
      pointer:p&&{x:p.clientX,y:p.clientY},target:g?.drop?.target?.id??null,logicalRows:frameBrowserWindow?.rows.length};
    }));
    throw error;
   }
  }finally{await p.keyboard.press('Escape');await p.mouse.up();}
  assert.equal((await read()).first,initial.first,'Cancelled drag leaves order unchanged');
  const model=await p.evaluate(()=>{
   const w=frameBrowserWindow, ids=[nodes[3].id,nodes.at(-1).id], original=ids.map(node).map(n=>n.tags);
   const state={selected,selectedTags,selectedTag,focusId,anchorTag,anchorId};
   const make=()=>({kind:'uv',params:{}});
   try{
    for(const id of ids)node(id).tags=[make(),make()];
    renderTree();
    const x=(id,tag)=>document.querySelector('#row-'+id+' [data-tag="'+tag+'"]').getBoundingClientRect().x;
    frameBrowserReveal(ids[0]);const x0=x(ids[0],1);selectTag(ids[0],1);
    frameBrowserReveal(ids[1]);const x1=x(ids[1],1);selectTag(ids[1],1,{shiftKey:true});
    const exact=[...selectedTags].sort();
    return {exact,expected:ids.map(id=>id+':1').sort(),tagX:[x0,x1],overflowRows:w.rows.length};
   }finally{
    ids.forEach((id,i)=>{node(id).tags=original[i];});({selected,selectedTags,selectedTag,focusId,anchorTag,anchorId}=state);renderTree();frameBrowserReveal(state.focusId);
   }
  });
  assert.deepEqual(model.exact,model.expected,'Shift-tag uses native layout at both offscreen anchors');
  assert.equal(model.overflowRows,expectedCount);
  assert.deepEqual(errors,[]);
  log('objects-browser-functional',{pass:true,model,home:now,last:initial.last});
  // Real pointer Shift extends through logical owners outside both mounted windows.
  let action=performance.now();await tree.focus();await p.keyboard.press('Home');
  const range=await p.evaluate(()=>({source:nodes[0].id,target:nodes[112].id,
   expected:nodes.slice(0,113).map(n=>n.id)}));
  await p.evaluate(()=>{document.getElementById('obScroll').scrollTop=17*100;});
  const target=p.locator('#row-'+range.target+' .ob-name');await target.waitFor({state:'visible'});
  assert.equal(await p.locator('#row-'+range.source).count(),0);
  await target.click({modifiers:['Shift']});
  const rangeResult=await p.evaluate(()=>({ids:[...selected].sort(),focus:focusId,rows:document.querySelectorAll('#obInner .ob-row').length}));
  assert.deepEqual(rangeResult.ids,range.expected.sort(),'Pointer Shift chooses every intervening logical owner');
  assert.equal(rangeResult.focus,range.target);
  log('objects-browser-pointer-range',{count:rangeResult.ids.length,ms:performance.now()-action,rows:rangeResult.rows});
  await tree.focus();await p.keyboard.press('End');
  action=performance.now();await p.keyboard.press('F2');
  const rename=p.locator('.ob-rename');await rename.waitFor({state:'visible'});
  const nextName='QA virtual actual rename';
  await rename.fill(nextName);await rename.press('Enter');
  const renamed=await p.evaluate(()=>({name:nodes.at(-1).name,count:nodes.length,focus:focusId}));
  assert.deepEqual(renamed,{name:nextName,count:expectedCount,focus:initial.last});
  assert.equal(await p.locator('#row-'+initial.last+' .ob-name').innerText(),nextName);
  assert.deepEqual(errors,[]);
  log('objects-browser-rename-commit',{...renamed,ms:performance.now()-action,pass:true});
 }
}finally{
 sampler?.kill();await s.close();
}
