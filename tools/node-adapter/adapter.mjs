import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createHash,webcrypto} from 'node:crypto';
import {Worker as Thread} from 'node:worker_threads';
import {resolveObjectURL} from 'node:buffer';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {JSDOM,VirtualConsole} from 'jsdom';
import {indexedDB,IDBKeyRange} from 'fake-indexeddb';
import {create,globals} from 'webgpu';
const require=createRequire(import.meta.url);
const graphics=require('@napi-rs/canvas');
const root=path.dirname(fileURLToPath(import.meta.url)),out=process.env.FRAME_OUTPUT_DIR||path.join(root,'artifacts');fs.mkdirSync(out,{recursive:true});
const sourceDir=process.env.FRAME_SOURCE_DIR||path.join(root,'source'),sourceLock=process.env.FRAME_SOURCE_LOCK||path.join(root,'source-lock.json');
const started=performance.now(),report={node:process.version,source:JSON.parse(fs.readFileSync(sourceLock)),steps:[],errors:[],unsupported:[],worker:{created:0,messages:0,transfers:0},canvas:{configured:0,presentTextures:0},adapters:[]};
const record=(name,value)=>{report.steps.push({name,ms:performance.now()-started,value});console.log(name,JSON.stringify(value)?.slice(0,4000));save();};
const save=()=>fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2)+'\n');
const error=e=>{const text=String(e?.stack||e).slice(0,3000);report.errors.push(text);console.error('ERROR',text);save();};
process.on('unhandledRejection',error);process.on('uncaughtException',e=>{error(e);process.exit(1);});
report.unsupported=['Real browser layout and input','DOM scrolling presentation','Service Workers and offline PWA','Popup windows','Module workers and browser ESM plugins','Browser filesystem permission grants','External HTML image uploads to WebGPU','WebCodecs video'];
const timer=setTimeout(()=>{error('Experiment deadline 90 seconds');process.exit(2)},90000);
const sourceBytes=fs.readFileSync(path.join(sourceDir,'index.html'));
const html=new TextDecoder('utf-8',{fatal:true}).decode(sourceBytes);
const digest=createHash('sha256').update(sourceBytes).digest('hex');
if(digest!==report.source.files['index.html'].sha256||digest!==process.env.FRAME_EXPECT_INDEX_SHA256||report.source.commit!==process.env.FRAME_EXPECT_COMMIT)throw Error('Source identity mismatch');
record('source-verified',{commit:report.source.commit,sha256:digest,bytes:Buffer.byteLength(html)});
const gpu=create(['backend=vulkan']);
const requestAdapter=gpu.requestAdapter.bind(gpu);
gpu.requestAdapter=async options=>{const a=await requestAdapter(options);if(a){report.adapters.push(Object.fromEntries(['vendor','architecture','device','description','isFallbackAdapter'].map(k=>[k,a.info[k]])));const requestDevice=a.requestDevice.bind(a);a.requestDevice=async o=>{const d=await requestDevice(o);d.addEventListener('uncapturederror',e=>error(e.error));
for(const name of ['createRenderPipelineAsync','createRenderPipeline','createComputePipelineAsync','createComputePipeline']){const native=d[name].bind(d);d[name]=descriptor=>{const converted={...descriptor};for(const stage of ['vertex','fragment','compute'])if(descriptor[stage]?.constants)converted[stage]={...descriptor[stage],constants:Object.fromEntries(Object.entries(descriptor[stage].constants).map(([k,v])=>[k,Number(v)]))};return native(converted);};}
return d;};}return a;};
const base='https://mozg4d.github.io/frame/';
const vc=new VirtualConsole();vc.on('jsdomError',error);for(const level of ['error','warn','info','log'])vc.on(level,(...args)=>console.log('FRAME_'+level,...args.map(x=>String(x).slice(0,1000))));
const dom=new JSDOM(html,{url:base,runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc});
const w=dom.window;
Object.assign(w,globals,{TextEncoder,TextDecoder,Blob,File,ReadableStream,WritableStream,TransformStream,CompressionStream,DecompressionStream,Response,Request,Headers,AbortController,AbortSignal,structuredClone,queueMicrotask,MessageChannel,MessagePort,indexedDB,IDBKeyRange,ImageData:graphics.ImageData});
for(const name of ['ArrayBuffer','SharedArrayBuffer','DataView','Uint8Array','Uint8ClampedArray','Int8Array','Uint16Array','Int16Array','Uint32Array','Int32Array','Float32Array','Float64Array','BigInt64Array','BigUint64Array'])w[name]=globalThis[name];
Object.defineProperty(w,'crypto',{value:webcrypto});
Object.defineProperty(w.navigator,'gpu',{value:gpu});Object.defineProperty(w.navigator,'hardwareConcurrency',{value:4});
w.URL.createObjectURL=URL.createObjectURL;w.URL.revokeObjectURL=URL.revokeObjectURL;
w.isSecureContext=false;w.devicePixelRatio=1;w.innerWidth=800;w.innerHeight=600;
w.ResizeObserver=class{constructor(cb){this.cb=cb;}observe(target){w.setTimeout(()=>this.cb([{target,contentRect:target.getBoundingClientRect()}],this),0);}unobserve(){}disconnect(){}};
const rect=(x,y,width,height)=>({x,y,left:x,top:y,width,height,right:x+width,bottom:y+height,toJSON(){return {...this};}});
const elementRect=function(){if(this.id==='panel')return rect(600,0,200,600);if(this.id==='vp'||this.id==='frame-engine-host'||this.tagName==='CANVAS')return rect(0,0,512,384);return rect(0,0,512,384);};
w.Element.prototype.getBoundingClientRect=elementRect;
w.Element.prototype.getClientRects=function(){return this.hidden||this.style?.display==='none'?[]:[this.getBoundingClientRect()];};
w.Element.prototype.scrollIntoView=function(){report.offscreenScrollRequests=(report.offscreenScrollRequests||0)+1;};
const computed=w.getComputedStyle.bind(w);w.getComputedStyle=(el,...args)=>{const style=computed(el,...args);return new Proxy(style,{get(target,key){if(key==='font'&&!target.font)return (target.fontSize||'14px')+' '+(target.fontFamily||'monospace');const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;}});};
for(const [name,key] of [['clientWidth','width'],['offsetWidth','width'],['clientHeight','height'],['offsetHeight','height']])Object.defineProperty(w.HTMLElement.prototype,name,{configurable:true,get(){return this.getBoundingClientRect()[key];}});
w.SVGElement.prototype.getBBox=function(){return this.getBoundingClientRect();};
const backing=new WeakMap(),contexts=new WeakMap();
function imageCanvas(c){let b=backing.get(c);if(!b){b=graphics.createCanvas(c.width||300,c.height||150);backing.set(c,b);}if(b.width!==c.width)b.width=c.width;if(b.height!==c.height)b.height=c.height;return b;}
const activeContexts=new Set();
function getContext(c,type){
 if(type==='2d'){const native=imageCanvas(c).getContext('2d');return new Proxy(native,{get(target,key){if(key==='drawImage')return (source,...args)=>target.drawImage(source instanceof w.HTMLCanvasElement||source instanceof w.OffscreenCanvas?imageCanvas(source):source,...args);const v=Reflect.get(target,key,target);return typeof v==='function'?v.bind(target):v;},set(target,key,v){return Reflect.set(target,key,v,target);}});}
 if(type!=='webgpu')throw new Error('Unsupported canvas context: '+type);
 let ctx=contexts.get(c);if(ctx)return ctx;
 ctx={canvas:c,config:null,texture:null,configure(config){this.config=config;report.canvas.configured++;},unconfigure(){this.texture?.destroy();this.texture=null;this.config=null;},getConfiguration(){return this.config;},getCurrentTexture(){if(!this.config)throw Error('Canvas not configured');const width=Math.max(1,c.width),height=Math.max(1,c.height);if(!this.texture||this.texture.width!==width||this.texture.height!==height){this.texture?.destroy();this.texture=this.config.device.createTexture({label:'Node presentation texture',size:[width,height],format:this.config.format,usage:(this.config.usage??globals.GPUTextureUsage.RENDER_ATTACHMENT)|globals.GPUTextureUsage.COPY_SRC});report.canvas.presentTextures++;}return this.texture;}};contexts.set(c,ctx);activeContexts.add(ctx);return ctx;
}
w.HTMLCanvasElement.prototype.getContext=function(type){return getContext(this,type);};
w.HTMLCanvasElement.prototype.toBlob=function(cb,type='image/png',quality){imageCanvas(this).encode(type.split('/')[1],quality).then(bytes=>cb(new Blob([bytes],{type}))).catch(error);};
w.HTMLCanvasElement.prototype.toDataURL=function(type='image/png'){return imageCanvas(this).toDataURL(type);};
w.OffscreenCanvas=class{constructor(width,height){this.width=width;this.height=height;}getContext(type){return getContext(this,type);}async convertToBlob({type='image/png',quality}={}){return new Blob([await imageCanvas(this).encode(type.split('/')[1],quality)],{type});}};
w.createImageBitmap=async source=>{const bytes=source instanceof Blob?Buffer.from(await source.arrayBuffer()):source;const image=await graphics.loadImage(bytes);image.close=()=>{};return image;};
const threads=new Set();
w.Worker=class{
 constructor(url,options={}){const blob=resolveObjectURL(String(url));if(!blob)throw Error('Only authentic embedded Blob workers supported: '+url);if(options.type==='module')throw Error('Module workers not yet supported by Node adapter');report.worker.created++;this.listeners=new Map();
 const bootstrap=`const {parentPort,workerData}=require('node:worker_threads');const vm=require('node:vm');globalThis.self=globalThis;globalThis.postMessage=(data,transfer)=>parentPort.postMessage(data,transfer);globalThis.close=()=>process.exit(0);const handlers=new Map();globalThis.addEventListener=(type,fn)=>{if(!handlers.has(type))handlers.set(type,new Set());handlers.get(type).add(fn)};globalThis.removeEventListener=(type,fn)=>handlers.get(type)?.delete(fn);let ready=false,queue=[];const receive=data=>{const e={data};globalThis.onmessage?.(e);for(const fn of handlers.get('message')||[])fn(e)};parentPort.on('message',data=>ready?receive(data):queue.push(data));(async()=>{vm.runInThisContext(await workerData.blob.text(),{filename:'Frame embedded Worker'});ready=true;for(const data of queue)receive(data);queue=[]})().catch(e=>{throw e});`;
 this.thread=new Thread(bootstrap,{eval:true,workerData:{blob}});threads.add(this.thread);
 this.thread.on('message',data=>this.dispatch('message',{data}));this.thread.on('error',e=>{error(e);this.dispatch('error',{message:e.message,error:e});});this.thread.on('exit',()=>threads.delete(this.thread));
 }
 dispatch(type,event){this['on'+type]?.(event);for(const fn of this.listeners.get(type)||[])fn(event);}
 addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
 removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
 postMessage(data,transfer=[]){report.worker.messages++;report.worker.transfers+=Array.isArray(transfer)?transfer.length:transfer.transfer?.length||0;this.thread.postMessage(data,transfer);}
 terminate(){return this.thread.terminate();}
};
w.fetch=async(input,init)=>{
 const u=new URL(typeof input==='string'?input:input.url,base);
 if(u.origin!==new URL(base).origin||!u.pathname.startsWith('/frame/'))throw Error('External fetch unsupported: '+u.origin);
 const rel=u.pathname.slice('/frame/'.length),local=path.join(sourceDir,rel);
 const identity=report.source.files[rel],gitBlob=report.source.gitBlobs?.[rel]||identity?.gitBlob;
 if(!gitBlob)throw Error('Resource absent from pinned source manifest: '+rel);
 if(!fs.existsSync(local)){
  if(process.env.FRAME_OFFLINE==='1')throw Error('Resource unavailable offline: '+rel);
  const r=await fetch('https://raw.githubusercontent.com/mozg4D/frame/'+report.source.commit+'/'+rel,init);
  if(!r.ok)throw Error('Pinned fetch failed '+r.status+' '+rel);
  const bytes=Buffer.from(await r.arrayBuffer());
  const blob=createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
  if(blob!==gitBlob)throw Error('Pinned resource Git blob mismatch: '+rel);
  fs.mkdirSync(path.dirname(local),{recursive:true});fs.writeFileSync(local,bytes);
  record('pinned-resource',{path:rel,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});
 }
 const bytes=fs.readFileSync(local),blob=createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
 if(blob!==gitBlob)throw Error('Cached resource Git blob mismatch: '+rel);
 return new Response(bytes,{status:200});
};
w.alert=message=>{throw Error('Frame alert: '+message);};w.confirm=()=>{throw Error('Interactive confirmation unsupported');};
w.open=()=>{throw Error('Popup UI unsupported in Node adapter');};
try{
 for(const [i,script]of Array.from(w.document.scripts).entries()){if(script.src||script.type==='module')throw Error('External/module script requires an explicit adapter implementation');if(!script.type||['text/javascript','application/javascript'].includes(script.type)){record('execute-authentic-script',{i,id:script.id,bytes:Buffer.byteLength(script.textContent)});new vm.Script(script.textContent,{filename:'Frame/index.html#script-'+i}).runInContext(dom.getInternalVMContext());}}
 record('script-evaluation',{engine:!!w.frameEngine,ai:!!w.frameAI});
 await w.frameAI.ready;
 record('ready',{dataset:w.document.querySelector('canvas[data-ready]')?.dataset.ready,engine:!!w.frameEngine.renderer,adapters:report.adapters});
 if(!w.frameEngine.renderer||w.document.getElementById('frame-engine-canvas')?.dataset.ready!=='true')throw Error('Real Frame renderer not ready');
 if(!report.adapters.length||report.adapters.some(a=>a.architecture!=='swiftshader'||!a.isFallbackAdapter))throw Error('Qualification requires the CPU SwiftShader adapter');
 const maps=fs.readFileSync('/proc/self/maps','utf8');if(!maps.includes(fs.realpathSync(process.env.FRAME_EXPECT_DRIVER)))throw Error('Expected pinned SwiftShader library was not loaded');
 record('driver-loaded',{library:fs.realpathSync(process.env.FRAME_EXPECT_DRIVER)});
 if(w.frameAI.version!=='1.3.0')throw Error('Untested Frame AI API version: '+w.frameAI.version);
 const tools=w.frameAI.listTools();fs.writeFileSync(path.join(out,'tools.json'),JSON.stringify(tools,null,2));
 record('tool-count',tools.length);
 const scene=await w.frameAI.call('scene.inspect');record('scene.inspect',scene);
 fs.writeFileSync(path.join(out,'boot-scene.json'),JSON.stringify(scene,null,2));
 const call=async(name,args={})=>{const t=performance.now();const result=await w.frameAI.call(name,args);record(name,{completedMs:performance.now()-t,result});return result;};
 await call('scene.new');
 let spline,patch;
 if(process.env.FRAME_INPUT_HASH){const input=fs.readFileSync(process.env.FRAME_INPUT_HASH);await call('scene.open',{name:path.basename(process.env.FRAME_INPUT_HASH),base64:input.toString('base64')});const loaded=await call('scene.inspect');spline=loaded.objects.find(o=>o.type==='spline');patch=loaded.objects.find(o=>o.type==='spline_patch');if(!spline||!patch)throw Error('Input HASH lacks test spline and Patch');record('fresh-process-open',{input:process.env.FRAME_INPUT_HASH,bytes:input.length});}
 else {
 spline=await call('scene.create',{type:'spline',name:'Node SwiftShader test spline'});
 const data=vm.runInContext(`(()=>{const K=FrameSpline.K(),d=K.createSplineData(),q=K.addSplineSequence(d,true);const v=[[-50,0,-50],[50,0,-50],[50,30,50],[-50,0,50]].map(p=>K.addSplineVertex(d,p));v.forEach((a,i)=>K.addSplineSegment(d,q,a,v[(i+1)%4]));return d;})()`,dom.getInternalVMContext());
 await call('spline.replace',{id:spline.hash,data});
 patch=await call('scene.create',{type:'spline_patch',name:'Node real nonplanar Spline Patch',inputs:[spline.hash]});
 }
 await call('view.set',{index:0,single:true,shading:'solid-isoparms',focus:patch.hash});
 const geometry=await call('diagnostics.mesh',{id:patch.hash,geometry:true});
 fs.writeFileSync(path.join(out,'geometry-before.json'),JSON.stringify(geometry,null,2));
 if(!geometry.finite||!geometry.indicesValid||!(geometry.triangles>0)||report.worker.created<1)throw Error('Native Patch geometry validation failed');
 if(process.env.FRAME_EXPECT_POSITION_SHA256&&(geometry.positionsSHA256!==process.env.FRAME_EXPECT_POSITION_SHA256||geometry.indicesSHA256!==process.env.FRAME_EXPECT_INDEX_GEOMETRY_SHA256))throw Error('Fresh-process input geometry digest mismatch');
 const cage=await call('spline.inspect',{id:spline.hash,cells:true});
 if(Object.keys(cage.data.vertices).length!==4||Object.keys(cage.data.segments).length!==4||cage.cells?.length!==1||cage.cells[0].planar!==false||geometry.generated!==true)throw Error('Fixture is not the expected real nonplanar Spline Patch');
 fs.writeFileSync(path.join(out,'spline.json'),JSON.stringify(cage,null,2));
 const frames=await call('diagnostics.frame',{frames:8});fs.writeFileSync(path.join(out,'frames.json'),JSON.stringify(frames,null,2));
 const renderer=w.frameEngine.renderer,ctx=[...activeContexts].find(c=>c.config?.device===renderer.device),tex=ctx.getCurrentTexture(),device=renderer.device;
 const width=tex.width,height=tex.height,pitch=Math.ceil(width*4/256)*256,buf=device.createBuffer({size:pitch*height,usage:globals.GPUBufferUsage.COPY_DST|globals.GPUBufferUsage.MAP_READ});
 const encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture:tex},{buffer:buf,bytesPerRow:pitch},[width,height]);device.queue.submit([encoder.finish()]);await buf.mapAsync(globals.GPUMapMode.READ);
 const bytes=new Uint8Array(buf.getMappedRange()),rgba=new Uint8ClampedArray(width*height*4),bgra=tex.format.startsWith('bgra');
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const a=y*pitch+x*4,b=(y*width+x)*4;rgba[b]=bytes[a+(bgra?2:0)];rgba[b+1]=bytes[a+1];rgba[b+2]=bytes[a+(bgra?0:2)];rgba[b+3]=bytes[a+3];}
 const image=graphics.createCanvas(width,height);image.getContext('2d').putImageData(new graphics.ImageData(rgba,width,height),0,0);fs.writeFileSync(path.join(out,'frame-node-viewport.png'),await image.encode('png'));buf.unmap();buf.destroy();
 record('viewport-readback',{width,height,format:tex.format,uniqueColors:new Set(Array.from({length:width*height},(_,i)=>rgba.subarray(i*4,i*4+4).join(','))).size});
 const readSurface=async()=>{const b=device.createBuffer({size:pitch*height,usage:globals.GPUBufferUsage.COPY_DST|globals.GPUBufferUsage.MAP_READ}),e=device.createCommandEncoder();e.copyTextureToBuffer({texture:ctx.getCurrentTexture()},{buffer:b,bytesPerRow:pitch},[width,height]);device.queue.submit([e.finish()]);await b.mapAsync(globals.GPUMapMode.READ);const copy=new Uint8Array(b.getMappedRange()).slice();b.unmap();b.destroy();return copy;};
 const visibleBytes=await readSurface();await call('scene.update',{id:patch.hash,visible:false});await call('diagnostics.frame',{frames:1});const hiddenBytes=await readSurface();
 let changed=0;for(let i=0;i<visibleBytes.length;i+=4)if(visibleBytes[i]!==hiddenBytes[i]||visibleBytes[i+1]!==hiddenBytes[i+1]||visibleBytes[i+2]!==hiddenBytes[i+2])changed++;
 record('surface-pixels',{changedPixels:changed});if(changed<100)throw Error('Rendered image did not respond to native Patch visibility');
 await call('scene.update',{id:patch.hash,visible:true});await call('diagnostics.frame',{frames:1});
 const exported=await call('scene.export',{format:'hash',includeData:true,name:'node-swiftshader-test.hash'});
 const hash=Buffer.from(exported.base64,'base64');fs.writeFileSync(path.join(out,'node-swiftshader-test.hash'),hash);record('saved-hash',{bytes:hash.length,sha256:createHash('sha256').update(hash).digest('hex')});
 const before=await call('scene.inspect');fs.writeFileSync(path.join(out,'scene-before.json'),JSON.stringify(before,null,2));
 await call('scene.new');await call('scene.open',{name:'node-swiftshader-test.hash',base64:hash.toString('base64')});
 const after=await call('scene.inspect');fs.writeFileSync(path.join(out,'scene-reopened.json'),JSON.stringify(after,null,2));
 const reopenedGeometry=await call('diagnostics.mesh',{id:patch.hash,geometry:true});fs.writeFileSync(path.join(out,'geometry-reopened.json'),JSON.stringify(reopenedGeometry,null,2));
 const match=geometry.positionsSHA256===reopenedGeometry.positionsSHA256&&geometry.indicesSHA256===reopenedGeometry.indicesSHA256;
 record('hash-roundtrip',{sameGeometry:match,objects:after.objects.map(o=>({hash:o.hash,type:o.type,parent:o.parent})),sameObjectHashes:before.objects.every(o=>after.objects.some(a=>a.hash===o.hash&&a.type===o.type))});
 if(!match||!before.objects.every(o=>after.objects.some(a=>a.hash===o.hash&&a.type===o.type&&a.parent===o.parent)))throw Error('HASH reopened geometry or object identity differs');
 report.completed=true;

}catch(e){error(e);}
finally{clearTimeout(timer);report.totalMs=performance.now()-started;report.memory=process.memoryUsage();save();for(const t of threads)await t.terminate();w.close();process.exit(report.errors.length||!report.completed?1:0);}
