import {thermalUIBase} from './thermal-ui-binding.mjs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {selectionGizmoBase,selectionGizmoLayer as layer} from './selection-gizmo-binding.mjs';
import {programBase,programLayer} from './scene-program-binding.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex'),checks=[];
assert.equal(layer.format,'frame-selection-gizmo-layer-v1');assert.equal(layer.baseCommit,'7237cc82925dbaf934d1bb5627673bd2aaaa62e1');assert.equal(layer.timeZone,'Europe/Moscow');assert.deepEqual(Object.keys(layer.files),['index.html','frame-sw.js']);
for(const [path,file]of Object.entries(layer.files)){
 const text=thermalUIBase(path,await readFile(new URL('../'+path,import.meta.url),'utf8')),base=selectionGizmoBase(path,text);assert.equal(sha(base),programLayer.files[path].releaseSHA256);let round=base;for(const patch of file.patches){assert.equal(round.split(patch.before).length-1,patch.count);round=round.replace(patch.before,patch.after);}assert.equal(round,text);checks.push(path+': exact forward/reverse against released Scene bytes');
 assert.equal(sha(programBase(path,text)),programLayer.files[path].baseSHA256);assert.equal(programBase(path,base),programBase(path,text));checks.push(path+': historical Scene/Benchy chain preserved');
 for(const changed of [text+' ',text.replace(layer.releaseVersion,layer.baseVersion),text+file.patches[0].after]){assert.throws(()=>selectionGizmoBase(path,changed),/Exact selection gizmo runtime/);if(sha(changed)!==programLayer.files[path].releaseSHA256)assert.throws(()=>programBase(path,changed),/Exact Scene program runtime/);else assert.equal(programBase(path,changed),programBase(path,text));}checks.push(path+': mutated, duplicate and stale-stamped runtime rejected');
}
for(const [path,hash]of Object.entries(layer.immutableLayers))assert.equal(sha(await readFile(new URL('../'+path,import.meta.url))),hash,path);checks.push('Every predecessor proof layer is byte-identical');
assert.equal(selectionGizmoBase('unrelated.txt','unchanged'),'unchanged');checks.push('Unrelated files untouched');
console.log(JSON.stringify({pass:true,checks:checks.length,names:checks,version:layer.releaseVersion,hardwareGPUValidated:false},null,2));
