import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
export async function syntax(root=new URL('../',import.meta.url)){
  const html=await readFile(new URL('index.html',root),'utf8'),folder=await mkdtemp(join(tmpdir(),'frame-syntax-'));
  try{let count=0,lazy=0,total=0;for(const [,attributes,source] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)){const inert=/type=["'](?:text\/plain|application\/)/.test(attributes);if(inert&&!/id=["']frame-(?:spline-kernel|spline-worker|geometry-kernel|boolean-worker|pathtracer)["']/.test(attributes))continue;if(inert)lazy++;else count++;const file=join(folder,`script-${total++}.js`);await writeFile(file,source);const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(result.status!==0)throw Error(result.stderr);}if(count!==2)throw Error(`Expected two executable script blocks, found ${count}`);return {scripts:count,lazyScripts:lazy};}finally{await rm(folder,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(await syntax());
