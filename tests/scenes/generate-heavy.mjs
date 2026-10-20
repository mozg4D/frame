import {launch,ready} from '../../tools/browser.mjs';
import {readFile,stat,open,mkdir} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {fileURLToPath} from 'node:url';
globalThis.crypto??=webcrypto;
const destination=new URL('stress-mesh-100m.hash',import.meta.url);
export async function ensureHeavyScene({output=destination}={}){
 try{await stat(output);return {existing:true,path:fileURLToPath(output)};}catch{}
 const sourceNames=['tst.stl','test.stl'];let source;for(const name of sourceNames)try{await stat(new URL(name,import.meta.url));source=name;break;}catch{}
 if(!source)throw Error('Place tst.stl or test.stl in tests/scenes to build the 64-copy fixture');
 const session=await launch({headless:false}),rawPath=new URL('../results/heavy-source.bin',import.meta.url);let raw;
 try{await ready(session.page);await session.page.evaluate(url=>frameAI.call('scene.open',{url}),'tests/scenes/'+source);const download=session.page.waitForEvent('download');await session.page.evaluate(async()=>{const n=(await frameAI.call('scene.inspect')).objects.find(n=>n.mesh),raw=await frameEngine.readGeometry(n.hash),header=new Uint32Array([raw.vertices.length,raw.indices.length]),blob=new Blob([header,raw.vertices,raw.indices]),link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='heavy-source.bin';link.click();});await mkdir(new URL('../results/',import.meta.url),{recursive:true});await (await download).saveAs(fileURLToPath(rawPath));raw=await readFile(rawPath);}finally{await session.close();}
 const counts=new Uint32Array(raw.buffer,raw.byteOffset,2),vertices=new Float32Array(counts[0]),indices=new Uint32Array(counts[1]);new Uint8Array(vertices.buffer).set(raw.subarray(8,8+vertices.byteLength));new Uint8Array(indices.buffer).set(raw.subarray(8+vertices.byteLength));for(let i=0;i<vertices.length;i++)vertices[i]*=1000;
 const html=await readFile(new URL('../../index.html',import.meta.url),'utf8'),code=html.slice(html.indexOf('function createFrameHashCodec(){'),html.indexOf('const FrameHash=createFrameHashCodec();')),H=Function(code+';return createFrameHashCodec()')(),{K,T}=H,ids=Array.from({length:64},()=>H.newId()),file=await open(output,'wx'),write=async(id,type,value)=>{const {blob}=await H.pack({id,type,value});for await(const chunk of blob.stream())await file.write(chunk);};
 try{await write(K.version,T.uint32,new Uint32Array([1]));await write(K.all,T.ids,ids);for(let i=0;i<ids.length;i++){const id=ids[i];await write(H.address(id,'name'),T.text,'STL copy '+String(i+1).padStart(2,'0'));await write(H.address(id,'matrix'),T.float64,Float64Array.from([1,0,0,0,1,0,0,0,1,(i%8-3.5)*4000,0,(Math.floor(i/8)-3.5)*4000]));await write(H.address(id,'positions'),T.float32,vertices);await write(H.address(id,'indices'),T.uint32,indices);if(i%8===7)console.log('[heavy fixture] '+(i+1)+' / 64 independent copies');}}finally{await file.close();}
 return {existing:false,path:fileURLToPath(output),objects:64,scale:1000,triangles:indices.length/3*64,bytes:(await stat(output)).size};
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(await ensureHeavyScene());
