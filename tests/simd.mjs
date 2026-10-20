import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export async function simdChecks(){
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),a=html.indexOf('function convertBinarySTL('),b=html.indexOf('const computeCommon',a),parse=Function('return ('+html.slice(a,b).trim()+')')(),begin=html.indexOf('function FrameAffineSIMD()'),end=html.indexOf('const FrameGeometry=',begin),affine=Function(html.slice(begin,end)+';return FrameAffineSIMD;')()(),checks=[];
 const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name);},digest=a=>createHash('sha256').update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
 function stl(count,repeat=false){const bytes=new ArrayBuffer(84+count*50),v=new DataView(bytes);v.setUint32(80,count,true);for(let t=0;t<count;t++){const x=repeat?0:t*4;for(let i=0;i<3;i++)for(let k=0;k<3;k++)v.setFloat32(96+t*50+i*12+k*4,k===0?x+(i===1?1:0):k===1?(i===2?1:-0):0,true);}return bytes;}
 for(const repeat of [false,true]){const input=stl(12288,repeat),js=parse(input,true),wasm=parse(input);check((repeat?'repeated':'independent')+' STL selects SIMD',wasm.backend==='wasm-simd');check((repeat?'repeated':'independent')+' STL exact position/index bits',digest(js.vertices)===digest(wasm.vertices)&&digest(js.indices)===digest(wasm.indices));check('STL exact unique vertex count '+repeat,wasm.vertexCount===(repeat?3:36864));}
 for(const value of [NaN,Infinity,-Infinity]){const input=stl(8192);new DataView(input).setFloat32(input.byteLength-14,value,true);let rejected=false;try{parse(input);}catch(e){rejected=/NaN|infinite/.test(e.message);}check('SIMD rejects '+value+' in final coordinate',rejected);}
 check('SIMD affine kernel available',!!affine);const positions=new Float32Array(150000);let seed=71;for(let i=0;i<positions.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;positions[i]=(seed/4294967296-.5)*100000;}
 const matrix=[1.01234567,.123456789,-.51234,0,.451234,1.6789,.987654,0,.156789,.0123456,1.2345678,0,137.25,-52.125,301.625,1],expected=new Float64Array(positions.length);
 for(let i=0;i<positions.length;i+=3)for(let k=0;k<3;k++)expected[i+k]=matrix[k]*positions[i]+matrix[k+4]*positions[i+1]+matrix[k+8]*positions[i+2]+matrix[k+12];
 const transformed=affine(positions,matrix,true);check('Float64 SIMD affine is bit-identical to scalar JS',digest(transformed)===digest(expected));check('Float32 output preserves JS double intermediates',digest(affine(positions,matrix,false))===digest(Float32Array.from(expected)));
 return {pass:true,checks};
}
