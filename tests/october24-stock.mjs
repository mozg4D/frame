import {launch,ready} from '../tools/browser.mjs';import {readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
async function checkHatchbackPaint(page,call,check,car,materials,reference){
  const body=materials.find(m=>m.name==='Paint'),seams=materials.find(m=>m.name==='Seams');
  const hsl=m=>[m.h,m.s,m.l],near=(a,b)=>a.length===b.length&&a.every((v,i)=>Math.abs(v-b[i])<1e-9);
  const finishes=reference.materials,lookup=(rows,uid)=>rows.find(m=>m.uid===uid);
  const catalogue=await call('scene.catalogue',{type:'car'});
  check('New stock Car uses the supplied blue hatchback finish',car.params['color preset']==='blue'&&catalogue.params['color preset']==='blue'&&finishes.every(ref=>{
    const m=materials.find(m=>m.name===ref.name);
    return m&&['h','s','l','rough','metal','opac','emm'].every(k=>m[k]===ref[k]);
  }),{params:car.params,materials});
  const masks=await call('diagnostics.appearance',{id:car.hash,faces:finishes.map(m=>m.sampleFace)});
  const base=masks.materials.find(m=>m.material===body.uid),overlays=masks.materials.filter(m=>m!==base);
  check('The body paint supplies the whole-object and wire colour',base.triangles===car.mesh.triangles&&
    car.tags.some(t=>t.librarySlot&&t.materialUID===body.uid&&!t.mask),base);
  check('All ten materials cover their authored polygons',finishes.length===10&&masks.materials.length===finishes.length&&finishes.every((ref,i)=>{
    const effective=masks.materials.findLast(m=>m.samples[i].selected);
    const count=effective===base?base.triangles-overlays.reduce((sum,m)=>sum+m.triangles,0):effective?.triangles;
    return effective&&lookup(materials,effective.material)?.name===ref.name&&count===ref.triangles;
  }),masks);
  const samples=[806,817,828,845,1652,1663,1674,1691,419,423,1265,1269];
  const rims=await call('diagnostics.appearance',{id:car.hash,faces:samples}),trim=materials.find(m=>m.name==='Trim');
  check('Both headlamp and tail lamp rims share the door seams and all four handles share the trim',
    samples.every((_,i)=>rims.materials.findLast(m=>m.samples[i].selected)?.material===(i<8?seams:trim).uid),rims);
  await page.locator('#tabAttributes').click();
  const field=page.locator('#attrContent [data-field="color preset"]');
  await field.focus();await field.press('ArrowUp');
  let state=await call('scene.inspect');
  check('The Attributes colour control tints body and seams silver',state.objects.find(n=>n.hash===car.hash).params['color preset']==='silver'&&near(hsl(lookup(state.materials,body.uid)),[0,0,50])&&near(hsl(lookup(state.materials,seams.uid)),[0,0,42.5]));
  await call('edit.history',{action:'undo'});
  const otherMaterials=rows=>rows.filter(m=>m.uid!==body.uid&&m.uid!==seams.uid);
  const others=JSON.stringify(otherMaterials(materials)),seen=new Set();
  for(const preset of catalogue.choices['color preset']){
    await call('scene.update',{id:car.hash,params:{'color preset':preset}});
    state=await call('scene.inspect');
    const painted=lookup(state.materials,body.uid),trim=lookup(state.materials,seams.uid);
    check('Hatchback '+preset+' coordinates the paint colours and preserves other finishes',
      near(hsl(trim),[painted.h,painted.s,painted.l*seams.l/body.l])&&JSON.stringify(otherMaterials(state.materials))===others&&
      painted.rough===body.rough&&trim.rough===seams.rough&&(preset!=='blue'||near(hsl(painted),hsl(body))),
      {body:hsl(painted),seams:hsl(trim)});
    seen.add(JSON.stringify(hsl(painted)));
  }
  check('All ten car presets give distinct paint colours',seen.size===10&&catalogue.choices['color preset'].length===10,[...seen]);
  await call('scene.update',{id:car.hash,params:{'color preset':'blue'}});
}
async function checkCopyPaint(call,check,operation,sourceId,copyId){
  function finish(state,id){
    const n=state.objects.find(o=>o.hash===id),slots=n.tags.filter(t=>t.librarySlot).map(t=>state.materials.find(m=>m.uid===t.materialUID));
    return {preset:n.params['color preset'],body:slots.find(m=>m.name==='Paint'),seams:slots.find(m=>m.name==='Seams')};
  }
  const before=await call('scene.inspect'),source=finish(before,sourceId),copy=finish(before,copyId);
  const independent=state=>{
    const current=finish(state,copyId);
    return JSON.stringify(finish(state,sourceId))===JSON.stringify(source)&&current.preset==='green'&&
      current.body.h===82&&current.body.s===100&&current.body.l===22&&current.body.rough===copy.body.rough&&
      current.seams.h===82&&current.seams.s===100&&Math.abs(current.seams.l-18.7)<1e-8;
  };
  await call('scene.update',{id:copyId,params:{'color preset':'green'}});
  check(operation+' can paint its copy independently',independent(await call('scene.inspect')));
  if(operation==='duplicate'){
    await call('edit.history',{action:'undo'});
    const undone=await call('scene.inspect');
    check('Paint Undo restores the original material links on a duplicate',
      JSON.stringify(finish(undone,copyId))===JSON.stringify(copy)&&JSON.stringify(finish(undone,sourceId))===JSON.stringify(source));
    await call('edit.history',{action:'redo'});
    check('Paint Redo restores independent finishes',independent(await call('scene.inspect')));
  }
  const saved=await call('scene.export',{includeData:true});
  await call('scene.open',{name:'painted-copies.hash',base64:saved.base64});
  check(operation+' preserves both paint choices after reopening',independent(await call('scene.inspect')));
}
export async function october24StockChecks(page){const checks=[],timings=[],call=(n,a={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[n,a]),state=()=>call('scene.inspect'),check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});if(!pass)throw Error(name+': '+JSON.stringify(detail));},measure=async(name,limit,fn)=>{const at=performance.now(),r=await fn(),ms=performance.now()-at;timings.push({name,ms,limit});check(name+' latency',ms<limit,{ms,limit});return r;};try{
 let s=await state();if(s.objects.length)await call('scene.delete',{ids:s.objects.filter(n=>!n.parent).map(n=>n.hash)});const empty=await call('scene.export',{includeData:true}),manifest=JSON.parse(await readFile(new URL('./stock-models-reference.json',import.meta.url),'utf8')),requests=[];page.on('request',r=>{if(r.url().includes('/models/'))requests.push(r.url());});
 for(const entry of manifest.entries){await call('scene.open',{name:'empty.hash',base64:empty.base64});let type,params={},file=entry.filename;if(file.startsWith('car'))type='car';else if(file.startsWith('tree')){type='tree';const m=file.match(/^tree-(\w+)-1-([01])/);params={type:m[1],detail:m[2]==='1'?'high':'low'};}else{type='human';params={type:file.includes('female')?'woman':'man',pose:file.includes('sitting')?'sit':file.includes('walking')?'walk':'stand'};}const n=await measure(file+' library load',2000,()=>call('scene.create',{type,params})),geometry=await call('diagnostics.mesh',{id:n.hash,geometry:true});check(file+' exact converted geometry',geometry.positionsSHA256===entry.positionsSHA256&&geometry.indicesSHA256===entry.indicesSHA256&&!n.buildError,{geometry,reference:entry});check(file+' native material slots',n.tags.filter(t=>t.librarySlot).length===entry.materials.length-Number(entry.materials[0]?.name==='Default'),{tags:n.tags,materials:entry.materials});const saved=await measure(file+' compact HASH save',1200,()=>call('scene.export',{includeData:true})),contents=await page.evaluate(async ({base64,id})=>{const file=new Blob([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))]),map=await FrameHash.index(file);return {size:file.size,positions:map.has(FrameHash.address(id,'positions')),indices:map.has(FrameHash.address(id,'indices')),records:map.size};},{base64:saved.base64,id:n.hash});check(file+' saves references without derived polygon buffers',!contents.positions&&!contents.indices&&contents.size<10000,contents);await measure(file+' compact HASH open',2000,()=>call('scene.open',{name:'library.hash',base64:saved.base64}));const round=await call('diagnostics.mesh',{id:n.hash,geometry:true}),opened=(await state()).objects.find(o=>o.hash===n.hash);check(file+' compact roundtrip restores geometry parameters and slots',round.positionsSHA256===geometry.positionsSHA256&&round.indicesSHA256===geometry.indicesSHA256&&opened.type===type&&JSON.stringify(opened.params)===JSON.stringify(n.params)&&opened.tags.filter(t=>t.librarySlot).every((t,i)=>t.materialUID===n.tags.filter(t=>t.librarySlot)[i].materialUID),{before:n,after:opened});}
 for(const type of ['square','circle','polyhedron','text','helix','gear','pulley','cube','cylinder','tube','sphere','capsule','nut','washer','bolt']){await call('scene.open',{name:'empty.hash',base64:empty.base64});const n=await call('scene.create',{type}),saved=await call('scene.export',{includeData:true}),content=await page.evaluate(async ({base64,id})=>{const f=new Blob([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))]),m=await FrameHash.index(f);return {bytes:f.size,positions:m.has(FrameHash.address(id,'positions')),indices:m.has(FrameHash.address(id,'indices')),shape:m.has(FrameHash.address(id,'spline'))};},{base64:saved.base64,id:n.hash});check(type+' saves only parametric authoring',content.bytes<10000&&!content.positions&&!content.indices&&content.shape,content);}
 check('Built-in models load only native HASH assets',requests.length>0&&requests.every(u=>u.endsWith('.hash')),requests);
 await call('scene.open',{name:'empty.hash',base64:empty.base64});const car=await call('scene.create',{type:'car'}),before=await call('diagnostics.mesh',{id:car.hash,geometry:true}),names=(await state()).materials;const paint=names.find(m=>/paint/i.test(m.name));await checkHatchbackPaint(page,call,check,car,names,manifest.entries.find(e=>e.filename==='car-hatchback-1.hash'));await page.locator('#tabMaterials').click();await page.locator('[data-material="'+names.findIndex(m=>m.uid===paint.uid)+'"] canvas').click();await page.locator('#tabMaterialMgr').click();for(const [id,value]of [['inpRough','12'],['inpH','130']]){await page.locator('#'+id).fill(value);await page.locator('#'+id).press('Enter');}await state();const saved=await call('scene.export',{includeData:true});await call('scene.open',{name:'custom-car.hash',base64:saved.base64});check('Compact library roundtrip preserves edited stock materials',(await state()).materials.find(m=>m.uid===paint.uid)?.rough===12&&(await state()).materials.find(m=>m.uid===paint.uid)?.h===130);
 const requestCount=requests.length;await measure('Car paint preset update reuses geometry',1000,()=>call('scene.update',{id:car.hash,params:{'color preset':'gold'}}));const painted=await call('diagnostics.mesh',{id:car.hash,geometry:true});check('Paint change performs no model fetch and preserves geometry',requests.length===requestCount&&painted.positionsSHA256===before.positionsSHA256&&painted.indicesSHA256===before.indicesSHA256,{requestCount,after:requests.length});await call('edit.history',{action:'undo'});check('Paint Undo restores the edited material',(await state()).materials.find(m=>m.uid===paint.uid)?.h===130);
 const converted=await call('scene.convert',{id:car.hash}),editableSaved=await call('scene.export',{includeData:true}),editableRecords=await page.evaluate(async ({base64,id})=>{const f=new Blob([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))]),m=await FrameHash.index(f);return m.has(FrameHash.address(id,'positions'))&&m.has(FrameHash.address(id,'indices'));},{base64:editableSaved.base64,id:car.hash});check('Make Editable saves its independent canonical polygon data',converted.type==='mesh'&&editableRecords&&converted.pivot.slice(9).every(v=>Math.abs(v)<1e-8));await call('edit.history',{action:'undo'});check('Library Make Editable Undo preserves materials and type',(await state()).objects.find(n=>n.hash===car.hash)?.type==='car'&&(await state()).materials.length===names.length);
 for(const operation of ['duplicate','paste','merge']){let added;if(operation==='duplicate')added=(await measure('Compact library duplicate',2000,()=>call('scene.duplicate',{ids:[car.hash]}))).objects[0];else if(operation==='paste'){await call('scene.select',{ids:[car.hash]});await call('edit.copy');added=(await measure('Compact library clipboard Paste',2000,()=>call('edit.paste'))).objects[0];}else{const saved=await call('scene.export',{includeData:true});await page.route('**/stock-roundtrip.hash',route=>route.fulfill({status:200,body:Buffer.from(saved.base64,'base64')}));try{added=(await measure('Compact library HASH Merge',2000,()=>call('scene.merge',{url:'stock-roundtrip.hash'}))).objects[0];}finally{await page.unroute('**/stock-roundtrip.hash');}}const s=await state(),owners=s.objects.filter(n=>n.type==='car'),tags=owners.flatMap(n=>n.tags.filter(t=>t.librarySlot).map(t=>t.uid));check(operation+' gives each stock owner independent material slot identities',owners.length===2&&tags.length===2*car.tags.filter(t=>t.librarySlot).length&&tags.length===new Set(tags).size&&added.type==='car',{owners,tags});const saved=await call('scene.export',{includeData:true});await call('scene.open',{name:'copies.hash',base64:saved.base64});const round=await state();check(operation+' compact roundtrip preserves both owners and custom paint',round.objects.filter(n=>n.type==='car').length===2&&round.objects.filter(n=>n.type==='car').every(n=>n.tags.filter(t=>t.librarySlot).length===car.tags.filter(t=>t.librarySlot).length)&&round.materials.filter(m=>/paint/i.test(m.name)).every(m=>m.h===130&&m.rough===12),round);await checkCopyPaint(call,check,operation,car.hash,added.hash);await call('scene.delete',{ids:[added.hash]});}
 const source=await call('scene.export',{includeData:true}),beforeInvalid=await state();for(const unknown of [false,true]){const bad=await page.evaluate(async({base64,id,unknown})=>{const H=FrameHash,file=new Blob([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))]),chunks=[];for(const [key,row]of await H.index(file)){let value=await H.read(file,row);if(key===H.address(id,'parameters')){const a=value;if(unknown)a.library.slots[0].materialUID='f'.repeat(32);else a.library.slots[0].uid='invalid';value=a;}chunks.push((await H.pack({id:key,type:row.type,value})).blob);}const bytes=new Uint8Array(await new Blob(chunks).arrayBuffer());return btoa(String.fromCharCode(...bytes));},{base64:source.base64,id:car.hash,unknown});let rejected=false;try{await call('scene.open',{name:'invalid-stock.hash',base64:bad});}catch(e){rejected=/Invalid library slots|Unknown library slot material/.test(e.message);}const after=await state();check('Invalid stock '+(unknown?'material reference':'slot identity')+' rejects before mutation',rejected&&JSON.stringify(after.objects)===JSON.stringify(beforeInvalid.objects)&&JSON.stringify(after.materials)===JSON.stringify(beforeInvalid.materials));}
 const legacyFile=await readFile(new URL('./scenes/stock-sedan.hash',import.meta.url));
 await call('scene.open',{name:'stock-sedan.hash',base64:legacyFile.toString('base64')});
 const legacy=(await state()).objects.find(n=>n.type==='car'),oldGeometry=await call('diagnostics.mesh',{id:legacy.hash,geometry:true});
 check('Existing sedan scenes retain their geometry, seven slots and selected paint',
   oldGeometry.positionsSHA256==='f0cb671564d76418e0225f7efd5abc3e5542aa04ebaf82a901fb236e025e7973'&&
   oldGeometry.indicesSHA256==='f303cdee8b2badf4e994a2070f031227e7156ddea963029ddd4a53204b4fddc1'&&
   legacy.tags.filter(t=>t.librarySlot).length===7&&legacy.params['color preset']==='violet',{oldGeometry,params:legacy.params});
 await call('scene.update',{id:legacy.hash,params:{'color preset':'blue'}});
 const legacySaved=await call('scene.export',{includeData:true});
 await call('scene.open',{name:'resaved-sedan.hash',base64:legacySaved.base64});
 const reopened=await state(),legacyPaint=reopened.materials.find(m=>m.name==='Red paint');
 check('A resaved sedan retains its own blue preset and topology',reopened.objects.find(n=>n.hash===legacy.hash).mesh.triangles===754&&legacyPaint.h===217&&legacyPaint.s===40&&legacyPaint.l===42);
 await call('scene.open',{name:'empty.hash',base64:empty.base64});return {pass:true,checks,timings};}catch(e){return {pass:false,checks,timings,error:e.stack};}}
if(process.argv[1]===fileURLToPath(import.meta.url)){const s=await launch(),errors=[];try{await ready(s.page);s.page.on('pageerror',e=>errors.push(e.stack));s.page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await s.page.evaluate(()=>{window.__stockGPU=[];frameEngine.renderer.device.addEventListener('uncapturederror',e=>__stockGPU.push(e.error.message));frameEngine.renderer.device.pushErrorScope('validation');});const r=await october24StockChecks(s.page);r.errors=errors;r.gpu=await s.page.evaluate(async()=>({validation:(await frameEngine.renderer.device.popErrorScope())?.message||null,uncaptured:__stockGPU}));r.pass&&=!errors.length&&!r.gpu.validation&&!r.gpu.uncaptured.length;r.indexSHA256=createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex');await writeFile(new URL('./results/october24-stock.json',import.meta.url),JSON.stringify(r,null,2));console.log(JSON.stringify({pass:r.pass,checks:r.checks.length,last:r.checks.at(-1),error:r.error,errors,gpu:r.gpu},null,2));process.exitCode=r.pass?0:1;}finally{await s.close();}}
