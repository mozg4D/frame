import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {launch,root} from './browser.mjs';
import {join} from 'node:path';

const sourceNames=['normal.wgsl','normal-map.mjs','presets.mjs','preview.mjs','browser.mjs','convert.mjs','verify.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(sourceNames.map(async n=>[n,createHash('sha256').update(await readFile(join(root,n))).digest('hex')])));
const before=await hashes(),session=await launch(join(root,'../textures'));
try {
  const result=await session.page.evaluate(async()=>{
    const checks=[];
    const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});if(!pass)throw Error(name+': '+JSON.stringify(detail));};
    const fixture=async(w,h,f)=>{const c=new OffscreenCanvas(w,h),ctx=c.getContext('2d');const p=ctx.createImageData(w,h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4,v=Math.round(255*f(x,y));p.data.set([v,v,v,255],i);}ctx.putImageData(p,0,0);return createImageBitmap(c);};
    const n=(r,x,y)=>Array.from(r.pixels.slice((y*r.width+x)*4,(y*r.width+x)*4+3),v=>v/127.5-1);
    const {metrics}=await import('./preview.mjs');
    device.pushErrorScope('validation');
    for(const [w,h]of [[1,1],[3,7],[127,65],[512,512]]) {
      const image=await fixture(w,h,()=>.5),r=await converter.convert(image);image.close();
      check(`Flat ${w}x${h}`,r.pixels.every((v,i)=>i%4<2?(v===127||v===128):v===255),{firstPixel:Array.from(r.pixels.slice(0,4)),errors:gpuErrors});
    }
    const w=256,h=128,period=16;
    const sine=await fixture(w,h,x=>.5+.35*Math.sin(x*2*Math.PI/period));
    const options={range:[0,1],denoise:0,bands:[1,1,1],strength:4};
    const r=await converter.convert(sine,options);
    let maxError=0;
    for(let x=0;x<w;x++) {
      const sample=x=>Math.round(255*(.5+.35*Math.sin(x*2*Math.PI/period)))/255;
      const gradient=(sample((x+1)%w)-sample((x+w-1)%w))/2;
      const expected=[-gradient*options.strength,0,1],len=Math.hypot(...expected),actual=n(r,x,64);
      maxError=Math.max(maxError,Math.hypot(...actual.map((v,c)=>v-expected[c]/len)));
    }
    check('Periodic sine agrees with analytic surface normals',maxError<.012,{maxVectorError:maxError});
    check('Rising height has negative red normal',n(r,0,64)[0]<-.4);
    const m=metrics(r);check('Unit hemisphere after RGB8 encoding',m.maxUnitLengthError<.007&&m.backFacingPixels===0,m);
    sine.close();
    const vertical=await fixture(w,h,(_,y)=>.5+.35*Math.sin(y*2*Math.PI/period));
    const gl=await converter.convert(vertical,options),dx=await converter.convert(vertical,{...options,normalY:-1});vertical.close();
    let flip=true;
    for(let i=0;i<gl.pixels.length;i+=4) if(gl.pixels[i]!==dx.pixels[i]||Math.abs(gl.pixels[i+1]+dx.pixels[i+1]-255)>1||gl.pixels[i+2]!==dx.pixels[i+2]) {flip=false;break;}
    check('OpenGL +Y and DirectX -Y flip only green',flip);
    check('Image-down rising height has positive OpenGL green',n(gl,64,0)[1]>.4);
    const plane=await fixture(512,128,x=>.25+x/1024);
    const planeResult=await converter.convert(plane,{range:[0,1],denoise:0,bands:[1,1,1],strength:4,wrap:false});plane.close();
    let rampTilt=0;for(let x=120;x<392;x++)rampTilt=Math.max(rampTilt,Math.abs(n(planeResult,x,64)[0]));
    check('Broad affine lighting is removed',rampTilt<.012,{maxNormalX:rampTilt});
    const disk=await fixture(128,128,(x,y)=>Math.hypot(x-64,y-64)<28?1:.604);
    const diskResult=await converter.convert(disk,{mode:2,feature:[.065,.604,8,0],strength:4,bands:[0,1,1]});disk.close();
    check('Recovered emboss has outward normals on both axes',n(diskResult,88,64)[0]>.1&&n(diskResult,40,64)[0]<-.1&&n(diskResult,64,88)[1]<-.1&&n(diskResult,64,40)[1]>.1);
    check('Emboss center stays flat',Math.hypot(...n(diskResult,64,64).slice(0,2))<.015);
    const invalid=await fixture(8,8,()=>.5);let rejected=false;
    try {await converter.convert(invalid,{strength:NaN});}catch{rejected=true;}
    check('Invalid parameters reject before GPU mutation',rejected);
    await converter.convert(invalid);invalid.close();
    const validation=await device.popErrorScope();check('No WebGPU validation errors',!validation&&!gpuErrors.length,{validation:validation?.message??null,uncaptured:gpuErrors});
    // Repeated actual 512px conversions, without PNG encoding, expose warm GPU cost.
    const fixtureImage=await fixture(512,512,(x,y)=>.5+.2*Math.sin(x*.3)*Math.cos(y*.23));
    const benchmark={};
    for(const [name,extra]of [['generic',{}],['emboss',{mode:2,feature:[.1,.5,8,0]}],['cavity',{mode:3,feature:[.4,0,10,0]}]]) {
      const gpu=[],total=[];
      for(let i=0;i<16;i++){const r=await converter.convert(fixtureImage,extra);if(i>=4){gpu.push(r.timing.gpuMs);total.push(r.timing.computeReadbackMs);}}
      gpu.sort((a,b)=>a-b);total.sort((a,b)=>a-b);
      benchmark[name]={samples:gpu.length,medianGpuMs:gpu[6],p95GpuMs:gpu[11],medianComputeReadbackMs:total[6]};
    }
    fixtureImage.close();check('No errors after repeated conversions',!gpuErrors.length,gpuErrors);
    return {pass:true,checks,benchmark};
  });
  const after=await hashes();assert.deepEqual(after,before,'Sources changed during verification');
  const report={...result,gpu:session.gpu,sourceHashes:before};
  await mkdir(join(root,'work'),{recursive:true});await writeFile(join(root,'work','verification.json'),JSON.stringify(report,null,2)+'\n');
  for(const c of result.checks)console.log(`PASS ${c.name}`);
  console.log(JSON.stringify({gpu:session.gpu,benchmark:result.benchmark},null,2));
} finally {await session.close();}
