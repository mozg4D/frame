import {readdir,mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,relative,parse,join} from 'node:path';
import {createHash} from 'node:crypto';
import {launch,root} from './browser.mjs';

const args=process.argv.slice(2),flags=new Map();
for(let i=0;i<args.length;i++) {
  if(!['--input','--output','--format','--strength'].includes(args[i])||!args[i+1]) throw Error('Usage: node convert.mjs [--input folder] [--output folder] [--format opengl|directx] [--strength multiplier]');
  flags.set(args[i],args[++i]);
}
const input=resolve(flags.get('--input')??join(root,'../textures')),output=resolve(flags.get('--output')??join(root,'maps'));
const format=flags.get('--format')??'opengl',strength=Number(flags.get('--strength')??1);
if(!['opengl','directx'].includes(format)||!Number.isFinite(strength)||strength<=0)throw Error('Invalid format or strength.');
const files=(await readdir(input)).filter(n=>/\.(webp|png|jpe?g|avif)$/i.test(n)).sort();
if(!files.length)throw Error('No supported textures found.');
const names=files.map(n=>parse(n).name+'.normal.png');
if(new Set(names.map(n=>n.toLowerCase())).size!==names.length)throw Error('Input names would collide in output.');
if(input.toLowerCase()===output.toLowerCase())throw Error('Choose a separate output directory.');
await mkdir(join(output,'preview'),{recursive:true});
const codeNames=['normal.wgsl','normal-map.mjs','presets.mjs','preview.mjs','browser.mjs','convert.mjs'];
const codeHashes=async()=>Object.fromEntries(await Promise.all(codeNames.map(async n=>[n,createHash('sha256').update(await readFile(join(root,n))).digest('hex')])));
const converterHashes=await codeHashes();
const session=await launch(input),manifest={version:1,format,widthConvention:'Tangent +X right, +Y up; image rows down',input:relative(output,input).replaceAll('\\','/'),gpu:session.gpu,converterHashes,sourceHashes:{},files:[]};
try {
  console.log(`Hardware WebGPU: ${JSON.stringify(session.gpu)}`);
  // Warm up kernels; timings below exclude compilation and first-use initialization.
  await session.page.evaluate(async()=>{const c=new OffscreenCanvas(32,32);c.getContext('2d').fillRect(0,0,32,32);const b=await createImageBitmap(c);try{await converter.convert(b);}finally{b.close();}});
  for(const [index,name]of files.entries()) {
    const before=createHash('sha256').update(await readFile(join(input,name))).digest('hex');
    const result=await session.page.evaluate(async({name,normalY,strength})=>{
      const {presetFor}=await import('./presets.mjs'),{png}=await import('./normal-map.mjs'),{shade,metrics}=await import('./preview.mjs');
      const preset=presetFor(name),blob=await (await fetch('/input/'+encodeURIComponent(name))).blob();
      const image=await createImageBitmap(blob,{colorSpaceConversion:'none',premultiplyAlpha:'none'});
      device.pushErrorScope('validation');
      try {
        const result=await converter.convert(image,{...preset.options,strength:(preset.options.strength??3)*strength,normalY});
        const canvas=new OffscreenCanvas(image.width,image.height),ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
        const base=ctx.getImageData(0,0,image.width,image.height).data;
        // Shade in OpenGL convention even when exporting DirectX green.
        const view={...result,pixels:result.pixels.slice()};if(normalY<0)for(let i=1;i<view.pixels.length;i+=4)view.pixels[i]=255-view.pixels[i];
        const encode=async x=>{const data=await png(x);let s='';for(let i=0;i<data.length;i+=16384)s+=String.fromCharCode(...data.subarray(i,i+16384));return btoa(s);};
        const data={name:preset.name,width:result.width,height:result.height,options:result.options,analysis:result.analysis,timing:result.timing,metrics:metrics(result),png:await encode(result),neutral:await encode(shade(view)),textured:await encode(shade(view,base))};
        const validation=await device.popErrorScope();if(validation)throw Error(validation.message);if(gpuErrors.length)throw Error(gpuErrors.join('\n'));
        return data;
      } finally {image.close();}
    },{name,normalY:format==='opengl'?1:-1,strength});
    const after=createHash('sha256').update(await readFile(join(input,name))).digest('hex');
    if(before!==after)throw Error(`Input changed during conversion: ${name}`);
    if(result.metrics.backFacingPixels||result.metrics.maxUnitLengthError>.008)throw Error(`Invalid encoded normals: ${name}`);
    const outputName=names[index],stem=parse(name).name;
    await Promise.all([
      writeFile(join(output,outputName),Buffer.from(result.png,'base64')),
      writeFile(join(output,'preview',stem+'.neutral.png'),Buffer.from(result.neutral,'base64')),
      writeFile(join(output,'preview',stem+'.textured.png'),Buffer.from(result.textured,'base64'))
    ]);
    delete result.png;delete result.neutral;delete result.textured;
    manifest.sourceHashes[name]=before;
    manifest.files.push({source:name,output:outputName,...result});
    console.log(`${index+1}/${files.length} ${name.slice(0,6)} ${result.name}: ${result.timing.gpuMs?.toFixed(3)??'?'} ms GPU, tilt ${result.metrics.meanTiltDeg.toFixed(1)}° / p95 ${result.metrics.p95TiltDeg.toFixed(1)}°`);
  }
  // Recheck every source after the complete batch, not just while it was decoded.
  for(const name of files)if(manifest.sourceHashes[name]!==createHash('sha256').update(await readFile(join(input,name))).digest('hex'))throw Error(`Source hash mismatch: ${name}`);
  if(JSON.stringify(await codeHashes())!==JSON.stringify(converterHashes))throw Error('Converter source changed during this batch.');
  const times=manifest.files.map(f=>f.timing.gpuMs).filter(Number.isFinite).sort((a,b)=>a-b);
  manifest.summary={count:files.length,medianGpuMs:times[Math.floor(times.length/2)]??null,maxGpuMs:times.at(-1)??null,sourcesUnchanged:true};
  await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  const escape=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const url=s=>s.split('/').map(encodeURIComponent).join('/');
  await writeFile(join(output,'preview.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Normal map review</title>
<style>body{margin:24px;background:#16191d;color:#e3e8ec;font:14px system-ui}h1{font-size:24px}header{position:sticky;top:0;background:#16191df2;padding:10px 0;z-index:1}button{padding:8px 18px;margin:0 8px 8px 0;background:#303944;color:white;border:1px solid #627080;border-radius:6px;cursor:pointer}button[aria-pressed=true]{background:#386678}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(440px,1fr));gap:20px}article{padding:12px;background:#242a31;border-radius:8px}h2{font-size:15px;margin:0 0 10px}.pair{display:flex;gap:8px}figure{margin:0;width:50%}img{width:100%;display:block;border-radius:4px}figcaption{padding-top:5px;color:#aab7c3}.meta{color:#9babb9;margin:10px 0 0;font-size:12px}@media(max-width:520px){main{grid-template-columns:1fr}body{margin:12px}}</style>
<header><h1>Estimated normal maps · ${files.length} materials</h1><p>Original color on the left. Normal / neutral light / textured light on the right. ${format==='opengl'?'OpenGL +Y':'DirectX −Y'} PNG. Previews use the same fixed light.</p><button data-mode="neutral" aria-pressed="true">Neutral light</button><button data-mode="normal">Normal map</button><button data-mode="textured">Textured light</button></header><main>
${manifest.files.map(f=>`<article><h2>${escape(f.source.slice(0,6))} · ${escape(f.name)}</h2><div class="pair"><figure><img loading="lazy" src="${url(manifest.input+'/'+f.source)}" alt="Original color"><figcaption>Source</figcaption></figure><figure><a href="${url(f.output)}"><img loading="lazy" class="result" data-normal="${url(f.output)}" data-neutral="preview/${url(parse(f.source).name)}.neutral.png" data-textured="preview/${url(parse(f.source).name)}.textured.png" src="preview/${url(parse(f.source).name)}.neutral.png" alt="Estimated relief"></a><figcaption class="caption">Neutral light</figcaption></figure></div><p class="meta">${f.width} × ${f.height} · GPU ${f.timing.gpuMs?.toFixed(3)??'?'} ms · mean tilt ${f.metrics.meanTiltDeg.toFixed(1)}° · p95 ${f.metrics.p95TiltDeg.toFixed(1)}°</p></article>`).join('\n')}
</main><script>document.querySelectorAll('button').forEach(b=>b.onclick=()=>{document.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));document.querySelectorAll('.result').forEach(x=>x.src=x.dataset[b.dataset.mode]);document.querySelectorAll('.caption').forEach(x=>x.textContent=b.textContent)});</script></html>`);
  console.log(JSON.stringify(manifest.summary));console.log(`Review: ${join(output,'preview.html')}`);
} finally {await session.close();}
