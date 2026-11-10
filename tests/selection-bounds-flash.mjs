import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export async function selectionBoundsFlashChecks(){
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),source=html.slice(html.indexOf('    function projectedBoundsFlash('),html.indexOf("    // Frame r248's combined transform geometry")),checks=[],timings=[],test=(name,fn)=>{try{fn();checks.push({name,pass:true});}catch(e){checks.push({name,pass:false,error:e.stack});}};
 const e={scene:{center:[0,0,0],scale:1},viewIndex:0,frameViewKind:i=>i===4?0:i,zoom:1,cameraFocal:()=>1,orbitOffset:[0,0,0],panX:0,panY:0,rotatePoint:p=>[p[0],p[1],3.2-p[2]]};vm.createContext(e);vm.runInContext(source,e);
 const rect={left:31,top:29,width:400,height:200},box=(min,max)=>({min,max}),run=(b,clip=[.1,10])=>e.projectedBoundsFlash(b,rect,clip),segments=d=>(d.match(/M[^M]+/g)||[]).map(s=>s.slice(1).split('L').map(p=>p.split(',').map(Number))),bounded=d=>{for(const line of segments(d))for(const p of line){assert.ok(p.every(Number.isFinite));assert.ok(p[0]>=-1e-8&&p[0]<=400+1e-8&&p[1]>=-1e-8&&p[1]<=200+1e-8,JSON.stringify(p));}};
 test('Visible box retains twelve original edges and exact local viewport projection',()=>{const d=run(box([-.4,-.3,2],[.4,.3,3]));assert.equal(segments(d).length,12);for(const [i,value]of segments(d)[0].flat().entries())assert.ok(Math.abs(value-[180,115,220,115][i])<1e-10);bounded(d);});
 test('Wholly behind camera boxes draw no mirrored feedback',()=>assert.equal(run(box([-.1,-.1,-3],[.1,.1,-2])),''));
 test('Near-plane crossing retains visible edge portions and no inverted segment',()=>{const d=run(box([-.02,-.02,-1],[.02,.02,2]));bounded(d);assert.equal(segments(d).length,8);for(const line of segments(d))for(const p of line)assert.ok(p[0]>179&&p[0]<221);});
 test('Far-plane rejection and crossing use the same camera range',()=>{assert.equal(run(box([-.1,-.1,11],[.1,.1,12])), '');const d=run(box([-.1,-.1,9],[.1,.1,12]));assert.equal(segments(d).length,8);bounded(d);});
 test('All four side planes trim feedback to the viewport',()=>{for(const b of [box([-20,-.2,1],[20,.2,2]),box([-.2,-20,1],[.2,20,2])]){const d=run(b);assert.ok(d);bounded(d);}assert.equal(run(box([20,20,1],[30,30,2])), '');});
 test('Zero depth and degenerate flat bounds cannot emit NaN or Infinity',()=>{for(const b of [box([0,0,0],[0,0,0]),box([-1,-1,0],[1,1,1]),box([0,0,1],[0,0,1])])bounded(run(b));});
 test('Nonfinite metadata never reaches SVG',()=>assert.equal(run(box([NaN,0,1],[Infinity,1,2])), ''));
 test('Additional Perspective views keep perspective clipping',()=>{const b=box([-.1,-.1,-3],[.1,.1,-2]);e.viewIndex=4;assert.equal(run(b),'');e.viewIndex=0;});
 test('Orthographic keeps negative-depth bounds within its signed clipping range',()=>{e.viewIndex=1;const d=run(box([-.4,-.3,-3],[.4,.3,-2]),[-10,10]);assert.equal(segments(d).length,12);bounded(d);e.viewIndex=0;});
 test('Pan and orbit offsets participate before frustum clipping',()=>{e.panX=100;assert.equal(run(box([-.1,-.1,1],[.1,.1,2])), '');e.panX=0;e.orbitOffset=[0,0,5];assert.equal(run(box([-.1,-.1,1],[.1,.1,2])), '');e.orbitOffset=[0,0,0];});
 test('Negative control catches the old unbounded perspective divide',()=>{const old=p=>[(p[0]/p[2]/2+1)*200,(1-p[1]/p[2])*100],a=old([1,1,.00001]);assert.ok(a[0]>1000000);bounded(run(box([1,1,-1],[2,2,.00001])));});
 test('Shipped feedback consumes the native per-view near and far planes',()=>assert.match(html,/const clip=clippingPlanes\(\);path\.setAttribute\('d',objectSelection\.map\(h=>projectedBoundsFlash\(nodeBounds\(h\),rect,clip\)\)/));
 test('Rolled and rotated camera uses the existing native projection basis',()=>{const rotate=html.slice(html.indexOf('    function rotatePoint('),html.indexOf('    function projectOrbitPoint('));Object.assign(e,{yaw:.7,pitch:-.3,cameraRoll:1.2});vm.runInContext(rotate,e);bounded(run(box([-20,-20,-20],[20,20,20])));e.rotatePoint=p=>[p[0],p[1],3.2-p[2]];});
 test('Feedback projection reads only existing bounds and camera metadata',()=>assert.doesNotMatch(source,/readGeometry|nativeReadGPU|createBuffer|scene\.meshes|\.positions|\.indices/));
 const b=box([-2,-2,-1],[2,2,3]);for(let i=0;i<100;i++)run(b);const t=performance.now();for(let i=0;i<10000;i++)run(b);const ms=performance.now()-t;timings.push({name:'10000 completed box feedback projections',ms,budgetMs:1500});test('Completed feedback CPU budget',()=>assert.ok(ms<1500,`${ms} ms`));
 return {pass:checks.every(c=>c.pass),checks,timings};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const r=await selectionBoundsFlashChecks();r.indexSHA256=createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex');await mkdir(new URL('results/',import.meta.url),{recursive:true});await writeFile(new URL('results/selection-bounds-flash-cpu.json',import.meta.url),JSON.stringify(r,null,2));console.log(JSON.stringify(r,null,2));process.exitCode=r.pass?0:1;}
