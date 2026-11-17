import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export async function materialThumbnailCacheChecks(){
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),checks=[],timings=[];const check=(name,fn)=>{fn();checks.push({name,pass:true});};
 try{
  const a=html.indexOf('function frameMaterialThumbnailStamp('),b=html.indexOf('function renderTree(){',a);assert.ok(a>=0&&b>a);let encodes=0,draws=0;
  const materials=[{uid:'default',name:'Default',h:0,s:0,l:50,emm:0,rough:50,metal:0,opac:0,bump:0},{uid:'metal',name:'Metal',h:30,s:80,l:40,emm:0,rough:10,metal:100,opac:0,bump:0}],cache=new Map();
  const document={createElement:()=>({getContext:()=>({}),toDataURL:()=>`data:image/png;fixture,${++encodes}`})};
  const api=Function('materials','materialThumbnails','document','renderMatToCanvas',html.slice(a,b)+';return {thumbnail:materialThumbnail};')(materials,cache,document,()=>{draws++;});
  const first=api.thumbnail(0),at=performance.now();for(let i=0;i<10000;i++)assert.equal(api.thumbnail(0),first);timings.push({name:'10000 unchanged browser chips',ms:performance.now()-at,pngEncodes:encodes,previewDraws:draws});
  check('10000 unchanged material chips share one rendered PNG',()=>{assert.equal(encodes,1);assert.equal(draws,1);});
  check('Name-only editing preserves the rendered preview',()=>{materials[0].name='Renamed';assert.equal(api.thumbnail(0),first);assert.equal(encodes,1);});
  check('Undo/restoration object replacement preserves an unchanged visual fingerprint',()=>{materials[0]={...materials[0]};assert.equal(api.thumbnail(0),first);assert.equal(encodes,1);});
  const second=api.thumbnail(1);materials.reverse();
  check('Material reordering follows stable UIDs instead of stale numeric slots',()=>{assert.equal(api.thumbnail(0),second);assert.equal(api.thumbnail(1),first);assert.equal(encodes,2);});
  check('Every numeric preview input invalidates only the edited material',()=>{for(const field of ['h','s','l','emm','rough','metal','opac','bump']){const previous=api.thumbnail(1);materials[1][field]++;assert.notEqual(api.thumbnail(1),previous);assert.equal(api.thumbnail(0),second);}});
  check('Replacing a base-color image invalidates its preview',()=>{const before=api.thumbnail(1);materials[1].map={complete:false,naturalWidth:0,naturalHeight:0,currentSrc:'',src:'one.png'};assert.notEqual(api.thumbnail(1),before);});
  check('Asynchronous image completion invalidates the initially untextured preview',()=>{const before=api.thumbnail(1);Object.assign(materials[1].map,{complete:true,naturalWidth:128,naturalHeight:128,currentSrc:'one.png'});assert.notEqual(api.thumbnail(1),before);});
  check('Changing the source of the same decoded image invalidates the preview',()=>{const before=api.thumbnail(1);Object.assign(materials[1].map,{currentSrc:'two.png',src:'two.png'});assert.notEqual(api.thumbnail(1),before);});
  check('Opacity image readiness and selected channel invalidate the preview',()=>{let before=api.thumbnail(1);materials[1].opacityMap={complete:true,naturalWidth:128,naturalHeight:128,currentSrc:'mask.png',src:'mask.png'};assert.notEqual(api.thumbnail(1),before);before=api.thumbnail(1);materials[1].opacityChannel=2;assert.notEqual(api.thumbnail(1),before);});
  check('Removing textures restores a newly rendered untextured preview',()=>{const before=api.thumbnail(1);materials[1].map=null;materials[1].opacityMap=null;assert.notEqual(api.thumbnail(1),before);});
  check('Explicit texture refresh clears preview reuse',()=>{const before=api.thumbnail(0);cache.clear();assert.notEqual(api.thumbnail(0),before);});
  return {pass:true,checks,timings};
 }catch(error){return {pass:false,checks,timings,error:error.stack};}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const report=await materialThumbnailCacheChecks();report.indexSHA256=createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex');await mkdir(new URL('./results/',import.meta.url),{recursive:true});await writeFile(new URL('./results/material-thumbnail-cache.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));process.exitCode=report.pass?0:1;
}
