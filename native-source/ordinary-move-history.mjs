// Called in workers. Checkpoints never share authoring/display arrays and encode
// metadata as bytes so recovery uploads can copy every field in bounded chunks.
const caches=new Set(['splineBVH','splineWire','splineWireSource']);
function encode(value){
 if(value===undefined)return['undefined'];
 if(value===null||typeof value==='string'||typeof value==='boolean')return['value',value];
 if(typeof value==='number')return['number',Object.is(value,-0)?'-0':String(value)];
 if(ArrayBuffer.isView(value))return['typed',value.constructor.name,Array.from(value,encode)];
 if(Array.isArray(value))return['array',value.map(encode)];
 if(value instanceof Date)return['date',value.toISOString()];
 if(value instanceof Map)return['map',Array.from(value,([k,v])=>[encode(k),encode(v)])];
 if(value instanceof Set)return['set',Array.from(value,encode)];
 if(typeof value==='object')return['object',Object.keys(value).sort().map(k=>[k,encode(value[k])])];
 throw Error('Unsupported Move checkpoint metadata');
}
const constructors={Float32Array,Float64Array,Uint8Array,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Uint8ClampedArray};
function decode([type,value,values]){
 if(type==='undefined')return undefined;
 if(type==='value')return value;
 if(type==='number')return value==='-0'?-0:Number(value);
 if(type==='typed'){if(!constructors[value])throw Error('Unknown checkpoint array type');return constructors[value].from(values,decode);}
 if(type==='array')return value.map(decode);
 if(type==='date')return new Date(value);
 if(type==='map')return new Map(value.map(([k,v])=>[decode(k),decode(v)]));
 if(type==='set')return new Set(value.map(decode));
 if(type==='object')return Object.fromEntries(value.map(([k,v])=>[k,decode(v)]));
 throw Error('Unknown checkpoint metadata tag');
}
function metadata(snapshot){return{groups:snapshot.groups,drawRange:snapshot.drawRange,userData:Object.fromEntries(Object.entries(snapshot.userData||{}).filter(([k])=>!caches.has(k)))};}
export function moveCheckpoint(snapshot){return{positions:snapshot.positions.slice(),normals:snapshot.normals.slice(),indices:snapshot.indices.slice(),originFaces:snapshot.originFaces.slice(),metadata:new TextEncoder().encode(JSON.stringify(encode(metadata(snapshot))))};}
export function checkpointSnapshot(checkpoint){return{positions:checkpoint.positions,normals:checkpoint.normals,indices:checkpoint.indices,originFaces:checkpoint.originFaces,...decode(JSON.parse(new TextDecoder().decode(checkpoint.metadata)))};}
export function sameCheckpointGeometry(expected,current){
 for(const key of ['positions','normals','indices']){const a=expected[key],b=current[key];if(a.constructor!==b.constructor||a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(!Object.is(a[i],b[i]))return false;}
 return JSON.stringify(encode(metadata(expected)))===JSON.stringify(encode(metadata(current)));
}
export const checkpointFields=['positions','normals','indices','originFaces','metadata'];
export function checkpointShape(q){return Object.fromEntries(checkpointFields.map(k=>[k,{type:q[k].constructor.name,length:q[k].length}]));}
export function checkpointBytes(q){return checkpointFields.reduce((n,k)=>n+q[k].byteLength,0);}
