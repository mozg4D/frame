import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export async function selectedRootsChecks(){
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),checks=[],timings=[],check=(name,fn)=>{fn();checks.push({name,pass:true});};
 try{
  const a=html.indexOf('function createFrameNodeLookup('),b=html.indexOf('const frameLookupNode=',a),c=html.indexOf('function roots(ids){'),d=html.indexOf('function treeOrder(',c);assert.ok(a>=0&&b>a&&c>=0&&d>c);
  const lookupFactory=Function(html.slice(a,b)+';return createFrameNodeLookup;')();let nodes=[],visits=0;const get=lookupFactory(()=>nodes),roots=Function('node',html.slice(c,d)+';return roots;')(id=>{visits++;return get(id);});
  nodes=[{id:'a',parent:null},{id:'b',parent:'a'},{id:'c',parent:'b'},{id:'d',parent:null},{id:'e',parent:'missing'}];
  check('Selected descendants collapse under the nearest selected ancestor',()=>assert.deepEqual(roots(new Set(['c','a','b'])),['a']));
  check('Unselected intermediate owners do not break selected ancestry',()=>assert.deepEqual(roots(new Set(['c','a'])),['a']));
  check('Independent selected roots preserve input order',()=>assert.deepEqual(roots(new Set(['d','c'])),['d','c']));
  check('Missing owners and absent parents retain existing root semantics',()=>assert.deepEqual(roots(new Set(['missing','e'])),['missing','e']));
  check('Empty selection remains empty',()=>assert.deepEqual(roots(new Set()),[]));
  nodes=Array.from({length:10000},(_,i)=>({id:'n'+i,parent:i?'n'+(i-1):null}));visits=0;let at=performance.now();const all=roots(new Set(nodes.map(n=>n.id)));timings.push({name:'All 10000 selected owners in a deep hierarchy',ms:performance.now()-at,lookups:visits});
  check('Selecting all 10000 nested owners returns one root in linear lookups',()=>{assert.deepEqual(all,['n0']);assert.ok(visits<=20000);});
  nodes=Array.from({length:5000},(_,i)=>({id:'p'+i,parent:i?'p'+(i-1):null}));nodes.push(...Array.from({length:5000},(_,i)=>({id:'leaf'+i,parent:'p4999'})));visits=0;at=performance.now();const leaves=roots(new Set(nodes.slice(5000).map(n=>n.id)));timings.push({name:'5000 selected leaves sharing 5000 unselected ancestors',ms:performance.now()-at,lookups:visits});
  check('Shared unselected ancestry is traversed once per root selection calculation',()=>{assert.equal(leaves.length,5000);assert.ok(visits<=20000);});
  nodes=[{id:'x',parent:'y'},{id:'y',parent:'x'}];visits=0;
  check('Corrupt cyclic hierarchy is bounded instead of recursively overflowing',()=>{assert.deepEqual(roots(new Set(['x'])),['x']);assert.ok(visits<=4);});
  const nativeSource=html.split('\n').find(line=>line.includes('function selectedRoots(){'));
  const parents=new Map([['leaf','group'],['group','root'],['cloned',null]]),selection=[];let reads=0;
  const native=Function('objectSelection','transformParent',html.slice(c,d)+nativeSource+';return selectedRoots;')(selection,hash=>{reads++;return parents.get(hash);});
  check('Native empty and single-object gizmos read no parent records',()=>{assert.deepEqual(native(),[]);selection.push('leaf');assert.deepEqual(native(),['leaf']);assert.equal(reads,0);});
  check('Native transforms collapse selected ancestors and respect independent Cloner inputs',()=>{selection.push('root','cloned','leaf');assert.deepEqual(native(),['root','cloned']);assert.ok(reads<=5);});
  return {pass:true,checks,timings};
 }catch(error){return {pass:false,checks,timings,error:error.stack};}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const report=await selectedRootsChecks();report.indexSHA256=createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex');await mkdir(new URL('./results/',import.meta.url),{recursive:true});await writeFile(new URL('./results/selected-roots.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));process.exitCode=report.pass?0:1;
}
