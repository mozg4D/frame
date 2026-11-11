// Native-size artwork contract; no Frame runtime or GPU is loaded by this test.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const ids=['cfd','optics','magneto'];
const originalCFD=[
 'M8.5 10.5 17.5 5.5l8 5v11l-9 5-8-5zM8.5 10.5l8 5 9-5M16.5 15.5v11',
 'M3.5 13.5h6m-6 5h10m-10 5h6M12.5 16.5l2 2-2 2'
];
const expectedCFD=[
 'M10.5 10.5 19.5 5.5l8 5v11l-9 5-8-5zM10.5 10.5l8 5 9-5M18.5 15.5v11',
 'M5.5 13.5h6m-6 5h10m-10 5h6M14.5 16.5l2 2-2 2'
];
const originalLens='M14 4C10 10 10 22 14 28C18 22 18 10 14 4Z';
const expectedLens='M14 5C10 10.5 10 21.5 14 27C18 21.5 18 10.5 14 5Z';
const incoming='M3 8H9M3 16H9M3 24H9';
const expectedRays=incoming+'M19.5 8L29 16L19.5 24M19.5 16H29';
const magnetPaths=['M8 9h5v10a3 3 0 0 0 6 0V9h5v10a8 8 0 0 1-16 0Z','M8 6h5v4H8zm11 0h5v4h-5z'];
const paths=svg=>[...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map(m=>m[1]);
export function validatePluginIconAlignment(sources){
 const checks=[],check=(name,fn)=>{fn();checks.push({name,pass:true});};
 for(const id of ids){
  const source=sources[id];
  check(id+': native unscaled 32px vector',()=>{
   assert.match(source,/<svg\b[^>]*width="32"[^>]*height="32"[^>]*viewBox="0 0 32 32"/);
   assert.ok(!/\b(?:transform|style|href|filter)\s*=|<script|<image|<foreignObject/i.test(source));
   assert.ok(Buffer.byteLength(source)<750);
  });
 }
 check('CFD: all artwork is exactly 2px to the right with unchanged relative geometry',()=>assert.deepEqual(paths(sources.cfd),expectedCFD));
 check('CFD: original color and both native strokes retained',()=>{
  assert.match(sources.cfd,/stroke="#73adc7" stroke-width="1" stroke-linejoin="miter"/);
  assert.match(sources.cfd,/<path stroke-width="1.5" stroke-linecap="round"/);
 });
 check('Optics: lens height is 22px, centered at y=16; x controls unchanged',()=>{
  assert.equal(paths(sources.optics)[0],expectedLens);
  const old=originalLens.match(/-?\d+(?:\.\d+)?/g).map(Number),now=expectedLens.match(/-?\d+(?:\.\d+)?/g).map(Number);
  assert.deepEqual(now,old.map((n,i)=>i%2?(n-16)*22/24+16:n));
  assert.equal(Math.max(...now.filter((_,i)=>i%2))-Math.min(...now.filter((_,i)=>i%2)),22);
 });
 check('Optics: incoming rays and convergence point unchanged',()=>assert.deepEqual(paths(sources.optics),[expectedLens,expectedRays]));
 check('Optics: exactly 1px minimum clear stroke-to-stroke gap',()=>{
  assert.match(sources.optics,/stroke="#8fcbd6" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/);
  // Right cubic x(t)=14+12*t*(1-t), maximized at t=1/2, y=16.
  // All outgoing centerlines have x>=19.5; the middle round cap attains the bound.
  const lensRight=14+12*.5*(1-.5),rayLeft=19.5,halfStroke=1.5/2;
  assert.equal((rayLeft-halfStroke)-(lensRight+halfStroke),1);
 });
 check('Magneto: geometry and solid-fill rendering unchanged',()=>{
  assert.deepEqual(paths(sources.magneto),magnetPaths);assert.ok(!sources.magneto.includes('stroke='));
 });
 check('Magneto: each fill is exactly 8 RGB levels darker, with no opacity change',()=>{
  const colors=[...sources.magneto.matchAll(/fill="(#[\da-f]{6})"/g)].map(m=>m[1]);
  assert.deepEqual(colors,['#a57dbe','#cfc0d7']);assert.ok(!sources.magneto.includes('opacity'));
  for(const [i,before]of ['#ad85c6','#d7c8df'].entries())for(const p of [1,3,5])assert.equal(parseInt(before.slice(p,p+2),16)-parseInt(colors[i].slice(p,p+2),16),8);
 });
 return checks;
}
export async function pluginIconAlignmentChecks(){
 const sources=Object.fromEntries(await Promise.all(ids.map(async id=>[id,await readFile(new URL('../plugins/'+id+'/icon.svg',import.meta.url),'utf8')])));
 const started=performance.now(),checks=validatePluginIconAlignment(sources);
 const mutants=[
  ['CFD stale position','cfd',s=>expectedCFD.reduce((v,p,i)=>v.replace(p,originalCFD[i]),s)],
  ['CFD scaled SVG','cfd',s=>s.replace('<path','<path transform="translate(2 0)"')],
  ['Optics stale height','optics',s=>s.replace(expectedLens,originalLens)],
  ['Optics closed gap','optics',s=>s.replaceAll('19.5','18')],
  ['Optics incoming rays changed','optics',s=>s.replace('M3 8H9','M4 8H9')],
  ['Magneto stale color','magneto',s=>s.replace('#a57dbe','#ad85c6')],
  ['Magneto altered shape','magneto',s=>s.replace('M8 9','M7 9')]
 ];
 for(const [name,id,mutate]of mutants){assert.throws(()=>validatePluginIconAlignment({...sources,[id]:mutate(sources[id])}));checks.push({name:'Reject mutant: '+name,pass:true});}
 const completedMs=performance.now()-started;assert.ok(completedMs<250,'Native icon source contracts and negative controls complete below 250ms');
 return {pass:true,checks,completedMs,hardwareGPUValidated:false,browserRasterValidated:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await pluginIconAlignmentChecks(),null,2));
