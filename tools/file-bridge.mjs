// Explicit exact-path grants belong to the trusted local file host, never tool arguments.
import {open,realpath,rename,unlink,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,dirname,basename,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
export async function createFileBridge(paths=[]){
 const grants=new Set();
 for(const path of paths){const absolute=resolve(path);grants.add(join(await realpath(dirname(absolute)),basename(absolute)));}
 const sessions=new Map(),limit=1024*1024;let closed=false,serial=Promise.resolve();
 const fingerprint=async path=>{try{const s=await lstat(path);return `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;}catch(e){if(e.code==='ENOENT')return null;throw e;}};
 async function target(path){if(typeof path!=='string'||!path)throw Error('A granted local path is required');const absolute=resolve(path),canonical=join(await realpath(dirname(absolute)),basename(absolute));if(!grants.has(canonical))throw Error('Local path is not authorized: '+absolute);try{const s=await lstat(canonical);if(s.isSymbolicLink()||!s.isFile())throw Error('Target must be a regular file, not a symbolic link');}catch(e){if(e.code!=='ENOENT')throw e;}return canonical;}
 async function dispose(id){const s=sessions.get(id);if(!s)return;sessions.delete(id);await s.file.close().catch(()=>{});if(s.temp)await unlink(s.temp).catch(()=>{});}
 async function call(a){
  if(closed)throw Error('File bridge is closed');
  if(a.op==='beginRead'||a.op==='beginWrite'){
   const path=await target(a.path),write=a.op==='beginWrite';if(write&&[...sessions.values()].some(s=>s.temp&&s.path===path))throw Error('Another write is active for this path');
   const original=await fingerprint(path),temp=write?join(dirname(path),'.frame-'+randomUUID()+'.tmp'):null;let file;
   try{file=await open(temp||path,write?'wx':constants.O_RDONLY|(constants.O_NOFOLLOW||0),0o600);const stat=await file.stat();if(!stat.isFile())throw Error('Target must be a regular file');if(!write&&(`${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`!==original||await fingerprint(path)!==original))throw Error('File changed while opening');const id=randomUUID(),size=write?0:stat.size;sessions.set(id,{file,path,temp,size,original,offset:0,hash:createHash('sha256')});return {id,path,name:basename(path),bytes:size};}
   catch(error){await file?.close().catch(()=>{});if(temp)await unlink(temp).catch(()=>{});throw error;}
  }
  const s=sessions.get(a.id);if(!s)throw Error('Unknown or expired file transfer');
  if(a.op==='abort'){await dispose(a.id);return {};}
  if(a.op==='read'){if(s.temp)throw Error('Not a read transfer');const bytes=Buffer.alloc(Math.min(limit,s.size-s.offset)),{bytesRead}=await s.file.read(bytes,0,bytes.length,s.offset);if(!bytesRead&&s.offset<s.size)throw Error('File changed during read');const chunk=bytes.subarray(0,bytesRead);s.offset+=bytesRead;s.hash.update(chunk);return {base64:chunk.toString('base64'),done:s.offset===s.size};}
  if(a.op==='write'){if(!s.temp||typeof a.base64!=='string'||a.base64.length>Math.ceil(limit/3)*4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(a.base64))throw Error('Invalid file chunk');const bytes=Buffer.from(a.base64,'base64');let offset=0;while(offset<bytes.length){const {bytesWritten}=await s.file.write(bytes,offset,bytes.length-offset,s.offset+offset);if(!bytesWritten)throw Error('Incomplete file write');offset+=bytesWritten;}s.offset+=bytes.length;s.hash.update(bytes);return {bytes:s.offset};}
  if(a.op==='finish'){if(!s.temp&&s.offset!==s.size)throw Error('Incomplete file read');if(s.temp){await s.file.sync();await s.file.close();await target(s.path);if(closed)throw Error('File bridge is closed');if(await fingerprint(s.path)!==s.original)throw Error('Target changed during save; original was not overwritten');await rename(s.temp,s.path);}else await s.file.close();sessions.delete(a.id);return {path:s.path,name:basename(s.path),bytes:s.offset,sha256:s.hash.digest('hex')};}
  throw Error('Unknown file bridge operation');
 }
 const enqueue=fn=>{const result=serial.then(fn);serial=result.catch(()=>{});return result;};
 return {call:a=>enqueue(()=>call(a)),close:()=>{closed=true;return enqueue(async()=>{for(const id of sessions.keys())await dispose(id);});}};
}
export async function attachFileBridge(page,paths){
 const bridge=await createFileBridge(paths),url=page.url(),binding='__frameFileHost_'+randomUUID().replaceAll('-','');let closed=false;
 const close=async()=>{if(closed)return;closed=true;page.off('framenavigated',navigated);page.off('close',close);await bridge.close();await page.evaluate(name=>{if(window.__frameFileHostSession===name){delete window.__frameFileHost;delete window.__frameFileHostSession;}},binding).catch(()=>{});};
 const navigated=frame=>{if(frame===page.mainFrame())void close();};
 try{await page.exposeBinding(binding,async(source,a)=>{if(closed||source.page!==page||source.frame!==page.mainFrame()||source.frame.url()!==url)throw Error('File bridge is restricted to the selected Frame document');return bridge.call(a);});await page.evaluate(name=>{window.__frameFileHostSession=name;window.__frameFileHost=args=>window[name](args);},binding);page.on('framenavigated',navigated);page.on('close',close);}
 catch(error){await close();throw error;}
 return {call:bridge.call,close};
}
