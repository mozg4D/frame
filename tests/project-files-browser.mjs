import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {chromium} from 'playwright';
import {serve,ready} from '../tools/browser.mjs';
import {startFileHost} from '../tools/file-host.mjs';

const directory=await mkdtemp(join(tmpdir(),'frame-project-team-'));
const names=['printer.hash','head.hash','gantry.hash','draft.hash'];
const [assembly,head,gantry,draft]=names.map(name=>join(directory,name));
const server=await serve(),host=await startFileHost({paths:[assembly,head,gantry,draft],origin:server.url});
const browser=await chromium.launch({channel:'chrome',executablePath:process.env.FRAME_BROWSER||undefined,headless:true,
  args:['--enable-unsafe-webgpu','--enable-features=WebMCPTesting','--enable-blink-features=WebMCP,WebMCPTesting','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const errors=[];
const call=(page,name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]);
const files=page=>call(page,'scene.file');
const objects=async page=>(await call(page,'scene.inspect')).objects;
const find=async(page,id)=>(await objects(page)).find(n=>n.hash===id);
function pass(name){console.log('PASS',name);}
async function editor(){
  const context=await browser.newContext({viewport:{width:1280,height:850},deviceScaleFactor:1}),page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(server.url);await ready(page);
  await call(page,'scene.host.connect',{url:host.url,token:host.token});return page;
}
try{
  const writer=await editor(),observer=await editor(),headEditor=await editor(),gantryEditor=await editor();
  assert.equal(await observer.evaluate(()=>frameEngine.renderer.device.adapterInfo.isFallbackAdapter),false);
  pass('Four independent Frame documents use hardware WebGPU at DPR 1');
  const cdp=await writer.context().newCDPSession(writer),tools=new Map();
  cdp.on('WebMCP.toolsAdded',({tools:items})=>items.forEach(t=>tools.set(t.name,t)));
  await cdp.send('WebMCP.enable');await writer.waitForFunction(()=>typeof document.modelContext?.registerTool==='function');
  assert.ok(tools.has('scene_file_wait')&&tools.has('app_describe')&&tools.has('scene_create'),[...tools.keys()].join());
  async function siteTool(name,input={}){
    const reply=once(cdp,'WebMCP.toolResponded',{signal:AbortSignal.timeout(15000)});
    const id=await cdp.send('WebMCP.invokeTool',{frameId:tools.get(name).frameId,toolName:name,input});
    const [event]=await reply;
    assert.equal(event.invocationId,id.invocationId);assert.equal(event.status,'Completed',JSON.stringify(event));
    return event;
  }
  const help=await call(writer,'app.describe');
  await siteTool('scene_create',{type:'group',name:'WebMCP proof'});
  assert.ok((await objects(writer)).some(n=>n.name==='WebMCP proof'));
  await call(writer,'scene.new');
  const describe=await siteTool('app_describe');
  assert.ok(JSON.stringify(describe).includes('phone stand'));
  await writer.keyboard.press('F1');assert.equal(await writer.locator('#frame-help-people').innerText(),help.help.people);
  assert.equal(await writer.locator('#frame-help-ai').innerText(),help.help.assistants);await writer.keyboard.press('Escape');
  pass('Real Chrome WebMCP invocation and F1 share the same instructions');
  const pin=await call(headEditor,'scene.create',{type:'cube',name:'Head',params:{'size x':20}});
  await call(headEditor,'scene.saveAs',{path:head,createOnly:true});
  const partBytes=await readFile(head);
  await assert.rejects(call(gantryEditor,'scene.saveAs',{path:head,createOnly:true}),/changed since it was opened/);
  assert.deepEqual(await readFile(head),partBytes);
  const rail=await call(gantryEditor,'scene.create',{type:'cube',name:'Rail'});
  await call(gantryEditor,'scene.saveAs',{path:gantry});
  const holder=await call(writer,'scene.create',{type:'group',name:'Printer'});
  await call(writer,'scene.saveAs',{path:assembly});
  const link=await call(writer,'scene.create',{type:'instance',parent:holder.hash,params:{file:'head.hash'}});
  await call(writer,'scene.create',{type:'instance',parent:holder.hash,params:{file:'gantry.hash'}});
  await call(writer,'scene.save');
  await call(observer,'scene.open',{path:assembly});
  assert.equal((await find(observer,link.hash)).file.status,'ready');
  const stale=await siteTool('scene_file_reload',{baseVersion:'previous',version:'stale'});
  assert.ok(JSON.stringify(stale).includes('FILE_CONFLICT'));
  await call(observer,'scene.select',{ids:[holder.hash]});
  const view=await observer.evaluate(()=>Array.from(frameEngine.viewState));
  const beforeParts=(await files(observer)).sync.cursor;
  await Promise.all([call(headEditor,'scene.update',{id:pin.hash,name:'Long head',params:{'size x':45}}),
    call(gantryEditor,'scene.update',{id:rail.hash,name:'Long rail'})]);
  await Promise.all([call(headEditor,'scene.save'),call(gantryEditor,'scene.save')]);
  await observer.waitForFunction(id=>frameFiles.source(frameNodeByHash(id))&&frameEngine.scene.meshes.some(m=>m.hashId===id&&m.localBoundsMax[0]===45),link.hash,{timeout:15000});
  pass('Independent part saves refresh assembly placements across browser profiles');
  const partEvents=[];
  let cursor=beforeParts;
  for(let i=0;i<2;i++){
    const result=await call(observer,'scene.file.wait',{after:cursor,timeoutMs:5000});
    assert.ok(!result.timedOut&&!result.missed);cursor=result.cursor;
    const event=(await call(observer,'scene.file.changes',{cursor,limit:1})).lastChange;
    assert.equal(event.kind,'linked');partEvents.push(event.file.split(/[\\/]/).pop());
    assert.ok(event.total>=1&&event.changes.length===1);
  }
  assert.deepEqual(partEvents.sort(),['gantry.hash','head.hash']);
  const current=await files(observer);assert.equal(current.sync.dirty,false);
  pass('Both linked saves are replayable by cursor, with property and object changes');
  await call(writer,'scene.update',{id:holder.hash,name:'Printer Mk 2'});
  const waiting=call(observer,'scene.file.wait',{after:current.sync.cursor,timeoutMs:15000});
  await writer.locator('#btnSave').click();
  const update=await waiting;
  await observer.waitForFunction(id=>frameNodeByHash(id)?.name==='Printer Mk 2',holder.hash,{timeout:15000});
  const changed=(await files(observer)).sync;
  assert.ok(changed.lastChange.changes.some(item=>item.id===holder.hash&&item.fields.includes('name')),JSON.stringify(changed));
  assert.equal(changed.dirty,false);assert.ok(!update.timedOut);
  assert.deepEqual((await call(observer,'scene.inspect')).selection.objects.map(n=>typeof n==='string'?n:n.hash),[holder.hash]);
  const afterView=await observer.evaluate(()=>Array.from(frameEngine.viewState));assert.ok(afterView.every((n,i)=>Math.abs(n-view[i])<1e-4));
  pass('Toolbar Save wakes the observer, refreshes the root, preserves view and selection, and reports exact changes');
  await Promise.all([call(writer,'scene.update',{id:holder.hash,name:'Writer draft'}),call(observer,'scene.update',{id:holder.hash,name:'Observer draft'})]);
  const outcome=await Promise.allSettled([call(writer,'scene.save'),call(observer,'scene.save')]);
  assert.equal(outcome.filter(x=>x.status==='fulfilled').length,1,JSON.stringify(outcome));
  const [winning,losing]=outcome[0].status==='fulfilled'?[writer,observer]:[observer,writer];
  const winningName=(await find(winning,holder.hash)).name, losingName=(await find(losing,holder.hash)).name;
  const beforeCopy=await readFile(assembly);
  await call(losing,'scene.file.sync');
  const conflict=(await files(losing)).sync;assert.equal(conflict.state,'conflict');assert.ok(conflict.dirty);
  assert.ok(await losing.locator('#frame-project-reload').isVisible());assert.notEqual(winningName,losingName);
  await assert.rejects(call(losing,'scene.file.reload',{baseVersion:conflict.baseVersion,version:'stale'}),/review/i);
  assert.equal((await find(losing,holder.hash)).name,losingName);
  await call(losing,'scene.saveAs',{path:draft});assert.deepEqual(await readFile(assembly),beforeCopy);
  await call(losing,'scene.open',{path:draft});assert.equal((await find(losing,holder.hash)).name,losingName);
  pass('Competing saves publish one winner, retain the losing draft, reject stale reload and save a separate copy');
  await call(losing,'scene.open',{path:assembly});
  await call(losing,'scene.update',{id:holder.hash,name:'Local draft'});
  await call(winning,'scene.update',{id:holder.hash,name:'Published frame'});await call(winning,'scene.save');
  const syncSaves=await losing.evaluate(async()=>{
    let saves=0;const orig=frameEngine.saveHash;frameEngine.saveHash=function(...a){saves++;return orig.apply(this,a);};
    try{await frameAI.call('scene.file.sync');return saves;}finally{frameEngine.saveHash=orig;}
  });
  assert.equal(syncSaves,0);
  await losing.locator('#frame-project-reload').click();
  await losing.waitForFunction(id=>FrameProjectFile.status().state==='current'&&frameNodeByHash(id)?.name==='Published frame',holder.hash);
  const stampChecks=await losing.evaluate(async id=>{
    const stamp=()=>frameEngine.fileEditStamp,clean=stamp();
    if(FrameProjectFile.status().dirty)return {ok:false,step:'initial'};
    await frameAI.call('edit.history',{action:'undo'});await frameAI.call('edit.history',{action:'redo'});
    if(stamp()!==clean||FrameProjectFile.status().dirty)return {ok:false,step:'empty-undo-redo'};
    await frameAI.call('scene.select',{ids:[id]});await frameAI.call('scene.select',{ids:[]});
    if(stamp()!==clean||FrameProjectFile.status().dirty)return {ok:false,step:'selection'};
    setTimelineFrame(4);
    const afterFrame=stamp();if(afterFrame===clean||!FrameProjectFile.status().dirty)return {ok:false,step:'timeline-frame'};
    setTimelineFrame(0);
    if(stamp()!==clean||FrameProjectFile.status().dirty)return {ok:false,step:'timeline-frame-restore'};
    document.getElementById('btnBrowser').click();
    const afterFold=stamp();if(afterFold===clean||!FrameProjectFile.status().dirty)return {ok:false,step:'fold-all'};
    document.getElementById('btnBrowser').click();
    const afterUnfold=stamp();if(afterUnfold===afterFold||!FrameProjectFile.status().dirty)return {ok:false,step:'unfold-all'};
    return {ok:true};
  },holder.hash);
  assert.deepEqual(stampChecks,{ok:true});
  await call(losing,'scene.open',{path:assembly});
  pass('Explicit reload resolves the reviewed conflict through the human UI');
  const copy=await readFile(assembly);
  await rm(assembly);
  await losing.waitForFunction(()=>FrameProjectFile.status().state==='error',{},{timeout:6500});
  await assert.rejects(call(losing,'scene.save'));
  assert.equal((await find(losing,holder.hash)).name,'Published frame');
  await writeFile(assembly,copy);
  await losing.waitForFunction(()=>FrameProjectFile.status().state==='current',{},{timeout:6500});
  pass('A removed project retains the open model and recovers after the file returns');

  const participants=await Promise.all(Array.from({length:16},async()=>{
    const response=await fetch(host.url+'connect',{method:'POST',headers:{Origin:server.url,Authorization:'Bearer '+host.token,'Content-Type':'application/json'},body:'{}'});
    assert.equal(response.status,200);return (await response.json()).session;
  }));
  assert.equal(new Set(participants).size,16);pass('A shared project accepts sixteen additional independent sessions');
  await Promise.all([writer,observer,headEditor,gantryEditor].map(p=>p.context().close()));

  const native=await browser.newContext({viewport:{width:1280,height:850},deviceScaleFactor:1});
  const first=await native.newPage(),second=await native.newPage();
  for(const page of [first,second]){page.on('pageerror',e=>errors.push(e.message));await page.goto(server.url);await ready(page);}
  const payload=await Promise.all([assembly,head,gantry].map(async(path,i)=>[names[i],(await readFile(path)).toString('base64')]));
  await first.evaluate(async payload=>{
    const root=await navigator.storage.getDirectory(),folder=await root.getDirectoryHandle('project',{create:true});
    for(const [name,base64] of payload){const h=await folder.getFileHandle(name,{create:true}),out=await h.createWritable();await out.write(Uint8Array.from(atob(base64),c=>c.charCodeAt(0)));await out.close();}
  },payload);
  for(const p of [first,second]){
    await p.evaluate(async()=>{
      const folder=await (await navigator.storage.getDirectory()).getDirectoryHandle('project');
      window.showOpenFilePicker=async()=>[await folder.getFileHandle('printer.hash')];
      window.showDirectoryPicker=async()=>folder;
      window.showSaveFilePicker=async()=>folder.getFileHandle('local-copy.hash',{create:true});
    });
    await p.bringToFront();await p.locator('#btnOpen').click();
    await p.waitForFunction(()=>FrameProjectFile.status().state==='current');
    if(await p.locator('#frame-project-folder').isVisible())await p.locator('#frame-project-folder').click();
    await p.waitForFunction(id=>!frameFiles.busy&&frameEngine.idle&&frameFiles.state(frameNodeByHash(id)).status==='ready',link.hash,{timeout:20000});
    assert.equal((await files(p)).host,false);
  }
  await call(first,'scene.update',{id:holder.hash,name:'Native folder update'});
  await first.locator('#btnSave').click();
  await second.waitForFunction(id=>FrameProjectFile.status().lastChange?.kind==='updated'&&frameEngine.idle&&frameNodeByHash(id)?.name==='Native folder update',holder.hash,{timeout:20000});
  await call(first,'scene.update',{id:holder.hash,name:'Native saved'});
  await call(second,'scene.update',{id:holder.hash,name:'Native draft'});
  await call(first,'scene.save');
  await assert.rejects(call(second,'scene.save'),/changed on disk/);
  await second.locator('#frame-project-copy').click();
  await second.waitForFunction(()=>document.title==='Frame - local-copy.hash');
  assert.equal((await find(second,holder.hash)).name,'Native draft');
  assert.equal((await find(first,holder.hash)).name,'Native saved');
  pass('Ordinary Open and Save bind real browser handles, resolve a granted folder and keep a conflict copy');
  const scale=await first.evaluate(async()=>{
    const file=await (await fetch('/tests/scenes/engineering-zoo-10k.hash')).blob();
    const start=performance.now(),before=await createFrameFileIndex().read(file);
    const [id]=before.names.keys(),key=FrameHash.address(id,'name'),reader=FrameHash.reader(file),row=(await reader.index()).get(key);
    const rename=await FrameHash.pack({id:key,type:FrameHash.T.text,value:'Revised part'});
    const next=new Blob([file.slice(0,row.offset-26),rename.blob,file.slice(row.offset+row.length)]);
    const after=await createFrameFileIndex().read(next),diff=frameCompareFileIndexes(before,after);
    return {count:before.owners.length,bytes:file.size,changes:diff.length,field:diff[0]?.fields,name:diff[0]?.name,ms:Math.round(performance.now()-start)};
  });
  assert.ok(scale.count>=10000);assert.equal(scale.changes,1);assert.deepEqual(scale.field,['name']);assert.equal(scale.name,'Revised part');
  pass('Located one renamed object among '+scale.count+' persisted objects ('+scale.bytes+' bytes, '+scale.ms+' ms)');
  await native.close();
  assert.deepEqual(errors,[]);pass('No browser exceptions');
}finally{await browser.close();await host.close();await server.close();await rm(directory,{recursive:true,force:true});}
