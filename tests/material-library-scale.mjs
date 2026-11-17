import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {H} from './hash-codec-fixture.mjs';
import {launch,ready} from '../tools/browser.mjs';

const option=name=>process.argv.find(arg=>arg.startsWith('--'+name+'='))?.slice(name.length+3);
const count=Number(option('count')||12000),reference=process.argv.includes('--reference');
assert(Number.isInteger(count)&&count>=256&&count<=50000);
const id=name=>createHash('sha256').update('frame-material-shelf:'+name).digest('hex').slice(0,32);
const hashes=Array.from({length:count},(_,i)=>id(i.toString())),owner=id('owner'),tag=id('tag');
const {K,T}=H,records=[],put=(address,type,value)=>records.push({id:address,type,value});
const field=(hash,key,type,value)=>put(H.address(hash,key),type,value);
put(K.version,T.uint32,new Uint32Array([1]));put(K.all,T.ids,[owner]);put(K.materials,T.ids,hashes);
field(owner,'type',T.bytes,new Uint8Array([0]));field(owner,'name',T.text,'Catalog reference');
field(owner,'matrix',T.float64,Float64Array.of(1,0,0,0,1,0,0,0,1,0,0,0));
field(owner,'tags',T.ids,[tag]);field(tag,'material',T.ids,[hashes.at(-1)]);
for(const [i,hash] of hashes.entries()){
 field(hash,'name',T.text,'Finish '+i);
 field(hash,'parameters',T.float64,Float64Array.of(i%360,65,30+i%40,0,35,7,0,0));
}
const parts=[];
for(let i=0;i<records.length;i+=128)parts.push(...await Promise.all(records.slice(i,i+128).map(async r=>(await H.pack(r)).blob)));
const bytes=Buffer.from(await new Blob(parts).arrayBuffer());
const source=await readFile(option('source')||new URL('../index.html',import.meta.url),'utf8');
const out=resolve(option('output')||fileURLToPath(new URL('results/material-library-scale.json',import.meta.url)));
const session=await launch({headless:true}),{page}=session;
const report={pass:false,count,reference,sourceSHA256:createHash('sha256').update(source).digest('hex'),fixtureSHA256:createHash('sha256').update(bytes).digest('hex'),errors:[]};
try{
 await page.route('**/index.html',route=>route.fulfill({contentType:'text/html',body:source}));
 await page.reload();await ready(page);page.on('pageerror',err=>report.errors.push(err.message));
 await page.evaluate(()=>{
  window.__shelfPaints=new WeakSet();window.__shelfCount=0;
  const paint=renderMatToCanvas;
  renderMatToCanvas=function(ctx,...args){
   if(ctx.canvas.closest('#matList')&&!__shelfPaints.has(ctx.canvas)){__shelfPaints.add(ctx.canvas);__shelfCount++;}
   return paint(ctx,...args);
  };
 });
 const start=performance.now();
 await page.evaluate(base64=>frameAI.call('scene.open',{base64,name:'material-library.hash'}).then(()=>true),bytes.toString('base64'));
 report.openMs=performance.now()-start;
 report.hiddenPaints=await page.evaluate(()=>__shelfCount);
 assert(reference?report.hiddenPaints>=count:report.hiddenPaints<10,'opening the document while the material shelf is hidden');
 assert(await page.evaluate(([uid,hash])=>{
  const node=nodes.find(n=>n.nativeHash===hash),tag=node.tags.find(t=>t.kind==='material');
  return materials[tag.material].uid===uid;
 },[hashes.at(-1),owner]),'the last native material resolves to its UI slot');
 await page.locator('#tabMaterials').click();
 for(const index of [0,count-1]){
  const card=page.locator('#matList .mat-card').filter({has:page.locator('input[value="Finish '+index+'"]')});
  await card.scrollIntoViewIfNeeded();
  await page.waitForFunction(i=>{
   const canvas=document.querySelector('#matList input[value="Finish '+i+'"]').previousElementSibling;
   return __shelfPaints.has(canvas);
  },index);
  assert(await card.evaluate(el=>{
   const real=el.querySelector('canvas'),expected=document.createElement('canvas');
   expected.width=real.width;expected.height=real.height;
   renderMatToCanvas(expected.getContext('2d'),expected.width,expected.height,materials[+el.dataset.material],false);
   return expected.toDataURL()===real.toDataURL();
  }),'scrolled preview matches direct rendering');
  await card.click();assert.equal(await card.getAttribute('aria-pressed'),'true');
 }
 report.paintedAfterScroll=await page.evaluate(()=>__shelfCount);assert(reference||report.paintedAfterScroll<count/4);
 assert.deepEqual(report.errors,[]);report.pass=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{await session.close();await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
