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
assert.ok(!/\bstroke(?:-width)?=/.test(printer));assert.match(printer,/<path fill-rule="evenodd"/);assert.match(printer,/M6 20h3v-2h4v-6h-1v-1h3V9h-1V8h4v1h-1v2h5v1h-1v5\.5l5-2\.5q-1 6-6 10H9z/);checks.push('Printer: filled Benchy silhouette, native integer-grid edges, low stern, high curved bow and chimney');
assert.match(printer,/M15 20v-4a2 2 0 0 1 4 0v2\.5q-2 1\.5-4 1\.5zM24 18a1 1 0 1 0-2 0a1 1 0 1 0 2 0z/);checks.push('Printer: transparent arched passage and bow porthole inside the filled silhouette');
console.log(JSON.stringify({pass:true,checks,hardwareGPUValidated:false},null,2));
