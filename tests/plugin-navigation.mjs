import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

export async function pluginNavigationChecks(){
 const source=await readFile(new URL('../index.html',import.meta.url),'utf8'),line=source.split('\n').find(line=>line.startsWith('  function dispatch(method,...args)')),checks=[];
 assert.ok(line,'Native plugin dispatcher exists');
 const dispatch=hooks=>vm.runInNewContext(line+';dispatch',{hooks:()=>hooks});
 const test=async(name,fn)=>{await fn();checks.push({name,pass:true});};
 await test('Navigation without providers returns no hit',async()=>assert.equal(await dispatch([])('navigation',1,2),null));
 await test('An asynchronous miss cannot intercept a later navigation provider',async()=>{const calls=[],hit={depth:4};const run=dispatch([{navigation:async(x,y)=>{calls.push([x,y]);return null;}},{navigation:async(x,y)=>{calls.push([x,y]);return hit;}}]);assert.equal(await run('navigation',17,23),hit);assert.deepEqual(calls,[[17,23],[17,23]]);});
 await test('All synchronous and asynchronous navigation hits compete by depth',async()=>{const near={depth:2},far={depth:9};assert.equal(await dispatch([{navigation:()=>far},{navigation:async()=>near},{navigation:async()=>({depth:5})}])('navigation'),near);});
 await test('Invalid navigation depths cannot win',async()=>{const hit={depth:3},invalid=[undefined,null,{depth:NaN},{depth:Infinity},{depth:0},{depth:-1},{depth:'1'}];assert.equal(await dispatch([...invalid.map(value=>({navigation:async()=>value})),{navigation:()=>hit}])('navigation'),hit);});
 await test('Equal-depth navigation keeps provider order',async()=>{const first={depth:2},second={depth:2};assert.equal(await dispatch([{navigation:async()=>first},{navigation:async()=>second}])('navigation'),first);});
 await test('Other plugin hooks retain their first handled result',()=>{const run=dispatch([{pick:()=>false},{pick:()=>42},{pick:()=>{throw Error('Unexpected extra handler');}}]);assert.equal(run('pick'),42);});
 await test('Navigation provider errors remain observable',async()=>{await assert.rejects(dispatch([{navigation:async()=>{throw Error('Navigation failed');}}])('navigation'),/Navigation failed/);});
 return {pass:true,checks,timings:[]};
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await pluginNavigationChecks(),null,2));
