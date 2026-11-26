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
  const camera=await call('scene.create',{type:'render',params:{realtime:'off',quality:1,environment:'off','resolution x':width,'resolution y':height}});
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
  for(const renderer of ['Interactive GI','Path tracer']){
    for(const quality of [1,100]){
      await call('scene.update',{id:camera.hash,params:{renderer,quality}});
      await call('render.export',{kind:'image',download:false});
      const sample=await page.evaluate(async()=>{
        const t=aaTest.tracer,points=Array.from({length:t.width*t.height},(_,i)=>[((i%t.width)+.5)/t.width,((i/t.width|0)+.5)/t.height]);
        const pixels=await t.readLinearPixels(points),image=await t.readImage();
        return {linear:pixels.map(p=>p.color[0]),bytes:Array.from({length:pixels.length},(_,i)=>image.rgba[i*4]),passes:t.stats.samples};
      });
      const white=sample.linear[108*width+150];assert.ok(white>=.99);
      let sum=0,aligned=0,count=0,displayError=0;
      for(let i=0;i<areas.length;i++){
        const delta=Math.abs(sample.linear[i]/white-areas[i]);
        if(areas[i]>1e-5&&areas[i]<1-1e-5){sum+=delta;count++;displayError+=Math.abs(sample.bytes[i]-displayByte(areas[i]*white));}
        else if(Math.floor(i/width)>92)aligned=Math.max(aligned,delta);
      }
      const row={renderer,quality,passes:sample.passes,coverageMAE:sum/count,aligned,edgePixels:count,displayMAE:displayError/count};rows.push(row);
      assert.ok(count>480&&aligned<.025,JSON.stringify(row));
      assert.ok(row.coverageMAE<(quality===1?.24:.055),JSON.stringify(row));
      if(quality===100)assert.ok(row.coverageMAE<rows.at(-2).coverageMAE*.6&&row.displayMAE<12,JSON.stringify(row));
    }
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
