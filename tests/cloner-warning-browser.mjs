import assert from 'node:assert/strict';
import {launch,ready} from '../tools/browser.mjs';
const session=await launch({headless:true}),{page}=session;
const call=(n,a={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[n,a]);
try{
 await ready(page);await call('scene.new');
 const source=await call('mesh.create',{name:'Warning source',vertices:[0,0,0,20,0,0,0,20,0],indices:[0,1,2]});
 const owner=await call('scene.create',{type:'cloner',name:'Warning target',inputs:[source.hash],params:{type:'matrix','count x':1,'count y':1,'count z':1}});
 await call('scene.select',{ids:[owner.hash]});await page.locator('#tabAttributes').click();
 const field=page.locator('#attrContent input[data-field="count x"]'),dialog=page.locator('#dialog');
 const actual=()=>page.evaluate(id=>frameNodeByHash(id).params['count x'],owner.hash);
 const estimate=want=>page.evaluate(want=>{window.qaRealEstimate??=frameEngine.clonerPlacementCount;frameEngine.clonerPlacementCount=()=>BigInt(want);},want);
 const type=async n=>{await field.fill(String(n));await field.press('Enter');};
 const expectCount=n=>page.waitForFunction(({id,n})=>frameNodeByHash(id).params['count x']===n,{id:owner.hash,n},{timeout:4000});
 const hidden=()=>dialog.waitFor({state:'hidden',timeout:4000});
 for(const [synthetic,n] of [['150000',2],['10000000',3]]){
  await estimate(synthetic);await type(n);await expectCount(n);assert.equal(await dialog.isVisible(),false);
 }
 await estimate('10000001');
 await field.fill('4');
 assert.equal(await actual(),3,'Uncommitted text does not allocate or touch parameters');
 assert.equal(await dialog.isVisible(),false);
 await field.press('Enter');await dialog.waitFor({state:'visible'});
 assert.equal(await page.locator('#dialogTitle').textContent(),'Large Cloner');
 assert.match(await page.locator('#dialogBody').textContent(),/10,000,001 copies/);
 assert.equal(await actual(),3);
 await page.locator('#dialogCancel').click();await hidden();assert.equal(await actual(),3);
 await type(5);await dialog.waitFor({state:'visible'});await page.keyboard.press('Escape');await hidden();assert.equal(await actual(),3);
 await type(6);await dialog.waitFor({state:'visible'});await page.locator('#dialogOK').click();await hidden();await expectCount(6);
 const d=await call('diagnostics.replicas',{id:owner.hash,limit:0});assert.equal(d.count,6);
 await page.evaluate(()=>{frameEngine.clonerPlacementCount=qaRealEstimate;});
 console.log('Native Cloner UI: mocked count estimator only, actual 2/3/6 allocations, no prompt through 10,000,000, No/Escape do not alter committed result, Yes commits exactly once.');
}finally{await session.close();}
