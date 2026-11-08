import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {launch,ready} from '../tools/browser.mjs';
import {isHardwareAdapter,isDecodedNativeIcon,hasBoundedFrameTimings} from '../plugins/thermal/tests/browser-gates.mjs';
if(process.argv.slice(2).join(' ')!=='--headless')throw Error('Only an explicit separate --headless browser is supported');
const root=resolve(fileURLToPath(new URL('../',import.meta.url))),out=resolve(root,'tests/results');
const paths=['index.html','frame-sw.js','tools/browser.mjs','plugins/thermal/icon.svg','plugins/3d-printer/icon.svg','plugins/thermal/plugin.json','plugins/3d-printer/plugin.json','tests/plugin-icon-artwork.mjs','tests/plugin-icon-browser.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,createHash('sha256').update(await readFile(resolve(root,p))).digest('hex')])));
const report={started:new Date().toISOString(),kind:'native-32px-plugin-icon-redraw',pass:false,checks:[],errors:[],consoleErrors:[],sources:await hashes()};
const stamp=report.started.replaceAll(/[:.]/g,'-');await mkdir(out,{recursive:true});let session;
const check=(name,value,data)=>{report.checks.push({name,pass:!!value,...(data===undefined?{}:{data})});assert.ok(value,name);};
try{
  session=await launch({headless:true});const page=session.page;
  page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
  await ready(page);
  report.hardware=await page.evaluate(()=>{const d=frameEngine.renderer.device;window.__iconDevice=d;window.__iconErrors=[];window.__iconLost=null;d.addEventListener('uncapturederror',e=>__iconErrors.push(e.error.message));d.lost.then(e=>__iconLost={reason:e.reason,message:e.message});d.pushErrorScope('validation');return d.adapterInfo?Object.fromEntries(['vendor','architecture','device','description','isFallbackAdapter'].map(k=>[k,d.adapterInfo[k]])):null;});
  check('actual native Frame device is identified hardware without fallback',isHardwareAdapter(report.hardware),report.hardware);
  const before=await page.evaluate(()=>frameAI.call('plugins.list'));
  check('opening icon catalogue does not require plugin runtime',before.filter(p=>['thermal','3d-printer'].includes(p.id)).length===2&&before.filter(p=>['thermal','3d-printer'].includes(p.id)).every(p=>!p.loaded));
  const began=performance.now();await page.locator('#tabPlugins').click();report.icons={};
  for(const plugin of ['thermal','3d-printer']){
    const result=await page.locator(`[data-plugin="${plugin}"] img`).evaluate(async img=>{
      await img.decode();const rect=img.getBoundingClientRect(),style=getComputedStyle(img),canvas=document.createElement('canvas');canvas.width=canvas.height=32;
      const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);const data=ctx.getImageData(0,0,32,32).data,alpha=(x,y)=>data[4*(y*32+x)+3];
      let x0=32,y0=32,x1=-1,y1=-1,painted=0;for(let y=0;y<32;y++)for(let x=0;x<32;x++)if(alpha(x,y)>0){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);painted++;}
      return {decoded:true,complete:img.complete,width:img.width,height:img.height,naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,rect:{width:rect.width,height:rect.height},transform:style.transform,bounds:{x0,y0,x1,y1,width:x1-x0+1,height:y1-y0+1},painted,
        thermalVertical:[16,17,18,19].map(y=>[alpha(6,y),alpha(7,y),alpha(8,y)]),printerFill:[16,17].map(y=>[alpha(12,y),alpha(13,y),alpha(14,y),alpha(15,y)]),png:canvas.toDataURL()};
    });
    report.icons[plugin]={...result,png:undefined};
    check(plugin+' is decoded and displayed at genuine 32px with no CSS transform',isDecodedNativeIcon(result)&&result.transform==='none',report.icons[plugin]);
    check(plugin+' artwork is compact and not clipped',result.bounds.x0>=5&&result.bounds.y0>=5&&result.bounds.x1<=27&&result.bounds.y1<=27&&result.bounds.width<=22&&result.bounds.height<=23&&result.painted>60,result.bounds);
    if(plugin==='thermal')check('Thermal box vertical strokes occupy exactly one fully covered native pixel',result.thermalVertical.every(row=>row[0]===0&&row[1]===255&&row[2]===0),result.thermalVertical);
    else check('Benchy cabin uses solid integer-grid fill beside a transparent passage, not an outline',result.printerFill.every(row=>row[0]===0&&row[1]===255&&row[2]===255&&row[3]===0),result.printerFill);
    await writeFile(resolve(out,`plugin-icon-${plugin}-${stamp}.png`),Buffer.from(result.png.split(',')[1],'base64'),{flag:'wx'});
  }
  report.catalogueCompletedMs=performance.now()-began;check('native icon decode and catalogue interaction complete under 2000ms',report.catalogueCompletedMs<2000,report.catalogueCompletedMs);
  await page.screenshot({path:resolve(out,`plugin-icons-interface-${stamp}.png`)});
  const after=await page.evaluate(()=>frameAI.call('plugins.list'));check('catalogue viewing leaves both plugin runtimes lazy',after.filter(p=>['thermal','3d-printer'].includes(p.id)).every(p=>!p.loaded));
  report.frames=await page.evaluate(()=>frameAI.call('diagnostics.frame',{frames:12}));check('empty native UI retains bounded CPU/GPU frame timings',hasBoundedFrameTimings(report.frames),report.frames);
  report.gpu=await page.evaluate(async()=>{await __iconDevice.queue.onSubmittedWorkDone();return {validation:(await __iconDevice.popErrorScope())?.message||null,errors:__iconErrors,lost:__iconLost,deviceChanged:frameEngine.renderer.device!==__iconDevice};});
  check('no browser or shared-device errors',!report.gpu.validation&&!report.gpu.errors.length&&!report.gpu.lost&&!report.gpu.deviceChanged&&!report.errors.length&&!report.consoleErrors.length,report.gpu);
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller,{},{timeout:20000});
  report.cache=await page.evaluate(async()=>{
    const version=document.querySelector('meta[name="frame-version"]').content,name='frame-native-'+version,names=await caches.keys();
    if(!names.includes(name))throw Error('Paired release cache is absent');const cache=await caches.open(name),assets={};
    for(const plugin of ['thermal','3d-printer']){const path='plugins/'+plugin+'/icon.svg',response=await cache.match(new URL(path,location.href).href);if(!response)throw Error('Icon absent from release cache: '+plugin);assets[path]=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await response.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('');}
    return {version,name,assets};
  });
  for(const [path,hash]of Object.entries(report.cache.assets))check(path+' release cache contains exact new SVG bytes',hash===report.sources[path],hash);
  const offlineStart=performance.now();await session.context.setOffline(true);await page.reload();await ready(page);await page.locator('#tabPlugins').click();
  for(const plugin of ['thermal','3d-printer']){
    const offline=await page.locator(`[data-plugin="${plugin}"] img`).evaluate(async img=>{await img.decode();const rect=img.getBoundingClientRect();return {decoded:true,complete:img.complete,width:img.width,height:img.height,naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,rect:{width:rect.width,height:rect.height}};});
    check(plugin+' retains native 32px artwork on a genuine offline reload',isDecodedNativeIcon(offline),offline);
  }
  report.offlineCompletedMs=performance.now()-offlineStart;check('offline icon reload completes under 10 seconds',report.offlineCompletedMs<10000,report.offlineCompletedMs);
  const offlineState=await page.evaluate(()=>({version:document.querySelector('meta[name="frame-version"]').content,hardware:frameEngine.renderer.device.adapterInfo?Object.fromEntries(['vendor','architecture','device','description','isFallbackAdapter'].map(k=>[k,frameEngine.renderer.device.adapterInfo[k]])):null}));
  check('offline release retains the paired version and hardware renderer',offlineState.version===report.cache.version&&isHardwareAdapter(offlineState.hardware),offlineState);
  await session.context.setOffline(false);check('online and offline icon UI have no JavaScript or console errors',!report.errors.length&&!report.consoleErrors.length);
  // Magnification is a labelled TEST image only. Production SVG and UI stay 32px.
  const detail=await session.context.newPage();await detail.setContent('<html><body style="margin:24px;background:#1c1c1c;color:#ddd;font:14px sans-serif"><div style="display:flex;gap:32px" id="icons"></div></body></html>');
  await detail.evaluate(async origin=>{for(const [id,label]of [['thermal','Thermal'],['3d-printer','3D Printer / Benchy']]){const block=document.createElement('section'),title=document.createElement('p');title.textContent=label+' · native 32px';block.append(title);const img=new Image();img.src=origin+'/plugins/'+id+'/icon.svg';await img.decode();block.append(img);const caption=document.createElement('p');caption.textContent='Pixel inspection only · 8×';block.append(caption);const native=document.createElement('canvas');native.width=native.height=32;native.getContext('2d').drawImage(img,0,0);const zoom=document.createElement('canvas');zoom.width=zoom.height=256;const ctx=zoom.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.drawImage(native,0,0,256,256);block.append(zoom);document.querySelector('#icons').append(block);}},session.url);
  await detail.screenshot({path:resolve(out,`plugin-icons-detail-${stamp}.png`)});await detail.close();report.pass=true;
}catch(error){report.error=error.stack||String(error);}
finally{
  try{await session?.close();report.cleanup='fulfilled';}catch(error){report.pass=false;report.cleanup=String(error);}
  report.sourcesAfter=await hashes();report.sourcesUnchanged=JSON.stringify(report.sources)===JSON.stringify(report.sourcesAfter);if(!report.sourcesUnchanged)report.pass=false;
  await writeFile(resolve(out,`plugin-icons-${stamp}.json`),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
}
console.log(JSON.stringify({pass:report.pass,checks:report.checks.length,report:resolve(out,`plugin-icons-${stamp}.json`),error:report.error},null,2));process.exitCode=report.pass?0:1;
