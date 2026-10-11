import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';

// Installed at editor-source/tests/edge-cache. An optional checkout argument is
// useful when reviewing this directory before copying it into the source tree.
const here=path.dirname(fileURLToPath(import.meta.url));
export const checkout=path.resolve(process.argv[2]??path.join(here,'../../..'));
export const sha=value=>createHash('sha256').update(value).digest('hex');
const pins={
 production:'2e5af192ec3642b662cb54e98483b224dc6f124a68709ad0d0cfdc76b0fb0c85',
 compact:'2e10321a8de53806ff34fc7591ce38353cd17a2812cecc6c95f0eefc41741eef',
 baseline:'4ab552e1b39abbd2b4bab7ebfdb8f6f9ae6245c862bcdd8e687a25e20e0b9463',
 three:'9edde002b066a9a05676a6127f67735b62baf399bdea529f2f7e31657da769e6'
};
function localPath(relative){
 assert.equal(typeof relative,'string','Manifest asset path is a string');
 assert.ok(!path.isAbsolute(relative)&&!relative.includes('\\'),'Relative portable manifest asset');
 const result=path.resolve(checkout,relative);
 assert.ok(result.startsWith(checkout+path.sep),'Manifest asset remains inside checkout');
 return result;
}
function reverse(source,file){
 const edits=JSON.parse(fs.readFileSync(new URL(file,import.meta.url),'utf8'));
 for(const edit of edits.slice().reverse()){
  assert.equal(source.split(edit.newText).length,2,'Unique reverse edit: '+edit.label);
  source=source.replace(edit.newText,edit.oldText);
 }
 return source;
}
const asModule=source=>import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
let loaded;
export async function loadInputs({withThree=false}={}){
 if(!loaded)loaded=(async()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(checkout,'editor-source/build-manifest.json'),'utf8'));
  const candidateSource=fs.readFileSync(localPath(manifest.productionNative),'utf8');
  assert.equal(sha(candidateSource),manifest.nativeSHA256,'Manifest production native SHA256');
  assert.equal(manifest.nativeSHA256,pins.production,'Reviewed r241 production native');
  if(manifest.nativeBytes!==undefined)assert.equal(Buffer.byteLength(candidateSource),manifest.nativeBytes,'Manifest production native bytes');
  const compactSource=reverse(candidateSource,'oracle/edge-metadata-edits.json');
  assert.equal(sha(compactSource),pins.compact,'Exact accepted compact-cache intermediate');
  const baseSource=reverse(compactSource,'oracle/compact-cache-edits.json');
  assert.equal(sha(baseSource),pins.baseline,'Exact original full baseline oracle');
  const threeSource=fs.readFileSync(localPath(manifest.threeCore),'utf8');
  assert.equal(sha(threeSource),pins.three,'Reviewed Three core from manifest');
  const [candidate,baseline]=await Promise.all([asModule(candidateSource),asModule(baseSource)]);
  const sourceModules={
   'native-pickers.mjs':['edgePickerTablesWork','FrameNativePickers','NativePickerSession','LatestNativePickerRequest'],
   'picker-ribbon.mjs':['ribbonShader','ribbonRegion','rankRibbonIds','FrameRibbonPicker'],
   'topology-islands.mjs':['buildTopologyWork','drainCooperatively'],
   'picker-depth.mjs':['pickerGeometryPacket'],
   'relative-frame.mjs':['relativeClipMatrices']
  };
  const sourceHashes={candidate:sha(candidateSource),manifestNative:manifest.nativeSHA256,compact:sha(compactSource),baseline:sha(baseSource),three:sha(threeSource),modules:{}};
  for(const [name,exports] of Object.entries(sourceModules)){
   const location=localPath('native-source/'+name),text=fs.readFileSync(location,'utf8');
   const source=await import(pathToFileURL(location));
   for(const exported of exports)assert.equal(source[exported].toString(),candidate[exported].toString(),'Production/source function binding: '+name+'#'+exported);
   if(name==='picker-ribbon.mjs')assert.equal(source.RIBBON_WGSL,candidate.RIBBON_WGSL,'Production/source ribbon shader binding');
   if(name==='native-pickers.mjs'){
    const start='function* compactEdgePickerTablesWork(',end='\nclass NativeEdgeTableCache';
    const section=s=>{const a=s.indexOf(start),b=s.indexOf(end,a);assert.ok(a>=0&&b>a,'Private compact declarations are present');return s.slice(a,b);};
    assert.equal(section(text),section(candidateSource),'Production/source private compact function binding');
   }
   sourceHashes.modules[name]=sha(text);
  }
  return {manifest,candidate,baseline,candidateSource,baseSource,threeSource,sourceHashes};
 })();
 const result=await loaded;
 return withThree?{...result,three:await asModule(result.threeSource)}:result;
}
