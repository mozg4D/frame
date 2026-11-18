import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export async function splineDisplayLookupChecks(){
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),checks=[];
 const check=(name,fn)=>{fn();checks.push({name,pass:true});};
 try{
  const start=html.indexOf('    function createFrameSplineDisplayLookup('),end=html.indexOf('    const splineDisplayLookup=',start);assert.ok(start>=0&&end>start);
  const factory=Function(html.slice(start,end)+';return createFrameSplineDisplayLookup;')();
  const displays=new Map(),lookup=factory(displays),key=JSON.stringify,data=()=>({vertices:{a:[0,0,0],b:[2,0,0]},segments:{s:{a:'a',b:'b',ha:[0,0,0],hb:[0,0,0]}},approximation:{angle:10}});
  const make=(hash,cage=data())=>{const display={hash,data:cage,ranges:new Map([['s',{}]]),edgeKeys:new Map([['s',key([cage.vertices.a,cage.vertices.b,cage.segments.s.ha,cage.segments.s.hb,undefined,cage.approximation])]]),samples:new Map([['s',[[0,0,0],[2,0,0]]]])};displays.set(hash,display);lookup.set(display);return display;};
  const sampleStart=html.indexOf('  function surfaceDisplaySamples(data,'),sampleEnd=html.indexOf('  async function buildNow(',sampleStart);assert.ok(sampleStart>=0&&sampleEnd>sampleStart);
  const samples=Function('window','frameValueKey',html.split('\n').find(s=>s.startsWith('function frameSplineSegmentKey('))+'\n'+html.slice(sampleStart,sampleEnd)+';return surfaceDisplaySamples;')({frameEngine:{splineDisplaysForData:cage=>lookup.get(cage)}},key);
  const live=make('live');
  check('Current display samples use exact authored cage identity',()=>{assert.deepEqual(lookup.get(live.data),[live]);assert.equal(samples(live.data)[0][1],live.samples.get('s'));assert.equal(samples(structuredClone(live.data)),null);});
  check('Negative and positive lookup never scan unrelated displays',()=>{for(let i=0;i<10000;i++)make('unrelated'+i);displays.values=()=>{throw Error('Unexpected display scan');};assert.equal(samples(data()),null);assert.equal(samples(live.data)[0][1],live.samples.get('s'));});
  check('In-place control edits reject stale fingerprints',()=>{live.data.vertices.b[0]=3;assert.equal(samples(live.data),null);live.data.vertices.b[0]=2;assert.ok(samples(live.data));});
  check('Missing samples and topology mismatch are not reused',()=>{const saved=live.samples.get('s');live.samples.delete('s');assert.equal(samples(live.data),null);live.samples.set('s',saved);live.ranges.set('extra',{});assert.equal(samples(live.data),null);live.ranges.delete('extra');});
  check('Preview data replacement retires old identity without losing display ownership',()=>{const old=live.data,next=data();lookup.set(live,next);assert.deepEqual(lookup.get(old),[]);assert.deepEqual(lookup.get(next),[live]);assert.ok(samples(next));});
  check('A retired display cannot be reached through its old authored cage',()=>{displays.delete(live.hash);assert.deepEqual(lookup.get(live.data),[]);assert.equal(samples(live.data),null);});
  check('Same-owner replacement selects only the published complete display',()=>{const next=make(live.hash);assert.deepEqual(lookup.get(live.data),[]);assert.deepEqual(lookup.get(next.data),[next]);});
  check('Deletion of another shared display leaves the current registration',()=>{const shared=data(),one=make('one',shared),two=make('two',shared);lookup.delete(one);assert.deepEqual(lookup.get(shared),[two]);lookup.delete(two);assert.deepEqual(lookup.get(shared),[]);});
  check('Unpublished pending displays are excluded',()=>{const pending={hash:'pending',data:data()};lookup.set(pending);assert.deepEqual(lookup.get(pending.data),[]);});
  check('Document clear releases all identity registrations',()=>{const n=make('last');lookup.clear();assert.deepEqual(lookup.get(n.data),[]);});
  return {pass:true,checks};
 }catch(error){return {pass:false,checks,error:error.stack};}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const report=await splineDisplayLookupChecks();report.indexSHA256=createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex');await mkdir(new URL('./results/',import.meta.url),{recursive:true});await writeFile(new URL('./results/spline-display-lookup.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));process.exitCode=report.pass?0:1;
}
