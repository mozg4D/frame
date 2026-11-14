import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
export const root=fileURLToPath(new URL('.',import.meta.url));

export async function launch(input) {
  const inputRoot=resolve(input),localRoot=resolve(root);
  const server=createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,'http://localhost');
      if(url.pathname==='/favicon.ico') {res.writeHead(204).end();return;}
      const isInput=url.pathname.startsWith('/input/'),base=isInput?inputRoot:localRoot;
      const rel=decodeURIComponent(isInput?url.pathname.slice(7):url.pathname.slice(1));
      const path=resolve(base,rel||'runner.html');
      if(!path.startsWith(base+sep)||req.method!=='GET'||!(await stat(path)).isFile()) {res.writeHead(404).end();return;}
      res.writeHead(200,{'Content-Type':{'.mjs':'text/javascript','.html':'text/html','.wgsl':'text/plain','.json':'application/json','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg'}[extname(path)]||'application/octet-stream','Cache-Control':'no-store'});
      res.end(await readFile(path));
    } catch {res.writeHead(404).end();}
  });
  await new Promise((ok,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',ok);});
  let browser;
  try {
    browser=await chromium.launch({headless:true,channel:'chromium',executablePath:process.env.NORMAL_MAP_BROWSER||undefined,args:['--enable-unsafe-webgpu','--disable-background-timer-throttling']});
    const page=await browser.newPage({viewport:{width:1440,height:1100},deviceScaleFactor:1});
    await page.goto(`http://127.0.0.1:${server.address().port}/runner.html`);
    const gpu=await page.evaluate(async()=>{
      const adapter=await navigator.gpu?.requestAdapter({powerPreference:'high-performance'});
      if(!adapter||adapter.info.isFallbackAdapter) throw Error('A hardware WebGPU adapter is required.');
      const device=await adapter.requestDevice({requiredFeatures:adapter.features.has('timestamp-query')?['timestamp-query']:[],requiredLimits:{maxTextureDimension2D:adapter.limits.maxTextureDimension2D}});
      window.gpuErrors=[];device.addEventListener('uncapturederror',e=>gpuErrors.push(e.error.message));
      device.lost.then(info=>gpuErrors.push(`Device lost: ${info.message}`));
      window.device=device;window.converter=await (await import('./normal-map.mjs')).createConverter(device);
      return {vendor:adapter.info.vendor,architecture:adapter.info.architecture,description:adapter.info.description,backend:adapter.info.device,timestamps:device.features.has('timestamp-query')};
    });
    return {page,gpu,close:async()=>{await browser.close();await new Promise(ok=>server.close(ok));}};
  } catch(error) {await browser?.close();await new Promise(ok=>server.close(ok));throw error;}
}
