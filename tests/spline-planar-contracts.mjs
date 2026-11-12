import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const normalize=value=>JSON.parse(JSON.stringify(value));
const near=(actual,expected,tolerance=1e-9)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);
const vectorNear=(a,b)=>a.forEach((v,k)=>near(v,b[k]));
function section(html,start,end){const a=html.indexOf(start),b=html.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,start);return html.slice(a,b);}
function loadKernel(html){return Function('return ('+html.match(/<script id="frame-spline-kernel"[^>]*>([\s\S]*?)<\/script>/)[1]+')')()();}
function shapeCodec(html){
 const definitions={spline:['Spline','',{'angle approximation':10}]},defaults=fields=>({...fields});
 return Function('defaults','definitions',section(html,'function frameCellLoops(','// The cubic kernel')+';return createFrameSplineCodec(["spline"]);')(defaults,definitions);
}
function historyRuntime(html,data){
 // Execute the native transaction/snapshot/Undo/Redo functions. Only renderer,
 // materials, plugin hooks and unrelated authoring services are test doubles.
 const noop=()=>{},author={root:()=>({}),reset:noop,changed:noop,history:a=>a,restoreNodes:a=>a,reserveNodes:()=>noop,setRoot:noop,preflightHistory:noop};
 const c={nodes:[{id:'source',nativeHash:'source-hash',type:'spline',params:{},tags:[],splineData:data}],
  window:{},FrameAuthorData:author,FrameMorph:{historyState:()=>null,restoreEditor:noop},FramePluginRecords:{bytes:()=>0,collect:noop},
  timelineFrame:0,timelineTotal:100,selected:new Set(),focusId:null,selectedTag:null,selectedTags:new Set(),activeMaterial:0,selectedMaterials:new Set(),materials:[],
  frameSerializeChannels:()=>[],frameRestoreChannels:noop,frameChannelSelection:[],frameChannels:new Map(),frameTarget:()=>null,frameIsPLAPath:()=>false,frameGetTrack:()=>null,
  textureImages:new Map(),materialThumbnails:new Map(),renderMaterials:noop,render:noop,syncMaterial:noop,frameEvaluateAnimation:noop,frameRefreshAnimationUI:noop,
  FramePlugins:{dispatch:noop},frameSyncMaterials:noop,frameSelectEngineObjects:noop,$:()=>({dataset:{elementMode:'vertex'}}),undoStack:[],redoStack:[],fileOperationError:e=>{throw e;}};
 vm.createContext(c);vm.runInContext(section(html,'function snapshot(){','function descendants(')+';globalThis.testHistory={commit,undo:()=>frameUndoUI(true),redo:()=>frameUndoUI(false),data:()=>nodes[0].splineData,stacks:()=>[undoStack.length,redoStack.length]};',c);
 return c.testHistory;
}
function splitFixture(K,curved=true){
 const data=K.createSplineData(),sequence=K.addSplineSequence(data),a=K.addSplineVertex(data,[0,0,0]),b=K.addSplineVertex(data,[10,0,0]);
 const edge=K.addSplineSegment(data,sequence,a,b,curved?[3,2,1]:[0,0,0],curved?[-3,2,-1]:[0,0,0]);return {data,edge};
}
function hitRuntime(html,K,data,mode){
 const owner={id:'source',nativeHash:'source-hash',type:'spline'},display={hash:owner.nativeHash,data,samples:new Map(Object.keys(data.segments).map(id=>[id,K.sampleSplineSegment(data,id)])),freeOffsets:new Map()};
 const c={scene:{},splineDisplays:new Map([[display.hash,display]]),elementMode:mode,viewIndex:0,nodes:[owner],frameViewportAt:()=>0,splineProjectionKey:()=>'',splineProjection:()=>({}),
  FrameSpline:{isActive:()=>true,isEditable:()=>true,K:()=>K,handleScale:1},splineShown:()=>true,curveReplicaDisplays:()=>[],splineHandleVisible:()=>false,
  projectedSplineControl:(_c,_id,p)=>[p[0],p[1],1],projectedSplineSegment:(_c,_id,ps)=>Float64Array.from(ps.flatMap(p=>[p.position[0],p.position[1],1])),projectSplineCached:(_c,p,out)=>out.set([p[0],p[1],1])};
 vm.createContext(c);vm.runInContext(section(html,'    function hitSpline(','    let splineHover=')+';globalThis.hit=hitSpline;',c);return c.hit;
}
function profile(K,rings,orientation){
 const data=K.createSplineData();for(let r=0;r<rings.length;r++){
  const [x,y,size,sides=4]=rings[r],sequence=K.addSplineSequence(data,true);
  const points=sides===4?[[x-size,y-size,0],[x+size,y-size,0],[x+size,y+size,0],[x-size,y+size,0]]:Array.from({length:sides},(_,i)=>[x+size*Math.cos(2*Math.PI*i/sides),y+size*Math.sin(2*Math.PI*i/sides),0]);
  if(orientation==='reverse'||orientation==='mixed'&&r%2)points.reverse();
  const ids=points.map(p=>K.addSplineVertex(data,p));for(let i=0;i<ids.length;i++)K.addSplineSegment(data,sequence,ids[i],ids[(i+1)%ids.length]);
 }return data;
}
function capArea(mesh){const p=mesh.positions??mesh.vertices;let area=0;for(let at=0;at<mesh.indices.length;at+=3){const [a,b,c]=Array.from(mesh.indices.subarray(at,at+3),i=>i*3);area+=Math.abs((p[b]-p[a])*(p[c+1]-p[a+1])-(p[c]-p[a])*(p[b+1]-p[a+1]))/2;}return area;}
function volume(mesh){const p=mesh.positions??mesh.vertices;let sum=0;for(let i=0;i<mesh.indices.length;i+=3){const [a,b,c]=Array.from(mesh.indices.subarray(i,i+3),j=>Array.from(p.subarray(j*3,j*3+3)));sum+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;}return sum;}
function closed(mesh){const edges=new Map();for(let i=0;i<mesh.indices.length;i+=3)for(let k=0;k<3;k++){const a=mesh.indices[i+k],b=mesh.indices[i+(k+1)%3],key=a<b?a+':'+b:b+':'+a;const row=edges.get(key)||[0,0];row[0]++;row[1]+=a<b?1:-1;edges.set(key,row);}assert.ok([...edges.values()].every(([count,sign])=>count===2&&sign===0),'closed, consistently oriented indexed extrusion');}
function covered(mesh,x,y){const p=mesh.positions??mesh.vertices;for(let i=0;i<mesh.indices.length;i+=3){const pts=Array.from(mesh.indices.subarray(i,i+3),j=>[p[3*j],p[3*j+1]]),cross=(a,b)=>(b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0]),signs=pts.map((a,k)=>cross(a,pts[(k+1)%3]));if(signs.every(v=>v>=-1e-10)||signs.every(v=>v<=1e-10))return true;}return false;}
export async function splinePlanarContractChecks({html=null,scope='all',legacyZero=false}={}){
 html??=await readFile(new URL('../index.html',import.meta.url),'utf8');
 const checks=[],timings=[],check=(name,fn)=>{fn();checks.push({name,pass:true});},K=loadKernel(html),codec=shapeCodec(html),hash=Function(section(html,'function createFrameHashCodec(){','const FrameHash=createFrameHashCodec();')+';return createFrameHashCodec();')();
 try{
  if(scope!=='planar'){
   const cases=[['zero',0,legacyZero?.5:1e-6],['negative zero',-0,legacyZero?.5:1e-6],['one',1,.999999],['negative',-2,1e-6],['above one',2,.999999],['small positive',1e-12,1e-6],['interior',.25,.25],['midpoint',.5,.5],['omitted',undefined,.5],['null',null,.5],['NaN',NaN,.5],['positive infinity',Infinity,.999999],['negative infinity',-Infinity,1e-6],['empty string','',.5],['zero string','0',.5],['one string','1',.999999],['numeric string','.25',.25],['invalid string','bad',.5],['false',false,.5],['object',{},.5]];
   for(const [label,input,expected]of cases){
    const {data,edge}=splitFixture(K),before=structuredClone(data),original=K.segmentPoints(data,edge),history=historyRuntime(html,data);let result;
    check(label+' split parameter and De Casteljau preservation',()=>{history.commit(()=>{result=K.splitSplineSegment(history.data(),edge,input);});assert.equal(result.t,expected);vectorNear(history.data().vertices[result.vertex],K.cubicPoint(original,expected));assert.equal(Object.keys(data.vertices).length,3);assert.equal(Object.keys(data.segments).length,2);for(const u of [0,.1,.4,.8,1]){vectorNear(K.cubicPoint(K.segmentPoints(data,result.left),u),K.cubicPoint(original,u*expected));vectorNear(K.cubicPoint(K.segmentPoints(data,result.right),u),K.cubicPoint(original,expected+u*(1-expected)));}assert.deepEqual([...history.stacks()],[1,0]);});
    const after=normalize(history.data());await history.undo();check(label+' native Undo restores exact authored cage',()=>{assert.deepEqual(normalize(history.data()),before);assert.deepEqual([...history.stacks()],[0,1]);});await history.redo();check(label+' native Redo restores exact split cage',()=>assert.deepEqual(normalize(history.data()),after));
    check(label+' native HASH spline bytes roundtrip exactly',()=>{const bytes=codec.encode({type:'spline',params:{},data:history.data()}),decoded=codec.decode(bytes.slice());assert.deepEqual(normalize(decoded.data),after);assert.deepEqual(codec.encode(decoded),bytes);});
    const recordId=hash.address('a'.repeat(32),'spline'),bytes=codec.encode({type:'spline',params:{},data:history.data()}),packed=await hash.pack({id:recordId,type:hash.T.bytes,value:bytes}),index=await hash.index(packed.blob),read=await hash.read(packed.blob,index.get(recordId));check(label+' native HASH record pack/index/read retains authored spline bytes',()=>{assert.deepEqual(read,bytes);assert.deepEqual(normalize(codec.decode(read).data),after);});
   }
   for(const input of [Symbol('bad'),1n])check(typeof input+' rejects before mutation',()=>{const {data,edge}=splitFixture(K),before=JSON.stringify(data);assert.throws(()=>K.splitSplineSegment(data,edge,input));assert.equal(JSON.stringify(data),before);});
   check('Missing segment rejects before mutation',()=>{const {data}=splitFixture(K),before=JSON.stringify(data);assert.throws(()=>K.splitSplineSegment(data,'missing',0),/segment not found/);assert.equal(JSON.stringify(data),before);});
   for(const input of [0,1,.5])check('Straight split '+input+' retains zero handles and line geometry',()=>{const {data,edge}=splitFixture(K,false),r=K.splitSplineSegment(data,edge,input);assert.ok(Object.values(data.segments).every(s=>[...s.ha,...s.hb].every(x=>x===0)));assert.equal(data.vertices[r.vertex][1],0);assert.equal(data.vertices[r.vertex][2],0);});
   check('Forward/reversed explicit cell boundaries retain new split edge order',()=>{for(const reversed of [false,true]){const data=profile(K,[[0,0,10]],'normal'),loop=Object.keys(data.segments).map(edge=>({edge,reversed:false}));if(reversed)loop.reverse().forEach(r=>r.reversed=true);data.sourceCells=[{loops:[loop]}];const edge=loop[0].edge,r=K.splitSplineSegment(data,edge,0),refs=data.sourceCells[0].loops[0];assert.deepEqual(refs.slice(0,2).map(r=>r.edge),reversed?[r.right,r.left]:[r.left,r.right]);const bytes=codec.encode({type:'spline',params:{},data});assert.deepEqual(codec.encode(codec.decode(bytes.slice())),bytes);}});
   check('Actual native Ctrl picker gives endpoint vertices priority and emits interior curve parameters',()=>{const {data}=splitFixture(K,false);Object.values(data.vertices)[1][0]=100;const vertexHit=hitRuntime(html,K,data,'vertex'),edgeHit=hitRuntime(html,K,data,'edge');assert.ok(vertexHit(0,0,false,false,true)?.vertex);assert.ok(vertexHit(100,0,false,false,true)?.vertex);const middle=vertexHit(50,0,false,false,true);assert.ok(middle?.segment&&middle.t>0&&middle.t<1);for(const x of [0,100]){const hit=edgeHit(x,0,false,false,true);assert.ok(hit?.segment&&hit.t>0&&hit.t<1);}});
   check('Production callers retain midpoint command and interior hit refinement',()=>{assert.ok(html.includes('K().splitSplineSegment(d,id,.5)'));assert.ok(html.includes('K().splitSplineSegment(n.splineData,h.segment,h.t)'));assert.ok(html.includes('const parameter=(lo+hi)/2,q=at(parameter)'));});
   const at=performance.now();for(let i=0;i<10000;i++){const {data,edge}=splitFixture(K);K.splitSplineSegment(data,edge,i%2?0:.37);}const ms=performance.now()-at;timings.push({name:'10000 completed fixture creation and split operations',ms,budget:1500});check('Split completed-operation budget',()=>assert.ok(ms<1500));
  }
  if(scope!=='split'){
   const cases=[['single',[[0,0,10]],400,[1]],['hole',[[0,0,10],[0,0,8]],144,[2]],['island',[[0,0,10],[0,0,8],[0,0,6]],288,[2,1]],['depth three',[[0,0,10],[0,0,8],[0,0,6],[0,0,4]],224,[2,2]],['depth four',[[0,0,10],[0,0,8],[0,0,6],[0,0,4],[0,0,2]],240,[2,2,1]],['disjoint holes',[[0,0,10],[-5,0,2],[5,0,2]],368,[3]],['disjoint outers',[[-15,0,10],[15,0,10]],800,[1,1]],['nested hexagons',[[0,0,10,6],[0,0,8,6],[0,0,6,6],[0,0,4,6]],(100-64+36-16)*3*Math.sqrt(3)/2,[2,2]]];
   const at=performance.now();for(const [label,rings,expected,loops]of cases)for(const orientation of ['normal','reverse','mixed']){
    const data=profile(K,rings,orientation),before=JSON.stringify(data),plan=K.buildSplineSurface.resolve(data),surface=K.buildSplineSurface(data);
    check(label+' '+orientation+' resolves direct-child holes separately from islands',()=>{assert.deepEqual(plan.fills.map(f=>f.loops.length),loops);near(capArea(surface),expected,expected*1e-7);assert.equal(JSON.stringify(data),before);});
    if(label==='depth three')check(label+' '+orientation+' actual triangles retain alternating fill',()=>{for(const [x,fill]of [[11,false],[9,true],[7,false],[5,true],[3,false]])assert.equal(covered(surface,x,.371),fill);});
    for(const offset of [-3,3])check(label+' '+orientation+' '+offset+' Extrude and editable cage preserve cap area, volume and manifold topology',()=>{const direct=K.planarExtrusion(data,{offset});assert.ok(direct);const cage=K.generate('extrude',[data],{offset}),mesh=K.buildSplineSurface(cage);for(const m of [direct.surface,mesh]){near(capArea(m)/2,expected,expected*1e-6);near(Math.abs(volume(m)),expected*Math.abs(offset),expected*1e-6);closed(m);}assert.equal(JSON.stringify(data),before);});
   }
   for(const diameters of [[20,16,12],[20,16,12,8]])for(const orientation of ['normal','reverse','mixed']){
    const circles=diameters.map((diameter,ri)=>{const data=K.primitive('circle',{diameter,'angle approximation':10});if(orientation==='reverse'||orientation==='mixed'&&ri%2){for(const s of Object.values(data.segments)){[s.a,s.b]=[s.b,s.a];[s.ha,s.hb]=[s.hb,s.ha];}for(const q of data.sequences){q.segments.reverse();q.first=data.segments[q.segments[0]].a;}}return data;}),ringArea=data=>{const points=K.approximateSpline(data)[0].points.map(p=>p.position);return Math.abs(points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p[0]*q[1]-p[1]*q[0];},0))/2;},expected=circles.reduce((sum,d,i)=>sum+(i%2?-1:1)*ringArea(d),0),data=K.merge(circles),surface=K.buildSplineSurface(data),plan=K.buildSplineSurface.resolve(data),label=diameters.length+' curved rings '+orientation;
    check(label+' triangulate into independent even-depth regions',()=>{assert.deepEqual(plan.fills.map(f=>f.loops.length),diameters.length===3?[2,1]:[2,2]);near(capArea(surface),expected,expected*1e-6);for(const [x,fill]of [[11,false],[9,true],[7,false],[5,true],[3,diameters.length===3]])assert.equal(covered(surface,x,.371),fill);});
    for(const offset of [-3,3])check(label+' '+offset+' direct and editable caps match sampled cubic boundaries',()=>{const direct=K.planarExtrusion(data,{offset}),mesh=K.buildSplineSurface(K.generate('extrude',[data],{offset}));assert.ok(direct);for(const m of [direct.surface,mesh]){near(capArea(m)/2,expected,expected*1e-6);near(Math.abs(volume(m)),expected*Math.abs(offset),expected*1e-6);closed(m);}});
   }
   const ms=performance.now()-at;timings.push({name:'30 profiles through planar resolution and signed direct/editable extrusion',ms,budget:2500});check('Planar completed-operation budget',()=>assert.ok(ms<2500));
   check('A forged single cell with nested island loops rejects rather than pretending earcut supports arbitrary parity',()=>{const data=profile(K,[[0,0,10],[0,0,8],[0,0,6]],'normal'),fills=K.buildSplineSurface.resolve(data).fills;assert.throws(()=>K.buildSplineSurface.cell(data,{...fills[0],loops:fills.flatMap(f=>f.loops)},10),/invalid or intersecting planar contours/);});
  }
  return {pass:true,indexSHA256:createHash('sha256').update(html).digest('hex'),checks,timings};
 }catch(error){return {pass:false,indexSHA256:createHash('sha256').update(html).digest('hex'),checks,timings,error:error.stack};}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const source=process.argv.find(a=>a.startsWith('--source='))?.slice(9),scope=process.argv.find(a=>a.startsWith('--scope='))?.slice(8)||'all';
 const result=await splinePlanarContractChecks({html:source?await readFile(source,'utf8'):null,scope,legacyZero:process.argv.includes('--legacy-zero')});console.log(JSON.stringify(result,null,2));process.exitCode=result.pass?0:1;
}
