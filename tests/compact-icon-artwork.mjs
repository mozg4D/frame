import {testDprs} from './test-policy.mjs';
import {pluginIconAlignmentChecks} from './plugin-icon-alignment.mjs';
import {iconIds,iconRasterReferences,deriveIconRasterExpectation,iconRasterMutants,shiftRaster,rasterDifference,alphaDifference,rasterBounds,opticsIncomingComponent,opticsIncomingMutants,renderIconRasterVariants,decodeIconRasterVariants,iconRasterContractCPUChecks} from './icon-raster-contract.mjs';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
if(process.argv.slice(2).join(' ')!=='--headless')throw Error('Run with --headless in a separate browser');
const {chromium}=createRequire(import.meta.url)('playwright'),root=new URL('../',import.meta.url),out=new URL('results/',import.meta.url);
const checks=[],sources={},rasters=[],hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const check=(name,value,data)=>{checks.push({name,pass:!!value,...(data?{data}:{})});assert.ok(value,name);};
const html=await readFile(new URL('index.html',root),'utf8'),css=html.match(/\.view \.frame-view-open\{[^\n]+/)[0],detach=html.match(/const icon='(<svg width="16"[^\n]+)<\/svg>'/)[1]+'</svg>';
sources['index.html']=hash(html);
for(const path of ['tests/compact-icon-artwork.mjs','tests/icon-raster-contract.mjs','tests/fixtures/icon-main-42f64a46.json','tests/plugin-icon-alignment.mjs'])sources[path]=hash(await readFile(new URL(path,root)));
const icons=await Promise.all(iconIds.map(async id=>{const path=`plugins/${id}/icon.svg`,svg=await readFile(new URL(path,root),'utf8');sources[path]=hash(svg);check(id+' native 32px source',/width="32" height="32" viewBox="0 0 32 32"/.test(svg));check(id+' no scale or embedded dependency',!/\b(?:transform|style|href|filter)\s*=|<script|<image|<foreignObject/i.test(svg));return {id,svg};}));
checks.push(...(await pluginIconAlignmentChecks()).checks,...(await iconRasterContractCPUChecks()).checks);
const byId=Object.fromEntries(icons.map(i=>[i.id,i.svg])),references=await iconRasterReferences();
check('Magneto slightly darker solid fill',byId.magneto.includes('#a57dbe')&&byId.magneto.includes('#cfc0d7')&&!byId.magneto.includes('stroke='));
check('Optics lens is 2px shorter vertically and outgoing rays clear its stroke by 1px',byId.optics.includes('M19.5 8L29 16L19.5 24')&&byId.optics.includes('M14 5C10 10.5 10 21.5 14 27C18 21.5 18 10.5 14 5Z')&&byId.optics.includes('stroke-width="1.5"'));
check('Structural crisp half-pixel stroke centers retained',byId.structural.includes('stroke-width="1"')&&byId.structural.includes('M7.5 17.5h17M16.5 9.5v15'));
check('Detach native 16px and darker idle only',css.includes('color:#777!important')&&css.includes(':hover{color:#aaa!important')&&detach.includes('viewBox="0 0 16 16"'));
await mkdir(out,{recursive:true});const browser=await chromium.launch({headless:true,executablePath:process.env.FRAME_BROWSER||undefined,args:['--disable-gpu','--disable-gpu-compositing']});
const report={started:new Date().toISOString(),pass:false,kind:'compact-native-artwork',sources,checks,rasters,oracleTimings:[],referenceCommit:'42f64a46d18f9a4a77c0c6e34ce92384b6d28fe0',rasterAcceptance:'Complete RGBA against independently derived main artwork contract. Alpha boxes are observations, not renderer-independent vector bounds.',hardwareGPUValidated:false,applicationInteractionValidated:false};
try{for(const dpr of testDprs){
 const context=await browser.newContext({viewport:{width:920,height:420},deviceScaleFactor:dpr}),page=await context.newPage(),start=performance.now(),size=32*dpr,productionRasters=[];
 await page.setContent(`<html><style>${css}body{margin:20px;background:#252525;color:#ddd;font:13px Arial}main{display:flex;gap:28px}section{width:140px}p{height:32px}img{display:block;width:32px;height:32px}canvas{display:block;margin-top:12px;image-rendering:pixelated}.view{position:relative;width:16px;height:16px}</style><main>${icons.map(({id,svg})=>`<section><p>${id}: native 32px</p><img id="${id}" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"><canvas id="${id}-zoom" width="128" height="128"></canvas></section>`).join('')}</main><p>Pixel inspection below each native icon: diagnostic magnification only.</p><div class="view"><button class="frame-view-open">${detach}</button></div></html>`);
 check('Actual context DPR'+dpr,await page.evaluate(()=>devicePixelRatio)===dpr);
 for(const {id,svg}of icons){
  const actual=await page.locator('#'+id).evaluate(async(img,dpr)=>{await img.decode();const r=img.getBoundingClientRect(),c=document.createElement('canvas');c.width=c.height=32*dpr;const ctx=c.getContext('2d');ctx.scale(dpr,dpr);ctx.drawImage(img,0,0);const data=Array.from(ctx.getImageData(0,0,c.width,c.height).data),z=document.querySelector('#'+img.id+'-zoom').getContext('2d');z.imageSmoothingEnabled=false;z.drawImage(c,0,0,128,128);return {pixels:data,backing:[c.width,c.height],natural:[img.naturalWidth,img.naturalHeight],display:[r.width,r.height],transform:getComputedStyle(img).transform};},dpr);
  check(id+' true unscaled native dimensions DPR'+dpr,JSON.stringify(actual.natural)==='[32,32]'&&JSON.stringify(actual.display)==='[32,32]'&&actual.transform==='none');
  check(id+' real physical backing DPR'+dpr,JSON.stringify(actual.backing)===JSON.stringify([size,size]));
  productionRasters.push({id,svg,actual});
 }
 const button=page.locator('.frame-view-open');check('Detach darker idle DPR'+dpr,await button.evaluate(b=>getComputedStyle(b).color)==='rgb(119, 119, 119)');await button.hover();check('Detach hover contrast DPR'+dpr,await button.evaluate(b=>getComputedStyle(b).color)==='rgb(170, 170, 170)');await page.mouse.move(750,350);const completedMs=performance.now()-start;check('Completed decode and raster budget DPR'+dpr,completedMs<2000,{completedMs});await page.screenshot({path:fileURLToPath(new URL(`compact-icons-dpr${dpr}.png`,out))});
 // The existing 2s production-artwork window ended above. Independent reference
 // and negative-control decoding is separate and never extends that workload.
 const oracleStarted=performance.now(),transportStages=[];
 for(const {id,svg,actual}of productionRasters){
  const expectation=deriveIconRasterExpectation(id,references[id]),mutants=iconRasterMutants(id,svg,references[id]);
  const incoming=id==='optics'?{actual:opticsIncomingComponent(svg),main:opticsIncomingComponent(references[id].svg)}:null;
  if(incoming)check('Optics complete incoming component source unchanged DPR'+dpr,incoming.actual===incoming.main);
  const componentMutants=incoming?opticsIncomingMutants(svg):[],variants=[{name:'main',svg:references[id].svg},{name:'expected',svg:expectation.svg},...mutants,...(incoming?[{name:'incoming-main',svg:incoming.main},{name:'incoming-actual',svg:incoming.actual},...componentMutants]:[])];
  const callStarted=performance.now(),packed=await page.evaluate(renderIconRasterVariants,{variants,dpr}),callCompletedMs=performance.now()-callStarted,decodeStarted=performance.now(),rendered=decodeIconRasterVariants(packed,variants,size),decodeCompletedMs=performance.now()-decodeStarted;
  transportStages.push({id,renderedImages:packed.renderedImages,transportedBytes:packed.transportedBytes,browserRenderingMs:packed.renderingMs,browserPackingMs:packed.packingMs,browserCompletedMs:packed.browserCompletedMs,callCompletedMs,decodeCompletedMs});
  const main=rendered[0].pixels,aligned=shiftRaster(rendered[1].pixels,size,size,expectation.dx*dpr,expectation.dy*dpr),difference=rasterDifference(actual.pixels,aligned.pixels);
  check(id+' independent reference is not clipped DPR'+dpr,aligned.clippedAlpha===0,{clippedAlpha:aligned.clippedAlpha});
  check(id+' exact full RGBA contract DPR'+dpr,difference.equal,difference);
  const bounds=rasterBounds(actual.pixels,size,size);check(id+' native artwork remains visible and inside canvas DPR'+dpr,bounds[0]<=bounds[2]&&bounds[1]<=bounds[3]&&bounds[0]>0&&bounds[1]>0&&bounds[2]<size-1&&bounds[3]<size-1,bounds);
  if(id==='magneto')check('Magneto entire alpha unchanged DPR'+dpr,alphaDifference(actual.pixels,main)===0);
  if(incoming){const componentRasters=rendered.slice(2+mutants.length),reference=componentRasters[0].pixels,component=componentRasters[1].pixels,componentDiff=rasterDifference(component,reference),componentBounds=rasterBounds(component,size,size);
   check('Optics complete isolated incoming-ray RGBA unchanged DPR'+dpr,componentDiff.equal,componentDiff);
   check('Optics incoming component is nonempty and unclipped DPR'+dpr,componentBounds[0]<=componentBounds[2]&&componentBounds[1]<=componentBounds[3]&&componentBounds[0]>0&&componentBounds[1]>0&&componentBounds[2]<size-1&&componentBounds[3]<size-1,componentBounds);
   for(const mutant of componentRasters.slice(2)){const diff=rasterDifference(mutant.pixels,reference);check('Optics reject component raster mutant: '+mutant.name+' DPR'+dpr,!diff.equal,{differentChannels:diff.differentChannels});}
  }
  for(const mutant of rendered.slice(2,2+mutants.length)){const diff=rasterDifference(mutant.pixels,aligned.pixels);check(id+' reject raster mutant: '+mutant.name+' DPR'+dpr,!diff.equal,{differentChannels:diff.differentChannels});}
  rasters.push({id,dpr,physicalSize:actual.backing,observedBounds:bounds,mainObservedBounds:rasterBounds(main,size,size),expectedObservedBounds:rasterBounds(aligned.pixels,size,size),candidateRGBA_SHA256:hash(Buffer.from(actual.pixels)),expectedRGBA_SHA256:hash(Buffer.from(aligned.pixels)),mainRGBA_SHA256:hash(Buffer.from(main)),contract:expectation.contract,negativeMutants:mutants.length,incomingComponentMutants:componentMutants.length});
 }
 const oracleCompletedMs=performance.now()-oracleStarted;
 report.oracleTimings.push({dpr,completedMs:oracleCompletedMs,budgetMs:2000,metBudget:oracleCompletedMs<2000,classification:'diagnostic-only',rationale:'Auxiliary oracle cap was introduced by test v3, not immutable main or an application requirement. Original production 2000 ms gate remains enforced.',referenceRenders:12,negativeRenders:21,transportStages,scope:'Independent references and negative controls only; excluded from the unchanged production decode/raster budget.'});
 await context.close();
}report.pass=true;}catch(error){report.error=error.stack;throw error;}finally{await browser.close();for(const [path,expectedHash]of Object.entries(sources)){const actual=hash(await readFile(new URL(path,root)));check('Source unchanged through verification: '+path,actual===expectedHash);}
await writeFile(new URL('compact-icon-artwork.json',out),JSON.stringify(report,null,2)+'\n');}console.log(JSON.stringify(report,null,2));
