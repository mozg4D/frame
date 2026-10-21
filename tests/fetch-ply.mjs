import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const repo='mikedh/trimesh',rev=(await(await fetch(`https://api.github.com/repos/${repo}/commits/main`)).json()).sha;
const names=['bunny','cycloidal','featuretype','fixed_top','fuze','mirror','octagonal_pocket','sphere','suzanne','tet'];
const entries=[];await mkdir('tests/scenes/ply',{recursive:true});
for(const name of names){const url=`https://raw.githubusercontent.com/${repo}/${rev}/models/${name}.ply`,r=await fetch(url);if(!r.ok)throw Error(url);const b=Buffer.from(await r.arrayBuffer());await writeFile(`tests/scenes/ply/${name}.ply`,b);entries.push({name:name+'.ply',url,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});}
for(const [name,path] of [['dolphins','ascii/dolphins.ply'],['lucy','binary/Lucy100k.ply'],['dolphins-be','binary/dolphins_be.ply']]){const url=`https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/ply/${path}`,r=await fetch(url);if(!r.ok)throw Error(url);const b=Buffer.from(await r.arrayBuffer());await writeFile(`tests/scenes/ply/${name}.ply`,b);entries.push({name:name+'.ply',url,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});}
await writeFile('tests/scenes/ply/sources.json',JSON.stringify(entries,null,2));
for(const [repo,path,name] of [['mikedh/trimesh','LICENSE.md','TRIMESH-LICENSE.md'],['mrdoob/three.js','LICENSE','THREE-LICENSE']]){const r=await fetch(`https://raw.githubusercontent.com/${repo}/${repo.includes('three')?'dev':'main'}/${path}`);if(!r.ok)throw Error('License '+repo);await writeFile('tests/scenes/ply/'+name,await r.text());}
console.log(entries.map(e=>[e.name,e.bytes]));
