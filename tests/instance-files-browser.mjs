import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,mkdtemp,rm,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startFileHost} from '../tools/file-host.mjs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../tools/browser.mjs';
export async function instanceFileChecks(page){
const report={pass:false,checks:[],errors:[],timings:[],sourceSHA256:createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex')};
const call=(name,args={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[name,args]);
const check=(name,pass,detail)=>{report.checks.push({name,pass:!!pass,detail});console.log((pass?'PASS ':'FAIL ')+name);assert.ok(pass,name+': '+JSON.stringify(detail));};
const write=async(name,base64)=>page.evaluate(async({name,base64})=>{let dir=__linkedRoot;const parts=name.split('/');for(const p of parts.slice(0,-1))dir=await dir.getDirectoryHandle(p,{create:true});const h=await dir.getFileHandle(parts.at(-1),{create:true}),w=await h.createWritable();await w.write(Uint8Array.from(atob(base64),c=>c.charCodeAt(0)));await w.close();},{name,base64});
const inspect=()=>call('scene.inspect'),object=async hash=>(await inspect()).objects.find(o=>o.hash===hash);
const near=(a,b)=>a?.length===b?.length&&a.every((v,i)=>Math.abs(v-b[i])<1e-5);
let host,hostDirectory;
page.on('pageerror',e=>report.errors.push(e.stack));
try{
 await page.evaluate(()=>{window.__linkedGPU=[];frameEngine.renderer.device.addEventListener('uncapturederror',e=>__linkedGPU.push(e.error.message));frameEngine.renderer.device.pushErrorScope('validation');});
 await page.evaluate(async()=>{window.__linkedRoot=await navigator.storage.getDirectory();});
 const template=await call('scene.create',{type:'cube',params:{'size x':20,'size y':30,'size z':40}}),red=await call('material.create',{name:'Linked red',params:{h:15,s:80,l:75}});await call('material.assign',{id:template.hash,material:red.uid});const author=await call('authorData.get',{owner:'scene'});await call('authorData.replace',{owner:'scene',expected:{epoch:author.epoch,revision:author.data.revision},records:[{id:'ef'.repeat(16),revision:0,name:'Model source',kind:'source',refs:[],payload:{language:'text',text:'Linked model authoring'}}]});const first=await call('scene.export',{includeData:true});await write('part.hash',first.base64);
 for(const format of ['stl','glb','ply','vtk','3mf']){const exported=await call('scene.export',{format,includeData:true});await write('format.'+format,exported.base64);}
 await call('scene.update',{id:template.hash,params:{'size x':45}});const second=await call('scene.export',{includeData:true});
 await page.evaluate(()=>{
  window.__pickerCalls=[];
  window.showOpenFilePicker=async options=>{
   __pickerCalls.push({type:'file',active:navigator.userActivation.isActive,extensions:Object.values(options.types?.[0]?.accept||{}).flat()});
   if(!__pickerPath)throw new DOMException('Cancelled','AbortError');
   let dir=__linkedRoot;const parts=__pickerPath.split('/');
   for(const part of parts.slice(0,-1))dir=await dir.getDirectoryHandle(part);
   return [await dir.getFileHandle(parts.at(-1))];
  };
  window.showDirectoryPicker=async()=>{
   __pickerCalls.push({type:'directory',active:navigator.userActivation.isActive});
   return __linkedRoot.getDirectoryHandle(window.__pickerDirectory||'gltf-source');
  };
 });
 const choose=async(owner,path)=>{
  await page.evaluate(path=>window.__pickerPath=path,path);
  await call('scene.select',{ids:[owner.hash]});
  await page.locator('#tabAttributes').click();
  await page.locator('[data-instance-file]').click();
  if(path)await page.waitForFunction(({hash,path})=>{
   const n=frameNodeByHash(hash);return n?.params.file.split('/').at(-1)===path.split('/').at(-1)&&
    frameFiles.state(n).status!=='pending'&&!frameFiles.busy&&!document.getElementById('app').inert;
  },{hash:owner.hash,path},{timeout:20000});
 };
 const empty=()=>call('scene.create',{type:'instance'});
 const stateOf=hash=>page.evaluate(hash=>frameFiles.state(frameNodeByHash(hash)),hash);
 const waitBounds=(hash,x)=>page.waitForFunction(({hash,x})=>{
  const n=frameNodeByHash(hash),m=frameEngine.scene.meshes.find(m=>m.hashId===hash);
  return n&&!n.fileError&&m&&Math.abs(m.localBoundsMax[0]-x)<1e-4;
 },{hash,x},{timeout:15000});
 await write('direct-a/part.hash',first.base64);await write('direct-b/part.hash',second.base64);
 await call('scene.new');const direct=await empty();await choose(direct,'direct-a/part.hash');await waitBounds(direct.hash,20);
 const calls=await page.evaluate(()=>__pickerCalls.slice()),modelTypes=['hash','stl','obj','gltf','glb','ply','vtk','3mf','svg','step','stp','dxf'];
 check('First Choose file opens a file picker on the click and offers every model format',calls.length===1&&calls[0].type==='file'&&calls[0].active&&modelTypes.every(ext=>calls[0].extensions.includes('.'+ext)),calls);
 const original=await stateOf(direct.hash);await choose(direct,null);
 check('Cancelling the file picker preserves the assigned source',(await stateOf(direct.hash)).source===original.source&&!await page.locator('[data-instance-folder]').isVisible());
 const duplicateDirect=await empty();await choose(duplicateDirect,'direct-a/part.hash');await waitBounds(duplicateDirect.hash,20);
 const other=await empty();await choose(other,'direct-b/part.hash');await waitBounds(other.hash,45);
 check('Two choices of one file share geometry and equal filenames in different folders stay distinct',(await stateOf(duplicateDirect.hash)).root===original.root&&(await stateOf(other.hash)).root!==original.root);
 const pickedSaved=await call('scene.export',{includeData:true});
 await write('direct-a/part.hash',second.base64);await waitBounds(direct.hash,45);await waitBounds(duplicateDirect.hash,45);
 check('A directly chosen HASH updates all its placements without a folder grant',(await stateOf(direct.hash)).version!==original.version&&!(await call('instance.files')).mounts.length);
 await choose(direct,'direct-b/part.hash');await page.waitForFunction(([a,b])=>frameFiles.state(frameNodeByHash(a)).source===frameFiles.state(frameNodeByHash(b)).source,[direct.hash,other.hash]);
 await call('edit.history',{action:'undo'});check('Undo after choosing a different file restores the exact previous handle',(await stateOf(direct.hash)).source===original.source);
 const binary=new Float32Array([0,0,0,.01,0,0,0,.02,0]),gltf={asset:{version:'2.0'},buffers:[{uri:'triangle.bin',byteLength:36}],bufferViews:[{buffer:0,byteLength:36}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3'}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0};
 await write('gltf-source/triangle.bin',Buffer.from(binary.buffer).toString('base64'));await write('gltf-source/triangle.gltf',Buffer.from(JSON.stringify(gltf)).toString('base64'));
 await call('scene.new');const directGLTF=await empty();await choose(directGLTF,'gltf-source/triangle.gltf');
 await page.locator('[data-instance-folder]').waitFor({state:'visible'});
 check('A glTF with ungranted resources asks for its source folder only after the model is chosen',!!(await stateOf(directGLTF.hash)).error&&await page.evaluate(()=>__pickerCalls.every(c=>c.type==='file')));
 const idleImports=await page.evaluate(async()=>{
  const original=frameEngine.loadFileSource;let count=0;
  frameEngine.loadFileSource=(...args)=>{count++;return original(...args);};
  try{await frameAI.call('instance.files');await frameAI.call('scene.inspect');return count;}
  finally{frameEngine.loadFileSource=original;}
 });
 check('A missing folder leaves the importer idle while the rest of the assembly is inspected',idleImports===0,idleImports);
 await page.locator('[data-instance-folder]').click();await waitBounds(directGLTF.hash,10);
 const beforeBin=await stateOf(directGLTF.hash),cursor=(await call('scene.file')).sync.cursor;
 binary[3]=.021;await write('gltf-source/triangle.bin',Buffer.from(binary.buffer).toString('base64'));
 const notification=await call('scene.file.wait',{after:cursor,timeoutMs:12000});await waitBounds(directGLTF.hash,21);
 check('Editing only the external BIN refreshes geometry and notifies the assembly with a new content version',beforeBin.version!==(await stateOf(directGLTF.hash)).version&&notification.lastChange?.kind==='linked'&&!await page.locator('[data-instance-folder]').isVisible(),notification);
 binary[3]=.01;
 await call('scene.new');const fallback=await empty();await page.evaluate(()=>{window.__nativePicker=window.showOpenFilePicker;window.showOpenFilePicker=undefined;});
 await call('scene.select',{ids:[fallback.hash]});await page.locator('#tabAttributes').click();
 const inputEvent=page.waitForEvent('filechooser');await page.locator('[data-instance-file]').click();const chooser=await inputEvent;
 await chooser.setFiles([{name:'fallback.gltf',mimeType:'model/gltf+json',buffer:Buffer.from(JSON.stringify(gltf))},{name:'triangle.bin',mimeType:'application/octet-stream',buffer:Buffer.from(binary.buffer)}]);
 await waitBounds(fallback.hash,10);const fallbackSaved=await call('scene.export',{includeData:true});await page.evaluate(()=>window.showOpenFilePicker=window.__nativePicker);
 check('The standard browser file chooser accepts a glTF and binary companion together',(await stateOf(fallback.hash)).status==='ready');
 await write('gltf-source/inner.hash',first.base64);
 await call('scene.new');await call('scene.create',{type:'instance',params:{file:'inner.hash'}});
 const subfile=await call('scene.export',{includeData:true});
 await write('subassembly/outer.hash',subfile.base64);await write('subassembly/inner.hash',second.base64);
 await call('scene.new');const nested=await empty();await choose(nested,'subassembly/outer.hash');
 await page.evaluate(()=>window.__pickerDirectory='subassembly');
 await page.locator('[data-instance-folder]').click();await waitBounds(nested.hash,45);
 check('Choosing a nested HASH reads its relative parts from the explicitly granted source folder',(await stateOf(nested.hash)).status==='ready');
 await page.evaluate(async()=>{const dir=await __linkedRoot.getDirectoryHandle('subassembly');await dir.removeEntry('inner.hash');});
 await page.waitForFunction(hash=>!!frameNodeByHash(hash)?.fileError,nested.hash,{timeout:12000});
 check('A missing nested part marks the visible assembly and keeps its last geometry',(await object(nested.hash)).bounds?.max[0]===45);
 await write('subassembly/inner.hash',first.base64);await waitBounds(nested.hash,20);
 check('Restoring the nested part clears the assembly error',(await stateOf(nested.hash)).status==='ready');
 await call('scene.new');const emptyProject=await call('scene.export',{includeData:true});
 await write('portable/assembly/root.hash',emptyProject.base64);await write('portable/parts/chassis.hash',first.base64);
 await page.evaluate(()=>{window.__pickerDirectory='portable';window.__pickerPath='portable/assembly/root.hash';});
 await page.locator('#btnOpen').click();await page.waitForFunction(()=>document.title==='Frame - root.hash'&&!document.getElementById('app').inert&&FrameProjectFile.status().state==='current');
 const portable=await empty();await choose(portable,'portable/parts/chassis.hash');await waitBounds(portable.hash,20);
 await page.locator('#frame-project-folder').click();await page.waitForFunction(hash=>frameNodeByHash(hash)?.params.file==='../parts/chassis.hash'&&!frameNodeByHash(hash).fileMount&&frameFiles.state(frameNodeByHash(hash)).status==='ready'&&!frameFiles.busy&&!document.getElementById('app').inert,portable.hash,{timeout:10000});
 await call('scene.save');const assemblyBytes=await page.evaluate(async()=>{
  const project=await __linkedRoot.getDirectoryHandle('portable'),folder=await project.getDirectoryHandle('assembly'),handle=await folder.getFileHandle('root.hash');
  return btoa(String.fromCharCode(...new Uint8Array(await (await handle.getFile()).arrayBuffer())));
 });
 const peer=await page.context().browser().newContext({deviceScaleFactor:1});
 try{
  const viewer=await peer.newPage();await viewer.goto(page.url());await ready(viewer);
  await viewer.evaluate(async({assembly,part})=>{
   const root=await navigator.storage.getDirectory(),project=await root.getDirectoryHandle('other-copy',{create:true});
   for(const [dir,name,base64] of [['assembly','root.hash',assembly],['parts','chassis.hash',part]]){
    const folder=await project.getDirectoryHandle(dir,{create:true}),handle=await folder.getFileHandle(name,{create:true}),out=await handle.createWritable();
    await out.write(Uint8Array.from(atob(base64),c=>c.charCodeAt(0)));await out.close();
   }
   window.showOpenFilePicker=async()=>[await (await project.getDirectoryHandle('assembly')).getFileHandle('root.hash')];
   window.showDirectoryPicker=async()=>project;
  },{assembly:assemblyBytes,part:first.base64});
  await viewer.locator('#btnOpen').click();await viewer.locator('#frame-project-folder').click();
  await viewer.waitForFunction(hash=>frameEngine.scene.meshes.some(m=>m.hashId===hash&&m.localBoundsMax?.[0]===20),portable.hash,{timeout:15000});
  check('An independent browser profile opens the assembly in a different folder using the saved relative part path',await viewer.evaluate(hash=>frameNodeByHash(hash).params.file==='../parts/chassis.hash'&&frameFiles.state(frameNodeByHash(hash)).status==='ready',portable.hash));
 }finally{await peer.close();await page.bringToFront();}
 await call('scene.new');const unsaved=await empty();await choose(unsaved,'portable/parts/chassis.hash');const unsavedLink=await stateOf(unsaved.hash);
 const failedSave=await page.evaluate(async()=>{
  const project=await __linkedRoot.getDirectoryHandle('portable'),folder=await project.getDirectoryHandle('assembly'),target=await folder.getFileHandle('new-assembly.hash',{create:true});
  target.createWritable=async()=>({write:async()=>{},close:async()=>{throw Error('Simulated disk write failure');},abort:async()=>{}});
  try{await FrameProjectFile.save(target);return null;}catch(error){return error.message;}
 });
 check('A failed first save preserves the live instance path and source',/Simulated disk write failure/.test(failedSave)&&(await stateOf(unsaved.hash)).file===unsavedLink.file&&(await stateOf(unsaved.hash)).source===unsavedLink.source,failedSave);
 await page.evaluate(()=>{window.showSaveFilePicker=async()=>{const project=await __linkedRoot.getDirectoryHandle('portable'),folder=await project.getDirectoryHandle('assembly');return folder.getFileHandle('new-assembly.hash',{create:true});};});
 await page.locator('#btnSave').click();await page.waitForFunction(()=>document.title==='Frame - new-assembly.hash'&&!document.getElementById('app').inert);
 await call('scene.new');await page.evaluate(()=>window.__pickerPath='portable/assembly/new-assembly.hash');await page.locator('#btnOpen').click();
 await waitBounds(unsaved.hash,20);
 check('Saving a new assembly writes a portable path relative to its location on disk',await page.evaluate(hash=>frameNodeByHash(hash).params.file==='../parts/chassis.hash'&&!frameNodeByHash(hash).fileMount,unsaved.hash));

 await page.evaluate(()=>frameFiles.attachDirectory(__linkedRoot));
 await call('scene.new');const started=performance.now(),instance=await call('scene.create',{type:'instance',params:{file:'part.hash'}});let linked=await object(instance.hash);report.debug={linked,files:await call('instance.files')};
 check('Native folder source loads an editable HASH through Instance',linked.file?.status==='ready'&&linked.bounds?.max[0]===20,report.debug);check('Object stays empty for a file source',linked.params.object==='');
 check('Source document authoring stays scoped to its native definition',await page.evaluate(hash=>frameFiles.source(frameNodeByHash(hash)).authorData?.records.some(r=>r.payload.text==='Linked model authoring'),instance.hash)&&!(await call('authorData.get',{owner:'scene'})).data.records.length);
 const countBefore=(await inspect()).objects.length,rejected=await page.evaluate(async hash=>{const errors=[];for(const [name,args]of [['scene.create',{type:'instance',params:{file:'part.hash',object:hash}}],['scene.update',{id:hash,name:'Must not change',params:{file:'unsupported.txt'}}]])try{await frameAI.call(name,args);}catch(e){errors.push(e.code);}return errors;},instance.hash);check('Invalid source changes reject before any mutation',rejected.length===2&&rejected.every(e=>e==='INVALID_ARGUMENT')&&(await inspect()).objects.length===countBefore&&(await object(instance.hash)).name===linked.name,rejected);
 check('Only one File control is added',await page.locator('[data-instance-file]').count()===1&&await page.locator('[data-instance-file]').textContent()==='part.hash');
 await call('transform.apply',{ids:[instance.hash],position:[100,20,30],rotation:[0,0,15]});const placement=(await object(instance.hash)).matrix;
 const duplicate=await call('scene.create',{type:'instance',params:{file:'part.hash'}}),sourceA=await page.evaluate(hash=>frameFiles.source(frameNodeByHash(hash)).nativeHash,instance.hash),sourceB=await page.evaluate(hash=>frameFiles.source(frameNodeByHash(hash)).nativeHash,duplicate.hash);check('Repeated files share one native source',sourceA===sourceB);
 const saved=await call('scene.export',{includeData:true});check('Linked HASH does not embed source geometry',saved.bytes<first.bytes+2500,{linked:saved.bytes,source:first.bytes});
 await write('part.hash',second.base64);await page.waitForFunction(hash=>frameFiles.state(frameNodeByHash(hash)).version!==null&&frameFiles.source(frameNodeByHash(hash))&&frameEngine.scene.meshes.some(m=>m.hashId===hash&&m.localBoundsMax?.[0]===45),instance.hash,{timeout:15000});linked=await object(instance.hash);
 check('File changes automatically update all placements',linked.bounds&&near(linked.matrix,placement)&&(await object(duplicate.hash)).bounds.max[0]===45,{linked,duplicate:await object(duplicate.hash)});
 await page.evaluate(()=>__linkedRoot.removeEntry('part.hash'));await page.waitForFunction(hash=>!!frameNodeByHash(hash)?.fileError,instance.hash,{timeout:10000});
 check('Missing file marks Instance red and retains last complete geometry',await page.locator('#row-'+linked.id+' .ob-name').evaluate(el=>el.style.getPropertyValue('--object-color'))==='#ff5555'&&!!(await object(instance.hash)).bounds);
 await write('part.hash',second.base64);await page.waitForFunction(hash=>!frameFiles.state(frameNodeByHash(hash)).error,instance.hash,{timeout:10000});check('Recreated files recover automatically',!(await object(instance.hash)).buildError);
 await call('scene.open',{name:'linked.hash',base64:saved.base64});linked=await object(instance.hash);check('Linked Instance and native folder grant survive HASH reopen',linked.file?.status==='ready'&&near(linked.matrix,placement),linked);
 await call('scene.update',{id:instance.hash,params:{object:duplicate.hash}});check('Assigning Object clears File',(await object(instance.hash)).params.file==='');await call('edit.history',{action:'undo'});check('Undo restores linked source',(await object(instance.hash)).params.file==='part.hash');
 check('Undo retains current linked-source material identities',await page.evaluate(hash=>{const source=frameFiles.source(frameNodeByHash(hash));return nodes.filter(n=>n.fileSource===source.fileSource).some(n=>n.tags.some(t=>t.kind==='material'&&materials[t.material]?.name==='Linked red'));},instance.hash));
 const converted=await call('scene.connect',{ids:[instance.hash]});report.converted=converted;linked=await object(instance.hash);check('Make Editable unpacks to a placed native group',linked.type==='group'&&near(linked.matrix,placement),linked);
 check('Make Editable retains parametric source objects',(await inspect()).objects.some(n=>n.type==='cube'&&n.params['size x']===45&&!n.file));
 await call('edit.history',{action:'undo'});check('Unpack has one Undo',(await object(instance.hash)).type==='instance');await call('edit.history',{action:'redo'});check('Unpack Redo restores local hierarchy',(await object(instance.hash)).type==='group');
 await call('scene.delete',{ids:[duplicate.hash]});const standalone=await call('scene.export',{includeData:true});await page.evaluate(()=>__linkedRoot.removeEntry('part.hash'));await call('scene.open',{base64:standalone.base64,name:'standalone.hash'});check('Unpacked HASH reopens without its external file',(await object(instance.hash)).type==='group'&&!(await call('instance.files')).instances.length);
 await write('cube.hash',first.base64);await write('parts/cube.hash',second.base64);await call('scene.new');const child=await call('scene.create',{type:'instance',params:{file:'cube.hash'}});await call('transform.apply',{ids:[child.hash],position:[5,0,0]});const sub=await call('scene.export',{includeData:true});await write('parts/sub.hash',sub.base64);await call('scene.new');const outer=await call('scene.create',{type:'instance',params:{file:'parts/sub.hash'}});check('Nested files resolve relative to their containing file',(await object(outer.hash)).bounds?.max[0]===50,await object(outer.hash));
 await call('scene.convert',{id:outer.hash});check('API Make Editable recursively removes external dependencies',!(await call('instance.files')).instances.length&&(await inspect()).objects.some(n=>n.type==='cube'&&n.params['size x']===45));await call('edit.history',{action:'undo'});check('API unpack has one Undo',(await object(outer.hash)).type==='instance');await call('edit.history',{action:'redo'});check('API unpack Redo restores editable authoring',(await object(outer.hash)).type==='group');
 await call('scene.new');const cycle=await call('scene.create',{type:'instance',params:{file:'cycle.hash'}}),cycleData=await call('scene.export',{includeData:true});await write('cycle.hash',cycleData.base64);await page.waitForFunction(hash=>!frameFiles.busy&&!document.getElementById('app').inert&&/Cyclic/i.test(frameFiles.state(frameNodeByHash(hash)).error||''),cycle.hash,{timeout:10000});check('Linked-file cycles fail without recursion or partial publication',(await object(cycle.hash)).file.root===null&&/Cyclic/i.test((await object(cycle.hash)).file.error));
 const textFiles={obj:'v 0 0 0\nv 10 0 0\nv 0 20 0\nf 1 2 3\n',svg:'<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="20mm" viewBox="0 0 10 20"><path d="M0 0 L10 0 L10 20 L0 20 Z"/></svg>'};for(const [ext,text]of Object.entries(textFiles))await write('format.'+ext,Buffer.from(text).toString('base64'));
 for(const [ext,path]of [['step','step/cube-units-cube-mm.step'],['stp','step/cube-10x10mm-Cube-10x10.stp'],['dxf','dxf/3dface.dxf']])await write('format.'+ext,(await readFile(new URL('scenes/'+path,import.meta.url))).toString('base64'));
 for(const ext of ['obj','stl','glb','ply','vtk','3mf','svg','step','stp','dxf']){await call('scene.new');const linked=await empty();await choose(linked,'format.'+ext);const state=await object(linked.hash);check('File source uses the native '+ext.toUpperCase()+' importer',state.file?.status==='ready'&&!!state.bounds&&!state.buildError,state.file);}
 await write('triangle.bin',Buffer.from(binary.buffer).toString('base64'));await write('triangle.gltf',Buffer.from(JSON.stringify(gltf)).toString('base64'));await call('scene.new');const external=await call('scene.create',{type:'instance',params:{file:'triangle.gltf'}});check('glTF resolves external binary resources from the project folder',Math.abs((await object(external.hash)).bounds?.max[0]-10)<1e-5,await object(external.hash));
 binary[3]=.015;await write('triangle.bin',Buffer.from(binary.buffer).toString('base64'));await page.waitForFunction(hash=>{const n=frameNodeByHash(hash),m=frameEngine.scene.meshes.find(m=>m.hashId===hash);return n&&!n.fileError&&m&&Math.abs(m.localBoundsMax[0]-15)<1e-4;},external.hash,{timeout:10000});check('External resource edits also trigger automatic updates',Math.abs((await object(external.hash)).bounds.max[0]-15)<1e-4);
 const persistent=await call('scene.export',{includeData:true});await call('scene.new');hostDirectory=await mkdtemp(join(tmpdir(),'frame-linked-source-'));const hostPath=join(hostDirectory,'source.hash');await writeFile(hostPath,Buffer.from(first.base64,'base64'));host=await startFileHost({paths:[hostPath],origin:new URL(page.url()).origin});await call('scene.host.connect',{url:host.url,token:host.token});const hostInstance=await call('scene.create',{type:'instance',params:{file:hostPath}});check('Authorized local host supports file sources',(await object(hostInstance.hash)).bounds?.max[0]===20);await writeFile(hostPath,Buffer.from(second.base64,'base64'));await page.waitForFunction(hash=>frameEngine.scene.meshes.some(m=>m.hashId===hash&&m.localBoundsMax[0]===45),hostInstance.hash,{timeout:10000});check('Host metadata automatically detects external saves',(await object(hostInstance.hash)).bounds.max[0]===45);await call('scene.new');await call('scene.host.disconnect');await host.close();host=null;
 await call('scene.create',{type:'car'});const stock=await call('scene.export',{includeData:true});await write('stock.hash',stock.base64);await call('scene.new');const stockLink=await call('scene.create',{type:'instance',params:{file:'stock.hash'}}),stockObject=await object(stockLink.hash);check('Linked HASH finishes lazy native stock geometry before publication',stockObject.file.status==='ready'&&stockObject.mesh?.triangles>100&&!stockObject.buildError,stockObject);const stockLinked=await call('scene.export',{includeData:true});check('Linked stock saves only its reference',stockLinked.bytes<stock.bytes+2500,{source:stock.bytes,linked:stockLinked.bytes});
 report.gpu=await page.evaluate(async()=>{await frameEngine.renderer.device.queue.onSubmittedWorkDone();return {validation:(await frameEngine.renderer.device.popErrorScope())?.message||null,uncaptured:__linkedGPU};});check('No GPU errors across linked-file workflows',!report.gpu.validation&&!report.gpu.uncaptured.length,report.gpu);await page.reload();await ready(page);await page.evaluate(()=>{window.__linkedReloadGPU=[];frameEngine.renderer.device.addEventListener('uncapturederror',e=>__linkedReloadGPU.push(e.error.message));frameEngine.renderer.device.pushErrorScope('validation');});await call('scene.open',{name:'persistent.hash',base64:persistent.base64});check('Folder handles and relative links survive a PWA reload',(await object(external.hash)).file?.status==='ready',await object(external.hash));await call('scene.open',{name:'direct-links.hash',base64:pickedSaved.base64});check('Direct file handles survive an application reload and reopen their exact sources',(await stateOf(direct.hash)).source===original.source&&(await object(direct.hash)).bounds?.max[0]===45&&(await stateOf(other.hash)).source!==original.source);
 await call('scene.open',{name:'fallback-links.hash',base64:fallbackSaved.base64});check('Browser-selected model and sidecar snapshots survive a reload',Math.abs((await object(fallback.hash)).bounds?.max[0]-10)<1e-4);
 report.reloadGPU=await page.evaluate(async()=>({validation:(await frameEngine.renderer.device.popErrorScope())?.message||null,uncaptured:__linkedReloadGPU}));check('Reloaded source has no GPU errors',!report.reloadGPU.validation&&!report.reloadGPU.uncaptured.length,report.reloadGPU);
 report.timings.push({name:'File source workflows',ms:performance.now()-started});check('No browser errors',!report.errors.length,report.errors);report.pass=true;
}catch(error){report.error=error.stack;}finally{await host?.close();if(hostDirectory){await rm(join(hostDirectory,'source.hash'),{force:true});await rmdir(hostDirectory);}}return report;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const session=await launch({headless:true});let report;try{await ready(session.page);report=await instanceFileChecks(session.page);}catch(error){report={pass:false,error:error.stack};}finally{await session.close();await mkdir(new URL('results/',import.meta.url),{recursive:true});await writeFile(new URL('results/instance-files-browser.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,checks:report.checks?.length,error:report.error}));process.exitCode=report.pass?0:1;}
}
