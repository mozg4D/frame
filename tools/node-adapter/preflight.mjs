import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const root=path.dirname(fileURLToPath(import.meta.url));
const require=createRequire(import.meta.url);
const config=JSON.parse(fs.readFileSync(path.join(root,'package.json')));
if(process.platform!=='linux'||process.arch!=='x64')throw Error('Only Linux x86_64 is qualified');
if(Number(process.versions.node.split('.')[0])!==24)throw Error('Node 24.x required; tested with 24.22.1');
const dependencies={};
for(const [name,expected]of Object.entries(config.dependencies)){
 const resolved=require.resolve(name);
 if(!fs.realpathSync(resolved).startsWith(fs.realpathSync(path.join(root,'node_modules'))+path.sep))throw Error('Dependency resolved outside local installation: '+name);
 const metadata=JSON.parse(fs.readFileSync(path.join(root,'node_modules',...name.split('/'),'package.json')));
 if(metadata.version!==expected)throw Error(`Dependency version mismatch: ${name} ${metadata.version} expected ${expected}`);
 dependencies[name]=metadata.version;
}
// Load native addons now so missing ELF/ABI/system libraries fail before Frame runs.
await import('webgpu');require('@napi-rs/canvas');
console.log(JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,dependencies,
 glibc:process.report.getReport().header.glibcVersionRuntime,
 network:{httpsProxyConfigured:!!(process.env.HTTPS_PROXY||process.env.https_proxy),extraCACertificatesConfigured:!!process.env.NODE_EXTRA_CA_CERTS}},null,2));
