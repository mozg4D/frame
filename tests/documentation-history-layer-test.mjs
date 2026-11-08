// Test the exact new Undo layer before replaying immutable historical proofs.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {historyBase,historyLayer} from './documentation-history-binding.mjs';
const sha=v=>createHash('sha256').update(v).digest('hex'),checks=[];
assert.equal(historyLayer.format,'frame-doc-history-layer-v1');assert.match(historyLayer.baseCommit,/^[a-f0-9]{40}$/);assert.deepEqual(Object.keys(historyLayer.files).sort(),['core/documentation-editor.mjs','frame-sw.js','index.html']);assert.deepEqual(Object.keys(historyLayer.newFiles),['core/documentation-history.mjs']);
for(const [path,entry]of Object.entries(historyLayer.files)){
 const raw=await readFile(new URL('../'+path,import.meta.url),'utf8'),base=historyBase(path,raw);
 assert.equal(sha(raw),entry.releaseSHA256);assert.equal(sha(base),entry.baseSHA256);checks.push(path+': exact new and predecessor bytes');
 let forward=base;for(const p of entry.patches){assert.equal(forward.split(p.before).length-1,p.count);forward=forward.replace(p.before,p.after);}assert.equal(forward,raw);checks.push(path+': exact forward round trip');
 assert.throws(()=>historyBase(path,raw+' '),/Exact Undo release source/);checks.push(path+': extra byte rejected');
 const saved=entry.baseSHA256;try{entry.baseSHA256='0'.repeat(64);assert.throws(()=>historyBase(path,raw),/Exact Undo predecessor/);}finally{entry.baseSHA256=saved;}checks.push(path+': incorrect predecessor rejected');
}
console.log(JSON.stringify({pass:true,checks:checks.length,names:checks,baseCommit:historyLayer.baseCommit}));
