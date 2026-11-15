import {readFile,writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {H} from './hash-codec-fixture.mjs';
import {packTextFont} from '../tools/pack-text-font.mjs';
import assert from 'node:assert/strict';

export async function textPresetChecks(){
 const checks=[],timings=[],check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});if(!pass)throw Error(name+': '+JSON.stringify(detail));};
 try{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),reference=JSON.parse(await readFile(new URL('scenes/text-glyph-reference.json',import.meta.url),'utf8')),kernel=html.match(/<script id="frame-spline-kernel" type="text\/plain">([\s\S]*?)<\/script>/)[1],font=H.openSnapshot(new Uint8Array(gunzipSync(Buffer.from(html.match(/<script id="frame-spline-font" type="text\/plain">([^<]+)/)[1],'base64')))),K=Function('return ('+kernel+')')()();K.setFont(font);
  const decoded=K.decodeTextFont(font);check('Compact native spline font retains original provenance and all character splines',font.version===2&&font.sourceSHA256===reference.fontSHA256&&Object.keys(decoded.splines).length===591&&font.numbers instanceof Float64Array&&font.characters instanceof Uint8Array);
  // Exact native control bytes from the independently stored font in commit 1b3689f.
  const controlHash=createHash('sha256'),meta=new DataView(new ArrayBuffer(16)),edgeBytes=new DataView(new ArrayBuffer(73));for(const [char,glyph]of Object.entries(decoded.splines)){meta.setUint32(0,char.codePointAt(0),true);meta.setFloat64(4,glyph.advance,true);meta.setUint32(12,glyph.contours.length,true);controlHash.update(new Uint8Array(meta.buffer));for(const contour of glyph.contours){controlHash.update(new Uint8Array(new Uint32Array([contour.length]).buffer));for(const edge of contour){[...edge.point,...edge.ha,...edge.hb].forEach((value,i)=>edgeBytes.setFloat64(i*8,value,true));edgeBytes.setUint8(72,edge.soft?1:0);controlHash.update(new Uint8Array(edgeBytes.buffer));}}}check('All 591 character splines preserve original Float64 control bytes',controlHash.digest('hex')==='98b4b25d0d3123b1675477661270bfbade1c48dbf17f023424ab6bc58d0ed0be');
  assert.deepEqual(K.decodeTextFont(packTextFont(decoded)),decoded);check('All shared controls retain exact Float64 values after repacking',true);
  const compressedBytes=Buffer.from(html.match(/<script id="frame-spline-font" type="text\/plain">([^<]+)/)[1],'base64').length;check('Compact font stays below 76 KB and shares repeated contours',compressedBytes<76000&&font.contourCount===744,{compressedBytes,sharedContours:font.contourCount});
  for(const invalid of [{...font,version:1},{...font,contours:font.contours.slice(0,-1)},{...font,characters:font.characters.slice(0,-1)},{...font,numbers:new Float64Array([NaN])}])assert.throws(()=>K.decodeTextFont(invalid));check('Malformed native font records reject before publication',true);
  const digest=data=>createHash('sha256').update(JSON.stringify(Object.values(data.segments).map(e=>[K.segmentPoints(data,e.id).map(p=>p.map(v=>Math.round(v*1e7)/1e7)),!!e.soft]))).digest('hex'),at=performance.now();
  for(const [char,expected]of Object.entries(reference.glyphs)){const data=K.primitive('text',{text:char});check('Original cubic geometry for '+JSON.stringify(char),Object.keys(data.segments).length===expected.segments&&digest(data)===expected.digest);}
  timings.push({name:'All 591 native spline presets, first use',ms:performance.now()-at,limit:10000});check('Complete font preset generation budget',timings.at(-1).ms<10000);
  for(const {text,curves}of reference.layouts){const data=K.primitive('text',{text}),actual=Object.values(data.segments).map(e=>({points:K.segmentPoints(data,e.id),soft:!!e.soft}));let error=0;for(let i=0;i<Math.min(curves.length,actual.length);i++)for(let j=0;j<4;j++)for(let k=0;k<3;k++)error=Math.max(error,Math.abs(actual[i].points[j][k]-curves[i].points[j][k]));check('Original multiline layout '+JSON.stringify(text),actual.length===curves.length&&error<1e-7&&actual.every((e,i)=>e.soft===curves[i].soft),{error,segments:actual.length});}
  const text='Frame O8B 0123456789 '.repeat(128),start=performance.now(),data=K.primitive('text',{text}),ms=performance.now()-start;timings.push({name:'2688-character prebuilt native Text spline',ms,limit:250});check('Large warm Text completes within 250 ms',ms<250&&Object.keys(data.segments).length>10000,{ms,segments:Object.keys(data.segments).length});
  // Mutation of a copied glyph must not alter its preset or other occurrences.
  const first=K.primitive('text',{text:'OO'}),id=Object.keys(first.segments)[0];first.segments[id].ha[0]+=1;first.vertices[first.segments[id].a][0]+=2;const fresh=K.primitive('text',{text:'O'});check('Preset copies own their controls and handles',digest(fresh)===reference.glyphs.O.digest);
  K.setFont(font);check('Replacing native spline font preserves geometry',digest(K.primitive('text',{text:'O'}))===reference.glyphs.O.digest);
  return{pass:true,checks,timings};
 }catch(e){return{pass:false,checks,timings,error:e.stack};}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const result=await textPresetChecks();await writeFile(new URL('results/text-presets.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify({pass:result.pass,checks:result.checks.length,timings:result.timings,error:result.error},null,2));process.exitCode=result.pass?0:1;}
