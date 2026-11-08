import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const checks=[];
for(const [name,color]of [['thermal','#dc9c76'],['3d-printer','#92aaa4']]){
  const source=await readFile(new URL(`../plugins/${name}/icon.svg`,import.meta.url),'utf8');
  assert.match(source,/<svg\b[^>]*\bwidth="32"[^>]*\bheight="32"[^>]*\bviewBox="0 0 32 32"/);checks.push(`${name}: authored at native 32px`);
  assert.ok(!/\b(?:transform|style|href|filter)\s*=|<script|<image|<foreignObject/i.test(source));checks.push(`${name}: no scaling, embedded raster, script or external dependency`);
  assert.match(source,new RegExp(`stroke="${color}"`));assert.match(source,/stroke-width="1"/);assert.ok(!/stroke-width="(?!1")/.test(source));checks.push(`${name}: palette and one-pixel lines`);
  assert.ok(source.length<750);checks.push(`${name}: bounded vector asset size`);
}
const thermal=await readFile(new URL('../plugins/thermal/icon.svg',import.meta.url),'utf8');
assert.match(thermal,/M7\.5 11\.5 16\.5 6\.5 25\.5 11\.5v10l-9 5-9-5z/);checks.push('Thermal: newly drawn compact cube on half-pixel stroke centers');
assert.equal((thermal.match(/c-2 2 2 3 0 5/g)||[]).length,3);checks.push('Thermal: three independently positioned heat marks');
const printer=await readFile(new URL('../plugins/3d-printer/icon.svg',import.meta.url),'utf8');
assert.match(printer,/M6\.5 18\.5h15l4-2-1 5-3 3h-11l-3-2z/);assert.match(printer,/M12\.5 11\.5v-4h3v4/);checks.push('Printer: side-profile hull, cabin and smokestack, not a printer-frame rescale');
assert.match(printer,/a2 2 0 0 1 4 0/);assert.match(printer,/<circle cx="21\.5" cy="20\.5" r="1"/);checks.push('Printer: cabin window and bow porthole');
console.log(JSON.stringify({pass:true,checks,hardwareGPUValidated:false},null,2));
