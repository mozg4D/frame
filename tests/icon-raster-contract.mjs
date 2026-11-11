// Independent main artwork references. Only tests import this file or its fixture.
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
export const iconIds=['cfd','magneto','structural','optics','cut'];
const main='42f64a46d18f9a4a77c0c6e34ce92384b6d28fe0';
const pinned={cfd:'57a5604ce477e60f5cc60972db8c3a5d69cc9e4b3c60769e38bb5a9930488fd4',magneto:'e733e0b6b1c909f2d914e4a64c3555181cb4ec23e7e1f3631af0d074f0f44165',structural:'c12aedd9e3aefef5ceedbe390e47372efdf049ee7300dc8c623ca64d6d368069',optics:'0f08eab7388b8a2412d31b15ed161067940b23ffff693142df57224e582a1d29',cut:'c6af478ba10693b934d7604033fd7727611e2c3295bafe251e9085935fbed746'};
const hash=(data,kind='sha256')=>createHash(kind).update(data).digest('hex');
export async function iconRasterReferences(){
 const fixture=JSON.parse(await readFile(new URL('fixtures/icon-main-42f64a46.json',import.meta.url),'utf8'));
 assert.equal(fixture.format,'frame-native-icon-main-reference-v1');assert.equal(fixture.baseCommit,main);assert.deepEqual(Object.keys(fixture.icons),iconIds);
 for(const id of iconIds){const row=fixture.icons[id],bytes=Buffer.from(row.svg);assert.equal(row.path,`plugins/${id}/icon.svg`);assert.equal(bytes.length,row.bytes);assert.equal(hash(bytes),pinned[id]);assert.equal(row.sha256,pinned[id]);assert.equal(hash(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`),bytes]),'sha1'),row.gitBlob);}
 return fixture.icons;
}
export function deriveIconRasterExpectation(id,reference){
 let svg=reference.svg;
 if(id==='cfd')return {svg,dx:2,dy:0,contract:'Every reference RGBA pixel translated exactly two native pixels right; no crop.'};
 if(id==='magneto'){
  let fills=0;svg=svg.replace(/fill="(#[a-f0-9]{6})"/g,(_match,color)=>{fills++;const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)-8);assert.ok(rgb.every(v=>v>=0));return 'fill="#'+rgb.map(v=>v.toString(16).padStart(2,'0')).join('')+'"';});assert.equal(fills,2);
  return {svg,dx:0,dy:0,contract:'Reference geometry/alpha unchanged; each fill channel reduced exactly eight RGB levels before rasterization.'};
 }
 if(id==='optics'){
  const lens=[...svg.matchAll(/<path d="([^"]+)"/g)][0][1];let coordinate=0;
  const shorter=lens.replace(/-?\d+(?:\.\d+)?/g,n=>String(coordinate++%2?16+(Number(n)-16)*22/24:Number(n)));assert.equal(coordinate,14);
  const outgoing='M18 8L29 16L18 24M18 16H29';assert.equal(svg.split(outgoing).length,2);
  svg=svg.replace(lens,shorter).replace(outgoing,'M19.5 8L29 16L19.5 24M19.5 16H29');
  return {svg,dx:0,dy:0,contract:'Reference lens Y mapped by 16+(y-16)*22/24; only outgoing starts move from x18 to x19.5.'};
 }
 assert.ok(id==='structural'||id==='cut');return {svg,dx:0,dy:0,contract:'Complete RGBA identical to pinned main artwork.'};
}
// Project the semantic incoming component, not a rectangular crop of composed pixels.
// Preserve the actual SVG/group/path attributes and every incoming coordinate.
export function opticsIncomingComponent(svg){
 const paths=[...svg.matchAll(/<path\b[^>]*\/>/g)];assert.equal(paths.length,2,'Optics has the reviewed lens and ray paths');
 const attribute=paths[1][0].match(/\bd="([^"]+)"/);assert.ok(attribute,'Ray path has explicit geometry');
 const subpaths=attribute[1].match(/M[^M]*/g);assert.equal(subpaths?.length,5,'Three incoming and two outgoing subpaths');
 for(const d of subpaths.slice(0,3))assert.match(d,/^M-?\d+(?:\.\d+)?[ ,]+-?\d+(?:\.\d+)?H-?\d+(?:\.\d+)?$/,'Incoming rays remain horizontal absolute paths');
 const component=paths[1][0].replace(attribute[0],`d="${subpaths.slice(0,3).join('')}"`);
 return svg.replace(paths[0][0],'').replace(paths[1][0],component);
}
export function opticsIncomingMutants(svg){
 const component=opticsIncomingComponent(svg);
 const changes=[['first ray coordinate','M3 8H9','M4 8H9'],['middle ray coordinate','M3 16H9','M4 16H9'],['last ray coordinate','M3 24H9','M4 24H9'],['stroke width','stroke-width="1.5"','stroke-width="1.25"'],['palette','#8fcbd6','#9fcbd6'],['round cap removed','stroke-linecap="round"','stroke-linecap="butt"']];
 const variants=changes.map(([name,before,after])=>{const mutated=svg.replace(before,after);assert.notEqual(mutated,svg,name+' must mutate full source');const projected=opticsIncomingComponent(mutated);assert.notEqual(projected,component,name+' must survive actual component extraction');return {name:'incoming '+name,svg:projected};});
 const missing=component.replace('M3 16H9','');assert.notEqual(missing,component);variants.push({name:'incoming middle ray missing',svg:missing});return variants;
}
// Playwright serializes this complete function into the browser. It has no
// outside dependencies. Every variant still gets its own decode/draw/readback.
export async function renderIconRasterVariants({variants,dpr}){
 const started=performance.now(),rasters=[],size=32*dpr;let renderingMs=0,packingMs=0,transportedBytes=0;
 for(const {name,svg}of variants){
  const renderStarted=performance.now(),img=new Image();img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);await img.decode();
  const c=document.createElement('canvas');c.width=c.height=size;const ctx=c.getContext('2d');ctx.scale(dpr,dpr);ctx.drawImage(img,0,0);
  const bytes=ctx.getImageData(0,0,c.width,c.height).data;renderingMs+=performance.now()-renderStarted;
  const packingStarted=performance.now();let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  rasters.push({name,rgbaBase64:btoa(binary)});transportedBytes+=bytes.length;packingMs+=performance.now()-packingStarted;
 }
 return {rasters,renderedImages:rasters.length,transportedBytes,renderingMs,packingMs,browserCompletedMs:performance.now()-started};
}
export function decodeIconRasterVariants(result,variants,size){
 assert.equal(result.renderedImages,variants.length);assert.equal(result.rasters.length,variants.length);assert.equal(result.transportedBytes,variants.length*size*size*4);
 return result.rasters.map((row,i)=>{assert.equal(row.name,variants[i].name,'Raster order/name retained');assert.equal(typeof row.rgbaBase64,'string');const pixels=Buffer.from(row.rgbaBase64,'base64');assert.equal(pixels.length,size*size*4,'Complete RGBA byte payload');assert.equal(pixels.toString('base64'),row.rgbaBase64,'Canonical lossless raster transport');return {name:row.name,pixels};});
}
export function shiftRaster(data,width,height,dx=0,dy=0){
 assert.equal(data.length,width*height*4);assert.ok([width,height,dx,dy].every(Number.isInteger));const pixels=new Uint8Array(data.length);let clippedAlpha=0;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const from=(y*width+x)*4,xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=width||yy>=height){clippedAlpha+=data[from+3];continue;}const to=(yy*width+xx)*4;for(let k=0;k<4;k++)pixels[to+k]=data[from+k];}
 return {pixels,clippedAlpha};
}
export function rasterDifference(actual,expected){
 assert.equal(actual.length,expected.length);let differentChannels=0,maxDelta=0,firstChannel=-1;
 for(let i=0;i<actual.length;i++)if(actual[i]!==expected[i]){differentChannels++;maxDelta=Math.max(maxDelta,Math.abs(actual[i]-expected[i]));if(firstChannel<0)firstChannel=i;}
 return {equal:differentChannels===0,differentChannels,maxDelta,firstChannel};
}
export function alphaDifference(actual,expected){assert.equal(actual.length,expected.length);let count=0;for(let i=3;i<actual.length;i+=4)if(actual[i]!==expected[i])count++;return count;}
export function rasterBounds(data,width,height){let x0=width,y0=height,x1=-1,y1=-1;for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(data[(y*width+x)*4+3]){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}return [x0,y0,x1,y1];}
const translated=(svg,x,y)=>svg.replace(/(<svg\b[^>]*>)/,'$1<g transform="translate('+x+' '+y+')">').replace('</svg>','</g></svg>');
export function iconRasterMutants(id,candidate,reference){
 const mutate=(name,svg)=>{assert.notEqual(svg,candidate,name+' must actually mutate SVG');return {name,svg};};
 if(id==='cfd')return [mutate('stale horizontal position',reference.svg),mutate('one-pixel rather than two-pixel shift',translated(candidate,-1,0)),mutate('three-pixel rather than two-pixel shift',translated(candidate,1,0)),mutate('vertical displacement',translated(candidate,0,1)),mutate('changed geometry',candidate.replace('M18.5 15.5v11','M18.5 15.5v10')),mutate('changed stroke width',candidate.replace('stroke-width="1.5"','stroke-width="1.25"')),mutate('changed palette',candidate.replace('#73adc7','#83adc7'))];
 if(id==='optics'){
  const oldLens=[...reference.svg.matchAll(/<path d="([^"]+)"/g)][0][1],newLens=[...candidate.matchAll(/<path d="([^"]+)"/g)][0][1];
  return [mutate('old lens height',candidate.replace(newLens,oldLens)),mutate('closed outgoing gap',candidate.replaceAll('19.5','18')),mutate('changed incoming ray',candidate.replace('M3 8H9','M4 8H9'))];
 }
 if(id==='magneto')return [mutate('old palette',reference.svg),mutate('changed alpha geometry',candidate.replace('M8 9','M7 9'))];
 if(id==='structural')return [mutate('changed frame geometry',candidate.replace('h17v15','h16v15'))];
 assert.equal(id,'cut');return [mutate('changed native stroke',candidate.replace('stroke-width="1.5"','stroke-width="1.25"'))];
}
export async function iconRasterContractCPUChecks(){
 const started=performance.now(),references=await iconRasterReferences(),checks=[];const check=(name,fn)=>{fn();checks.push({name,pass:true});};
 check('Five predecessor SVGs bind to exact main bytes and Git blobs',()=>assert.equal(Object.keys(references).length,5));
 const expected=Object.fromEntries(iconIds.map(id=>[id,deriveIconRasterExpectation(id,references[id])]));
 check('CFD expectation preserves original SVG, with only exact native x+2 raster translation',()=>{assert.equal(expected.cfd.svg,references.cfd.svg);assert.equal(expected.cfd.dx,2);assert.equal(expected.cfd.dy,0);});
 check('Unchanged Structural and Cut references remain exact',()=>{for(const id of ['structural','cut'])assert.equal(expected[id].svg,references[id].svg);});
 check('Magneto independent reference recoloring retains every other source byte',()=>{assert.equal(expected.magneto.svg.replace('#a57dbe','#ad85c6').replace('#cfc0d7','#d7c8df'),references.magneto.svg);});
 check('Optics independent coordinate rule gives centered 22px lens and untouched incoming rays',()=>{assert.ok(expected.optics.svg.includes('M14 5C10 10.5 10 21.5 14 27C18 21.5 18 10.5 14 5Z'));assert.ok(expected.optics.svg.includes('M3 8H9M3 16H9M3 24H9M19.5 8L29 16L19.5 24M19.5 16H29'));});
 const incoming=opticsIncomingComponent(references.optics.svg);
 check('Optics semantic incoming projection preserves exact main bytes across independent lens/outgoing edits',()=>assert.equal(opticsIncomingComponent(expected.optics.svg),incoming));
 check('Optics incoming projection preserves original inherited group and path attributes',()=>{const custom=references.optics.svg.replace('stroke-width="1.5"','stroke-width="1.25"').replace('<path d="M3 8H9','<path opacity="0.5" d="M3 8H9');const projected=opticsIncomingComponent(custom);assert.ok(projected.includes('stroke-width="1.25"'));assert.ok(projected.includes('opacity="0.5"'));assert.notEqual(projected,incoming);});
 for(const ray of ['M3 8H9','M3 16H9','M3 24H9'])check('Optics incoming projection retains actual '+ray+' mutation',()=>assert.notEqual(opticsIncomingComponent(references.optics.svg.replace(ray,ray.replace('M3','M4'))),incoming));
 check('Optics incoming projection rejects missing subpath instead of silently restoring it',()=>assert.throws(()=>opticsIncomingComponent(references.optics.svg.replace('M3 16H9',''))));
 check('All seven incoming component negative controls actually change source',()=>assert.equal(opticsIncomingMutants(references.optics.svg).length,7));
 for(const dpr of [1,2]){
  const n=32*dpr,seed=new Uint8Array(n*n*4);for(const [x,y,c]of [[3*dpr,4*dpr,[73,173,199,255]],[7*dpr,21*dpr,[74,173,198,17]]])for(let k=0;k<4;k++)seed[(y*n+x)*4+k]=c[k];
  const target=shiftRaster(seed,n,n,2*dpr,0);check('Exact native integer RGBA translation at DPR'+dpr,()=>{assert.equal(target.clippedAlpha,0);assert.ok(rasterDifference(target.pixels,shiftRaster(seed,n,n,2*dpr,0).pixels).equal);assert.deepEqual(rasterBounds(target.pixels,n,n),[5*dpr,4*dpr,9*dpr,21*dpr]);});
  for(const [name,dx,dy]of [['stale',0,0],['x+1',dpr,0],['x+3',3*dpr,0],['y+1',2*dpr,dpr]])check('Reject raster '+name+' mutant DPR'+dpr,()=>assert.ok(!rasterDifference(target.pixels,shiftRaster(seed,n,n,dx,dy).pixels).equal));
  for(const channel of [0,1,2,3]){const mutant=Uint8Array.from(target.pixels);mutant[(4*dpr*n+5*dpr)*4+channel]--;check('Reject changed RGBA channel '+channel+' DPR'+dpr,()=>assert.ok(!rasterDifference(mutant,target.pixels).equal));}
  check('Reject clipping instead of silent reference loss DPR'+dpr,()=>assert.ok(shiftRaster(seed,n,n,n,0).clippedAlpha>0));
 }
 for(const dpr of [1,2]){
  const size=32*dpr,variants=Array.from({length:33},(_,i)=>({name:'variant-'+i,svg:'<svg data-fixture="'+i+'"/>'})),payloads=variants.map((_,j)=>Uint8ClampedArray.from({length:size*size*4},(_v,i)=>(i*73+j*29)&255));
  let decodes=0,draws=0,reads=0,scales=0,canvases=0;
  const fake={performance,btoa,Image:class{async decode(){decodes++;}},document:{createElement(tag){assert.equal(tag,'canvas');canvases++;return {getContext(type){assert.equal(type,'2d');return {scale(x,y){assert.equal(x,dpr);assert.equal(y,dpr);scales++;},drawImage(){draws++;},getImageData(x,y,w,h){assert.equal(x,0);assert.equal(y,0);assert.equal(w,size);assert.equal(h,size);return {data:payloads[reads++]};}};}};}}};
  const execute=runInNewContext('('+renderIconRasterVariants.toString()+')',fake),packed=await execute({variants,dpr}),decoded=decodeIconRasterVariants(packed,variants,size);
  check('All 33 independent decode/draw/readbacks survive exact packed transport DPR'+dpr,()=>{assert.deepEqual([decodes,draws,reads,scales,canvases],[33,33,33,33,33]);for(let i=0;i<33;i++)assert.ok(Buffer.from(payloads[i]).equals(decoded[i].pixels));assert.equal(packed.transportedBytes,33*size*size*4);});
  check('Reject truncated raster transport DPR'+dpr,()=>{const bad=structuredClone(packed);bad.rasters[0].rgbaBase64=Buffer.from(payloads[0].subarray(1)).toString('base64');assert.throws(()=>decodeIconRasterVariants(bad,variants,size));});
  check('Reject noncanonical raster transport DPR'+dpr,()=>{const bad=structuredClone(packed);bad.rasters[0].rgbaBase64+=' ';assert.throws(()=>decodeIconRasterVariants(bad,variants,size));});
  check('Reject omitted or reordered raster DPR'+dpr,()=>{const bad=structuredClone(packed);bad.rasters.reverse();assert.throws(()=>decodeIconRasterVariants(bad,variants,size));bad.rasters.pop();assert.throws(()=>decodeIconRasterVariants(bad,variants,size));});
  check('Changed transported RGBA byte still fails the exact raster comparator DPR'+dpr,()=>{const bad=structuredClone(packed),bytes=Buffer.from(bad.rasters[0].rgbaBase64,'base64');bytes[0]^=1;bad.rasters[0].rgbaBase64=bytes.toString('base64');assert.ok(!rasterDifference(decodeIconRasterVariants(bad,variants,size)[0].pixels,decoded[0].pixels).equal);});
 }
 const completedMs=performance.now()-started;assert.ok(completedMs<250,'Independent raster reference/negative CPU contracts finish below 250ms');return {pass:true,checks,completedMs,browserRasterValidated:false,hardwareGPUValidated:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await iconRasterContractCPUChecks(),null,2));
