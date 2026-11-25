import {writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../../tools/browser.mjs';

const outPath=resolve(dirname(fileURLToPath(import.meta.url)),'forest-100m.hash');

const session=await launch({headless:true});
try{
  const {page}=session;
  await ready(page);
  const call=(name,args={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[name,args]);

  await call('scene.new');
  const tree=await call('scene.create',{type:'tree',name:'OakSource',params:{type:'oak','leaf density':100}});
  await page.waitForFunction(()=>{
    const o=frameEngine?.scene?.meshes?.filter(m=>!m.replicaMatrix)||[];
    return o.length>0&&o.reduce((s,m)=>s+(m.triangleCount||0),0)>100;
  },{timeout:45000});

  const singleTris=await page.evaluate(()=>frameEngine.scene.meshes.filter(m=>!m.replicaMatrix).reduce((s,m)=>s+(m.triangleCount||0),0));
  const target=100_000_000;
  const side=Math.max(4,Math.min(260,Math.round(Math.sqrt(target/Math.max(1,singleTris)))));
  const sideZ=Math.max(4,Math.min(260,Math.round(target/(Math.max(1,singleTris)*side))));
  const spacing=6500;
  const span=Math.max(side,sideZ)*spacing;

  const ground=await call('scene.create',{type:'cube',name:'Ground',params:{'size x':span+80000,'size y':400,'size z':span+80000}});
  await call('transform.set',{ids:[ground.hash],channel:'position',axis:0,value:-(span+80000)*0.5});
  await call('transform.set',{ids:[ground.hash],channel:'position',axis:1,value:-400});
  await call('transform.set',{ids:[ground.hash],channel:'position',axis:2,value:-(span+80000)*0.5});
  const groundMat=await call('material.create',{name:'ForestFloor',params:{h:95,s:28,l:28,rough:92}});
  await call('material.assign',{id:ground.hash,material:groundMat.uid});

  const cloner=await call('scene.create',{type:'cloner',name:'ForestCloner',params:{
    type:'matrix','count x':side,'count y':1,'count z':sideZ,
    'spacing x':spacing,'spacing y':0,'spacing z':spacing,
    'random position x':spacing*0.35,'random position y':0,'random position z':spacing*0.35,
    'random angle y':180,'uniform scale':true,'random scale x':22,seed:7
  }});
  await call('scene.update',{id:tree.hash,parent:cloner.hash});
  await call('transform.set',{ids:[cloner.hash],channel:'position',axis:0,value:-((side-1)*spacing)*0.5});
  await call('transform.set',{ids:[cloner.hash],channel:'position',axis:2,value:-((sideZ-1)*spacing)*0.5});

  const sun=await call('scene.create',{type:'infinite',name:'Sun',params:{intensity:320,'temperature K':5600,'angular size':2.0}});
  await call('transform.set',{ids:[sun.hash],channel:'rotation',axis:2,value:-38});
  await call('transform.set',{ids:[sun.hash],channel:'rotation',axis:1,value:32});

  const cam=await call('scene.create',{type:'render',name:'Camera',params:{
    renderer:'Path tracer',realtime:'on',samples:16,environment:'default',
    'foliage mode':'hybrid','gi trace scale':'0.5','gi rays':1,'gi nodes':'512','gi bounces':3,'di candidates':4,'cubemap size':'64',reflections:'hybrid'
  }});
  await call('transform.set',{ids:[cam.hash],channel:'position',axis:0,value:0});
  await call('transform.set',{ids:[cam.hash],channel:'position',axis:1,value:18000});
  await call('transform.set',{ids:[cam.hash],channel:'position',axis:2,value:span*0.42});
  await call('transform.set',{ids:[cam.hash],channel:'rotation',axis:0,value:-18});
  await call('view.set',{index:0,single:true,focus:cloner.hash});

  const exported=await call('scene.export',{includeData:true});
  const bytes=Buffer.from(exported.base64,'base64');
  await writeFile(outPath,bytes);

  const info=await page.evaluate(()=>({
    totalApproxTriangles:frameEngine.scene.meshes.filter(m=>m.frameVisible!==false).reduce((s,m)=>s+(m.triangleCount||0),0),
    singleTreeTris:0,
  }));
  info.singleTreeTris=singleTris;
  info.clones=side*sideZ;
  info.estimatedTotalTriangles=singleTris*side*sideZ+12;
  info.fileBytes=bytes.byteLength;
  info.path=outPath;
  console.log(JSON.stringify(info,null,2));
}finally{
  await session.close();
}
