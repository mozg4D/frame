import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {launch,ready} from '../tools/browser.mjs';

const report={pass:false,checks:[],timings:[],errors:[]};
const session=await launch({headless:true}),{page}=session;
const call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]);
const check=(name,pass,detail)=>{report.checks.push({name,pass:!!pass,detail});console.log((pass?'PASS ':'FAIL ')+name);assert.ok(pass,name+': '+JSON.stringify(detail));};
const timed=async(name,action)=>{const start=performance.now();await action();await call('scene.inspect');const ms=performance.now()-start;report.timings.push({name,ms,budget:1500});check(name+' completes within 1.5 s',ms<1500,{ms});};
try{
 await ready(page);page.on('pageerror',e=>report.errors.push(e.message));
 report.adapter=await page.evaluate(()=>({vendor:frameEngine.renderer.device.adapterInfo.vendor,description:frameEngine.renderer.device.adapterInfo.description,dpr:devicePixelRatio}));
 assert.ok(!/swiftshader|llvmpipe|software/i.test(report.adapter.description),'Hardware WebGPU required');assert.equal(report.adapter.dpr,1);
 await page.evaluate(()=>{window.__choiceGPU=[];frameEngine.renderer.device.addEventListener('uncapturederror',e=>__choiceGPU.push(e.error.message));frameEngine.renderer.device.pushErrorScope('validation');window.__choiceWheels=0;document.addEventListener('wheel',()=>__choiceWheels++,true);});
 await call('scene.new');
 const choices=(await call('app.describe')).objects.nut.parameters.type;
 const nut=await call('scene.create',{type:'nut',params:{type:choices[1]}});await page.locator('#tabAttributes').click();
 const button=page.locator('#attrContent [data-cycle][data-field="type"]'),label=button.locator('xpath=../..').locator('.attr-lab');
 const value=async()=>(await call('scene.inspect')).objects.find(o=>o.hash===nut.hash).params.type;
 const expect=async(name,index)=>{const actual=await value();check(name,actual===choices[index],{expected:choices[index],actual});check(name+' refreshes the displayed choice',await button.textContent()===choices[index]);};
 const history=async(action,index,name)=>{await call('edit.history',{action});await expect(name,index);};
 const wheel=async(target,delta)=>{await target.hover();const count=await page.evaluate(()=>__choiceWheels);await page.mouse.wheel(0,delta);await page.waitForFunction(n=>__choiceWheels>n,count,{timeout:1000});};
 const drag=async(target,dx,dy)=>{const b=await target.boundingBox(),x=b.x+b.width/2,y=b.y+b.height/2;await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:4});await page.mouse.up();};
 const viewBefore=(await call('scene.inspect')).view.camera;
 await timed('Wheel over choice label',()=>wheel(label,-120));await expect('Label wheel advances one choice',2);
 await history('undo',1,'Label wheel is one Undo');await history('redo',2,'Label wheel supports Redo');await history('undo',1,'Wheel baseline restored');
 await timed('Reverse wheel over choice label',()=>wheel(label,120));await expect('Reverse label wheel selects the preceding choice',0);await history('undo',1,'Reverse label wheel is one Undo');
 await timed('Diagonal drag over choice label',()=>drag(label,9,-9));await expect('Label drag advances three notches',4);await history('undo',1,'Label drag is one Undo');await history('redo',4,'Label drag supports Redo');await history('undo',1,'Drag baseline restored');
 await timed('Reverse drag over choice label',()=>drag(label,-3,3));await expect('Reverse label drag selects the preceding choice',0);await history('undo',1,'Reverse label drag is one Undo');
 await timed('Wheel over choice value',()=>wheel(button,-120));await expect('Value wheel retains its behavior',2);await history('undo',1,'Value wheel is one Undo');
 await timed('Drag over choice value',()=>drag(button,3,-3));await expect('Value drag retains its behavior',2);await history('undo',1,'Value drag is one Undo');
 await label.click();await button.focus();await button.press('ArrowUp');await expect('Arrow key still advances the choice',2);await history('undo',1,'Plain label click creates no extra history');
 check('Choice gestures leave the viewport camera unchanged',JSON.stringify((await call('scene.inspect')).view.camera)===JSON.stringify(viewBefore));
 // Bolt fields rebuild their dependent catalogue at gesture completion.
 await call('scene.new');const bolt=await call('scene.create',{type:'bolt'});
 const size=page.locator('#attrContent [data-cycle][data-field="size"]'),sizeLabel=size.locator('xpath=../..').locator('.attr-lab');
 const before=(await call('scene.inspect')).objects.find(o=>o.hash===bolt.hash).params;
 await timed('Wheel over a dependent choice label',()=>wheel(sizeLabel,-120));
 const after=(await call('scene.inspect')).objects.find(o=>o.hash===bolt.hash).params;
 check('Dependent catalogue updates its size and length controls',after.size!==before.size&&(await size.textContent())===after.size&&(await page.locator('#attrContent [data-cycle][data-field="length"]').textContent())===after.length+' mm',{before,after});
 await call('edit.history',{action:'undo'});const restored=(await call('scene.inspect')).objects.find(o=>o.hash===bolt.hash).params;
 check('Dependent choice and length restore together in one Undo',JSON.stringify(restored)===JSON.stringify(before),{before,restored});
 report.gpu=await page.evaluate(async()=>({validation:(await frameEngine.renderer.device.popErrorScope())?.message||null,uncaptured:__choiceGPU}));
 check('Focused native input has no page or GPU errors',!report.errors.length&&!report.gpu.validation&&!report.gpu.uncaptured.length,{errors:report.errors,gpu:report.gpu});
 report.pass=true;
}catch(error){report.error=error.stack;console.error(error.stack);}finally{
 report.indexSHA256=createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex');
 await mkdir(new URL('./results/',import.meta.url),{recursive:true});await writeFile(new URL('./results/attributes-choice-browser.json',import.meta.url),JSON.stringify(report,null,2));await session.close();
}
console.log(JSON.stringify({pass:report.pass,checks:report.checks.length,adapter:report.adapter,timings:report.timings,error:report.error},null,2));process.exitCode=report.pass?0:1;
