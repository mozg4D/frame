import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual,createHash} from 'node:crypto';
import {mkdtemp,writeFile,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {startFileHost} from '../tools/file-host.mjs';
import {createFileBridge} from '../tools/file-bridge.mjs';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const bounded=async promise=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Concurrency test timed out')),5000);})]);}finally{clearTimeout(timer);}};

export async function fileHostConcurrencyChecks(){
 const dir=await mkdtemp(join(tmpdir(),'frame-host-concurrency-')),target=join(dir,'project.hash'),other=join(dir,'other.hash'),origin='https://mozg4d.github.io',checks=[],timings=[],hosts=[];
 const check=(name,fn)=>{fn();checks.push({name,pass:true});};
 const create=async(factory=startFileHost,options={})=>{const host=await factory({paths:[target,other],origin,...options});hosts.push(host);return host;};
 const request=async(host,route,key,body={})=>{const response=await fetch(host.url+route,{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});return {status:response.status,body:await response.json()};};
 const connect=async host=>{const r=await request(host,'connect',host.token);assert.equal(r.status,200);return r.body.session;};
 const file=(host,key,body)=>request(host,'file',key,body);
 const begin=async(host,key,path=target,op='beginWrite')=>{const r=await file(host,key,{op,path});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(typeof r.body.id,'string');return r.body.id;};
 const write=async(host,key,id,text)=>{const r=await file(host,key,{op:'write',id,base64:Buffer.from(text).toString('base64')});assert.equal(r.status,200,JSON.stringify(r.body));};
 const abort=async(host,key,id)=>{const r=await file(host,key,{op:'abort',id});assert.equal(r.status,200,JSON.stringify(r.body));};
 const noTemps=async()=>assert.ok(!(await readdir(dir)).some(name=>name.startsWith('.frame-')));
 let releaseBegin=null;
 const at=performance.now();
 try{
  await writeFile(target,'original');await writeFile(other,'other original');
  const host=await create(),a=await connect(host),b=await connect(host);
  const competing=await Promise.all([a,b].map(key=>file(host,key,{op:'beginWrite',path:target}))),winner=competing[0].status===200?a:b,loser=winner===a?b:a,id=competing.find(r=>r.status===200)?.body.id;
  check('Two document sessions cannot begin writes to the same exact path',()=>{assert.equal(competing.filter(r=>r.status===200).length,1);assert.equal(competing.filter(r=>r.status===400).length,1);assert.match(competing.find(r=>r.status===400).body.error,/Another write/);});
  await write(host,winner,id,'first save');let r=await file(host,winner,{op:'finish',id});let bytes=await readFile(target,'utf8');
  check('The sole winning save commits exact bytes and receipt',()=>{assert.equal(r.status,200);assert.equal(bytes,'first save');assert.equal(r.body.sha256,createHash('sha256').update(bytes).digest('hex'));});
  let next=await begin(host,loser);await write(host,loser,next,'second save');r=await file(host,loser,{op:'finish',id:next});bytes=await readFile(target,'utf8');
  check('Successful finish releases the path lock for another document',()=>{assert.equal(r.status,200);assert.equal(bytes,'second save');});
  let transfer=await begin(host,a);await write(host,a,transfer,'must abort');await abort(host,a,transfer);next=await begin(host,b);await abort(host,b,next);bytes=await readFile(target,'utf8');await noTemps();
  check('Explicit abort releases the shared lock and preserves committed bytes',()=>assert.equal(bytes,'second save'));

  transfer=await begin(host,a);
  for(const op of ['read','write','finish','abort']){r=await file(host,b,{op,id:transfer,base64:'Zm9yZWlnbg=='});check('A foreign document cannot '+op+' an owned transfer',()=>{assert.equal(r.status,400);assert.match(r.body.error,/unauthorized|Unknown/);});}
  await write(host,a,transfer,'owner remains valid');await abort(host,a,transfer);
  const read=await begin(host,a,target,'beginRead');r=await file(host,b,{op:'read',id:read});check('Read transfer IDs also remain document-private',()=>assert.equal(r.status,400));r=await file(host,a,{op:'read',id:read});check('Denied foreign access leaves the owner read usable',()=>{assert.equal(r.status,200);assert.equal(Buffer.from(r.body.base64,'base64').toString(),'second save');});assert.equal((await file(host,a,{op:'finish',id:read})).status,200);

  const ownedA=await begin(host,a),ownedB=await begin(host,b,other);await write(host,a,ownedA,'discarded');await write(host,b,ownedB,'other committed');assert.equal((await request(host,'disconnect',a)).status,200);r=await file(host,b,{op:'finish',id:ownedB});bytes=await readFile(other,'utf8');
  check('Disconnect aborts only the departing document transfers',()=>{assert.equal(r.status,200);assert.equal(bytes,'other committed');});
  next=await begin(host,b);await abort(host,b,next);bytes=await readFile(target,'utf8');await noTemps();r=await file(host,a,{op:'finish',id:ownedA});
  check('Disconnect releases the lock without saving the partial file',()=>{assert.equal(bytes,'second save');assert.equal(r.status,403);});

  const c=await connect(host);transfer=await begin(host,b);await write(host,b,transfer,'stale save');await writeFile(target,'external edit');r=await file(host,b,{op:'finish',id:transfer});check('External modification rejects final rename',()=>{assert.equal(r.status,400);assert.match(r.body.error,/Target changed/);});r=await file(host,c,{op:'beginWrite',path:target});check('Failed finish remains owned and reserved until explicit cleanup',()=>assert.equal(r.status,400));assert.equal((await request(host,'disconnect',b)).status,200);next=await begin(host,c);await abort(host,c,next);bytes=await readFile(target,'utf8');await noTemps();check('Disconnect cleans a failed finish and releases its lock',()=>assert.equal(bytes,'external edit'));
  await host.close();

  const idleHost=await create(startFileHost,{idleMs:120}),expiring=await connect(idleHost),surviving=await connect(idleHost),expiredWrite=await begin(idleHost,expiring),keptWrite=await begin(idleHost,surviving,other);await write(idleHost,expiring,expiredWrite,'expired');await write(idleHost,surviving,keptWrite,'survivor');
  for(let i=0;i<12;i++){await pause(35);r=await request(idleHost,'connect',idleHost.token,{session:surviving});assert.equal(r.status,200);assert.equal(r.body.session,surviving);}
  r=await file(idleHost,expiring,{op:'finish',id:expiredWrite});check('Idle expiry revokes the expired session without committing its write',()=>assert.equal(r.status,403));next=await begin(idleHost,surviving);await abort(idleHost,surviving,next);bytes=await readFile(target,'utf8');check('Idle cleanup releases the same-path lock for a live document',()=>assert.equal(bytes,'external edit'));r=await file(idleHost,surviving,{op:'finish',id:keptWrite});bytes=await readFile(other,'utf8');await noTemps();check('Idle cleanup preserves another document in-progress transfer',()=>{assert.equal(r.status,200);assert.equal(bytes,'survivor');});await idleHost.close();

  // Execute the shipped factory unchanged; only delay a real bridge result in
  // this test context to control the begin/disconnect interleaving reliably.
  const observed=deferred(),held=deferred();releaseBegin=held.resolve;let hold=true,created=0,closed=0;
  const factory=runInNewContext('('+startFileHost.toString()+')',{URL,Buffer,Date,createServer,randomBytes,timingSafeEqual,setInterval,clearInterval,createFileBridge:async paths=>{created++;const real=await createFileBridge(paths);return {call:async args=>{const result=await real.call(args);if(hold&&args.op==='beginWrite'){hold=false;observed.resolve();await held.promise;}return result;},close:async()=>{closed++;await real.close();}};}});
  const controlled=await create(factory),departing=await connect(controlled),remaining=await connect(controlled),pending=file(controlled,departing,{op:'beginWrite',path:target});await bounded(observed.promise);r=await request(controlled,'disconnect',departing);assert.equal(r.status,200);releaseBegin();r=await pending;releaseBegin=null;
  check('Disconnect during awaited begin rejects the late transfer result',()=>{assert.equal(r.status,400);assert.match(r.body.error,/closed/);});await noTemps();next=await begin(controlled,remaining);await abort(controlled,remaining,next);bytes=await readFile(target,'utf8');
  check('Late begin is aborted without leaving a temporary file or path lock',()=>assert.equal(bytes,'external edit'));await controlled.close();check('The host creates and closes its shared bridge exactly once',()=>{assert.equal(created,1);assert.equal(closed,1);});
  const ms=performance.now()-at;timings.push({name:'Actual HTTP shared ownership, lock lifecycle and controlled disconnect races',ms,budget:10000});check('Completed concurrency and cleanup budget',()=>assert.ok(ms<10000));
  return {pass:true,checks,timings,scope:'Actual loopback HTTP and disk. Only delayed-begin scheduling uses an injected wrapper around the real bridge and unchanged host factory.'};
 }catch(error){return {pass:false,checks,timings,error:error.stack};}finally{releaseBegin?.();await Promise.all(hosts.map(host=>host.close()));}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const result=await fileHostConcurrencyChecks();console.log(JSON.stringify(result,null,2));process.exitCode=result.pass?0:1;}
