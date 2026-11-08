import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const checks=[];
for(const [name,color]of [['thermal','#dc9c76'],['3d-printer','#92aaa4']]){
  const source=await readFile(new URL(`../plugins/${name}/icon.svg`,import.meta.url),'utf8');
  assert.match(source,/<svg\b[^>]*\bwidth="32"[^>]*\bheight="32"[^>]*\bviewBox="0 0 32 32"/);checks.push(`${name}: authored at native 32px`);
  assert.ok(!/\b(?:transform|style|href|filter)\s*=|<script|<image|<foreignObject/i.test(source));checks.push(`${name}: no scaling, embedded raster, script or external dependency`);
  assert.match(source,new RegExp(`stroke="${color}"`));assert.match(source,/<svg[^>]*stroke-width="1"/);checks.push(`${name}: original palette and one-pixel outline`);
  assert.ok(source.length<750);checks.push(`${name}: bounded vector asset size`);
}
const thermal=await readFile(new URL('../plugins/thermal/icon.svg',import.meta.url),'utf8');
assert.match(thermal,/M7\.5 11\.5 16\.5 6\.5 25\.5 11\.5v10l-9 5-9-5z/);checks.push('Thermal: newly drawn compact cube on half-pixel stroke centers');
assert.match(thermal,/<path stroke-width="1.5" stroke-linecap="round" d="M13\.5 16\.5c-2 2 2 3 0 5M16\.5 16\.5c-2 2 2 3 0 5M19\.5 16\.5c-2 2 2 3 0 5"/);checks.push('Thermal: three lower heat marks, 3px center spacing and 1.5px stroke, independently of the thin box');
const printer=await readFile(new URL('../plugins/3d-printer/icon.svg',import.meta.url),'utf8');
assert.match(printer,/M6\.5 20\.5h7q4 0 6-2l6-3q-1 5-5 9h-12z/);assert.match(printer,/M14\.5 11\.5v-3h2v3/);checks.push('Printer: Benchy high curved bow, low stern and smokestack, drawn directly at native size');
assert.match(printer,/M15\.5 20\.5v-5a1\.5 1\.5 0 0 1 3 0v4/);assert.match(printer,/M8\.5 20\.5v-2h4v2/);assert.match(printer,/<circle cx="23\.5" cy="18\.5" r=".75"/);checks.push('Printer: tall arched cabin passage, rear cargo box and bow porthole');
console.log(JSON.stringify({pass:true,checks,hardwareGPUValidated:false},null,2));
