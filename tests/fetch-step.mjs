import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('scenes/step/',import.meta.url),repo='kovacsv/occt-import-js',revision='41e470890ae0f9dc69ac50ffd5fc73e03576f4eb',sources=[];
await mkdir(root,{recursive:true});
for(const path of ['simple-basic-cube/cube.stp','cube-10x10mm/Cube 10x10.stp','cube-fcstd/cube.step','cube-fcstd/cube2.step','cube-fcstd/cube3.step','cube-units/cube-in.step','cube-units/cube-m.step','cube-units/cube-mm.step','conical-surface/conical-surface.step','rounded-cube/rounded-cube.step','cax-if/io1-cm-214.stp','cax-if/io1-tu-203.stp','cax-if/sg1-c5-214.stp']){
 const name=path.replaceAll('/','-').replaceAll(' ','-'),url=`https://raw.githubusercontent.com/${repo}/${revision}/test/testfiles/${path.split('/').map(encodeURIComponent).join('/')}`,r=await fetch(url);if(!r.ok)throw Error(url+': '+r.status);const bytes=Buffer.from(await r.arrayBuffer());await writeFile(new URL(name,root),bytes);sources.push({name,url,.../io1-tu/.test(name)?{expected:'reject'}:/io1-cm/.test(name)?{expected:'polygon'}:{},bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});console.log(name,bytes.length);
}
const license=await fetch(`https://raw.githubusercontent.com/${repo}/${revision}/LICENSE.md`);if(!license.ok)throw Error('License');await writeFile(new URL('LICENSE.md',root),await license.text());await writeFile(new URL('sources.json',root),JSON.stringify(sources,null,2)+'\n');
