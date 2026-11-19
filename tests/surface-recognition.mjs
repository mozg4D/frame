import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../tools/browser.mjs';

// Independent tessellation of a lobed cam with an eccentric elliptical through bore.
// Intermediate rows and alternating diagonals are part of the input, not cage hints.
export function camMesh(steps,rows,{circular=false,bulge=0,shuffle=false}={}){
  const vertices=[],indices=[],ids=(side,row,i)=>(side*(rows+1)+row)*steps+i%steps;
  for(let side=0;side<2;side++)for(let row=0;row<=rows;row++)for(let i=0;i<steps;i++){
    const a=2*Math.PI*i/steps,h=12*row/rows;
    const r=side?8:30+(circular?0:5*Math.cos(3*a)+2*Math.sin(2*a))+bulge*Math.sin(Math.PI*row/rows);
    const x=(side&&!circular?3:0)+r*Math.cos(a),y=(side&&!circular?0.65:1)*r*Math.sin(a);
    vertices.push(15+.8*x-.36*y+.48*h,-23+.6*x+.48*y-.64*h,8+.8*y+.6*h);
  }
  const quad=(a,b,c,d,flip)=>flip?indices.push(a,b,d,b,c,d):indices.push(a,b,c,a,c,d);
  for(let i=0;i<steps;i++){
    const j=i+1;
    for(let row=0;row<rows;row++){
      quad(ids(0,row,i),ids(0,row,j),ids(0,row+1,j),ids(0,row+1,i),(row+i)%2);
      quad(ids(1,row,j),ids(1,row,i),ids(1,row+1,i),ids(1,row+1,j),(row+i)%2);
    }
    quad(ids(1,0,i),ids(1,0,j),ids(0,0,j),ids(0,0,i),i%2);
    quad(ids(0,rows,i),ids(0,rows,j),ids(1,rows,j),ids(1,rows,i),i%2);
  }
  if(shuffle){
    let seed=17;
    for(let i=indices.length/3-1;i>0;i--){
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;
      const j=seed%(i+1);
      for(let k=0;k<3;k++)[indices[i*3+k],indices[j*3+k]]=[indices[j*3+k],indices[i*3+k]];
    }
  }
  return {vertices:Float32Array.from(vertices),indices:Uint32Array.from(indices)};
}

function twoBorePlate(){
  const vertices=[],indices=[],ids=new Map(),steps=128;
  function vertex(p){const key=p.join(':');if(!ids.has(key)){ids.set(key,vertices.length/3);vertices.push(...p);}return ids.get(key);}
  const quad=(a,b,c,d)=>indices.push(a,b,c,a,c,d);
  for(const cx of [-16,16]){
    const rims=[],holes=[];
    for(let i=0;i<steps;i++){
      const u=(i%32)/32,p=[[-1+2*u,-1],[1,-1+2*u],[1-2*u,1],[-1,1-2*u]][Math.floor(i/32)],a=Math.atan2(p[1],p[0]),r=cx<0?6:7+1.5*Math.sin(3*a);
      rims.push([cx+16*p[0],16*p[1]]);holes.push([cx+r*Math.cos(a),r*.75*Math.sin(a)]);
    }
    for(let i=0;i<steps;i++){
      const j=(i+1)%steps,[a,b,c,d]=[rims[i],rims[j],holes[j],holes[i]];
      const [A,B,C,D]=[a,b,c,d].map(p=>vertex([...p,0])),[E,F,G,H]=[a,b,c,d].map(p=>vertex([...p,6]));
      quad(D,C,B,A);quad(E,F,G,H);quad(C,D,H,G);if(a[0]!==0||b[0]!==0)quad(A,B,F,E);
    }
  }
  return {vertices,indices};
}

// Intersect the actual output triangles with a mid-height plane, then compare
// both section contours in both directions with the independent input profile.
function camSection({vertices,indices}){
  const local=i=>{const x=vertices[i*3]-15,y=vertices[i*3+1]+23,z=vertices[i*3+2]-8;return [.8*x+.6*y,-.36*x+.48*y+.8*z,.48*x-.64*y+.6*z];};
  const section=[],edges=new Map();
  for(let i=0;i<indices.length;i+=3){
    const hits=[];
    for(let k=0;k<3;k++){
      const a=indices[i+k],b=indices[i+(k+1)%3],key=Math.min(a,b)+':'+Math.max(a,b),entry=edges.get(key)||[0,0];entry[0]++;entry[1]+=a<b?1:-1;edges.set(key,entry);
      const p=local(a),q=local(b);
      if((p[2]>5.31)!==(q[2]>5.31)){const t=(5.31-p[2])/(q[2]-p[2]);hits.push([p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])]);}
    }
    if(hits.length===2)section.push(hits);
  }
  function contour(hole){const ps=[];for(let i=0;i<1024;i++){const a=i*2*Math.PI/1024,r=30+5*Math.cos(3*a)+2*Math.sin(2*a);ps.push(hole?[3+8*Math.cos(a),5.2*Math.sin(a)]:[r*Math.cos(a),r*Math.sin(a)]);}return ps.map((p,i)=>[p,ps[(i+1)%ps.length]]);}
  const ref=[...contour(false),...contour(true)];
  const dist=(p,[a,b])=>{const x=b[0]-a[0],y=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*x+(p[1]-a[1])*y)/(x*x+y*y||1)));return Math.hypot(p[0]-a[0]-t*x,p[1]-a[1]-t*y);};
  const deviation=(from,to)=>{let error=0;for(const [a,b] of from)for(const p of [a,[(a[0]+b[0])/2,(a[1]+b[1])/2]]){let best=Infinity;for(const line of to)best=Math.min(best,dist(p,line));error=Math.max(error,best);}return error;};
  return {deviation:Math.max(deviation(ref,section),deviation(section,ref)),badEdges:[...edges.values()].filter(([count,winding])=>count!==2||winding!==0).length};
}

export async function surfaceRecognitionChecks(page){
  const checks=[],timings=[];
  function check(name,pass,detail){checks.push({name,pass:!!pass,detail});assert.ok(pass,name+' '+JSON.stringify(detail));}
  const call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]);
  async function convert(name,args){
    await call('scene.new');
    const mesh=await page.evaluate(async args=>{const {vertices,indices}=window.makeRecognitionCam(...args);return frameAI.call('mesh.create',{vertices:Array.from(vertices),indices:Array.from(indices)});},args);
    const before=await call('diagnostics.mesh',{id:mesh.hash,geometry:true});
    const start=performance.now(),patch=await call('mesh.toSplinePatch',{id:mesh.hash}),ms=performance.now()-start;
    timings.push({name,inputTriangles:before.triangles,ms,cells:patch.spline?.cells});
    check(name+' completes within its native operation budget',ms<(before.triangles>100000?15000:5000)&&patch.type==='spline_patch'&&patch.sources.length===1&&!patch.buildError,timings.at(-1));
    return {mesh,patch,before};
  }
  try{
    await page.addScriptTag({content:'window.makeRecognitionCam='+camMesh.toString()+';window.measureRecognitionSection='+camSection.toString()});
    const {mesh,patch,before}=await convert('Oblique cam with through bore',[512,12,{shuffle:true}]);
    const cage=await call('spline.inspect',{id:patch.hash,cells:true}),after=await call('diagnostics.mesh',{id:patch.hash,geometry:true});
    check('Both caps keep the bore and share an editable cubic cage with the walls',patch.spline.cells<=40&&cage.report.diagnostics.genus===1&&cage.report.diagnostics.planarHoles===2&&cage.data.version===2&&!cage.data.sourceCells,patch.spline);
    const section=await page.evaluate(async id=>window.measureRecognitionSection(await frameEngine.readGeometry(id)),patch.hash);
    check('Native section follows both analytic contours with oriented watertight triangles',section.deviation<.10&&section.badEdges===0,section);
    const volumeError=Math.abs(Math.abs(after.signedVolume)/(12*Math.PI*(900+14.5-8*5.2))-1);
    check('Cam analytic volume',after.finite&&after.indicesValid&&volumeError<.003,{volumeError});
    await call('edit.history',{action:'undo'});const undo=await call('diagnostics.mesh',{id:mesh.hash,geometry:true});
    check('Undo restores both original GPU buffers',undo.positionsSHA256===before.positionsSHA256&&undo.indicesSHA256===before.indicesSHA256);
    await call('edit.history',{action:'redo'});const redo=await call('diagnostics.mesh',{id:patch.hash,geometry:true});
    check('Redo regenerates the same surface',redo.positionsSHA256===after.positionsSHA256&&redo.indicesSHA256===after.indicesSHA256);
    const saved=await call('scene.export',{includeData:true});await call('scene.open',{name:'cam.hash',base64:saved.base64});
    const loaded=await call('spline.inspect',{id:patch.hash}),reopened=await call('diagnostics.mesh',{id:patch.hash,geometry:true});
    check('HASH reopens with identical controls and evaluated GPU geometry',JSON.stringify(loaded.data.vertices)===JSON.stringify(cage.data.vertices)&&reopened.positionsSHA256===after.positionsSHA256&&reopened.indicesSHA256===after.indicesSHA256);
    const round=await convert('Dense rotated sleeve',[1024,75,{circular:true}]);
    check('More than 150k faces in one smooth region still yield a ten-cell sleeve',round.before.triangles===311296&&round.patch.spline.cells===10,round.patch.spline);
    const d=await call('diagnostics.mesh',{id:round.patch.hash,geometry:true}),roundError=Math.abs(Math.abs(d.signedVolume)/(Math.PI*(30*30-8*8)*12)-1);
    check('Dense sleeve retains its bore and volume',roundError<.003,{roundError});
    const rejected=await page.evaluate(async()=>{const {vertices,indices}=window.makeRecognitionCam(96,5,{bulge:2});const r=await FrameGeometry.worker('recognize',{positions:vertices,indices,options:{requireComplete:true}},[vertices.buffer,indices.buffer]);return {extruded:r.report.extrudedContours||0,unknown:r.report.unrecognizedTriangles};});
    check('Identical end contours cannot erase a bulged wall',!rejected.extruded&&rejected.unknown>0,rejected);
    await call('scene.new');
    const plate=await call('mesh.create',twoBorePlate()),converted=await call('scene.convert',{id:plate.hash}),plateCage=await call('spline.inspect',{id:converted.hash,cells:true});
    const sharpCorners=Object.values(plateCage.data.vertices).filter(([x,y,z])=>Math.abs(x)===32&&Math.abs(y)===16&&(z===0||z===6));
    check('Make Editable reconstructs two different bores and preserves all eight sharp plate corners',converted.spline.cells<60&&sharpCorners.length===8&&plateCage.report.diagnostics.genus===2&&plateCage.report.diagnostics.planarHoles===4,{cells:converted.spline.cells,sharpCorners:sharpCorners.length,genus:plateCage.report.diagnostics.genus});
    await call('scene.new');
    const invalid=await call('mesh.create',{vertices:[0,0,0,10,0,0,0,10,0,0,-10,0,0,0,10],indices:[0,1,2,1,0,3,0,1,4]}),original=await call('diagnostics.mesh',{id:invalid.hash,geometry:true});let reason='';
    try{await call('mesh.toSplinePatch',{id:invalid.hash});}catch(error){reason=error.message;}
    const preserved=await call('diagnostics.mesh',{id:invalid.hash,geometry:true});
    check('A three-face edge rejects atomically with the source still editable',/non-manifold/.test(reason)&&preserved.positionsSHA256===original.positionsSHA256&&preserved.indicesSHA256===original.indicesSHA256&&(await call('scene.inspect')).objects.some(n=>n.hash===invalid.hash&&n.type==='mesh'));
    const stale=await page.evaluate(async plateInput=>{
      const mesh=await frameAI.call('mesh.create',plateInput),owner=nodes.find(n=>n.nativeHash===mesh.hash),build=FrameSpline.build;
      let entered,release;const reached=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
      FrameSpline.build=async function(...args){const result=await build(...args);if(args[1]==='recognize:'+mesh.hash){entered();await gate;}return result;};
      try{
        const pending=FrameGeometry.toPatch(owner).then(()=>'',e=>e.message);
        await Promise.race([reached,pending.then(reason=>{throw Error('Preflight did not run: '+reason);})]);
        await frameAI.call('scene.delete',{ids:[mesh.hash]});release();const reason=await pending;
        return {reason,sourceSurvived:nodes.includes(owner),extraCages:nodes.filter(n=>n.type==='spline').length};
      }finally{release();FrameSpline.build=build;}
    },twoBorePlate());
    check('A deleted mesh cannot publish after asynchronous preflight',/changed during recognition/.test(stale.reason)&&!stale.sourceSurvived&&!stale.extraCages,stale);
    return {pass:true,checks,timings};
  }catch(error){return {pass:false,error:error.stack,checks,timings};}
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const session=await launch({headless:process.argv.includes('--headless')}),errors=[];
  try{
    await ready(session.page);session.page.on('pageerror',e=>errors.push(e.message));
    await session.page.evaluate(()=>{window.recognitionGPU=[];const d=frameEngine.renderer.device;d.addEventListener('uncapturederror',e=>recognitionGPU.push(e.error.message));d.pushErrorScope('validation');});
    const result=await surfaceRecognitionChecks(session.page);
    const gpu=await session.page.evaluate(async()=>({validation:(await frameEngine.renderer.device.popErrorScope())?.message,uncaptured:recognitionGPU}));
    console.log(JSON.stringify({...result,errors,gpu},null,2));
    process.exitCode=result.pass&&!errors.length&&!gpu.validation&&!gpu.uncaptured.length?0:1;
  }finally{await session.close();}
}
