import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname,sep} from 'node:path';
import {chromium} from 'playwright';
export const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
export async function serve(){
  const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://127.0.0.1');if(url.pathname==='/favicon.ico'){res.writeHead(204).end();return;}if(url.pathname==='/__frame/gpu-memory'){res.writeHead(200,{'Content-Type':'application/json'}).end('{"gpus":null}');return;}const path=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));if(!path.startsWith(root+sep)&&path!==resolve(root,'index.html')){res.writeHead(403).end();return;}if(req.method!=='GET'){res.writeHead(405).end();return;}if(!(await stat(path)).isFile()){res.writeHead(404).end();return;}const type={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.md':'text/plain; charset=utf-8','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'}[extname(path)]||'application/octet-stream';res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(await readFile(path));}catch{res.writeHead(404).end();}});
  await new Promise((ok,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',ok);});return {url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(ok=>server.close(ok))};
}
export async function launch({headless=true,cdp,url}={}){
  if(cdp){if(!url)throw Error('--url is required with --cdp (select one existing Frame tab explicitly)');const browser=await chromium.connectOverCDP(cdp),pages=browser.contexts().flatMap(c=>c.pages()).filter(p=>p.url()===url);if(pages.length!==1){await browser.close();throw Error(`Expected one exact Frame tab at ${url}, found ${pages.length}`);}return {page:pages[0],close:()=>browser.close(),owned:false};}
  const server=await serve();let browser;
  try{browser=await chromium.launch({headless,executablePath:process.env.FRAME_BROWSER||undefined,args:['--enable-unsafe-webgpu','--disable-background-timer-throttling','--disable-renderer-backgrounding']});const context=await browser.newContext({viewport:{width:1280,height:900},deviceScaleFactor:Number(process.env.FRAME_DPR||1)}),page=await context.newPage();await page.goto(server.url+'/index.html');return {browser,context,page,url:server.url,owned:true,close:async()=>{await browser.close();await server.close();}};}catch(e){await browser?.close();await server.close();throw e;}
}
export async function ready(page){await page.waitForFunction(()=>window.frameAI&&['true','error'].includes(document.querySelector('#frame-engine-canvas')?.dataset.ready),{},{timeout:60000});const status=await page.locator('#frame-engine-canvas').getAttribute('data-ready');if(status!=='true')throw Error('Frame WebGPU startup failed: '+await page.locator('body').innerText());}
