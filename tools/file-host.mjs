// Explicit loopback transport for an ordinary PWA; no browser restart or CDP.
import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createFileBridge} from './file-bridge.mjs';
import {connectFrameFileHost} from './file-host-client.mjs';

export async function startFileHost({paths,origin='https://mozg4d.github.io',port=0,idleMs=20*60*1000}){
 const parsed=new URL(origin);if(parsed.origin!==origin||parsed.protocol!=='https:'&&!(parsed.protocol==='http:'&&['127.0.0.1','localhost'].includes(parsed.hostname)))throw Error('An exact trusted HTTPS origin is required');
 if(!Number.isFinite(idleMs)||idleMs<10)throw Error('A finite session idle timeout of at least10ms is required');
 if(!Array.isArray(paths)||!paths.length)throw Error('At least one exact --allow-file path is required');
 const bridge=await createFileBridge(paths);const token=randomBytes(32).toString('hex'),sessions=new Map();let closed=false,authority,connecting=0;
 const equal=(a,b)=>typeof a==='string'&&/^[a-f0-9]{64}$/.test(a)&&timingSafeEqual(Buffer.from(a),Buffer.from(b)),dispose=async key=>{const s=sessions.get(key);if(!s)return;sessions.delete(key);await Promise.all([...s.transfers].map(id=>bridge.call({op:'abort',id}).catch(()=>{})));s.transfers.clear();};
 const server=createServer(async(req,res)=>{
  const reply=(status,body)=>{if(res.headersSent||res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));};
  if(closed||req.headers.host!==authority||req.headers.origin!==origin){reply(403,{error:'File host origin or authority is not authorized',code:'FILE_HOST_DENIED'});req.resume();return;}
  res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');
  if(req.method==='OPTIONS'){if(req.headers['access-control-request-method']!=='POST'){reply(405,{error:'POST required'});return;}res.setHeader('Access-Control-Allow-Methods','POST');res.setHeader('Access-Control-Allow-Headers','authorization,content-type');if(req.headers['access-control-request-private-network']==='true')res.setHeader('Access-Control-Allow-Private-Network','true');res.writeHead(204);res.end();return;}
  if(req.method!=='POST'||!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')){reply(415,{error:'JSON POST required',code:'FILE_HOST_DENIED'});req.resume();return;}
  const key=req.headers.authorization?.replace(/^Bearer /,''),route=req.url,root=route==='/frame-file/v1/connect',session=root?null:sessions.get(key);
  if(root?!equal(key,token):!session){reply(403,{error:'File host session is not authorized',code:'FILE_HOST_DENIED'});req.resume();return;}
  if(!['/frame-file/v1/connect','/frame-file/v1/file','/frame-file/v1/disconnect'].includes(route)){reply(404,{error:'Unknown file host route'});req.resume();return;}
  try{let bytes=0,parts=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>1500000){reply(413,{error:'File host chunk is too large'});req.destroy();return;}parts.push(chunk);}const body=JSON.parse(Buffer.concat(parts).toString('utf8'));
   if(root){const resumed=typeof body?.session==='string'?sessions.get(body.session):null;if(resumed){resumed.last=Date.now();reply(200,{session:body.session,idleMs});return;}if(sessions.size+connecting>=8){reply(429,{error:'Too many connected documents'});return;}connecting++;try{const id=randomBytes(32).toString('hex');if(closed)throw Error('File host is closed');sessions.set(id,{transfers:new Set(),last:Date.now(),active:0});reply(200,{session:id,idleMs});}finally{connecting--;}return;}
   session.last=Date.now();session.active++;try{if(route==='/frame-file/v1/disconnect'){await dispose(key);reply(200,{closed:true});}else{const begin=body?.op==='beginRead'||body?.op==='beginWrite';if(!begin&&!session.transfers.has(body?.id))throw Error('Unknown or unauthorized file transfer');const result=await bridge.call(body);if(begin){if(!sessions.has(key)){await bridge.call({op:'abort',id:result.id});throw Error('File host session was closed');}session.transfers.add(result.id);}else if(body.op==='finish'||body.op==='abort')session.transfers.delete(body.id);reply(200,result);}}finally{session.active--;session.last=Date.now();}
  }catch(error){reply(400,{error:error.message,code:'FILE_HOST_REJECTED'});}
 });
 server.requestTimeout=120000;server.headersTimeout=15000;server.maxHeadersCount=32;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen({host:'127.0.0.1',port},resolve);});authority='127.0.0.1:'+server.address().port;
 const sweep=setInterval(()=>{for(const [key,s]of sessions)if(!s.active&&Date.now()-s.last>idleMs)void dispose(key);},Math.min(idleMs,30000));sweep.unref();
 const close=async()=>{if(closed)return;closed=true;clearInterval(sweep);await Promise.all([...sessions.keys()].map(dispose));await bridge.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));};
 return {url:'http://'+authority+'/frame-file/v1/',token,origin,close};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),option=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined,paths=args.flatMap((a,i)=>a==='--allow-file'?[args[i+1]]:[]);
 if(paths.some(p=>!p||p.startsWith('--')))throw Error('--allow-file requires an exact filename');
 const host=await startFileHost({paths,origin:option('--origin')||'https://mozg4d.github.io',port:option('--port')===undefined?0:Number(option('--port'))});
 // Contains an ephemeral credential. Keep local; never commit or publish this output.
 console.log(JSON.stringify({url:host.url,token:host.token,origin:host.origin,connectCommand:'scene.host.connect',legacyConnectScript:'await ('+connectFrameFileHost.toString()+')('+JSON.stringify({url:host.url,token:host.token})+');'}));
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await host.close();process.exit(0);});
}
