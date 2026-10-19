// Rebuild the embedded freestanding WASM SIMD module. No runtime sidecars.
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const folder=await mkdtemp(join(tmpdir(),'frame-simd-'));
try{
 const output=join(folder,'kernels.wasm'),clang=process.env.CLANG||'clang';
 const result=spawnSync(clang,['--target=wasm32','-O3','-msimd128','-ffp-contract=off','-nostdlib','-Wl,--no-entry','-Wl,--export-memory','-Wl,--initial-memory=131072','-Wl,--max-memory=2147483648','-o',output,fileURLToPath(new URL('stl-simd.c',import.meta.url))],{encoding:'utf8'});
 if(result.status!==0)throw Error(result.stderr||result.error?.message||'clang failed');
 const path=new URL('../index.html',import.meta.url),html=await readFile(path,'utf8'),bytes=(await readFile(output)).toString('base64');
 const next=html.replace(/(const (?:code|bytes)=Uint8Array.from\(atob\(')[A-Za-z0-9+/=]+('\),c=>c.charCodeAt\(0\)\);)/g,(_,a,b)=>a+bytes+b);
 if(next===html)console.log('SIMD kernels unchanged');else {await writeFile(path,next);console.log('Embedded SIMD kernels updated');}
}finally{await rm(folder,{recursive:true,force:true});}
