// Independent CPU broad phase on the saved STL, with no editor cleanup.
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';

const [path,sourcePath]=process.argv.slice(2);
if(!path)throw Error('Usage: node tests/unite-audit.mjs result.stl [source.stl]');
const sha=b=>createHash('sha256').update(b).digest('hex'),runtime=await readFile(new URL('../index.html',import.meta.url)),html=runtime.toString();
const tag=html.match(/<script id="frame-volume-module"([^>]*)>([\s\S]*?)<\/script>/);
if(!tag)throw Error('Missing volume kernel');
const attribute=name=>tag[1].match(new RegExp('data-'+name+'="([^"]+)"'))?.[1],binary=await readFile(new URL('../'+attribute('asset'),import.meta.url));
if(sha(binary)!==attribute('sha256'))throw Error('Kernel digest mismatch');
// The generated loader only uses import.meta.url when it must locate a
// binary. Providing wasmBinary keeps this check independent of the server.
const loader=tag[2].replaceAll('<\\/script','</script>').replaceAll('import.meta.url',JSON.stringify(new URL('../index.html',import.meta.url).href));
const Native=(await import('data:text/javascript;base64,'+Buffer.from(loader).toString('base64'))).default,K=await Native({wasmBinary:binary,print:()=>{},printErr:()=>{}});
function decode(bytes){
 if(bytes.length<84)throw Error('Incomplete binary STL header');
 const F=bytes.readUInt32LE(80);
 if(!F||bytes.length!==84+F*50)throw Error('Invalid binary STL length');
 const P=new Float32Array(F*9),I=new Uint32Array(F*3),ids=new Map,lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
 for(let f=0;f<F;f++)for(let c=0;c<3;c++){
  const at=84+f*50+12+c*12,a=bytes.readFloatLE(at),b=bytes.readFloatLE(at+4),d=bytes.readFloatLE(at+8);
  if(!Number.isFinite(a)||!Number.isFinite(b)||!Number.isFinite(d))throw Error('Nonfinite STL coordinate');
  const key=a+','+b+','+d;let v=ids.get(key);
  if(v===undefined){v=ids.size;ids.set(key,v);P[v*3]=a;P[v*3+1]=b;P[v*3+2]=d;}
  I[f*3+c]=v;
  lo[0]=Math.min(lo[0],a);lo[1]=Math.min(lo[1],b);lo[2]=Math.min(lo[2],d);
  hi[0]=Math.max(hi[0],a);hi[1]=Math.max(hi[1],b);hi[2]=Math.max(hi[2],d);
 }
 return{P:P.subarray(0,ids.size*3),I,F,span:Math.max(...hi.map((v,j)=>v-lo[j]))};
}
function use(m,fn){
 const p=K._malloc(m.P.byteLength),i=K._malloc(m.I.byteLength);K.HEAPF32.set(m.P,p/4);K.HEAPU32.set(m.I,i/4);
 try{return fn(p,m.P.length/3,i,m.F);}finally{K._free(p);K._free(i);}
}
const input=await readFile(path),out=decode(input),started=performance.now();
let result={runtimeSHA256:sha(runtime),kernelSHA256:sha(binary),outputSHA256:sha(input),triangles:out.F,vertices:out.P.length/3};
use(out,(p,v,i,f)=>{
 K._test_pairs(p,v,i,f,0,0);
 result.degenerateTriangles=K._result(8);
 result.vertexFans=K._vertex_fans(v,i,f)>>>0;
 result.intersections=result.degenerateTriangles?null:K._audit(p,v,i,f);
});
if(sourcePath){
 const raw=await readFile(sourcePath),src=decode(raw);
 use(src,(...a)=>K._reference_mesh(...a));
 const tolerance=src.span*1e-4,faces=use(out,(...a)=>K._certify_forward(...a,tolerance,65536,0))>>>0;
 result.surface={sourceSHA256:sha(raw),tolerance,failedFaces:faces,unresolvedFaces:K._cert_value(4),certifiedUpper:K._cert_value(0)};
}
result.ms=performance.now()-started;
result.pass=result.degenerateTriangles===0&&result.vertexFans===0&&result.intersections===0&&(!result.surface||result.surface.failedFaces===0);
console.log(JSON.stringify(result));
process.exitCode=result.pass?0:1;
