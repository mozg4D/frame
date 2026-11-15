import assert from 'node:assert/strict';
import {launch,ready} from '../tools/browser.mjs';
import {H} from './hash-codec-fixture.mjs';

const session=await launch({headless:true}),page=session.page,errors=[];
page.on('pageerror',e=>errors.push(e.message));
const call=(name,args={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[name,args]);
const checks=[],check=(name,pass)=>{assert(pass,name);checks.push(name);console.log('PASS',name);};
try{
 await ready(page);await call('scene.new');
 const a=await call('scene.create',{type:'group',name:'First'}),b=await call('scene.create',{type:'group',name:'Second'}),unused=await call('material.create',{name:'Unassigned'}),shared=await call('material.create',{name:'Shared'}),privateMaterial=await call('material.create',{name:'Private'});
 await call('material.assign',{id:a.hash,material:shared.uid});await call('material.assign',{id:b.hash,material:shared.uid});
 const child=await call('scene.create',{type:'group',name:'Child',parent:a.hash});await call('material.assign',{id:child.hash,material:privateMaterial.uid});
 await call('scene.delete',{ids:[a.hash]});
 const library=()=>page.evaluate(()=>materials.map(m=>({uid:m.uid,name:m.name}))),has=async uid=>(await library()).some(m=>m.uid===uid);
 check('Deleting a hierarchy removes its unused material',!await has(privateMaterial.uid));check('Shared and unassigned palette materials survive',await has(shared.uid)&&await has(unused.uid));
 await call('edit.history',{action:'undo'});check('Undo restores deleted objects, materials and bindings',await has(privateMaterial.uid)&&await page.evaluate(([hash,uid])=>nodes.some(n=>n.nativeHash===hash&&n.tags.some(t=>t.kind==='material'&&materials[t.material]?.uid===uid)),[child.hash,privateMaterial.uid]));
 await call('edit.history',{action:'redo'});check('Redo removes the same material again',!await has(privateMaterial.uid));
 await call('scene.delete',{ids:[b.hash]});check('Deleting the last shared owner removes its material',!await has(shared.uid));
 await call('edit.history',{action:'undo'});check('Undo restores the last shared owner and material',await has(shared.uid));
 check('Every UI Undo and Redo entry is a HASH binary record',await page.evaluate(()=>[...undoStack,...redoStack].every(s=>s instanceof Uint8Array&&FrameHash.openSnapshot(s).nodes)&&frameUIUndoBytes()>=undoStack.reduce((n,s)=>n+s.byteLength,0)));
 const doc=await call('docs.get');await call('docs.create',{text:'Native HASH документация 😀',version:doc.version});
 const author=await call('authorData.get',{owner:'scene'}),record={id:'1'.repeat(32),revision:0,name:'Source',kind:'source',refs:[],payload:{language:'text',text:'\ufeffinert 😀'}};
 await call('authorData.replace',{owner:'scene',expected:{epoch:author.epoch,revision:author.data.revision},records:[record]});
 const saved=await call('scene.export',{includeData:true}),blob=new Blob([Buffer.from(saved.base64,'base64')]),input=H.reader(blob),index=await input.index();
 check('Saved scene metadata is a binary HASH value',index.get(H.K.parameters)?.type===H.T.value);for(const id of (await input.read(index.get(H.K.all)))){const r=index.get(H.address(id,'parameters'));if(r)assert.equal(r.type,H.T.value);}
 await call('scene.open',{name:'native.hash',base64:saved.base64});check('HASH round trip retains documentation, author data and shared material',(await call('docs.get')).text==='Native HASH документация 😀'&&(await call('authorData.get',{owner:'scene'})).data.records[0].payload.text===record.payload.text&&await has(shared.uid));
 for(const storage of ['auto','texture']){
  await call('scene.new');const mesh=await call('mesh.create',{name:'Triangles',storage,vertices:[0,0,0,10,0,0,0,10,0,10,10,0],indices:[0,1,2,1,3,2]});
  await call('view.set',{mode:'polygon'});await call('scene.select',{ids:[mesh.hash],mode:'polygon',components:[0]});
  await call('mesh.edit',{id:mesh.hash,op:'delete',mode:'polygon',faces:[0]});await call('edit.history',{action:'undo'});
  check(storage+' topology Undo restores triangles',(await call('scene.inspect')).objects.find(n=>n.id===mesh.id)?.mesh.triangles===2);
  await call('edit.history',{action:'redo'});check(storage+' topology Redo restores deletion',(await call('scene.inspect')).objects.find(n=>n.id===mesh.id)?.mesh.triangles===1);
 }
 await call('scene.open',{url:session.url+'/tests/scenes/component-square.hash'});check('Existing HASH assets remain readable',(await call('scene.inspect')).objects.length>0);
 await call('scene.new');const atomic=await call('plugins.create',{plugin:'atomic'}),command=(operation,args={})=>call('plugins.command',{id:atomic.hash,operation,args});
 await command('create-molecule',{name:'water'});check('Atomic uses native binary authoring records',(await command('inspect')).total===3);
 await call('scene.delete',{ids:[atomic.hash]});await call('edit.history',{action:'undo'});check('Binary Undo retains Atomic record leases after owner deletion',(await command('inspect')).total===3);
 const atoms=await call('scene.export',{includeData:true});await call('scene.open',{name:'atoms.hash',base64:atoms.base64});check('Atomic binary HASH round trip preserves atoms',(await command('inspect')).total===3);
 await call('scene.new');const circuit=await call('plugins.create',{plugin:'circuit'}),circuitSaved=await call('scene.export',{includeData:true}),circuitInput=H.reader(new Blob([Buffer.from(circuitSaved.base64,'base64')])),circuitIndex=await circuitInput.index(),legacy=[];
 const field='c17c0170000000000000000000000001';
 for(const record of circuitIndex.values()){let type=record.type,value=await circuitInput.read(record);if(record.id===H.address(circuit.hash,'parameters'))value.pluginRecords.find(r=>r.key===field).type=H.T.text;if(record.id===H.address(circuit.hash,field)){type=H.T.text;value=JSON.stringify(H.values.decode(value));}legacy.push({id:record.id,type,value});}
 const legacyBlob=new Blob((await Promise.all(legacy.map(r=>H.pack(r)))).map(r=>r.blob));await call('scene.open',{name:'legacy-circuit.hash',base64:Buffer.from(await legacyBlob.arrayBuffer()).toString('base64')});
 check('Declared legacy plugin text is normalized to binary at import',await page.evaluate(([hash,key])=>nodes.find(n=>n.nativeHash===hash).pluginRecords[key].type===0,[circuit.hash,field]));
 assert.deepEqual(errors,[]);console.log({pass:true,checks:checks.length});
}finally{await session.close();}
