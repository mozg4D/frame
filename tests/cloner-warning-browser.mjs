import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {launch,ready} from '../tools/browser.mjs';
const session=await launch({headless:true}),{page}=session;
const call=(name,args={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[name,args]);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 const sourceText=await readFile(new URL('../index.html',import.meta.url),'utf8');
 const marker='    function estimateClonerPlacementCount(hash,changes={}){';
 assert.equal(sourceText.split(marker).length,2);
 await page.route('**/index.html',r=>r.fulfill({contentType:'text/html',body:sourceText.replace(marker,marker+
  'if(globalThis.qaClonerSyntheticEstimate!==undefined&&Object.hasOwn(changes,"count x"))return BigInt(globalThis.qaClonerSyntheticEstimate);')}));
 await page.goto(session.url+'/index.html');await ready(page);await call('scene.new');
 const source=await call('mesh.create',{name:'Quiet numeric source',vertices:[0,0,0,20,0,0,0,20,0],indices:[0,1,2]});
 const owner=await call('scene.create',{type:'cloner',name:'Quiet numeric target',inputs:[source.hash],params:{type:'matrix','count x':1,'count y':1,'count z':1}});
 await call('scene.select',{ids:[owner.hash]});await page.locator('#tabAttributes').click();
 const field=page.locator('#attrContent input[data-field="count x"]'),dialog=page.locator('#dialog');
 const state=()=>page.evaluate(id=>({value:frameNodeByHash(id).params['count x'],undo:undoStack.length,
  eventCount:qaCountModalEvents}),owner.hash);
 const count=async()=> (await call('diagnostics.replicas',{id:owner.hash,limit:0})).count;
 const estimate=want=>page.evaluate(want=>{if(want===null)delete globalThis.qaClonerSyntheticEstimate;else window.qaClonerSyntheticEstimate=want;},want);
 const type=async n=>{await field.fill(String(n));await field.press('Enter');};
 await page.evaluate(()=>{
  window.qaCountModalEvents=0;
  const dialog=document.getElementById('dialog');
  new MutationObserver(list=>{if(dialog.open||list.some(item=>item.oldValue!==null))window.qaCountModalEvents++;})
    .observe(dialog,{attributes:true,attributeOldValue:true,attributeFilter:['open']});
 });
 for(const [synthetic,n] of [['150000',2],['10000000',3],['10000001',4]]){
  const prior=await state();
  await estimate(synthetic);await field.fill(String(n));
  assert.deepEqual(await state(),prior,'Numeric text commits only on finish');
  await field.press('Enter');
  assert.equal(await count(),n,'Only real small geometry allocates despite the synthetic estimate');
  assert.deepEqual(await state(),{value:n,undo:prior.undo+1,eventCount:0},'Feasible numeric commit happens once with no capacity modal');
  assert.equal(await dialog.isVisible(),false);
 }
 const prior=await state();
 await estimate('4294967296');await type(5);
 assert.equal(await count(),4);assert.equal(await field.inputValue(),'4');
 assert.deepEqual(await state(),prior,'Actual safety guard leaves prior authored value, copies and Undo unchanged');
 assert.equal(await dialog.isVisible(),false);
 await estimate(null);await type(5);
 assert.equal(await count(),5);
 assert.deepEqual(await state(),{value:5,undo:prior.undo+1,eventCount:0},'A normal edit immediately recovers');
 assert.equal(await dialog.isVisible(),false);assert.deepEqual(errors,[]);
 console.log('Quiet native Cloner numbers: feasible estimates below/at/above old 10M commit once; actual representability refusal retains the committed field, Undo and instances without a dialog; recovery passes.');
}finally{await session.close();}
