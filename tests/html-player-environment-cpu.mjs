// Execute the shipped environment loader/decoder with Blob and image host fixtures.
// This checks format routing, bounded reads and cleanup, not browser image decoding.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import vm from 'node:vm';

const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('async function decodeRGBE(bytes){'),end=html.indexOf('async function environmentDistribution(image){',start);
assert.ok(start>=0&&end>start,'Shipped environment loader boundary');
const linear=html.match(/^const linear=x=>[^\n]+/m)?.[0];
assert.ok(linear,'Shipped sRGB conversion');
const checks=[],check=(name,value)=>{assert.ok(value,name);checks.push({name,pass:true});};
const radiance=signature=>new Blob([signature+'\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 2\n',Uint8Array.of(128,64,32,129,32,64,128,130)],{type:'application/octet-stream'});
const png=new Blob([Uint8Array.of(137,80,78,71,13,10,26,10,0,0,0,0)],{type:'image/png'});

function fixture(source,{width=4,height=2,failDraw=false}={}){
 const state={fetches:[],blobs:0,fullReads:0,prefixes:[],bitmaps:0,images:0,closed:0,draws:[],assets:[]};
 class TrackedBlob extends Blob{
  arrayBuffer(){state.fullReads++;return super.arrayBuffer();}
  slice(a,b,type){state.prefixes.push([a,b]);return super.slice(a,b,type);}
 }
 const blob=new TrackedBlob([source],{type:source.type});
 const bitmap={width,height,close(){state.closed++;}};
 const context=vm.createContext({Blob,Uint8Array,Float32Array,Float64Array,performance,pause:async()=>{},
  FRAME_DEFAULT_ENV_IMAGE:'native-default',frameAssets:{async blobURL(...args){state.assets.push(args);return 'blob:default-environment';}},
  async fetch(url){state.fetches.push(url);return {async blob(){state.blobs++;return blob;},arrayBuffer:()=>blob.arrayBuffer()};},
  async createImageBitmap(value){assert.equal(value,blob,'Decode the original fetched Blob');state.bitmaps++;return bitmap;},
  Image:class{constructor(){state.images++;this.width=width;this.height=height;}async decode(){}},
  document:{createElement(tag){assert.equal(tag,'canvas');const canvas={getContext(type,options){assert.equal(type,'2d');assert.equal(options.willReadFrequently,true);return {
   drawImage(image,...args){state.draws.push({image,args});if(failDraw)throw Error('Canvas draw failed');},
   getImageData(_x,_y,w,h){assert.equal(canvas.width,w);assert.equal(canvas.height,h);const data=new Uint8ClampedArray(w*h*4);for(let i=0;i<data.length;i+=4)data.set([255,128,0,77],i);return {data};}
  };}};return canvas;}}
 });
 const load=vm.runInContext(linear+'\n'+html.slice(start,end)+'\nimageEnvironment',context);
 return {load,state,bitmap,blob};
}

for(const signature of ['#?RADIANCE','#?RGBE']){
 const f=fixture(radiance(signature)),image=await f.load('blob:extensionless-environment');
 check(signature+' Blob decodes through the native HDR codec',image.width===2&&image.height===1&&Array.from(image.data).join(',')==='1,0.5,0.25,1,0.5,1,2,1');
 check(signature+' detection reads a bounded prefix then the full bytes once',f.state.fetches.length===1&&f.state.blobs===1&&f.state.fullReads===1&&JSON.stringify(f.state.prefixes)==='[[0,16]]');
 check(signature+' HDR never enters the browser image path',f.state.bitmaps===0&&f.state.images===0&&f.state.draws.length===0);
}
const ordinary=fixture(png,{width:4096,height:2}),image=await ordinary.load('blob:ordinary-image');
check('Ordinary Blob image is fetched once and decoded from that same Blob',ordinary.state.fetches.length===1&&ordinary.state.blobs===1&&ordinary.state.bitmaps===1&&ordinary.state.images===0);
check('Ordinary Blob image does not read its full bytes into JavaScript',ordinary.state.fullReads===0&&JSON.stringify(ordinary.state.prefixes)==='[[0,16]]');
check('Ordinary image retains the existing scale and linear-light conversion',image.width===2048&&image.height===1&&image.data.length===8192&&image.data[0]===1&&Math.abs(image.data[1]-.21586050011389926)<1e-7&&image.data[2]===0&&image.data[3]===1);
check('The decoded ImageBitmap closes after drawing',ordinary.state.closed===1&&ordinary.state.draws[0].image===ordinary.bitmap);
const failed=fixture(png,{failDraw:true});
await assert.rejects(()=>failed.load('blob:draw-failure'),/Canvas draw failed/);
check('A drawing failure also closes the ImageBitmap',failed.state.closed===1);

for(const url of ['https://frame.example/environment.png','data:image/png;base64,iVBORw0KGgo=']){
 const f=fixture(png),image=await f.load(url);
 check('Ordinary URL keeps the native Image path: '+url.split(':')[0],f.state.fetches.length===0&&f.state.images===1&&f.state.bitmaps===0&&f.state.draws[0].image.src===url&&image.width===4&&image.height===2);
}
for(const url of ['https://frame.example/environment.hdr?version=1','data:application/x-hdr;base64,fixture']){
 const f=fixture(radiance('#?RADIANCE')),image=await f.load(url);
 check('Explicit HDR URL keeps its direct read path: '+url.split(':')[0],f.state.fetches.length===1&&f.state.blobs===0&&f.state.fullReads===1&&f.state.prefixes.length===0&&f.state.bitmaps===0&&image.data[2]===.25);
}
const standard=fixture(png),defaultImage=await standard.load('native-default');
check('The built-in default environment still resolves and decodes',JSON.stringify(standard.state.assets)==='[["default-environment","image/webp"]]'&&standard.state.fetches[0]==='blob:default-environment'&&standard.state.closed===1&&defaultImage.width===4);

console.log(JSON.stringify({pass:true,scope:'CPU loader and HDR codec; no browser or GPU claim',indexSHA256:createHash('sha256').update(html).digest('hex'),checks},null,2));
