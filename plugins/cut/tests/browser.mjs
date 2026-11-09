import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {launch} from '../../../tools/browser.mjs';
import {pluginChecks} from './index.mjs';
await mkdir(new URL('../../../tests/results/',import.meta.url),{recursive:true});
let session,result;
const paths=['index.html','plugins/index.json','plugins/cut/plugin.json','plugins/cut/plugin.js','plugins/cut/model.js','plugins/cut/viewport.js','plugins/cut/icon.svg','plugins/cut/tests/index.mjs','plugins/cut/tests/browser.mjs'];
const hash=async path=>createHash('sha256').update(await readFile(new URL('../../../'+path,import.meta.url))).digest('hex');
const before=Object.fromEntries(await Promise.all(paths.map(async path=>[path,await hash(path)])));
try{session=await launch({headless:process.argv.includes('--headless')});result=await pluginChecks(session.page);}catch(e){result={pass:false,error:e.stack};}finally{await session?.close();}
result.sources={};
for(const path of paths)result.sources[path]=await hash(path);
result.sourceStable=JSON.stringify(before)===JSON.stringify(result.sources);result.pass&&=result.sourceStable;
await writeFile(new URL('../../../tests/results/cut-authoring.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));process.exitCode=result.pass?0:1;
