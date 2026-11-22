import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {H} from './hash-codec-fixture.mjs';
import {launch,ready} from '../tools/browser.mjs';

const checks=[],check=(name,pass,detail)=>{assert.ok(pass,name+(detail!==undefined?': '+JSON.stringify(detail):''));checks.push({name,pass:true});console.log('PASS',name);};

// --- 1. CPU codec: no artificial 512 MiB / 100k / 1M caps, CHUNKED round-trip, fast predictor ---
{
  const id=n=>n.toString(16).padStart(32,'0');

  // 1a. Header indexing & chunkedLayout accept > 2.5 GiB records (e.g. giant point cloud / mesh) without allocating RAM.
  const hugeRawBytes=2600*1024*1024; // ~2.54 GiB (> 512 MiB and > 2 GiB!)
  const blockRaw=H.CHUNK_BYTES,blockCount=Math.ceil(hugeRawBytes/blockRaw);
  const blockStored=100000; // ~173 MB compressed for 2.54 GiB raw (> 16 MiB paged reader threshold)
  const payloadLen=16+blockCount*8+blockCount*blockStored;
  const headerBuf=new Uint8Array(26+16+blockCount*8),hv=new DataView(headerBuf.buffer);
  hv.setUint16(0,H.T.float32|H.CHUNKED,true);
  headerBuf.set(Uint8Array.from(id(1).match(/../g),x=>parseInt(x,16)),2);
  hv.setBigUint64(18,BigInt(payloadLen),true);
  hv.setBigUint64(26,BigInt(hugeRawBytes),true);
  hv.setUint32(34,blockRaw,true);
  hv.setUint32(38,blockCount,true);
  for(let i=0;i<blockCount;i++){hv.setUint32(42+i*8,blockStored,true);hv.setUint32(46+i*8,H.ZIP|H.PREDICT,true);}
  const virtualFile={
    size:26+payloadLen,
    slice(a,b){
      assert.ok(b<=1024*1024,'Virtual 2.5 GiB index/layout must stay within first 1 MiB page');
      const out=new Uint8Array(b-a);
      if(a<headerBuf.length)out.set(headerBuf.subarray(a,Math.min(b,headerBuf.length)),0);
      return new Blob([out]);
    }
  };
  const vReader=H.reader(virtualFile),vMap=await vReader.index();
  const vRec=vMap.get(id(1));
  assert.equal(vRec.length,payloadLen);
  assert.equal(vRec.encoding,H.T.float32|H.CHUNKED);
  const vLayout=await H.chunkedLayout(virtualFile,vRec);
  assert.equal(vLayout.rawByteLength,hugeRawBytes);
  assert.equal(vLayout.blockCount,blockCount);
  assert.equal(vLayout.blocks[0].rawOffset,0);
  assert.equal(vLayout.blocks.at(-1).rawOffset+vLayout.blocks.at(-1).rawLength,hugeRawBytes);
  check('Index and chunkedLayout accept >2.5 GiB records without artificial 512 MiB cap',true);

  // 1b. prepare/restore exact bit identity across edge lengths + fused finite/bounds checks
  for(const n of [0,1,2,3,4,5,17,3000]){
    const f32=new Float32Array(n);
    for(let i=0;i<n;i++)f32[i]=(i%5===0?-0:(i-n/2)*0.125);
    const fBytes=new Uint8Array(f32.buffer);
    const pF=H.prepare(fBytes,H.T.float32),rF=H.restore(pF,H.T.float32,{checkFinite:true});
    assert.deepEqual(rF,fBytes);
    const u32=new Uint32Array(n);
    for(let i=0;i<n;i++)u32[i]=(i*7)%100000;
    const uBytes=new Uint8Array(u32.buffer);
    const opts={trackMax:true,maxExclusive:100000};
    const pU=H.prepare(uBytes,H.T.uint32),rU=H.restore(pU,H.T.uint32,opts);
    assert.deepEqual(rU,uBytes);
    assert.equal(opts.max,n?Math.max(...u32):-1);
  }
  const badF=new Float32Array([1,2,NaN,4,5,6]);
  assert.throws(()=>H.restore(H.prepare(new Uint8Array(badF.buffer),H.T.float32),H.T.float32,{checkFinite:true}),/Invalid HASH geometry/);
  const badInf=new Float32Array([1,2,-Infinity,4,5,6]);
  assert.throws(()=>H.restore(H.prepare(new Uint8Array(badInf.buffer),H.T.float32),H.T.float32,{checkFinite:true}),/Invalid HASH geometry/);
  const badI=new Uint32Array([0,1,5]);
  assert.throws(()=>H.restore(H.prepare(new Uint8Array(badI.buffer),H.T.uint32),H.T.uint32,{maxExclusive:5}),/Invalid HASH geometry/);
  check('Fast prepare/restore preserve exact bits and enforce fused finite/bounds validation',true);

  // 1c. CHUNKED pack + read round-trip (> CHUNK_BYTES) for float32, uint32, and incompressible raw fallback
  const bigCount=Math.floor(H.CHUNK_BYTES/4)+50001; // > 1 chunk
  const bigF32=new Float32Array(bigCount);
  for(let i=0;i<bigCount;i++)bigF32[i]=Math.sin(i*0.001)*100;
  const bigU32=new Uint32Array(bigCount);
  for(let i=0;i<bigCount;i++)bigU32[i]=Math.floor(i/3)+i%3;
  const packedF=await H.pack({id:id(10),type:H.T.float32,value:bigF32});
  const packedU=await H.pack({id:id(11),type:H.T.uint32,value:bigU32});
  assert.equal(packedF.type,H.T.float32|H.CHUNKED,'Large compressible float32 packs as CHUNKED');
  assert.equal(packedU.type,H.T.uint32|H.CHUNKED,'Large compressible uint32 packs as CHUNKED');
  const noise=new Uint8Array(randomBytes(H.CHUNK_BYTES+12345));
  const packedN=await H.pack({id:id(12),type:H.T.bytes,value:noise});
  assert.equal(packedN.type,H.T.bytes,'Incompressible large bytes fall back to plain uncompressed streamable record');
  // Precompressed PNG signature skips gzip
  const fakePng=new Uint8Array(8192);fakePng.set([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
  const packedPng=await H.pack({id:id(13),type:H.T.bytes,value:fakePng});
  assert.equal(packedPng.type,H.T.bytes,'PNG bytes skip redundant gzip');
  const combined=new Blob([packedF.blob,packedU.blob,packedN.blob,packedPng.blob]);
  const cr=H.reader(combined),cm=await cr.index();
  assert.deepEqual(await cr.read(cm.get(id(10))),bigF32);
  assert.deepEqual(await cr.read(cm.get(id(11))),bigU32);
  assert.deepEqual(await cr.read(cm.get(id(12))),noise);
  assert.deepEqual(await cr.read(cm.get(id(13))),fakePng);
  check('CHUNKED round-trip, uncompressed fallback, and precompressed image skip preserve exact bytes',true);

  // 1d. Corrupt chunked metadata rejects cleanly
  const badChunkBytes=new Uint8Array(await packedF.blob.arrayBuffer());
  new DataView(badChunkBytes.buffer).setUint32(26+12,999,true); // corrupt blockCount
  const badBlob=new Blob([badChunkBytes]),bm=await H.index(badBlob);
  await assert.rejects(()=>H.read(badBlob,bm.get(id(10))),/Invalid HASH chunk table/);
  check('Corrupt CHUNKED table rejects cleanly',true);

  // 1e. Verify no artificial 100000/10000 caps remain in decodeAppearancePlan
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const appStart=html.indexOf('    async function decodeAppearancePlan('),appEnd=html.indexOf('    function validateOwnerPolygonMasks(',appStart);
  assert.ok(appStart>0&&appEnd>appStart);
  const appSrc=html.slice(appStart,appEnd);
  assert.ok(!appSrc.includes('<=100000')&&!appSrc.includes('>10000'),'No artificial 100k/10k appearance caps');
  check('Artificial appearance caps removed from decodeAppearancePlan',true);
}

// --- 2. Native WebGPU hardware tests: Buffer & PagedTexture streaming, single-pass decode, layout order, atomic rollback ---
for(const pagedMode of [false,true]){
  const s=await launch({headless:true}),page=s.page,errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  try{
    if(pagedMode)await page.goto(s.url+'/index.html?force-paged=1');
    await ready(page);
    const result=await page.evaluate(async(pagedMode)=>{
      const gpu=frameEngine.renderer,d=gpu.device;
      d.pushErrorScope('out-of-memory');d.pushErrorScope('validation');
      // Build a multi-chunk mesh (> 1.5 MiB positions & > 1.5 MiB indices: 400x400 grid = 160,801 verts = 1.93 MB pos, 320,000 tris = 3.84 MB idx, 7.68 MB UVs)
      const G=400,V=(G+1)*(G+1),T=G*G*2;
      const verts=new Float32Array(V*3),idxs=new Uint32Array(T*3),uvs=new Float32Array(T*6);
      for(let y=0;y<=G;y++)for(let x=0;x<=G;x++){const i=(y*(G+1)+x)*3;verts[i]=x*0.5;verts[i+1]=Math.sin(x*0.05)*Math.cos(y*0.05)*10;verts[i+2]=y*0.5;}
      let c=0;
      for(let y=0;y<G;y++)for(let x=0;x<G;x++){
        const a=y*(G+1)+x,b=a+1,cc=a+G+1,dd=cc+1;
        idxs[c]=a;idxs[c+1]=cc;idxs[c+2]=b;
        idxs[c+3]=b;idxs[c+4]=cc;idxs[c+5]=dd;
        c+=6;
      }
      for(let i=0;i<T*3;i++){const v=idxs[i],x=v%(G+1),y=Math.floor(v/(G+1));uvs[i*2]=x/G;uvs[i*2+1]=y/G;}
      // Create via mesh.create (or direct native HASH build with UV + PNG + polygon mask!)
      await frameAI.call('scene.new');
      const mat=await frameAI.call('material.create',{name:'StreamMat'});
      // Create a valid 64x64 PRNG-noise PNG (> 4 KiB) so it enters the bulk image section
      const cv=document.createElement('canvas');cv.width=cv.height=64;const ctx=cv.getContext('2d'),img=ctx.createImageData(64,64);
      let seed=1234567;for(let i=0;i<img.data.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;img.data[i]=(i&3)===3?255:(seed>>>24);}ctx.putImageData(img,0,0);
      const pngBytes=new Uint8Array(await (await new Promise(r=>cv.toBlob(r,'image/png'))).arrayBuffer());
      const maskBytes=new Uint8Array(Math.ceil(T/8));maskBytes[0]=0b10101010;maskBytes[maskBytes.length-1]=0b00000001;
      const objId=FrameHash.newId(),matId=mat.uid,assetId=FrameHash.newId(),uvTag=FrameHash.newId(),matTag=FrameHash.newId();
      const rows=[
        {id:FrameHash.K.version,type:FrameHash.T.uint32,value:new Uint32Array([1])},
        {id:FrameHash.K.all,type:FrameHash.T.ids,value:[objId]},
        {id:FrameHash.address(objId,'type'),type:FrameHash.T.bytes,value:new Uint8Array([1])},
        {id:FrameHash.address(objId,'name'),type:FrameHash.T.text,value:'StreamGrid'},
        {id:FrameHash.address(objId,'tags'),type:FrameHash.T.ids,value:[uvTag,matTag]},
        {id:FrameHash.address(objId,'positions'),type:FrameHash.T.float32,value:verts},
        {id:FrameHash.address(objId,'indices'),type:FrameHash.T.uint32,value:idxs},
        {id:FrameHash.K.materials,type:FrameHash.T.ids,value:[matId]},
        {id:FrameHash.address(matId,'name'),type:FrameHash.T.text,value:'StreamMat'},
        {id:FrameHash.address(matId,'parameters'),type:FrameHash.T.float64,value:new Float64Array([200,50,50,0,50,0,0,0])},
        {id:FrameHash.address(matId,'maps'),type:FrameHash.T.ids,value:[assetId,FrameHash.K.zero]},
        {id:FrameHash.K.assets,type:FrameHash.T.ids,value:[assetId]},
        {id:FrameHash.address(assetId,'image'),type:FrameHash.T.bytes,value:pngBytes},
        {id:FrameHash.address(uvTag,'uv'),type:FrameHash.T.float32,value:uvs},
        {id:FrameHash.address(matTag,'material'),type:FrameHash.T.ids,value:[matId]},
        {id:FrameHash.address(matTag,'faces'),type:FrameHash.T.bytes,value:maskBytes},
      ];
      const packedRows=await Promise.all(rows.map(r=>FrameHash.pack(r)));
      const initialBlob=new Blob(packedRows.map(r=>r.blob));

      // Load initial CHUNKED blob, verify single-pass read (no double slice reads!)
      const sliceHits=new Map();
      const observedFile={
        name:'stream-grid.hash',size:initialBlob.size,
        arrayBuffer:()=>initialBlob.arrayBuffer(),
        slice(a,b){
          const key=a+':'+b;
          sliceHits.set(key,(sliceHits.get(key)||0)+1);
          return initialBlob.slice(a,b);
        }
      };
      await frameEngine.loadFile(observedFile);
      const mesh1=frameEngine.scene.meshes[0];
      const pagedUsed=!!mesh1.paged;
      // Check how many times any >100 KiB chunk slice was read (must be 1, NEVER 2!)
      let maxChunkReads=0;
      for(const [k,count]of sliceHits){const [a,b]=k.split(':').map(Number);if(b-a>=100*1024)maxChunkReads=Math.max(maxChunkReads,count);}

      // Save via native saveHash() and verify metadata-first -> images -> GPU geometry order + CHUNKED!
      const savedBlob=await frameEngine.saveHash();
      const sr=FrameHash.reader(savedBlob),sm=await sr.index();
      const order=[...sm.values()];
      const posIdx=order.findIndex(r=>r.id===FrameHash.address(objId,'positions'));
      const idxIdx=order.findIndex(r=>r.id===FrameHash.address(objId,'indices'));
      const uvIdx=order.findIndex(r=>r.id===FrameHash.address(uvTag,'uv'));
      const imgIdx=order.findIndex(r=>r.id===FrameHash.address(assetId,'image'));
      const metaMax=order.reduce((m,r,i)=>![posIdx,idxIdx,uvIdx,imgIdx].includes(i)?Math.max(m,i):m,-1);
      const layoutOK=metaMax<imgIdx&&imgIdx<posIdx&&posIdx<idxIdx&&idxIdx<uvIdx;
      const chunkedFlags={
        pos:!!(order[posIdx].encoding&FrameHash.CHUNKED),
        idx:!!(order[idxIdx].encoding&FrameHash.CHUNKED),
        uv:!!(order[uvIdx].encoding&FrameHash.CHUNKED),
        pngUnzipped:!(order[imgIdx].encoding&FrameHash.ZIP)
      };

      // Reload saved blob and verify exact bit-for-bit geometry round-trip!
      const savedFile=new File([savedBlob],'resaved.hash');
      await frameEngine.loadFile(savedFile);
      const mesh2=frameEngine.scene.meshes[0];
      const readBack=await frameEngine.readGeometry(mesh2);
      let posExact=readBack.vertices.length===verts.length,idxExact=readBack.indices.length===idxs.length;
      if(posExact)for(let i=0;i<verts.length;i++)if(readBack.vertices[i]!==verts[i]){posExact=false;break;}
      if(idxExact)for(let i=0;i<idxs.length;i++)if(readBack.indices[i]!==idxs[i]){idxExact=false;break;}

      // Test mixed encoding (CHUNKED positions + legacy ZIP|PREDICT indices)
      const smallTriCount=1000,smallIdxs=idxs.slice(0,smallTriCount*3);
      const mixedRows=[
        {id:FrameHash.K.version,type:FrameHash.T.uint32,value:new Uint32Array([1])},
        {id:FrameHash.K.all,type:FrameHash.T.ids,value:[objId]},
        {id:FrameHash.address(objId,'type'),type:FrameHash.T.bytes,value:new Uint8Array([1])},
        {id:FrameHash.address(objId,'positions'),type:FrameHash.T.float32,value:verts},
        {id:FrameHash.address(objId,'indices'),type:FrameHash.T.uint32,value:smallIdxs},
      ];
      const mixedPacked=await Promise.all(mixedRows.map(r=>FrameHash.pack(r)));
      const mixedFile=new File(mixedPacked.map(r=>r.blob),'mixed.hash');
      await frameEngine.loadFile(mixedFile);
      const mixedTris=frameEngine.scene.meshes[0].triangleCount;

      // Restore full scene then test atomic rollback on corrupt payloads (with zero GPU buffer leaks!)
      await frameEngine.loadFile(savedFile);
      const baselineTris=frameEngine.scene.triangleCount,baselineMeshes=frameEngine.scene.meshes.length;
      const baselineBounds=JSON.stringify([frameEngine.scene.boundsMin,frameEngine.scene.boundsMax]);
      // Helper to build a bad file and assert rejection + scene untouched
      const makeCorrupt=async(overrideRows)=>{
        const map=new Map(rows.map(r=>[r.id,r]));
        for(const r of overrideRows)map.set(r.id,r);
        return new File((await Promise.all([...map.values()].map(r=>FrameHash.pack(r)))).map(r=>r.blob),'corrupt.hash');
      };
      const badPos=verts.slice();badPos[Math.floor(verts.length*0.75)]=NaN;
      const badIdx=idxs.slice();badIdx[Math.floor(idxs.length*0.75)]=V+10;
      const badUv=uvs.slice();badUv[Math.floor(uvs.length*0.75)]=Infinity;
      const badMask=new Uint8Array(maskBytes.length+1);badMask.set(maskBytes);badMask[badMask.length-1]=1;
      const rollbackResults=[];
      for(const [label,override]of [
        ['CHUNKED NaN vertex',[{id:FrameHash.address(objId,'positions'),type:FrameHash.T.float32,value:badPos}]],
        ['CHUNKED OOB index',[{id:FrameHash.address(objId,'indices'),type:FrameHash.T.uint32,value:badIdx}]],
        ['CHUNKED NaN UV',[{id:FrameHash.address(uvTag,'uv'),type:FrameHash.T.float32,value:badUv}]],
        ['Polygon mask overflow',[{id:FrameHash.address(matTag,'faces'),type:FrameHash.T.bytes,value:badMask}]],
        ['Legacy ZIP|PREDICT NaN',[{id:FrameHash.address(objId,'positions'),type:FrameHash.T.float32,value:new Float32Array([0,0,0,1,0,0,0,NaN,0])},{id:FrameHash.address(objId,'indices'),type:FrameHash.T.uint32,value:new Uint32Array([0,1,2])},{id:FrameHash.address(uvTag,'uv'),type:FrameHash.T.float32,value:new Float32Array(6)},{id:FrameHash.address(matTag,'faces'),type:FrameHash.T.bytes,value:new Uint8Array([1])}]]
      ]){
        const corruptFile=await makeCorrupt(override);
        let rejected=false;
        try{await frameEngine.loadFile(corruptFile);}catch{rejected=true;}
        const intact=frameEngine.scene.triangleCount===baselineTris&&frameEngine.scene.meshes.length===baselineMeshes&&JSON.stringify([frameEngine.scene.boundsMin,frameEngine.scene.boundsMax])===baselineBounds&&document.querySelector('#frame-engine-canvas').dataset.ready==='true';
        rollbackResults.push({label,rejected,intact});
      }
      const [valErr,memErr]=await Promise.all([d.popErrorScope(),d.popErrorScope()]);
      return {
        pagedMode,pagedUsed,maxChunkReads,layoutOK,chunkedFlags,posExact,idxExact,
        tris:mesh2.triangleCount,verts:mesh2.vertexCount,mixedTris,
        rollbackResults,gpuError:valErr?.message||memErr?.message||null
      };
    },pagedMode);
    const tag=pagedMode?'[PagedTexture]':'[GPUBuffer]';
    check(tag+' selected expected GPU storage backend',result.pagedUsed===pagedMode,result);
    check(tag+' single-pass decode reads large geometry chunks at most once',result.maxChunkReads===1,result.maxChunkReads);
    check(tag+' saveHash writes metadata -> images -> GPU geometry in order',result.layoutOK,result);
    check(tag+' large geometry saves as CHUNKED and PNG skips gzip',result.chunkedFlags.pos&&result.chunkedFlags.idx&&result.chunkedFlags.uv&&result.chunkedFlags.pngUnzipped,result.chunkedFlags);
    check(tag+' streaming round-trip preserves exact Float32 positions and Uint32 indices',result.posExact&&result.idxExact&&result.tris===320000&&result.verts===160801,result);
    check(tag+' mixed CHUNKED + legacy ZIP|PREDICT mesh loads accurately',result.mixedTris===1000,result.mixedTris);
    for(const r of result.rollbackResults)check(tag+' atomic rollback preserves prior scene on '+r.label,r.rejected&&r.intact,r);
    check(tag+' zero WebGPU validation/OOM errors and zero JS pageerrors',!result.gpuError&&!errors.length,{gpuError:result.gpuError,errors});
  }finally{await s.close();}
}
console.log(JSON.stringify({pass:true,checks:checks.length}));
