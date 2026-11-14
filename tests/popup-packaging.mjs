// Small native smoke: embedded windows, text persistence, resource URLs and offline shell.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {launch,ready} from '../tools/browser.mjs';
const paths=['index.html','frame-sw.js','manifest.webmanifest','tests/popup-packaging.mjs'],hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async path=>[path,createHash('sha256').update(await readFile(new URL('../'+path,import.meta.url))).digest('hex')])));
const report={pass:false,sources:await hashes(),checks:[],errors:[],requests:[],timings:[]};
const check=(name,pass,detail)=>{report.checks.push({name,pass:!!pass,detail});assert.ok(pass,name+': '+JSON.stringify(detail));};
const session=await launch({headless:true}),page=session.page,context=session.context;
context.on('page',p=>p.on('pageerror',e=>report.errors.push(e.message)));page.on('pageerror',e=>report.errors.push(e.message));
context.on('request',r=>{const url=new URL(r.url());if(url.protocol==='http:')report.requests.push(url.pathname);});
const call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]);
const doc=async()=>{const start=performance.now(),pending=page.waitForEvent('popup');await page.locator('#btnDocs').click();const p=await pending;await p.locator('textarea').waitFor();await p.waitForFunction(()=>!document.querySelector('textarea').disabled);report.timings.push({name:'Open embedded Doc',ms:performance.now()-start,budget:3000});return p;};
const text=async value=>{await page.waitForFunction(value=>frameDocumentation.get().text===value,value);};
try{
 await ready(page);await page.evaluate(()=>navigator.serviceWorker.ready.then(()=>true));await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 await call('scene.create',{type:'cube'});let popup=await doc();check('Doc uses a same-origin generated document',popup.url().startsWith('blob:')&&new URL(popup.url()).origin===new URL(page.url()).origin,popup.url());
 await popup.locator('textarea').pressSequentially('word');await popup.keyboard.press('Enter');await text('word\n');await popup.keyboard.press('Control+z');await text('word');await popup.keyboard.press('Control+y');await text('word\n');check('Embedded Doc preserves native input and local Undo/Redo',await popup.locator('textarea').inputValue()==='word\n');
 const saved=await call('scene.export',{includeData:true});await call('scene.new');await popup.waitForFunction(()=>document.querySelector('textarea').value==='');await call('scene.open',{name:'embedded.hash',base64:saved.base64});await popup.waitForFunction(()=>document.querySelector('textarea').value==='word\n');check('Doc text round-trips through native HASH and New',true);
 await popup.reload();await popup.waitForFunction(()=>{const a=document.querySelector('textarea');return a&&!a.disabled&&a.value==='word\n';});check('Generated Doc survives reload and reconnects',true);
 await popup.close();popup=await doc();check('Closing and reopening Doc restores text and records bounds',await popup.locator('textarea').inputValue()==='word\n'&&await page.evaluate(()=>!!localStorage.getItem('frame-docs-window-v1')));await popup.close();
 const pending=page.waitForEvent('popup'),opened=await call('view.window',{index:0,action:'open'}),view=await pending;await view.locator('canvas').waitFor();check('Generated viewport shares the scene and opens a canvas',view.url().startsWith('blob:')&&opened.views.some(v=>v.index===opened.opened&&v.separate),{url:view.url(),index:opened.opened});await call('view.window',{index:opened.opened,action:'close'});check('Closing generated viewport releases its view',!(await call('view.windows')).views.some(v=>v.index===opened.opened));
 const manifest=await page.evaluate(()=>fetch('manifest.webmanifest').then(r=>r.json()));for(const asset of ['frame-icon.svg','frame-icon-192.png','frame-icon-512.png','frame-hash-256.png','frame.ico'])check('Renamed icon exists: '+asset,(await context.request.get(session.url+'/'+asset)).ok());check('Manifest references unversioned icon names',!JSON.stringify(manifest).includes('-v4'));
 await context.setOffline(true);await page.reload();await ready(page);popup=await doc();check('Embedded Doc opens from the offline index cache',await popup.locator('textarea').isEditable());await popup.close();await context.setOffline(false);
 check('No obsolete popup/module/icon resource requests',!report.requests.some(path=>path.includes('/core/')||/\/(?:documentation|viewport)\.html$/.test(path)||path.includes('-v4')),report.requests);
 check('No JavaScript errors',report.errors.length===0,report.errors);check('Completed popup openings meet latency budgets',report.timings.every(t=>t.ms<t.budget),report.timings);report.pass=true;
}catch(error){report.error=error.stack;process.exitCode=1;}finally{await session.close();report.sourcesAfter=await hashes();if(JSON.stringify(report.sources)!==JSON.stringify(report.sourcesAfter)){report.pass=false;report.error='Source changed during smoke';process.exitCode=1;}await mkdir(new URL('./results/',import.meta.url),{recursive:true});await writeFile(new URL('./results/popup-packaging.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
