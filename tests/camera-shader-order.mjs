// Assemble affected shipped WGSL expressions and inspect global directive order.
// This is not a WGSL compiler, pipeline validation or GPU execution.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
const sha=s=>createHash('sha256').update(s).digest('hex');
function quotedEnd(s,i){const q=s[i++];while(i<s.length){if(s[i]==='\\'){i+=2;continue;}if(s[i]===q)return i+1;if(q==='`'&&s[i]==='$'&&s[i+1]==='{'){i=groupEnd(s,i+1);continue;}i++;}throw Error('Unterminated source literal');}
function groupEnd(s,i){const close={ '(':')','[':']','{':'}' }[s[i++]];while(i<s.length){if(s[i]===close)return i+1;if('"\'`'.includes(s[i])){i=quotedEnd(s,i);continue;}if('([{'.includes(s[i])){i=groupEnd(s,i);continue;}i++;}throw Error('Unterminated source group');}
function expression(s,anchor){let i=s.indexOf(anchor);assert.ok(i>=0,anchor);i+=anchor.length;while(/\s/.test(s[i]))i++;const start=i;while(i<s.length){if('"\'`'.includes(s[i])){i=quotedEnd(s,i);continue;}if('([{'.includes(s[i])){i=groupEnd(s,i);continue;}if(',;})]'.includes(s[i]))return s.slice(start,i);i++;}throw Error('No source expression end: '+anchor);}
const evaluate=(source,env={})=>vm.runInNewContext('('+source+')',env,{timeout:1000});
const value=(s,anchor,env)=>evaluate(expression(s,anchor),env);
const scope=(s,anchor)=>{const i=s.indexOf(anchor);assert.ok(i>=0,anchor);const rest=s.slice(i),m=/\n    (?:async )?function /.exec(rest);return m?rest.slice(0,m.index):rest;};
function withoutComments(s){let out='',i=0;while(i<s.length){if(s.slice(i,i+2)==='//'){const end=s.indexOf('\n',i);i=end<0?s.length:end;out+=' ';continue;}if(s.slice(i,i+2)==='/*'){let n=1;i+=2;while(i<s.length&&n){if(s.slice(i,i+2)==='/*'){n++;i+=2;}else if(s.slice(i,i+2)==='*/'){n--;i+=2;}else i++;}assert.equal(n,0,'Unterminated WGSL comment');out+=' ';continue;}out+=s[i++];}return out;}
export function directiveOrder(code){const clean=withoutComments(code),tokens=clean.match(/@[A-Za-z_][\w]*|[A-Za-z_][\w]*|[{}]/g)||[];let depth=0,declared=false;const directives=[];for(const token of tokens){if(token==='{'){depth++;continue;}if(token==='}'){depth--;continue;}if(depth!==0)continue;if(['fn','struct','var','override','const','alias','const_assert'].includes(token))declared=true;if(['enable','requires','diagnostic'].includes(token)){assert.equal(declared,false,'Global '+token+' directive follows a declaration');directives.push(token);}}assert.equal(depth,0,'Unbalanced WGSL braces');return directives;}
function assemblies(html,plugins){
 const env={};for(const name of ['CAMERA_RELATIVE_WGSL','POSE_WGSL','ENVIRONMENT_WGSL'])env[name]=value(html,'const '+name+'=');
 const main=value(html,'const shaderSource =',env),r={shaderSource:main},out=[];
 const add=(name,code)=>{assert.equal(typeof code,'string',name);out.push({name,code});};
 add('core/surface-grid-id-edge',main);
 add('core/wire-raster',value(html,"label:'wire diamond rasterization',code:",env));
 const bridge=scope(html,'async function preparePluginViewport('),uniform=value(bridge,'const uniform=');
 add('core/plugin-helper-lines',value(bridge,"label:entry.manifest.id+' helper lines',code:",{...env,uniform}));
 add('core/plugin-warning',value(bridge,'const fragment=',{...env,r,uniform,v:{shader:'fn pluginSurface(local:vec3f,normal:vec3f,build:vec3f,settings:vec4f)->vec4f{return vec4f(1);}'}}));
 const feature=scope(html,'async function createFeatureHover(');
 for(const primitiveIndex of [false,true])add('core/feature/primitiveIndex='+primitiveIndex,value(feature,"label:'logical vertex and unique edge ID maps',code:",{...env,primitiveIndex}));
 add('core/spline-visibility',value(scope(html,'async function visibleSplinePoints('),'const code=',env));
 const snapAt=html.indexOf('const code=`${CAMERA_RELATIVE_WGSL}struct Params');assert.ok(snapAt>=0);add('core/snap',value(html.slice(snapAt),'const code=',env));
 const box=scope(html,'async function createBoxPipelines('),common=value(box,'const common=',env),raster=value(box,'const raster=',env);
 for(const label of ['vertex mask and element reconstruction','GPU element selection overlay','object rectangle geometry intersection'])add('core/box/'+label,value(box,"label:'"+label+"',code:",{...env,common,raster}));
 add('core/cage',value(scope(html,'async function ensureSplinePipelines('),"label:'spline cage display',code:",env));
 const material=value(scope(html,'function ensureMaterialState('),'const source=',{...env,r});add('core/material',material);
 add('core/cloud',value(scope(html,'async function cloudPipeline('),'code:',{...env,r}));
 add('core/replica',value(scope(html,'function replicaPipeline('),"label:'shared geometry instanced surface',code:",{...env,r}));
 add('core/plugin-fallback',value(scope(html,'function renderPluginSurfaceStyles('),"label:'native plugin fallback surface',code:",{...env,r}));
 const filtered=scope(html,'function filteredSurfacePipeline(');
 for(const isMaterial of [false,true])for(const style of [false,true])for(const transparent of [false,true]){
  const input=isMaterial?'MaterialOutput':'Output',shade=isMaterial?'materialShade(input,front)':style?'vec4f(pluginStyle.rgb*(.55+.45*abs(normalize(input.normal).z)),pluginStyle.a)':'shade(input,front)',settings={...env,material:isMaterial,style,transparent,input,shade,source:isMaterial?material:main,filter:{shader:'fn pluginSurfaceKeep(world:vec3f)->bool{return true;}'}};
  settings.body=value(filtered,',body=',settings);add(`core/filter/material=${isMaterial}/style=${style}/transparent=${transparent}`,value(filtered,',code=',settings));
 }
 const context={viewport:{cameraWGSL:env.CAMERA_RELATIVE_WGSL}};
 for(const [path,s]of Object.entries(plugins)){
  if(path.startsWith('atomic')){for(const name of ['RENDER_SHADER','PICK_SHADER'])add('plugin/atomic/'+name,value(s.slice(s.indexOf('{code:context.viewport.cameraWGSL+'+name)),'{code:',{context,[name]:value(s,'const '+name+'=')}));}
  else if(path.startsWith('mill')){const millPreviewRender=value(s,'const millPreviewRender=');add('plugin/mill',evaluate(expression(s,"'Mill compact preview',"),{context,millPreviewRender}));}
  else if(path.startsWith('3d-printer')){const previewShader=value(s,'const previewShader=');add('plugin/printer',value(s,"'Printer LDI coverage and axes',",{context,previewShader}));}
  else {const shader=value(s,'const shader=');add('plugin/'+path.split('/')[0],value(s,'code:',{context,shader}));}
 }
 return {out,env,feature};
}
export async function cameraShaderOrderChecks(root=new URL('../',import.meta.url)){
 const html=await readFile(new URL('index.html',root),'utf8'),paths=['atomic/plugin.js','mill/plugin.js','circuit/viewport.js','optics/viewport.js','3d-printer/plugin.js','cut/viewport.js'],plugins=Object.fromEntries(await Promise.all(paths.map(async p=>[p,await readFile(new URL('plugins/'+p,root),'utf8')]))),checks=[],test=(name,fn)=>{try{fn();checks.push({name,pass:true});}catch(e){checks.push({name,pass:false,error:e.stack});}},start=performance.now();let built;
 test('All affected shipped WGSL expressions assemble and have one shared helper after global directives',()=>{built=assemblies(html,plugins);assert.equal(built.out.length,31);for(const row of built.out){assert.equal((row.code.match(/fn frameCameraRelative\(/g)||[]).length,1,row.name);row.directives=directiveOrder(row.code);}});
 test('Primitive-index false and true source assemblies both retain their declared capability branch',()=>{assert.ok(built);for(const enabled of [false,true]){const code=built.out.find(r=>r.name==='core/feature/primitiveIndex='+enabled).code;assert.equal(code.includes('enable primitive_index;'),enabled);directiveOrder(code);if(enabled)assert.ok(code.indexOf('enable primitive_index;')<code.indexOf('fn frameCameraRelative('));}});
 test('Historical helper-before-enable fails for true; false remains valid without inventing a directive',()=>{const old=html.replace("${primitiveIndex?'enable primitive_index;':''}${CAMERA_RELATIVE_WGSL}","${CAMERA_RELATIVE_WGSL}${primitiveIndex?'enable primitive_index;':''}");assert.notEqual(old,html);const bad=assemblies(old,plugins).out;assert.throws(()=>directiveOrder(bad.find(r=>r.name==='core/feature/primitiveIndex=true').code),/directive follows/);assert.doesNotThrow(()=>directiveOrder(bad.find(r=>r.name==='core/feature/primitiveIndex=false').code));});
 test('Every assembled module rejects appended global directives and accepts a leading directive control',()=>{assert.ok(built);for(const row of built.out){for(const directive of ['enable primitive_index;','requires readonly_and_readwrite_storage_textures;','diagnostic(off, derivative_uniformity);'])assert.throws(()=>directiveOrder(row.code+'\n'+directive),/directive follows/,row.name);assert.doesNotThrow(()=>directiveOrder('diagnostic(off, derivative_uniformity);\n'+row.code));}});
 const elapsed=performance.now()-start;test('Completed source assembly and ordering controls fit1000ms CPU budget',()=>assert.ok(elapsed<1000,`${elapsed}ms`));
 return {pass:checks.every(c=>c.pass),checks,indexSHA256:sha(html),assemblies:built?.out.map(r=>({name:r.name,bytes:Buffer.byteLength(r.code),sha256:sha(r.code),directives:r.directives})),timings:[{name:'Affected WGSL assembly and directive-order controls',ms:elapsed,budgetMs:1000}],scope:'Affected core/derived/plugin shader assembly templates, both primitiveIndex branches and all8 filter flag combinations. Plugin-warning/filter callback bodies are declared inert fixtures. This is source ordering only, not WGSL compilation or validation of arbitrary external callback code.',native:false};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const r=await cameraShaderOrderChecks();console.log(JSON.stringify(r,null,2));process.exitCode=r.pass?0:1;}
