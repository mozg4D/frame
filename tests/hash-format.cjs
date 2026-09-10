const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),part=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
class Matrix4{constructor(){this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];}fromArray(a){this.elements=Array.from(a);return this;}clone(){return new Matrix4().fromArray(this.elements);}}
class Vector3{constructor(x=0,y=0,z=0){this.set(x,y,z);}set(x,y,z){Object.assign(this,{x,y,z});return this;}}
const ctx={structuredClone,Blob,TextEncoder,TextDecoder,console,THREE2:{Matrix4,Vector3},defaultMapFrame:()=>new Matrix4(),ensureTagFrame:t=>{t.mapFrame??=new Matrix4();t.mapPivot??=new Matrix4();},OBJ:new Map(),MATS:new Map(),objParams:new Map(),splineData:new Map(),sceneObjects:new Map(),pickMeshes:new Map(),rootOrder:[],defaultMatHash:null,TYPE_MESH:1,PARAMETRIC_MESH_TYPES:new Set(['cube','cylinder','tube','sphere']),PARAMETRIC_SPLINE_TYPES:new Set(['square','circle','polyhedron','text']),animationTracks:new Map(),tlCur:0,tlTotal:100,tlInterp:'soft',getObj:h=>ctx.OBJ.get(h),clearHistory(){},clearContent(){ctx.sceneObjects.clear();},disposeThreeMats(){},buildSceneFromObjects(){},texBytesToImage(b,m,cb){},syncThreeMat(){},scheduleRender(){},createDefaultMat(){ctx.defaultMatHash='f'.repeat(32);ctx.MATS.set(ctx.defaultMatHash,{name:'default',isDefault:true,h:0,s:0,l:50,emm:0,rough:50,metal:0,opac:0,bump:0});}};
vm.createContext(ctx);
vm.runInContext(part('var HSH = {','var _matReadyCb'),ctx);
vm.runInContext(part('function applyTR(','function clearScene()'),ctx);
const defs=part('DEFAULTS = {',', attrContent =');vm.runInContext('var '+defs+';',ctx);
vm.runInContext(part('var UIALL =','function restoreAnimationPayload(')+part('const HASH_PARAM_DEFAULTS','var EXTERNAL_EXTENSIONS')+';this.NativeHash=NativeHash;',ctx);
const plain=v=>JSON.parse(JSON.stringify(v));
const node=(h,name='object',extra={})=>({hash:h,name,type:1,parent:null,children:[],visible:true,enabled:true,enableSlot:false,folded:false,tags:[],pos:new Vector3(),lin:new Matrix4(),pivot:new Matrix4(),...extra});
const id=i=>require('node:crypto').createHash('md5').update('test-object-'+i).digest('hex');
const bytes=async()=>new Uint8Array(await (await ctx.fullBlob()).arrayBuffer());
const manifest=b=>plain(ctx.NativeHash.decode(b));
function load(b){const p=ctx.unpackUI(b);ctx.rebuildFromBytes(b);ctx.objParams=p;ctx.splineData=new Map(ctx.pendingSplinePayload||[]);}
(async()=>{
ctx.createDefaultMat();ctx.MATS.set(id(99),{texBytes:new Uint8Array(20000),name:'unused'});ctx.tlCur=40;ctx.tlTotal=500;assert.equal((await bytes()).length,0,'empty must be zero bytes even with unused resources');
const a=id(1);ctx.OBJ.set(a,node(a,'cylinder'));ctx.rootOrder=[a];ctx.objParams.set(a,{__type:'cylinder',diameter:100,height:100,approximation:10});ctx.pickMeshes.set(a,{geometry:{attributes:{position:{array:new Float32Array(300000)}},index:{array:new Uint32Array(900000)}}});
let b=await bytes(),m=manifest(b);assert.equal(b.length<160,true);assert.deepEqual(m,{nodes:[[a,{kind:'cylinder'}]]});const small=b.length;load(b);assert.equal(ctx.objParams.get(a).height,100);assert.equal(ctx.OBJ.get(a).pos.y,0);assert.equal(ctx.sceneObjects.size,0);
ctx.objParams.get(a).height=175;ctx.OBJ.get(a).pos.y=23;ctx.OBJ.get(a).enabled=false;ctx.OBJ.get(a).pivot.elements[12]=7;
const group=id(2),mesh=id(3),spline=id(4),mat=id(5);ctx.OBJ.set(group,node(group,'group',{type:0,children:[spline,mesh]}));ctx.OBJ.set(mesh,node(mesh,'polygon',{parent:group}));ctx.OBJ.set(spline,node(spline,'cage',{parent:group}));ctx.rootOrder=[group,a];ctx.objParams.set(spline,{__type:'spline',angle:10});const cage=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/cylinder.json')));cage.freeHandles={v2:{in:[-1,0,0],out:[1,0,0]}};ctx.splineData.set(spline,cage);
ctx.pickMeshes.set(mesh,{geometry:{attributes:{position:{array:new Float32Array([0,0,0,1,0,0,0,1,0])}},index:{array:new Uint32Array([0,1,2])}}});
ctx.MATS.set(mat,{name:'red',h:0,s:100,l:50,emm:0,rough:50,metal:0,opac:0,bump:0,isDefault:false,mapFrame:new Matrix4(),mapPivot:new Matrix4(),texBytes:new Uint8Array([1,2,3]),texMime:'image/png'});ctx.OBJ.get(spline).tags=[{type:2,id:id(77),domain:'vertex',targets:['v2'],profile:'round',radius:3,shelfA:1,shelfB:2}];ctx.OBJ.get(mesh).tags=[{type:1,ref:mat,polys:null,mapFrame:new Matrix4(),mapPivot:new Matrix4()}];ctx.animationTracks.set(a,new Map([[10,{p:[0,3,0],q:[0,0,0,1],s:[1,1,1],interp:'linear'}]]));
b=await bytes();m=manifest(b);assert(!JSON.stringify(m).includes('rough'));assert(!JSON.stringify(m).includes('mapPivot'));assert.equal(m.materials.length,1);assert.equal(ctx.splineData.get(spline).segments.sk.ha.length,3,'save must not mutate cage');load(b);
assert.deepEqual(plain(ctx.rootOrder),[group,a]);assert.deepEqual(plain(ctx.OBJ.get(group).children),[spline,mesh]);assert.equal(ctx.objParams.get(a).height,175);assert.equal(ctx.OBJ.get(a).pos.y,23);assert.equal(ctx.OBJ.get(a).enabled,false);assert.equal(ctx.OBJ.get(a).pivot.elements[12],7);assert.equal(ctx.sceneObjects.get(mesh).geom.indices.length,3);assert.deepEqual(plain(ctx.splineData.get(spline)),cage);assert.equal(ctx.MATS.get(mat).texMime,'image/png');assert.deepEqual(Array.from(ctx.MATS.get(mat).texBytes),[1,2,3]);assert.equal(ctx.pendingAnimation.tracks[0][1][0][0],10);assert.equal(ctx.OBJ.get(mesh).tags[0].ref,mat);assert.deepEqual(plain(ctx.OBJ.get(spline).tags[0].targets),['v2']);assert.equal(ctx.OBJ.get(spline).tags[0].radius,3);
// Independent HTML-editor interpretation: standard IDs, word-wise hash bytes, XOR access.
const native=ctx.NativeHash,raw=native.reader(b);assert.equal(native.T.f32,5);assert.equal(native.T.text,7);
const known='02efed95003a2a925d5552b56b12e545',wire=native.hex(known);const words=new Uint32Array(wire.buffer);assert.equal(Array.from(words,x=>x.toString(16).padStart(8,'0')).join(''),known);
assert.equal(native.xor(native.xor(a,native.keys.params),native.keys.height),native.key(native.key(a,'params'),'height'));
for(const record of raw.values()){assert(record.type>=0&&record.type<=7);if(record.type===7){const text=new TextDecoder().decode(record.data);assert(!text.startsWith('{')&&!text.startsWith('['),'structured data disguised as UTF8');}}
const heightKey=(BigInt('0x'+a)^BigInt('0x'+native.keys.params)^BigInt('0x'+native.keys.height)).toString(16).padStart(32,'0');assert.equal(raw.get(heightKey).type,6);assert.equal(new DataView(raw.get(heightKey).data.buffer,raw.get(heightKey).data.byteOffset,8).getFloat64(0,true),175);
assert.throws(()=>native.decode(b.subarray(0,b.length-1)),/Truncated|Invalid/);
assert.throws(()=>native.decode(new TextEncoder().encode('{"nodes":[]}')),/Truncated|Invalid/);
const empty=new Uint8Array();load(empty);assert.equal(ctx.OBJ.size,0);assert.equal(ctx.objParams.size,0);assert.equal((await bytes()).length,0);
console.log('PASS native hash: empty=0 bytes; default cylinder='+small+' bytes; changed params, transforms, pivot, hierarchy/order, editable mesh, cage, material/texture/tag and animation round-trip; standard type IDs, HTML-editor hash byte order and direct multidimensional XOR lookup verified.');
})().catch(e=>{console.error(e);process.exitCode=1;});
