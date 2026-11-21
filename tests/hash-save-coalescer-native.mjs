import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {launch,ready} from '../tools/browser.mjs';
import {startFileHost} from '../tools/file-host.mjs';

const [expectedIndex,baselineReport,countsArg]=process.argv.slice(2);
assert(/^[a-f0-9]{64}$/.test(expectedIndex||''),'Pass the exact guarded runtime index SHA-256');
const counts=(countsArg||'32,1000,10000').split(',').map(Number);
assert(counts.every(n=>Number.isInteger(n)&&n>0&&n<=10000),'This focused fixture must not run the massive scene');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const source=await fs.readFile(new URL('../index.html',import.meta.url),'utf8');
assert.equal(digest(source),expectedIndex);
const start=source.indexOf('function createFrameHashCodec(){'),end=source.indexOf('\nconst FrameHash=',start);
assert(start>=0&&end>start);
const H=Function(source.slice(start,end)+'\nreturn createFrameHashCodec();')(),{T,K}=H;
const owner=i=>(0x40000000+i).toString(16).padStart(32,'0');
const baseline=baselineReport&&baselineReport!=='-'?JSON.parse(await fs.readFile(baselineReport,'utf8')):null;
const dir=await fs.mkdtemp(join(tmpdir(),'frame-hash-save-coalesce-'));
let app,host;
try{
  const scenarios=[];
  for(const n of counts){
    const ids=Array.from({length:n},(_,i)=>owner(i)),rows=[
      {id:K.version,type:T.uint32,value:new Uint32Array([1])},
      {id:K.all,type:T.ids,value:ids},
    ];
    for(let i=0;i<n;i++){
      rows.push({id:H.address(ids[i],'type'),type:T.bytes,value:Uint8Array.of(0)});
      if(i)rows.push({id:H.address(ids[i],'parent'),type:T.ids,value:[ids[0]]});
      else rows.push({id:H.address(ids[0],'flags'),type:T.bytes,value:Uint8Array.of(7)});
      if(i===0||i===Math.floor(n/2)||i===n-1)
        rows.push({id:H.address(ids[i],'name'),type:T.text,value:'Null #'+i});
    }
    const bufs=[];
    for(const row of rows)bufs.push(Buffer.from(await (await H.pack(row)).blob.arrayBuffer()));
    const input=join(dir,'input-'+n+'.hash'),output=join(dir,'output-'+n+'.hash'),fixture=Buffer.concat(bufs);
    await fs.writeFile(input,fixture,{flag:'wx'});
    scenarios.push({n,input,output,inputSHA:digest(fixture)});
  }
  const aborted=join(dir,'aborted.hash');
  app=await launch({headless:true});await ready(app.page);
  const errors=[];app.page.on('pageerror',error=>errors.push(error.message));app.page.on('crash',()=>errors.push('Chromium page crash'));
  host=await startFileHost({origin:app.url,paths:[...scenarios.flatMap(({input,output})=>[input,output]),aborted]});
  await app.page.evaluate(({url,token})=>frameAI.call('scene.host.connect',{url,token}),{url:host.url,token:host.token});
  const rows=[];
  for(const test of scenarios){
    const result=await app.page.evaluate(async ({n,input,output})=>{
      const c=document.querySelector('#frame-engine-canvas'),ids=()=>frameEngine.scene.records.get(FrameHash.K.all).value;
      // Load unbound by exact bytes through the native host to avoid measuring scene.file binding work.
      const file=await frameHostFileHandle(input).getFile();await frameEngine.loadFile(file);
      if(ids().length!==n||!nodes[0].folded||nodes.at(-1).name!=='Null #'+(n-1))throw Error('Unexpected loaded fixture');
      const timings={},api=frameEngine,rawSave=api.saveHash,rawSync=api.syncObjects,rawHost=window.__frameFileHost;
      let started,indexed=0;
      const ms=()=>performance.now()-started,set=(key)=>{timings[key]??=ms();};
      api.syncObjects=function(...args){set('syncStart');try{return rawSync.apply(this,args);}finally{set('syncEnd');}};
      api.saveHash=function(sink){
        set('saveBegin');const indexRecord=sink.indexRecord,write=sink.write,close=sink.close;
        return rawSave.call(this,{...sink,indexRecord(...args){indexed++;if(indexed===1||indexed%1000===0)set('indexed'+indexed);return indexRecord(...args);},
          write(blob){set('firstSink');return write(blob);},
          close(){set('closeStart');return close();}});
      };
      window.__frameFileHost=async function(args){
        if(args.op==='write')set('firstHostWrite');
        const result=await rawHost(args);
        if(args.op==='write')set('firstHostReply');
        return result;
      };
      let receipt;
      try{started=performance.now();receipt=await frameAI.call('scene.saveAs',{path:output,createOnly:true});set('saveEnd');}
      finally{api.saveHash=rawSave;api.syncObjects=rawSync;window.__frameFileHost=rawHost;}
      const dataset=JSON.parse(c.dataset.hashSave);
      const oldHash=ids().at(-1),saved=await frameHostFileHandle(output).getFile();await frameEngine.loadFile(saved);
      if(ids().length!==n||ids().at(-1)!==oldHash||!nodes[0].folded||nodes.at(-1).name!=='Null #'+(n-1))throw Error('Reopened scene differs');
      return {timings,indexed,dataset,sha256:receipt.sha256,bytes:receipt.bytes,indexDigest:receipt.sync.baseVersion};
    },test);
    const bytes=await fs.readFile(test.output);
    assert.equal(result.sha256,digest(bytes));assert.equal(result.bytes,bytes.length);assert.match(result.indexDigest,/^[a-f0-9]{64}$/);
    assert.equal(result.indexed,result.dataset.records);assert.equal(result.bytes,result.dataset.storedBytes);
    assert(result.timings.firstHostWrite>=result.timings.firstSink);
    const same={n:test.n,inputSHA:test.inputSHA,bytes:result.bytes,sha256:result.sha256,indexDigest:result.indexDigest};
    if(baseline){
      const expected=baseline.rows.find(x=>x.n===test.n);assert(expected,'Reference run lacks case');
      for(const [k,v] of Object.entries(same))assert.equal(v,expected[k],k+' differs at '+test.n);
    }
    rows.push({...same,...result});
  }
  const injected=await app.page.evaluate(async path=>{
    const old=window.__frameFileHost,ops=[];
    window.__frameFileHost=async args=>{ops.push(args.op);if(args.op==='write')throw Error('Injected first host write failure');return old(args);};
    let error;
    try{await frameAI.call('scene.saveAs',{path,createOnly:true});}catch(e){error=e.message;}
    finally{window.__frameFileHost=old;}
    return {error,ops};
  },aborted);
  assert.match(injected.error,/Injected first host write failure/);assert(injected.ops.includes('abort'));assert(!injected.ops.includes('finish'));
  await assert.rejects(fs.stat(aborted),{code:'ENOENT'});
  assert(!(await fs.readdir(dir)).some(name=>name.endsWith('.tmp')),'Atomic failure must not leave a temporary file');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({indexSHA256:expectedIndex,rows,injected}));
}finally{try{await host?.close();}finally{try{await app?.close();}finally{await fs.rm(dir,{recursive:true,force:true});}}}
