import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {writeFile,mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {serve} from '../tools/browser.mjs';
export async function filePermissionActivationChecks({executablePath}={}){
 const start=performance.now(),server=await serve(),browser=await chromium.launch({headless:true,executablePath}),report={pass:false,browser:browser.version(),scope:'Fresh isolated browser profiles, untouched native file-picker API; no native chooser input or file writes',results:[],checks:[]};
 const check=(name,pass)=>{assert.ok(pass,name);report.checks.push(name);};
 try{
  for(const mode of ['none','synthetic','trusted','evaluate']){
   const context=await browser.newContext(),page=await context.newPage();
   try{
    await page.route(server.url+'/activation-probe',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Native activation probe</title><button id="pick">Save</button><script>window.result={};window.attempt=event=>{result.before={active:navigator.userActivation.isActive,ever:navigator.userActivation.hasBeenActive,trusted:event?.isTrusted??null,native:String(showSaveFilePicker)};try{const promise=showSaveFilePicker({suggestedName:"activation-probe.hash"});result.state="pending";promise.then(()=>result.state="resolved",e=>{result.state="rejected";result.error={name:e.name,message:e.message};});}catch(e){result.state="thrown";result.error={name:e.name,message:e.message};}};document.querySelector("button").onclick=attempt;<\/script>'}));await page.goto(server.url+'/activation-probe');const cdp=await context.newCDPSession(page);
    if(mode==='none')await cdp.send('Runtime.evaluate',{expression:'attempt()',userGesture:false});
    if(mode==='synthetic')await cdp.send('Runtime.evaluate',{expression:'document.querySelector("button").click()',userGesture:false});
    if(mode==='trusted')await page.locator('#pick').click();
    if(mode==='evaluate')await page.evaluate(()=>attempt());
    await new Promise(r=>setTimeout(r,250));const value=await cdp.send('Runtime.evaluate',{expression:'JSON.stringify(result)',returnByValue:true,userGesture:false});const result={mode,...JSON.parse(value.result.value)};report.results.push(result);
    check(mode+' leaves native picker API unchanged',result.before.native.includes('[native code]'));
    if(mode==='none'||mode==='synthetic')check(mode+' cannot manufacture user activation',!result.before.active&&result.error?.name==='SecurityError');
    else check(mode+' passes native browser activation gate',result.before.active&&['pending','rejected'].includes(result.state)&&result.error?.name!=='SecurityError');
    if(mode==='synthetic')check('Synthetic event remains untrusted',result.before.trusted===false);
    if(mode==='trusted')check('Browser input dispatches a trusted event',result.before.trusted===true);
   }finally{await context.close();}
  }
  report.elapsedMs=performance.now()-start;report.budgetMs=20000;check('Completed four native activation cases stay under 20 seconds',report.elapsedMs<report.budgetMs);report.pass=true;return report;
 }finally{await browser.close();await server.close();}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const report=await filePermissionActivationChecks({executablePath:process.env.FRAME_ACTIVATION_BROWSER});await mkdir(new URL('results/',import.meta.url),{recursive:true});await writeFile(new URL(process.env.FRAME_ACTIVATION_BROWSER?'./results/file-permission-activation-installed.json':'./results/file-permission-activation.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
