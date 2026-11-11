import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

// Execute the actual API schema/validator, handler, native factory, defaults and catalogue. Only
// unrelated editor/rendering ownership is inert; no replacement naming algorithm.
function harness(html){
 const kernel=Function('return ('+html.match(/<script id="frame-spline-kernel" type="text\/plain">([\s\S]*?)<\/script>/)[1]+')')()();
 const definitionSource=html.match(/^const boltLabels = .*$/m)[0]+'\n'+html.slice(html.indexOf('const approximation ='),html.indexOf('const generatorTypes'))+'\n'+html.match(/^const defaults = .*$/m)[0];
 const factorySource=html.slice(html.indexOf('function hardwareName('),html.indexOf('function demo()'));
 const parameterSource=html.slice(html.indexOf('      function parameters('),html.indexOf('\n',html.indexOf('      function parameters(')));
 const handlerSource=html.slice(html.indexOf("      register('scene.create'"),html.indexOf("      register('morph.edit'"));
 const schemaSource=html.slice(html.indexOf('      const fail=(code,message)=>'),html.indexOf('      const register=(name,description,inputSchema,'));
 const anyParamsSource=html.match(/^      const anyParams=.*$/m)[0];
 const code=`${definitionSource}
 let handler,inputSchema,nodes=[],serial=0,selected,focusId,anchorId,selectedTag;const selectedTags=new Set();
 const FramePlugins={ensureType:async()=>{},owner:()=>null,dispatch:()=>{}},FrameParameters={validate:()=>{}};
 const FrameSpline={supported:['nut','bolt','washer','cube'],generators:new Set(),dependencyValid:()=>true,K:()=>kernel};
 const refs=()=>[],resolve=()=>null;
 const setViewerMode=()=>{},commit=fn=>fn(),isSplineObject=()=>false,settle=async()=>{},choose=async()=>{},describe=n=>structuredClone(n);
 ${schemaSource}\n${anyParamsSource}
 const register=(name,description,schema,readOnly,fn)=>{handler=fn;inputSchema=schema;};
 ${parameterSource}\n${factorySource}\n${handlerSource}
 return {call:async a=>{validate(inputSchema,a);return handler(JSON.parse(JSON.stringify(a)));},ui:type=>structuredClone(create(type)),reset:()=>{nodes=[];},count:()=>nodes.length};`;
 return Function('kernel',code)(kernel);
}

export async function sceneCreateNameCPUChecks(){
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),checks=[],timings=[];
 const check=(name,fn)=>{fn();checks.push({name,pass:true});};
 try{
  const h=harness(html),cases=[
   {type:'nut',params:{type:'high',size:'M10'},label:'Nut',auto:'high M10'},
   {type:'washer',params:{type:'DIN 9021',size:'M10'},label:'Washer',auto:'DIN 9021 M10'},
   {type:'bolt',params:{type:'DIN 912',size:'M10',length:40},label:'Bolt',auto:'DIN 912 M10*40'},
   {type:'tree',params:{type:'oak'},label:'Tree',auto:'Oak'},
   {type:'cube',params:{'size x':17},label:'Cube',auto:'Cube'}
  ];
  for(const c of cases){
   for(const name of [c.label,'Custom name','', ' гайка 🔩 ']){
    const n=await h.call({type:c.type,name,params:c.params});
    check(c.type+' preserves exact explicit name '+JSON.stringify(name),()=>{assert.equal(n.name,name);for(const [key,value]of Object.entries(c.params))assert.equal(n.params[key],value);});
   }
   const n=await h.call({type:c.type,params:c.params});check(c.type+' omitted name follows final parameters',()=>assert.equal(n.name,c.auto));
  }
  for(const [type,expected]of [['nut','regular M6'],['washer','DIN 125 M6'],['bolt','DIN 912 M6*20'],['tree','Bush']])check('Native UI '+type+' default name is unchanged',()=>assert.equal(h.ui(type).name,expected));
  const before=h.count();await assert.rejects(h.call({type:'nut',name:'Nut',params:{type:'high',size:'M999'}}),/not listed/);check('Invalid hardware parameters reject before creation',()=>assert.equal(h.count(),before));
  const defaults=await h.call({type:'nut',name:'Nut'}),automatic=await h.call({type:'nut'});
  check('Explicit label without parameters overrides only the name',()=>{assert.equal(defaults.name,'Nut');assert.deepEqual(defaults.params,automatic.params);assert.equal(automatic.name,'regular M6');});
  const fullName='N'.repeat(4096),boundary=await h.call({type:'nut',name:fullName});
  check('Existing 4096-character name boundary is preserved',()=>assert.equal(boundary.name,fullName));
  for(const [label,args]of [
   ['null name',{type:'nut',name:null}],['number name',{type:'nut',name:7}],['boolean name',{type:'nut',name:false}],
   ['object name',{type:'nut',name:{}}],['array name',{type:'nut',name:[]}],['overlong name',{type:'nut',name:'N'.repeat(4097)}],
   ['unknown argument',{type:'nut',name:'Nut',unexpected:true}],['null parameters',{type:'nut',name:'Nut',params:null}],
   ['missing type',{name:'Nut'}],['unknown parameter',{type:'nut',name:'Nut',params:{unexpected:1}}],
   ['invalid family',{type:'nut',name:'Nut',params:{type:'unknown'}}],['invalid size type',{type:'nut',name:'Nut',params:{size:10}}]
  ]){
   const count=h.count();await assert.rejects(h.call(args),error=>error.code==='INVALID_ARGUMENT');
   check(label+' rejects before creation through the shipped schema/parameter validation',()=>assert.equal(h.count(),count));
  }
  const repeated=[];for(let i=0;i<3;i++)repeated.push(await h.call({type:'nut',name:'Nut',params:{type:'high',size:'M10'}}));
  check('Repeated explicit names remain exact on distinct metadata owners',()=>{assert.ok(repeated.every(n=>n.name==='Nut'));assert.equal(new Set(repeated.map(n=>n.id)).size,3);});
  const fixed='n.name=a.name??(hardwareName(n)||n.name);';assert.ok(html.includes(fixed));
  const legacy=harness(html.replace(fixed,'if(a.name===undefined)n.name=hardwareName(n)||n.name;'));
  for(const [c,wrong]of [[cases[0],'regular M6'],[cases[1],'DIN 125 M6'],[cases[2],'DIN 912 M6*20'],[cases[3],'Bush']]){
   const n=await legacy.call({type:c.type,name:c.label,params:c.params});check('Historical '+c.type+' handler fails the explicit-name oracle',()=>{assert.equal(n.name,wrong);assert.notEqual(n.name,c.label);});
  }
  const at=performance.now();for(let i=0;i<2000;i++){h.reset();const n=await h.call({type:'nut',name:'Nut',params:{type:'high',size:'M10'}});assert.equal(n.name,'Nut');}const ms=performance.now()-at;
  timings.push({name:'2000 completed native create metadata transactions, rendering adapters inert',ms,budget:1500});check('Completed metadata transactions meet latency budget',()=>assert.ok(ms<1500));
  return {pass:true,checks,timings};
 }catch(e){return {pass:false,checks,timings,error:e.stack};}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const r=await sceneCreateNameCPUChecks();r.indexSHA256=createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex');await mkdir(new URL('results/',import.meta.url),{recursive:true});await writeFile(new URL('results/scene-create-name-cpu.json',import.meta.url),JSON.stringify(r,null,2));console.log(JSON.stringify(r,null,2));process.exitCode=r.pass?0:1;
}
