// Source-string tests only: no browser, network, plugin discovery or runtime mutation.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {thermalBase,thermalSHA256,thermalStampText,assertThermalStamp,thermalStampTime} from './thermal-release-binding.mjs';
const root=new URL('../',import.meta.url),layer=JSON.parse(await readFile(new URL('tests/thermal-release-layer.json',root))),sources={},checks=[];
const check=(name,fn)=>{fn();checks.push(name);},clone=()=>JSON.parse(JSON.stringify(layer));
for(const path of ['index.html','frame-sw.js']){
  const raw=sources[path]=await readFile(new URL(path,root),'utf8'),entry=layer.files[path],patch=entry.patches[0],base=thermalBase(path,raw,layer);
  check(path+': exact current raw digest',()=>assert.equal(thermalSHA256(raw),entry.releaseSHA256));
  check(path+': exact predecessor digest',()=>assert.equal(thermalSHA256(base),entry.baseSHA256));
  check(path+': forward stamp round trip',()=>assert.equal(base.replace(patch.before,patch.after),raw));
  const anchors=path==='index.html'?['<meta name="frame-version" content="','<title>Frame ']:["const VERSION='"];
  for(const anchor of anchors){
    check(path+': missing '+anchor,()=>assert.throws(()=>thermalBase(path,raw.replace(anchor,''),layer),/Unique Thermal stamp anchor/));
    check(path+': duplicate '+anchor,()=>assert.throws(()=>thermalBase(path,raw+'\n'+anchor,layer),/Unique Thermal stamp anchor/));
    check(path+': predecessor missing '+anchor,()=>assert.throws(()=>assertThermalStamp(path,base.replace(anchor,''),layer.baseVersion),/Unique Thermal stamp anchor/));
    check(path+': predecessor duplicate '+anchor,()=>assert.throws(()=>assertThermalStamp(path,base+'\n'+anchor,layer.baseVersion),/Unique Thermal stamp anchor/));
  }
  check(path+': changed non-stamp byte',()=>assert.throws(()=>thermalBase(path,' '+raw.slice(1),layer),/Raw Thermal source SHA-256/));
  check(path+': wrong predecessor digest',()=>{const bad=clone();bad.files[path].baseSHA256='0'.repeat(64);assert.throws(()=>thermalBase(path,raw,bad),/Thermal predecessor SHA-256/);});
  check(path+': wrong release digest',()=>{const bad=clone();bad.files[path].releaseSHA256='0'.repeat(64);assert.throws(()=>thermalBase(path,raw,bad),/Raw Thermal source SHA-256/);});
  check(path+': mismatched stamp',()=>assert.throws(()=>thermalBase(path,raw.replace(patch.after,patch.before),layer),/Matched Thermal release stamp/));
  check(path+': non-stamp patch rejected',()=>{const bad=clone();bad.files[path].patches.push({before:'x',after:'y',count:1});assert.throws(()=>thermalBase(path,raw,bad),/Version-only Thermal patch/);});
  check(path+': empty patches rejected',()=>{const bad=clone();bad.files[path].patches=[];assert.throws(()=>thermalBase(path,raw,bad),/Version-only Thermal patch/);});
}
check('Index meta and title must match',()=>assert.throws(()=>thermalBase('index.html',sources['index.html'].replace('<title>Frame '+layer.releaseVersion,'<title>Frame '+layer.baseVersion),layer),/Matched Thermal release stamp/));
check('Service-worker stamp cannot lag behind index',()=>assert.throws(()=>thermalBase('frame-sw.js',sources['frame-sw.js'].replace(thermalStampText('frame-sw.js',layer.releaseVersion),thermalStampText('frame-sw.js',layer.baseVersion)),layer),/Matched Thermal release stamp/));
check('Unknown index and service-worker stamp fails closed',()=>{const unknown='9999 31 dec 23:59';for(const path of ['index.html','frame-sw.js'])assert.throws(()=>thermalBase(path,sources[path].replace(thermalStampText(path,layer.releaseVersion),thermalStampText(path,unknown)),layer),/Matched Thermal release stamp/);});
check('No-op version rejected',()=>{const bad=clone();bad.releaseVersion=bad.baseVersion;assert.throws(()=>thermalBase('index.html',sources['index.html'],bad),/must increase/);});
check('Extra source mutation cannot be encoded in this layer',()=>{const bad=clone();bad.files['core/other.mjs']=bad.files['index.html'];assert.throws(()=>thermalBase('index.html',sources['index.html'],bad),/Only two stamp-bearing files/);});
check('Invalid predecessor commit rejected',()=>{const bad=clone();bad.baseCommit='pending';assert.throws(()=>thermalBase('index.html',sources['index.html'],bad),/Exact predecessor commit/);});
check('Invalid calendar stamp rejected',()=>assert.throws(()=>thermalStampTime('2026 31 feb 12:00'),/Valid release stamp/));
check('Unrelated file passed unchanged for historical checks',()=>assert.equal(thermalBase('core/documentation-editor.mjs','unchanged sentinel',layer),'unchanged sentinel'));
console.log(JSON.stringify({pass:true,checks:checks.length,names:checks,baseCommit:layer.baseCommit,indexSHA256:thermalSHA256(sources['index.html']),serviceWorkerSHA256:thermalSHA256(sources['frame-sw.js'])}));
