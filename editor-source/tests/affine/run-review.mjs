import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {verifySource} from './verify-source.mjs';
const candidateHashes = verifySource();
const tests = JSON.parse(fs.readFileSync(new URL('./entrypoints.json', import.meta.url), 'utf8'));
const results = [];
for (const row of tests) {
  const child = spawnSync(process.execPath, [fileURLToPath(new URL(row.file, import.meta.url)), ...(row.args || [])], {
    encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024
  });
  let output;
  try { output = JSON.parse(child.stdout); } catch { output = child.stdout; }
  const pass = child.status === (row.expectedExit ?? 0) && !child.error && !child.signal;
  results.push({test: row.file, exitCode: child.status, pass, output,
    ...(child.stderr ? {stderr: child.stderr} : {}),
    ...(child.error ? {error: child.error.message} : {}),
    ...(child.signal ? {signal: child.signal} : {})});
  if (!pass) process.stderr.write(`FAIL ${row.file}\n`);
}
console.log(JSON.stringify({
  scope: 'Portable exact-source affine contracts. Node VM, actual generated Blob worker scripts in Node worker threads, and mocked renderer/queue controls. No browser, physical GPU, or performance acceptance.',
  candidateHashes, entrypoints: tests.length, pass: results.every(row => row.pass), results
}, null, 2));
if (results.some(row => !row.pass)) process.exitCode = 1;
