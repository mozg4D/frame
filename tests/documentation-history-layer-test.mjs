// Bind the history adapter to the shipped embedded editor, without reconstructing old releases.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inlineSource,history} from './documentation-source.mjs';
import {verifyCurrentSource} from './current-source-baseline.mjs';

const raw=await readFile(new URL('../index.html',import.meta.url)),source=raw.toString('utf8').replaceAll('\r\n','\n'),checks=[];
assert.strictEqual(verifyCurrentSource('index.html',raw),raw);checks.push('History executes the exact current application bytes');
const embedded=source.match(/<script id="frame-documentation-editor" type="text\/plain">([\s\S]*?)<\/script>/)?.[1];
assert.equal(inlineSource,embedded);checks.push('Adapter extracts the shipped editor without rewriting its source');
assert.ok(inlineSource.includes(history.toString()));checks.push('Executable history helper comes verbatim from the embedded editor');
for(const changed of [Buffer.concat([raw,Buffer.from(' ')]),raw.subarray(1)])assert.throws(()=>verifyCurrentSource('index.html',changed),/Current source/);
checks.push('Added and removed source bytes reject');
console.log(JSON.stringify({pass:true,checks:checks.length,names:checks,sourceBindingOnly:true,behavioralChecks:'documentation-history*.mjs',hardwareGPUValidated:false}));
