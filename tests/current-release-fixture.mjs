// Upgrade only the test corpus copy; the user's original fixture is read-only.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {H,codecSource} from './hash-codec-fixture.mjs';
const folder=new URL('./results/',import.meta.url),target=new URL('release-1000-current.hash',folder),receipt=new URL('release-1000-current-source.json',folder),sha=x=>createHash('sha256').update(x).digest('hex');
let pending;
export async function currentReleaseFixture({path=false}={}){
 pending??=(async()=>{
  const source=await readFile(new URL('./scenes/release-1000-10m.hash',import.meta.url)),sourceSHA256=sha(source),codecSHA256=sha(codecSource);
  try{const prior=JSON.parse(await readFile(receipt,'utf8')),bytes=await readFile(target);if(prior.sourceSHA256===sourceSHA256&&prior.codecSHA256===codecSHA256&&prior.outputSHA256===sha(bytes))return;}catch{}
  const file=new Blob([source]),index=await H.index(file),owners=await H.read(file,index.get(H.K.all)),parameters=new Set([H.K.parameters,...owners.map(id=>H.address(id,'parameters'))]),chunks=[];let converted=0;
  for(const [id,row]of index){if(parameters.has(id)&&row.type===H.T.text){const value=JSON.parse(await H.read(file,row));chunks.push((await H.pack({id,type:H.T.value,value})).blob);converted++;}else chunks.push(file.slice(row.offset-26,row.offset+row.length));}
  const bytes=new Uint8Array(await new Blob(chunks).arrayBuffer());await mkdir(folder,{recursive:true});await writeFile(target,bytes);await writeFile(receipt,JSON.stringify({sourceSHA256,codecSHA256,outputSHA256:sha(bytes),converted,owners:owners.length},null,2));
 })();await pending;return path?fileURLToPath(target):'tests/results/release-1000-current.hash';
}
