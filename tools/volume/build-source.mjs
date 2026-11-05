// Generated binaries and loader have one authored C++ source in index.html.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const path='index.html',raw=await readFile(path,'utf8'),html=raw.replaceAll('\r\n','\n');
const match=html.match(/<script id="frame-volume-kernel" type="application\/x-c\+\+">\r?\n([\s\S]*?)<\/script>/);
if(!match)throw Error('Missing authored volume source');
await mkdir('work/volume-build',{recursive:true});
if(process.argv[2]==='extract'){
 if(html!==raw)await writeFile(path,html);
 await writeFile('work/volume-build/frame-volume.cpp',match[1]);
}else if(process.argv[2]==='package'){
 const compiledSource=await readFile('work/volume-build/frame-volume.cpp','utf8');
 if(compiledSource!==match[1])throw Error('Authored volume source changed during compilation; rebuild before packaging');
 const binary=await readFile('work/volume-build/frame-volume.wasm'),module=(await readFile('work/volume-build/frame-volume.mjs','utf8')).replaceAll('\r\n','\n');
 const hash=digest(binary),asset='kernels/volume-'+hash.slice(0,20)+'.wasm';
 await mkdir('kernels',{recursive:true});await writeFile(asset,binary);
 const data={asset,sha256:hash,sourceSHA256:digest(match[1]),bytes:binary.length};
 const content='<script id="frame-volume-module" type="text/plain" data-asset="'+asset+'" data-sha256="'+hash+'" data-source-sha256="'+digest(match[1])+'">\n'+module.replaceAll('</script','<\\/script')+'\n</script>\n';
 const old=/<script id="frame-volume-module"[^>]*>[\s\S]*?<\/script>\r?\n/;
 const next=old.test(html)?html.replace(old,content):html.replace('<script id="frame-volume-kernel"',content+'<script id="frame-volume-kernel"');
 const swPath='frame-sw.js',sw=await readFile(swPath,'utf8');
 const core=sw.match(/const CORE=(\[[^;]+\]);/);
 if(!core)throw Error('Missing service worker core assets');
 const paths=JSON.parse(core[1].replaceAll("'",'"')).filter(p=>!p.startsWith('kernels/volume-'));
 paths.push(asset);
 await writeFile(path,next);await writeFile(swPath,sw.replace(core[0],'const CORE='+JSON.stringify(paths)+';'));
 await writeFile('work/volume-build/manifest.json',JSON.stringify(data,null,2)+'\n');
 console.log(JSON.stringify(data));
}else throw Error('Use extract or package');
