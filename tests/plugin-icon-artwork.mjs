import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const checks=[];
for(const [name,color]of [['thermal','#dc9c76'],['3d-printer','#92aaa4']]){
  const source=await readFile(new URL(`../plugins/${name}/icon.svg`,import.meta.url),'utf8');
  assert.match(source,/<svg\b[^>]*\bwidth="32"[^>]*\bheight="32"[^>]*\bviewBox="0 0 32 32"/);checks.push(`${name}: authored at native 32px`);
  assert.ok(!/\b(?:transform|style|href|filter)\s*=|<script|<image|<foreignObject/i.test(source));checks.push(`${name}: no scaling, embedded raster, script or external dependency`);
  assert.match(source,new RegExp(`(?:stroke|fill)="${color}"`));checks.push(`${name}: original palette`);
  assert.ok(source.length<750);checks.push(`${name}: bounded vector asset size`);
}
const thermal=await readFile(new URL('../plugins/thermal/icon.svg',import.meta.url),'utf8');
assert.match(thermal,/<svg[^>]*stroke-width="1"/);assert.match(thermal,/M7\.5 11\.5 16\.5 6\.5 25\.5 11\.5v10l-9 5-9-5z/);checks.push('Thermal: compact one-pixel cube on half-pixel stroke centers');
assert.match(thermal,/<path stroke-width="1.5" stroke-linecap="round" d="M12\.5 16\.5c-2 2 2 3 0 5M16\.5 16\.5c-2 2 2 3 0 5M20\.5 16\.5c-2 2 2 3 0 5"/);checks.push('Thermal: intermediate 4px heat-mark spacing, between the former 5px and 3px revisions; lower height and 1.5px stroke retained');
const printer=await readFile(new URL('../plugins/3d-printer/icon.svg',import.meta.url),'utf8');
assert.ok(!/\bstroke(?:-width)?=/.test(printer));assert.match(printer,/<path fill-rule="evenodd"/);assert.match(printer,/V7\.8q0-\.8 1-\.8t1 \.8v2l5-\.6/);assert.match(printer,/q2\.7-\.9 6-\.9\.6 0 \.5\.7c-\.3 3\.8-2\.7 7\.1-6\.5 8\.8H7\.2/);checks.push('Printer: filled silhouette with narrow round chimney, sloping roof and broad rounded bow');
assert.match(printer,/M15 18\.4v-4\.8c0-2\.2 3\.2-2\.2 3\.2-\.1L18 17\.6q-1\.5\.6-3 \.8zM25\.5 16\.2a\.5\.8 0 1 0-1 0a\.5\.8 0 1 0 1 0z/);checks.push('Printer: tall narrow transparent passage and small vertical bow porthole');
console.log(JSON.stringify({pass:true,checks,hardwareGPUValidated:false},null,2));
