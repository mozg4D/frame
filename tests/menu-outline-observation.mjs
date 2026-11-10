// Real browser DOM regression; never loads Frame, requests WebGPU or edits a user page.
// The caller coordinates the outer FrameLabGpuTests mutex; do not acquire it twice.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {readMenuOutline} from './october25-polygons.mjs';

export async function menuOutlineObservationChecks(browser,html=null){
 html??=await readFile(new URL('../index.html',import.meta.url),'utf8');
 const styles=[...html.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/gi)].map(m=>m[1]);
 assert.ok(styles.length,'Use the actual application CSS in the isolated fixture');
 const checks=[],timings=[],context=await browser.newContext({viewport:{width:800,height:600},deviceScaleFactor:Number(process.env.FRAME_DPR||1)});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});assert.ok(pass,name+': '+JSON.stringify(detail));};
 const accepts=s=>s.present&&s.isConnected&&s.stillFirstMenuButton&&s.outlineStyle==='none';
 const bodyState=()=>page.evaluate(()=>({html:document.body.innerHTML,active:document.activeElement?.id,scroll:[scrollX,scrollY]}));
 const observe=async name=>{
  let calls=0;const before=await bodyState(),started=performance.now();
  // The actual exported helper must use exactly one evaluate; any locator or wait
  // would be absent from this adapter and fail rather than silently auto-wait.
  const result=await readMenuOutline({evaluate:(...args)=>{calls++;return page.evaluate(...args);}}),ms=performance.now()-started;
  const after=await bodyState();timings.push({name,ms,budgetMs:1000});
  assert.equal(calls,1,'One browser evaluation per completed observation');
  assert.deepEqual(after,before,'Observation leaves DOM, activeElement and scroll unchanged');
  check(name+' completes within observation budget',ms<1000,{ms,budgetMs:1000});
  return result;
 };
 let stale;
 try{
  await page.setContent('<!doctype html><html><head>'+styles.map(s=>'<style>'+s+'</style>').join('')+'</head><body><div id="menu" role="menu"><button id="initial" class="menu-item" role="menuitem">Initial</button></div></body></html>');
  await page.evaluate(()=>document.querySelector('#initial').focus());
  let result=await observe('Initial focused menu observation');
  check('Actual helper observes the connected focused current button with no outline',accepts(result)&&result.focus&&result.className==='menu-item'&&result.text==='Initial'&&typeof result.ownerDocumentURL==='string',result);

  stale=await page.locator('#menu button').first().elementHandle();
  await page.evaluate(()=>{
   const replacement=document.createElement('button');replacement.id='replacement';replacement.className='menu-item';replacement.setAttribute('role','menuitem');replacement.textContent='Replacement';
   document.querySelector('#menu').replaceChildren(replacement);replacement.focus();
  });
  const old=await stale.evaluate(e=>({isConnected:e.isConnected,outlineStyle:getComputedStyle(e).outlineStyle,stillFirst:e===document.querySelector('#menu button')}));
  check('Old ElementHandle negative control is detached with an empty computed outline',!old.isConnected&&!old.stillFirst&&old.outlineStyle==='',old);
  result=await observe('Replacement menu observation');
  check('Actual helper reads the replacement rather than a stale detached handle',accepts(result)&&result.focus&&result.text==='Replacement',result);

  await page.evaluate(()=>{document.querySelector('#replacement').style.outline='2px solid rgb(255, 0, 0)';});
  result=await observe('Solid outline observation');
  check('A real solid outline on the connected current button still fails the original expectation',result.present&&result.isConnected&&result.stillFirstMenuButton&&result.outlineStyle==='solid'&&!accepts(result),result);

  await page.evaluate(()=>document.querySelector('#menu').replaceChildren());
  result=await observe('Missing menu button observation');
  check('A missing button fails immediately without focus repair or selector auto-wait',!result.present&&!result.isConnected&&!result.stillFirstMenuButton&&result.outlineStyle===null&&!accepts(result),result);
  check('Fixture browser emitted no page errors',errors.length===0,errors);
  return {pass:true,checks,timings,DPR:Number(process.env.FRAME_DPR||1),indexSHA256:createHash('sha256').update(html).digest('hex'),scope:'Plain DOM fixture with actual application CSS and actual exported helper. No Frame startup, WebGPU qualification or historical-failure attribution.'};
 }catch(e){return {pass:false,checks,timings,error:e.stack||String(e),scope:'Plain DOM fixture only; no Frame startup or WebGPU qualification.'};}finally{await stale?.dispose();await context.close();}
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 let browser,report;try{
  browser=await chromium.launch({headless:process.argv.includes('--headless'),channel:'chromium',executablePath:process.env.FRAME_BROWSER||undefined});
  report=await menuOutlineObservationChecks(browser);
 }catch(e){report={pass:false,error:e.stack||String(e)};}finally{await browser?.close();}
 if(process.env.FRAME_MENU_OUTLINE_REPORT)await writeFile(process.env.FRAME_MENU_OUTLINE_REPORT,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));if(!report.pass)process.exitCode=1;
}
