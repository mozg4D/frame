import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const base=new URL('scenes/print-formats/',import.meta.url),sources=[],revisions=new Map();
async function revision(repo){if(!revisions.has(repo)){const r=spawnSync('git',['ls-remote','https://github.com/'+repo+'.git','HEAD'],{encoding:'utf8'}),rev=r.stdout?.split(/\s+/)[0];if(r.status||!/^\w{40}$/.test(rev))throw Error('Cannot resolve '+repo);revisions.set(repo,rev);}return revisions.get(repo);}
async function download(repo,path,format,name=path.split('/').pop()){const url=`https://raw.githubusercontent.com/${repo}/${await revision(repo)}/${path.split('/').map(encodeURIComponent).join('/')}`,r=await fetch(url);if(!r.ok)throw Error(url+' '+r.status);const bytes=Buffer.from(await r.arrayBuffer());await mkdir(new URL(format+'/',base),{recursive:true});await writeFile(new URL(format+'/'+name,base),bytes);sources.push({format,name:format+'/'+name,url,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});console.log(format+'/'+name,bytes.length);}
await mkdir(base,{recursive:true});
for(const name of ['250','brainImageSmooth','fran_cut','k','opal_mound_fault','plate','polyEx','t','usa','v'])await download('pyvista/data','Data/'+name+'.vtk','vtk');
for(const name of ['box','cube_gears','cylinder','dodeca_chain_loop','heartgears','multiple_cylinders','sphere','torus'])await download('3MFConsortium/3mf-samples','examples/core/'+name+'.3mf','3mf');
await download('3MFConsortium/lib3mf','SDK/Examples/Files/Helix.3mf','3mf');
await download('3MFConsortium/lib3mf','Tests/TestFiles/BuildItems/WagonWithWheels.3mf','3mf');
for(const name of ['pyramids','featuretype'])await download('mikedh/trimesh','models/'+name+(name==='featuretype'?'.3MF':'.3mf'),'3mf',name+'.3mf');
await download('3MFConsortium/3mf-samples','examples/production/box_prod.3mf','3mf');
for(const [repo,path,name] of [['pyvista/data','LICENSE','VTK-LICENSE'],['pyvista/data','VTKData.readme','VTKData.readme'],['3MFConsortium/3mf-samples','LICENSE','3MF-SAMPLES-LICENSE'],['3MFConsortium/lib3mf','LICENSE','LIB3MF-LICENSE'],['mikedh/trimesh','LICENSE.md','TRIMESH-LICENSE.md']]){const r=await fetch(`https://raw.githubusercontent.com/${repo}/${await revision(repo)}/${path}`);if(!r.ok)throw Error('Attribution '+repo+' '+r.status);await writeFile(new URL(name,base),await r.text());}
await writeFile(new URL('sources.json',base),JSON.stringify(sources,null,2)+'\n');
