import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {boxMesh, combineMeshes} from './unite-fixtures.mjs';

const started=performance.now(),source=await readFile(new URL('../index.html',import.meta.url)),html=source.toString(),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const moduleTag=html.match(/<script id="frame-volume-module"([^>]*)>([\s\S]*?)<\/script>/),kernel=html.match(/<script id="frame-volume-kernel" type="application\/x-c\+\+">\r?\n([\s\S]*?)<\/script>/);
if(!moduleTag||!kernel)throw Error('Missing authored volume kernel');
const attribute=name=>moduleTag[1].match(new RegExp('data-'+name+'="([^"]+)"'))?.[1],binary=await readFile(new URL('../'+attribute('asset'),import.meta.url));
const checks=[],check=(name,value,details={})=>{checks.push({name,pass:!!value,...details});if(!value)throw Error(name);};
check('Packaged WASM bytes match the runtime manifest',sha(binary)===attribute('sha256'));
check('Packaged kernel matches the authored C++ source',sha(kernel[1])===attribute('source-sha256'));
const directory=new URL('results/',import.meta.url);await mkdir(directory,{recursive:true});const modulePath=new URL('unite-kernel-'+sha(binary).slice(0,20)+'.mjs',directory);await writeFile(modulePath,moduleTag[2].replaceAll('<\\/script','</script'));
const Native=(await import(modulePath.href)).default,K=await Native({wasmBinary:binary,print:()=>{},printErr:message=>{throw Error(message);}});
const body=html.match(/<script id="frame-boolean-worker" type="text\/plain">([\s\S]*?)<\/script>/)[1],W=Function('self','postMessage',body+'\nreturn {prepareMeshFlat};')({},()=>{});
function canonical(m){const r=W.prepareMeshFlat(Float32Array.from(m.vertices),Uint32Array.from(m.indices),{topologyOnly:true});return{P:Float32Array.from(r.mesh.pos),I:r.mesh.triV};}
function use(m,fn){const a=K._malloc(m.P.byteLength),b=K._malloc(m.I.byteLength);K.HEAPF32.set(m.P,a/4);K.HEAPU32.set(m.I,b/4);try{return fn(a,b);}finally{K._free(a);K._free(b);}}
function target(m,finish=1){K._reset_volume_target();const ok=use(m,(a,b)=>K._refine_pairs(a,m.P.length/3,b,m.I.length/3,0,0,finish));if(!ok)throw Error(K.UTF8ToString(K._result(5)));}
function retained(name,m,expected,tolerance=1e-4){const raw=use(m,(a,b)=>K._retained_mesh(a,m.P.length/3,b,m.I.length/3,tolerance));if(raw<0)throw Error(K.UTF8ToString(K._result(5)));const value=!!raw;check(name,value===expected,{expected,value,missingSamples:K._retained_value(0),measuredVolume:K._retained_value(2),referenceVolume:K._retained_value(3)});}
const cube=canonical(boxMesh([0,0,0],[1,1,1])),nested=canonical(combineMeshes([boxMesh([0,0,0],[1,1,1]),boxMesh([.25,.25,.25],[.75,.75,.75])]));
try{
 target(cube);retained('Preserve a complete closed body',cube,true);retained('Reject a tiny clean remnant of a large body',canonical(boxMesh([0,0,0],[.01,.01,.01])),false);
 const pinched=canonical(combineMeshes([boxMesh([0,0,0],[1,1,1]),boxMesh([1,1,1],[2,2,2])]));
 check('Detect disconnected vertex fans on closed edge incidence',use(pinched,(_p,i)=>K._vertex_fans(pinched.P.length/3,i,pinched.I.length/3))===1);
 check('One closed fan at every cube vertex',use(cube,(_p,i)=>K._vertex_fans(cube.P.length/3,i,cube.I.length/3))===0);
 const gap=canonical(combineMeshes([boxMesh([0,0,0],[.076,1,.1]),boxMesh([.080,0,0],[1,1,.1])])),chord={P:Float32Array.of(0,0,0,1,0,0,0,1,0),I:Uint32Array.of(0,1,2)};
 use(gap,(p,i)=>K._reference_mesh(p,gap.P.length/3,i,gap.I.length/3));
 check('Whole triangle proof rejects a gap between barycentric probes',use(chord,(p,i)=>K._certify_forward(p,3,i,1,1e-4,65536,0))===1);
 use(cube,(p,i)=>K._reference_mesh(p,cube.P.length/3,i,cube.I.length/3));
 check('Whole triangle proof accepts matching facets',use(cube,(p,i)=>K._certify_forward(p,cube.P.length/3,i,cube.I.length/3,1e-4,65536,0))===0);
 // Each retention scenario below supplies its own material reference.
 K._reference_mesh(0,0,0,0);
 target(nested);retained('Nested union rejects a filled cavity',cube,false);
 const cavity={P:K.HEAPF32.slice(K._result(2)/4,K._result(2)/4+K._result(0)*3),I:K.HEAPU32.slice(K._result(3)/4,K._result(3)/4+K._result(1)*3)};
 use(nested,(p,i)=>K._reference_mesh(p,nested.P.length/3,i,nested.I.length/3));
 const spliced=use(cube,(p,i)=>use(cavity,(q,j)=>K._repair_splice(p,cube.P.length/3,i,cube.I.length/3,q,cavity.P.length/3,j,cavity.I.length/3,.125,.125,.125,.875,.875,.875,1)));
 check('Local splice succeeds with an enclosed cavity',spliced===1);
 const repaired={P:K.HEAPF32.slice(K._result(2)/4,K._result(2)/4+K._result(0)*3),I:K.HEAPU32.slice(K._result(3)/4,K._result(3)/4+K._result(1)*3)};
 check('Local splice has closed vertex links and no exact proper intersections',use(repaired,(p,i)=>K._vertex_fans(repaired.P.length/3,i,repaired.I.length/3)===0&&K._audit(p,repaired.P.length/3,i,repaired.I.length/3)===0));
 retained('Local splice retains the oriented cavity',repaired,true);
 check('Local splice preserves analytic signed volume',Math.abs(K._retained_value(2)-.875)<1e-8);
 K._reference_mesh(0,0,0,0);
 target(nested,3);retained('Explicit union fills a contained shell',cube,true);
 target(nested,33);retained('Even-odd retains the nested cavity',cube,false);
 target(canonical(combineMeshes([boxMesh([0,0,0],[1,1,1]),boxMesh([2,0,0],[3,.2,1e-6])])));retained('Permit removal of a long sub-tolerance film',cube,true,3e-4);
 target(canonical(combineMeshes([boxMesh([0,0,0],[1,1,1]),boxMesh([.2,.2,.5],[.8,.8,.500001])])));retained('Permit regularization of an unresolved thin void',cube,true);
 const twin=canonical(boxMesh([2,0,0],[3,1,1]));
 function merge(right,parity){
  const P=Float32Array.from([...cube.P,...right.P]),I=Uint32Array.from([...cube.I,...right.I.map(v=>v+cube.P.length/3)]),starts=Uint32Array.of(0,cube.I.length/3,I.length/3),labels=Uint32Array.from({length:I.length/3},(_,i)=>i),buffers=[P,I,starts,labels],ptr=buffers.map(a=>K._malloc(a.byteLength));
  buffers.forEach((a,j)=>K.HEAPU8.set(new Uint8Array(a.buffer),ptr[j]));
  try{if(!K._merge_meshes(ptr[0],P.length/3,ptr[1],I.length/3,ptr[2],2,ptr[3],parity))throw Error(K.UTF8ToString(K._result(5)));return{P:K.HEAPF32.slice(K._result(2)/4,K._result(2)/4+K._result(0)*3),I:K.HEAPU32.slice(K._result(3)/4,K._result(3)/4+K._result(1)*3)};}finally{ptr.forEach(p=>K._free(p));}
 }
 target(twin);retained('Combined reference covers both disjoint owners',merge(twin,0),true);retained('Combined reference detects a lost owner',twin,false);
 target(cube);retained('Coincident owners cancel under explicit even-odd',merge(cube,1),true);retained('Empty parity reference rejects spurious material',cube,false);
 target(canonical(combineMeshes([boxMesh([0,0,0],[1,1,1]),boxMesh([2,0,0],[3,.2,.01])])));retained('Retain a small component with resolved thickness',cube,false,3e-4);
 for(let seed=0;seed<12;seed++){const m={P:cube.P,I:cube.I.slice()};let state=seed+1;for(let f=0;f<m.I.length/3;f++){state=(Math.imul(state,1664525)+1013904223)>>>0;if(state&0x80000000)[m.I[f*3+1],m.I[f*3+2]]=[m.I[f*3+2],m.I[f*3+1]];}target(m);retained('Ignore random source winding '+seed,cube,true);}
 check('Completed kernel regression latency',performance.now()-started<3500,{milliseconds:performance.now()-started,budgetMs:3500});
}finally{
 const result={pass:checks.every(c=>c.pass),checks,indexSHA256:sha(source),kernelSHA256:sha(binary),sourceSHA256:sha(kernel[1]),ms:performance.now()-started};await writeFile(new URL('unite-kernel.json',directory),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}
