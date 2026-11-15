// Repack the current native cubic font. No outline parser or JSON compatibility.
import {readFile,writeFile} from 'node:fs/promises';
import {gunzipSync,gzipSync} from 'node:zlib';
import {packTextFont} from './pack-text-font.mjs';

const target=new URL('../index.html',import.meta.url),source=await readFile(process.argv[2]||target,'utf8');
const start=source.indexOf('function createFrameHashCodec(){'),end=source.indexOf('const FrameHash=createFrameHashCodec();',start),codec=Function(source.slice(start,end)+'return createFrameHashCodec();')();
const kernel=source.match(/<script id="frame-spline-kernel" type="text\/plain">([\s\S]*?)<\/script>/)[1],K=Function('return ('+kernel+')')()();
const re=/(<script id="frame-spline-font" type="text\/plain">)([^<]+)/,before=Buffer.from(source.match(re)[2],'base64'),font=K.decodeTextFont(codec.openSnapshot(new Uint8Array(gunzipSync(before))));
const native=packTextFont(font),packed=gzipSync(codec.snapshot(native),{level:9}),html=await readFile(target,'utf8');
await writeFile(target,html.replace(re,(_,tag)=>tag+packed.toString('base64')));
console.log({characters:native.characterCount,sharedContours:native.contourCount,sourceSHA256:native.sourceSHA256,beforeBytes:before.length,bytes:packed.length});
