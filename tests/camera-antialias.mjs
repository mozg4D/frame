import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../tools/browser.mjs';

const width=193,height=129;
const shapes=[
  [[6.3,15.9],[94.2,2.7],[47.8,61.6]],
  [[103.2,7.4],[182.6,82.8],[127.1,48.2]],
  [[9.2,84.8],[86.6,62.5],[87.2,64.3],[9.8,86.6]],
  [[16,99],[97,99],[97,100],[16,100]],
  [[133,95],[179,95],[179,117],[133,117]]
];

// Clip the actual polygons to the pixel square. This reference has no noise,
// subpixel grid or shared edge-detection code with either renderer.
function pixelArea(shape,x,y){
  let polygon=shape;
  for(const [axis,edge,sign] of [[0,x,1],[0,x+1,-1],[1,y,1],[1,y+1,-1]]){
    const clipped=[];
    for(let i=0;i<polygon.length;i++){
      const a=polygon[i],b=polygon[(i+1)%polygon.length],da=(a[axis]-edge)*sign,db=(b[axis]-edge)*sign;
      if(da>=0)clipped.push(a);
      if((da>=0)!==(db>=0)){const t=da/(da-db);clipped.push(a.map((v,k)=>v+t*(b[k]-v)));}
    }
    polygon=clipped;
  }
  return Math.abs(polygon.reduce((sum,a,i)=>{const b=polygon[(i+1)%polygon.length];return sum+a[0]*b[1]-b[0]*a[1];},0))*.5;
}
function coverageImage(){
  const result=new Float64Array(width*height);
  for(const shape of shapes){
    const xs=shape.map(p=>p[0]),ys=shape.map(p=>p[1]);
    for(let y=Math.floor(Math.min(...ys));y<Math.ceil(Math.max(...ys));y++)
      for(let x=Math.floor(Math.min(...xs));x<Math.ceil(Math.max(...xs));x++)result[y*width+x]+=pixelArea(shape,x,y);
  }
  return result;
}
function displayByte(linear){
  const c=Math.min(1,linear*(2.51*linear+.03)/(linear*(2.43*linear+.59)+.14));
  return Math.round(255*(c<=.0031308?12.92*c:1.055*c**(1/2.4)-.055));
}
export async function cameraAntialiasChecks(page){
  const errors=[],call=(name,args={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[name,args]);
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  const adapter=await page.evaluate(()=>{
    const device=frameEngine.renderer.device,script=document.querySelector('#frame-pathtracer');
    device.pushErrorScope('validation');
    window.aaTest={};
    script.textContent=script.textContent.replace('return new FrameRenderer(container,changed);','return aaTest.tracer=new FrameRenderer(container,changed);');
    const a=device.adapterInfo;return {vendor:a.vendor,description:a.description,architecture:a.architecture,fallback:a.isFallbackAdapter};
  });
  assert.equal(adapter.fallback,false);
  const areas=coverageImage(),rows=[];
  await call('scene.new');await call('view.set',{index:0,single:true});
  const camera=await call('scene.create',{type:'render',params:{realtime:'off',samples:1,environment:'off','resolution x':width,'resolution y':height}});
  const initial=await call('render.start');assert.equal(initial.phase,'complete',JSON.stringify(initial.errors));
  const vertices=await page.evaluate(({shapes,width,height})=>{
    const cam=aaTest.tracer.options.camera;
    const depth=140,scale=2*depth*Math.tan(cam.fov*Math.PI/360)/height;
    return shapes.flat().flatMap(([x,y])=>cam.position.map((v,k)=>v+depth*cam.forward[k]+scale*((x-width/2)*cam.right[k]+(height/2-y)*cam.up[k])));
  },{shapes,width,height});
  let offset=0;const indices=[];
  for(const shape of shapes){for(let i=1;i<shape.length-1;i++)indices.push(offset,offset+i,offset+i+1);offset+=shape.length;}
  const mesh=await call('mesh.create',{name:'Camera coverage',vertices,indices});
  const mat=await call('material.create',{params:{h:0,s:0,l:100,emm:100,rough:100}});
  await call('material.assign',{id:mesh.hash,material:mat.uid});
  await call('render.export',{kind:'image',download:false});
  await page.evaluate(()=>{aaTest.options={...aaTest.tracer.options,onSamples:()=>{}};});
  for(const [material,samples,lightingReuse] of [['emission',1,true],['emission',2,true],['emission',4,true],['diffuse',32,false],['diffuse',128,true]]){
    const out=await page.evaluate(async({material,samples,lightingReuse})=>{
      const t=aaTest.tracer;
      const o={...aaTest.options,previewPresentation:false,frameSeed:4253,localExposure:false,
        viewKey:material+samples,sceneKey:material,sampleLimit:samples,maxBounces:1,lightingReuse};
      if(material==='diffuse'){
        const capture=o.getScene;
        o.getScene=async cancelled=>{const scene=await capture(cancelled);for(const m of scene.materials)m.emission=[0,0,0];return scene;};
        o.environment={...o.environment,infiniteLights:[{direction:o.camera.forward.map(v=>-v),angle:0,color:[1,1,1],intensity:.5}]};
      }
      await t.start(o);if(t.stats.phase!=='complete')throw Error(t.stats.errors.join('\n'));
      const film=await t.readFilm(),image=await t.readImage(),device=t.device;
      const read=device.createBuffer({size:16,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
      let exposure;
      try{const enc=device.createCommandEncoder();enc.copyBufferToBuffer(t.exposure,0,read,0,16);device.queue.submit([enc.finish()]);await read.mapAsync(GPUMapMode.READ);exposure=new Float32Array(read.getMappedRange())[0];}finally{read.destroy();}
      return {exposure,linear:Array.from({length:t.width*t.height},(_,i)=>film.data[i*film.stride]),
        bytes:Array.from({length:t.width*t.height},(_,i)=>image.rgba[i*4]),samples:t.stats.newCameraSamples,ms:t.stats.elapsedMs};
    },{material,samples,lightingReuse});
    assert.equal(out.samples,width*height*samples);
    const white=out.linear[108*width+150];assert.ok(white>.1);
    let count=0,displayError=0,filmError=0,coverageError=0,alignedError=0,interiorError=0;
    for(let i=0;i<areas.length;i++){
      const a=areas[i],expected=displayByte(a*white*out.exposure);
      if(a>1e-5&&a<1-1e-5){
        count++;displayError+=Math.abs(out.bytes[i]-expected);
        filmError+=Math.abs(displayByte(out.linear[i]*out.exposure)-expected);
        coverageError+=Math.abs(out.linear[i]/white-a);
      }else{
        const error=Math.abs(out.bytes[i]-expected);
        if(Math.floor(i/width)>92)alignedError=Math.max(alignedError,error);
        interiorError=Math.max(interiorError,error);
      }
    }
    const row={material,samples,edgePixels:count,displayMAE:displayError/count,rawMAE:filmError/count,coverageMAE:coverageError/count,alignedError,interiorError,ms:out.ms};
    rows.push(row);console.log('Camera coverage',JSON.stringify(row));
    assert.ok(count>480&&out.ms<10000,JSON.stringify(row));
    assert.ok(alignedError<=2&&interiorError<=8,JSON.stringify(row));
    if(material==='emission')assert.ok(row.displayMAE<row.rawMAE*.8,JSON.stringify(row));
    else assert.ok(row.displayMAE<=row.rawMAE+1,JSON.stringify(row));
  }
  await call('scene.update',{id:camera.hash,params:{renderer:'Viewport'}});
  const raster=await call('render.export',{kind:'image',download:false});assert.ok(raster.bytes>0&&raster.width===width&&raster.height===height);
  const bytes=await page.evaluate(async({width,height})=>{
    const bytes=[];for(let i=0;i<width*height;i+=64){
      const points=Array.from({length:Math.min(64,width*height-i)},(_,k)=>[((k+i)%width+.5)/width,(Math.floor((k+i)/width)+.5)/height]);
      bytes.push(...(await frameAI.call('render.pixels',{points})).colors.map(c=>c[0]));
    }return bytes;
  },{width,height});
  const bg=bytes[0],fg=bytes[108*width+150];
  assert.ok(Math.abs(fg-bg)>40,JSON.stringify({bg,fg,range:[Math.min(...bytes),Math.max(...bytes)]}));
  let error=0,count=0,aligned=0;
  for(let i=0;i<areas.length;i++){
    const a=areas[i],delta=Math.abs((bytes[i]-bg)/(fg-bg)-a);
    if(a>1e-5&&a<1-1e-5){error+=delta;count++;}
    if(Math.floor(i/width)>92)aligned=Math.max(aligned,delta);
  }
  const viewport={coverageMAE:error/count,aligned,foreground:fg,background:bg};
  console.log('Viewport coverage',JSON.stringify(viewport));
  // The viewport material varies slightly with view angle across the flat face.
  assert.ok(viewport.coverageMAE<.12&&aligned<.10,JSON.stringify(viewport));
  const red=await call('material.create',{params:{h:0,s:100,l:50,emm:100}});
  await call('material.assign',{id:mesh.hash,material:red.uid});
  await call('scene.update',{id:camera.hash,params:{'resolution x':240,'resolution y':160}});
  const video=await call('render.export',{kind:'video',start:0,end:1,download:false});
  assert.ok(video.frames===2&&video.width===240&&video.height===160&&video.bytes>0);
  const {colors:[rgba]}=await call('render.pixels',{points:[[150.5/width,108.5/height]]});
  assert.ok(rgba[0]>rgba[2]+25&&rgba[0]>rgba[1]+25&&rgba[3]===255,'Viewport readback preserves red and opaque alpha: '+rgba);
  const validation=await page.evaluate(async()=>(await frameEngine.renderer.device.popErrorScope())?.message);
  assert.equal(validation,undefined);assert.deepEqual(errors,[]);
  return {pass:true,adapter,rows,viewport};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const session=await launch({headless:true});
  try{await ready(session.page);await cameraAntialiasChecks(session.page);console.log('Camera antialias checks passed');}
  finally{await session.close();}
}
