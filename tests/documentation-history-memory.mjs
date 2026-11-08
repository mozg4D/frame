// CPU-only retention regression. A tiny history patch must not retain 128 old documents.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {history} from '../core/documentation-history.mjs';
if(!global.gc){const r=spawnSync(process.execPath,['--expose-gc',fileURLToPath(import.meta.url)],{encoding:'utf8'});process.stdout.write(r.stdout);process.stderr.write(r.stderr);process.exit(r.status??1);}
const h=history(),size=1048576,start=500000;let text='x'.repeat(size);h.reset(text);text.charCodeAt(size-1);global.gc();const before=process.memoryUsage().heapUsed,t=performance.now();
for(let i=0;i<128;i++){const after=text.slice(0,start)+String.fromCharCode(65+i%26).repeat(32)+text.slice(start+32);h.record(text,after,{start,end:start+32},{start:start+32,end:start+32},'insertReplacementText',i);text=after;}
global.gc();const retained=process.memoryUsage().heapUsed-before,ms=performance.now()-t;assert.equal(h.state.undo,128);assert.equal(h.state.characters,8192);assert.ok(retained<16*1048576,`Patch history retains ${(retained/1048576).toFixed(2)} MiB`);assert.ok(ms<5000,'Completed memory regression within5000ms');
const lone='\ud800';h.reset('');h.record('',lone,{start:0,end:0},{start:1,end:1},'insertText');assert.equal(h.step().text,'');assert.equal(h.step(false).text,lone);
console.log(JSON.stringify({pass:true,entries:128,payloadCharacters:8192,retainedMiB:retained/1048576,budgetMiB:16,elapsedMs:ms,budgetMs:5000,loneSurrogatePreserved:true},null,2));
