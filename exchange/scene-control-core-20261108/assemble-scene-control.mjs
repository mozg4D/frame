// Source-only Frame overlay assembler. Run in a new test workspace.
// Usage: node assemble-scene-control.mjs <baseline-directory> <output-directory> <packet.json.gz>
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const [baseArg,outArg,packetArg] = process.argv.slice(2);
assert.ok(baseArg && outArg && packetArg,'Supply baseline, empty output and packet paths');
const base = resolve(baseArg), out = resolve(outArg);
assert.notEqual(base,out,'Never overwrite the baseline checkout');
assert.ok(relative(base,out).startsWith('..') || isAbsolute(relative(base,out)), 'Output must be outside the baseline checkout');
try {await stat(out);throw Error('Output already exists; use a fresh path');} catch(e) {if(e.code !== 'ENOENT')throw e;}
const digest = (v,algorithm='sha256') => createHash(algorithm).update(v).digest('hex');
const blob = bytes => digest(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes]),'sha1');
const safePath = path => {assert.ok(typeof path === 'string' && path && !path.includes('\\') && !path.split('/').some(p => !p || p === '.' || p === '..') && !isAbsolute(path));return path;};
const packet = JSON.parse(gunzipSync(await readFile(packetArg),{maxOutputLength:16*1024*1024}));
assert.equal(packet.format,'frame-source-overlay-v1');
const buffers = new Map();
for (const row of packet.baseline) {
  safePath(row.path);assert.ok(!buffers.has(row.path),'Duplicate baseline path');
  const bytes = await readFile(resolve(base,row.path));
  assert.equal(blob(bytes),row.sha,'Baseline Git blob mismatch: '+row.path);buffers.set(row.path,bytes);
}
for (const row of packet.files) {
  safePath(row.path);const bytes = Buffer.from(row.base64,'base64');
  assert.equal(digest(bytes),row.sha256,'Overlay digest mismatch: '+row.path);buffers.set(row.path,bytes);
}
assert.equal(digest(buffers.get('index.html')),packet.runtimeSHA256);
for(const [path,bytes] of buffers) {const target=resolve(out,path);await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes);}
const rows=[];
for(const [path,bytes] of buffers) {const actual=await readFile(resolve(out,path));assert.ok(actual.equals(bytes),'Written byte mismatch: '+path);rows.push({path,sha256:digest(bytes),gitBlobSHA:blob(bytes)});}
await writeFile(resolve(out,'ASSEMBLED-SCENE-CONTROL.json'),JSON.stringify({format:packet.format,baseCommit:packet.baseCommit,runtimeSHA256:packet.runtimeSHA256,baselineFiles:packet.baseline.length,overlayFiles:packet.files.length,files:rows},null,2)+'\n');
console.log(JSON.stringify({pass:true,baseCommit:packet.baseCommit,runtimeSHA256:packet.runtimeSHA256,baselineFiles:packet.baseline.length,overlayFiles:packet.files.length,finalFiles:buffers.size,output:out}));
