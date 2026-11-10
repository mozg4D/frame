import {request as httpRequest} from 'node:http';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {startFileHost} from '../tools/file-host.mjs';
import {connectFrameFileHost} from '../tools/file-host-client.mjs';
import {consumeExpectedHostConsoleErrors} from './file-host-browser.mjs';

export async function fileHostChecks(){
 const dir=await mkdtemp(join(tmpdir(),'frame-file-host-')),source=join(dir,'source.hash'),target=join(dir,'target.hash'),denied=join(dir,'denied.hash'),origin='https://mozg4d.github.io',checks=[],timings=[],check=(name,fn)=>{fn();checks.push({name,pass:true});};
 const bytes=Buffer.alloc(20*1024*1024+7);for(let i=0;i<bytes.length;i+=4096)bytes[i]=i%251;await writeFile(source,bytes);const host=await startFileHost({paths:[source,target],origin});
 const request=(route,key,body={},headers={})=>new Promise((resolve,reject)=>{const req=httpRequest(host.url+route,{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+key,'Content-Type':'application/json',...headers}},response=>{const chunks=[];response.on('data',c=>chunks.push(c));response.on('end',()=>{try{resolve({status:response.statusCode,body:JSON.parse(Buffer.concat(chunks).toString('utf8')),origin:response.headers['access-control-allow-origin']||null});}catch(e){reject(e);}});});req.on('error',reject);req.end(JSON.stringify(body));}),connect=async()=>{const r=await request('connect',host.token);assert.equal(r.status,200);return r.body.session;};
 try{
  check('Expected-error accounting preserves extra and unrelated failures',()=>{const allowed={url:'http://127.0.0.1:1/file',text:'intentional 400',count:1},r=consumeExpectedHostConsoleErrors([{url:allowed.url,text:allowed.text},{url:allowed.url,text:allowed.text},{url:allowed.url,text:'unexpected'},{url:'http://127.0.0.1:2/file',text:allowed.text}],[allowed]);assert.equal(r.matched.length,1);assert.equal(r.unexpected.length,3);assert.equal(allowed.count,1);});
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');check('PWA and legacy attachment use the exact same connection implementation',()=>assert.ok(html.includes(connectFrameFileHost.toString())));
  let r=await request('connect','f'.repeat(64));check('Wrong credential rejects before session allocation',()=>assert.equal(r.status,403));r=await request('connect',host.token,{}, {Origin:'https://example.org'});check('Different origin rejects without CORS grant',()=>{assert.equal(r.status,403);assert.equal(r.origin,null);});r=await request('connect',host.token,{}, {Host:'attacker.example'});check('DNS rebinding authority rejects',()=>assert.equal(r.status,403));r=await request('connect','é'.repeat(64));check('Non-ASCII malformed credential does not crash the host',()=>assert.equal(r.status,403));
  const session=await connect();r=await request('file',host.token,{op:'beginRead',path:source});check('Bootstrap token cannot access filesystem operations',()=>assert.equal(r.status,403));r=await request('file',session,{op:'beginWrite',path:denied});check('Connected document cannot grant another path',()=>assert.equal(r.status,400));
  const second=await connect(),transfer=(await request('file',session,{op:'beginRead',path:source})).body;assert.ok(transfer.id);r=await request('file',second,{op:'read',id:transfer.id});check('Another document session cannot access a transfer',()=>assert.equal(r.status,400));
  const at=performance.now(),chunks=[];let done=false;while(!done){r=await request('file',session,{op:'read',id:transfer.id});assert.equal(r.status,200);chunks.push(Buffer.from(r.body.base64,'base64'));done=r.body.done;}r=await request('file',session,{op:'finish',id:transfer.id});const digest=createHash('sha256').update(bytes).digest('hex');check('More than16MiB streams with exact bytes and digest',()=>{assert.deepEqual(Buffer.concat(chunks),bytes);assert.equal(r.body.sha256,digest);});
  for(let pass=0;pass<2;pass++){const write=(await request('file',session,{op:'beginWrite',path:target})).body;assert.ok(write.id);for(const chunk of chunks)assert.equal((await request('file',session,{op:'write',id:write.id,base64:chunk.toString('base64')})).status,200);r=await request('file',session,{op:'finish',id:write.id});check('Save '+pass+' completes with exact receipt and file',()=>assert.equal(r.body.sha256,digest));assert.deepEqual(await readFile(target),bytes);}
  const ms=performance.now()-at;timings.push({name:'20MiB read and two atomic saves over actual loopback HTTP',ms,budget:15000});check('Completed transfer budget',()=>assert.ok(ms<15000));
  const write=(await request('file',session,{op:'beginWrite',path:target})).body;await request('file',session,{op:'write',id:write.id,base64:'bmV3'});await request('disconnect',session);r=await request('file',session,{op:'finish',id:write.id});check('Disconnect revokes session and aborts incomplete save',()=>assert.equal(r.status,403));assert.deepEqual(await readFile(target),bytes);const files=await readdir(dir);check('No temporary output remains after disconnect',()=>assert.ok(!files.some(n=>n.startsWith('.frame-'))));
  const third=await connect();check('A new document can reconnect with explicit authorization',()=>assert.notEqual(third,session));await request('disconnect',third);await request('disconnect',second);
  return {pass:true,checks,timings};
 }catch(error){return {pass:false,checks,timings,error:error.stack};}finally{await host.close();}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const r=await fileHostChecks();console.log(JSON.stringify(r,null,2));process.exitCode=r.pass?0:1;}
