import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const take=(start,end)=>{const a=html.indexOf(start),b=html.indexOf(end,a+start.length);assert(a>=0&&b>a,start);return html.slice(a,b);};
const checks=[];
const check=(name,fn)=>{fn();checks.push({name,pass:true});};
const plain=value=>JSON.parse(JSON.stringify(value));
const boxSource=html.split('\n').find(line=>line.startsWith('    function transformedBox('));assert(boxSource);

check('Descendant traversal preserves authored depth-first order, reparenting and same-length reordering',()=>{
 const e={frameReadNodeIndex:null,nodes:[{id:'a',parent:null},{id:'b',parent:'a'},{id:'c',parent:'a'},{id:'d',parent:'b'},{id:'e',parent:'d'}],frameLoadNodes:()=>null};vm.createContext(e);vm.runInContext(take('const frameHierarchyIndices=', 'function frameLoadNodes(')+take('function descendants(id){','function roots('),e);
 assert.deepEqual(Array.from(e.descendants('a')),['b','d','e','c']);assert.deepEqual(Array.from(e.descendants('b')),['d','e']);
 e.nodes[4].parent='c';assert.deepEqual(Array.from(e.descendants('a')),['b','d','c','e']);[e.nodes[1],e.nodes[2]]=[e.nodes[2],e.nodes[1]];assert.deepEqual(Array.from(e.descendants('a')),['c','e','b','d']);
 e.nodes[0].parent='e';assert.deepEqual(Array.from(e.descendants('a')),['c','e','b','d']);
});
check('A completed 10000-owner subtree traversal reads the authoring array once',()=>{
 let reads=0;const rows=Array.from({length:10000},(_,i)=>({id:'n'+i,parent:i?'n'+((i-1)>>1):null})),nodes=new Proxy(rows,{get:(target,key,receiver)=>{if(typeof key==='string'&&/^\d+$/.test(key))reads++;return Reflect.get(target,key,receiver);}}),e={frameReadNodeIndex:null,nodes,frameLoadNodes:()=>null};vm.createContext(e);vm.runInContext(take('const frameHierarchyIndices=', 'function frameLoadNodes(')+take('function descendants(id){','function roots('),e);const result=e.descendants('n0');assert.equal(result.length,9999);assert.equal(new Set(result).size,9999);assert.equal(reads,10000);
});
check('One synchronous hierarchy read indexes 10000 owners once and releases on exceptions and between frames',()=>{
 let reads=0;const rows=Array.from({length:10000},(_,i)=>({id:'n'+i,parent:i?'n0':null})),e={nodes:new Proxy(rows,{get:(target,key,receiver)=>{if(typeof key==='string'&&/^\d+$/.test(key))reads++;return Reflect.get(target,key,receiver);}}),frameReadNodeIndex:null,frameLoadNodes:()=>null,window:{}};vm.createContext(e);vm.runInContext(take('function frameReadHierarchy(','function frameLoadNodes(')+html.split('\n').find(line=>line.startsWith('const children ='))+'\nfunction readChildren(id){return children(id);}',e);
 e.frameReadHierarchy(()=>{for(let i=0;i<10000;i++)e.readChildren('n'+i);const outer=e.frameReadNodeIndex;e.frameReadHierarchy(()=>assert.equal(e.frameReadNodeIndex.byParent,outer.byParent));assert.equal(e.frameReadNodeIndex,outer);});assert.equal(reads,20000);assert.equal(e.frameReadNodeIndex,null);rows[1].parent='n2';e.frameReadHierarchy(()=>assert.equal(e.readChildren('n2')[0],rows[1]));assert.equal(e.frameReadNodeIndex,null);assert.throws(()=>e.frameReadHierarchy(()=>{throw Error('render stopped');}),/render stopped/);assert.equal(e.frameReadNodeIndex,null);
});
check('Native affine bounds retain all corners under shear and reflection',()=>{
 const e={};vm.createContext(e);vm.runInContext(boxSource,e);
 const box={min:[0,-2,4],max:[3,1,9]},matrix=[1,2,0,0,-.5,1,3,0,2,0,-1,0,7,-4,5,1];assert.deepEqual(plain(e.transformedBox(box,matrix)),{min:[14.5,-6,-10],max:[29,3,4],center:[21.75,-1.5,-3]});
 for(let i=0;i<100;i++){const m=Array.from({length:16},(_,j)=>Math.sin(i*7+j*.37)*10),got=e.transformedBox(box,m),corners=[];for(const x of [0,3])for(const y of [-2,1])for(const z of [4,9])corners.push([0,1,2].map(j=>m[12+j]+m[j]*x+m[4+j]*y+m[8+j]*z));assert.deepEqual(Array.from(got.min),[0,1,2].map(j=>Math.min(...corners.map(p=>p[j]))));assert.deepEqual(Array.from(got.max),[0,1,2].map(j=>Math.max(...corners.map(p=>p[j]))));}
});
check('Displayed spline bounds reuse unchanged affine results and refresh after control, world and display replacement',()=>{
 const display={min:[0,0,0],max:[3,4,5]},e={splineDisplays:new Map([['s',display]]),world:[1,0,0,0,0,1,0,0,0,0,1,0,10,20,30,1],calls:0};e.objectWorld=()=>e.world;vm.createContext(e);vm.runInContext(boxSource,e);const native=e.transformedBox;e.transformedBox=(...args)=>{e.calls++;return native(...args);};vm.runInContext(take('    function splineBounds(','    function splineInFrame('),e);const first=e.splineBounds('s');for(let i=0;i<10000;i++)assert.equal(e.splineBounds('s'),first);assert.equal(e.calls,1);display.max[0]=7;assert.equal(e.splineBounds('s').max[0],17);e.world=[...e.world];e.world[12]=100;assert.equal(e.splineBounds('s').min[0],100);e.splineDisplays.set('s',{min:[-5,0,0],max:[0,1,2]});assert.equal(e.splineBounds('s').min[0],95);assert.equal(e.calls,4);e.splineDisplays.delete('s');assert.equal(e.splineBounds('s'),null);
});
check('Bulk bounds of10000 owners index mesh membership once without reading polygon geometry',()=>{
 let reads=0;const rows=Array.from({length:10000},(_,i)=>({hashId:'m'+i,splineGenerated:true,replicaMatrix:null,boundsMin:[i,-i,0],boundsMax:[i+1,0,2],get positions(){throw Error('No polygon readback');}})),e={flushReplicaPublication:()=>{},objectOccurrenceTransform:()=>null,scene:{meshes:new Proxy(rows,{get:(target,key,receiver)=>{if(typeof key==='string'&&/^\d+$/.test(key))reads++;return Reflect.get(target,key,receiver);}}),curveReplicas:[]},objectSelection:rows.map(m=>m.hashId),cloudBounds:()=>null,pluginBounds:()=>null,frameNodeByHash:()=>({type:'mesh'}),splineDisplays:new Map(),nativeValue:()=>new Uint8Array([1]),unionSelectionBounds:boxes=>{if(!boxes.length)return null;const min=[0,1,2].map(i=>Math.min(...boxes.map(b=>b.min[i]))),max=[0,1,2].map(i=>Math.max(...boxes.map(b=>b.max[i])));return {min,max,center:min.map((v,i)=>(v+max[i])/2)};}};vm.createContext(e);vm.runInContext(take('    function boundsOwnerIndex(','    function objectPivot('),e);assert.deepEqual(plain(e.objectBoundsUnion()),{min:[0,-9999,0],max:[10000,0,2],center:[5000,-4999.5,1]});assert.equal(reads,10000);assert.equal(e.objectBoundsUnion([]),null);
});

check('Canonical object notifications and structure restore index 10000 mesh rows once without repeated indexOf scans',()=>{
 let reads=0;const rows=Array.from({length:10000},(_,i)=>({hashId:'owner'+(i%5000),replicaMatrix:i%3===0?[1]:null})),scene={meshes:new Proxy(rows,{get(target,key,receiver){if(key==='indexOf')throw Error('No repeated mesh scan');if(typeof key==='string'&&/^\d+$/.test(key))reads++;return Reflect.get(target,key,receiver);}})},e={scene};vm.createContext(e);vm.runInContext(take('    function canonicalMeshIndices(','    function notifyObjects('),e);const index=e.canonicalMeshIndices();assert.equal(reads,10000);for(let i=0;i<rows.length;i++)if(!rows[i].replicaMatrix){const expected=rows.findLastIndex(m=>m.hashId===rows[i].hashId&&!m.replicaMatrix);assert.equal(index.get(rows[i].hashId),expected);}
});

const report={pass:true,checks,indexSHA256:createHash('sha256').update(html).digest('hex')};await mkdir(new URL('./results/',import.meta.url),{recursive:true});await writeFile(new URL('./results/zoo-metadata-work.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
