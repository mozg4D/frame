// Deterministic native authoring workload; generated display polygons are not saved.
import {mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {createHash,webcrypto} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

globalThis.crypto??=webcrypto;
const defaultOutput=new URL('stress-zoo-10k.hash',import.meta.url);
const supported=['spline','square','circle','polyhedron','text','helix','gear','pulley','spline_patch','extrude','sweep','lathe','boolean','cube','cylinder','tube','sphere','capsule','nut','washer','bolt','render','instance','cloner','symmetry','target'];
const stableId=(space,index)=>createHash('sha256').update('frame-native-zoo-v1:'+space+':'+index).digest('hex').slice(0,32);
const matrix=(x=0,y=0,z=0)=>Float64Array.from([1,0,0,0,1,0,0,0,1,x,y,z]);

function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^(0xedb88320&-(crc&1));}return (crc^0xffffffff)>>>0;}
function texturePNG(index,size=128){
 const chunk=(name,data)=>{const type=Buffer.from(name),out=Buffer.alloc(12+data.length);out.writeUInt32BE(data.length);type.copy(out,4);Buffer.from(data).copy(out,8);out.writeUInt32BE(crc32(Buffer.concat([type,data])),8+data.length);return out;};
 const raw=Buffer.alloc((size*4+1)*size),header=Buffer.alloc(13);header.writeUInt32BE(size);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){const at=y*(size*4+1)+1+x*4,checker=((x>>3)+(y>>3)+index)%2;raw[at]=(index*31+x*2+checker*45)%256;raw[at+1]=(index*67+y*2)%256;raw[at+2]=(index*19+(x^y)*3)%256;raw[at+3]=255;}
 return new Uint8Array(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));
}

export function gridCage(columns=1,rows=1,size=40,variant=0){
 const d={version:2,approximation:{angle:15},next:10000,vertices:{},segments:{},sequences:[],freeHandles:{}};
 for(let y=0;y<=rows;y++)for(let x=0;x<=columns;x++)d.vertices['v'+(y*(columns+1)+x)]=[x*size,y*size,variant?Math.sin(x*.8)*Math.sin(y*.8)*variant:0];
 const edge=(a,b)=>{const id='s'+Object.keys(d.segments).length,q='q'+d.sequences.length;d.segments[id]={id,a:'v'+a,b:'v'+b,ha:[0,0,0],hb:[0,0,0],sequence:q};d.sequences.push({id:q,closed:false,first:'v'+a,segments:[id]});};
 for(let y=0;y<=rows;y++)for(let x=0;x<columns;x++)edge(y*(columns+1)+x,y*(columns+1)+x+1);
 for(let y=0;y<rows;y++)for(let x=0;x<=columns;x++)edge(y*(columns+1)+x,(y+1)*(columns+1)+x);
 return d;
}
export function ringCage(radius=12,offset=0){
 const d={version:2,approximation:{angle:15},next:100,vertices:{},segments:{},sequences:[{id:'q0',closed:true,first:'v0',segments:[]}],freeHandles:{}},h=radius*.5522847498307936;
 for(let i=0;i<4;i++){const a=i*Math.PI/2;d.vertices['v'+i]=[offset+radius*Math.cos(a),radius*Math.sin(a),0];}
 for(let i=0;i<4;i++){const a=i*Math.PI/2,b=(i+1)*Math.PI/2,id='s'+i;d.segments[id]={id,a:'v'+i,b:'v'+((i+1)%4),ha:[-Math.sin(a)*h,Math.cos(a)*h,0],hb:[Math.sin(b)*h,-Math.cos(b)*h,0],soft:true,sequence:'q0'};d.sequences[0].segments.push(id);}
 return d;
}
function pathCage(){return {version:2,approximation:{angle:15},next:10,vertices:{v0:[0,0,0],v1:[0,0,65]},segments:{s0:{id:'s0',a:'v0',b:'v1',ha:[15,0,20],hb:[-15,0,-20],soft:true,sequence:'q0'}},sequences:[{id:'q0',closed:false,first:'v0',segments:['s0']}],freeHandles:{}};}

export function buildZooScene({count=10000}={}){
 if(!Number.isInteger(count)||count<500||count>100000)throw Error('Zoo count must be an integer from 500 to 100000');
 const objects=[],handles={},materialCount=128,textureCount=64,tags=[],materials=Array.from({length:materialCount},(_,i)=>({uid:stableId('material',i),name:'Zoo material '+String(i).padStart(3,'0'),values:Float64Array.from([i*137.508%360,i?60:0,i?45+i%20:50,0,20+i%70,i%5===0?60:0,0,i%8===0?15:0,4,0,0,0,0,50,100,0,1]),maps:Array.from({length:8},(_,k)=>(k===0||k===4&&i%4===0||k===6&&i%8===0||k===7&&i%3===0)?stableId('texture',(i+k*7)%textureCount):null)}));
 const add=(type,name,parent,params={},position=[0,0,0],data)=>{const hash=stableId('object',objects.length),n={hash,type,name,parent:parent?.hash||parent||null,params,matrix:matrix(...position),...data?{data}:{},tags:[]};objects.push(n);return n;};
 const tag=(owner,index,mask)=>{const t={uid:stableId('tag',tags.length),material:materials[index%materialCount].uid,...mask?{mask}:{}};tags.push(t);owner.tags.push(t);return t;};
 const root=add('group','Native Zoo '+count,null);handles.root=root.hash;
 const sections=['Dense multi-cage Patches','Editable Patches','Surface generators','Boolean assemblies','Occurrences','Parametric solids','Curve primitives','Helpers'].map(name=>add('group',name,root));
 handles.group=sections[1].hash;
 let tile=0;const place=()=>{const i=tile++;return [(i%70-34.5)*130,0,(Math.floor(i/70)-25)*130];},amount=ratio=>Math.max(1,Math.floor(count*ratio));
 const sourcePool=[];
 for(let i=0;i<amount(.0016);i++){
  const patch=add('spline_patch','Dense Patch '+String(i).padStart(2,'0'),sections[0],{},place());tag(patch,i);
  const children=[];
  for(let j=0;j<64;j++){const n=add('spline','Dense cage '+i+'/'+j,patch,{'angle approximation':15},[(j%8)*12,Math.floor(j/8)*12,0],gridCage(2,2,5));children.push(n);tag(n,i*17+j);}
  // Known planar quads each produce two triangles in source order. These are
  // ordinary native face-mask tags, retained independently of editable cages.
  for(let m=0;m<32;m++){const mask=new Uint8Array(64);for(let c=m;c<256;c+=32){mask[(c*2)>>3]|=3<<((c*2)&7);}tag(patch,i*11+m,mask);}
  sourcePool.push(patch);if(!handles.densePatch){handles.densePatch=patch.hash;handles.denseChildSpline=children[0].hash;handles.densePatchChildren=children.map(n=>n.hash);}
 }
 for(let i=0;i<amount(.09);i++){
  const patch=add('spline_patch','Editable Patch '+i,sections[1],{},place()),n=add('spline','Patch cage '+i,patch,{'angle approximation':15},[0,0,0],gridCage(i%5===0?3:1,i%7===0?3:1,22,i%11===0?2:0));tag(patch,i);sourcePool.push(patch);if(!handles.patch){handles.patch=patch.hash;handles.childSpline=n.hash;}
 }
 for(let i=0;i<amount(.04);i++){
  const n=add('extrude','Extrude '+i,sections[2],{offset:18+i%30,'start cap':i%9!==0,'end cap':i%11!==0},place()),p=add(i%3?'circle':'square','Extrude profile '+i,n,i%3?{diameter:28,'angle approximation':20}:{'side 1':35,'side 2':28});tag(n,i*3);sourcePool.push(n);if(!handles.extrude){handles.extrude=n.hash;handles.extrudeProfile=p.hash;}
 }
 for(let i=0;i<amount(.015);i++){const n=add('lathe','Lathe '+i,sections[2],{angle:i%4===0?270:360},place());add('spline','Lathe profile '+i,n,{},[0,0,0],ringCage(6,22));tag(n,i*7);sourcePool.push(n);handles.lathe??=n.hash;}
 for(let i=0;i<amount(.01);i++){const n=add('sweep','Sweep '+i,sections[2],{movement:i%2?'parallel':'tangent'},place());add('spline','Sweep profile '+i,n,{},[0,0,0],ringCage(6));add('spline','Sweep path '+i,n,{},[0,0,0],pathCage());tag(n,i*13);sourcePool.push(n);handles.sweep??=n.hash;}
 for(let i=0;i<amount(.01);i++){
  const n=add('boolean','Boolean '+['subtract','intersect','union'][i%3]+' '+i,sections[3],{op:['subtract','intersect','union'][i%3]},place()),a=add('cube','Boolean base '+i,n,{'size x':45,'size y':35,'size z':40}),b=add('cube','Boolean cutter '+i,n,{'size x':32,'size y':40,'size z':30},[22,10,12]);tag(a,i*3);tag(b,i*3+1);sourcePool.push(n);if(!handles.boolean){handles.boolean=n.hash;handles.booleanOperand=b.hash;}
 }
 for(let i=0;i<amount(.01);i++){
  const n=add('cloner','Cloner '+i,sections[4],{type:i%2?'radial':'matrix',count:5,radius:38,'count x':2,'count y':1,'count z':2,'spacing x':40,'spacing y':40,'spacing z':40,seed:i+1},place()),a=add('cube','Cloner source '+i,n,{'size x':15,'size y':25,'size z':15});tag(a,i*5);sourcePool.push(n);if(!handles.cloner){handles.cloner=n.hash;handles.clonerSource=a.hash;}
 }
 for(let i=0;i<amount(.01);i++){const n=add('symmetry','Symmetry '+i,sections[4],{X:true,Y:i%3===0,Z:false},place());add('cube','Symmetry source '+i,n,{'size x':20,'size y':25,'size z':20},[7,4,0]);tag(n,i*9);sourcePool.push(n);handles.symmetry??=n.hash;}
 const solids=['cube','cylinder','tube','sphere','capsule','nut','washer','bolt'];
 for(let i=0;i<amount(.12);i++){
  const type=solids[i%solids.length],params=type==='cube'?{'size x':40,'size y':30,'size z':35}:type==='cylinder'?{diameter:35,height:45,'angle approximation':20}:type==='tube'?{'outer diameter':35,'inner diameter':22,height:45,'angle approximation':20}:type==='sphere'?{diameter:40,'angle approximation':20}:type==='capsule'?{diameter:30,'cylinder height':30,'total height':60,'angle approximation':20}:type==='bolt'?{type:'DIN 912',size:'M6',length:20,'angle approximation':30}:{size:'M6','angle approximation':30};
  const n=add(type,type+' '+i,sections[5],params,place());tag(n,i*11);sourcePool.push(n);handles.primitive??=n.hash;
 }
 const curves=['square','circle','polyhedron','text','helix','gear','pulley','spline'];
 for(let i=0;i<amount(.04);i++){
  const type=curves[i%curves.length],params=type==='square'?{'side 1':40,'side 2':30}:type==='circle'?{diameter:40,'angle approximation':20}:type==='polyhedron'?{faces:3+i%9,diameter:40}:type==='text'?{text:'Frame '+i,'angle approximation':20}:type==='helix'?{'start diameter':25,'end diameter':15,pitch:8,turns:3,'angle approximation':20}:type==='gear'?{teeth:16,module:1.5,'bore diameter':5,'angle approximation':20}:type==='pulley'?{profile:'GT2',teeth:20,'bore diameter':5,'angle approximation':20}:{};
  const n=add(type,type+' '+i,sections[6],params,place(),type==='spline'?ringCage(18):undefined);tag(n,i*17);if(type==='spline')handles.freeSpline??=n.hash;
 }
 const camera=add('render','Zoo camera',sections[7],{renderer:'Viewport','resolution x':1280,'resolution y':900,samples:8},[0,300,0]);camera.enabled=false;handles.camera=camera.hash;
 add('target','Camera target',camera,{object:handles.patch});const light=add('infinite','Zoo infinite light',sections[7],{intensity:100,'temperature K':6500,'angular size':30});handles.light=light.hash;
 for(const [type,params,scale]of [['car',{'color preset':'blue'},.018],['tree',{type:'oak'},.012],['human',{type:'man',pose:'stand'},.045]]){
  const n=add(type,'Stock '+type,sections[5],params,place());n.matrix[0]=n.matrix[4]=n.matrix[8]=scale;handles[type]=n.hash;
 }
 for(let depth=0,parent=sections[7];depth<8;depth++){parent=add('group','Nested transform group '+depth,parent,{},[5,3,2]);if(depth===7){const n=add('cube','Deep child cube',parent,{'size x':20,'size y':20,'size z':20});handles.deepChild=n.hash;handles.deepGroup=parent.hash;}}
 for(let i=0;objects.length<count;i++){
  const source=sourcePool[(i*37)%sourcePool.length],n=add('instance','Instance '+i+' of '+source.name,sections[4],{object:source.hash},place());if(i%5===0)tag(n,i*23);if(!handles.instance){handles.instance=n.hash;handles.instanceSource=source.hash;}
 }
 if(objects.length!==count)throw Error('Zoo composition exceeds requested count: '+objects.length);
 handles.material=materials[1].uid;handles.texturedMaterial=materials[8].uid;
 const counts=Object.fromEntries([...new Set(objects.map(n=>n.type))].map(type=>[type,objects.filter(n=>n.type===type).length]));
 const metadata={version:2,objects:objects.map(({hash,type,name,parent})=>({hash,type,name,parent})),count,counts,handles,materials:materialCount,textures:textureCount,textureSize:128,authoredPolygons:0,stockPolygonObjects:3,densePatches:counts.spline_patch?amount(.0016):0,densePatchChildren:64,excluded:['optional simulation plugins'],description:'Editable native workload. Display geometry is regenerated from authoring; three stock model references are the only polygon-based families. 64 independent embedded textures and 128 shared custom materials, plus stock materials.'};
 return {objects,materials,textures:Array.from({length:textureCount},(_,i)=>({uid:stableId('texture',i),bytes:texturePNG(i)})),tags,metadata};
}

export async function ensureZooScene({output,metadataOutput,count=10000,force=false}={}){
 output??=count===10000?defaultOutput:new URL('stress-zoo-'+count+'.hash',import.meta.url);
 const outputPath=output instanceof URL?fileURLToPath(output):resolve(output),metaPath=metadataOutput instanceof URL?fileURLToPath(metadataOutput):metadataOutput?resolve(metadataOutput):outputPath.replace(/\.hash$/i,'.json');
 if(!force)try{const metadata=JSON.parse(await readFile(metaPath,'utf8'));if(metadata.count===count&&metadata.version===2){await stat(outputPath);return {existing:true,output:outputPath,path:outputPath,metadataPath:metaPath,metadata};}}catch{}
 const html=await readFile(new URL('../../index.html',import.meta.url),'utf8');
 const hashSource=html.slice(html.indexOf('function createFrameHashCodec(){'),html.indexOf('const FrameHash=createFrameHashCodec();'));
 const defs=html.slice(html.indexOf('const approximation = '),html.indexOf('\nconst generatorTypes ='));
 const codec=html.slice(html.indexOf('function createFrameSplineCodec(types){'),html.indexOf('// The cubic kernel, workers and GPU pipelines are lazy'));
 const H=Function(hashSource+';return createFrameHashCodec()')(),S=Function('types','const boltLabels={DIN912:"DIN 912"};'+defs+';const defaults=fields=>Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,Array.isArray(v)?v[0]:v]));'+codec+';return createFrameSplineCodec(types)')(supported),{K,T}=H;
 const scene=buildZooScene({count}),records=[],put=(id,type,value)=>records.push({id,type,value}),field=(id,key,type,value)=>put(H.address(id,key),type,value);
 put(K.version,T.uint32,new Uint32Array([1]));put(K.all,T.ids,scene.objects.map(n=>n.hash));
 put(K.parameters,T.value,{version:1,frame:0,total:120,materials:[],documentation:'# Native Zoo\n\n'+count+' editable authored objects, '+scene.metadata.materials+' materials and '+scene.metadata.textures+' embedded textures. Generated display polygons are intentionally omitted from this file. Dense Patches each contain 64 editable child splines and 32 per-cell material assignments.\n'});
 for(const n of scene.objects){
  const isSurface=['cube','cylinder','tube','sphere','capsule','nut','washer','bolt','spline_patch','extrude','lathe','sweep','boolean'].includes(n.type),nativeType=n.type==='infinite'?2:isSurface?1:0;
  field(n.hash,'type',T.bytes,new Uint8Array([nativeType]));field(n.hash,'name',T.text,n.name);if(n.parent)field(n.hash,'parent',T.ids,[n.parent]);field(n.hash,'matrix',T.float64,n.matrix);field(n.hash,'flags',T.bytes,new Uint8Array([n.enabled===false?5:7]));
  if(supported.includes(n.type))field(n.hash,'spline',T.bytes,S.encode({type:n.type,params:n.params,...n.data?{data:n.data}:{}}));
  if(['car','tree','human'].includes(n.type))field(n.hash,'parameters',T.value,{version:1,tags:[],animation:[],library:{type:n.type,...n.type==='car'?{asset:'car-hatchback-2'}:{},params:n.params,slots:[]}});
  if(n.type==='infinite')field(n.hash,'light',T.float64,Float64Array.from([100,6500,30]));
  if(n.tags.length)field(n.hash,'tags',T.ids,n.tags.map(t=>t.uid));
 }
 put(K.materials,T.ids,scene.materials.map(m=>m.uid));put(K.assets,T.ids,scene.textures.map(t=>t.uid));
 for(const m of scene.materials){field(m.uid,'name',T.text,m.name);field(m.uid,'parameters',T.float64,m.values);field(m.uid,'maps',T.ids,m.maps.map(id=>id||K.zero));}
 for(const t of scene.textures)field(t.uid,'image',T.bytes,t.bytes);
 for(const t of scene.tags){field(t.uid,'material',T.ids,[t.material]);if(t.mask)field(t.uid,'faces',T.bytes,t.mask);}
 await mkdir(dirname(outputPath),{recursive:true});const blobs=[];for(let i=0;i<records.length;i+=128)blobs.push(...await Promise.all(records.slice(i,i+128).map(async r=>(await H.pack(r)).blob)));
 const bytes=new Uint8Array(await new Blob(blobs).arrayBuffer());await writeFile(outputPath,bytes);scene.metadata.bytes=bytes.length;scene.metadata.sha256=createHash('sha256').update(bytes).digest('hex');await mkdir(dirname(metaPath),{recursive:true});await writeFile(metaPath,JSON.stringify(scene.metadata,null,2)+'\n');
 return {existing:false,output:outputPath,path:outputPath,metadataPath:metaPath,metadata:scene.metadata};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const value=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.split('=').slice(1).join('='),count=Number(value('count')||10000),output=value('output')||new URL('stress-zoo-'+(count===10000?'10k':count)+'.hash',import.meta.url);
 const r=await ensureZooScene({count,output,force:process.argv.includes('--force')});console.log(JSON.stringify({path:r.path,metadataPath:r.metadataPath,count:r.metadata.count,counts:r.metadata.counts,bytes:r.metadata.bytes,sha256:r.metadata.sha256}));
}
