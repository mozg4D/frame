import{readFile,writeFile,mkdir}from'node:fs/promises';import{createHash}from'node:crypto';import{fileURLToPath}from'node:url';import assert from'node:assert/strict';
export async function cameraHashCoordinateChecks(html){
 html??=await readFile(new URL('../index.html',import.meta.url),'utf8');
 const checks=[],timings=[],check=(name,fn)=>{try{fn();checks.push({name,pass:true});}catch(e){checks.push({name,pass:false});throw e;}};
 try{
 const take=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a))),line=name=>html.split('\n').find(l=>l.includes('function '+name+'('));
 const source=[take('    function rotatePoint(','    function projectOrbitPoint('),line('inverseView'),line('defaultCamera'),take('    function nativeCamera(){','    function nativeSceneEvent(')].join('\n');
 const create=Function('initial','raw','index','singleValue','changed',String.raw`
 let scene=structuredClone(initial),viewIndex=index,activeView=index,mainActiveView=index,single=singleValue,cameraRoll=0,orbitGeneration=0,elementMode='object',shadingMode='solid',yaw,pitch,zoom,panX,panY,orbitPivot,orbitOffset,orbitDepth;
 const frameViewKind=i=>i,defaultViewShadings=['solid','isoparms','isoparms','isoparms'],viewShadingNames=['solid','wireframe','solid-wire','isoparms','solid-isoparms'],viewShadings=defaultViewShadings.slice(),window={dispatchEvent(){}},CustomEvent=class{},renderViews=()=>{};
 const captureCamera=()=>[yaw,pitch,zoom,panX,panY,...orbitPivot,...orbitOffset,orbitDepth];
 function restoreCamera(v){[yaw,pitch,zoom,panX,panY]=v;orbitPivot=v.slice(5,8);orbitOffset=v.slice(8,11);orbitDepth=v[11];}
 `+source+String.raw`
 const viewStates=[raw.slice(),defaultCamera(1),defaultCamera(2),defaultCamera(3)];restoreCamera(viewStates[index]);if(changed)viewShadings[0]='wireframe';
 const perspective=()=>viewIndex===0?captureCamera():viewStates[0],eye=()=>{const v=perspective();return inverseView([-v[3]-v[8],-v[4]-v[9],3.2-v[10]],v[0],v[1],0).map((x,k)=>x/scene.scale+scene.center[k]);};
 return {save:nativeCamera,valid:validNativeCamera,eye,raw:perspective,project:p=>{const v=perspective(),q=rotatePoint(p.map((x,k)=>(x-scene.center[k])*scene.scale),v[0],v[1],0),z=3.2-q[2]-v[10];return [(q[0]+v[8]+v[3])/z,(q[1]+v[9]+v[4])/z];},point:p=>{const v=perspective(),e=eye(),q=inverseView(p,v[0],v[1],0);return q.map((x,k)=>e[k]+x/scene.scale);},load:(record,next)=>{scene=structuredClone(next);applyNativeCamera(record);},active:()=>viewIndex,shading:()=>viewShadings.slice()};
 `);
 const close=(a,b,epsilon=1e-8)=>assert.ok(a.length===b.length&&a.every((v,k)=>Math.abs(v-b[k])<=epsilon*Math.max(1,Math.abs(v),Math.abs(b[k]))),JSON.stringify({a,b}));
 let maxProjectionError=0;const at=performance.now();
 for(let i=0;i<32;i++){
  const initial={center:[i*137-700,Math.sin(i)*900,500-i*83],scale:.01154700538*10**(i%5-2)},next={center:[300-i*29,200+i*47,-650+i*97],scale:initial.scale*(.31+(i%7)*.43)},raw=[-2+i*.13,-1.1+(i%9)*.23,.5+(i%5)*.4,.17*(i%3),-.29*(i%4),.3+i*.1,-.6+i*.03,.9-i*.02,-.7-i*.01,.2+i*.03,-1.4+(i%3)*.2,2.8+i*.1],index=i%4,f=create(initial,raw,index,index===0,i%3===1),points=[[-.3,.2,-2],[.7,-.5,-3],[0,0,-1],[-1,.8,-4],[.2,.3,-7]].map(f.point),before=points.map(f.project),eye=f.eye(),record=f.save();
  check('Case '+i+' records world eye, pivot, pan and depth from perspective view 0',()=>{assert.ok(f.valid(record));assert.ok([12,23,27].includes(record.length));close([...record.slice(8,11)],eye);close([...record.slice(5,8)],raw.slice(5,8).map((x,k)=>x/initial.scale+initial.center[k]));close([record[3],record[4],record[11]],[raw[3],raw[4],raw[11]].map(x=>x/initial.scale));close([...record.slice(0,3)],raw.slice(0,3));assert.equal(f.active(),index);});
  f.load(record,next);const after=points.map(f.project);for(let k=0;k<before.length;k++)for(let a=0;a<2;a++)maxProjectionError=Math.max(maxProjectionError,Math.abs(after[k][a]-before[k][a]));
  check('Case '+i+' changes normalization without changing projections or persisted camera',()=>{after.forEach((p,k)=>close(p,before[k],1e-7));close(f.eye(),eye);close([...f.save()], [...record],1e-7);assert.equal(f.active(),index);});
 }
 const ms=performance.now()-at;timings.push({name:'32 complete camera encode/decode cycles and 160 world projections',ms,limit:200});check('Camera persistence metadata stays below its completed CPU budget',()=>assert.ok(ms<200));
 check('Validation rejects malformed records before camera mutation',()=>{const f=create({center:[0,0,0],scale:1},[-.7,.5,1,0,0,0,0,0,0,0,0,3.2],0,true,false),v=[...f.save()];for(const bad of [v.slice(0,11),[...v,1],v.map((x,i)=>i===8?NaN:x),v.map((x,i)=>i===11?0:x)])assert.ok(!f.valid(bad));});
 check('Negative control proves normalized legacy coordinates fail the world-space contract',()=>{const initial={center:[0,0,0],scale:.01},f=create(initial,[-.7,.5,1,0,0,0,0,0,0,0,0,3.2],0,true,false),point=[10,20,30],before=f.project(point),old=f.raw();f.load(old,{center:[50,50,50],scale:.04});assert.ok(f.project(point).some((v,k)=>Math.abs(v-before[k])>.01));});
 return{pass:true,checks,timings,maxProjectionError};
 }catch(e){return{pass:false,checks,timings,error:e.stack};}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const r=await cameraHashCoordinateChecks();r.indexSHA256=createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex');await mkdir(new URL('results/',import.meta.url),{recursive:true});await writeFile(new URL('results/camera-hash-coordinates.json',import.meta.url),JSON.stringify(r,null,2));console.log(JSON.stringify({pass:r.pass,checks:r.checks.length,timings:r.timings,maxProjectionError:r.maxProjectionError,error:r.error},null,2));process.exitCode=r.pass?0:1;}
