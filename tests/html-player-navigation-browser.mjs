import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {launch,ready} from '../tools/browser.mjs';

const session=await launch({headless:true}),dir=await mkdtemp(join(tmpdir(),'frame-navigation-'));
try{
 const editor=session.page;await ready(editor);
 await editor.evaluate(async()=>{const mesh=await frameAI.call('scene.create',{type:'cube'});
  await frameAI.call('view.set',{index:0,single:true,shading:'solid',focus:mesh.hash});});
 const exported=await editor.evaluate(()=>frameAI.call('scene.export',{format:'html',includeData:true}));
 const path=join(dir,'player.html');await writeFile(path,Buffer.from(exported.base64,'base64'));
 const player=await session.context.newPage(),errors=[];player.on('pageerror',e=>errors.push(e.message));
 await player.goto(pathToFileURL(path).href);await ready(player);
 const canvas=player.locator('#frame-engine-canvas'),box=await canvas.boundingBox(),x=box.x+box.width*.48,y=box.y+box.height*.48;
 const camera=()=>player.evaluate(()=>Array.from(frameEngine.viewCamera(0).camera)),changed=(a,b)=>a.some((n,i)=>Math.abs(n-b[i])>1e-6);
 const waitChange=async old=>{await player.waitForFunction(a=>frameEngine.viewCamera(0).camera.some((n,i)=>Math.abs(n-a[i])>1e-6),old,{timeout:2500});return camera();};
 const drag=async button=>{await player.mouse.move(x,y);await player.mouse.down({button});await player.mouse.move(x+72,y+39,{steps:5});await player.mouse.up({button});};
 const start=performance.now();let before=await camera();
 for(const button of ['left','middle','right']){await drag(button);const after=await waitChange(before);assert.ok(changed(before,after),button);before=after;}
 await player.mouse.move(x,y);await player.mouse.wheel(0,-160);before=await waitChange(before);
 await canvas.click({position:{x:box.width*.5,y:box.height*.5}});assert.equal(await player.evaluate(()=>selected.size),0,'Taps do not select scene owners');
 // A mounted panel receives its own input. Its viewport listener can consume individual gestures.
 await player.evaluate(()=>{window.removeTestControls=frameControl.register(({root,document})=>{
  const input=document.createElement('button');input.textContent='Control';root.append(input);
  input.onclick=()=>input.dataset.pressed='yes';
  const claimed=e=>e.preventDefault();for(const type of ['wheel','pointerdown'])document.addEventListener(type,claimed,{passive:false});
  return ()=>{for(const type of ['wheel','pointerdown'])document.removeEventListener(type,claimed);};
 });});
 await player.getByRole('button',{name:'Control',exact:true}).click();
 assert.equal(await player.getByRole('button',{name:'Control',exact:true}).getAttribute('data-pressed'),'yes');
 before=await camera();await drag('left');await player.mouse.move(x,y);await player.mouse.wheel(0,170);
 await player.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.deepEqual(await camera(),before,'Scene Control claimed the pointer and wheel');
 await player.evaluate(()=>window.removeTestControls());await drag('left');before=await waitChange(before);
 await player.evaluate(()=>{window.releaseNavigation=frameControl.register(()=>{}, {defaultNavigation:false});});
 await drag('right');await player.mouse.wheel(0,180);assert.deepEqual(await camera(),before,'Replacement controller owns the viewport without cancelling DOM events');
 await player.evaluate(()=>window.releaseNavigation());await drag('left');before=await waitChange(before);
 const cdp=await session.context.newCDPSession(player);
 const touch=(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([id,x,y])=>({id,x,y}))});
 await touch('touchStart',[[0,x,y]]);await touch('touchMove',[[0,x+60,y+30]]);await touch('touchEnd',[]);before=await waitChange(before);
 await touch('touchStart',[[0,x-40,y],[1,x+40,y]]);await touch('touchMove',[[0,x-75,y+8],[1,x+75,y+8]]);await touch('touchEnd',[]);await waitChange(before);
 assert.deepEqual(errors,[]);assert.ok(performance.now()-start<10000);console.log('PASS saved offline HTML: orbit, pan, drag/wheel zoom, touch orbit/pinch, custom controls and no editor selection');
}finally{await session.close();await rm(dir,{recursive:true,force:true});}
