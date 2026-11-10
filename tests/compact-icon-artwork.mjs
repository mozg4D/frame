import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
if(process.argv.slice(2).join(' ')!=='--headless')throw Error('Run with --headless in a separate browser');
const {chromium}=createRequire(import.meta.url)('playwright'),root=new URL('../',import.meta.url),out=new URL('results/',import.meta.url);
const expected={magneto:[8,6,23,26],structural:[5,4,26,26],optics:[2,3,29,28],cut:[5,4,26,27]},checks=[],sources={};
const check=(name,value,data)=>{checks.push({name,pass:!!value,...(data?{data}:{})});assert.ok(value,name);};
const html=await readFile(new URL('index.html',root),'utf8'),css=html.match(/\.view \.frame-view-open\{[^\n]+/)[0],detach=html.match(/const icon='(<svg width="16"[^\n]+)<\/svg>'/)[1]+'</svg>';
sources['index.html']=createHash('sha256').update(html).digest('hex');
const icons=await Promise.all(Object.keys(expected).map(async id=>{const path=`plugins/${id}/icon.svg`,svg=await readFile(new URL(path,root),'utf8');sources[path]=createHash('sha256').update(svg).digest('hex');check(id+' native 32px source',/width="32" height="32" viewBox="0 0 32 32"/.test(svg));check(id+' no scale or embedded dependency',!/\b(?:transform|style|href|filter)\s*=|<script|<image|<foreignObject/i.test(svg));return {id,svg};}));
const byId=Object.fromEntries(icons.map(i=>[i.id,i.svg]));
check('Magneto slightly darker solid fill',byId.magneto.includes('#ad85c6')&&byId.magneto.includes('#d7c8df')&&!byId.magneto.includes('stroke='));
check('Optics ray convergence has 11px horizontal room, formerly 8px',byId.optics.includes('M18 8L29 16L18 24')&&byId.optics.includes('M14 4C10 10 10 22 14 28C18 22 18 10 14 4Z')&&byId.optics.includes('stroke-width="1.5"'));
check('Structural crisp half-pixel stroke centers retained',byId.structural.includes('stroke-width="1"')&&byId.structural.includes('M7.5 17.5h17M16.5 9.5v15'));
check('Detach native 16px and darker idle only',css.includes('color:#777!important')&&css.includes(':hover{color:#aaa!important')&&detach.includes('viewBox="0 0 16 16"'));
await mkdir(out,{recursive:true});const browser=await chromium.launch({headless:true});
const report={started:new Date().toISOString(),pass:false,kind:'compact-native-artwork',sources,checks,hardwareGPUValidated:false,applicationInteractionValidated:false};
try{for(const dpr of [1,2]){
 const context=await browser.newContext({viewport:{width:800,height:420},deviceScaleFactor:dpr}),page=await context.newPage(),start=performance.now();
 await page.setContent(`<html><style>${css}body{margin:20px;background:#252525;color:#ddd;font:13px Arial}main{display:flex;gap:28px}section{width:140px}p{height:32px}img{display:block;width:32px;height:32px}canvas{display:block;margin-top:12px;image-rendering:pixelated}.view{position:relative;width:16px;height:16px}</style><main>${icons.map(({id,svg})=>`<section><p>${id}: native 32px</p><img id="${id}" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"><canvas id="${id}-zoom" width="128" height="128"></canvas></section>`).join('')}</main><p>Pixel inspection below each native icon: 4x only in this test page.</p><div class="view"><button class="frame-view-open">${detach}</button></div></html>`);
 for(const {id}of icons){const result=await page.locator('#'+id).evaluate(async img=>{await img.decode();const r=img.getBoundingClientRect(),c=document.createElement('canvas');c.width=c.height=32;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);const data=ctx.getImageData(0,0,32,32).data;let x0=32,y0=32,x1=-1,y1=-1;for(let y=0;y<32;y++)for(let x=0;x<32;x++)if(data[4*(y*32+x)+3]){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}const z=document.querySelector('#'+img.id+'-zoom').getContext('2d');z.imageSmoothingEnabled=false;z.drawImage(c,0,0,128,128);return {bounds:[x0,y0,x1,y1],natural:[img.naturalWidth,img.naturalHeight],display:[r.width,r.height],transform:getComputedStyle(img).transform};});
 check(id+' exactly one pixel inset per edge DPR'+dpr,JSON.stringify(result.bounds)===JSON.stringify(expected[id]),result.bounds);check(id+' true unscaled native dimensions DPR'+dpr,JSON.stringify(result.natural)==='[32,32]'&&JSON.stringify(result.display)==='[32,32]'&&result.transform==='none');}
 const button=page.locator('.frame-view-open');check('Detach darker idle DPR'+dpr,await button.evaluate(b=>getComputedStyle(b).color)==='rgb(119, 119, 119)');await button.hover();check('Detach hover contrast DPR'+dpr,await button.evaluate(b=>getComputedStyle(b).color)==='rgb(170, 170, 170)');await page.mouse.move(750,350);const completedMs=performance.now()-start;check('Completed decode and raster budget DPR'+dpr,completedMs<2000,{completedMs});await page.screenshot({path:fileURLToPath(new URL(`compact-icons-dpr${dpr}.png`,out))});await context.close();
}report.pass=true;}finally{await browser.close();for(const [path,expectedHash]of Object.entries(sources)){const actual=createHash('sha256').update(await readFile(new URL(path,root))).digest('hex');check('Source unchanged through verification: '+path,actual===expectedHash);}
await writeFile(new URL('compact-icon-artwork.json',out),JSON.stringify(report,null,2)+'\n');}console.log(JSON.stringify(report,null,2));
