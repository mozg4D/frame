import {readFile,writeFile} from 'node:fs/promises';
let s=(await readFile('work/volume-deps/meshoptimizer/src/simplifier.cpp','utf8')).replaceAll('\r\n','\n');
function edit(a,b,fn){let i=s.indexOf(a),j=s.indexOf(b,i);if(i<0||j<0)throw Error(a);s=s.slice(0,i)+fn(s.slice(i,j))+s.slice(j);}
edit('struct Vector3\n','static float rescalePositions',v=>v.replaceAll('float','double'));
edit('struct Quadric\n','struct QuadricGrad',v=>v.replaceAll('float','double'));
edit('static float normalize(Vector3& v)','static void quadricAdd',v=>v.replaceAll('float','double').replaceAll('sqrtf','sqrt'));
edit('static float quadricEval','static float quadricError',v=>v.replaceAll('float','double'));
edit('static float quadricError','static void quadricFromPlane',v=>v.replace(/float r =/g,'double r =').replace(/float s =/g,'double s =').replaceAll('fabsf','fabs'));
edit('static void quadricFromPlane','static void quadricFromAttributes',v=>v.replaceAll('float','double').replaceAll('sqrtf','sqrt'));
await writeFile('work/volume-build/simplifier64.cpp',s);
