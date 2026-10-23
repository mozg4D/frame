// Explicit refresh only. Normal tests never require the network or Python.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('scenes/dxf/',import.meta.url),files=JSON.parse(await readFile(new URL('sources.json',root)));
for(const f of files){const response=await fetch(f.url);if(!response.ok)throw Error(f.name+': HTTP '+response.status);const bytes=Buffer.from(await response.arrayBuffer());if(createHash('sha256').update(bytes).digest('hex')!==f.sha256)throw Error(f.name+': upstream digest changed');await writeFile(new URL(f.name,root),bytes);console.log(f.name);}
