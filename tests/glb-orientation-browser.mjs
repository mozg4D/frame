import assert from 'node:assert/strict';
import {launch,ready} from '../tools/browser.mjs';

// Independently authored glTF coordinates in metres. The sloping sheet has different extents on every axis.
const positions=[-.03,-.02,.011, .05,-.02,.021, .05,.04,.026, -.03,.04,.016];
const uv=[0,1,1,1,1,0,0,0],indices=[0,1,2,0,2,3];
function fixture(image){
 const views=[],parts=[];let length=0;
 function append(bytes){
  const padding=(4-length%4)%4;parts.push(Buffer.alloc(padding));length+=padding;
  const id=views.length;views.push({buffer:0,byteOffset:length,byteLength:bytes.length});
  parts.push(bytes);length+=bytes.length;return id;
 }
 append(Buffer.from(Float32Array.from(positions).buffer));append(Buffer.from(Float32Array.from(uv).buffer));
 append(Buffer.from(Uint16Array.from(indices).buffer));const picture=append(image);
 const doc={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],
  nodes:[{name:'Origin',translation:[.017,-.023,.031],children:[1,2]},{name:'Sheet',mesh:0},{name:'Reflected',mesh:0,translation:[.16,0,0],scale:[-1,1,1]}],
  meshes:[{primitives:[{attributes:{POSITION:0,TEXCOORD_0:1},indices:2,material:0}]}],
  materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0},metallicFactor:0,roughnessFactor:1}}],
  textures:[{source:0}],images:[{mimeType:'image/png',bufferView:picture}],
  buffers:[{byteLength:length}],bufferViews:views,
  accessors:[{bufferView:0,componentType:5126,count:4,type:'VEC3',min:[-.03,-.02,.011],max:[.05,.04,.026]},{bufferView:1,componentType:5126,count:4,type:'VEC2'},{bufferView:2,componentType:5123,count:6,type:'SCALAR'}]};
 const json=Buffer.from(JSON.stringify(doc)),js=Buffer.alloc(Math.ceil(json.length/4)*4,32);json.copy(js);
 const bin=Buffer.concat([...parts,Buffer.alloc((4-length%4)%4)]),header=Buffer.alloc(20),chunk=Buffer.alloc(8);
 [0x46546c67,2,28+js.length+bin.length,js.length,0x4e4f534a].forEach((value,i)=>header.writeUInt32LE(value,4*i));
 chunk.writeUInt32LE(bin.length);chunk.writeUInt32LE(0x004e4942,4);return Buffer.concat([header,js,chunk,bin]);
}
const session=await launch({headless:true}),{page}=session;
const call=(name,args={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[name,args]);
try{
 await ready(page);
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=16;const g=c.getContext('2d');
  ['#ff0000','#00ff00','#0000ff','#ffff00'].forEach((color,i)=>{g.fillStyle=color;g.fillRect((i%2)*8,(i>>1)*8,8,8);});return c.toDataURL().split(',')[1];});
 const start=performance.now();const scene=await call('scene.open',{name:'four-corners.glb',base64:fixture(Buffer.from(png,'base64')).toString('base64')});
 const sheet=scene.objects.find(n=>n.name==='Sheet'),reflected=scene.objects.find(n=>n.name==='Reflected');
 const geo=await call('mesh.inspect',{id:sheet.hash});
 geo.vertices.forEach(({position},i)=>position.forEach((v,k)=>assert.ok(Math.abs(v-positions[i*3+k]*1000)<.0001)));
 assert.deepEqual(geo.faces.flatMap(f=>f.vertices),indices);
 const appearance=await call('diagnostics.appearance',{id:sheet.hash,corners:[0,1,2,3,4,5]});
 assert.deepEqual(appearance.uv.samples.flatMap(row=>row.value),indices.flatMap(i=>uv.slice(2*i,2*i+2)));
 await call('scene.select',{ids:[sheet.hash,reflected.hash]});await call('view.set',{index:2,single:true,mode:'object',shading:'solid',focusSelection:true});
 await call('scene.select',{ids:[]});await call('diagnostics.frame',{frames:2});
 // Project independently computed world coordinates, without asking the importer to transform the samples.
 const probes=[];
 for(const mirror of [false,true])for(const [u,v] of [[.25,.25],[.75,.25],[.25,.75],[.75,.75]]){
  const x=-30+80*u;const point=[17+(mirror?160-x:x),-23+40-60*v,31+16+10*u-5*v];
  probes.push((await call('view.project',{point})).screen);
 }
 const {colors}=await call('diagnostics.pixels',{points:probes});
 const channels=[[1,0,0],[0,1,0],[0,0,1],[1,1,0]];
 colors.forEach((color,i)=>{const expected=channels[i%4],on=color.slice(0,3).filter((_,k)=>expected[k]),off=color.slice(0,3).filter((_,k)=>!expected[k]);
  assert.ok(Math.min(...on)>Math.max(...off)+30,'Texture corner '+i+' '+JSON.stringify(colors));});
 assert.ok(performance.now()-start<10000);console.log('PASS GLB XYZ, winding, metre scale, parent transform, reflection, UV corners and eight rendered color samples',JSON.stringify(colors));
}finally{await session.close();}
