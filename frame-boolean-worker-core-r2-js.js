import {clipPolylineSegments} from './frame-boolean-surface-index-r2-js.js?v=production-6-js-r2';
// Stage 4 worker-facing adapter for the frozen R2 JS Boolean engine.
// Keeps the production Frame worker message contract while replacing WASM with JS.
import {evaluate, classifyPoint, Operation, Label} from './frame-boolean-engine-r2-js.js?v=production-6-js-r2';
import {prepareMeshFlat} from './frame-boolean-preflight-r2-js.js?v=production-6-js-r2';

const PAIR_CLASS = Object.freeze({N:0,M:1,S:2});
const RASTER_MODE = Object.freeze({AABB:0,R8:1,ALL:2});

function finiteNumber(v, fallback=0){ return Number.isFinite(v) ? v : fallback; }
function count(v){ return Number.isSafeInteger(v) ? v : finiteNumber(v,0); }

export function validateMesh(positions, indices, label, {nonEmpty=true}={}) {
  if (!(positions instanceof Float32Array) || positions.length % 3) throw new Error(`${label} positions are invalid`);
  if (!(indices instanceof Uint32Array) || indices.length % 3) throw new Error(`${label} indices are invalid`);
  if (nonEmpty && (!positions.length || !indices.length)) throw new Error('Boolean operands must contain vertices and triangles');
  const vertices = positions.length / 3;
  for (let i=0;i<positions.length;i++) if (!Number.isFinite(positions[i])) throw new Error(`${label} contains NaN/Inf`);
  for (let i=0;i<indices.length;i++) if (indices[i] >= vertices) throw new Error(`${label} index is out of range`);
}

function toFloat32(array){
  if (array instanceof Float32Array) return array;
  return Float32Array.from(array || []);
}
function toUint32(array){
  if (array instanceof Uint32Array) return array;
  return Uint32Array.from(array || []);
}

function sumPreflightMs(result){
  return finiteNumber(result.preflightA?.timing?.total)+finiteNumber(result.preflightB?.timing?.total);
}
function makeDiagnostics(result){
  const d=result.discovery||{}, s=result.stats||{}, pa=result.preflightA||{}, pb=result.preflightB||{}, t=s.timing||{};
  const topologyMs=finiteNumber(t.topology);
  const classifyMs=finiteNumber(t.classify);
  const bandMs=finiteNumber(t.band);
  const assemblyMs=finiteNumber(t.assembly);
  return {
    backend:'frame-js-r2',
    topologyValid:!!result.topologyValid,
    ambiguous:!!result.ambiguous,
    grid:count(d.g),
    pairClass:PAIR_CLASS[d.class] ?? null,
    rasterMode:RASTER_MODE[d.mode] ?? null,
    p32:!!d.p32,
    uniquePairs:count(d.uniquePairs),
    aabbPairs:count(d.aabbPairs),
    facePairs:count(d.facePairs),
    exactPairs:count(d.exactPairs),
    segmentHits:count(d.segmentHits),
    coplanarPairs:count(d.coplanarPairs ?? d.coplanarExact),
    coplanarSuppressed:count(d.coplanarSuppressed),
    cutFaces:count(s.cutFaces),
    bandPieces:count(s.bandPieces),
    classifierQueries:count(s.classifierQueries),
    twoSidedPieces:count(s.twoSidedFallbackPieces),
    boundaryA:count(pa.boundaryEdges), boundaryB:count(pb.boundaryEdges),
    nonmanifoldA:count(pa.nonManifoldEdges), nonmanifoldB:count(pb.nonManifoldEdges),
    windingRepairsA:count(pa.windingRepairs), windingRepairsB:count(pb.windingRepairs),
    windingConflictsA:count(pa.windingConflicts), windingConflictsB:count(pb.windingConflicts),
    nestAmbA:count(pa.shellNestingAmbiguous), nestAmbB:count(pb.shellNestingAmbiguous),
    droppedDegenerateA:count(pa.droppedDegenerate), droppedDegenerateB:count(pb.droppedDegenerate),
    droppedDuplicateA:count(pa.droppedDuplicate), droppedDuplicateB:count(pb.droppedDuplicate),
    qualityA:count(pa.quality), qualityB:count(pb.quality),
    preflightMs:sumPreflightMs(result),
    patchCacheMs:finiteNumber(t.planar),
    discoveryMs:finiteNumber(t.discovery),
    backendMs:topologyMs+finiteNumber(t.faceTopo)+classifyMs+bandMs+assemblyMs,
    compactMs:0,
    totalMs:finiteNumber(t.total)+sumPreflightMs(result),
    canonicalizeMs:finiteNumber(result.topology?.stats?.timing?.canonicalize,topologyMs),
    classifyMs,
    splitMs:finiteNumber(result.topology?.stats?.timing?.split,topologyMs),
    bandGraphMs:bandMs,
    assemblyMs,
  };
}

function rcFor(result){
  if (result.ambiguous) return 2;
  return result.indices?.length ? 0 : 1;
}

function classifyLabels(positions,indices,points){
  validateMesh(positions,indices,'Classification mesh');
  if (!(points instanceof Float32Array) || points.length%3) throw new Error('Classification points are invalid');
  const prep=prepareMeshFlat(positions,indices);
  if (!prep.mesh?.faceCount) throw new Error('Classification mesh contains no usable triangles');
  const labels=new Int8Array(points.length/3);
  for(let i=0,j=0;i<points.length;i+=3,j++){
    const r=classifyPoint(prep.mesh,[points[i],points[i+1],points[i+2]]);
    // Frame display contract: +1 inside, -1 outside, 0 boundary/ambiguous.
    labels[j]=r.label===Label.Inside?1:(r.label===Label.Outside?-1:0);
  }
  return labels;
}

export async function handleBooleanWorkerMessage(data={}){
  if(data.cmd!=='run'&&data.cmd!=='classify'&&data.cmd!=='surfaceClip') return null;
  try{
    if(data.cmd==='surfaceClip'){
      validateMesh(data.positions,data.indices,'Surface clip mesh');
      if(!(data.points instanceof Float32Array)||data.points.length%3)throw new Error('Surface clip points are invalid');
      if(!(data.lines instanceof Uint32Array)||data.lines.length%2)throw new Error('Surface clip line ranges are invalid');
      for(let i=0;i<data.points.length;i++)if(!Number.isFinite(data.points[i]))throw new Error('Surface clip contains NaN/Inf');
      const steps=Math.max(4,Math.min(256,Math.floor(Number(data.steps)||32))),refine=Math.max(4,Math.min(32,Math.floor(Number(data.refine)||16))),tolerance=Math.max(0,Number(data.tolerance)||0);
      const r=clipPolylineSegments(data.positions,data.indices,data.points,data.lines,tolerance,{steps,refine});
      return {message:{id:data.id,ok:true,...r,wasmHeapBytes:0},transfer:[r.lineIds.buffer,r.edgeIds.buffer,r.t.buffer]};
    }
    if(data.cmd==='classify'){
      const labels=classifyLabels(data.positions,data.indices,data.points);
      return {message:{id:data.id,ok:true,labels,wasmHeapBytes:0},transfer:[labels.buffer]};
    }
    validateMesh(data.positionsA,data.indicesA,'Operand A');
    validateMesh(data.positionsB,data.indicesB,'Operand B');
    if(data.op!==Operation.Union&&data.op!==Operation.Difference&&data.op!==Operation.Intersection) throw new Error(`Unknown Boolean operation code: ${data.op}`);
    const started=performance.now();
    const result=evaluate(data.positionsA,data.indicesA,data.positionsB,data.indicesB,data.op,{profile:true,p32Policy:'js'});
    const wallMilliseconds=performance.now()-started;
    const positions=toFloat32(result.positions),indices=toUint32(result.indices),seamPositions=toFloat32(result.seamPositions),seamIndices=toUint32(result.seamIndices);
    const report=makeDiagnostics(result),rc=rcFor(result);
    return {
      message:{id:data.id,ok:true,rc,wallMilliseconds,positions,indices,seamPositions,seamIndices,report,wasmHeapBytes:0},
      transfer:[positions.buffer,indices.buffer,seamPositions.buffer,seamIndices.buffer],
    };
  }catch(error){
    return {message:{id:data.id,ok:false,error:error?.message||String(error),wasmHeapBytes:0},transfer:[]};
  }
}
