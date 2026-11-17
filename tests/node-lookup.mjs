import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export async function nodeLookupChecks(){
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),checks=[],timings=[];
 const check=(name,fn)=>{fn();checks.push({name,pass:true});};
 try{
  const start=html.indexOf('function createFrameNodeLookup('),end=html.indexOf('const frameLookupNode=',start);assert.ok(start>=0&&end>start);
  const factory=Function(html.slice(start,end)+';return createFrameNodeLookup;')();let nodes=[],reads=0;
  const indexed=list=>new Proxy(list,{get(target,key,receiver){if(typeof key==='string'&&/^\d+$/.test(key))reads++;return Reflect.get(target,key,receiver);}});
  const owners=Array.from({length:10000},(_,i)=>({id:'n'+i,nativeHash:i.toString(16).padStart(32,'0'),parent:i?'n'+((i-1)>>1):null}));
  nodes=indexed(owners);const get=factory(()=>nodes);get('n0');reads=0;const at=performance.now();
  for(let pass=0;pass<4;pass++)for(let i=0;i<owners.length;i++){assert.equal(get(owners[i].id),owners[i]);assert.equal(get(owners[i].nativeHash,'nativeHash'),owners[i]);}
  const elapsed=performance.now()-at;timings.push({name:'80000 valid lookups in 10000 owners',ms:elapsed,numericArrayReads:reads});
  check('Warm valid owner lookups use one slot check each, independent of scene size',()=>assert.equal(reads,80000));
  check('All 10000 authored parents resolve using current owner records',()=>{for(let i=1;i<owners.length;i++)assert.equal(get(owners[i].parent),owners[(i-1)>>1]);});
  check('Reparented owner retains identity and current parent',()=>{owners[9].parent='n5';assert.equal(get('n9').parent,'n5');});
  check('Live native hash reassignment resolves new and retires old hash',()=>{const old=owners[9].nativeHash;owners[9].nativeHash='f'.repeat(32);assert.equal(get(owners[9].nativeHash,'nativeHash'),owners[9]);assert.equal(get(old,'nativeHash'),undefined);});
  check('Live ID reassignment resolves new and retires old key',()=>{owners[11].id='renamed';assert.equal(get('renamed'),owners[11]);assert.equal(get('n11'),undefined);});
  check('Same-length owner replacement invalidates cached slots',()=>{const removed=owners[12],replacement={id:'replacement',nativeHash:'e'.repeat(32),parent:null};nodes[12]=replacement;assert.equal(get(removed.id),undefined);assert.equal(get(replacement.id),replacement);assert.equal(get(replacement.nativeHash,'nativeHash'),replacement);});
  check('In-place reorder retains first-match identity',()=>{const first=owners[0],last=owners.at(-1);nodes.reverse();assert.equal(get(first.id),first);assert.equal(get(last.nativeHash,'nativeHash'),last);});
  check('Same-length document replacement drops all prior owners',()=>{nodes=[{id:'fresh',nativeHash:'d'.repeat(32),parent:null}];assert.equal(get('n0'),undefined);assert.equal(get('fresh'),nodes[0]);});
  check('Insertion and deletion refresh structural membership',()=>{const added={id:'added',nativeHash:'c'.repeat(32),parent:'fresh'};nodes.push(added);assert.equal(get('added'),added);nodes.splice(1,1);assert.equal(get('added'),undefined);});
  check('Combined references resolve IDs and hashes before name fallbacks',()=>{assert.equal(get('fresh',null),nodes[0]);assert.equal(get(nodes[0].nativeHash,null),nodes[0]);assert.equal(get('absent',null),undefined);});
  check('Unassigned hashes retain Array.find first-match semantics',()=>{nodes=[{id:'a'},{id:'b'}];assert.equal(get(undefined,'nativeHash'),nodes[0]);assert.equal(get(null),undefined);});
  return {pass:true,checks,timings};
 }catch(error){return {pass:false,checks,timings,error:error.stack};}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const report=await nodeLookupChecks();report.indexSHA256=createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex');await mkdir(new URL('./results/',import.meta.url),{recursive:true});await writeFile(new URL('./results/node-lookup.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));process.exitCode=report.pass?0:1;
}
