// Prepared, not executed. Call only with two ordinary polygon owner hashes in an isolated test page.
// The caller owns hardware verification, page lifecycle and GPU validation scopes.
import assert from 'node:assert/strict';
export async function tagFieldBrowserChecks(page,ids){
 assert.equal(ids.length,2,'Provide two polygon owners from an isolated native scene');
 const checks=[],timings=[],call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]);
 const check=(name,pass)=>{assert.ok(pass,name);checks.push(name);};
 const timed=async(name,fn)=>{const t=performance.now(),v=await fn(),ms=performance.now()-t;timings.push({name,ms,limit:1500});check(name+' latency',ms<1500);return v;};
 const inspect=async()=>(await call('scene.inspect')).objects,read=async()=>(await call('tag.read',{ids,kind:'magneto'})).objects;
 // HASH adds materialUID and may reorder properties; compare stable native material identity, not raw serialization.
 const materialTags=(n,materials)=>n.tags.filter(t=>t.kind==='material').map(t=>{const resolved=materials[t.material||0]?.uid;assert.ok(resolved,'Material index resolves to a native UID');if(t.materialUID)assert.equal(t.materialUID,resolved,'Persisted UID and current material index agree');return {uid:t.uid,kind:t.kind,materialUID:resolved,mask:t.mask??null,params:t.params};});
 const initial=await call('scene.inspect'),before=initial.objects.filter(n=>ids.includes(n.hash)),appearance=before.map(n=>({hash:n.hash,tags:materialTags(n,initial.materials)}));
 check('ordinary polygon owners',before.length===2&&before.every(n=>n.type==='mesh'));
 const options=(await call('tag.list')).find(t=>t.kind==='magneto')?.fields?.Material;
 check('declared six choices',options?.length===6);
 await timed('multi-owner tag defaults',()=>call('tag.set',{ids,kind:'magneto',enabled:true}));
 let rows=await read();check('default Material',rows.every(n=>n.tags[0].params.Material===options[0]));const uids=rows.map(n=>n.tags[0].uid);
 await timed('multi-owner native parameter edit',()=>call('tag.set',{ids,kind:'magneto',enabled:true,params:{Material:options[4]}}));
 rows=await read();check('stable native identities',rows.every((n,i)=>n.tags[0].uid===uids[i]&&n.tags[0].params.Material===options[4]));
 await call('edit.history',{action:'undo'});check('one Undo restores both values',(await read()).every(n=>n.tags[0].params.Material===options[0]));await call('edit.history',{action:'redo'});
 for(const args of [{params:{Material:'not a preset'}},{params:{Material:3}},{params:{Unexpected:true}},{enabled:false,params:{}}]){const snapshot=JSON.stringify(await read());let rejected=false;try{await call('tag.set',{ids,kind:'magneto',enabled:true,...args});}catch{rejected=true;}check('invalid edit rejects before mutation '+JSON.stringify(args),rejected&&JSON.stringify(await read())===snapshot);}
 const target=(await inspect()).find(n=>n.hash===ids[0]);await page.locator('#tabObjects').click();await page.locator(`[data-id="${target.id}"] .ob-tag.magneto`).click();await page.locator('#tabAttributes').click();
 check('Material is the sole native tag row',JSON.stringify(await page.locator('#attrContent .attr-lab').allTextContents())===JSON.stringify(['Material']));
 const field=page.locator('#attrContent [data-field="Material"][data-cycle]');await timed('native tag choice ArrowRight',async()=>{await field.press('ArrowRight');await call('scene.inspect');});
 check('native choice ArrowRight updates exact tag',(await read())[0].tags[0].params.Material===options[5]);
 await call('edit.history',{action:'undo'});check('native choice Undo',(await read())[0].tags[0].params.Material===options[4]);
 await field.press('ArrowRight');await call('scene.inspect');check('native choice keyboard',(await read())[0].tags[0].params.Material===options[5]);await call('edit.history',{action:'undo'});
 const path='tag:'+uids[0]+':Material';await call('animation.key',{id:ids[0],path,frame:0,value:0});await call('animation.key',{id:ids[0],path,frame:10,value:5});await call('animation.seek',{frame:10});check('native discrete animation',(await read())[0].tags[0].params.Material===options[5]);
 const saved=await read(),data=await call('scene.export',{includeData:true});await call('scene.open',{name:'plugin-tag-fields.hash',base64:data.base64});
 const after=await read();check('HASH stable identities and values',after.every((n,i)=>JSON.stringify(n.tags)===JSON.stringify(saved[i].tags)));
 const final=await call('scene.inspect');const appearanceAfter=appearance.map(a=>({hash:a.hash,tags:materialTags(final.objects.find(n=>n.hash===a.hash),final.materials)}));check('Frame Material identity and values remain untouched '+JSON.stringify({before:appearance,after:appearanceAfter}),JSON.stringify(appearanceAfter)===JSON.stringify(appearance));
 return {pass:true,checks,timings,scope:'Focused native tag field regression only; caller must qualify hardware and GPU errors.'};
}
