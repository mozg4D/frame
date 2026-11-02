// One-time conversion of a source Frame font to ordinary native spline cages.
// Supply an older index.html as argv[2]; no outline parser is shipped at runtime.
import {readFile,writeFile} from 'node:fs/promises';
import {gunzipSync,gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const source=await readFile(process.argv[2],'utf8'),target=new URL('../index.html',import.meta.url);
const font=JSON.parse(gunzipSync(Buffer.from(source.match(/<script id="frame-spline-font" type="text\/plain">([^<]+)/)[1],'base64')));
if(!font.glyphs)throw Error('Expected the original outline font');
const K=Function('return ('+source.match(/<script id="frame-spline-kernel" type="text\/plain">([\s\S]*?)<\/script>/)[1]+')')()();K.setFont(font);
const scale=100/font.resolution;
const splines=Object.fromEntries(Object.entries(font.glyphs).map(([char,glyph])=>{
 const {vertices,segments,sequences}=K.primitive('text',{text:char});return [char,{advance:glyph.ha*scale,vertices,segments,sequences}];
}));
const preset={version:1,sourceSHA256:createHash('sha256').update(JSON.stringify(font)).digest('hex'),font:{familyName:font.familyName,original_font_information:font.original_font_information},lineHeight:(font.boundingBox.yMax-font.boundingBox.yMin+font.underlineThickness)*scale,baseline:-(font.boundingBox.yMax+font.boundingBox.yMin)*scale/2,splines};
let html=await readFile(target,'utf8');html=html.replace(/(<script id="frame-spline-font" type="text\/plain">)[^<]+/,(_,tag)=>tag+gzipSync(JSON.stringify(preset),{level:9}).toString('base64'));await writeFile(target,html);
console.log(JSON.stringify({splines:Object.keys(splines).length,sourceSHA256:preset.sourceSHA256,bytes:gzipSync(JSON.stringify(preset),{level:9}).length}));
