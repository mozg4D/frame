import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import {launch,ready} from '../tools/browser.mjs';
import {closedRevolve} from './engineering.mjs';
import {engineeringFixtures} from './engineering-fixtures.mjs';

export async function booleanGpuGridChecks(page,{dense=false,rounds=1}={}){
  const checks=[],timings=[];
  const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});assert.ok(pass,name+' '+JSON.stringify(detail));};
  const call=(name,args)=>page.evaluate(([n,a])=>frameAI.call(n,a),[name,args]);
  const adapter=await page.evaluate(()=>{const a=frameEngine.renderer.device.adapterInfo;return {vendor:a.vendor,architecture:a.architecture,hardware:!a.isFallbackAdapter,dpr:devicePixelRatio};});
  check('Hardware WebGPU at DPR 1',adapter.hardware&&adapter.dpr===1,adapter);
  const rings=dense?128:48,steps=dense?1536:192;
  const profile=Array.from({length:rings+1},(_,i)=>[40*Math.sin(Math.PI*i/rings),40*Math.cos(Math.PI*i/rings)]);
  const mesh=closedRevolve(profile,steps);
  let a=await call('mesh.create',mesh),b=await call('mesh.create',mesh);
  await call('transform.apply',{ids:[b.hash],position:[30,0,0]});
  const paint=await call('material.create',{name:'Cutter'});
  await call('material.assign',{id:b.hash,material:paint.uid});
  await page.evaluate(()=>{
    window.__gridTest={worker:FrameGeometry.worker,enabled:false};
    FrameGeometry.worker=async function(op,args,transfers,session,progress,filter){
      if(op!=='boolean'||args.cmd!=='run')return __gridTest.worker(...arguments);
      __gridTest.filter=filter;
      async function failAllocation(boxes){
        const device=frameEngine.renderer.device,create=device.createBuffer;
        device.createBuffer=function(desc){
          if(desc.label==='Boolean occupancy grid'){__gridTest.failed=true;throw Error('Test grid allocation failure');}
          return create.call(this,desc);
        };
        try{return await filter(boxes);}finally{device.createBuffer=create;}
      }
      const dispatch=__gridTest.enabled==='fallback'?failAllocation:__gridTest.enabled?filter:null;
      const result=await __gridTest.worker(op,args,transfers,session,progress,dispatch);
      __gridTest.result=result;return result;
    };
  });
  try{
    const reference=new Map();let owner;
    async function run(op,enabled,layout='crossing'){
      await page.evaluate(enabled=>{__gridTest.enabled=enabled;__gridTest.result=null;},enabled);
      const started=performance.now();
      owner=owner?await call('scene.update',{id:owner.hash,params:{op}}):await call('scene.create',{type:'boolean',inputs:[a.hash,b.hash],params:{op}});
      const ms=performance.now()-started,report=owner.evaluation?.report;
      check(layout+' '+op+' '+(enabled?'GPU':'CPU')+' publishes within budget',!owner.buildError&&report?.trusted&&report.watertight&&ms<45000,{ms,error:owner.buildError,report:report?.postTransfer});
      check('Selected '+(enabled===true?'hybrid':'CPU')+' backend',report.backend===(enabled===true?'webgpu-grid-cpu':'frame-js-r6'),report.backend);
      if(layout==='coplanar')check('Coplanar patches enter the exact resolver',report.coplanarPairs>0,report.coplanarPairs);
      if(enabled===true&&layout==='contained')check('Containment survives an empty candidate set',report.gpuFilter.candidateTriangles===0,report.gpuFilter);
      const hashes=await page.evaluate(async()=>{
        const result=__gridTest.result;
        return Promise.all(['positions','indices','faceMaterials','seamPositions','seamIndices','displayEdges'].map(async k=>{
          const bytes=await crypto.subtle.digest('SHA-256',result[k]);
          return Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');
        }));
      });
      const key=layout+' '+op;
      if(reference.has(key))assert.deepEqual(hashes,reference.get(key),key+' geometry, materials and seam bytes');
      else reference.set(key,hashes);
      timings.push({layout,op,backend:report.backend,ms,discoveryMs:report.discoveryMs,...report.gpuFilter});
      if(enabled===true&&layout==='crossing')check('GPU prunes crossing operands and returns only face bits',report.gpuFilter.candidateTriangles<report.gpuFilter.inputTriangles/2&&report.gpuFilter.readbackBytes===2*Math.ceil(mesh.indices.length/3/32)*4,report.gpuFilter);
    }
    for(let i=0;i<rounds;i++)for(const enabled of (i%2?[true,false]:[false,true]))for(const op of ['union','subtract','intersect'])await run(op,enabled);
    if(!dense){
      await run('subtract','fallback');
      check('GPU allocation failure completes through CPU',await page.evaluate(()=>__gridTest.failed));
      await call('transform.apply',{ids:[b.hash],position:[0,0,0],size:[32,32,32]});
      // Change the operation after the placement update to require a fresh evaluation.
      await run('union',false,'contained');
      for(const enabled of [false,true])for(const op of ['subtract','intersect'])await run(op,enabled,'contained');
      await call('scene.delete',{ids:[owner.hash]});owner=null;
      const block=engineeringFixtures()[0];
      function body(sphereX,blockX,blockY){
        const vertices=mesh.vertices.map((v,i)=>i%3===0?v+sphereX:v);
        const offset=vertices.length/3;
        return {vertices:vertices.concat(block.vertices.map((v,i)=>v+[blockX,blockY,0][i%3])),indices:mesh.indices.concat(block.indices.map(i=>i+offset))};
      }
      a=await call('mesh.create',body(-200,0,0));b=await call('mesh.create',body(200,15,10));
      for(const enabled of [false,true])for(const op of ['union','subtract','intersect'])await run(op,enabled,'coplanar');
    }
    const grid=await page.evaluate(async()=>{
      // Check fine-word boundaries, coarse cells, large/small operands in both
      // orders, zero-width boxes, and a non-multiple-of-32 final mask word.
      const points=Array.from({length:128},(_,i)=>[[i,(i*3)%128,i],[i,(i*3)%128,i]]);
      const spans=[[[31,0,0],[32,127,127]],[[63,0,0],[64,127,1]],[[95,0,0],[96,127,127]],...points.slice(28,68)];
      const pack=v=>v[0]+(v[1]<<7)+(v[2]<<14),boxes=rows=>Uint32Array.from(rows.flatMap(row=>row.map(pack)));
      const masks=await __gridTest.filter([boxes(points),boxes(spans)]);
      let overlaps=0,misses=0;
      for(const [a,p] of points.entries())for(const [b,s] of spans.entries())if(p[0].every((v,k)=>v<=s[1][k]&&s[0][k]<=p[1][k])){
        overlaps++;if(!(masks[0][a>>5]>>>(a&31)&1)||!(masks[1][b>>5]>>>(b&31)&1))misses++;
      }
      const pointCandidates=points.filter((_,i)=>masks[0][i>>5]>>>(i&31)&1).length;
      return {overlaps,misses,pointCandidates};
    });
    check('Every overlapping grid box survives in both operands',grid.overlaps>40&&!grid.misses&&grid.pointCandidates<128,grid);
    return {pass:true,checks,timings,adapter};
  }finally{await page.evaluate(()=>{FrameGeometry.worker=__gridTest.worker;delete window.__gridTest;});}
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const app=await launch({headless:true}),dense=process.argv.includes('--dense');
  try{
    await ready(app.page);
    const report=await booleanGpuGridChecks(app.page,{dense,rounds:Number(process.argv.find(a=>a.startsWith('--rounds='))?.split('=')[1]||1)});
    await mkdir(new URL('results/',import.meta.url),{recursive:true});
    await writeFile(new URL('results/boolean-gpu-grid'+(dense?'-dense':'')+'.json',import.meta.url),JSON.stringify(report,null,2));
    console.log(report.adapter);console.table(report.timings);
  }finally{await app.close();}
}
