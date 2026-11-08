// Reverse only the three matched Thermal release stamps; preserve all historical layers.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export const thermalSHA256=text=>createHash('sha256').update(text).digest('hex');
const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
export function thermalStampTime(stamp){
  assert.equal(typeof stamp,'string','Release stamp must be a string');
  const m=/^(\d{4}) (\d{2}) (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec) (\d{2}):(\d{2})$/.exec(stamp);
  assert.ok(m,'Exact release stamp format');
  const year=+m[1],day=+m[2],month=months.indexOf(m[3]),hour=+m[4],minute=+m[5],time=Date.UTC(year,month,day,hour,minute),date=new Date(time);
  assert.ok(year>=1000&&date.getUTCFullYear()===year&&date.getUTCMonth()===month&&date.getUTCDate()===day&&date.getUTCHours()===hour&&date.getUTCMinutes()===minute,'Valid release stamp');
  return time;
}
export function thermalStampText(path,stamp){
  thermalStampTime(stamp);
  if(path==='index.html')return '<meta name="frame-version" content="'+stamp+'">\n<title>Frame '+stamp+'</title>\n';
  assert.equal(path,'frame-sw.js','Only index and service-worker stamps are permitted');
  return "const VERSION='"+stamp+"',CACHE='frame-native-'+VERSION,ROOT=self.registration.scope;\n";
}
export function assertThermalStamp(path,text,stamp){
  const anchors=path==='index.html'?['<meta name="frame-version" content="','<title>Frame ']:["const VERSION='"];
  for(const anchor of anchors)assert.equal(text.split(anchor).length-1,1,'Unique Thermal stamp anchor: '+path+' '+anchor);
  assert.equal(text.split(thermalStampText(path,stamp)).length-1,1,'Matched Thermal release stamp: '+path);
}
export function thermalBase(path,text,layer){
  assert.equal(layer.format,'frame-thermal-stamp-layer-v1');
  assert.match(layer.baseCommit,/^[0-9a-f]{40}$/,'Exact predecessor commit');
  assert.ok(thermalStampTime(layer.releaseVersion)>thermalStampTime(layer.baseVersion),'Thermal release stamp must increase');
  assert.deepEqual(Object.keys(layer.files).sort(),['frame-sw.js','index.html'],'Only two stamp-bearing files');
  for(const [file,entry] of Object.entries(layer.files)){
    assert.match(entry.baseSHA256,/^[0-9a-f]{64}$/,'Exact predecessor SHA-256: '+file);
    assert.match(entry.releaseSHA256,/^[0-9a-f]{64}$/,'Exact release SHA-256: '+file);
    assert.deepEqual(entry.patches,[{before:thermalStampText(file,layer.baseVersion),after:thermalStampText(file,layer.releaseVersion),count:1}],'Version-only Thermal patch: '+file);
  }
  if(!Object.hasOwn(layer.files,path))return text;
  const entry=layer.files[path],patch=entry.patches[0];
  assertThermalStamp(path,text,layer.releaseVersion);
  assert.equal(thermalSHA256(text),entry.releaseSHA256,'Raw Thermal source SHA-256: '+path);
  const base=text.replace(patch.after,patch.before);
  assertThermalStamp(path,base,layer.baseVersion);
  assert.equal(thermalSHA256(base),entry.baseSHA256,'Thermal predecessor SHA-256: '+path);
  return base;
}
