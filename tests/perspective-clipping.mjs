// Execute the shipped clipping and camera consumers, not a separate scene model.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const extract=(html,name,next)=>html.slice(html.indexOf('    function '+name+'('),html.indexOf('    function '+next+'('));
function fixture(html,{view=0,mesh=true,min=[-1,-1,-1],max=[1,1,1],scale=1,center=[0,0,0],offset=[0,0,0],moving=false}={}){
 const e={scene:{meshes:mesh?[{}]:[],boundsMin:min,boundsMax:max,center,scale},nodes:[],splineDisplays:new Map(),viewIndex:view,yaw:0,pitch:0,cameraRoll:0,orbitOffset:offset,panX:0,panY:0,zoom:1,frameViewKind:i=>i>=4?0:i,
  pluginViewport:n=>n.visible,pluginBounds:(hash,n)=>n.box,splineShown:d=>d.visible,splineBounds:hash=>e.splineDisplays.get(hash).box,replicaDisplay:m=>m.display,objectWorld:()=>null,FM:{mul:(a,b)=>b},transformedBox:(b,m)=>({min:b.min.map((v,i)=>v+(m?.[i]||0)),max:b.max.map((v,i)=>v+(m?.[i]||0))}),movingMeshes:()=>moving?new Set([{}]):null,
  inverseView:p=>p,cameraFocal:()=>1,canvas:{getBoundingClientRect:()=>({left:0,top:0,width:100,height:100})}};
 vm.createContext(e);vm.runInContext(extract(html,'rotatePoint','projectOrbitPoint')+extract(html,'clippingPlanes','cameraFrame')+extract(html,'cameraRay','normalizedBox'),e);return e;
}
const pair=e=>Array.from(e.clippingPlanes()),close=(a,b)=>assert.ok(Math.abs(a-b)<=Math.max(1,Math.abs(b))*1e-12,`${a} != ${b}`);
export async function perspectiveClippingChecks(html){
 html??=await readFile(new URL('../index.html',import.meta.url),'utf8');const checks=[],timings=[];
 const test=(name,fn)=>{try{fn();checks.push({name,pass:true});}catch(error){checks.push({name,pass:false,error:error.stack});}};
 test('Perspective far is the scene bbox depth plus existing 1% safety pad; near is exactly far / 10000',()=>{const e=fixture(html),[near,far]=pair(e);close(far,4.242);assert.equal(near,far/10000);});
 test('Camera roll, yaw and pitch contain all eight bbox corners',()=>{const e=fixture(html,{min:[-4,-2,-7],max:[1,3,2],scale:.3,center:[-1,.5,-2],offset:[3,-4,1]});e.yaw=.73;e.pitch=-.42;e.cameraRoll=1.2;const depths=[];for(let x=0;x<2;x++)for(let y=0;y<2;y++)for(let z=0;z<2;z++){const p=[x?1:-4,y?3:-2,z?2:-7].map((v,i)=>(v-e.scene.center[i])*e.scene.scale);depths.push(3.2-e.rotatePoint(p)[2]-1);}const expected=Math.max(.001,...depths)+Math.max(.0001,(Math.max(.001,...depths)-Math.min(0,...depths))*.01),p=pair(e);close(p[1],expected);assert.equal(p[0],p[1]/10000);assert.ok(depths.every(d=>d<=0||d<p[1]));});
 test('Close detail is not clipped by a distant guide extent',()=>{const e=fixture(html,{min:[-.01,-.01,-.01],max:[.01,.01,.01],offset:[0,0,3.199]});const p=pair(e);assert.ok(p[0]<.001);assert.ok(p[1]<.012);});
 test('Perspective moving edits do not quantize far to a power of two',()=>{assert.deepEqual(pair(fixture(html,{moving:true})),pair(fixture(html)));});
 test('Additional Perspective windows use the same bounds contract',()=>assert.deepEqual(pair(fixture(html,{view:7})),pair(fixture(html))));
 test('Pure spline uses its actual bounds, not the empty mesh placeholder',()=>{const e=fixture(html,{mesh:false,min:[-50,-50,-50],max:[50,50,50]});e.splineDisplays.set('s',{hash:'s',visible:true,box:{min:[-1,-1,-1],max:[1,1,1]}});close(pair(e)[1],4.242);});
 test('Visible spline copies include their transformed bounds, without consumed source',()=>{const e=fixture(html,{mesh:false});e.scene.curveReplicas=[{hashId:'copy',frameVisible:true,replicaMatrix:[0,0,100],display:{min:[-1,-1,-1],max:[1,1,1]}}];close(pair(e)[1],104.2*1.01);});
 test('Plugin viewport bounds include remote real scene geometry',()=>{const e=fixture(html);e.nodes.push({nativeHash:'p',visible:true,box:{min:[-1,-1,99],max:[1,1,101]}});close(pair(e)[1],104.2*1.01);});
 test('Hidden spline and replica displays do not extend the range',()=>{const e=fixture(html);e.splineDisplays.set('s',{hash:'s',visible:false,box:{min:[-1,-1,1e9],max:[1,1,1e9]}});e.scene.curveReplicas=[{frameVisible:false,display:{min:[-1,-1,1e9],max:[1,1,1e9]}}];close(pair(e)[1],4.242);});
 test('Empty, planar, point and behind-camera scenes retain finite ordered positive perspective planes',()=>{for(const options of [{mesh:false},{min:[0,0,0],max:[0,0,0]},{min:[-1,-1,0],max:[1,1,0]},{min:[-1,-1,-100],max:[1,1,-90]}]){const p=pair(fixture(html,options));assert.ok(p.every(Number.isFinite)&&p[0]>0&&p[1]>p[0]);assert.equal(p[0],p[1]/10000);}});
 test('No-scene startup fallback is still finite and has the exact ratio',()=>{const e=fixture(html);e.scene=null;assert.deepEqual(pair(e),[.0004,4]);});
 test('Perspective picking receives the same near and far as the raster camera',()=>{const e=fixture(html);assert.deepEqual(Array.from(e.cameraRay(50,50).clip),pair(e));});
 test('Orthographic guide bounds and movement quantization are unchanged',()=>{for(const view of [1,2,3]){const e=fixture(html,{view}),oldMin=[-1000,-1,-1000],oldMax=[1000,1000,1000];let front=0,back=.001;for(let mask=0;mask<8;mask++){const p=oldMin.map((v,i)=>(mask>>i&1)?oldMax[i]:v),depth=3.2-e.rotatePoint(p)[2];front=Math.min(front,depth);back=Math.max(back,depth);}const pad=Math.max(.0001,(back-front)*.01);close(pair(e)[0],front-pad);close(pair(e)[1],back+pad);const moving=pair(fixture(html,{view,moving:true}));close(moving[0],-(2**Math.ceil(Math.log2(-(front-pad)))));close(moving[1],2**Math.ceil(Math.log2(back+pad)));}});
 test('Negative control restores guide-driven perspective clipping',()=>{const old=html.replace('if(orthographic)include({min:[-1000,0,-1000],max:[1000,1000,1000]});','include({min:[-1000,0,-1000],max:[1000,1000,1000]});');assert.notEqual(old,html);const e=fixture(old,{min:[-.01,-.01,-.01],max:[.01,.01,.01],offset:[0,0,3.199]});assert.ok(pair(e)[0]>.001);});
 test('Negative control catches moving-edit far quantization',()=>{const old=html.replace('if(orthographic&&movingMeshes())','if(movingMeshes())');assert.notEqual(old,html);assert.notDeepEqual(pair(fixture(old,{moving:true})),pair(fixture(html)));});
 test('Clipping performs bounded CPU metadata work even for 100M triangles',()=>{const e=fixture(html);e.scene.triangleCount=100548288;e.scene.meshes=[{get positions(){throw Error('Must not read geometry');},get indices(){throw Error('Must not read geometry');}}];for(let i=0;i<100;i++)e.clippingPlanes();const t=performance.now();for(let i=0;i<10000;i++)e.clippingPlanes();const ms=performance.now()-t;timings.push({name:'10000 bbox clipping evaluations with 100M-triangle metadata',ms,budgetMs:1500});assert.ok(ms<1500,`${ms} ms`);});
 return {pass:checks.every(c=>c.pass),checks,timings};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),r=await perspectiveClippingChecks(html);r.indexSHA256=createHash('sha256').update(html).digest('hex');await mkdir(new URL('./results/',import.meta.url),{recursive:true});await writeFile(new URL('./results/perspective-clipping.json',import.meta.url),JSON.stringify(r,null,2));console.log(JSON.stringify(r,null,2));process.exitCode=r.pass?0:1;}
