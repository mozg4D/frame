// Build-only sources. No library is downloaded by the application at runtime.
import {mkdir,readFile,writeFile,copyFile,access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';

const root=resolve('work/volume-deps');
const dependencies=JSON.parse(await readFile('tools/volume/dependencies.json','utf8'));
const git=(directory,...args)=>execFileSync('git',['-C',directory,...args],{encoding:'utf8',stdio:['ignore','pipe','inherit']}).trim();
await mkdir(root,{recursive:true});
for(const name of ['geogram','manifold','meshoptimizer']){
 const dependency=dependencies[name],directory=resolve(root,name);
 try{await access(resolve(directory,'.git'));}catch{
  await mkdir(directory,{recursive:true});git(directory,'init','--quiet');git(directory,'remote','add','origin',dependency.url);
 }
 if(git(directory,'remote','get-url','origin')!==dependency.url)throw Error('Unexpected dependency origin: '+name);
 try{git(directory,'cat-file','-e',dependency.commit+'^{commit}');}catch{git(directory,'fetch','--depth=1','origin',dependency.commit);}
 let current;try{current=git(directory,'rev-parse','HEAD');}catch{}
 if(current!==dependency.commit){
  if(current&&git(directory,'status','--porcelain'))throw Error('Modified build dependency: '+name);
  git(directory,'-c','core.autocrlf=false','checkout','--detach',dependency.commit);
 }
 if(name==='geogram')git(directory,'submodule','update','--init','--depth=1','--','src/lib/geogram/third_party/OpenNL','src/lib/geogram/third_party/amgcl','src/lib/geogram/third_party/libMeshb','src/lib/geogram/third_party/rply');
 if(name!=='meshoptimizer'){
  const patch=resolve('tools/volume/patches',name+'.patch');
  try{git(directory,'apply','--reverse','--check',patch);}catch{git(directory,'apply','--check',patch);git(directory,'apply',patch);}
 }
}
const platform=resolve(root,'geogram/cmake/platforms/Frame-wasm');
await mkdir(platform,{recursive:true});await copyFile('tools/volume/geogram-platform.cmake',resolve(platform,'config.cmake'));
await mkdir('work/volume-build',{recursive:true});
await import('./simplifier64.mjs');
console.log('Prepared pinned volume build sources.');
