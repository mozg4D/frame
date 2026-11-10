import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export async function instanceSplineCPUChecks(){
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),checks=[],timings=[],check=(name,fn)=>{fn();checks.push({name,pass:true});};
 try{
  const supported=new Set(['cube','spline','extrude','sweep','lathe','spline_patch']),nodes=[],children=id=>nodes.filter(n=>n.parent===id),objectReference=ref=>nodes.find(n=>n.id===ref||n.nativeHash===ref||n.name===ref);
  const start=html.indexOf('  function inputNode('),end=html.indexOf('  function addGenerator(',start),api=Function('nodes','children','objectReference','supported','solids','generators','node',html.slice(start,end)+';return {splineSources,dependencyValid,inputNode,generatorSources,consumesInput};')(nodes,children,objectReference,supported,new Set(['cube']),new Set(['extrude','sweep','lathe','spline_patch']),id=>nodes.find(n=>n.id===id));
  const add=(id,type,parent=null,object)=>{const n={id,nativeHash:'h'+id,name:id,type,parent,params:{object}};nodes.push(n);return n;};
  const stock=add('stock','group'),source=add('source','spline','stock'),copy=add('copy','instance',null,'hsource'),extrude=add('ex','extrude'),second=add('second','instance',null,'hcopy');
  check('Direct spline, Instance and nested Instance retain one authored cage',()=>{assert.equal(api.splineSources(source)[0].node,source);assert.deepEqual(api.splineSources(copy).map(r=>[r.node.id,r.instances.map(n=>n.id)]),[['source',['copy']]]);assert.deepEqual(api.splineSources(second).map(r=>[r.node.id,r.instances.map(n=>n.id)]),[['source',['second','copy']]]);assert.equal(nodes.filter(n=>n.type==='spline').length,1);});
  check('Valid generator reparent is accepted without changing the source hierarchy',()=>{assert.ok(api.dependencyValid(new Map([['copy','ex']])));assert.equal(source.parent,'stock');});
  check('Direct self, chained Instance and generator-source cycles reject before mutation',()=>{assert.equal(api.dependencyValid(new Map(),new Map([['copy','hcopy']])),false);assert.equal(api.dependencyValid(new Map(),new Map([['copy','hsecond']])),false);assert.equal(api.dependencyValid(new Map([['copy','ex']]),new Map([['copy','hex']])),false);assert.equal(api.dependencyValid(new Map([['copy','stock']]),new Map([['copy','hstock']])),false);assert.equal(copy.parent,null);});
  check('Creation validates the proposed hierarchy including a new generator',()=>{const n={id:Symbol('new'),type:'extrude',parent:'stock',params:{}};assert.equal(api.dependencyValid(new Map([['copy',n.id]]),new Map([['copy','hstock']]),[n]),false);});
  const group=add('group','group'),leaf=add('leaf','spline','group'),groupCopy=add('groupCopy','instance',null,'hgroup');
  check('Group Instances resolve editable child cages without authoring copies',()=>assert.deepEqual(api.splineSources(groupCopy).map(r=>r.node.id),['leaf']));
  const mixed=add('mixed','group','ex'),solid=add('solid','cube','mixed'),profile=add('profile','spline','mixed'),nestedSolid=add('nestedSolid','extrude','mixed'),hiddenProfile=add('hiddenProfile','spline','nestedSolid'),mesh=add('mesh','mesh','mixed'),meshCopy=add('meshCopy','instance','mixed','hmesh');
  check('Extrude collects only profile cages through groups and ignores solids, surface generators and mesh Instances',()=>{assert.deepEqual(api.generatorSources(extrude).map(r=>r.node.id),['profile']);assert.equal(api.consumesInput(extrude,solid),false);assert.equal(api.consumesInput(extrude,profile),true);assert.equal(api.consumesInput(extrude,hiddenProfile),false);});
  check('Other cage generator resolution is unchanged',()=>assert.deepEqual(api.splineSources(solid).map(r=>r.node.id),['solid']));
  const mixedCopy=add('mixedCopy','instance',null,'hmixed');
  check('Mixed group Instance filters each leaf without duplicating or losing occurrence frames',()=>assert.deepEqual(api.splineSources(mixedCopy,[],new Set(),true).map(r=>[r.node.id,r.instances.map(n=>n.id)]),[['profile',['mixedCopy']]]));
  const FM=Function('return '+html.slice(html.indexOf('const FM=')+9,html.indexOf('\n    })();',html.indexOf('const FM='))+11))(),worlds=new Map(),pivots=new Map();
  const functions=html.slice(html.indexOf('    function instanceSourceFrame('),html.indexOf('    function instanceCreationFrame(')),math=Function('FM','objectWorld','objectPivot','objectReference',functions+';return {splineOccurrenceFrame,splineOccurrencePivot};')(FM,h=>worlds.get(h)||FM.I(),h=>pivots.get(h)||FM.I(),objectReference),near=(a,b)=>assert.ok(a.every((v,i)=>Math.abs(v-b[i])<1e-8),JSON.stringify({a:[...a],b:[...b]}));
  worlds.set('hsource',FM.translation([4800,200,30]));pivots.set('hsource',FM.translation([5,7,0]));worlds.set('hcopy',FM.translation([120,230,340]));worlds.set('hex',FM.translation([-10,20,30]));
  check('Source stock placement cancels, authored source pivot stays at occurrence origin',()=>{const m=math.splineOccurrenceFrame('hsource','hex',[copy]);near(FM.point(m,[5,7,0]),[130,210,310]);near(FM.point(m,[15,27,0]),[140,230,310]);});
  const shear=FM.I();shear[0]=-2;shear[4]=.4;shear[5]=3;shear[10]=.5;shear.set([120,230,340],12);worlds.set('hcopy',shear);
  check('Reflection, nonuniform scale and shear retain the complete affine mapping',()=>{const m=math.splineOccurrenceFrame('hsource','hex',[copy]);near(FM.point(m,[15,27,2]),[118,270,311]);});
  worlds.set('hsecond',FM.translation([1000,2000,3000]));pivots.set('hcopy',FM.translation([2,3,4]));
  check('Nested occurrences remove each source occurrence pivot exactly once',()=>{const m=math.splineOccurrenceFrame('hsource','hex',[second,copy]);near(FM.point(m,[15,27,2]),[1018,1997,2968]);});
  worlds.set('hgroup',FM.mul(FM.translation([500,600,700]),FM.rotation([0,0,1],.7)));pivots.set('hgroup',FM.translation([10,20,0]));worlds.set('hleaf',FM.mul(worlds.get('hgroup'),FM.translation([40,60,0])));worlds.set('hgroupCopy',FM.translation([100,200,300]));
  check('A group occurrence retains child transforms relative to its source pivot',()=>near(FM.point(math.splineOccurrenceFrame('hleaf','hex',[groupCopy]),[0,0,0]),[140,220,270]));
  for(let i=0;i<10000;i++)add('p'+i,'instance',null,'hsource');const at=performance.now();for(let i=0;i<10;i++)assert.ok(api.dependencyValid());const ms=performance.now()-at;timings.push({name:'10 full dependency validations of 10000 native Instances',ms,budget:1500});check('Dependency validation stays linear on large instance scenes',()=>assert.ok(ms<1500));
  return {pass:true,checks,timings};
 }catch(error){return {pass:false,checks,timings,error:error.stack};}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const result=await instanceSplineCPUChecks();result.indexSHA256=createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex');await mkdir(new URL('results/',import.meta.url),{recursive:true});await writeFile(new URL('results/instance-spline-cpu.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));process.exitCode=result.pass?0:1;}
