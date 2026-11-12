// Exact source protection, independent of behavioral tests or a Git working tree.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url),sha=value=>createHash('sha256').update(value).digest('hex');
export async function textureDndSourceContractChecks(){
 const contract=JSON.parse(await readFile(new URL('texture-dnd-source-contract.json',import.meta.url),'utf8')),html=await readFile(new URL('index.html',root),'utf8'),checks=[];
 const verify=(name,value,row)=>{const bytes=Buffer.from(value);assert.equal(bytes.length,row.bytes,name+' byte length');assert.equal(sha(bytes),row.sha256,name+' SHA256');checks.push({name,pass:true});};
 for(const row of contract.regions){const start=html.indexOf(row.prefix),end=html.indexOf(row.nextPrefix,start+row.prefix.length);assert.ok(start>=0&&end>start,row.prefix+' region');verify((row.change?'Declared animation rollback extension ':'Unchanged main ')+row.prefix,html.slice(start,end),row);}
 for(const [path,row]of Object.entries(contract.files))verify('Unchanged input '+path,await readFile(new URL(path,root)),row);
 assert.ok(!html.includes('function framePruneGeneratedMaterials('));assert.ok(!html.includes('materialArchive'));checks.push({name:'No unpublished generated-material lifecycle dependency',pass:true});
 return {pass:true,baseCommit:contract.baseCommit,indexSHA256:sha(html),checks,sourceBindingOnly:true,browserVerified:false,gpuVerified:false};
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await textureDndSourceContractChecks(),null,2));
